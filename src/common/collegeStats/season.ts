import type { LeagueEnv } from "./overseas.ts";
import { ballSecurityBase } from "../expandedRatings.ts";
import { COMPOSITE_WEIGHTS } from "../constants.basketball.ts";
import { calculateAdvanced } from "./advanced.ts";
import { clamp, type Rng } from "./rng.ts";
import type { CollegeSeason, GameBox, Ratings } from "./types.ts";
import { SUB_INDEX } from "../subRatings.ts";

// Sub-ratings (the subRatings setting): how far a sub is from its base (0 without sub-ratings), so production follows the shape of his
// game while his bases keep their effect. Deterministic: no extra random numbers
const subDev = (ratings: Ratings, key: string) =>
	ratings.subOff === undefined ? 0 : ratings.subOff[SUB_INDEX[key]!]!;

/**
 * The college season model. This is a per-player rate model, in the spirit of (and with the anchors of) the BBGM Draft Class Workshop's stat model, but without simulating a whole league of college teams around the prospect: possessions used come from a usage rate, turnovers, free throw rate, shot mix and shooting percentages come from the Workshop's height-bucketed draft-year anchors adjusted by the prospect's ratings, and the season is built game by game so that totals, season highs and double-double counts are all consistent with each other.
 */

// Bumped when generation changes enough that stored prospects' stats should be made again (see upgradeCollegeStats in worker/core/draft/generateCollegeStats.ts). 2: no forward projection of classes years away, rebounds/blocks lean more on the matching ratings
// 3: the sub-ratings (the subRatings setting) move blocks, steals, 3PA rate and 3P%, assists, turnovers and the ORB/DRB split. Only
// prospects generated with sub-ratings are marked 3 (COLLEGE_STATS_VERSION); with the setting off generation is unchanged and stays 2
// (COLLEGE_STATS_VERSION_BASE), and turning it on remakes undrafted prospects' stats once
export const COLLEGE_STATS_VERSION = 3;
export const COLLEGE_STATS_VERSION_BASE = 2;

// Division I averages (modern era), per team game
export const PACE = 68; // possessions
export const CHANCE_MULT = 1.147; // scoring chances per possession (offensive rebounds restart a chance)
export const POSS_FT = 0.475;

// Workshop's height table, by "bigness" (0 = smallest guards, 1 = 7-footers)
const HEIGHT_TABLE = [
	{
		b: 0.05,
		share3: 0.389,
		ftr: 0.367,
		ftPct: 0.779,
		rimPct: 0.588,
		midPct: 0.365,
		tov: 0.178,
	},
	{
		b: 0.35,
		share3: 0.37,
		ftr: 0.362,
		ftPct: 0.738,
		rimPct: 0.64,
		midPct: 0.358,
		tov: 0.168,
	},
	{
		b: 0.7,
		share3: 0.177,
		ftr: 0.431,
		ftPct: 0.7,
		rimPct: 0.69,
		midPct: 0.371,
		tov: 0.174,
	},
	{
		b: 0.95,
		share3: 0.085,
		ftr: 0.511,
		ftPct: 0.68,
		rimPct: 0.715,
		midPct: 0.396,
		tov: 0.172,
	},
] as const;

type HeightKey = Exclude<keyof (typeof HEIGHT_TABLE)[number], "b">;

const byHeight = (key: HeightKey, b: number) => {
	const first = HEIGHT_TABLE[0];
	if (b <= first.b) {
		return first[key];
	}
	for (let i = 1; i < HEIGHT_TABLE.length; i++) {
		const lo = HEIGHT_TABLE[i - 1]!;
		const hi = HEIGHT_TABLE[i]!;
		if (b <= hi.b) {
			const t = (b - lo.b) / (hi.b - lo.b);
			return lo[key] + t * (hi[key] - lo[key]);
		}
	}
	return HEIGHT_TABLE.at(-1)![key];
};

