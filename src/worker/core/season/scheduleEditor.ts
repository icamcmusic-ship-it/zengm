// Local search over a schedule with days (the realistic schedule length): moves single games to other days to remove 3
// games in 4 nights, and places marquee games on fixed days (marqueeSchedule.ts), while keeping the rest pattern:
// - never 3 days in a row, no team twice in a day
// - each team keeps about the number of back-to-backs it had
// - events (All-Star Game, trade deadline) and their days don't move, no game is moved onto an event's day or into the
//   All-Star break, and no day with games is emptied (the number of days with games sets the daily processes' pace)

// Cost of a team's rest pattern (sorted game days)
const CONSECUTIVE_3_COST = 1000;
const THREE_IN_FOUR_COST = 10;
// Per back-to-back away from the team's count before the edits
const B2B_COST = 1.5;
// Per day of a break between games longer than LONG_GAP days (calendar days, the All-Star break included)
const LONG_GAP = 6;
const LONG_GAP_COST = 0.5;
// Days with about the same number of games: per game moved from a day with fewer games to one with more
const DAY_BALANCE_COST = 0.25;

export const teamRestCost = (list: readonly number[], b2bTarget: number) => {
	let cost = 0;
	let b2b = 0;
	for (let i = 1; i < list.length; i++) {
		const gap = list[i]! - list[i - 1]!;
		if (gap === 1) {
			b2b += 1;
		} else if (gap > LONG_GAP) {
			cost += (gap - LONG_GAP) * LONG_GAP_COST;
		}
		if (i >= 2) {
			const gap2 = list[i]! - list[i - 2]!;
			if (gap2 <= 2) {
				cost += CONSECUTIVE_3_COST;
			} else if (gap2 <= 3) {
				cost += THREE_IN_FOUR_COST;
			}
		}
	}
	return cost + B2B_COST * Math.abs(b2b - b2bTarget);
};

const countB2B = (list: readonly number[]) => {
	let b2b = 0;
	for (let i = 1; i < list.length; i++) {
		if (list[i]! - list[i - 1]! === 1) {
			b2b += 1;
		}
	}
	return b2b;
};

// list with one day replaced by another, still sorted
const replaceDay = (list: readonly number[], from: number, to: number) => {
	const out: number[] = [];
	let inserted = false;
	for (const day of list) {
		if (day === from) {
			continue;
		}
		if (!inserted && to < day) {
			out.push(to);
			inserted = true;
		}
		out.push(day);
	}
	if (!inserted) {
		out.push(to);
	}
	return out;
};

