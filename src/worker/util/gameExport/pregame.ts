// Per-game download, pregame: what was at stake (records, standings, streaks, win probability and spread), the playoff series, each team's
// schedule load (rest, back-to-backs, travel, home stands and road trips), the head-to-head history and the venue. Everything is worked out
// from the season's stored box scores, so it is what was true before the game, not what is true now (except where a field says so).
import getWinner from "../../../common/getWinner.ts";
import { MARQUEE_LABELS, marqueeCrowdBoost } from "../../../common/marquee.ts";
import { seriesGameState } from "../../../common/seriesState.ts";
import type { Game, TeamSeason } from "../../../common/types.ts";
import { storylinesFor } from "../../core/playoffExtras/index.ts";
import { winProb } from "../../core/seasonOdds/simSeason.ts";
import { teamStrength } from "../../core/seasonOdds/strength.ts";
import { travelDistance } from "../../core/GameSim.basketball/scheduleLoad.ts";
import { idb } from "../../db/index.ts";
import g from "../g.ts";
import { loadRivalries, pairKey } from "../rivalries.ts";

export type Unavailable = { path: string; reason: string }[];

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// Is game a before game b (same season)? By day, then gid
export const isBefore = (a: Game, b: Game) => {
	const da = a.day ?? -1;
	const db = b.day ?? -1;
	return da !== db ? da < db : a.gid < b.gid;
};

const sideOf = (game: Game, tid: number) =>
	game.teams[0].tid === tid ? 0 : game.teams[1].tid === tid ? 1 : undefined;

type Rec = { won: number; lost: number; tied: number; otl: number };
const emptyRec = (): Rec => ({ won: 0, lost: 0, tied: 0, otl: 0 });
const pct = (r: Rec) => {
	const gp = r.won + r.lost + r.tied + r.otl;
	return gp > 0 ? (r.won + 0.5 * r.tied) / gp : 0.5;
};
const recText = (r: Rec) =>
	`${r.won}-${r.lost}${r.tied > 0 ? `-${r.tied}` : ""}${r.otl > 0 ? `-${r.otl}` : ""}`;

// The result of a game for one of its teams: "W", "L", "T" or "OTL"
const resultFor = (game: Game, side: 0 | 1, otlOn: boolean) => {
	const w = getWinner(game.teams);
	if (w === -1) {
		return "T";
	}
	if (w === side) {
		return "W";
	}
	return otlOn && game.overtimes > 0 && !game.playoffs ? "OTL" : "L";
};
const addResult = (r: Rec, res: string) => {
	if (res === "W") {
		r.won += 1;
	} else if (res === "T") {
		r.tied += 1;
	} else if (res === "OTL") {
		r.otl += 1;
	} else {
		r.lost += 1;
	}
};

export type SeasonContext = {
	game: Game;
	seasonGames: Game[];
	teamSeasons: Map<number, TeamSeason>;
	// The team's games this season before this one (both regular season and playoffs), oldest first
	priorByTeam: [Game[], Game[]];
	allStar: boolean;
};

export const loadSeasonContext = async (game: Game): Promise<SeasonContext> => {
	const allStar = game.teams[0].tid < 0 || game.teams[1].tid < 0;
	const seasonGames = await idb.merged.games.getAll({ season: game.season });
	const teamSeasons = new Map(
		(await idb.merged.teamSeasons.getAll({ season: game.season })).map((ts) => [
			ts.tid,
			ts,
		]),
	);
	const priorByTeam = ([0, 1] as const).map((i) =>
		seasonGames
			.filter(
				(x) =>
					x.gid !== game.gid &&
					sideOf(x, game.teams[i].tid) !== undefined &&
					isBefore(x, game),
			)
			.sort((a, b) => (isBefore(a, b) ? -1 : 1)),
	) as [Game[], Game[]];
	return { game, seasonGames, teamSeasons, priorByTeam, allStar };
};

