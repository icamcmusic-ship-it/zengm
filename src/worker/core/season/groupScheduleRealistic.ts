// Realistic schedule length (the realisticSchedule League Extras setting, basketball): spread the regular season over
// about 2 calendar days per game per team (82 games in ~172 days), instead of having every team play almost every day.
// Each day is a set of games between teams that are rested enough:
// - never 3 days in a row
// - about 15 back-to-backs per 82 games (it varies a bit by team), the rest of the gaps are 1-3 days off
// - 3 games in 4 nights only for a team far behind schedule, mostly in the last weeks, and then a repair pass
//   (scheduleEditor.ts) moves single games to nearby days to remove most of them: about 0.6 per team per 82 games
// - an All-Star break (a few days with no games and the All-Star Game in the middle) and the trade deadline on its own day
// - home/away runs (road trips and homestands) when the remaining matchups allow it
// Days are numbered from 1. Days with no games can be skipped (the All-Star break), the game loop never sees them.

import { createScheduleEditor } from "./scheduleEditor.ts";

// Calendar days per game per team, including the All-Star break and the trade deadline (the last few games usually
// run a little past this)
const DAYS_PER_GAME = 2;

// Back-to-backs per game, NBA-like: ~14 in 82 games
const B2B_PER_GAME = 14 / 82;

// Scoring of teams that could play today (higher plays first). Tuned for NBA-like rest patterns, see the tests.
// Pace: how far ahead or behind the team is (remaining games per remaining day, 0.5 is on pace)
const PACE_WEIGHT = 4;
const RANDOMNESS = 0.3;
// Second night of a back-to-back
const B2B_PENALTY = 0.3;
// Back-to-backs are spread over the season: a team behind its share so far is more willing
const B2B_PACE_WEIGHT = 0.3;
// Rested teams are eager to play
const REST_2_DAYS_BONUS = 0.4;
const REST_3_DAYS_BONUS = 0.8;
// At most this many games per team per day, on average over the league. More would put most teams on the same
// every-other-day rhythm with nearly empty days in between.
const MAX_RATE = 0.55;
// Remaining games per remaining day above which a rested team plays even when the day is full. Lower in small
// leagues, where a day holds only a game or two, so a day that rounds down to no games would leave teams behind
const BEHIND_NEED = 0.6;
const BEHIND_NEED_SMALL_LEAGUE = 0.52;
// A team doesn't play the second night of a back-to-back just because its opponent wants to play
const MIN_PARTNER_SCORE = -0.3;
// After this many days past the target length (the last few games of a season that didn't fit), 3 games in 4 nights
// and extra back-to-backs are allowed, and after OVERTIME_ANYTHING days (or a tenth of the season, if longer) even 3
// days in a row, so it always ends
const OVERTIME_3_IN_4 = 4;
// Remaining games per remaining day above which a team may play 3 games in 4 nights (with a penalty): only a team
// that would otherwise have to play every remaining day
const NEED_3_IN_4 = 1;
const THREE_IN_FOUR_PENALTY = 0.5;
const OVERTIME_ANYTHING = 10;
// The repair after the daily construction: games move up to this many days, and up to this many days per 82 games past
// the target length (with the All-Star break and the trade deadline, about where the season ended before), but at
// most REPAIR_MAX_EXTENSION days past where the daily construction ended
const REPAIR_WINDOW = 12;
const REPAIR_EXTRA_DAYS = 7;
const REPAIR_MAX_EXTENSION = 2;
// Marquee Games: rivals' meetings at least this fraction of the season / their number of meetings apart, or the matchup's value
// goes down by up to this much (the partner choice, where a home/away run is worth 0.15)
const RIVAL_SPREAD = 0.5;
const RIVAL_SPREAD_PENALTY = 1;

export type RealisticScheduleEvents = {
	// Fraction of the season (as in the allStarGame setting), or null for no All-Star Game
	allStarGame: number | null;
	// Fraction of the season (as in the tradeDeadline setting), or null for no trade deadline
	tradeDeadline: number | null;
	// Marquee Games: days kept light for an exclusive holiday slate (at most this many games, unless a team must play), and the
	// rivalry pairs (by "lowTid-highTid"), whose meetings are spread over the season
	slates?: {
		day: number;
		numGames: number;
		// Which matchups (by index in the input) go first that day, if given
		priority?: readonly number[];
	}[];
	rivals?: ReadonlySet<string>;
};

