// Star & Clutch Calibration (the starClutchCal setting of the League extras, see docs/native-features.md). Needs Matchup Defense. Off: none
// of this runs and no random numbers change. Constants only; the sim code is in GameSim (pickShooter, doShot, the clutch hooks)

// Defensive attention by load. Matchup Defense already caps a shooter's share of his five's shot weight above 0.30 and makes his shots
// harder above 0.32 (ATTENTION in matchupDefense.ts), which only the most extreme usage reaches; the multi-season test leagues still had
// the league-leading PER at 34 (NBA 31-32) and BPM at 15 (NBA 11-13), from efficiency: the top players' true shooting was .09-.12 above
// the league's (NBA about .06), with their two-pointers +.10 and threes +.04 over the league. In the NBA a player's shots get harder as
// the defense keys on him. Now each shot loses make * (the shooter's share of the shot draw - ref) above ref, and every shot of that
// five gets back give * the expected loss of the five (the sum over its players of share * loss), since the help comes off the others: a
// five's expected make probability is about unchanged, so team scoring stays put, and the extra difficulty is on its main options.
// No random numbers are added
export const STAR = {
	ref: 0.22,
	make: 0.6,
	give: 1,
};

// Clutch time (the last 5 minutes of the final period or overtime, within 5)
export const CLUTCH = {
	// Multiplier on the powers of the shooter and creator draws
	usage: 1,
	// Change to the make probability of every shot
	make: 0,
	// Multiplier on the three-point share of a team down 3 to 5
	trailThree: 1,
	// A team down 4 to 6 fouls on purpose inside foulAlways seconds, and 30% of the time inside foulSometimes (stock 35 and 60; scaled by
	// the coach's game management with Coaching Systems)
	foulAlways: 35,
	foulSometimes: 60,
};
