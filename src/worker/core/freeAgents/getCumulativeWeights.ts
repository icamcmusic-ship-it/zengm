// Cumulative softmax weights of the players, written into `weights` (perf2: a buffer reused across draws instead of a
// new array each time; same arithmetic, so the same draws). Returns the total (the last weight).
export const fillCumulativeWeights = (
	players: { softmaxValue: number }[],
	param: number,
	weights: Float64Array,
) => {
	const n = players.length;

	let maxValue = -Infinity;
	for (let i = 0; i < n; i++) {
		const v = players[i]!.softmaxValue;
		if (v > maxValue) {
			maxValue = v;
		}
	}

	let denominator = 0;
	for (let i = 0; i < n; i++) {
		// Preserve the division used by stableSoftmax for very large values
		const weight = Math.exp((param * players[i]!.softmaxValue) / maxValue);
		weights[i] = weight;
		denominator += weight;
	}

	const equalWeights = maxValue === 0 || denominator === 0;
	let total = 0;
	for (let i = 0; i < n; i++) {
		let weight = equalWeights ? 1 : weights[i]! / denominator;
		if (weight < 0 || Number.isNaN(weight)) {
			weight = Number.MIN_VALUE;
		}
		total += weight;
		weights[i] = total;
	}
	return total;
};

export const getCumulativeWeights = (
	players: { softmaxValue: number }[],
	param: number,
) => {
	const weights = new Float64Array(players.length);
	fillCumulativeWeights(players, param, weights);
	return Array.from(weights);
};