export const createScheduleEditor = (
	tids: readonly (readonly [number, number])[],
	days: readonly number[],
	// Games can move up to this day (default: the last day of the schedule)
	maxDay: number = 0,
) => {
	const gameDays = [...days];
	const lastDay = Math.max(maxDay, ...days);

	// Days nothing can move to or from: event days and the All-Star break (the days around the All-Star Game with no
	// games)
	const blocked = new Uint8Array(lastDay + 2);
	const gamesPerDay = new Array<number>(lastDay + 2).fill(0);
	for (const [i, [home]] of tids.entries()) {
		if (home < 0) {
			blocked[days[i]!] = 1;
		} else {
			gamesPerDay[days[i]!]! += 1;
		}
	}
	for (const [i, [home]] of tids.entries()) {
		if (home === -1) {
			for (const step of [-1, 1]) {
				for (
					let day = days[i]! + step;
					day >= 1 && day <= Math.max(0, ...days) && gamesPerDay[day] === 0;
					day += step
				) {
					blocked[day] = 1;
				}
			}
		}
	}

	// Each team's sorted game days, its game on each day, and its back-to-back count to keep
	const teamDays = new Map<number, number[]>();
	const teamGameOnDay = new Map<number, Map<number, number>>();
	for (const [i, [home, away]] of tids.entries()) {
		if (home < 0) {
			continue;
		}
		for (const tid of [home, away]) {
			let list = teamDays.get(tid);
			if (!list) {
				list = [];
				teamDays.set(tid, list);
				teamGameOnDay.set(tid, new Map());
			}
			list.push(days[i]!);
			teamGameOnDay.get(tid)!.set(days[i]!, i);
		}
	}
	const b2bTarget = new Map<number, number>();
	for (const [tid, list] of teamDays) {
		list.sort((a, b) => a - b);
		b2bTarget.set(tid, countB2B(list));
	}

	const pinned = new Set<number>();
	// At most this many games on a day (the exclusive holiday slates of Marquee Games)
	const dayCap = new Map<number, number>();

	// Whether a day's only game can leave it: only from the last day with games, so no empty day is left in the season
	const canEmpty = (from: number, to: number) => {
		if (to > from) {
			return false;
		}
		for (let day = from + 1; day < gamesPerDay.length; day++) {
			if (gamesPerDay[day]! > 0) {
				return false;
			}
		}
		return true;
	};

	const canMove = (i: number, to: number, allowEmptyDay = false) => {
		const [home, away] = tids[i]!;
		const from = gameDays[i]!;
		return (
			home >= 0 &&
			to !== from &&
			to >= 1 &&
			to <= lastDay &&
			!blocked[to] &&
			!pinned.has(i) &&
			gamesPerDay[to]! < (dayCap.get(to) ?? Infinity) &&
			(allowEmptyDay || gamesPerDay[from]! > 1 || canEmpty(from, to)) &&
			!teamGameOnDay.get(home)!.has(to) &&
			!teamGameOnDay.get(away)!.has(to)
		);
	};

	// Change of the total cost if game i moved to day "to"
	const moveDelta = (i: number, to: number) => {
		const [home, away] = tids[i]!;
		const from = gameDays[i]!;
		let delta = 0;
		for (const tid of [home, away]) {
			const list = teamDays.get(tid)!;
			const target = b2bTarget.get(tid)!;
			delta +=
				teamRestCost(replaceDay(list, from, to), target) -
				teamRestCost(list, target);
		}
		delta +=
			DAY_BALANCE_COST * (2 * (gamesPerDay[to]! - gamesPerDay[from]!) + 2);
		return delta;
	};

	const move = (i: number, to: number) => {
		const [home, away] = tids[i]!;
		const from = gameDays[i]!;
		for (const tid of [home, away]) {
			teamDays.set(tid, replaceDay(teamDays.get(tid)!, from, to));
			const map = teamGameOnDay.get(tid)!;
			map.delete(from);
			map.set(to, i);
		}
		gamesPerDay[from]! -= 1;
		gamesPerDay[to]! += 1;
		gameDays[i] = to;
	};

	// Best move of game i to a day within window days of where it is
	const bestMove = (i: number, window: number, allowEmptyDay = false) => {
		const from = gameDays[i]!;
		let bestDay = -1;
		let bestDelta = Infinity;
		for (let to = from - window; to <= from + window; to++) {
			if (!canMove(i, to, allowEmptyDay)) {
				continue;
			}
			const delta = moveDelta(i, to);
			if (delta < bestDelta) {
				bestDelta = delta;
				bestDay = to;
			}
		}
		return { day: bestDay, delta: bestDelta };
	};

	// Move game i to day "to" after moving the games of its teams that are in the way on that day (to their best day
	// nearby), if the total cost changes by less than maxDelta (by default: only if it goes down). Returns whether it did.
	const tryChainMove = (
		i: number,
		to: number,
		window: number,
		maxDelta = -1e-9,
	) => {
		const [home, away] = tids[i]!;
		const from = gameDays[i]!;
		if (
			to === from ||
			to < 1 ||
			to > lastDay ||
			blocked[to] ||
			pinned.has(i) ||
			(gamesPerDay[from]! <= 1 && !canEmpty(from, to))
		) {
			return false;
		}
		const blockers = new Set<number>();
		for (const tid of [home, away]) {
			const other = teamGameOnDay.get(tid)!.get(to);
			if (other !== undefined) {
				blockers.add(other);
			}
		}
		const undo: [number, number][] = [];
		let total = 0;
		let ok = true;
		for (const other of blockers) {
			// Not back onto the day being freed up
			let bestDay = -1;
			let bestDelta = Infinity;
			const otherFrom = gameDays[other]!;
			for (let d = otherFrom - window; d <= otherFrom + window; d++) {
				if (d === to || !canMove(other, d)) {
					continue;
				}
				const delta = moveDelta(other, d);
				if (delta < bestDelta) {
					bestDelta = delta;
					bestDay = d;
				}
			}
			if (bestDay < 0) {
				ok = false;
				break;
			}
			total += bestDelta;
			undo.push([other, otherFrom]);
			move(other, bestDay);
		}
		if (ok && canMove(i, to)) {
			total += moveDelta(i, to);
			if (total < maxDelta) {
				move(i, to);
				return true;
			}
		}
		for (const [other, day] of undo.reverse()) {
			move(other, day);
		}
		return false;
	};

	// Swapping the days of two games (each team keeps its other games): the teams that are in only one of them change
	// days. undefined if not possible
	const swapDelta = (i: number, j: number) => {
		const di = gameDays[i]!;
		const dj = gameDays[j]!;
		if (
			i === j ||
			di === dj ||
			tids[i]![0] < 0 ||
			tids[j]![0] < 0 ||
			pinned.has(i) ||
			pinned.has(j)
		) {
			return undefined;
		}
		const ti = tids[i]!;
		const tj = tids[j]!;
		let delta = 0;
		for (const [teams, otherTeams, from, to] of [
			[ti, tj, di, dj],
			[tj, ti, dj, di],
		] as const) {
			for (const tid of teams) {
				if (otherTeams.includes(tid)) {
					continue;
				}
				if (teamGameOnDay.get(tid)!.has(to)) {
					return undefined;
				}
				const list = teamDays.get(tid)!;
				const target = b2bTarget.get(tid)!;
				delta +=
					teamRestCost(replaceDay(list, from, to), target) -
					teamRestCost(list, target);
			}
		}
		return delta;
	};

	const swap = (i: number, j: number) => {
		const di = gameDays[i]!;
		const dj = gameDays[j]!;
		const ti = tids[i]!;
		const tj = tids[j]!;
		for (const [teams, otherTeams, from, to] of [
			[ti, tj, di, dj],
			[tj, ti, dj, di],
		] as const) {
			for (const tid of teams) {
				if (otherTeams.includes(tid)) {
					continue;
				}
				teamDays.set(tid, replaceDay(teamDays.get(tid)!, from, to));
				teamGameOnDay.get(tid)!.delete(from);
			}
		}
		for (const [game, teams, day] of [
			[i, ti, dj],
			[j, tj, di],
		] as const) {
			for (const tid of teams) {
				teamGameOnDay.get(tid)!.set(day, game);
			}
			gameDays[game] = day;
		}
	};

	// Cost of every team's rest pattern (for tests and diagnostics)
	const totalCost = () => {
		let cost = 0;
		for (const [tid, list] of teamDays) {
			cost += teamRestCost(list, b2bTarget.get(tid)!);
		}
		return cost;
	};

	// Move games out of 3 games in 4 nights while that lowers the total cost (first improvement, until none is left)
	const repairThreeInFour = (window = 8, maxPasses = 30, chains = true) => {
		for (let pass = 0; pass < maxPasses; pass++) {
			let improved = false;
			for (const tid of [...teamDays.keys()].sort((a, b) => a - b)) {
				for (let i = 2; i < teamDays.get(tid)!.length; i++) {
					const list = teamDays.get(tid)!;
					if (list[i]! - list[i - 2]! > 3) {
						continue;
					}
					const map = teamGameOnDay.get(tid)!;
					let best = { game: -1, day: -1, delta: -1e-9 };
					for (const day of [list[i - 2]!, list[i - 1]!, list[i]!]) {
						const game = map.get(day)!;
						const option = bestMove(game, window);
						if (option.day >= 0 && option.delta < best.delta) {
							best = { game, ...option };
						}
					}
					if (best.game >= 0) {
						move(best.game, best.day);
						improved = true;
						continue;
					}
					// Moving another game out of the way first
					if (chains) {
						const days3 = [list[i - 2]!, list[i - 1]!, list[i]!];
						done: for (const day of days3) {
							const game = map.get(day)!;
							for (let step = 1; step <= window; step++) {
								for (const to of [day - step, day + step]) {
									if (tryChainMove(game, to, window)) {
										improved = true;
										break done;
									}
								}
							}
						}
					}
				}
			}
			if (!improved) {
				break;
			}
		}
	};

	// Games in the original order, sorted by day (stable, so events keep their place)
	const getSchedule = () => {
		const order = tids.map((_, i) => i);
		order.sort((a, b) => gameDays[a]! - gameDays[b]!);
		return {
			order,
			tids: order.map((i) => [tids[i]![0], tids[i]![1]] as [number, number]),
			days: order.map((i) => gameDays[i]!),
		};
	};

	return {
		gameDays,
		gamesPerDay,
		teamDays,
		teamGameOnDay,
		blocked,
		lastDay,
		pinned,
		dayCap,
		canMove,
		moveDelta,
		move,
		bestMove,
		tryChainMove,
		swapDelta,
		swap,
		totalCost,
		repairThreeInFour,
		getSchedule,
	};
};

export type ScheduleEditor = ReturnType<typeof createScheduleEditor>;
