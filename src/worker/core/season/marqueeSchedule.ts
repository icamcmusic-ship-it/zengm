// Marquee Games (the marqueeGames League Extras setting, with the realistic schedule length): after the realistic schedule is built
// (groupScheduleRealistic.ts), the best and most hyped matchups are moved onto holiday slates on fixed days of the season (an opening
// night doubleheader with the defending champion at home, a Christmas slate of 5 games, an MLK Day slate of 4), rivalry games are
// spread over the season instead of bunched, and 2-4 games a week are picked for national TV. Games only move by single moves and
// day swaps of the schedule editor (scheduleEditor.ts), so the rest rules hold: never 3 days in a row, back-to-backs kept, few 3-in-4s.
import {
	HOLIDAY_DAYS,
	type GameMarquee,
	type MarqueeKind,
} from "../../../common/marquee.ts";
import { travelDistance } from "../GameSim.basketball/scheduleLoad.ts";
import { createScheduleEditor } from "./scheduleEditor.ts";

export type MarqueeInput = {
	teams: {
		tid: number;
		// How much a team draws, 0 to 1: its strength (team ovr) and hype
		draw: number;
		region?: string;
	}[];
	// Last season's champion, opening night's home team
	champion?: number;
	// Rivalry scores (common/rivalries) of pairs of teams, any order
	rivalries: { a: number; b: number; score: number }[];
};

// Rivalries: pairs at Simmering or more, and each team's top rival (the best score of at least RIVAL_MIN_SCORE, so a division rival in
// a new league, the closest one)
const RIVAL_SCORE = 10;
const RIVAL_MIN_SCORE = 3;

// Slates
const OPENING_NIGHT_GAMES = 2;
const CHRISTMAS_GAMES = 5;
const MLK_GAMES = 4;
// National TV games per week (holiday slates count for their week)
const NATIONAL_TV_PER_WEEK = 3;
// Each team's national TV games after the first few count against it, so the same teams are not on every week
const TV_REPEAT_PENALTY = 0.12;
// At most this share of a team's games are national TV games (holidays included). Never reached in a 30-team league (at most about
// 11 of 82); it keeps tiny leagues (2-6 teams) from having almost every game on national TV
const TV_MAX_SHARE = 0.15;

// How much worse the rest pattern may get to put a game on a holiday (a 3-in-4 costs 10, never 3 days in a row)
const HOLIDAY_MAX_DELTA = 12;
// Days a game on an exclusive holiday (opening night, Christmas) may move to make room
const EVICT_WINDOW = 4;

export const pairKey = (a: number, b: number) =>
	a < b ? `${a}-${b}` : `${b}-${a}`;

export type HolidayKind = Exclude<MarqueeKind, "nationalTv">;

export type HolidaySlate = {
	kind: HolidayKind;
	day: number;
	numGames: number;
	// The holiday's games are the only games that day (opening night, Christmas)
	exclusive: boolean;
	// No games the day before (Christmas Eve), so every team is rested and the best matchups can be picked
	offDayBefore?: boolean;
};

// The days groupScheduleRealistic keeps light (at most numGames games) for the exclusive slates, with their priority
export const getSlateCaps = (
	slates: HolidaySlate[],
	tids: readonly (readonly [number, number])[],
	input: MarqueeInput,
) =>
	slates
		.filter((slate) => slate.exclusive)
		.flatMap((slate) => [
			{
				day: slate.day,
				numGames: slate.numGames,
				priority: getSlatePriority(tids, input, slate.kind),
			},
			...(slate.offDayBefore && slate.day > 1
				? [{ day: slate.day - 1, numGames: 0 }]
				: []),
		]);

// The holiday slates of a season with this many games per team: fixed days for an 82-game season of about 171 days (common/marquee),
// scaled down for shorter seasons (the expected length, as in groupScheduleRealistic)
export const getHolidaySlates = (
	numGames: number,
	expectedLength: number,
): HolidaySlate[] => {
	const scale = Math.min(1, expectedLength / HOLIDAY_DAYS.seasonLength);
	const out: HolidaySlate[] = [
		{
			kind: "openingNight",
			day: HOLIDAY_DAYS.openingNight,
			numGames: OPENING_NIGHT_GAMES,
			exclusive: true,
		},
	];
	if (numGames >= 10 && expectedLength >= 20) {
		out.push(
			{
				kind: "christmas",
				day: Math.max(2, Math.round(HOLIDAY_DAYS.christmas * scale)),
				numGames: CHRISTMAS_GAMES,
				exclusive: true,
				offDayBefore: true,
			},
			{
				kind: "mlk",
				day: Math.max(3, Math.round(HOLIDAY_DAYS.mlk * scale)),
				numGames: MLK_GAMES,
				exclusive: false,
			},
		);
	}
	return out;
};

