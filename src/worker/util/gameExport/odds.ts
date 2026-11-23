// Per-game download, stakes: each team's playoff and title odds just before and just after the game (Season Odds' Monte Carlo,
// seasonOdds/simSeason.ts), worked out again from the season's stored games. The simulations use a generator seeded from the game id
// (common/random.ts makeSeededRandom), never Math.random, and both runs use the same seed, so the change is the game's result and not
// noise between runs. A playoff game gets its series odds instead (exact, from the per-game win probability).
import { PHASE } from "../../../common/constants.ts";
import getWinner from "../../../common/getWinner.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import type { Game } from "../../../common/types.ts";
import getPlayoffsByConf from "../../core/season/getPlayoffsByConf.ts";
import { simSeasonOdds, winProb } from "../../core/seasonOdds/simSeason.ts";
import { teamStrength } from "../../core/seasonOdds/strength.ts";
import type { TeamSeasonRecord } from "../../core/team/getHypotheticalTeam.ts";
import { idb } from "../../db/index.ts";
import g from "../g.ts";
import { featureOn } from "../nativeFeatures.ts";
import { isBefore, type SeasonContext } from "./pregame.ts";

// Fewer than the Season Odds page's 1000: the file runs it twice, and the seeded runs share their noise
export const GAME_EXPORT_ODDS_SIMS = 400;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Odds = { playoffs: number; title: number; projWon: number };

type OddsResult =
	| {
			value: {
				kind: "series";
				teams: {
					tid: number;
					seriesBefore: number;
					seriesAfter: number;
					change: number;
				}[];
				model: string;
			};
	  }
	| {
			value: {
				kind: "season";
				numSims: number;
				seed: number;
				teams: {
					tid: number;
					before: Odds;
					after: Odds;
					change: { playoffs: number; title: number };
				}[];
				model: string;
			};
	  }
	| { value: null; reason: string };

const emptyRecord = (ts: { tid: number; cid: number; did: number }) =>
	({
		tid: ts.tid,
		cid: ts.cid,
		did: ts.did,
		won: 0,
		lost: 0,
		otl: 0,
		tied: 0,
		wonDiv: 0,
		lostDiv: 0,
		otlDiv: 0,
		tiedDiv: 0,
		wonConf: 0,
		lostConf: 0,
		otlConf: 0,
		tiedConf: 0,
	}) as TeamSeasonRecord;

const addGame = (
	recs: Map<number, TeamSeasonRecord>,
	x: Game,
	otlOn: boolean,
) => {
	const w = getWinner(x.teams);
	const a = recs.get(x.teams[0].tid);
	const b = recs.get(x.teams[1].tid);
	if (!a || !b) {
		return;
	}
	const sameDiv = a.did === b.did;
	const sameConf = a.cid === b.cid;
	const add = (r: TeamSeasonRecord, res: "won" | "lost" | "tied" | "otl") => {
		r[res] += 1;
		if (sameDiv) {
			(r as any)[`${res}Div`] += 1;
		}
		if (sameConf) {
			(r as any)[`${res}Conf`] += 1;
		}
	};
	if (w === -1) {
		add(a, "tied");
		add(b, "tied");
	} else {
		const loss = otlOn && x.overtimes > 0 ? "otl" : "lost";
		add(w === 0 ? a : b, "won");
		add(w === 0 ? b : a, loss);
	}
};

// Probability of winning a best-of series from this state, p the chance of winning each game
export const seriesWinProb = (
	won: number,
	lost: number,
	numToWin: number,
	p: number,
): number => {
	if (won >= numToWin) {
		return 1;
	}
	if (lost >= numToWin) {
		return 0;
	}
	// (at most 2 × numToWin - 1 levels deep)
	return (
		p * seriesWinProb(won + 1, lost, numToWin, p) +
		(1 - p) * seriesWinProb(won, lost + 1, numToWin, p)
	);
};

