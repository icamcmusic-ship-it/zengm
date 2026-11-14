// Realistic Play Types (the realisticPlayTypes League extra, see docs/native-features.md): moves the sim's play-type mix (as Advanced
// Tracking Stats classifies it) toward the NBA's. Fewer post-ups (the post draw is scaled down, the shots go to drives and pull-ups),
// more self-created possessions for ball handlers (a shooter who can create is sometimes his own creator: pick-and-roll ball handler and
// isolation), more putbacks by the offensive rebounder, a little more transition. It needs the realistic possession model and Spacing &
// Shot Creation (on for new leagues); without them, or with the setting off, nothing here is used and no random number is drawn.
// The league totals stay the same: the make and assist constants re-center them.
export const PLAY_TYPES = {
	// Multiplier on the post-up draw of the two-point shot selection
	post: 0.4,
	// Multiplier on the mid-range draw of self-created shots (pull-ups)
	selfMid: 1.15,
	// Chance that a shooter who is not the creator creates for himself: slope * (his creation composite - min), capped at max
	selfSlope: 2.2,
	selfMin: 0.25,
	selfMax: 0.8,
	// Offensive rebounds: chance of a quick shot (stock 0.34), and the chance that the quick shot is the rebounder's putback
	orbQuick: 0.62,
	orbRebounder: 0.85,
	// Multiplier on the at-rim draw of shots created by someone else (fewer cuts)
	otherRim: 0.6,
	// Multiplier on the half-court search time (the quicker putbacks and transition would otherwise raise the pace)
	halfCourt: 1.06,
	// Multiplier on the transition chances
	transition: 1.2,
	// Multipliers on the three-point draw and the two-point make probability, and on the assisted probability (keep league totals)
	three: 1.14,
	make2: -0.033,
	// Multiplier on the shooting-foul chance of two-point shots (fewer post-ups and more pull-ups would draw fewer free throws)
	foul2: 1.18,
	ast: 1.6,
};