// Before the game: each team's expected margin against an average team (Power Rankings and Season Odds' team strength,
// seasonOdds/strength.ts) from its rating at tip-off (the box score's team ovr, as the user's scouts see the players) and the margin it
// had played to in its earlier games this season
export const pregameStrength = (ctx: SeasonContext) => {
	const { game } = ctx;
	const strengths = ([0, 1] as const).map((i) => {
		const tid = game.teams[i].tid;
		let gp = 0;
		let margin = 0;
		for (const x of ctx.priorByTeam[i]) {
			const side = sideOf(x, tid)!;
			gp += 1;
			margin += x.teams[side].pts - x.teams[1 - side]!.pts;
		}
		const ovr = typeof game.teams[i].ovr === "number" ? game.teams[i].ovr : 50;
		const s = teamStrength({
			ovr,
			mov: gp > 0 ? margin / gp : 0,
			gp,
			playoffOvr: !!game.playoffs,
		});
		return {
			tid,
			ovr,
			gp,
			mov: gp > 0 ? r1(margin / gp) : 0,
			strength: r1(s.strength),
			rosterPart: r1(s.roster),
			resultsPart: r1(s.results),
			resultsWeight: r3(s.w),
		};
	});
	const neutral = !!game.neutralSite || ctx.allStar;
	const hca = neutral ? 0 : 2.5 * (g.get("homeCourtAdvantage") ?? 1);
	const spread = strengths[0]!.strength - strengths[1]!.strength + hca;
	return {
		teams: strengths,
		homeCourt: r1(hca),
		// Expected home margin (negative: the visitors are favored)
		spread: r1(spread),
		homeWinProb: r3(winProb(spread)),
		// The raw spread, unrounded, for the win probability timeline
		spreadExact: spread,
	};
};

const confDivNames = (season: number) => {
	const confs = new Map(g.get("confs", season).map((c) => [c.cid, c.name]));
	const divs = new Map(g.get("divs", season).map((d) => [d.did, d.name]));
	return { confs, divs };
};

