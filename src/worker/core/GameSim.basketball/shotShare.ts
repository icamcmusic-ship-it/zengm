// Shot Share Model (the shotShareModel League extra, see docs/native-features.md). Off: nothing here is used, and the sim draws exactly the
// random numbers it did before.
//
// Who takes the shot of a possession. The stock draw is the usage composite (times fatigue) to a power, with a floor of 5% of the five's
// total. With the model on, the weight of each player on the court goes through, in order:
//   - his role in the five (1st, 2nd, 3rd option, role players: the five ranked by usage composite times his game plan),
//   - his game plan (More shots / Normal / Fewer shots, the user's per player, the AI coach's by role),
//   - a light season drift correction (a player whose season share runs far above his role gets a little less),
//   - ego (a diva star takes a little more), competitiveness (more in close games), role acceptance (forcing shots in a small role),
//   - the hot hand (after a few straight makes the team feeds him for a few possessions; the make probability is unchanged),
//   - mismatch hunting (the offense leans to the player with the weakest matchup; elite defenders take some of their man's shots away),
//   - spacing sag (a non-shooter is sagged off and passes up some open threes),
//   - the late shot clock (the lineup's best creator and the first option get the bailouts),
//   - the lineup-relative knee (a weight far above the five's mean keeps only part of the excess; the knee is higher for real scorers, so a
//     middling scorer among role players doesn't dominate and a five of scorers spreads its shots),
//   - a softer floor (5% of the five's total for a scorer, less for a non-scorer),
//   - defensive attention (Matchup Defense's cap) and double teams: above a share threshold the defense sometimes doubles the star, his
//     shot goes to the open man as an assisted catch-and-shoot attempt. The double team reuses the shooter draw's random number.
// Every part is deterministic given the draw (no extra random numbers are drawn).