export const composite = (
	ratings: Ratings,
	name: keyof typeof COMPOSITE_WEIGHTS,
) => {
	const info = COMPOSITE_WEIGHTS[name]!;
	let numerator = 0;
	let denominator = 0;
	for (const [i, component] of info.ratings.entries()) {
		const weight = info.weights?.[i] ?? 1;
		const value =
			typeof component === "number"
				? component
				: (ratings[component as keyof Ratings] as number);
		numerator += value * weight;
		denominator += 100 * weight;
	}
	return clamp(numerator / denominator, 0, 1);
};

export const getBigness = (ratings: Ratings) =>
	clamp((ratings.hgt - 30) / 55, 0, 1);

// How a draft prospect's rating drops going back a year. Young players grow faster
export const backProject = (
	ratings: Ratings,
	yearsBack: number,
	age: number,
) => {
	if (yearsBack <= 0) {
		return ratings;
	}
	const out = { ...ratings };
	for (const key of Object.keys(out) as (keyof Ratings)[]) {
		// Sub-ratings are stored as offsets from their bases, so they go back with them
		if (key === "hgt" || key === "wng" || typeof out[key] !== "number") {
			continue;
		}
		let shift = 0;
		for (let i = 0; i < yearsBack; i++) {
			const ageThen = age - i;
			// Typical yearly growth in a BBGM young player's ratings
			shift +=
				ageThen <= 19 ? 4.2 : ageThen === 20 ? 3.2 : ageThen === 21 ? 2.4 : 1.6;
		}
		// Physical ratings change less than skill ratings
		const factor =
			key === "spd" || key === "jmp" || key === "stre" || key === "endu"
				? 0.55
				: 1;
		out[key] = Math.max(0, out[key]! - shift * factor);
	}
	return out;
};

const TYPICAL = {
	usage: 0.43,
	usageSd: 0.09,
};

export type SeasonContext = {
	season: number;
	rng: Rng;
	ratings: Ratings;
	// Class-relative talent, around 0 (>0 means better than the class average) for the season being generated
	zTalent: number;
	// 0 freshman ... 3 senior
	classIndex: number;
	school: string;
	conference: string | undefined;
	strength: number;
	gameMinutes: number;
	// How much random variation in stats, 1 is normal
	noise: number;
	// Fraction of the average Division I rotation player's talent this season is against; only a small shift in efficiency
	era?: number;
	pos: string;
	// For a season at a pro club (overseas or G League): the league's pace, minutes and season length, and his age that season
	proEnv?: LeagueEnv;
	age?: number;
	// From the college season model (ncaa.ts): his team's games, the last postseasonGames of them being the conference and NCAA tournament games, which he always plays
	teamGames?: number;
	postseasonGames?: number;
	// Also from the college season model: how many of his team's regular season games were conference games (played after the non-conference games)
	confGames?: number;
	// Hooks of the career model (career.ts). Without them nothing changes
	// Minutes per game above or below what his talent gets him (buried on the bench at a big program, the star of a small one)
	mpgShift?: number;
	// Usage above or below, in standard deviations
	usageShift?: number;
	// A season cut short (injury, medical redshirt): he plays only this many games, the first ones of the season, and none of the postseason
	gamesCap?: number;
};

// A stretch of games (non-conference, conference) summed up
export type SplitLine = Pick<
	GameBox,
	| "min"
	| "pts"
	| "orb"
	| "drb"
	| "ast"
	| "stl"
	| "blk"
	| "tov"
	| "fg"
	| "fga"
	| "tp"
	| "tpa"
	| "ft"
	| "fta"
	| "pf"
> & { gp: number };

export const sumSplit = (boxes: GameBox[]): SplitLine => {
	const out: SplitLine = {
		gp: boxes.length,
		min: 0,
		pts: 0,
		orb: 0,
		drb: 0,
		ast: 0,
		stl: 0,
		blk: 0,
		tov: 0,
		fg: 0,
		fga: 0,
		tp: 0,
		tpa: 0,
		ft: 0,
		fta: 0,
		pf: 0,
	};
	for (const box of boxes) {
		for (const key of Object.keys(out) as (keyof SplitLine)[]) {
			if (key !== "gp") {
				out[key] += box[key];
			}
		}
	}
	out.min = Math.round(out.min);
	return out;
};