export const buildStakes = (
	ctx: SeasonContext,
	strength: ReturnType<typeof pregameStrength>,
) => {
	const { game } = ctx;
	const otlOn = !!g.get("otl", game.season);
	const playoffs = !!game.playoffs;

	// Every team's regular season record before this game's day (playoffs: the final regular season standings)
	const recs = new Map<number, Rec>();
	for (const x of ctx.seasonGames) {
		if (x.playoffs || x.teams[0].tid < 0 || x.teams[1].tid < 0) {
			continue;
		}
		if (!playoffs) {
			const before =
				x.day !== undefined && game.day !== undefined
					? x.day < game.day
					: x.gid < game.gid;
			if (!before) {
				continue;
			}
		}
		for (const side of [0, 1] as const) {
			const tid = x.teams[side].tid;
			const r = recs.get(tid) ?? emptyRec();
			addResult(r, resultFor(x, side, otlOn));
			recs.set(tid, r);
		}
	}
	const { confs, divs } = confDivNames(game.season);
	const gb = (a: Rec, b: Rec) => (a.won - b.won + (b.lost - a.lost)) / 2;

	const teams = ([0, 1] as const).map((i) => {
		const tid = game.teams[i].tid;
		const ts = ctx.teamSeasons.get(tid);
		const prior = ctx.priorByTeam[i];
		const sameType = prior.filter((x) => !!x.playoffs === playoffs);
		// Own record before the game: from the box score (after the game) less this game, which works even where other games are gone
		const after = game.teams[i] as any;
		const res = resultFor(game, i, otlOn);
		const rec: Rec = {
			won: after.won ?? 0,
			lost: after.lost ?? 0,
			tied: after.tied ?? 0,
			otl: after.otl ?? 0,
		};
		if (!playoffs) {
			if (res === "W") {
				rec.won -= 1;
			} else if (res === "T") {
				rec.tied -= 1;
			} else if (res === "OTL") {
				rec.otl -= 1;
			} else {
				rec.lost -= 1;
			}
		}
		// Streak coming in (regular season games, or this postseason's games)
		let streak = 0;
		for (const x of sameType.toReversed()) {
			const r = resultFor(x, sideOf(x, tid)!, otlOn);
			const w = r === "W" ? 1 : r === "T" ? 0 : -1;
			if (w === 0 || (streak !== 0 && Math.sign(streak) !== w)) {
				break;
			}
			streak += w;
		}
		// Last ten
		const lastTen = emptyRec();
		for (const x of sameType.slice(-10)) {
			addResult(lastTen, resultFor(x, sideOf(x, tid)!, otlOn));
		}

		// Standings: conference and division rank by winning percentage (no tiebreakers), games back of the leader
		let standings = null;
		if (ts) {
			const own = recs.get(tid) ?? rec;
			const all = [...ctx.teamSeasons.values()].filter((x) => x.tid >= 0);
			const inConf = all.filter((x) => x.cid === ts.cid);
			const inDiv = all.filter((x) => x.did === ts.did);
			const rankIn = (list: TeamSeason[]) => {
				const p = pct(own);
				return (
					1 +
					list.filter(
						(x) => x.tid !== tid && pct(recs.get(x.tid) ?? emptyRec()) > p,
					).length
				);
			};
			const leaderOf = (list: TeamSeason[]) =>
				list
					.map((x) => recs.get(x.tid) ?? emptyRec())
					.sort((a, b) => pct(b) - pct(a))[0];
			const confLeader = leaderOf(inConf);
			const divLeader = leaderOf(inDiv);
			standings = {
				conf: confs.get(ts.cid) ?? null,
				div: divs.get(ts.did) ?? null,
				confRank: rankIn(inConf),
				confTeams: inConf.length,
				divRank: rankIn(inDiv),
				divTeams: inDiv.length,
				leagueRank: rankIn(all),
				leagueTeams: all.length,
				confGamesBack: confLeader ? gb(confLeader, own) : 0,
				divGamesBack: divLeader ? gb(divLeader, own) : 0,
			};
		}
		return {
			tid,
			gameNumber: sameType.length + 1,
			seasonGameNumber: prior.length + 1,
			record: recText(rec),
			won: rec.won,
			lost: rec.lost,
			...(rec.tied > 0 ? { tied: rec.tied } : {}),
			...(rec.otl > 0 ? { otl: rec.otl } : {}),
			winPct: r3(pct(rec)),
			streak:
				streak === 0 ? "" : `${streak > 0 ? "W" : "L"}${Math.abs(streak)}`,
			lastTen: recText(lastTen),
			standings,
			result: res,
		};
	});
	const numGames = g.get("numGames", game.season);
	return {
		season: game.season,
		day: game.day ?? null,
		phase: ctx.allStar ? "allStar" : playoffs ? "playoffs" : "regularSeason",
		seasonGames: numGames,
		teams,
		winProbability: {
			home: strength.homeWinProb,
			away: r3(1 - strength.homeWinProb),
			spread: strength.spread,
			homeCourt: strength.homeCourt,
			model:
				"Season Odds' team strength (seasonOdds/strength.ts) before the game: the box score's team rating at tip-off blended with the margin played to so far, plus home court; logistic win probability with scale 6.5.",
			teams: strength.teams,
		},
	};
};

export const buildSeries = async (ctx: SeasonContext) => {
	const { game } = ctx;
	if (!game.playoffs) {
		return { value: null, reason: "Not a playoff game." };
	}
	const numToWin = game.numGamesToWinSeries;
	const info = [game.teams[0], game.teams[1]].map(
		(t) =>
			(t as any).playoffs as
				| { seed: number; won: number; lost: number }
				| undefined,
	);
	if (!info[0] || !info[1] || numToWin === undefined) {
		return {
			value: null,
			reason:
				"This playoff game has no series stored with it (a play-in game, or an older game).",
		};
	}
	const w = getWinner(game.teams);
	// Series wins before the game
	const before = [
		info[0].won - (w === 0 ? 1 : 0),
		info[1].won - (w === 1 ? 1 : 0),
	] as [number, number];
	const state = seriesGameState({
		homeWon: before[0],
		awayWon: before[1],
		numToWin,
	});
	const last = numToWin - 1;
	let storylines: { kind: string; text: string }[] = [];
	try {
		if (game.teams[0].tid >= 0 && game.teams[1].tid >= 0) {
			storylines = (
				await storylinesFor(game.season, game.teams[0].tid, game.teams[1].tid)
			).map((s) => ({ kind: s.kind, text: s.text.replace(/<[^>]*>/g, "") }));
		}
	} catch (error) {
		console.error(error);
	}
	return {
		value: {
			numGamesToWin: numToWin,
			gameNumber: before[0] + before[1] + 1,
			seeds: [info[0].seed, info[1].seed],
			before,
			after: [info[0].won, info[1].won],
			kind: state.kind,
			deciding: state.kind === "decider",
			game7: state.kind === "decider" && numToWin === 4,
			canClinch: [before[0] === last, before[1] === last],
			facingElimination: [before[1] === last, before[0] === last],
			clinched: [info[0].won >= numToWin, info[1].won >= numToWin],
			urgency: state.urgency,
			storylines,
		},
	};
};

