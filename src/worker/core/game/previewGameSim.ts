// Settings > Tendencies > Preview: simulates a handful of games between the league's teams with some game sim settings swapped in,
// and returns league averages (pace, 3PA rate, eFG%, TOV%, ORB%, FT rate, points, ORtg, FG%, 3P%, FT%). Nothing is saved: the teams are loaded from the
// cache, the games are played with GameSim.run directly (no box scores, player stats, injuries or schedule changes are written), and
// the settings are only swapped in g while the games run (one synchronous block, so nothing else in the worker can see them).
// Deterministic: the matchups and every random draw come from a fixed seed, and the same games are played for each settings set, so
// differences between the columns come from the settings rather than from the dice.
import { makeSeededRandom, withRandom } from "../../../common/random.ts";
import type {
	Conditions,
	GameAttributesLeague,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, lock } from "../../util/index.ts";
import * as staff from "../staff/index.ts";
import GameSim from "../GameSim.basketball/index.ts";
import loadTeams from "./loadTeams.ts";

// The settings a preview may swap in (Tendencies settings that GameSim reads)
export const PREVIEW_SETTING_KEYS = [
	"pace",
	"threePointers",
	"threePointTendencyFactor",
	"threePointAccuracyFactor",
	"twoPointAccuracyFactor",
	"ftAccuracyFactor",
	"blockFactor",
	"stealFactor",
	"turnoverFactor",
	"orbFactor",
	"foulRateFactor",
	"assistFactor",
] as const;

export type PreviewSettingKey = (typeof PREVIEW_SETTING_KEYS)[number];

export type PreviewSettings = Partial<{
	[K in PreviewSettingKey]: GameAttributesLeague[K];
}>;

export type GameSimPreviewStats = {
	games: number;
	// possessions per 48 minutes per team
	pace: number;
	// 3PA / FGA
	tpaRate: number;
	// (FG + 0.5 * 3P) / FGA
	efg: number;
	// TOV / (FGA + 0.44 * FTA + TOV)
	tovPct: number;
	// ORB / (ORB + opponent DRB)
	orbPct: number;
	// FTA / FGA
	ftRate: number;
	// per team per game
	pts: number;
	// points per 100 possessions
	ortg: number;
	// FG / FGA, 3P / 3PA, FT / FTA
	fgPct: number;
	tpPct: number;
	ftPct: number;
};

export const PREVIEW_SEED = 20_260_101;
const MAX_GAMES = 200;

type Totals = Record<
	| "pts"
	| "fg"
	| "fga"
	| "tp"
	| "tpa"
	| "ft"
	| "fta"
	| "orb"
	| "drb"
	| "tov"
	| "poss",
	number
> & { games: number; minutes: number };

const emptyTotals = (): Totals => ({
	games: 0,
	minutes: 0,
	pts: 0,
	fg: 0,
	fga: 0,
	tp: 0,
	tpa: 0,
	ft: 0,
	fta: 0,
	orb: 0,
	drb: 0,
	tov: 0,
	poss: 0,
});

// Basketball-Reference's possession estimate for one team, given its opponent
const possessions = (t: any, o: any) => {
	const orbPct = (s: any, opp: any) =>
		s.orb + opp.drb > 0 ? s.orb / (s.orb + opp.drb) : 0;
	const one = (s: any, opp: any) =>
		s.fga + 0.4 * s.fta - 1.07 * orbPct(s, opp) * (s.fga - s.fg) + s.tov;
	return 0.5 * (one(t, o) + one(o, t));
};

export const addGameToTotals = (
	tot: Totals,
	teams: { stat: any }[],
	minutes: number,
) => {
	tot.games += 1;
	tot.minutes += minutes;
	for (let i = 0; i < 2; i++) {
		const s = teams[i]!.stat;
		const o = teams[1 - i]!.stat;
		tot.pts += s.pts ?? 0;
		tot.fg += s.fg ?? 0;
		tot.fga += s.fga ?? 0;
		tot.tp += s.tp ?? 0;
		tot.tpa += s.tpa ?? 0;
		tot.ft += s.ft ?? 0;
		tot.fta += s.fta ?? 0;
		tot.orb += s.orb ?? 0;
		tot.drb += s.drb ?? 0;
		tot.tov += s.tov ?? 0;
		tot.poss += possessions(s, o);
	}
};