export const SHOT_SHARE = {
	// Power on the usage composite times fatigue (stock 1.25), before the coach's and the clutch multipliers
	power: 1.6,
	// Scoring ability, 0 to 1, from the usage composite (after loadTeams' 1.9 power): a role player at lo, a star at hi
	abilityLo: 0.2,
	abilityHi: 0.45,
	// Role in the five: weight multiplier for the 1st, 2nd, 3rd option and the two role players. The 1st option's is more for a better
	// scorer: tier[0] + firstAbility × (ability - 0.5)
	tier: [1.72, 1.1, 1, 0.92, 0.88],
	firstAbility: 0.2,
	// Lineup-relative knee: a weight above knee × the five's mean keeps only `excess` of the part above it. knee = kneeLo + kneeSpan × ability
	kneeLo: 1.3,
	kneeSpan: 0.45,
	kneeExcess: 0.35,
	// Floor: floorShare of the five's total, times floorMin + (1 - floorMin) × ability
	floorShare: 0.05,
	floorMin: 0.4,
	// Season drift: the expected on-court FGA share by his rank on the team (by usage composite, among the top 9 by value); above it by more
	// than tol, his weight × 1 - k × (share - expected - tol), down to min. Only with min minutes and games played this season
	expected: [0.3, 0.25, 0.22, 0.2, 0.185, 0.175, 0.165, 0.16, 0.155],
	driftTol: 0.025,
	driftK: 3,
	driftMin: 0.88,
	driftMinMinutes: 250,
	// Hot hand: after `after` straight makes (afterStreaky for a streaky shooter, consistency below -streakyZ), his weight × 1 + hot × (1 -
	// hotCons × consistency z) for his team's next hotPoss shooter draws while he is on the court. A miss ends it
	hotAfter: 3,
	hotAfterStreaky: 2,
	streakyZ: 0.3,
	hotPoss: 4,
	hot: 0.25,
	hotCons: 0.5,
	// Mismatch hunting (Matchup Defense): each offensive player's matchup gap (his defender's fit below the five defenders' mean, plus the
	// size and speed mismatches); the one with the largest gap above huntMin gets × 1 + hunt × (gap - huntMin) / huntScale (up to 1 + hunt).
	// An elite defender (fit above lockRef) takes lock × (fit - lockRef) / lockScale of his man's weight (up to lock)
	huntMin: 0.03,
	huntScale: 0.25,
	hunt: 0.15,
	lockRef: 0.6,
	lockScale: 0.15,
	lock: 0.08,
	// Spacing sag: sag = (sagRef - three-point threat) / sagSpan, 0 to 1. His weight × 1 - sagPass × sag (passed-up open threes), his
	// three-point draw × 1 - sagThree × sag and his rim and post draws × 1 + sagShort × sag
	sagRef: 0.42,
	sagSpan: 0.2,
	sagPass: 0.12,
	sagThree: 0.4,
	sagShort: 0.15,
	// Late shot clock (realistic possession model): a shot with fewer than lateSec seconds left on the shot clock. The lineup's best creator
	// × 1 + lateCreator, the 1st option × 1 + lateFirst; the others' shots are forced (make probability - lateForced)
	lateSec: 5,
	lateCreator: 0.6,
	lateFirst: 0.35,
	lateForced: 0.015,
	// Ego (negative z = diva): × 1 + ego × max(0, -z) × ability. Competitiveness in a close game: × 1 + compete × z
	ego: 0.12,
	compete: 0.06,
	// Role acceptance (negative z = low acceptance) as a role player (4th or 5th in his five): × 1 + roleForce × max(0, -z), and his shots
	// lose roleForceMake × max(0, -z) of make probability
	roleForce: 0.15,
	roleForceMake: 0.012,
	// Catch-and-shoot: the three-point draw of a role player's shot that someone else created × roleThree, an option's × optionThree
	roleThree: 1.03,
	optionThree: 0.97,
	// Game plan: More shots / Fewer shots
	planMore: 1.2,
	planFewer: 0.8,
	// AI game plans: More shots for a team's top scorer when his usage composite is at least aiMoreGap × the 2nd's, Fewer shots for rotation
	// players (top 9 by value) with ability below aiFewerAbility
	aiMoreGap: 1.12,
	aiFewerAbility: 0.1,
	// Double teams: the star's share of the five's weight (before attention) above dblRef doubles him with probability dblK × (share -
	// dblRef), up to dblMax. The ball goes to a teammate by his weight × (1 + kickThreat × three-point threat), as an assisted shot with
	// the three-point draw × kickThree
	dblRef: 0.34,
	dblK: 3,
	dblMax: 0.25,
	kickThreat: 1.5,
	kickThree: 1.2,
	// Defensive attention (Matchup Defense's cap on the shooter draw, ATTENTION.share and excess without the model): the double teams
	// take over part of its job
	attnShare: 0.36,
	attnExcess: 0.6,
	// Star foul drawing: the defense fouls the first options more (they attack the rim and get the whistle), so each player's
	// foul-drawing composite × 1 + foulStar × (ability - the mean ability of his team's top 8 by value - foulOff) (the shooting fouls go
	// with its square). Relative to his team, so league free throws stay about the same whatever the league's talent; foulOff because
	// the better scorers take more of the shots
	foulStar: 0.55,
	foulOff: 0.06,
	// Star shot making: a first option's shots are the ones the offense is built to get him (his spots, screens, matchups), which the
	// defensive attention penalties (Matchup Defense, Star & Clutch Calibration) took back too much of (the top scorers' true shooting was
	// barely above the league's, NBA about +.04-.05): his make probability + starMake × (ability - the mean ability of the five on the
	// court), so league FG% stays about the same
	starMake: 0.14,
	// Calibration, so league shooting stays the same: added to the make probability of every shot from the shooter draw (the stars take
	// more of the shots, and more of them against the help defense), and a multiplier on the three-point draw
	makeCal: 0.009,
	threeCal: 0.97,
};

export type ShotPlan = -1 | 0 | 1;

export const SHOT_PLAN_LABELS: Record<ShotPlan, string> = {
	[-1]: "Fewer shots",
	0: "Normal",
	1: "More shots",
};

export const shotPlanMult = (plan: number | undefined) =>
	plan === 1 ? SHOT_SHARE.planMore : plan === -1 ? SHOT_SHARE.planFewer : 1;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Scoring ability 0 (role player) to 1 (star), from the usage composite
export const scoringAbility = (usage: number) =>
	clamp01(
		(usage - SHOT_SHARE.abilityLo) /
			(SHOT_SHARE.abilityHi - SHOT_SHARE.abilityLo),
	);

// The AI coach's game plans for a roster: More shots for a clear top scorer, Fewer shots for non-scorers in the rotation
export const aiShotPlans = (
	players: {
		id: number;
		valueNoPot: number;
		usage: number;
		injured: boolean;
	}[],
) => {
	const out = new Map<number, ShotPlan>();
	const rotation = players
		.filter((p) => !p.injured)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 9);
	if (rotation.length < 2) {
		return out;
	}
	const byUsage = rotation.toSorted((a, b) => b.usage - a.usage);
	if (byUsage[0]!.usage >= SHOT_SHARE.aiMoreGap * byUsage[1]!.usage) {
		out.set(byUsage[0]!.id, 1);
	}
	for (const p of rotation) {
		if (scoringAbility(p.usage) < SHOT_SHARE.aiFewerAbility) {
			out.set(p.id, -1);
		}
	}
	return out;
};

