// Style sliders (Settings > Tendencies): three simple dials that each move several game sim tendency settings at once. Each slider
// goes from -1 to 1 (0 = no change), and multiplies the settings it touches by 1 + weight * slider, on top of the values the sliders
// started from (the base: whatever was in the form, a preset or the defaults, when the sliders were last all at 0). When two sliders
// touch the same setting, their multipliers are multiplied together. The mapping is shown under the sliders.

export type StyleSliderKey = "paceSpace" | "physicality" | "ballMovement";

export type StyleSliderSettingKey =
	| "pace"
	| "threePointTendencyFactor"
	| "orbFactor"
	| "foulRateFactor"
	| "blockFactor"
	| "stealFactor"
	| "turnoverFactor"
	| "assistFactor"
	| "threePointAccuracyFactor"
	| "twoPointAccuracyFactor";

export const STYLE_SLIDERS: {
	key: StyleSliderKey;
	name: string;
	low: string;
	high: string;
	weights: Partial<Record<StyleSliderSettingKey, number>>;
}[] = [
	{
		key: "paceSpace",
		name: "Pace & Space",
		low: "Grind it out",
		high: "Run and gun from three",
		// More possessions and more threes; spread floors mean fewer offensive rebounds
		weights: {
			pace: 0.08,
			threePointTendencyFactor: 0.45,
			orbFactor: -0.12,
		},
	},
	{
		key: "physicality",
		name: "Physicality",
		low: "Finesse",
		high: "Hand-checking era",
		// More fouls, blocks, steals and crashing the glass, and more turnovers forced
		weights: {
			foulRateFactor: 0.3,
			blockFactor: 0.15,
			stealFactor: 0.12,
			orbFactor: 0.1,
			turnoverFactor: 0.08,
		},
	},
	{
		key: "ballMovement",
		name: "Ball movement",
		low: "Isolation",
		high: "Share the ball",
		// More assisted shots and better looks, at the cost of a few more risky passes
		weights: {
			assistFactor: 0.3,
			twoPointAccuracyFactor: 0.02,
			threePointAccuracyFactor: 0.03,
			turnoverFactor: 0.04,
		},
	},
];

export const STYLE_SLIDER_SETTING_KEYS = Array.from(
	new Set(STYLE_SLIDERS.flatMap((s) => Object.keys(s.weights))),
) as StyleSliderSettingKey[];

export type StyleSliderValues = Record<StyleSliderKey, number>;

export const ZERO_SLIDERS: StyleSliderValues = {
	paceSpace: 0,
	physicality: 0,
	ballMovement: 0,
};

// The multiplier each setting gets from the sliders
export const sliderMultipliers = (values: StyleSliderValues) => {
	const mult: Partial<Record<StyleSliderSettingKey, number>> = {};
	for (const slider of STYLE_SLIDERS) {
		const v = values[slider.key];
		for (const [key, weight] of Object.entries(slider.weights) as [
			StyleSliderSettingKey,
			number,
		][]) {
			mult[key] = (mult[key] ?? 1) * Math.max(0, 1 + weight * v);
		}
	}
	return mult;
};

// The settings that result from the sliders, given the base values. Rounded to keep the form readable.
export const applyStyleSliders = (
	base: Record<StyleSliderSettingKey, number>,
	values: StyleSliderValues,
) => {
	const mult = sliderMultipliers(values);
	const out = {} as Record<StyleSliderSettingKey, number>;
	for (const key of STYLE_SLIDER_SETTING_KEYS) {
		const value = base[key] * (mult[key] ?? 1);
		out[key] =
			key === "pace"
				? Math.round(value * 10) / 10
				: Math.round(value * 1000) / 1000;
	}
	return out;
};
