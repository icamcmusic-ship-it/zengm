// Rest stats of a schedule with days (realistic schedule length), by team: back-to-backs, 3 games in 4 nights, the longest run of
// game days, the longest stretch of days without a game (between games), games on a day the team already plays (same-day
// conflicts) and home/away games. Events (All-Star Game, trade deadline) don't count. Used by the schedule builder's tests and the
// schedule editor's "Validate schedule" panel.
export type ScheduleRestStats = {
	numGames: number;
	home: number;
	away: number;
	b2b: number;
	threeInFour: number;
	maxConsecutive: number;
	maxDaysOff: number;
	sameDay: number;
};

export const getScheduleRestStats = (
	tids: readonly (readonly [number, number])[],
	days: readonly number[],
) => {
	const daysByTid = new Map<number, number[]>();
	const homeByTid = new Map<number, number>();
	for (const [i, [home, away]] of tids.entries()) {
		if (home < 0 || away < 0) {
			continue;
		}
		homeByTid.set(home, (homeByTid.get(home) ?? 0) + 1);
		for (const tid of [home, away]) {
			let list = daysByTid.get(tid);
			if (!list) {
				list = [];
				daysByTid.set(tid, list);
			}
			list.push(days[i]!);
		}
	}

	const byTid = new Map<number, ScheduleRestStats>();
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
		const home = homeByTid.get(tid) ?? 0;
		byTid.set(tid, {
			numGames: list.length,
			home,
			away: list.length - home,
			b2b,
			threeInFour,
			maxConsecutive,
			maxDaysOff,
			sameDay,
		});
	}
	return byTid;
};