export const buildOdds = async (
	ctx: SeasonContext,
	strengths: { tid: number; strength: number }[],
): Promise<OddsResult> => {
	const { game } = ctx;
	if (__SPORT !== "basketball") {
		return {
			value: null,
			reason: "Season Odds (playoff and title odds) are only in Basketball GM.",
		};
	}
	if (ctx.allStar) {
		return { value: null, reason: "All-Star Game." };
	}
	if (!featureOn("seasonOdds")) {
		return { value: null, reason: "Season Odds is turned off." };
	}

	const numSims = GAME_EXPORT_ODDS_SIMS;
	const hca = 2.5 * (g.get("homeCourtAdvantage") ?? 1);

	if (game.playoffs) {
		const info = [game.teams[0], game.teams[1]].map((t) => (t as any).playoffs);
		const numToWin = game.numGamesToWinSeries;
		if (!info[0] || !info[1] || numToWin === undefined) {
			return {
				value: null,
				reason:
					"A play-in game, or a playoff game stored without its series: the bracket at the time is not stored per game, so title odds can't be worked out again.",
			};
		}
		const w = getWinner(game.teams);
		const before = [
			info[0].won - (w === 0 ? 1 : 0),
			info[1].won - (w === 1 ? 1 : 0),
		];
		// Per game, on a neutral court (the rest of the series alternates home court)
		const p = winProb(strengths[0]!.strength - strengths[1]!.strength);
		const teams = ([0, 1] as const).map((i) => {
			const pi = i === 0 ? p : 1 - p;
			const b = seriesWinProb(before[i]!, before[1 - i]!, numToWin, pi);
			const a = seriesWinProb(info[i].won, info[1 - i].won, numToWin, pi);
			return {
				tid: game.teams[i].tid,
				seriesBefore: r3(b),
				seriesAfter: r3(a),
				change: r3(a - b),
			};
		});
		return {
			value: {
				kind: "series" as const,
				teams,
				model:
					"Series win probability from the pregame team strengths (neutral court each game), exact (no simulation). Title odds need the whole bracket as it stood, which is not stored per game.",
			},
		};
	}

	// Regular season: every team's record before, the games still to play (stored box scores after this game, plus the current
	// schedule in the current season) and every team's strength as it stood
	const season = game.season;
	const current = season === g.get("season");
	const teamSeasons = [...ctx.teamSeasons.values()].filter((ts) => ts.tid >= 0);
	const tids = new Set(teamSeasons.map((ts) => ts.tid));
	const regular = ctx.seasonGames.filter(
		(x) => !x.playoffs && tids.has(x.teams[0].tid) && tids.has(x.teams[1].tid),
	);
	const played = regular.filter((x) => x.gid !== game.gid && isBefore(x, game));
	const laterPlayed = regular.filter(
		(x) => x.gid !== game.gid && !isBefore(x, game),
	);
	let unplayed: { homeTid: number; awayTid: number }[] = [];
	// (in the current regular season, the games not played yet; once the playoffs start the regular season is all stored)
	if (current && g.get("phase") < PHASE.PLAYOFFS) {
		unplayed = (await idb.cache.schedule.getAll())
			.filter((x) => x.homeTid >= 0 && x.awayTid >= 0)
			.map((x) => ({ homeTid: x.homeTid, awayTid: x.awayTid }));
	}
	const numGames = g.get("numGames", season);
	const expected = (numGames * teamSeasons.length) / 2;
	const known = played.length + 1 + laterPlayed.length + unplayed.length;
	if (Math.abs(known - expected) > Math.max(2, 0.01 * expected)) {
		return {
			value: null,
			reason: `The season's schedule is not all stored (${known} of ${Math.round(expected)} regular season games: box scores deleted, or a custom schedule), so the odds can't be worked out again.`,
		};
	}

	const otlOn = !!g.get("otl", season);
	const recsBefore = new Map(
		teamSeasons.map((ts) => [ts.tid, emptyRecord(ts)]),
	);
	for (const x of played) {
		addGame(recsBefore, x, otlOn);
	}
	const recsAfter = new Map(
		[...recsBefore.entries()].map(([tid, r]) => [tid, { ...r }]),
	);
	addGame(recsAfter, game, otlOn);

	// Strength: the team's rating at its latest game before this one (the box score's ovr at tip-off) and its margin so far
	const ovrOf = new Map<number, number>();
	const marginOf = new Map<number, { gp: number; m: number }>();
	for (const x of played.toSorted((a, b) => (isBefore(a, b) ? -1 : 1))) {
		for (const side of [0, 1] as const) {
			const t = x.teams[side];
			if (typeof t.ovr === "number") {
				ovrOf.set(t.tid, t.ovr);
			}
			const row = marginOf.get(t.tid) ?? { gp: 0, m: 0 };
			row.gp += 1;
			row.m += t.pts - x.teams[1 - side]!.pts;
			marginOf.set(t.tid, row);
		}
	}
	const given = new Map(strengths.map((s) => [s.tid, s.strength]));
	const teamsFor = (recs: Map<number, TeamSeasonRecord>) =>
		teamSeasons.map((ts) => {
			const mv = marginOf.get(ts.tid) ?? { gp: 0, m: 0 };
			const rating =
				given.get(ts.tid) ??
				teamStrength({
					ovr: ovrOf.get(ts.tid) ?? 50,
					mov: mv.gp > 0 ? mv.m / mv.gp : 0,
					gp: mv.gp,
					playoffOvr: false,
				}).strength;
			return { tid: ts.tid, rating, record: recs.get(ts.tid)! };
		});
	const rest = laterPlayed
		.map((x) => ({ homeTid: x.teams[0].tid, awayTid: x.teams[1].tid }))
		.concat(unplayed);
	const thisGame = { homeTid: game.teams[0].tid, awayTid: game.teams[1].tid };
	const byConf = await getPlayoffsByConf(season);
	const numGamesPlayoffSeries = g.get("numGamesPlayoffSeries", season);
	const seed = (game.gid * 2654435761) >>> 0;
	const run = (recs: Map<number, TeamSeasonRecord>, schedule: typeof rest) =>
		simSeasonOdds({
			byConf,
			teams: teamsFor(recs),
			schedule,
			numGamesPlayoffSeries,
			hca,
			reseed: !!g.get("playoffsReseed"),
			numSims,
			random: makeSeededRandom(seed),
		});
	const before = await run(recsBefore, [thisGame, ...rest]);
	const after = await run(recsAfter, rest);
	const pick = (r: typeof before, tid: number): Odds => {
		const t = r.teams.find((x) => x.tid === tid);
		return {
			playoffs: r3(t?.playoffs ?? 0),
			title: r3(t?.title ?? 0),
			projWon: Math.round(10 * (t?.projWon ?? 0)) / 10,
		};
	};
	return {
		value: {
			kind: "season" as const,
			numSims,
			seed,
			teams: [game.teams[0].tid, game.teams[1].tid].map((tid) => {
				const b = pick(before, tid);
				const a = pick(after, tid);
				return {
					tid,
					before: b,
					after: a,
					change: {
						playoffs: r3(a.playoffs - b.playoffs),
						title: r3(a.title - b.title),
					},
				};
			}),
			model: `Season Odds' simulation (${numSims} seasons each) from the records and team strengths as they stood, the rest of the schedule, and this game's result for "after". Seeded from the game id (no Math.random draw), the same seed for both runs.`,
		},
	};
};