// The rivalry pairs of a league, by pairKey, with their scores
export const getRivalPairs = (input: MarqueeInput) => {
	const scores = new Map<string, number>();
	for (const { a, b, score } of input.rivalries) {
		if (a !== b && a >= 0 && b >= 0) {
			scores.set(pairKey(a, b), score);
		}
	}
	const out = new Map<string, number>();
	for (const [key, score] of scores) {
		if (score >= RIVAL_SCORE) {
			out.set(key, score);
		}
	}
	const regionOf = new Map(input.teams.map((t) => [t.tid, t.region]));
	for (const t of input.teams) {
		let best: { key: string; score: number; km: number } | undefined;
		for (const u of input.teams) {
			if (u.tid === t.tid) {
				continue;
			}
			const key = pairKey(t.tid, u.tid);
			const score = scores.get(key) ?? 0;
			if (score < RIVAL_MIN_SCORE) {
				continue;
			}
			const km =
				travelDistance(regionOf.get(t.tid), regionOf.get(u.tid)) ?? 1e9;
			if (
				!best ||
				score > best.score + 1e-9 ||
				(Math.abs(score - best.score) <= 1e-9 && km < best.km)
			) {
				best = { key, score, km };
			}
		}
		if (best) {
			out.set(best.key, best.score);
		}
	}
	return out;
};

// How marquee a matchup is: both teams' draw (the weaker one counts extra, two good teams beat one great and one bad), rivalry and the
// defending champion
const makePairScore = (input: MarqueeInput, rivals: Map<string, number>) => {
	const draw = new Map(input.teams.map((t) => [t.tid, t.draw]));
	return (home: number, away: number) => {
		const dh = draw.get(home) ?? 0;
		const da = draw.get(away) ?? 0;
		let score = dh + da + 0.5 * Math.min(dh, da);
		const rival = rivals.get(pairKey(home, away));
		if (rival !== undefined) {
			score += 0.3 + 0.4 * Math.min(1, rival / 40);
		}
		if (
			input.champion !== undefined &&
			(home === input.champion || away === input.champion)
		) {
			score += 0.3;
		}
		return score;
	};
};

// The order in which groupScheduleRealistic fills an exclusive holiday slate: the most marquee matchups first, and on opening night the
// champion's home games before everything
export const getSlatePriority = (
	tids: readonly (readonly [number, number])[],
	input: MarqueeInput,
	kind: HolidayKind,
) => {
	const pairScore = makePairScore(input, getRivalPairs(input));
	return tids.map(
		([home, away]) =>
			pairScore(home, away) +
			(kind === "openingNight" && home === input.champion ? 10 : 0),
	);
};

export type MarqueeScheduleOutput = {
	tids: [number, number][];
	days: number[];
	marquee: (GameMarquee | undefined)[];
	holidays: Partial<Record<Exclude<MarqueeKind, "nationalTv">, number>>;
};

