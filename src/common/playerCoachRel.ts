// Player–coach relationships (featurePlayerCoachRel, basketball, needs Coaching Staff): pure helpers shared by the worker and the UI. The
// worker side is worker/core/staff/relationships.ts. See docs/native-features.md, "Player–coach relationships".

// One relationship, stored on the player (p.coachRels): the coach, the team they were together on last, the bond (-1 broken ... 1 very
// close), seasons together and the last season it was updated
export type PlayerCoachRel = {
	cid: number;
	tid: number;
	v: number;
	n: number;
	s: number;
};

// At most this many relationships per player (the most recent)
export const MAX_COACH_RELS = 6;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export type RelSeasonInput = {
	// The bond so far (0 for a new relationship)
	v: number;
	// Minutes against what his place in the rotation suggests, about -1 (benched) ... 1 (more than his role)
	minutes: number;
	// His ovr change this season against the typical change at his age, about -1 ... 1 (0 when unknown)
	dev: number;
	// The head coach's personality: -1 disciplinarian ... 1 players' coach
	personality: number;
	// Ego 0-100 (player traits), undefined when traits are off
	ego?: number;
	// Mood traits (playerMoodTraits): F fame, L loyalty, W winning, $ money
	traits: string[];
	// Team win% this season
	winp: number;
	// Seeded noise, uniform -1 ... 1
	noise: number;
};

// Every season a bond decays 10% toward neutral, then moves by this season's experience. Bounded per season (±0.45), so it takes a few
// seasons to build a strong one or break one
export const relSeasonDelta = ({
	v,
	minutes,
	dev,
	personality,
	ego,
	traits,
	winp,
	noise,
}: RelSeasonInput) => {
	const fame = traits.includes("F");
	const loyal = traits.includes("L");
	const winner = traits.includes("W");
	let d = 0.03;
	d += (fame ? 0.28 : 0.18) * clamp(minutes, -1, 1);
	d += 0.12 * clamp(dev, -1, 1);
	d += 0.07 * personality;
	if (ego !== undefined && personality < 0) {
		d += 0.12 * personality * clamp((ego - 50) / 30, 0, 1);
	}
	d += (winner ? 0.3 : 0.15) * (winp - 0.5);
	if (loyal) {
		d += 0.04;
	}
	d += 0.1 * noise;
	d = clamp(d, -0.45, 0.45);
	return Math.round(100 * clamp(0.9 * v + d, -1, 1)) / 100;
};

// Mood component (±1.5 at most): only with the head coach of the team in question
export const relMood = (v: number) => clamp(1.5 * v, -1.5, 1.5);

// Development plan effectiveness: the plan is sized as if the development coach rated this much higher/lower (±8 at most; the plans stay
// ovr-neutral and centered over the league)
export const relDevBoost = (v: number) => clamp(8 * v, -8, 8);

export const relLabel = (v: number) =>
	v >= 0.6
		? "Very close"
		: v >= 0.3
			? "Good"
			: v > -0.15
				? "Neutral"
				: v > -0.45
					? "Strained"
					: "Broken";

// Minutes per game a player at this place in his team's rotation (0 = most valuable) usually plays
export const expectedMinutes = (rank: number) =>
	rank < 3 ? 33 : rank < 5 ? 29 : rank < 8 ? 21 : rank < 10 ? 13 : 6;

// Typical ovr change in a season at this age (the relationship reads development against it)
export const typicalOvrChange = (age: number) =>
	age <= 20
		? 5
		: age <= 22
			? 3.5
			: age <= 24
				? 2
				: age <= 27
					? 0.5
					: age <= 30
						? -0.5
						: age <= 33
							? -2
							: -3.5;