export const totalsToStats = (tot: Totals): GameSimPreviewStats => {
	const div = (a: number, b: number) => (b > 0 ? a / b : 0);
	return {
		games: tot.games,
		// team possessions per 48 minutes (tot.poss has both teams, tot.minutes is game minutes)
		pace: div(tot.poss / 2, tot.minutes) * 48,
		tpaRate: div(tot.tpa, tot.fga),
		efg: div(tot.fg + 0.5 * tot.tp, tot.fga),
		tovPct: div(tot.tov, tot.fga + 0.44 * tot.fta + tot.tov),
		// league-wide, every offensive rebound chance is one team's ORB or the other's DRB
		orbPct: div(tot.orb, tot.orb + tot.drb),
		ftRate: div(tot.fta, tot.fga),
		pts: div(tot.pts, 2 * tot.games),
		ortg: div(tot.pts, tot.poss) * 100,
		fgPct: div(tot.fg, tot.fga),
		tpPct: div(tot.tp, tot.tpa),
		ftPct: div(tot.ft, tot.fta),
	};
};

// Plays the games (synchronously) with the given settings in g, then puts g back
export const runPreviewGames = (
	matchups: [any, any][],
	settings: PreviewSettings,
	seed: number,
): GameSimPreviewStats => {
	const saved: [PreviewSettingKey, unknown][] = [];
	for (const key of PREVIEW_SETTING_KEYS) {
		if (Object.hasOwn(settings, key) && settings[key] !== undefined) {
			saved.push([key, g.getRaw(key)]);
			g.setWithoutSavingToDB(key, settings[key] as any);
		}
	}
	try {
		return withRandom(makeSeededRandom(seed), () => {
			const tot = emptyTotals();
			const quarterLength = g.get("quarterLength");
			const numPeriods = g.get("numPeriods");
			matchups.forEach((teams, i) => {
				const result = new GameSim({
					gid: -1000 - i,
					teams: teams as any,
					doPlayByPlay: false,
					// (its events are never read)
					storePbp: false,
					homeCourtFactor: 1,
					allStarGame: false,
					baseInjuryRate: 0,
					neutralSite: false,
				}).run();
				const minutes =
					numPeriods * quarterLength +
					result.overtimes * (g.get("overtimeLength") ?? 5);
				addGameToTotals(tot, result.team, minutes);
			});
			return totalsToStats(tot);
		});
	} finally {
		for (const [key, value] of saved) {
			g.setWithoutSavingToDB(key, value as any);
		}
	}
};

export const loadMatchups = async (
	pairs: [number, number][],
	conditions: Conditions,
) => {
	const matchups: [any, any][] = [];
	for (const [homeTid, awayTid] of pairs) {
		const teams = await loadTeams([homeTid, awayTid], conditions, new Set());
		const schedule = [{ homeTid, awayTid }];
		await staff.applyCoachSystems(schedule, teams);
		matchups.push([teams[homeTid], teams[awayTid]]);
	}
	return matchups;
};

const previewGameSim = async (
	{
		numGames = 50,
		settings,
	}: {
		numGames?: number;
		settings: PreviewSettings;
	},
	conditions: Conditions,
): Promise<
	| { current: GameSimPreviewStats; pending: GameSimPreviewStats }
	| { error: string }
> => {
	if (__SPORT !== "basketball") {
		return { error: "Preview is only available in basketball." };
	}
	if (lock.get("gameSim")) {
		return { error: "Wait for the current game simulation to finish." };
	}
	if (g.get("lid") === undefined || !idb.league) {
		return { error: "Open a league to preview settings." };
	}
	const tids = (await idb.cache.teams.getAll())
		.filter((t) => !t.disabled)
		.map((t) => t.tid);
	if (tids.length < 2) {
		return { error: "Need at least 2 active teams." };
	}

	const n = Math.max(1, Math.min(MAX_GAMES, Math.round(numGames)));
	const pairs = withRandom(makeSeededRandom(PREVIEW_SEED), () => {
		const out: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const a = Math.floor(Math.random() * tids.length);
			let b = Math.floor(Math.random() * (tids.length - 1));
			if (b >= a) {
				b += 1;
			}
			out.push([tids[a]!, tids[b]!]);
		}
		return out;
	});

	try {
		// Fresh team objects for each run (GameSim changes them while it plays)
		const matchupsCurrent = await loadMatchups(pairs, conditions);
		const matchupsPending = await loadMatchups(pairs, conditions);
		const current = runPreviewGames(matchupsCurrent, {}, PREVIEW_SEED);
		const pending = runPreviewGames(matchupsPending, settings, PREVIEW_SEED);
		return { current, pending };
	} catch (error) {
		return {
			error: `Preview not available right now (${(error as Error).message}).`,
		};
	}
};

export default previewGameSim;