export const buildScheduleLoad = (ctx: SeasonContext) => {
	const { game } = ctx;
	const venueRegion =
		game.neutralSite || ctx.allStar
			? undefined
			: ctx.teamSeasons.get(game.teams[0].tid)?.region;
	return ([0, 1] as const).map((i) => {
		const tid = game.teams[i].tid;
		const prior = ctx.priorByTeam[i];
		const prev = prior.at(-1);
		const day = game.day;
		const prevDay = prev?.day;
		const daysSince =
			day !== undefined && prevDay !== undefined ? day - prevDay : null;
		const prev2 = prior.at(-2)?.day;
		// The previous game's city: its home team's region that season (as the sim's travel, teamSeason.lastGameSite, which counts a
		// neutral site game as the home team's city too)
		const prevSite = prev
			? ctx.teamSeasons.get(prev.teams[0].tid)?.region
			: undefined;
		const homeRegion = ctx.teamSeasons.get(tid)?.region;
		const from = prevSite ?? homeRegion;
		const km =
			from !== undefined && venueRegion !== undefined
				? from === venueRegion
					? 0
					: travelDistance(from, venueRegion)
				: undefined;
		const last7 =
			day !== undefined
				? prior.filter((x) => x.day !== undefined && x.day >= day - 7).length
				: null;
		// Home stand or road trip: consecutive games at home (or away), through this game and after it
		const home = i === 0 && !game.neutralSite;
		const teamGames = ctx.seasonGames
			.filter(
				(x) => sideOf(x, tid) !== undefined && !!x.playoffs === !!game.playoffs,
			)
			.sort((a, b) => (isBefore(a, b) ? -1 : 1));
		const idx = teamGames.findIndex((x) => x.gid === game.gid);
		const isHome = (x: Game) => sideOf(x, tid) === 0 && !x.neutralSite;
		let start = idx;
		while (start > 0 && isHome(teamGames[start - 1]!) === home) {
			start -= 1;
		}
		let endIdx = idx;
		while (
			endIdx < teamGames.length - 1 &&
			isHome(teamGames[endIdx + 1]!) === home
		) {
			endIdx += 1;
		}
		return {
			tid,
			lastGameDay: prevDay ?? null,
			restDays: daysSince === null ? null : Math.max(0, daysSince - 1),
			backToBack: daysSince === 1,
			threeInFour:
				day !== undefined &&
				prevDay !== undefined &&
				prev2 !== undefined &&
				prev2 >= day - 3,
			gamesInLast7Days: last7,
			travel: {
				from: from ?? null,
				to: venueRegion ?? null,
				km: km === undefined ? null : Math.round(km),
				fromPreviousGame: prevSite !== undefined,
			},
			stand: {
				kind:
					game.neutralSite || ctx.allStar
						? "neutral"
						: home
							? "homeStand"
							: "roadTrip",
				gameNumber: idx - start + 1,
				length: endIdx - start + 1,
			},
		};
	});
};

