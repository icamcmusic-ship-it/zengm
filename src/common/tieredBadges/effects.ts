// 2K Badges: what each badge does in the game sim, in plain words, for the badge popup (ui/components/SkillsBlock.tsx). The numbers are
// the Hall of Fame tier effects of GameSim.basketball/tieredBadgesSim.ts (BADGE_SIM), scaled per tier by TIER_SCALE; effects.test.ts
// checks they match. Badges without an entry have no direct game effect: they describe the player's game (and count toward his 6, but
// within a tier the badges with an entry here come first when the cap and the limit of 6 choose: compute.ts simRelevant).
// The tier scale and the league calibration (BADGE_CAL) are defined here, once, and used by the sim, so the popup can show each
// effect net of the calibration (badgeNetEffect).

// Effect scale of a tier: Bronze ... Legend (Hall of Fame = 1). The sim's (tieredBadgesSim.ts imports it)
export const TIER_SCALE = [0, 0.3, 0.55, 0.8, 1, 1.15] as const;

// League calibration of the sim (subtracted from every event, or divided out of a relative one, see tieredBadgesSim.ts). Measured: the
// mean raw effect per event, pooled over new random leagues with the 2026 preset (threeGradient.script.test.ts with BADGE_DIAG;
// re-measured with the 68 badges, at most 6 a player: seeds 1-8, 2 seasons). offFoul, energy and clutch: the badges wired later (seeds
// 1-2, 1 season each: 1.0051 / 1.0064, 0.9978 / 0.9972, 0.0009 / 0.0007, pooled by events)
export const BADGE_CAL = {
	threePointer: 0.0003,
	midRange: 0.0001,
	atRim: -0.001,
	lowPost: 0.001,
	putBack: 0.0001,
	ft: 0.001,
	blk: 1.0056,
	drb: -0.0004,
	stl: 1.0142,
	tov: 0.9981,
	andOne: 1.0075,
	// Relative: offensive foul chance on drives and post-ups (Charge Taker, the defender)
	offFoul: 1.0058,
	// Relative: energy drain on the court per player-minute update (Iron Lungs, Workhorse)
	energy: 0.9975,
	// Clutch make effect (Clutch Gene), per clutch-time shot, before the clutch weight
	clutch: 0.0008,
};
export type BadgeCalKey = keyof typeof BADGE_CAL;

export type BadgeEffect = {
	// What it changes, e.g. "his make chance on assisted threes"
	what: string;
	// Size at Hall of Fame tier
	size: number;
	// "pts": percentage points of a probability; "rel": a relative change (0.12 = 12% more or fewer)
	unit: "pts" | "rel";
	// Direction for the reader ("+" more / higher, "-" fewer / lower)
	sign: "+" | "-";
	// The league calibration of the event it changes (for an effect on several kinds of shots, the main one; none: a pick weight, which
	// only changes who, not how many)
	cal?: BadgeCalKey;
	// The calibrated event is the complement of the one described (an offensive rebound chance: the sim calibrates the defensive one)
	calFlip?: boolean;
	// A team effect: it changes his team's (or the opponents') events while he is on the floor (best on the floor, or his share of the
	// floor's mean), not his own
	team?: boolean;
};

