// Award race probabilities: each candidate's award score (BBGM's own award scoring, from getAwardCandidates) is projected to the end
// of the regular season with uncertainty that shrinks as the season goes on, and the winner is drawn many times. The spread of the
// candidates' scores sets the scale of the noise, so it works for any award formula.

export const NOISE_FACTOR = 1.2;

const gaussian = (random: () => number) => {
	let u = 0;
	while (u === 0) {
		u = random();
	}
	const v = random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const awardWinProbs = ({
	scores,
	fracPlayed,
	numSims = 5000,
	random = Math.random,
}: {
	scores: { pid: number; score: number }[];
	// Fraction of the regular season played, 0 to 1
	fracPlayed: number;
	numSims?: number;
	random?: () => number;
}): Record<number, number> => {
	const valid = scores.filter((row) => Number.isFinite(row.score));
	const output: Record<number, number> = {};
	for (const row of scores) {
		output[row.pid] = 0;
	}
	if (valid.length === 0) {
		return output;
	}

	const mean = valid.reduce((sum, row) => sum + row.score, 0) / valid.length;
	const sd = Math.sqrt(
		valid.reduce((sum, row) => sum + (row.score - mean) ** 2, 0) / valid.length,
	);
	const scale = Math.max(sd, Math.abs(mean) * 0.05, 1e-9);
	const remaining = Math.max(0, 1 - fracPlayed);
	const sigma = NOISE_FACTOR * scale * Math.sqrt(remaining);

	if (sigma === 0 || fracPlayed >= 1) {
		let best = valid[0]!;
		for (const row of valid) {
			if (row.score > best.score) {
				best = row;
			}
		}
		output[best.pid] = 1;
		return output;
	}

	const counts = new Map<number, number>();
	for (let i = 0; i < numSims; i++) {
		let bestPid = valid[0]!.pid;
		let bestScore = -Infinity;
		for (const row of valid) {
			const projected = row.score + sigma * gaussian(random);
			if (projected > bestScore) {
				bestScore = projected;
				bestPid = row.pid;
			}
		}
		counts.set(bestPid, (counts.get(bestPid) ?? 0) + 1);
	}
	for (const [pid, count] of counts) {
		output[pid] = count / numSims;
	}
	return output;
};
