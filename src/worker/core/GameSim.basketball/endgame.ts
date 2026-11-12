// End-of-Game Intelligence (the smartEndgame setting of the League extras, see docs/native-features.md): run-stopping timeouts,
// offense/defense substitutions in the last minute, who gets fouled on purpose, fouling when up 3, 2-for-1s in the stock possession
// model (it already holds for the last shot), game management in the clock decisions, and saving the last timeout. Everything here is only used with the setting on; with it off
// GameSim draws exactly the same random numbers as before.

export const ENDGAME = {
	// Run-stopping timeouts: each team has this many for the game on top of the two late-game ones (the NBA's seven), at most
	// maxFinalPeriod of them left for the final period, none in its last noRunTimeoutSeconds or in overtime
	earlyTimeouts: 5,
	maxFinalPeriod: 2,
	noRunTimeoutSeconds: 180,
	// Unanswered points by the opponent before the timeout: 10-0 (a quick-trigger coach, or no coaching systems), 12-0 (other coaches)
	runQuick: 10,
	runPatient: 12,
	// (not with the period about to end, or in a game that is over)
	runMinClock: 30,
	runMaxMargin: 25,
	// A timeout is a breather for the ten on the floor (energy, on the 0-1 scale; about a minute of playing time undone)
	timeoutRest: 0.03,

	// Offense/defense substitutions: final period or overtime, this many seconds left, within this many points
	odSeconds: 60,
	odMargin: 6,
	// How much a specialist's value moves, per unit of role score (composite scale) above the average of the closing pool
	odTilt: 0.8,

	// Intentional fouls: the weight of each player on the floor is (ball weight) * (1 - his free throw probability) ^ power
	foulTargetPower: 4,
	foulTargetBallPower: 0.5,

	// Up 3, the defense fouls before a three can go up: between these many seconds left, this often (more for good game managers)
	up3MaxSeconds: 7,
	up3MinSeconds: 1.5,
	up3Prob: 0.5,
	up3ProbMgmt: 0.35,

	// How often a team holds for the last shot (the realistic model) and goes 2-for-1 (both models), the realistic model's own values
	holdProb: 0.85,
	twoForOneProb: 0.7,
	// Better game managers do both more reliably (per unit of game management, -1 to 1), in either model
	clockMgmt: 0.1,
	// Plays drawn up in a timeout in the last two minutes: the make probability changes by this per unit of game management
	atoMake: 0.03,
	atoSeconds: 120,
};

// Unanswered points before a coach stops the run with a timeout. quickTrigger undefined: no coaching systems
export const runTimeoutThreshold = (quickTrigger: boolean | undefined) =>
	quickTrigger === false ? ENDGAME.runPatient : ENDGAME.runQuick;

// Is a run-stopping timeout available to a team: from the extra ones early, and a quick-trigger coach can spend one of his last two
// on a run in the final period (but not the very last, and not in the last two minutes, when they advance the ball)
export const runTimeoutSource = ({
	early,
	late,
	finalPeriod,
	overtime,
	t,
	quickTrigger,
}: {
	early: number;
	late: number;
	finalPeriod: boolean;
	overtime: boolean;
	t: number;
	quickTrigger: boolean | undefined;
}): "early" | "late" | undefined => {
	if (overtime || t <= ENDGAME.runMinClock) {
		return undefined;
	}
	const closing = finalPeriod && t <= ENDGAME.noRunTimeoutSeconds;
	if (early > 0 && !closing) {
		return "early";
	}
	if (quickTrigger && finalPeriod && !closing && late > 1) {
		return "late";
	}
	return undefined;
};

export type EndgameRole =
	// on offense with the lead (the other team will foul): free throw shooters and ball handlers
	| "protect"
	// on offense, tied or behind by a basket: scorers
	| "score"
	// on offense behind by 3 or more: three point shooters
	| "three"
	// on defense: defenders and rebounders
	| "stop"
	// on defense up 3: perimeter defenders
	| "stopThree";

export const endgameRole = (offense: boolean, margin: number): EndgameRole => {
	if (offense) {
		return margin > 0 ? "protect" : margin <= -3 ? "three" : "score";
	}
	return margin === 3 ? "stopThree" : "stop";
};

type RoleRatings = {
	shootingFT: number;
	shootingThreePointer: number;
	dribbling: number;
	passing: number;
	usage: number;
	defense: number;
	defensePerimeter: number;
	rebounding: number;
};

// How well a player fits the role, on the composite rating scale (0 to 1)
export const endgameRoleScore = (role: EndgameRole, r: RoleRatings) => {
	switch (role) {
		case "protect":
			return 0.6 * r.shootingFT + 0.25 * r.dribbling + 0.15 * r.passing;
		case "score":
			return (
				0.45 * r.usage + 0.3 * r.shootingThreePointer + 0.25 * r.shootingFT
			);
		case "three":
			return 0.65 * r.shootingThreePointer + 0.35 * r.usage;
		case "stop":
			return 0.45 * r.defense + 0.25 * r.defensePerimeter + 0.3 * r.rebounding;
		case "stopThree":
			return 0.35 * r.defense + 0.5 * r.defensePerimeter + 0.15 * r.rebounding;
	}
};

// Values of the closing candidates for the role: each value times 1 + tilt * (his role score - the pool's average), so the lineup
// stays the team's best players with the last spots going to the specialists. mgmt (-1 to 1) is the coach's game management
export const endgameValues = (
	values: number[],
	scores: number[],
	mgmt: number,
) => {
	if (values.length === 0) {
		return values;
	}
	let mean = 0;
	for (const s of scores) {
		mean += s;
	}
	mean /= scores.length;
	const tilt = ENDGAME.odTilt * (1 + 0.25 * mgmt);
	return values.map(
		(v, i) => v * Math.max(0.5, 1 + tilt * (scores[i]! - mean)),
	);
};

// Who gets fouled on purpose: weights for the players on the floor, from who has the ball (the offense's choice) and how badly he
// shoots free throws (the defense's). mgmt is the fouling coach's game management
export const foulTargetWeights = (
	ballWeights: number[],
	ftProbs: number[],
	mgmt: number,
	out: number[],
) => {
	const power = ENDGAME.foulTargetPower * (1 + 0.4 * mgmt);
	for (let i = 0; i < ftProbs.length; i++) {
		out[i] =
			ballWeights[i]! ** ENDGAME.foulTargetBallPower *
			Math.max(0.02, 1 - ftProbs[i]!) ** power;
	}
	return out;
};

// Up 3 on defense with a few seconds left: the chance that the coach has his team foul before a three can go up
export const upThreeFoulProb = (t: number, mgmt: number) => {
	if (t > ENDGAME.up3MaxSeconds || t <= ENDGAME.up3MinSeconds) {
		return 0;
	}
	return Math.min(1, Math.max(0, ENDGAME.up3Prob + ENDGAME.up3ProbMgmt * mgmt));
};

// Late in a game, should the offense keep its last timeout rather than use it to advance the ball: with the game within a basket and
// more than a possession's worth of time left, it is worth more on the final possession
export const saveLastTimeout = (
	timeoutsLeft: number,
	pointDifferential: number,
	t: number,
) => timeoutsLeft === 1 && pointDifferential >= -3 && t >= 25;