// Days with no games around the All-Star Game (including its own day), by season length
export const getAllStarBreakLength = (numGames: number) =>
	Math.max(1, Math.min(3, Math.round(numGames / 20)));

// The number of days with games (not counting the All-Star break and trade deadline) the season aims for
export const getTargetNumPlayDays = (numGames: number) =>
	Math.max(1, Math.round(DAYS_PER_GAME * numGames));

// About where the season ends (the target and the few days past it the repair pass may use)
export const getExpectedSeasonLength = (numGames: number) =>
	getTargetNumPlayDays(numGames) +
	Math.round((REPAIR_EXTRA_DAYS * numGames) / 82);

const groupScheduleRealistic = (
	tids: [number, number][],
	events: RealisticScheduleEvents,
	random: () => number = Math.random,
) => {
	const allTids = Array.from(new Set(tids.flat())).sort((a, b) => a - b);
	const index = new Map<number, number>();
	for (const [i, tid] of allTids.entries()) {
		index.set(tid, i);
	}
	const numTeams = allTids.length;

	// Remaining matchups, by team index
	const matchupsByTeam: number[][] = allTids.map(() => []);
	for (const [i, [home, away]] of tids.entries()) {
		matchupsByTeam[index.get(home)!]!.push(i);
		matchupsByTeam[index.get(away)!]!.push(i);
	}
	const used = new Uint8Array(tids.length);

	// Marquee Games: meetings of each rivalry pair, and the day of their last one
	const rivalKey = (a: number, b: number) =>
		a < b ? `${a}-${b}` : `${b}-${a}`;
	const rivalMeetings = new Map<string, number>();
	const rivalLastMeeting = new Map<string, number>();
	if (events.rivals) {
		for (const [home, away] of tids) {
			const key = rivalKey(home, away);
			if (events.rivals.has(key)) {
				rivalMeetings.set(key, (rivalMeetings.get(key) ?? 0) + 1);
			}
		}
	}
	const slateCap = new Map<number, number>();
	const slatePriority = new Map<number, readonly number[]>();
	const slatePairs = new Set<string>();
	for (const { day, numGames, priority } of events.slates ?? []) {
		slateCap.set(day, numGames);
		if (priority) {
			slatePriority.set(day, priority);
		}
	}

	const rem = matchupsByTeam.map((list) => list.length);
	const numGamesByTeam = [...rem];
	const maxGames = Math.max(0, ...rem);

	const breakLength = getAllStarBreakLength(maxGames);
	const numPlayDaysTarget = Math.max(
		1,
		getTargetNumPlayDays(maxGames) -
			(events.allStarGame !== null ? breakLength : 0) -
			(events.tradeDeadline !== null ? 1 : 0) +
			// Marquee Games: the days kept light for a holiday slate (and Christmas Eve) add up to about this many days without games
			Math.round(
				(events.slates ?? []).reduce(
					(sum, { numGames }) =>
						sum + Math.max(0, 1 - numGames / ((numTeams * MAX_RATE) / 2)),
					0,
				),
			),
	);

	// Each team's back-to-back budget (some teams get a few more than others, as in the NBA)
	const b2bBudget = rem.map((n) =>
		Math.round(n * B2B_PER_GAME * (0.8 + 0.4 * random())),
	);
	const b2b = new Array<number>(numTeams).fill(0);
	// The two most recent game days of each team
	const last1 = new Array<number>(numTeams).fill(-Infinity);
	const last2 = new Array<number>(numTeams).fill(-Infinity);
	// Home/away runs: last venue (1 home, 0 away) and how many games in a row there
	const lastHome = new Int8Array(numTeams).fill(-1);
	const venueStreak = new Array<number>(numTeams).fill(0);

	const outTids: [number, number][] = [];
	const outDays: number[] = [];

	// As in the old schedule, an event comes after that fraction of the games
	type Event = { type: "allStarGame" | "tradeDeadline"; afterGames: number };
	const pendingEvents: Event[] = [];
	if (events.tradeDeadline !== null) {
		pendingEvents.push({
			type: "tradeDeadline",
			afterGames: Math.round(events.tradeDeadline * tids.length),
		});
	}
	if (events.allStarGame !== null) {
		pendingEvents.push({
			type: "allStarGame",
			afterGames: Math.round(events.allStarGame * tids.length),
		});
	}
	// Same order as the old schedule when both are at the same point: All-Star Game, then the trade deadline
	pendingEvents.sort((a, b) =>
		a.afterGames !== b.afterGames
			? a.afterGames - b.afterGames
			: a.type === "allStarGame"
				? -1
				: 1,
	);

	let day = 1;
	let playDaysDone = 0;
	let numRemaining = tids.length;

	const emitEvents = (force: boolean) => {
		while (
			pendingEvents.length > 0 &&
			(force || pendingEvents[0]!.afterGames <= tids.length - numRemaining)
		) {
			const event = pendingEvents.shift()!;
			const eventStart = day;
			if (event.type === "tradeDeadline") {
				outTids.push([-3, -3]);
				outDays.push(day);
				day += 1;
			} else {
				outTids.push([-1, -2]);
				outDays.push(day + Math.floor(breakLength / 2));
				day += breakLength;
			}
			moveSlatesOffEvent(eventStart, day);
		}
	};

	// Marquee Games: a holiday slate on a day the trade deadline or the All-Star break took moves to the next day with games, where
	// marqueeSchedule's holidayDay puts the holiday (the first day after the event), so that day is kept light instead. A day kept
	// empty before a holiday (Christmas Eve) that the event took is off anyway.
	const moveSlatesOffEvent = (start: number, end: number) => {
		for (let d = start; d < end; d++) {
			const cap = slateCap.get(d);
			if (cap === undefined) {
				continue;
			}
			slateCap.delete(d);
			const priority = slatePriority.get(d);
			slatePriority.delete(d);
			if (cap > 0 && !slateCap.has(end)) {
				slateCap.set(end, cap);
				if (priority) {
					slatePriority.set(end, priority);
				}
			}
		}
	};

	const score = new Array<number>(numTeams).fill(0);
	const eligible = new Uint8Array(numTeams);
	const usedToday = new Uint8Array(numTeams);

	const overtimeAnything = Math.max(
		OVERTIME_ANYTHING,
		Math.round(numPlayDaysTarget / 10),
	);

	// Safety valve, should never be needed
	const maxDays = numPlayDaysTarget * 4 + tids.length + 100;

	let numToday = 0;
	const playGame = (best: number) => {
		used[best] = 1;
		numRemaining -= 1;
		numToday += 1;
		const [home, away] = tids[best]!;
		if (rivalMeetings.size > 0) {
			rivalLastMeeting.set(rivalKey(home, away), day);
		}
		outTids.push([home, away]);
		outDays.push(day);
		for (const [tid, isHome] of [
			[home, 1],
			[away, 0],
		] as const) {
			const team = index.get(tid)!;
			usedToday[team] = 1;
			rem[team]! -= 1;
			if (last1[team] === day - 1) {
				b2b[team]! += 1;
			}
			last2[team] = last1[team]!;
			last1[team] = day;
			if (lastHome[team] === isHome) {
				venueStreak[team]! += 1;
			} else {
				lastHome[team] = isHome;
				venueStreak[team] = 1;
			}
		}
	};

	while (numRemaining > 0 && day < maxDays) {
		emitEvents(false);

		const remainingPlayDays = Math.max(1, numPlayDaysTarget - playDaysDone);
		const overtime = playDaysDone - numPlayDaysTarget;

		let expectedTeamGames = 0;
		const order: number[] = [];
		for (let t = 0; t < numTeams; t++) {
			eligible[t] = 0;
			usedToday[t] = 0;
			if (rem[t]! <= 0) {
				continue;
			}
			const need = rem[t]! / remainingPlayDays;
			expectedTeamGames += Math.min(1, need);

			const consecutive3 = last1[t] === day - 1 && last2[t] === day - 2;
			const threeInFour = last2[t]! >= day - 3;
			if (consecutive3 && overtime < overtimeAnything) {
				continue;
			}
			if (threeInFour && overtime < OVERTIME_3_IN_4 && need < NEED_3_IN_4) {
				continue;
			}
			eligible[t] = 1;

			let s = (need - 0.5) * PACE_WEIGHT + random() * RANDOMNESS;
			const rest = day - last1[t]!;
			if (rest === 1) {
				// Back-to-back: not once the team's budget is used
				if (b2b[t]! >= b2bBudget[t]! && overtime < OVERTIME_3_IN_4) {
					eligible[t] = 0;
					continue;
				}
				// Back-to-backs spread over the season: teams behind their share so far are more willing
				const progress = 1 - rem[t]! / numGamesByTeam[t]!;
				const b2bBehind = b2bBudget[t]! * progress - b2b[t]!;
				s += -B2B_PENALTY + B2B_PACE_WEIGHT * b2bBehind;
			} else if (rest === 3) {
				s += REST_2_DAYS_BONUS;
			} else if (rest >= 4) {
				s += REST_3_DAYS_BONUS;
			}
			if (threeInFour) {
				s -= THREE_IN_FOUR_PENALTY;
			}
			score[t] = s;
			order.push(t);
		}

		// Stochastic rounding of the expected number of games today
		// Capped, so the teams split evenly between playing today and tomorrow. Otherwise most teams end up on the same
		// every-other-day rhythm and the days in between are nearly empty.
		let numActiveTeams = 0;
		for (let t = 0; t < numTeams; t++) {
			if (rem[t]! > 0) {
				numActiveTeams += 1;
			}
		}
		const expectedGames =
			Math.min(expectedTeamGames, numActiveTeams * MAX_RATE) / 2;
		const behindNeed =
			numActiveTeams <= 6 ? BEHIND_NEED_SMALL_LEAGUE : BEHIND_NEED;
		let numGamesToday = Math.floor(expectedGames);
		if (random() < expectedGames - numGamesToday) {
			numGamesToday += 1;
		}
		const cap = slateCap.get(day);
		if (cap !== undefined) {
			numGamesToday = Math.min(numGamesToday, cap);
		}

		order.sort((a, b) => score[b]! - score[a]!);

		numToday = 0;

		// Marquee Games: an exclusive holiday slate is the best matchups (by the slate's priority) of the teams that can play today, and
		// then only teams that must play
		const priority = slatePriority.get(day);
		if (priority) {
			const candidates: number[] = [];
			for (let m = 0; m < tids.length; m++) {
				const [home, away] = tids[m]!;
				if (
					!used[m] &&
					eligible[index.get(home)!] &&
					eligible[index.get(away)!]
				) {
					candidates.push(m);
				}
			}
			candidates.sort((a, b) => priority[b]! - priority[a]! || a - b);
			// (a matchup already on an earlier slate goes last)
			for (const repeat of [false, true]) {
				for (const m of candidates) {
					if (numToday >= numGamesToday) {
						break;
					}
					const [home, away] = tids[m]!;
					const key = rivalKey(home, away);
					if (
						slatePairs.has(key) === repeat &&
						!usedToday[index.get(home)!] &&
						!usedToday[index.get(away)!]
					) {
						playGame(m);
						slatePairs.add(key);
					}
				}
			}
			numGamesToday = numToday;
		}

		for (const t of order) {
			if (usedToday[t]) {
				continue;
			}
			const mustPlay = rem[t]! >= remainingPlayDays;
			// A rested team that is behind schedule plays even on a busy day, or small leagues fall behind for good
			const behind =
				rem[t]! / remainingPlayDays > behindNeed && day - last1[t]! >= 2;
			if (
				numToday >= numGamesToday &&
				!mustPlay &&
				(!behind || cap !== undefined)
			) {
				continue;
			}

			let best = -1;
			let bestValue = -Infinity;
			const list = matchupsByTeam[t]!;
			for (let k = list.length - 1; k >= 0; k--) {
				const m = list[k]!;
				if (used[m]) {
					// Lazy cleanup
					list[k] = list.at(-1)!;
					list.pop();
					continue;
				}
				const [home, away] = tids[m]!;
				const tIsHome = index.get(home) === t;
				const u = index.get(tIsHome ? away : home)!;
				if (!eligible[u] || usedToday[u]) {
					continue;
				}
				let value = score[u]!;
				if (rivalMeetings.size > 0) {
					const key = rivalKey(home, away);
					const meetings = rivalMeetings.get(key);
					const last = rivalLastMeeting.get(key);
					if (meetings !== undefined && last !== undefined) {
						const minGap = (RIVAL_SPREAD * numPlayDaysTarget) / meetings;
						const short = minGap - (day - last);
						if (short > 0) {
							value -= (RIVAL_SPREAD_PENALTY * short) / minGap;
						}
					}
				}
				for (const [team, isHome] of [
					[t, tIsHome],
					[u, !tIsHome],
				] as const) {
					if (lastHome[team] === (isHome ? 1 : 0)) {
						value += venueStreak[team]! < 4 ? 0.15 : -0.2;
					}
				}
				if (value > bestValue) {
					bestValue = value;
					best = m;
				}
			}

			if (best < 0 || (bestValue < MIN_PARTNER_SCORE && !mustPlay)) {
				continue;
			}

			playGame(best);
		}

		playDaysDone += 1;
		day += 1;
	}

	emitEvents(true);

	// Then move games out of the remaining 3-in-4s (mostly in the last weeks, where the teams that fell behind catch up),
	// up to a few days past the target length
	const lastDay = Math.max(0, ...outDays);
	const editor = createScheduleEditor(
		outTids,
		outDays,
		Math.min(lastDay + REPAIR_MAX_EXTENSION, getExpectedSeasonLength(maxGames)),
	);
	for (const [day, cap] of slateCap) {
		editor.dayCap.set(day, cap);
	}
	editor.repairThreeInFour(REPAIR_WINDOW);
	const repaired = editor.getSchedule();

	return {
		tids: repaired.tids,
		days: repaired.days,
	};
};

