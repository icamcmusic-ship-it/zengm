// Coaching Staff Depth: the effect sizes of the three extra jobs. Each reads the coach's rating against the league average of that job
// (z, in 15-point steps, at most 2 either way, centered over the league), so the league as a whole develops, gets hurt and plays the same
// at average staff. Pure.

export const DEPTH_Z_SCALE = 15;
export const DEPTH_Z_MAX = 2;

export const depthZ = (rating: number, mean: number) =>
	Math.max(
		-DEPTH_Z_MAX,
		Math.min(DEPTH_Z_MAX, (rating - mean) / DEPTH_Z_SCALE),
	);

// Shooting coach: rating points a season on three-pointers, mid-range and free throws per z (younger players learn more)
export const SHOOT_PER_Z = 0.4;
export const shootingAgeFactor = (age: number) =>
	age <= 25 ? 1 : age <= 30 ? 0.7 : 0.4;
export const shootingDeltas = (z: number, age: number) => {
	const d = SHOOT_PER_Z * z * shootingAgeFactor(age);
	return { tp: d, fg: d, ft: d };
};

// Strength & conditioning: for players 27 and older, rating points a season of speed, jumping and endurance per z (a slower athletic
// decline); and the in-game injury rate per z (on top of the Medical department of the Front Office Budget, which is a budget, not staff)
export const SC_DECLINE_PER_Z = 0.35;
export const SC_INJURY_PER_Z = 0.04;
export const SC_MIN_AGE = 27;
export const conditioningDeltas = (z: number, age: number) => {
	if (age < SC_MIN_AGE) {
		return {};
	}
	const d = SC_DECLINE_PER_Z * z;
	return { spd: d, jmp: d, endu: d };
};
export const conditioningInjuryFactor = (z: number) => 1 - SC_INJURY_PER_Z * z;

// Video/analytics coordinator: Coaching Systems inputs only (no sim change of its own): the head coach's game management (mgmt, 0-100;
// the league is centered again in normalizeCoachSims) and how readily he adjusts in a playoff series (adapt, 0-100)
export const VIDEO_MGMT_PER_Z = 4;
export const VIDEO_ADAPT_PER_Z = 8;

// Effect sizes for the UI
export const DEPTH_EFFECT_TEXT = {
	shoot:
		"Three-pointers, mid-range and free throws: ±0.4 rating points a season per 15 points above or below the league's average shooting coach (at most ±0.8; 70% of that from age 26, 40% from 31). Neutral for the league as a whole.",
	sc: "Players 27 and older: speed, jumping and endurance decline ±0.35 points a season slower or faster per 15 points above or below the league's average (at most ±0.7); in-game injury rate ∓4% per 15 points (at most ∓8%). Neutral for the league as a whole; Medical (Front Office Budget) is separate.",
	video:
		"With Coaching Systems: the head coach's late-game management ±4 and his playoff series adjustments ±8 (0-100 scales) per 15 points above or below the league's average. Neutral for the league as a whole.",
	dev: "Development plans: the budget a plan moves toward its focus is ×0.75 with a poor development coach (30) up to ×1.25 with a great one (80+). His share of general development is unchanged.",
	off: "Offensive coordinator: 40% of the offense strength that sets the make probability bonus of the head coach's system (Coaching Systems).",
	def: "Defensive coordinator: 40% of the defense strength that sets the opponents' make probability of the head coach's system (Coaching Systems).",
	head: "Systems and game plan (Coaching Systems), motivation and part of development.",
} as const;