// A player's on-court share of his team's FGA this season (his FGA per minute over the team's per player-minute), from stats rows
export const onCourtShare = (
	fga: number,
	min: number,
	teamFga: number,
	teamMin: number,
) => (min > 0 && teamFga > 0 ? (fga / min) * (teamMin / 5 / teamFga) : 0);

// Season drift correction: his weight multiplier given his season share and the share expected of his rank on the team
export const driftMult = (share: number, rank: number) => {
	const S = SHOT_SHARE;
	const expected = S.expected[Math.min(rank, S.expected.length - 1)]!;
	const over = share - expected - S.driftTol;
	if (over <= 0) {
		return 1;
	}
	return Math.max(S.driftMin, 1 - S.driftK * over);
};

// Season drift for a roster: player id → multiplier (only players with one below 1), from each player's season FGA and minutes with
// this team
export const seasonDriftMults = (
	players: {
		id: number;
		valueNoPot: number;
		usage: number;
		injured: boolean;
		fga: number;
		min: number;
	}[],
) => {
	const out = new Map<number, number>();
	let teamFga = 0;
	let teamMin = 0;
	for (const p of players) {
		teamFga += p.fga;
		teamMin += p.min;
	}
	if (teamMin < 5 * 48 * 5 || teamFga <= 0) {
		return out;
	}
	const ranked = players
		.filter((p) => !p.injured)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 9)
		.toSorted((a, b) => b.usage - a.usage);
	for (const [rank, p] of ranked.entries()) {
		if (p.min < SHOT_SHARE.driftMinMinutes) {
			continue;
		}
		const mult = driftMult(onCourtShare(p.fga, p.min, teamFga, teamMin), rank);
		if (mult < 1) {
			out.set(p.id, mult);
		}
	}
	return out;
};

// Spacing sag, 0 to 1, from his three-point threat
export const sagOf = (threat: number) =>
	clamp01((SHOT_SHARE.sagRef - threat) / SHOT_SHARE.sagSpan);

// Lineup-relative knee and the softer floor, in place on the five's weights. ability: each one's scoring ability
export const kneeAndFloor = (
	weights: number[],
	ability: readonly number[],
	n: number,
) => {
	const S = SHOT_SHARE;
	let total = 0;
	for (let i = 0; i < n; i++) {
		total += weights[i]!;
	}
	if (total <= 0) {
		return;
	}
	const mean = total / n;
	total = 0;
	for (let i = 0; i < n; i++) {
		const knee = mean * (S.kneeLo + S.kneeSpan * ability[i]!);
		const w = weights[i]!;
		if (w > knee) {
			weights[i] = knee + S.kneeExcess * (w - knee);
		}
		total += weights[i]!;
	}
	for (let i = 0; i < n; i++) {
		const floor =
			S.floorShare * total * (S.floorMin + (1 - S.floorMin) * ability[i]!);
		if (weights[i]! < floor) {
			weights[i] = floor;
		}
	}
};

// Star foul drawing: the multiplier on his foul-drawing composite
export const starFoulMult = (ability: number, teamMean: number) =>
	Math.max(
		0,
		1 + SHOT_SHARE.foulStar * (ability - teamMean - SHOT_SHARE.foulOff),
	);

// Star shot making: added to the make probability of his shots from the shooter draw
export const starMakeDelta = (ability: number, fiveMean: number) =>
	SHOT_SHARE.starMake * (ability - fiveMean);

// Mean scoring ability of a team's top 8 by value (healthy), for starFoulMult
export const rotationMeanAbility = (
	players: { valueNoPot: number; injured: boolean; usage: number }[],
) => {
	const top = players
		.filter((p) => !p.injured)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 8);
	if (top.length === 0) {
		return 0;
	}
	let sum = 0;
	for (const p of top) {
		sum += scoringAbility(p.usage);
	}
	return sum / top.length;
};

// Double teams: the probability that the defense doubles a player with this share of his five's weight
export const doubleTeamProb = (share: number) => {
	const S = SHOT_SHARE;
	return share <= S.dblRef
		? 0
		: Math.min(S.dblMax, S.dblK * (share - S.dblRef));
};

// How much a multiplier m_i on the weights moved player i's share of the draw: his share with it over his share without it (1 = no change)
export const shareEffect = (
	weights: readonly number[],
	mults: readonly number[],
	i: number,
	n: number,
) => {
	let total = 0;
	let without = 0;
	for (let j = 0; j < n; j++) {
		const w = weights[j]!;
		total += w;
		const m = mults[j]!;
		without += m > 0 ? w / m : w;
	}
	if (total <= 0) {
		return 1;
	}
	return (mults[i]! * without) / total;
};