export const buildHeadToHead = async (ctx: SeasonContext) => {
	const { game } = ctx;
	const [a, b] = [game.teams[0].tid, game.teams[1].tid];
	if (ctx.allStar) {
		return { value: null, reason: "All-Star Game." };
	}
	const meetings = ctx.seasonGames
		.filter(
			(x) =>
				x.gid !== game.gid &&
				isBefore(x, game) &&
				sideOf(x, a) !== undefined &&
				sideOf(x, b) !== undefined,
		)
		.sort((x, y) => (isBefore(x, y) ? -1 : 1));
	const otlOn = !!g.get("otl", game.season);
	const seasonSeries = [emptyRec(), emptyRec()];
	for (const x of meetings.filter((m) => !!m.playoffs === !!game.playoffs)) {
		addResult(seasonSeries[0]!, resultFor(x, sideOf(x, a)!, otlOn));
		addResult(seasonSeries[1]!, resultFor(x, sideOf(x, b)!, otlOn));
	}
	let last: Game | undefined = meetings.at(-1);
	if (!last) {
		try {
			const prevSeason = await idb.merged.games.getAll(
				{ season: game.season - 1 },
				{
					filter: (x) =>
						sideOf(x, a) !== undefined && sideOf(x, b) !== undefined,
				},
			);
			last = prevSeason.sort((x, y) => (isBefore(x, y) ? -1 : 1)).at(-1);
		} catch (error) {
			console.error(error);
		}
	}
	let rivalry = null;
	try {
		const pairs = await loadRivalries(game.season, { storedGames: false });
		const pair = pairs.find((p) => p.key === pairKey(a, b));
		if (pair) {
			const flip = pair.a !== a;
			rivalry = {
				tier: pair.score.tier,
				score: r1(pair.score.score),
				playoffSeriesWon: flip
					? [pair.seriesB, pair.seriesA]
					: [pair.seriesA, pair.seriesB],
				finalsMeetings: pair.finals,
				regularSeasonWon: flip ? [pair.rsB, pair.rsA] : [pair.rsA, pair.rsB],
				lastPlayoffMeeting: pair.lastMet,
				asOf: "export",
			};
		}
	} catch (error) {
		console.error(error);
	}
	return {
		value: {
			seasonSeries: seasonSeries.map(recText),
			meetingsThisSeason: meetings.length,
			lastMeeting: last
				? {
						gid: last.gid,
						season: last.season,
						day: last.day ?? null,
						playoffs: !!last.playoffs,
						home: last.teams[0].tid,
						score: [last.teams[0].pts, last.teams[1].pts],
						winner: (() => {
							const w = getWinner(last.teams);
							return w === -1 || w === undefined ? null : last.teams[w].tid;
						})(),
					}
				: null,
			rivalryGame: !!game.rivalry,
			rivalry,
		},
	};
};

export const buildVenue = (ctx: SeasonContext) => {
	const { game } = ctx;
	const home = ctx.teamSeasons.get(game.teams[0].tid);
	const marquee = game.marquee;
	let crowdBoost = marqueeCrowdBoost({ marquee, rivalry: game.rivalry });
	if (game.playoffs && game.numGamesToWinSeries !== undefined) {
		const info = [game.teams[0], game.teams[1]].map((t) => (t as any).playoffs);
		if (info[0] && info[1]) {
			const w = getWinner(game.teams);
			crowdBoost += seriesGameState({
				homeWon: info[0].won - (w === 0 ? 1 : 0),
				awayWon: info[1].won - (w === 1 ? 1 : 0),
				numToWin: game.numGamesToWinSeries,
			}).crowdBoost;
		}
	}
	return {
		arena: null,
		city: ctx.allStar || game.neutralSite ? null : (home?.region ?? null),
		event: ctx.allStar
			? "allStarGame"
			: game.playoffs
				? game.finals
					? "finals"
					: "playoffs"
				: "regularSeason",
		neutralSite: !!game.neutralSite || ctx.allStar,
		attendance: game.att ?? null,
		capacity: home?.stadiumCapacity ?? null,
		marquee: marquee ? { kind: marquee, label: MARQUEE_LABELS[marquee] } : null,
		rivalryGame: !!game.rivalry,
		bigGame: !!marquee || !!game.rivalry || !!game.playoffs || ctx.allStar,
		crowdBoost: r3(crowdBoost),
		homeHype: home && !ctx.allStar ? r3(home.hype) : null,
	};
};
