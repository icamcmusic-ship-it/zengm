// 2K Badges in the game sim (the twoKBadges League Extra, see docs/native-features.md, 2K Badges). Small, bounded effects on top of the
// stock synergy: each badge moves one kind of event a little (a make probability, a block, a rebound, a free throw, a steal), scaled
// by tier (Hall of Fame = the full effect), and a shot's total badge effect is capped. Each effect is then centered by a league
// calibration constant (BADGE_CAL, measured with threeGradient.script.test.ts and BADGE_DIAG over many leagues) so league averages
// stay the same: since tiers are league percentiles, the average badge effect per event is the same in every league. Off (or no player
// with badges): nothing here is used, no random numbers are drawn either way.
import { TIERED_BADGE_INDEX } from "../../../common/tieredBadges/definitions.ts";

// Effect scale of a tier: Bronze ... Legend (Hall of Fame = 1)
export const TIER_SCALE = [0, 0.3, 0.55, 0.8, 1, 1.15] as const;

const I = TIERED_BADGE_INDEX as Record<string, number>;
export const BI = {
	acrobat: I.acrobat!,
	posterizer: I.posterizer!,
	postControl: I.postControl!,
	fearlessFinisher: I.fearlessFinisher!,
	riseUp: I.riseUp!,
	putbackBoss: I.putbackBoss!,
	catchShoot: I.catchShoot!,
	deadeye: I.deadeye!,
	limitlessRange: I.limitlessRange!,
	midRangeMaestro: I.midRangeMaestro!,
	freeThrowAce: I.freeThrowAce!,
	dimer: I.dimer!,
	handles: I.handles!,
	ballSecurity: I.ballSecurity!,
	rimProtector: I.rimProtector!,
	glove: I.glove!,
	clamps: I.clamps!,
	postLockdown: I.postLockdown!,
	boxoutBeast: I.boxoutBeast!,
	reboundChaser: I.reboundChaser!,
};

// Effects at Hall of Fame tier (make probability points unless noted)
export const BADGE_SIM = {
	// Assisted threes
	catchShoot: 0.012,
	// Self-created threes and mid-range jumpers
	deadeye: 0.01,
	// Every three
	limitlessRange: 0.003,
	midRangeMaestro: 0.015,
	// At the rim (finesse) / at the rim (power)
	acrobat: 0.014,
	posterizer: 0.012,
	postControl: 0.022,
	// Putbacks and tip-ins
	putbackBoss: 0.03,
	riseUp: 0.012,
	// The passer of an assisted shot
	dimer: 0.012,
	// His defender on a jumper (or, without matchups, the defense's average)
	clamps: 0.02,
	// The best rim protector on the floor, on shots at the rim and putbacks
	rimProtector: 0.016,
	// Post-ups
	postLockdown: 0.02,
	// Free throw probability
	freeThrowAce: 0.025,
	// Relative: and-one chance at the rim
	fearlessFinisher: 0.2,
	// Relative: block chance on shots at the rim, in the post and putbacks (best rim protector on the floor)
	rimProtectorBlk: 0.12,
	// Defensive rebound probability: the defense's best Boxout Beast / Rebound Chaser against the offense's best Putback Boss / Rebound
	// Chaser
	boxoutBeast: 0.012,
	reboundChaser: 0.006,
	putbackBossOrb: 0.012,
	// Relative: who gets a rebound (pick weight)
	rebWeight: 0.25,
	// Relative: steal chance (the defense's best Glove) and turnovers (the offense's ball handlers' Handles and Ball Security, mean
	// of the floor)
	glove: 0.06,
	ballSecurity: 0.05,
	// A shot's total badge make effect is at most this, either way
	cap: 0.045,
};

// League calibration (subtracted from every event, see above). Measured: the mean raw effect per event, pooled over new random
// leagues with the 2026 preset (threeGradient.script.test.ts with BADGE_DIAG)
export const BADGE_CAL = {
	threePointer: 0.0004,
	midRange: 0.0004,
	atRim: -0.0014,
	lowPost: 0.0014,
	putBack: 0.0002,
	ft: 0.0015,
	blk: 1.0108,
	drb: 0.0003,
	stl: 1.0145,
	tov: 0.997,
	andOne: 1.015,
};

