import type { Rng } from "./rng.ts";

// A typical Division I team's averages per game (modern era), used as the league and opponent for advanced stats, since a lone prospect's season is not played against a simulated league here
const LG = {
	pts: 73.6,
	fg: 25.9,
	fga: 57.5,
	ft: 12.2,
	fta: 17.5,
	orb: 10,
	drb: 23.2,
	ast: 13.5,
	tov: 11.6,
	pf: 16.6,
	opp2pa: 36.5,
	pace: 68,
};

const FT_TRIP = 0.44;

const PRLS: Record<string, number> = {
	PG: 11,
	G: 10.75,
	SG: 10.5,
	GF: 10.5,
	SF: 10.5,
	F: 11,
	PF: 11.5,
	FC: 11.05,
	C: 10.6,
};

const fix = (x: number) => (Number.isFinite(x) ? x : 0);

type UPERInput = {
	min: number;
	tp: number;
	ast: number;
	fg: number;
	ft: number;
	tov: number;
	fga: number;
	fta: number;
	trb: number;
	orb: number;
	stl: number;
	blk: number;
	pf: number;
};

// BBGM's (Hollinger's) unadjusted PER, against league averages
const uPER = (s: UPERInput) => {
	if (s.min <= 0) {
		return 0;
	}
	const lgTrb = LG.orb + LG.drb;
	const factor = 2 / 3 - (0.5 * (LG.ast / LG.fg)) / (2 * (LG.fg / LG.ft));
	const vop = LG.pts / (LG.fga - LG.orb + LG.tov + FT_TRIP * LG.fta);
	const drbp = (lgTrb - LG.orb) / lgTrb;
	const tAstFg = LG.ast / LG.fg;
	return (
		(1 / s.min) *
		(s.tp +
			(2 / 3) * s.ast +
			(2 - factor * tAstFg) * s.fg +
			s.ft * 0.5 * (1 + (1 - tAstFg) + (2 / 3) * tAstFg) -
			vop * s.tov -
			vop * drbp * (s.fga - s.fg) -
			vop * FT_TRIP * (0.44 + 0.56 * drbp) * (s.fta - s.ft) +
			vop * (1 - drbp) * (s.trb - s.orb) +
			vop * drbp * s.orb +
			vop * s.stl +
			vop * drbp * s.blk -
			s.pf * (LG.ft / LG.pf - FT_TRIP * (LG.fta / LG.pf) * vop))
	);
};

// A league average player, per minute: the whole team's per game stats over its 200 minutes (scaled to the game length below)
const lgUPERPerMinute = uPER({
	min: 1,
	tp: 7.5 / 200,
	ast: LG.ast / 200,
	fg: LG.fg / 200,
	ft: LG.ft / 200,
	tov: LG.tov / 200,
	fga: LG.fga / 200,
	fta: LG.fta / 200,
	trb: (LG.orb + LG.drb) / 200,
	orb: LG.orb / 200,
	stl: 6.3 / 200,
	blk: 3.5 / 200,
	pf: LG.pf / 200,
});

export const getEWA = (
	per: number,
	min: number,
	pos: string,
	gameLengthFactor: number,
) => {
	const prl = PRLS[pos] ?? 10.75;
	const va = (min * (per - prl)) / 67 / gameLengthFactor;
	return (va / 30) * 0.8;
};

/**
 * Derived stats BBGM stores in a stats row, for a season of totals, measured against an average Division I team. These are approximations of BBGM's own formulas (which need a whole simulated league to normalize against) but they use the same ingredients, so they read like the real thing and move the right way.
 */
