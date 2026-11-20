// The one composite rating formula: a weighted average of 0-100 ratings (or constants), as a 0-1 number. Shared by the worker's
// player.compositeRating (the game sim, skills, AI) and the skill badges' badgeComposite (worker and UI), which only differ in
// what they read for each component (fuzz, expanded-rating substitutions), so the two can't drift apart.
export const weightedComposite = (
	components: readonly (string | number)[],
	weights: readonly number[] | undefined,
	factorOf: (component: string, i: number) => number,
): number => {
	let numerator = 0;
	let denominator = 0;
	for (let i = 0; i < components.length; i++) {
		const component = components[i]!;
		const factor =
			typeof component === "number" ? component : factorOf(component, i);
		const weight = weights?.[i] ?? 1;
		numerator += factor * weight;
		denominator += 100 * weight;
	}
	const x = numerator / denominator;
	// Same as helpers.bound(x, 0, 1)
	return x < 0 ? 0 : x > 1 ? 1 : x;
};
