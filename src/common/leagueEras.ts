// League Eras (League Extra, docs/native-features.md): the game-style settings that drift from season to season, the era names
// and the record kept for each season (on the season's awards row, key "era").

export const ERA_KEYS = [
	"threePointTendencyFactor",
	"pace",
	"foulRateFactor",
	"orbFactor",
] as const;

export type EraKey = (typeof ERA_KEYS)[number];

export type EraValues = Record<EraKey, number>;

export const ERA_KEY_NAMES: Record<EraKey, string> = {
	threePointTendencyFactor: "3PT Tendency",
	pace: "Pace",
	foulRateFactor: "Foul Rate",
	orbFactor: "Off Reb",
};

export type RuleProposalType = "lottery" | "tax" | "threesDown" | "threesUp";

export type RuleVote = {
	type: RuleProposalType;
	title: string;
	reason: string;
	yes: number;
	no: number;
	needed: number;
	passed: boolean;
	// How the user's team voted (undefined in spectator mode)
	userVote?: boolean;
};

export type EraRecord = {
	// Style the season was played with
	values: EraValues;
	// Where the drift is pulled back to (the league's normal style)
	baseline: EraValues;
	// Baseline from the next season on, when a rule change moved it
	nextBaseline?: EraValues;
	label: string;
	// League three-point share of shots and possessions per team game in the season
	tpShare?: number;
	poss?: number;
	// True when the season's style came from the league's real history (scheduled events), not the drift
	scheduled?: boolean;
	vote?: RuleVote;
};

// Name of an era, from how far the style is from the baseline
export const eraLabel = (values: EraValues, baseline: EraValues) => {
	const rel = (key: EraKey) =>
		baseline[key] > 0 ? values[key] / baseline[key] : 1;
	const threes = rel("threePointTendencyFactor");
	const pace = rel("pace");
	const fouls = rel("foulRateFactor");
	const orb = rel("orbFactor");

	const threesHi = threes >= 1.12;
	const threesLo = threes <= 0.88;
	const paceHi = pace >= 1.03;
	const paceLo = pace <= 0.97;

	if (threesHi && paceHi) {
		return "Pace & Space era";
	}
	if (threesLo && paceLo) {
		return "Grind-It-Out era";
	}
	if (threesHi && paceLo) {
		return "Half-Court Shooting era";
	}
	if (threesLo && paceHi) {
		return "Run-and-Gun era";
	}
	if (threesHi) {
		return "Three-Point era";
	}
	if (threesLo) {
		return "Post-Up era";
	}
	if (paceHi) {
		return "Fast-Break era";
	}
	if (paceLo) {
		return "Slow-Down era";
	}
	if (fouls >= 1.1 || orb >= 1.1) {
		return "Physical era";
	}
	if (fouls <= 0.9) {
		return "Free-Flowing era";
	}
	return "Balanced era";
};