const emptyBox = (): GameBox => ({
	min: 0,
	fg: 0,
	fga: 0,
	fgAtRim: 0,
	fgaAtRim: 0,
	fgLowPost: 0,
	fgaLowPost: 0,
	fgMidRange: 0,
	fgaMidRange: 0,
	tp: 0,
	tpa: 0,
	ft: 0,
	fta: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	tov: 0,
	stl: 0,
	blk: 0,
	ba: 0,
	pf: 0,
	pts: 0,
	pm: 0,
});

export const gameScore = (g: {
	pts: number;
	fg: number;
	fga: number;
	fta: number;
	ft: number;
	orb: number;
	drb: number;
	stl: number;
	ast: number;
	blk: number;
	pf: number;
	tov: number;
}) =>
	g.pts +
	0.4 * g.fg -
	0.7 * g.fga -
	0.4 * (g.fta - g.ft) +
	0.7 * g.orb +
	0.3 * g.drb +
	g.stl +
	0.7 * g.ast +
	0.7 * g.blk -
	0.4 * g.pf -
	g.tov;

const MAX_KEYS = [
	"min",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"pm",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"ba",
	"pf",
	"pts",
] as const;

export const simulateSeason = (ctx: SeasonContext): CollegeSeason => {
	const { rng, ratings, noise, gameMinutes } = ctx;
	const z = ctx.zTalent;
	const c = ctx.classIndex;
	const b = getBigness(ratings);
	const ln = (sd: number) =>
		Math.exp(rng.normal(0, sd * noise) - 0.5 * (sd * noise) ** 2);

	// How good the schedule is. Harder leagues shave efficiency a little
	const compAdj = -0.0022 * (ctx.strength - 70) * 0.5;

	// Games, availability and minutes
	const proEnv = ctx.proEnv;
	const drawnTeamGames = proEnv
		? Math.round(
				clamp(
					rng.normal(proEnv.games, 2 * noise),
					Math.max(8, proEnv.games - 8),
					proEnv.games + 8,
				),
			)
		: Math.round(clamp(rng.normal(34.5, 2.4 * noise), 28, 41));
	const teamGames = ctx.teamGames ?? drawnTeamGames;
	const teamPostseason = Math.min(ctx.postseasonGames ?? 0, teamGames);
	const capped = ctx.gamesCap !== undefined;
	// His own postseason games: none when his season ended early
	const postseasonGames = capped ? 0 : teamPostseason;
	let missed =
		rng.random() < 0.34 ? Math.round(Math.abs(rng.normal(0, 3.5)) + 1) : 0;
	missed = Math.min(missed, 18);
	// Role on his college team: a class-average prospect is a rotation player around 25 minutes, the best of the class are 30-34 minute stars, the bottom of the class (and young players) come off the bench. Real Division I starters rarely average more than 35
	const mpgBase =
		25.5 * (gameMinutes / 40) +
		4.8 * z +
		[-2.6, -0.8, 0.7, 1.6][clamp(c, 0, 3)]! +
		0.04 * (ratings.endu - 45) +
		rng.normal(0, 2.6 * noise) +
		(ctx.mpgShift ?? 0);
	// A teenager at a pro club does not play college star minutes
	const proCap = proEnv
		? (ctx.age ?? 21) <= 20 && proEnv.youthCap !== undefined
			? proEnv.youthCap
			: proEnv.mpgCap
		: Infinity;
	const mpg = clamp(
		proEnv ? mpgBase + proEnv.minShift * (gameMinutes / 40) : mpgBase,
		7,
		Math.min(proCap, 35.5 * (gameMinutes / 40)),
	);
	const dnp = mpg < 17 ? Math.round(rng.random() * 5) : 0;
	const gp = capped
		? clamp(
				Math.round(ctx.gamesCap!),
				1,
				Math.max(1, teamGames - teamPostseason),
			)
		: Math.min(
				teamGames,
				Math.max(4, postseasonGames + 2, teamGames - missed - dnp),
			);
	if (capped) {
		missed = teamGames - gp;
	}
	// Full-time starters start every game they play (bar a rare one off the bench); part-time starters vary
	const startShare = clamp((mpg - 17) / 11, 0, 1);
	const gs =
		startShare >= 1
			? gp - (rng.random() < 0.15 ? 1 : 0)
			: Math.min(gp, Math.round(gp * startShare * (0.85 + 0.3 * rng.random())));

	// Usage: the share of his team's scoring chances he finishes while on the floor
	const usageComp = composite(ratings, "usage");
	const zUsage = (usageComp - TYPICAL.usage) / TYPICAL.usageSd;
	const zU = 0.6 * zUsage + 0.4 * z + (ctx.usageShift ?? 0);
	const usgRaw =
		0.262 +
		(proEnv?.usageShift ?? 0) +
		0.044 * zU +
		0.0045 * (c - 1.5) +
		rng.normal(0, 0.02 * noise);
	// Diminishing returns at the top: only a handful of Division I players use a third of their team's possessions
	const usg = clamp(
		usgRaw > 0.29 ? 0.29 + 0.55 * (usgRaw - 0.29) : usgRaw,
		0.13,
		0.34,
	);

	// Turnovers: share of possessions
	const tovComp = composite(ratings, "turnovers");
	const tovRate = clamp(
		byHeight("tov", b) * (1 - 0.012 * (c - 1.5)) +
			0.1 * (tovComp - 0.44) -
			// Expanded ratings: ball security beyond what his handle and IQ say
			(ratings.bsc === undefined
				? // Sub-ratings: Ball Security (with expanded ratings it follows bsc, already counted)
					0.003 * subDev(ratings, "sec")
				: 0.0035 * (ratings.bsc - ballSecurityBase(ratings))) +
			rng.normal(0, 0.014 * noise),
		0.08,
		0.27,
	);

	// Free throw rate: grows with size, foul drawing skill moves it around that
	const drawing = composite(ratings, "drawingFouls");
	const ftRate = clamp(
		byHeight("ftr", b) * 1.0 +
			0.32 * (drawing - (0.42 + 0.11 * b)) +
			// Attacking the rim (dunks, post moves) gets him fouled
			0.003 * ((ratings.dnk + ratings.ins) / 2 - 45) +
			rng.normal(0, 0.045 * noise),
		0.1,
		0.75,
	);

	// Shot mix: 3PA share by height, stretched by shooting talent, and zero for someone who can't shoot
	// A typical shooter (tp around 40) takes his height's share, a non-shooter (tp 25 or less) almost none, a sniper up to 1.7 times as many; a big who can shoot gets a few more on top of his height's small share
	const willing = clamp((ratings.tp - 22) / 15, 0, 1.7);
	const share3 = clamp(
		(byHeight("share3", b) * willing +
			0.004 * Math.max(0, ratings.tp - 50) * b) *
			// Expanded ratings: spot-up shooters take more of their shots from three, shot creators more pull-up twos
			(ratings.csh === undefined || ratings.dsh === undefined
				? 1
				: clamp(1 + 0.012 * (ratings.csh - ratings.dsh), 0.7, 1.3)) *
			// Sub-ratings: range takes more threes, catch-and-shoot a little more
			clamp(
				1 + 0.014 * subDev(ratings, "rng") + 0.006 * subDev(ratings, "tcs"),
				0.7,
				1.35,
			) +
			// The random part shrinks with his willingness too, so a non-shooter stays a non-shooter
			rng.normal(0, 0.025 * noise) * Math.min(1, willing),
		0,
		0.6,
	);
	const atRimComp = composite(ratings, "shootingAtRim");
	const shareRim = clamp(
		0.34 +
			0.4 * b +
			0.25 * (atRimComp - (0.3 + 0.32 * b)) +
			rng.normal(0, 0.03 * noise),
		0.2,
		0.85,
	);
	const shareLow = clamp(
		0.03 + 0.17 * b * (ratings.ins / 55) + rng.normal(0, 0.02 * noise),
		0,
		0.3,
	);
	const shareMidOfTwos = Math.max(0.08, 1 - shareRim - shareLow);
	const norm = shareRim + shareLow + shareMidOfTwos;

	// Efficiency: talent, class year, and the prospect premium (a draft prospect finishes better than the average rotation player), minus a volume tax for high usage
	const loadAdj =
		-0.3 * (usg - 0.245) * 0.35 - 0.85 * Math.max(0, usg - 0.3) * 0.35;
	const eff =
		0.0125 * z +
		0.006 * (c - 1.5) +
		compAdj +
		loadAdj +
		0.03 +
		rng.normal(0, 0.008 * noise);
	// D1 shoots about 34%; even the best shooting prospects rarely sustain much over 40%
	const tpPct = clamp(
		0.336 +
			0.0042 * (ratings.tp - 40) +
			0.0005 * (ratings.oiq - 40) +
			// Expanded ratings: most college threes are catch-and-shoot
			(ratings.csh === undefined ? 0 : 0.0012 * (ratings.csh - ratings.tp)) +
			// Sub-ratings: catch-and-shoot makes them, range a little
			0.0014 * subDev(ratings, "tcs") +
			0.0006 * subDev(ratings, "rng") +
			0.35 * eff,
		0.15,
		0.47,
	);
	const rimPct = clamp(
		byHeight("rimPct", b) + 0.3 * (atRimComp - (0.3 + 0.32 * b)) + eff,
		0.4,
		0.75,
	);
	const lowPct = clamp(
		0.47 + 0.0035 * (ratings.ins - 45) + 0.0004 * (ratings.hgt - 50) + eff,
		0.3,
		0.66,
	);
	const midPct = clamp(
		byHeight("midPct", b) +
			0.003 * (ratings.fg - 40) +
			0.001 * (ratings.oiq - 40) +
			eff,
		0.22,
		0.55,
	);
	const ftPct = clamp(
		byHeight("ftPct", b) + 0.0045 * (ratings.ft - 45),
		0.4,
		0.95,
	);

	// Everything else, per 40 minutes
	const trb40 = clamp(
		3.2 +
			0.15 * (ratings.hgt - 30) +
			0.13 * (ratings.reb - 30) +
			0.02 * (ratings.jmp - 50) +
			(ratings.wng === undefined ? 0 : 0.04 * (ratings.wng - ratings.hgt)) +
			rng.normal(0, 0.7 * noise),
		2.4,
		16,
	);
	const orbShare =
		ratings.oreb === undefined || ratings.dreb === undefined
			? // Sub-ratings: offensive vs defensive rebounding (with expanded ratings they follow oreb/dreb, already counted)
				clamp(
					0.17 +
						0.13 * b +
						0.006 * (subDev(ratings, "orb") - subDev(ratings, "drd")),
					0.05,
					0.5,
				)
			: // Expanded ratings: offensive vs defensive rebounding moves the split
				clamp(
					0.17 + 0.13 * b + 0.006 * (ratings.oreb - ratings.dreb),
					0.05,
					0.5,
				);
	const orb40 = trb40 * orbShare;
	const drb40 = trb40 - orb40;
	const ast40 = clamp(
		// Bigs get fewer chances to make the assist (the ball is in a guard's hands), on top of what passing and handle say
		(1.5 +
			0.11 * (ratings.pss - 20) +
			0.05 * (ratings.drb - 30) -
			2.4 * b +
			// Sub-ratings: vision makes the assists
			0.08 * subDev(ratings, "vis")) *
			(1 + 0.8 * (usg - 0.25)) +
			rng.normal(0, 0.5 * noise),
		0.4,
		// Even the best college passers rarely average much over 8 assists per 40 minutes
		9.5,
	);
	// Drafted D1 players average about 1.5 steals per 40 minutes, guards more
	const stl40 = clamp(
		1.65 +
			0.016 * (ratings.spd - 40) +
			0.03 * ((ratings.pdef ?? ratings.diq) - 40) +
			(ratings.wng === undefined ? 0 : 0.006 * (ratings.wng - ratings.hgt)) -
			0.35 * b +
			// Sub-ratings: Steals
			0.04 * subDev(ratings, "stl") +
			rng.normal(0, 0.22 * noise),
		0.4,
		4,
	);
	// Drafted D1 bigs block about 2.5 shots per 40 minutes
	const blk40 = clamp(
		-0.25 +
			0.07 * (ratings.hgt - 30) +
			0.015 * (ratings.jmp - 40) +
			0.045 * ((ratings.idef ?? ratings.diq) - 40) +
			(ratings.wng === undefined ? 0 : 0.05 * (ratings.wng - ratings.hgt)) +
			// Sub-ratings: Shot Blocking
			0.06 * subDev(ratings, "blk") +
			rng.normal(0, 0.25 * noise),
		0.05,
		6,
	);
	const foulComp = composite(ratings, "fouling");
	const pf40 = clamp(
		3.2 + 0.5 * b + 2.0 * (foulComp - 0.4) + rng.normal(0, 0.3 * noise),
		1.8,
		5.2,
	);
	const pm40 =
		1.5 + 3.2 * z + rng.normal(0, 1.6 * noise) + 0.1 * (ctx.strength - 70);

	// Game by game. Pace is per game, so shorter games (high school, Overtime Elite) have fewer possessions
	const pace = proEnv?.pace ?? PACE * (gameMinutes / 40);
	const sdMin = 0.12 * mpg + 1.5;
	const boxes: GameBox[] = [];
	const total = emptyBox();
	const max: Record<string, [number, number]> = {};
	const maxExtra: Record<string, [number, number]> = {};
	let dd = 0;
	let td = 0;
	let qd = 0;
	let fxf = 0;

	// With the college season model: the regular season games he played split into non-conference (first) and conference games, in proportion to his team's schedule. Conference opponents are tougher than the average non-conference one
	const regularPlayed = gp - postseasonGames;
	const regularTeam = teamGames - teamPostseason;
	const nonConfPlayed =
		ctx.confGames !== undefined && regularTeam > 0
			? capped
				? // The first games of the season are the non-conference ones
					Math.min(regularPlayed, Math.max(0, regularTeam - ctx.confGames))
				: Math.round(
						(regularPlayed * Math.max(0, regularTeam - ctx.confGames)) /
							regularTeam,
					)
			: undefined;

	for (let game = 0; game < gp; game++) {
		const oppAdj =
			nonConfPlayed === undefined
				? 0
				: game < nonConfPlayed
					? 0.012
					: game < regularPlayed
						? -0.008
						: -0.012;
		const m = clamp(
			rng.normal(mpg, sdMin * noise + 0.1),
			3,
			40 * (gameMinutes / 40),
		);
		const t = m / gameMinutes;
		const box = emptyBox();
		box.min = m;

		const poss = usg * pace * t * ln(0.17);
		box.tov = rng.poisson(poss * tovRate * ln(0.1));
		const chances = poss * CHANCE_MULT;
		const fga = Math.max(
			0,
			Math.round((chances - box.tov) / (1 + POSS_FT * ftRate)),
		);
		box.fga = fga;
		box.fta = rng.poisson(fga * ftRate * ln(0.2));
		box.tpa = rng.binomial(fga, share3);
		const twoA = fga - box.tpa;
		box.fgaAtRim = rng.binomial(twoA, shareRim / norm);
		box.fgaLowPost = rng.binomial(
			twoA - box.fgaAtRim,
			shareLow / (shareLow + shareMidOfTwos),
		);
		box.fgaMidRange = twoA - box.fgaAtRim - box.fgaLowPost;
		box.tp = rng.binomial(box.tpa, tpPct + 0.5 * oppAdj);
		box.fgAtRim = rng.binomial(box.fgaAtRim, rimPct + oppAdj);
		box.fgLowPost = rng.binomial(box.fgaLowPost, lowPct + oppAdj);
		box.fgMidRange = rng.binomial(box.fgaMidRange, midPct + oppAdj);
		box.fg = box.tp + box.fgAtRim + box.fgLowPost + box.fgMidRange;
		box.ft = rng.binomial(box.fta, ftPct);
		box.pts =
			2 * (box.fgAtRim + box.fgLowPost + box.fgMidRange) + 3 * box.tp + box.ft;
		box.orb = rng.poisson(((orb40 * m) / 40) * ln(0.2));
		box.drb = rng.poisson(((drb40 * m) / 40) * ln(0.15));
		box.ast = rng.poisson(((ast40 * m) / 40) * ln(0.18));
		box.stl = rng.poisson(((stl40 * m) / 40) * ln(0.2));
		box.blk = rng.poisson(((blk40 * m) / 40) * ln(0.25));
		box.ba = rng.poisson(
			0.018 * (box.fgaAtRim + box.fgaLowPost) * (1.4 - b * 0.6) * 1,
		);
		box.pf = Math.min(5, rng.poisson(((pf40 * m) / 40) * ln(0.2)));
		box.pm = Math.round(rng.normal((pm40 * m) / 40, 5.5 * noise + 0.1));
		boxes.push(box);

		for (const key of Object.keys(total) as (keyof GameBox)[]) {
			total[key] += box[key];
		}

		const gid = -(Math.abs(ctx.season) * 10000 + game + 1);
		const consider = (
			key: string,
			value: number,
			into: Record<string, [number, number]>,
		) => {
			if (!into[key] || value > into[key]![0]) {
				into[key] = [value, gid];
			}
		};
		for (const key of MAX_KEYS) {
			consider(`${key}Max`, box[key], max);
		}
		consider("2pMax", box.fg - box.tp, maxExtra);
		consider("2paMax", box.fga - box.tpa, maxExtra);
		consider("trbMax", box.orb + box.drb, maxExtra);
		consider("gmscMax", gameScore(box), maxExtra);

		// Double and five by five counts, like writePlayerStats
		let numDoubles = 0;
		let numFives = 0;
		for (const value of [
			box.pts,
			box.ast,
			box.stl,
			box.blk,
			box.orb + box.drb,
		]) {
			if (value >= 5) {
				numFives += 1;
				if (value >= 10) {
					numDoubles += 1;
				}
			}
		}
		if (numDoubles >= 2) {
			dd += 1;
			if (numDoubles >= 3) {
				td += 1;
				if (numDoubles >= 4) {
					qd += 1;
				}
			}
		}
		if (numFives >= 5) {
			fxf += 1;
		}
	}

	const minAvailable = Math.max(gp, teamGames - missed) * gameMinutes;
	const stats: Record<string, number> = {
		gp,
		gs,
		min: Math.round(total.min),
		minAvailable,
		fg: total.fg,
		fga: total.fga,
		fgAtRim: total.fgAtRim,
		fgaAtRim: total.fgaAtRim,
		fgLowPost: total.fgLowPost,
		fgaLowPost: total.fgaLowPost,
		fgMidRange: total.fgMidRange,
		fgaMidRange: total.fgaMidRange,
		tp: total.tp,
		tpa: total.tpa,
		ft: total.ft,
		fta: total.fta,
		pm: total.pm,
		orb: total.orb,
		drb: total.drb,
		ast: total.ast,
		tov: total.tov,
		stl: total.stl,
		blk: total.blk,
		ba: total.ba,
		pf: total.pf,
		pts: total.pts,
		dd,
		td,
		qd,
		fxf,
	};

	const advanced = calculateAdvanced(stats, {
		pos: ctx.pos,
		gameMinutes,
		teamGames,
		strength: ctx.strength,
		rng,
		z,
	});
	Object.assign(stats, advanced);

	// Per 40 minute game, so it can be compared between leagues with different game lengths
	const gmscPerGame =
		gp > 0
			? ((boxes.reduce((sum, box) => sum + gameScore(box), 0) / gp) * 40) /
				gameMinutes
			: 0;
	const defScore =
		gp > 0
			? ((total.stl * 1.4 + total.blk * 1.2 + total.drb * 0.35) / gp) *
				(40 / Math.max(mpg, 1))
			: 0;

	return {
		season: ctx.season,
		classIndex: c,
		age: ctx.age,
		school: ctx.school,
		conference: ctx.conference,
		strength: ctx.strength,
		gameMinutes,
		teamGames,
		stats,
		max: { ...max, ...maxExtra },
		score: gmscPerGame,
		defScore,
		...(postseasonGames > 0
			? { postseasonBoxes: boxes.slice(boxes.length - postseasonGames) }
			: {}),
		...(nonConfPlayed !== undefined
			? {
					splits: {
						nonConf: sumSplit(boxes.slice(0, nonConfPlayed)),
						conf: sumSplit(boxes.slice(nonConfPlayed, regularPlayed)),
					},
				}
			: {}),
	};
};