// Rest stats of a schedule, by team: back-to-backs, 3 games in 4 nights, the longest run of game days and the longest
// stretch of days without a game (between games)
export const getScheduleRestStats = (
	tids: readonly (readonly [number, number])[],
	days: readonly number[],
) => {
	const daysByTid = new Map<number, number[]>();
	for (const [i, [home, away]] of tids.entries()) {
		if (home < 0 || away < 0) {
			continue;
		}
		for (const tid of [home, away]) {
			let list = daysByTid.get(tid);
			if (!list) {
				list = [];
				daysByTid.set(tid, list);
			}
			list.push(days[i]!);
		}
	}

	const byTid = new Map<
		number,
		{
			numGames: number;
			b2b: number;
			threeInFour: number;
			maxConsecutive: number;
			maxDaysOff: number;
			sameDay: number;
		}
	>();
	for (const [tid, list] of daysByTid) {
		list.sort((a, b) => a - b);
		let b2b = 0;
		let threeInFour = 0;
		let maxConsecutive = list.length > 0 ? 1 : 0;
		let consecutive = 1;
		let maxDaysOff = 0;
		let sameDay = 0;
		for (let i = 1; i < list.length; i++) {
			const gap = list[i]! - list[i - 1]!;
			if (gap === 0) {
				sameDay += 1;
			}
			if (gap === 1) {
				b2b += 1;
				consecutive += 1;
				maxConsecutive = Math.max(maxConsecutive, consecutive);
			} else {
				consecutive = 1;
			}
			maxDaysOff = Math.max(maxDaysOff, gap - 1);
			if (i >= 2 && list[i]! - list[i - 2]! <= 3) {
				threeInFour += 1;
			}
		}
		byTid.set(tid, {
			numGames: list.length,
			b2b,
			threeInFour,
			maxConsecutive,
			maxDaysOff,
			sameDay,
		});
	}
	return byTid;
};

export default groupScheduleRealistic;
