// 2K Badges: what each badge does in the game sim, in plain words, for the badge popup (ui/components/SkillsBlock.tsx). The numbers are
// the Hall of Fame tier effects of GameSim.basketball/tieredBadgesSim.ts (BADGE_SIM), scaled per tier by TIER_SCALE; effects.test.ts
// checks they match. Badges without an entry have no direct game effect: they describe the player's game (and count toward his 6, but
// within a tier the badges with an entry here come first when the cap and the limit of 6 choose: compute.ts simRelevant).

// Effect scale of a tier: Bronze ... Legend (Hall of Fame = 1), the same as the sim's
export const TIER_EFFECT_SCALE = [0, 0.3, 0.55, 0.8, 1, 1.15] as const;

export type BadgeEffect = {
	// What it changes, e.g. "his make chance on assisted threes"
	what: string;
	// Size at Hall of Fame tier
	size: number;
	// "pts": percentage points of a probability; "rel": a relative change (0.12 = 12% more or fewer)
	unit: "pts" | "rel";
	// Direction for the reader ("+" more / higher, "-" fewer / lower)
	sign: "+" | "-";
};

export const BADGE_EFFECTS: Record<string, BadgeEffect[]> = {
	catchShoot: [
		{
			what: "his make chance on assisted threes",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
	],
	deadeye: [
		{
			what: "his make chance on self-created threes and mid-range jumpers",
			size: 0.01,
			unit: "pts",
			sign: "+",
		},
	],
	limitlessRange: [
		{
			what: "his make chance on every three",
			size: 0.003,
			unit: "pts",
			sign: "+",
		},
	],
	midRangeMaestro: [
		{
			what: "his make chance on mid-range jumpers",
			size: 0.015,
			unit: "pts",
			sign: "+",
		},
	],
	acrobat: [
		{
			what: "his make chance on finesse finishes at the rim",
			size: 0.014,
			unit: "pts",
			sign: "+",
		},
	],
	posterizer: [
		{
			what: "his make chance on power finishes at the rim",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
	],
	postControl: [
		{
			what: "his make chance on post-ups",
			size: 0.022,
			unit: "pts",
			sign: "+",
		},
	],
	putbackBoss: [
		{
			what: "his make chance on putbacks and tip-ins",
			size: 0.03,
			unit: "pts",
			sign: "+",
		},
		{
			what: "his team's offensive rebound chance (best on the floor)",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
		{
			what: "how often an offensive rebound goes to him",
			size: 0.25,
			unit: "rel",
			sign: "+",
		},
	],
	riseUp: [
		{ what: "his make chance at the rim", size: 0.012, unit: "pts", sign: "+" },
	],
	fearlessFinisher: [
		{
			what: "his and-one chance at the rim",
			size: 0.2,
			unit: "rel",
			sign: "+",
		},
	],
	freeThrowAce: [
		{ what: "his free throw percentage", size: 0.025, unit: "pts", sign: "+" },
	],
	dimer: [
		{
			what: "the make chance of shots he assists",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
	],
	// (turnover effects are the mean over the five on the floor, so his own share is a fifth of the badge's effect)
	handles: [
		{
			what: "his team's turnovers while he is on the floor",
			size: 0.005,
			unit: "rel",
			sign: "-",
		},
	],
	ballSecurity: [
		{
			what: "his team's turnovers while he is on the floor",
			size: 0.01,
			unit: "rel",
			sign: "-",
		},
	],
	clamps: [
		{
			what: "the make chance of jumpers by the man he guards",
			size: 0.02,
			unit: "pts",
			sign: "-",
		},
	],
	rimProtector: [
		{
			what: "opponents' make chance at the rim and on putbacks (best on the floor)",
			size: 0.016,
			unit: "pts",
			sign: "-",
		},
		{
			what: "his team's block chance near the basket",
			size: 0.12,
			unit: "rel",
			sign: "+",
		},
	],
	postLockdown: [
		{
			what: "opponents' make chance on post-ups",
			size: 0.02,
			unit: "pts",
			sign: "-",
		},
	],
	glove: [
		{
			what: "his team's steal chance (best on the floor)",
			size: 0.06,
			unit: "rel",
			sign: "+",
		},
	],
	boxoutBeast: [
		{
			what: "his team's defensive rebound chance (best on the floor)",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
		{
			what: "how often a defensive rebound goes to him",
			size: 0.25,
			unit: "rel",
			sign: "+",
		},
	],
	reboundChaser: [
		{
			what: "his team's rebound chance on both ends (best on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "+",
		},
		{
			what: "how often the rebound goes to him",
			size: 0.25,
			unit: "rel",
			sign: "+",
		},
	],
	hookSpecialist: [
		{
			what: "his make chance on post-ups (jump hooks)",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
	],
	floatGame: [
		{
			what: "his make chance on floaters and runners",
			size: 0.008,
			unit: "pts",
			sign: "+",
		},
	],
	giantSlayer: [
		{
			what: "his make chance at the rim as a small finisher",
			size: 0.01,
			unit: "pts",
			sign: "+",
		},
	],
	spotUpSniper: [
		{
			what: "his make chance on assisted mid-range jumpers",
			size: 0.012,
			unit: "pts",
			sign: "+",
		},
	],
	cornerSpecialist: [
		{
			what: "his make chance on assisted threes",
			size: 0.006,
			unit: "pts",
			sign: "+",
		},
	],
	agent3: [
		{
			what: "his make chance on every three",
			size: 0.004,
			unit: "pts",
			sign: "+",
		},
	],
	tipInSpecialist: [
		{ what: "his make chance on tip-ins", size: 0.02, unit: "pts", sign: "+" },
	],
	setShotSpecialist: [
		{ what: "his free throw percentage", size: 0.012, unit: "pts", sign: "+" },
	],
	unpluckable: [
		{
			what: "his team's turnovers while he is on the floor",
			size: 0.006,
			unit: "rel",
			sign: "-",
		},
	],
	interceptor: [
		{
			what: "his team's steal chance (best on the floor)",
			size: 0.05,
			unit: "rel",
			sign: "+",
		},
	],
	challenger: [
		{
			what: "opponents' make chance on jumpers",
			size: 0.008,
			unit: "pts",
			sign: "-",
		},
	],
	anchor: [
		{
			what: "opponents' make chance at the rim (best on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "-",
		},
	],
	hustleRebounder: [
		{
			what: "his team's offensive rebound chance (best on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "+",
		},
	],
};

/** "+1.2 points" / "-5%" for an effect at a tier. */
export const formatBadgeEffect = (effect: BadgeEffect, tier: number) => {
	const x = effect.size * (TIER_EFFECT_SCALE[tier as 0] ?? 1);
	const sign = effect.sign === "-" ? "−" : "+";
	if (effect.unit === "pts") {
		return `${sign}${(100 * x).toFixed(1)} percentage points`;
	}
	return `${sign}${Math.round(100 * x)}%`;
};
