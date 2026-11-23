// The All-Star Game (and the weekend's other exhibition games: Rising Stars, the tournament's games): a faster pace and less
// defensive effort, so it plays like the real thing, with about 170-190 points a team, more threes and dunks and few free
// throws. Only read when GameSim's allStarGame is true; every other game multiplies by nothing here and draws the same random
// numbers as before (outcomeInvariance.test.ts). Calibration: ASG_CAL=1 src/worker/core/allStar/allStarGame.script.test.ts
export const ALL_STAR_SIM = {
	// Possessions: the pace setting's factor (shorter possessions) and how often a possession is a fast break
	pace: 1.3,
	transition: 1.6,

	// Defensive effort: the share of the team defense's make penalty that is left, blocks, steals and forced turnovers
	defense: 0.6,
	blk: 0.35,
	stl: 0.55,
	tov: 0.75,

	// Fouls: shooting fouls (the old sim's 0.4) and non-shooting fouls
	shootingFoul: 0.15,
	nonShootingFoul: 0.1,

	// Shot selection: more threes, more at the rim (dunks, layups), fewer mid-range jumpers and post-ups
	three: 1.15,
	rim: 1.5,
	mid: 0.6,
	post: 0.35,

	// Make probability bonuses (the old sim's "better shooting in the ASG")
	makeThree: -0.09,
	makeTwo: 0.08,

	// The make probability after everything is capped here and floored at the low end, so no rating mix runs away with it
	makeMax: 0.8,
};

// Minutes plan for an All-Star team by value rank (12 players, 240 minutes): the stars share the floor evenly instead of
// playing starters' minutes
export const ALL_STAR_MINUTES = [
	22, 21, 21, 21, 20, 20, 20, 20, 19, 19, 19, 18,
];
