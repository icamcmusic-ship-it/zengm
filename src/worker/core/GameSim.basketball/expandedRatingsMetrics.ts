// Test support for expanded ratings (the expandedRatings setting): simulates games on the same generated rosters (made with the setting
// on, so they have wingspan and perimeter/interior defense) with the setting off and on, same seeds, and sums league totals. Used by
// expandedRatingsSim.test.ts (assertions) and, with EXPANDED_METRICS=1, to print the calibration table. Measures the sim's own numbers,
// no play-by-play.
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { withSeededRandom } from "./simLiveGameForTests.ts";
import { team } from "../index.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { last, range } from "../../../common/utils.ts";

export const STAT_KEYS = [
	"pts",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"pf",
	"fgAtRim",
	"fgaAtRim",
	"fgLowPost",
	"fgaLowPost",
	"fgMidRange",
	"fgaMidRange",
] as const;

export type Totals = Record<(typeof STAT_KEYS)[number], number> & {
	teamGames: number;
};

const NUM_TEAMS = 30;

// A generated 30-team league, made with the setting on
const genLeague = async (expandedGen: boolean) => {
	resetG();
	g.setWithoutSavingToDB("expandedRatings", expandedGen);
	await resetCache({});
	const players: any[] = await createRandomPlayers({
		activeTids: range(NUM_TEAMS),
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams: range(NUM_TEAMS).map((tid) => ({ tid })),
	});
	for (const p of players) {
		const r = last(p.ratings) as { ovr: number };
		p.valueNoPot = r.ovr;
		p.valueNoPotFuzz = r.ovr;
		p.value = r.ovr;
		p.valueFuzz = r.ovr;
		if (
			p.tid >= 0 &&
			p.contractDemand &&
			!Number.isFinite(p.contractDemand.exp)
		) {
			p.contractDemand = {
				...p.contractDemand,
				exp: g.get("season") + 1,
				temp: undefined,
			};
		}
	}
	for (const tid of range(NUM_TEAMS)) {
		const roster = players
			.filter((p) => p.tid === tid)
			.sort((a, b) => b.valueNoPot - a.valueNoPot);
		for (const [i, p] of roster.entries()) {
			p.rosterOrder = i;
		}
	}
	const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
	await resetCache({
		players,
		teams: teamsDefault.map(team.generate),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
	return players;
};

export const simExpandedGames = async ({
	expanded,
	expandedGen = true,
	numGames,
	gamesPerRoster = 200,
	seed = 1,
	realistic = false,
	onGame,
}: {
	expanded: boolean;
	// Rosters generated with the setting on (default) or off
	expandedGen?: boolean;
	numGames: number;
	gamesPerRoster?: number;
	seed?: number;
	realistic?: boolean;
	onGame?: (result: any, teams: any[]) => void;
}): Promise<Totals> => {
	const out = { teamGames: 0 } as Totals;
	for (const key of STAT_KEYS) {
		out[key] = 0;
	}
	let numDone = 0;
	for (let r = 0; numDone < numGames; r++) {
		await withSeededRandom(seed * 7919 + r * 104729, async () => {
			await genLeague(expandedGen);
			g.setWithoutSavingToDB("expandedRatings", expanded);
			g.setWithoutSavingToDB("playerTraits", false);
			g.setWithoutSavingToDB("realisticPossessions", realistic);
			g.setWithoutSavingToDB("storePlayByPlay", false);
			for (let i = 0; i < gamesPerRoster && numDone < numGames; i++) {
				const a = i % NUM_TEAMS;
				const b =
					(a + 1 + (Math.floor(i / NUM_TEAMS) % (NUM_TEAMS - 1))) % NUM_TEAMS;
				const teams = await loadTeams([a, b], {});
				const pair: [any, any] =
					i % 2 === 0 ? [teams[a]!, teams[b]!] : [teams[b]!, teams[a]!];
				const sim = new GameSim({
					gid: r * 1000 + i,
					teams: pair,
					baseInjuryRate: g.get("injuryRate"),
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				const result = sim.run();
				numDone += 1;
				onGame?.(result, pair);
				for (const t of result.team) {
					out.teamGames += 1;
					for (const key of STAT_KEYS) {
						out[key] += t.stat[key] ?? 0;
					}
				}
			}
		});
	}
	return out;
};

// Per team game averages and percentages, for the table
export const summarizeTotals = (t: Totals) => {
	const pg = (x: number) => x / t.teamGames;
	return {
		pts: pg(t.pts),
		"fg%": (100 * t.fg) / t.fga,
		"3p%": (100 * t.tp) / t.tpa,
		"rim%": (100 * t.fgAtRim) / t.fgaAtRim,
		"post%": (100 * t.fgLowPost) / t.fgaLowPost,
		"mid%": (100 * t.fgMidRange) / t.fgaMidRange,
		fga: pg(t.fga),
		tpa: pg(t.tpa),
		fta: pg(t.fta),
		trb: pg(t.orb + t.drb),
		orb: pg(t.orb),
		ast: pg(t.ast),
		tov: pg(t.tov),
		stl: pg(t.stl),
		blk: pg(t.blk),
		pf: pg(t.pf),
	};
};