export const BADGE_EFFECTS: Record<string, BadgeEffect[]> = {
	catchShoot: [
		{
			what: "his make chance on assisted threes",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	deadeye: [
		{
			what: "his make chance on self-created threes and mid-range jumpers",
			size: 0.01,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	limitlessRange: [
		{
			what: "his make chance on every three",
			size: 0.003,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	midRangeMaestro: [
		{
			what: "his make chance on mid-range jumpers",
			size: 0.015,
			unit: "pts",
			sign: "+",
			cal: "midRange",
		},
	],
	acrobat: [
		{
			what: "his make chance on finesse finishes at the rim",
			size: 0.014,
			unit: "pts",
			sign: "+",
			cal: "atRim",
		},
	],
	posterizer: [
		{
			what: "his make chance on power finishes at the rim",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "atRim",
		},
	],
	postControl: [
		{
			what: "his make chance on post-ups",
			size: 0.022,
			unit: "pts",
			sign: "+",
			cal: "lowPost",
		},
	],
	putbackBoss: [
		{
			what: "his make chance on putbacks and tip-ins",
			size: 0.03,
			unit: "pts",
			sign: "+",
			cal: "putBack",
		},
		{
			what: "his team's offensive rebound chance (if he is the best Putback Boss on the floor)",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "drb",
			calFlip: true,
			team: true,
		},
		{
			what: "how often an offensive rebound goes to him",
			size: 0.25,
			unit: "rel",
			sign: "+",
		},
	],
	riseUp: [
		{
			what: "his make chance on putbacks",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "putBack",
		},
	],
	fearlessFinisher: [
		{
			what: "his and-one chance at the rim",
			size: 0.2,
			unit: "rel",
			sign: "+",
			cal: "andOne",
		},
	],
	freeThrowAce: [
		{
			what: "his free throw percentage",
			size: 0.025,
			unit: "pts",
			sign: "+",
			cal: "ft",
		},
	],
	dimer: [
		{
			what: "the make chance of shots he assists",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	// (turnover effects are the mean over the five on the floor, so his own share is a fifth of the badge's effect)
	handles: [
		{
			what: "his team's turnovers (his share of the floor's mean)",
			size: 0.005,
			unit: "rel",
			sign: "-",
			cal: "tov",
			team: true,
		},
	],
	ballSecurity: [
		{
			what: "his team's turnovers (his share of the floor's mean)",
			size: 0.01,
			unit: "rel",
			sign: "-",
			cal: "tov",
			team: true,
		},
	],
	clamps: [
		{
			what: "the make chance of jumpers by the man he guards",
			size: 0.02,
			unit: "pts",
			sign: "-",
			cal: "threePointer",
		},
	],
	rimProtector: [
		{
			what: "opponents' make chance at the rim and on putbacks (if he is the best Rim Protector on the floor)",
			size: 0.016,
			unit: "pts",
			sign: "-",
			cal: "atRim",
			team: true,
		},
		{
			what: "his team's block chance near the basket (the same)",
			size: 0.12,
			unit: "rel",
			sign: "+",
			cal: "blk",
			team: true,
		},
	],
	postLockdown: [
		{
			what: "the make chance of post-ups against him",
			size: 0.02,
			unit: "pts",
			sign: "-",
			cal: "lowPost",
		},
	],
	glove: [
		{
			what: "his team's steal chance (if he is the best Glove on the floor)",
			size: 0.06,
			unit: "rel",
			sign: "+",
			cal: "stl",
			team: true,
		},
	],
	boxoutBeast: [
		{
			what: "his team's defensive rebound chance (if he is the best Boxout Beast on the floor)",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "drb",
			team: true,
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
			what: "his team's rebound chance on both ends (if he is the best Rebound Chaser on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "+",
			cal: "drb",
			team: true,
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
			cal: "lowPost",
		},
	],
	floatGame: [
		{
			what: "his make chance on floaters and runners",
			size: 0.008,
			unit: "pts",
			sign: "+",
			cal: "atRim",
		},
	],
	giantSlayer: [
		{
			what: "his make chance at the rim as a small finisher",
			size: 0.01,
			unit: "pts",
			sign: "+",
			cal: "atRim",
		},
	],
	spotUpSniper: [
		{
			what: "his make chance on assisted mid-range jumpers",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "midRange",
		},
	],
	cornerSpecialist: [
		{
			what: "his make chance on assisted threes",
			size: 0.006,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	agent3: [
		{
			what: "his make chance on every three",
			size: 0.004,
			unit: "pts",
			sign: "+",
			cal: "threePointer",
		},
	],
	tipInSpecialist: [
		{
			what: "his make chance on tip-ins",
			size: 0.02,
			unit: "pts",
			sign: "+",
			cal: "putBack",
		},
	],
	setShotSpecialist: [
		{
			what: "his free throw percentage",
			size: 0.012,
			unit: "pts",
			sign: "+",
			cal: "ft",
		},
	],
	unpluckable: [
		{
			what: "his team's turnovers (his share of the floor's mean)",
			size: 0.006,
			unit: "rel",
			sign: "-",
			cal: "tov",
			team: true,
		},
	],
	interceptor: [
		{
			what: "his team's steal chance (if he is the best Interceptor on the floor)",
			size: 0.05,
			unit: "rel",
			sign: "+",
			cal: "stl",
			team: true,
		},
	],
	challenger: [
		{
			what: "opponents' make chance on jumpers (his share of the floor's mean)",
			size: 0.0016,
			unit: "pts",
			sign: "-",
			cal: "threePointer",
			team: true,
		},
	],
	anchor: [
		{
			what: "opponents' make chance at the rim (if he is the best Anchor on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "-",
			cal: "atRim",
			team: true,
		},
	],
	hustleRebounder: [
		{
			what: "his team's offensive rebound chance (if he is the best Hustle Rebounder on the floor)",
			size: 0.006,
			unit: "pts",
			sign: "+",
			cal: "drb",
			calFlip: true,
			team: true,
		},
	],
	// The third set
	chargeTaker: [
		{
			what: "the chance that a drive or post-up by the man he guards ends in a charge he draws",
			size: 0.25,
			unit: "rel",
			sign: "+",
			cal: "offFoul",
		},
	],
	whistleProof: [
		{
			what: "how often his team's defensive fouls are called on him",
			size: 0.3,
			unit: "rel",
			sign: "-",
		},
	],
	clutchGene: [
		{
			what: "his make chance in the clutch (the last minutes of a close game)",
			size: 0.02,
			unit: "pts",
			sign: "+",
			cal: "clutch",
		},
	],
	ironLungs: [
		{
			what: "how fast he tires on the floor",
			size: 0.06,
			unit: "rel",
			sign: "-",
			cal: "energy",
		},
	],
	workhorse: [
		{
			what: "how fast he tires on the floor",
			size: 0.04,
			unit: "rel",
			sign: "-",
			cal: "energy",
		},
	],
	worm: [
		{
			what: "how often an offensive rebound goes to him",
			size: 0.2,
			unit: "rel",
			sign: "+",
		},
	],
	paintPatroller: [
		{
			what: "how often a block goes to him",
			size: 0.25,
			unit: "rel",
			sign: "+",
		},
	],
};

/**
 * An effect at a tier, net of the league calibration: his event against a league-average one (signed: a probability shift in points for
 * "pts", a relative change for "rel"). The sim adds the raw effect and then re-centers every event (subtracts BADGE_CAL, or divides by
 * it), so this is what he does to that event compared with an average player. Pick weights (no cal) are not re-centered.
 */
export const badgeNetEffect = (effect: BadgeEffect, tier: number) => {
	const raw =
		(effect.sign === "-" ? -1 : 1) * effect.size * (TIER_SCALE[tier as 0] ?? 1);
	const cal = effect.cal === undefined ? undefined : BADGE_CAL[effect.cal];
	if (effect.unit === "pts") {
		return effect.calFlip ? raw + (cal ?? 0) : raw - (cal ?? 0);
	}
	return (1 + raw) / (cal ?? 1) - 1;
};

/** "+1.2 percentage points" / "−5%" for an effect at a tier, net of the league calibration (badgeNetEffect). */
export const formatBadgeEffect = (effect: BadgeEffect, tier: number) => {
	const x = badgeNetEffect(effect, tier);
	const sign = x < 0 ? "−" : "+";
	if (effect.unit === "pts") {
		return `${sign}${(100 * Math.abs(x)).toFixed(1)} percentage points`;
	}
	return `${sign}${Math.round(100 * Math.abs(x))}%`;
};