// Diagnostics: sums and counts of the raw effects (calibration)
export const BADGE_DIAG = {
	on: false,
	sum: {} as Record<string, number>,
	n: {} as Record<string, number>,
};
export const badgeDiag = (key: string, x: number) => {
	BADGE_DIAG.sum[key] = (BADGE_DIAG.sum[key] ?? 0) + x;
	BADGE_DIAG.n[key] = (BADGE_DIAG.n[key] ?? 0) + 1;
};

type WithTiers = { bt?: readonly number[] };

/** His effect scale for a badge (0 without it). */
export const tierScale = (p: WithTiers | undefined, i: number) =>
	p?.bt ? TIER_SCALE[p.bt[i]! as 0] : 0;

/** The best scale for a badge among some players. */
export const maxScale = (players: readonly WithTiers[], i: number) => {
	let best = 0;
	for (const p of players) {
		const s = tierScale(p, i);
		if (s > best) {
			best = s;
		}
	}
	return best;
};

/** The mean scale for a badge among some players. */
export const meanScale = (players: readonly WithTiers[], i: number) => {
	if (players.length === 0) {
		return 0;
	}
	let sum = 0;
	for (const p of players) {
		sum += tierScale(p, i);
	}
	return sum / players.length;
};

export type BadgeShotType =
	| "threePointer"
	| "midRange"
	| "atRim"
	| "lowPost"
	| "putBack"
	| "tipIn";

/**
 * The raw badge effect on a shot's make probability (before calibration), capped. shooter, passer (assisted), defender (his man, if
 * matchups are on) and the defense on the floor.
 */
export const shotMakeEffect = (
	type: BadgeShotType,
	shooter: WithTiers,
	passer: WithTiers | undefined,
	defender: WithTiers | undefined,
	defense: readonly WithTiers[],
	selfCreated: boolean,
) => {
	const k = BADGE_SIM;
	let x = 0;
	if (type === "threePointer") {
		x += k.limitlessRange * tierScale(shooter, BI.limitlessRange);
		x += passer
			? k.catchShoot * tierScale(shooter, BI.catchShoot)
			: selfCreated
				? k.deadeye * tierScale(shooter, BI.deadeye)
				: 0;
	} else if (type === "midRange") {
		x += k.midRangeMaestro * tierScale(shooter, BI.midRangeMaestro);
		if (!passer && selfCreated) {
			x += k.deadeye * 0.5 * tierScale(shooter, BI.deadeye);
		}
	} else if (type === "atRim") {
		x += k.acrobat * tierScale(shooter, BI.acrobat);
		x += k.posterizer * tierScale(shooter, BI.posterizer);
		x -= k.rimProtector * maxScale(defense, BI.rimProtector);
	} else if (type === "lowPost") {
		x += k.postControl * tierScale(shooter, BI.postControl);
		x -=
			k.postLockdown *
			(defender
				? tierScale(defender, BI.postLockdown)
				: maxScale(defense, BI.postLockdown) * 0.5);
	} else {
		// Putbacks and tip-ins
		x += k.putbackBoss * tierScale(shooter, BI.putbackBoss);
		x += k.riseUp * tierScale(shooter, BI.riseUp);
		x -= k.rimProtector * maxScale(defense, BI.rimProtector);
	}
	if (type === "threePointer" || type === "midRange") {
		x -=
			k.clamps *
			(defender
				? tierScale(defender, BI.clamps)
				: meanScale(defense, BI.clamps));
	}
	if (passer) {
		x += k.dimer * tierScale(passer, BI.dimer);
	}
	return x > k.cap ? k.cap : x < -k.cap ? -k.cap : x;
};

export const calKey = (type: BadgeShotType) =>
	type === "tipIn" ? "putBack" : type;