export const calculateAdvanced = (
	s: Record<string, number>,
	{
		pos,
		gameMinutes,
		teamGames,
		rng,
		z,
	}: {
		pos: string;
		gameMinutes: number;
		teamGames: number;
		strength: number;
		rng: Rng;
		z: number;
	},
) => {
	const min = s.min!;
	const gp = s.gp!;
	const trb = s.orb! + s.drb!;

	if (min <= 0 || gp <= 0) {
		return {};
	}

	// Per game of the team's game length, scaled from the 40 minute averages above
	const lenFactor = gameMinutes / 40;
	// Minutes he'd have to play to be on the floor for a full game, summed
	const teamMinOver5 = gameMinutes * gp;
	const minShare = min / teamMinOver5;

	const teamFG = LG.fg * gp * lenFactor;
	const teamFGA = LG.fga * gp * lenFactor;
	const teamFTA = LG.fta * gp * lenFactor;
	const teamTOV = LG.tov * gp * lenFactor;
	const oppPoss = LG.pace * gp * lenFactor;

	const usgp =
		(100 * (s.fga! + FT_TRIP * s.fta! + s.tov!)) /
		(minShare * (teamFGA + FT_TRIP * teamFTA + teamTOV));
	const astp = (100 * s.ast!) / (minShare * teamFG - s.fg!);
	const orbp = (100 * s.orb!) / (minShare * (LG.orb + LG.drb) * gp * lenFactor);
	const drbp = (100 * s.drb!) / (minShare * (LG.orb + LG.drb) * gp * lenFactor);
	const trbp =
		(100 * trb) /
		(minShare * (LG.orb + LG.drb + LG.orb + LG.drb) * gp * lenFactor);
	const stlp = (100 * s.stl!) / (minShare * oppPoss);
	const blkp = (100 * s.blk!) / (minShare * LG.opp2pa * gp * lenFactor);

	const possOnFloor = (LG.pace * lenFactor * min) / gameMinutes;
	const pm100 = (100 * s.pm!) / possOnFloor;
	const onOff100 = 0.8 * pm100 + rng.normal(0, 1.4);

	// PER, normalized so the league average player is 15
	const u = uPER({
		min,
		tp: s.tp!,
		ast: s.ast!,
		fg: s.fg!,
		ft: s.ft!,
		tov: s.tov!,
		fga: s.fga!,
		fta: s.fta!,
		trb,
		orb: s.orb!,
		stl: s.stl!,
		blk: s.blk!,
		pf: s.pf!,
	});
	const per = (15 * u) / lgUPERPerMinute;
	const ewa = getEWA(per, min, pos, gameMinutes / 48);

	// Offensive and defensive rating
	const possUsed = s.fga! + FT_TRIP * s.fta! + s.tov! + 0.1 * s.ast!;
	const ortg = (100 * (s.pts! + 0.6 * s.ast!)) / possUsed;
	const per40 = (x: number) => (x / min) * 40;
	const drtg =
		104 -
		1.2 * z -
		1.3 * per40(s.stl!) -
		0.9 * per40(s.blk!) -
		0.3 * (per40(s.drb!) - 5);

	// Win shares, as BBR does them: marginal points over 92% of a league average offense, divided by points per win
	const pointsPerWin = 0.32 * LG.pts * lenFactor;
	const marginalOffense =
		s.pts! +
		0.6 * s.ast! -
		0.92 * (LG.pts / (LG.fga - LG.orb + LG.tov + FT_TRIP * LG.fta)) * possUsed;
	const ows = marginalOffense / pointsPerWin;
	const defPoss = (min * LG.pace * lenFactor) / (gameMinutes * 5);
	const dws = (defPoss * (1.12 - drtg / 100)) / pointsPerWin;

	// Box plus/minus and VORP
	const bpm = 0.5 * (per - 15) - 0.3;
	const obpm = bpm * 0.62 + 0.02 * (ortg - 105);
	const dbpm = bpm - obpm;
	const vorp =
		(bpm + 2) * (min / (5 * gameMinutes * teamGames)) * (teamGames / 82);

	return {
		per: fix(per),
		ewa: fix(ewa),
		astp: fix(astp),
		blkp: fix(blkp),
		drbp: fix(drbp),
		orbp: fix(orbp),
		stlp: fix(stlp),
		trbp: fix(trbp),
		usgp: fix(usgp),
		drtg: fix(drtg),
		ortg: fix(ortg),
		pm100: fix(pm100),
		onOff100: fix(onOff100),
		dws: fix(dws),
		ows: fix(ows),
		obpm: fix(obpm),
		dbpm: fix(dbpm),
		vorp: fix(vorp),
	};
};
