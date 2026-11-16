// Spread Out Matchups (the spreadMatchups League Extras setting) for the old compact schedule: the days of games (each team at most
// once a day) are put in an order where no team meets the same opponent in consecutive games, if possible, and never 3 in a row
// if possible. Deterministic (no random numbers): the days stay in their shuffled order unless a day would repeat a matchup, then
// the first later day that doesn't goes first.

const REPEAT_3_COST = 1000;

const orderDaysSpreadMatchups = (days: [number, number][][]) => {
	const lastOpp = new Map<number, number>();
	const lastOpp2 = new Map<number, number>();

	const dayCost = (day: readonly [number, number][]) => {
		let cost = 0;
		for (const [home, away] of day) {
			for (const [tid, opp] of [
				[home, away],
				[away, home],
			] as const) {
				if (lastOpp.get(tid) === opp) {
					cost += lastOpp2.get(tid) === opp ? REPEAT_3_COST : 1;
				}
			}
		}
		return cost;
	};

	const remaining = [...days];
	const ordered: [number, number][][] = [];
	while (remaining.length > 0) {
		let best = 0;
		let bestCost = Infinity;
		for (const [k, day] of remaining.entries()) {
			const cost = dayCost(day);
			if (cost < bestCost) {
				best = k;
				bestCost = cost;
				if (cost === 0) {
					break;
				}
			}
		}
		const day = remaining.splice(best, 1)[0]!;
		ordered.push(day);
		for (const [home, away] of day) {
			for (const [tid, opp] of [
				[home, away],
				[away, home],
			] as const) {
				const prev = lastOpp.get(tid);
				if (prev !== undefined) {
					lastOpp2.set(tid, prev);
				}
				lastOpp.set(tid, opp);
			}
		}
	}
	return ordered;
};

export default orderDaysSpreadMatchups;
