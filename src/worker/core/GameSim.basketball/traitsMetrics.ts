// Test support: simulates many games with the Player Traits setting off and on (same rosters, same seeds) and measures league averages and the effects
// of individual traits. Used by playerTraitsSim.test.ts (assertions, a few hundred games) and, with TRAITS_METRICS=1, to print the table for ~1000
// games. Like possessionMetrics.ts it measures the sim's own numbers: no play-by-play of any kind.
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { withSeededRandom } from "./simLiveGameForTests.ts";
import { team } from "../index.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { helpers } from "../../util/index.ts";
import { last, range } from "../../../common/utils.ts";
import {
	TRAIT_KEYS,
	clutchSituationWeight,
	type TraitKey,
} from "../../../common/playerTraits/index.ts";

type ShotLog = { pid: number; probMake: number; clutchWeight: number };

let shots: ShotLog[] = [];
let patched = false;
const patch = () => {
	if (patched) {
		return;
	}
	patched = true;
	const proto = GameSim.prototype as any;
	const getShotInfo = proto.getShotInfo;
	proto.getShotInfo = function (this: any, info: any) {
		const out = getShotInfo.call(this, info);
		if (!out.blocked) {
			shots.push({
				pid: info.p.id,
				probMake: out.probMake,
				clutchWeight: clutchSituationWeight(this.traitSituation(this.o)),
			});
		}
		return out;
	};
};

export type PlayerLine = {
	scores: Record<TraitKey, number> | undefined;
	min: number;
	fga: number;
	fg: number;
	tpa: number;
	// Per game FG% (games with at least 6 attempts), for game-to-game variance
	fgpGames: number[];
	// Mean probMake over all his shots, and over clutch shots weighted by the clutch weight
	probMakeSum: number;
	probMakeN: number;
	clutchProbSum: number;
	clutchWeightSum: number;
};

export type GamesResult = {
	numGames: number;
	teamGames: number;
	pts: number;
	fga: number;
	fg: number;
	tpa: number;
	fta: number;
	ft: number;
	tov: number;
	orb: number;
	pf: number;
	injuries: number;
	overtimes: number;
	players: Map<string, PlayerLine>;
};

const NUM_TEAMS = 30;

// A generated 30-team league (the league the trait calibration is done on): rosters as in a real league, best players first
const genLeague = async () => {
	resetG();
	g.setWithoutSavingToDB("playerTraits", false);
	const players: any[] = await createRandomPlayers({
		activeTids: range(NUM_TEAMS),
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams: range(NUM_TEAMS).map((tid) => ({ tid })),
	});
	for (const p of players) {
		// Like league creation: player values drive who plays
		const r = last(p.ratings) as { ovr: number };
		p.valueNoPot = r.ovr;
		p.valueNoPotFuzz = r.ovr;
		p.value = r.ovr;
		p.valueFuzz = r.ovr;
		// (the real league creation signs the contracts; here they only need to be valid)
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
};

export const simTraitGames = async ({
	traits,
	numGames,
	gamesPerRoster = 250,
	seed = 1,
	realistic = false,
	techFouls = false,
}: {
	traits: boolean;
	numGames: number;
	gamesPerRoster?: number;
	seed?: number;
	realistic?: boolean;
	techFouls?: boolean;
}): Promise<GamesResult> => {
	patch();
	const out: GamesResult = {
		numGames: 0,
		teamGames: 0,
		pts: 0,
		fga: 0,
		fg: 0,
		tpa: 0,
		fta: 0,
		ft: 0,
		tov: 0,
		orb: 0,
		pf: 0,
		injuries: 0,
		overtimes: 0,
		players: new Map(),
	};
	for (let r = 0; r * gamesPerRoster < numGames; r++) {
		await withSeededRandom(seed * 7919 + r * 104729, async () => {
			await genLeague();
			g.setWithoutSavingToDB("playerTraits", traits);
			g.setWithoutSavingToDB("realisticPossessions", realistic);
			g.setWithoutSavingToDB("technicalFouls", techFouls);
			g.setWithoutSavingToDB("storePlayByPlay", false);
			for (let i = 0; i < gamesPerRoster && out.numGames < numGames; i++) {
				// Round robin through the league's matchups, alternating home and away
				const a = i % NUM_TEAMS;
				const b =
					(a + 1 + (Math.floor(i / NUM_TEAMS) % (NUM_TEAMS - 1))) % NUM_TEAMS;
				const teams = await loadTeams([a, b], {});
				const pair: [any, any] =
					i % 2 === 0 ? [teams[a]!, teams[b]!] : [teams[b]!, teams[a]!];
				const scoresByPid = new Map<number, Record<TraitKey, number>>();
				for (const t of pair) {
					for (const p of t.player) {
						if (p.traitEffects) {
							scoresByPid.set(p.id, { ...p.traitEffects.scores });
						}
					}
				}
				shots = [];
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
				out.numGames += 1;
				out.overtimes += result.overtimes;
				for (const t of result.team) {
					out.teamGames += 1;
					for (const key of [
						"pts",
						"fga",
						"fg",
						"tpa",
						"fta",
						"ft",
						"tov",
						"orb",
						"pf",
					] as const) {
						out[key] += t.stat[key];
					}
					for (const p of t.player) {
						if (p.newInjury) {
							out.injuries += 1;
						}
						const key = `${r}:${p.id}`;
						let line = out.players.get(key);
						if (!line) {
							line = {
								scores: scoresByPid.get(p.id),
								min: 0,
								fga: 0,
								fg: 0,
								tpa: 0,
								fgpGames: [],
								probMakeSum: 0,
								probMakeN: 0,
								clutchProbSum: 0,
								clutchWeightSum: 0,
							};
							out.players.set(key, line);
						}
						line.min += p.stat.min;
						line.fga += p.stat.fga;
						line.fg += p.stat.fg;
						line.tpa += p.stat.tpa;
						if (p.stat.fga >= 6) {
							line.fgpGames.push(p.stat.fg / p.stat.fga);
						}
					}
				}
				for (const s of shots) {
					const line = out.players.get(`${r}:${s.pid}`);
					if (line) {
						line.probMakeSum += s.probMake;
						line.probMakeN += 1;
						line.clutchProbSum += s.probMake * s.clutchWeight;
						line.clutchWeightSum += s.clutchWeight;
					}
				}
			}
		});
	}
	return out;
};

export const leagueAverages = (r: GamesResult) => ({
	pts: r.pts / r.teamGames,
	fgPct: r.fg / r.fga,
	tpaRate: r.tpa / r.fga,
	tovPct: r.tov / (r.fga + 0.44 * r.fta + r.tov),
	ftPct: r.ft / r.fta,
	ftaPerGame: r.fta / r.teamGames,
	pfPerGame: r.pf / r.teamGames,
	orbPerGame: r.orb / r.teamGames,
	injuriesPerGame: r.injuries / r.numGames,
});

// Players with a score on a trait, split in thirds by it
export const thirdsByTrait = (r: GamesResult, key: TraitKey) => {
	const lines = [...r.players.values()].filter((l) => l.scores && l.min >= 100);
	lines.sort((a, b) => a.scores![key] - b.scores![key]);
	const n = Math.floor(lines.length / 3);
	return {
		low: lines.slice(0, n),
		high: lines.slice(-n),
	};
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) =>
	xs.length ? sum(xs) / xs.length : Number.NaN;
export const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export { TRAIT_KEYS };
