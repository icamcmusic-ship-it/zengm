// Matchup Defense (the matchupDefense League extra, see docs/native-features.md). Off: nothing here is used, and the sim draws exactly the
// random numbers it did before.
//
// At each substitution the defense assigns its players to the offense greedily over the 5×5 grid of offensive threat × defender fit
// (perimeter defense against guards and wings, interior defense, height and length against bigs). A shot is then defended 55% by the
// player guarding the shooter and 45% by the team (help defense), and size and speed mismatches tilt the shot selection: post-ups against
// smaller defenders, drives against slower ones. Switching defenses with versatile defenders feel mismatches less, drop coverage gives up
// pull-up jumpers.

export const MATCHUP = {
	// Share of the shot defense from the shooter's own defender (the rest is the team's, help defense)
	share: 0.55,
	// Height rating range from a wing (0) to a big (1), for which defense a defender needs against him
	bigLo: 45,
	bigHi: 65,
	// Size mismatch: post-ups (the low post draw) × 1 + post × (height gap − postGap) / postScale, up to 1 + post
	postGap: 12,
	postScale: 20,
	post: 0.6,
	// Speed mismatch: drives (the at-rim draw) × 1 + drive × (speed gap − driveGap) / driveScale, up to 1 + drive
	driveGap: 14,
	driveScale: 25,
	drive: 0.4,
	// League averages of the two multipliers above (they divide them, so the league shot mix stays the same)
	postNorm: 1.054,
	driveNorm: 1.024,
	// Mismatch relief: Switch Everything with a versatile team (up to this much, half for an average team), and each defender's own
	// defensive versatility (per trait z-score)
	switchRelief: 0.6,
	versatilityRelief: 0.15,
	// A switching defense matches up less by size (the weight of the attacker's size in the fit)
	switchSizeWeight: 0.5,
	// Drop coverage: pull-up mid-range jumpers (self-created) are chosen more often and go in a little more often
	dropPullUpSelect: 1.15,
	dropPullUpMake: 0.015,
	// Make probability centers by shot type: the average matchup advantage of the defense on such a shot (the best perimeter defenders
	// guard the biggest threats), so league shooting stays the same
	centerThree: 0.0085,
	centerMid: 0.006,
	centerRim: 0.0035,
	centerPost: -0.001,
};

// Defensive attention (attentionCap in index.ts): no player's share of the weight of the shooter or creator draw of his five gets above
// share at full strength; only excess of the weight above it counts. Ordinary stars stay below it, so it only takes over in the compounding
// of usage boosts (coach systems, creation, Realistic Rotations' fresher stars) that made one player take 30 shots a game
export const ATTENTION = {
	share: 0.3,
	excess: 0.5,
	// Help defense: his shots go in this much less often per unit of his share of the shooter draw (before the cap) above makeRef
	make: 0.8,
	makeRef: 0.32,
};

export type MatchupPlayer = {
	compositeRating: {
		usage: number;
		defensePerimeter: number;
		defenseInterior: number;
	};
	simHgt?: number;
	simSpd?: number;
	// Sub-Ratings in Sim: lateral quickness, his speed as the defender of a drive
	simLat?: number;
	traitEffects?: { switchDefenseContribution: number };
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// 0 for a guard or wing, 1 for a big
export const bigness = (p: MatchupPlayer) =>
	clamp01(((p.simHgt ?? 50) - MATCHUP.bigLo) / (MATCHUP.bigHi - MATCHUP.bigLo));

// How well defender d fits guarding attacker a
export const defenderFit = (
	d: MatchupPlayer,
	a: MatchupPlayer,
	sizeWeight = 1,
) => {
	const b = bigness(a) * sizeWeight + 0.5 * (1 - sizeWeight);
	return (
		(1 - b) * d.compositeRating.defensePerimeter +
		b * d.compositeRating.defenseInterior
	);
};

// Greedy assignment over the grid of offensive threat × defender fit: the best pair first, then the best of what is left. Returns, for
// each offensive player (by his index on the court), the index of his defender
export const assignMatchups = (
	offense: MatchupPlayer[],
	defense: MatchupPlayer[],
	switching: boolean,
	out: number[] = [],
) => {
	const n = Math.min(offense.length, defense.length);
	const sizeWeight = switching ? MATCHUP.switchSizeWeight : 1;
	const scores: number[] = [];
	for (let j = 0; j < n; j++) {
		const threat = offense[j]!.compositeRating.usage;
		for (let i = 0; i < n; i++) {
			scores[j * n + i] =
				threat * defenderFit(defense[i]!, offense[j]!, sizeWeight);
		}
	}
	let usedO = 0;
	let usedD = 0;
	out.length = offense.length;
	for (let k = 0; k < n; k++) {
		let best = -Infinity;
		let bestJ = 0;
		let bestI = 0;
		for (let j = 0; j < n; j++) {
			if (usedO & (1 << j)) {
				continue;
			}
			for (let i = 0; i < n; i++) {
				if (usedD & (1 << i)) {
					continue;
				}
				const s = scores[j * n + i]!;
				if (s > best) {
					best = s;
					bestJ = j;
					bestI = i;
				}
			}
		}
		usedO |= 1 << bestJ;
		usedD |= 1 << bestI;
		out[bestJ] = bestI;
	}
	// (more offensive players than defenders: the extra ones are guarded by the first defender)
	for (let j = n; j < offense.length; j++) {
		out[j] = 0;
	}
	return out;
};

// How much a defender relieves mismatches: his own versatility, and in a switching defense the team's
export const mismatchScale = (
	defender: MatchupPlayer,
	switching: boolean,
	teamVersatility: number,
) => {
	const own = defender.traitEffects?.switchDefenseContribution ?? 0;
	let relief = MATCHUP.versatilityRelief * (own < -1 ? -1 : own > 1 ? 1 : own);
	if (switching) {
		relief += MATCHUP.switchRelief * clamp01(0.5 + teamVersatility / 2);
	}
	const scale = 1 - relief;
	return scale < 0.2 ? 0.2 : scale > 1.3 ? 1.3 : scale;
};

// Selection multipliers for a mismatch: post-ups by the height gap, drives by the speed gap
export const postMismatch = (
	attacker: MatchupPlayer,
	defender: MatchupPlayer,
) =>
	MATCHUP.post *
	clamp01(
		((attacker.simHgt ?? 50) - (defender.simHgt ?? 50) - MATCHUP.postGap) /
			MATCHUP.postScale,
	);
export const driveMismatch = (
	attacker: MatchupPlayer,
	defender: MatchupPlayer,
) =>
	MATCHUP.drive *
	clamp01(
		((attacker.simSpd ?? 50) -
			(defender.simLat ?? defender.simSpd ?? 50) -
			MATCHUP.driveGap) /
			MATCHUP.driveScale,
	);