const marqueeSchedule = (
	tids: readonly (readonly [number, number])[],
	days: readonly number[],
	input: MarqueeInput,
	// The holiday slates (getHolidaySlates), the same that groupScheduleRealistic kept light
	slates: HolidaySlate[],
): MarqueeScheduleOutput => {
	const editor = createScheduleEditor(tids, days);
	const { gameDays, pinned, blocked } = editor;
	const lastDay = Math.max(0, ...days);

	const rivals = getRivalPairs(input);
	const champion = input.champion;
	const pairScore = makePairScore(input, rivals);

	const isGame = (i: number) => tids[i]![0] >= 0 && tids[i]![1] >= 0;
	const gameIndexes = tids.map((_, i) => i).filter(isGame);
	const scoreOf = new Map(
		gameIndexes.map((i) => [i, pairScore(tids[i]![0], tids[i]![1])]),
	);
	const byScore = [...gameIndexes].sort(
		(a, b) => scoreOf.get(b)! - scoreOf.get(a)! || a - b,
	);

	const kinds = new Map<number, MarqueeKind>();
	// A matchup is on at most one holiday slate
	const holidayPairs = new Set<string>();

	// The holiday's day, moved off the All-Star break and the trade deadline if needed
	const holidayDay = (target: number) => {
		for (let step = 0; step < lastDay; step++) {
			for (const d of [target + step, target - step]) {
				if (
					d >= 1 &&
					d <= lastDay &&
					!blocked[d] &&
					editor.gamesPerDay[d]! > 0
				) {
					return d;
				}
			}
		}
		return undefined;
	};

	// Put game i on day "to": already there, a swap with a game of one of its teams on that day, or a move (after moving the games in
	// the way)
	const place = (i: number, to: number) => {
		if (gameDays[i] === to) {
			return true;
		}
		if (pinned.has(i)) {
			return false;
		}
		let bestSwap = -1;
		let bestDelta = HOLIDAY_MAX_DELTA;
		for (const tid of tids[i]!) {
			const j = editor.teamGameOnDay.get(tid)!.get(to);
			if (j === undefined) {
				continue;
			}
			// Both teams busy that day in different games: a swap would leave one of them playing twice
			const other = editor.teamGameOnDay
				.get(tids[i]![tid === tids[i]![0] ? 1 : 0])!
				.get(to);
			if (other !== undefined && other !== j) {
				bestSwap = -1;
				break;
			}
			const delta = editor.swapDelta(i, j);
			if (delta !== undefined && delta < bestDelta) {
				bestDelta = delta;
				bestSwap = j;
			}
		}
		const moveDelta = editor.canMove(i, to)
			? editor.moveDelta(i, to)
			: Infinity;
		if (bestSwap >= 0 && bestDelta <= moveDelta) {
			editor.swap(i, bestSwap);
			return true;
		}
		if (moveDelta < HOLIDAY_MAX_DELTA) {
			editor.move(i, to);
			return true;
		}
		return editor.tryChainMove(i, to, EVICT_WINDOW, HOLIDAY_MAX_DELTA);
	};

	// A slate: the best matchups (each team once), moved onto the day and pinned there. Exclusive: the other games of the day move to
	// nearby days where they can
	const slate = (
		kind: Exclude<MarqueeKind, "nationalTv">,
		day: number,
		numGames: number,
		exclusive: boolean,
		candidates: number[] = byScore,
	) => {
		const used = new Set<number>();
		const chosen: number[] = [];
		// An exclusive slate was filled by groupScheduleRealistic: its games first
		const onDay = exclusive
			? candidates.filter((i) => gameDays[i] === day)
			: [];
		for (const i of [...onDay, ...candidates]) {
			if (chosen.length >= numGames) {
				break;
			}
			const [home, away] = tids[i]!;
			const key = pairKey(home, away);
			if (
				used.has(home) ||
				used.has(away) ||
				pinned.has(i) ||
				kinds.has(i) ||
				holidayPairs.has(key)
			) {
				continue;
			}
			if (place(i, day)) {
				pinned.add(i);
				kinds.set(i, kind);
				chosen.push(i);
				used.add(home);
				used.add(away);
				holidayPairs.add(key);
			}
		}
		if (exclusive) {
			// Better matchups that couldn't be placed: swap days with the weakest game of the slate, if the rest pattern allows
			for (const i of candidates) {
				const [home, away] = tids[i]!;
				const key = pairKey(home, away);
				if (
					gameDays[i] === day ||
					pinned.has(i) ||
					kinds.has(i) ||
					holidayPairs.has(key)
				) {
					continue;
				}
				const weakestFirst = [...chosen].sort(
					(a, b) => scoreOf.get(a)! - scoreOf.get(b)!,
				);
				if (
					weakestFirst.length === 0 ||
					scoreOf.get(i)! <= scoreOf.get(weakestFirst[0]!)!
				) {
					break;
				}
				for (const e of weakestFirst) {
					if (scoreOf.get(i)! <= scoreOf.get(e)!) {
						break;
					}
					const freed = tids[e]!;
					if (
						(used.has(home) && !freed.includes(home)) ||
						(used.has(away) && !freed.includes(away))
					) {
						continue;
					}
					pinned.delete(e);
					const delta = editor.swapDelta(i, e);
					if (delta === undefined || delta >= HOLIDAY_MAX_DELTA) {
						pinned.add(e);
						continue;
					}
					editor.swap(i, e);
					kinds.delete(e);
					holidayPairs.delete(pairKey(freed[0], freed[1]));
					used.delete(freed[0]);
					used.delete(freed[1]);
					chosen.splice(chosen.indexOf(e), 1, i);
					pinned.add(i);
					kinds.set(i, kind);
					used.add(home);
					used.add(away);
					holidayPairs.add(key);
					break;
				}
			}

			for (const i of gameIndexes) {
				if (gameDays[i] !== day || pinned.has(i)) {
					continue;
				}
				let best = { day: -1, delta: HOLIDAY_MAX_DELTA };
				for (let step = 1; step <= EVICT_WINDOW; step++) {
					for (const to of [day + step, day - step]) {
						if (editor.canMove(i, to)) {
							const delta = editor.moveDelta(i, to);
							if (delta < best.delta) {
								best = { day: to, delta };
							}
						}
					}
				}
				if (best.day >= 0) {
					editor.move(i, best.day);
				} else {
					for (let step = 1; step <= EVICT_WINDOW; step++) {
						if (
							editor.tryChainMove(
								i,
								day + step,
								EVICT_WINDOW,
								HOLIDAY_MAX_DELTA,
							)
						) {
							break;
						}
					}
				}
			}
		}
		return chosen;
	};

	const holidays: MarqueeScheduleOutput["holidays"] = {};
	const usedDays = new Set<number>();
	for (const holiday of slates) {
		const day = holidayDay(holiday.day);
		if (day === undefined || usedDays.has(day)) {
			continue;
		}
		usedDays.add(day);
		holidays[holiday.kind] = day;
		let numGames = holiday.numGames;
		if (holiday.kind === "openingNight" && champion !== undefined) {
			// The champion at home first (ring night), against the best opponent that can make it
			numGames -= slate(
				holiday.kind,
				day,
				1,
				false,
				byScore.filter((i) => tids[i]![0] === champion),
			).length;
		}
		slate(holiday.kind, day, numGames, holiday.exclusive);
		if (holiday.exclusive) {
			editor.dayCap.set(day, holiday.numGames);
			if (holiday.offDayBefore && day === holiday.day && day > 1) {
				editor.dayCap.set(day - 1, 0);
			}
		}
	}

	// Moves and swaps may have left a few 3-in-4s; the pinned holiday games stay
	editor.repairThreeInFour(12);

	const schedule = editor.getSchedule();

	// National TV: the best matchups of each week (not two on one day, and not the same teams every week), on top of the holiday slates
	const tvCount = new Map<number, number>();
	const numGamesByTid = new Map<number, number>();
	for (const i of gameIndexes) {
		for (const tid of tids[i]!) {
			numGamesByTid.set(tid, (numGamesByTid.get(tid) ?? 0) + 1);
		}
	}
	const atTvCap = (tid: number) =>
		(tvCount.get(tid) ?? 0) >=
		Math.ceil(TV_MAX_SHARE * (numGamesByTid.get(tid) ?? 0));
	for (const [i] of kinds) {
		for (const tid of tids[i]!) {
			tvCount.set(tid, (tvCount.get(tid) ?? 0) + 1);
		}
	}
	for (let weekStart = 1; weekStart <= lastDay; weekStart += 7) {
		const weekEnd = Math.min(lastDay, weekStart + 6);
		const inWeek = gameIndexes.filter(
			(i) => gameDays[i]! >= weekStart && gameDays[i]! <= weekEnd,
		);
		if (inWeek.length === 0) {
			continue;
		}
		const holidayGames = inWeek.filter((i) => kinds.has(i)).length;
		const numDays = weekEnd - weekStart + 1;
		let numTv =
			Math.round((NATIONAL_TV_PER_WEEK * numDays) / 7) -
			Math.min(1, holidayGames);
		const daysUsed = new Set<number>();
		for (const i of inWeek) {
			if (kinds.has(i)) {
				daysUsed.add(gameDays[i]!);
			}
		}
		while (numTv > 0) {
			let best = { i: -1, value: -Infinity };
			for (const i of inWeek) {
				if (kinds.has(i) || daysUsed.has(gameDays[i]!)) {
					continue;
				}
				const [home, away] = tids[i]!;
				if (atTvCap(home) || atTvCap(away)) {
					continue;
				}
				const value =
					scoreOf.get(i)! -
					TV_REPEAT_PENALTY *
						(Math.max(0, (tvCount.get(home) ?? 0) - 2) +
							Math.max(0, (tvCount.get(away) ?? 0) - 2));
				if (value > best.value) {
					best = { i, value };
				}
			}
			if (best.i < 0) {
				break;
			}
			kinds.set(best.i, "nationalTv");
			daysUsed.add(gameDays[best.i]!);
			for (const tid of tids[best.i]!) {
				tvCount.set(tid, (tvCount.get(tid) ?? 0) + 1);
			}
			numTv -= 1;
		}
	}

	const marquee = schedule.order.map((i): GameMarquee | undefined => {
		if (!isGame(i)) {
			return undefined;
		}
		const kind = kinds.get(i);
		const rivalry = rivals.has(pairKey(tids[i]![0], tids[i]![1]));
		if (kind === undefined && !rivalry) {
			return undefined;
		}
		return {
			...(kind !== undefined ? { marquee: kind } : {}),
			...(rivalry ? { rivalry: true } : {}),
		};
	});

	return {
		tids: schedule.tids,
		days: schedule.days,
		marquee,
		holidays,
	};
};

export default marqueeSchedule;
