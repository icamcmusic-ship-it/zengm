// College mode: the quick sim (docs/college-mode.md, Quick sim). A fast statistical model for games that do not involve the user's team, so
// a league of hundreds of schools sims several times faster. Calibrated against the full game sim (quickSimData.script.test.ts and the
// bounds in quickSim.test.ts):
// - the score: margin from the difference in team strength (the predicted margin of team.ovr) plus home court, total points from the sum of
//   the strengths, normal noise on both, overtime when tied
// - the box score: minutes by the rotation (roster order), then the team's shots, free throws, rebounds, ... shared out by minutes and the
//   players' composite ratings, consistent with the final score
// The result has the shape of a game sim result, so the rest of the engine (stats, standings, box scores, injuries) treats it like any other
// game.
import {
	COMPOSITE_WEIGHTS,
	DEFAULT_PLAY_THROUGH_INJURIES,
	PHASE,
} from "../../../common/constants.ts";
import { compositeWeightsFor } from "../../../common/expandedRatings.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import playThroughInjuriesFactor from "../../../common/playThroughInjuriesFactor.ts";
import { realGauss } from "../../../common/random.ts";
import type {
	GameResults,
	Player,
	ScheduleGame,
} from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import getInjuryRate from "../GameSim.basketball/getInjuryRate.ts";
import { simFixCompositeWeights } from "../GameSim.basketball/simSettings.ts";
import { expandedRatingsOn } from "../player/expandedRatings.ts";
import { isRedshirting } from "./redshirt.ts";
import { getCollegeState } from "./state.ts";

// ---- Model constants (calibrated, see the Quick sim section of docs/college-mode.md) ----

export const QS = {
	// Margin: points per point of strength difference, home court (points), noise
	marginPerStrength: 1.04,
	homeCourt: 2.2,
	marginSd: 12.9,
	// Total points: at strength sum 0, per point of strength sum, noise
	totalBase: 165.7,
	totalPerStrength: 0.416,
	totalSd: 15,
	// Points per team per 5-minute overtime period
	otPts: 9,
	// Team box score means (per 40 minutes) and their noise
	fga: 58.5,
	fgaSd: 4,
	fta: 17.3,
	ftaSd: 5,
	ftp: 0.677,
	tpp: 0.338,
	tov: 12.2,
	tovSd: 3.5,
	orbRate: 0.255,
	astPerFg: 0.58,
	stlPerTov: 0.53,
	blkPer2pa: 0.073,
	pf: 17.2,
	pfSd: 3.5,
	// Share of 2-point attempts at the rim, in the low post and from mid-range, and their make rates
	locShare: [0.14, 0.32, 0.6],
	locMake: [1.2, 0.31, 0.44],
	// Minutes by rotation slot (roster order of the healthy players), regulation, and the game-to-game noise
	minutes: [26.5, 25.5, 24.5, 23, 21, 19.5, 17.5, 15, 12.5, 8.5, 4.5, 2, 0.5],
	minutesSd: 5,
	minutesPerOvr: 0.008,
	// Exponents of the composite ratings in each player's share of a team stat (fitted to the full sim's per-minute rates)
	exp: {
		usage: 1.3,
		drawingFouls: 2.2,
		turnovers: 1.9,
		orb: 3.3,
		drb: 2.55,
		passing: 2.8,
		stealing: 3.9,
		blocking: 7.4,
		fouling: 0.94,
	},
};

// Share of a player's shots that are threes, by his three point composite (the full sim's, in steps of 0.05 from 0.1)
const THREE_SHARE = [
	0.054, 0.076, 0.096, 0.114, 0.137, 0.264, 0.486, 0.633, 0.699, 0.744, 0.771,
	0.826,
];
const threeShareOf = (tp: number) => {
	const x = (tp - 0.125) / 0.05;
	if (x <= 0) {
		return THREE_SHARE[0]!;
	}
	if (x >= THREE_SHARE.length - 1) {
		return THREE_SHARE.at(-1)!;
	}
	const k = Math.floor(x);
	return THREE_SHARE[k]! + (x - k) * (THREE_SHARE[k + 1]! - THREE_SHARE[k]!);
};

// ---- Ratings ----

const QUICK_COMPOSITES = [
	"usage",
	"passing",
	"turnovers",
	"shootingAtRim",
	"shootingLowPost",
	"shootingMidRange",
	"shootingThreePointer",
	"shootingFT",
	"rebounding",
	"stealing",
	"blocking",
	"fouling",
	"drawingFouls",
	"endurance",
] as const;
type QuickComposite = (typeof QUICK_COMPOSITES)[number];
export type QuickComposites = Record<QuickComposite, number>;

let weightsCache: { key: string; weights: Record<string, any> } | undefined;
const getWeights = () => {
	const expanded = expandedRatingsOn();
	const simFixes = nativeFeatureEnabled("simFixes", (key) => g.get(key as any));
	const key = `${expanded}|${simFixes}`;
	if (weightsCache?.key !== key) {
		const base = compositeWeightsFor(COMPOSITE_WEIGHTS, expanded);
		weightsCache = {
			key,
			weights: simFixes ? simFixCompositeWeights(base, expanded) : base,
		};
	}
	return weightsCache.weights;
};

/**
 * The composite ratings the quick sim uses (the same formulas as the game sim's).
 */
export const getQuickComposites = (p: Player): QuickComposites => {
	const ratings = last(p.ratings);
	const weights = getWeights();
	const out: Partial<QuickComposites> = {};
	for (const key of QUICK_COMPOSITES) {
		const w = weights[key];
		out[key] = w
			? player.compositeRating(ratings, w.ratings, w.weights, false)
			: 0.5;
	}
	return out as QuickComposites;
};

const isAvailable = (p: Player) =>
	p.injury.gamesRemaining <= DEFAULT_PLAY_THROUGH_INJURIES[0] &&
	!isRedshirting(p);

/**
 * Team strength: the predicted margin (points per game, around 0 for an average pro team) of the players who can play, from team.ovr.
 */
export const teamStrength = (players: Player[]) =>
	team.ovr(
		players
			.filter((p) => !isRedshirting(p))
			.map((p) => {
				const ratings = last(p.ratings);
				return {
					pid: p.pid,
					injury: p.injury,
					value: p.value,
					ratings: { ovr: ratings.ovr, ovrs: ratings.ovrs, pos: ratings.pos },
				};
			}),
		{
			accountForInjuredPlayers: {
				numDaysInFuture: 0,
				playThroughInjuries: DEFAULT_PLAY_THROUGH_INJURIES,
			},
			rating: "ovr",
		},
	);

// ---- Which games ----

/**
 * Is this game played by the quick sim? Only in a college league with the setting on, never for the user's teams, the conference
 * tournament finals or the national tournament (all national postseason games).
 */
export const useQuickSim = (game: ScheduleGame) => {
	if (!nativeFeatureEnabled("collegeQuickSim", (key) => g.get(key as any))) {
		return false;
	}
	const phase = g.get("phase");
	if (phase !== PHASE.REGULAR_SEASON && phase !== PHASE.AFTER_TRADE_DEADLINE) {
		return false;
	}
	const userTids = g.get("userTids");
	if (
		!g.get("spectator") &&
		(userTids.includes(game.homeTid) || userTids.includes(game.awayTid))
	) {
		return false;
	}
	if (game.homeTid < 0 || game.awayTid < 0) {
		return false;
	}
	if (phase === PHASE.AFTER_TRADE_DEADLINE && isConfFinal(game)) {
		return false;
	}
	return true;
};

const isConfFinal = (game: ScheduleGame) => {
	const state = getCollegeState();
	for (const t of state?.confTournaments ?? []) {
		const final = t.rounds.at(-1)?.[0];
		if (
			final &&
			final.home === game.homeTid &&
			final.away === game.awayTid &&
			!final.pts
		) {
			return true;
		}
	}
	return false;
};

// ---- Teams ----

export type QuickPlayer = {
	id: number;
	pid: number;
	name: string;
	pos: string;
	age: number;
	jerseyNumber: string | undefined;
	skills: string[];
	injury: Player["injury"] & { playingThrough: boolean };
	injured: boolean;
	ptModifier: number;
	ovr: number;
	c: QuickComposites;
	stat: Record<string, any>;
	newInjury?: boolean;
};

export type QuickTeam = {
	id: number;
	cid: number;
	did: number;
	won: number;
	lost: number;
	ovr: number;
	strength: number;
	player: QuickPlayer[];
	stat: Record<string, any>;
	// Healthy players in rotation order
	rotation: QuickPlayer[];
};

const PLAYER_STAT_KEYS = [
	"gp",
	"gs",
	"min",
	"fg",
	"fga",
	"fgAtRim",
	"fgaAtRim",
	"fgLowPost",
	"fgaLowPost",
	"fgMidRange",
	"fgaMidRange",
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
	"dd",
	"td",
	"qd",
	"fxf",
] as const;
const TEAM_STAT_KEYS = [
	"min",
	"fg",
	"fga",
	"fgAtRim",
	"fgaAtRim",
	"fgLowPost",
	"fgaLowPost",
	"fgMidRange",
	"fgaMidRange",
	"tp",
	"tpa",
	"ft",
	"fta",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"ba",
	"pf",
	"pts",
	"dd",
	"td",
	"qd",
	"fxf",
] as const;

const PLAYER_STATS_TEMPLATE: Record<string, any> = Object.fromEntries(
	PLAYER_STAT_KEYS.map((key) => [key, 0]),
);
const TEAM_STATS_TEMPLATE: Record<string, any> = Object.fromEntries(
	TEAM_STAT_KEYS.map((key) => [key, 0]),
);

/**
 * The teams of the quick sim games, without the work the full sim's loadTeams does for the play-by-play, traits and so on.
 */
export const loadQuickTeams = async (tids: number[]) => {
	const out: Record<number, QuickTeam> = {};
	const season = g.get("season");
	for (const tid of tids) {
		const players = (
			await idb.cache.players.indexGetAll("playersByTid", tid)
		).sort((a, b) => a.rosterOrder - b.rosterOrder);
		const t = await idb.cache.teams.get(tid);
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[tid, season],
		);
		if (!t || !teamSeason) {
			throw new Error("Invalid tid");
		}
		const qPlayers: QuickPlayer[] = [];
		for (const p of players) {
			if (isRedshirting(p)) {
				continue;
			}
			const ratings = last(p.ratings);
			const playingThrough =
				p.injury.gamesRemaining > 0 &&
				p.injury.gamesRemaining <= DEFAULT_PLAY_THROUGH_INJURIES[0];
			const c = getQuickComposites(p);
			if (playingThrough) {
				const factor = playThroughInjuriesFactor(p.injury.gamesRemaining);
				for (const key of QUICK_COMPOSITES) {
					c[key] *= factor;
				}
			}
			const stats = p.stats.at(-1);
			qPlayers.push({
				id: p.pid,
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: ratings.pos,
				age: season - p.born.year,
				jerseyNumber: stats?.jerseyNumber ?? p.jerseyNumber,
				skills: ratings.skills,
				injury: { ...p.injury, playingThrough },
				injured: !isAvailable(p),
				ptModifier: 1,
				ovr: ratings.ovr,
				c,
				stat: { ...PLAYER_STATS_TEMPLATE },
			});
		}
		const stat: Record<string, any> = { ...TEAM_STATS_TEMPLATE };
		stat.ptsQtrs = [0];
		out[tid] = {
			id: tid,
			cid: teamSeason.cid,
			did: teamSeason.did,
			won: teamSeason.won,
			lost: teamSeason.lost,
			ovr: team.ovr(
				players
					.filter((p) => !isRedshirting(p))
					.map((p) => ({
						pid: p.pid,
						injury: p.injury,
						value: p.value,
						ratings: {
							ovr: last(p.ratings).ovr,
							ovrs: last(p.ratings).ovrs,
							pos: last(p.ratings).pos,
						},
					})),
				{
					accountForInjuredPlayers: {
						numDaysInFuture: 0,
						playThroughInjuries: DEFAULT_PLAY_THROUGH_INJURIES,
					},
				},
			),
			strength: teamStrength(players),
			player: qPlayers,
			stat,
			rotation: qPlayers.filter((p) => !p.injured),
		};
	}
	return out;
};

// ---- Random helpers ----

const gauss = (mu: number, sd: number) => realGauss(mu, sd);
const nonNeg = (x: number) => Math.max(0, Math.round(x));

// Share n units among items by weight, at most cap[i] each (when given). Multinomial: each unit goes to a random item by weight.
const share = (n: number, weights: number[], caps?: number[]) => {
	const out = weights.map(() => 0);
	const w = caps
		? weights.map((x, i) => (caps[i]! > 0 ? Math.max(0, x) : 0))
		: weights.map((x) => Math.max(0, x));
	let total = 0;
	for (const x of w) {
		total += x;
	}
	for (let k = 0; k < n && total > 1e-12; k++) {
		let r = Math.random() * total;
		let pick = -1;
		for (let i = 0; i < w.length; i++) {
			r -= w[i]!;
			if (r < 0 && w[i]! > 0) {
				pick = i;
				break;
			}
		}
		if (pick < 0) {
			// Rounding at the end of the scan: the last item with weight
			for (let i = w.length - 1; i >= 0; i--) {
				if (w[i]! > 0) {
					pick = i;
					break;
				}
			}
		}
		out[pick]! += 1;
		if (caps && out[pick]! >= caps[pick]!) {
			total -= w[pick]!;
			w[pick] = 0;
		}
	}
	return out;
};

// ---- The game ----

// Minutes of each player of the rotation, summing to 5 * game length
const assignMinutes = (t: QuickTeam, gameMinutes: number) => {
	const rotation = t.rotation;
	const n = rotation.length;
	// The better players get more of the minutes (the full sim plays its best players more than the roster order alone says)
	const top = rotation.slice(0, 8);
	const meanOvr = top.reduce((a, p) => a + p.ovr, 0) / Math.max(1, top.length);
	const raw = rotation.map((p, i) => {
		const base = QS.minutes[i] ?? 0;
		// Quality and endurance, plus game-to-game noise
		const m =
			base *
				helpers.bound(1 + QS.minutesPerOvr * (p.ovr - meanOvr), 0.6, 1.4) *
				(0.85 + 0.3 * p.c.endurance) +
			(base > 1 ? gauss(0, QS.minutesSd * Math.min(1, base / 20)) : 0);
		return Math.max(0, m);
	});
	const total = 5 * gameMinutes;
	let sum = raw.reduce((a, b) => a + b, 0);
	if (sum <= 0) {
		return raw.map((_, i) => (i < 5 ? gameMinutes : 0));
	}
	const cap = gameMinutes;
	let minutes = raw.map((m) => (m * total) / sum);
	// Nobody plays more than the whole game: give the excess to the bench in order
	for (let iter = 0; iter < 5; iter++) {
		let excess = 0;
		minutes = minutes.map((m) => {
			if (m > cap) {
				excess += m - cap;
				return cap;
			}
			return m;
		});
		if (excess <= 0) {
			break;
		}
		const room = minutes.map((m) => (m < cap ? cap - m : 0));
		sum = room.reduce((a, b) => a + b, 0);
		if (sum <= 0) {
			break;
		}
		minutes = minutes.map((m, i) => m + (excess * room[i]!) / sum);
	}
	return n > 0 ? minutes : [];
};

type TeamShots = {
	fga: number[];
	tpa: number[];
	fta: number[];
	fg2: number[];
	tp: number[];
	ft: number[];
	tov: number[];
};

const sum = (xs: number[]) => {
	let out = 0;
	for (const x of xs) {
		out += x;
	}
	return out;
};

// Weighted average of a composite over the players, by weights w
const wAvg = (
	rot: QuickPlayer[],
	w: number[],
	f: (p: QuickPlayer) => number,
) => {
	let num = 0;
	let den = 0;
	for (const [i, p] of rot.entries()) {
		num += w[i]! * f(p);
		den += w[i]!;
	}
	return den > 0 ? num / den : 0;
};

// The team's shooting line consistent with its points, then shared out to the players. scale = game length / 40 minutes
const shootingLine = (
	t: QuickTeam,
	minutes: number[],
	pts: number,
	scale: number,
): TeamShots => {
	const rot = t.rotation;
	const e = QS.exp;
	const w = rot.map((p, i) => minutes[i]! * p.c.usage ** e.usage);
	const threeShare = rot.map((p) => threeShareOf(p.c.shootingThreePointer));
	const tpaW = rot.map((_, i) => w[i]! * threeShare[i]!);
	const fga2W = rot.map((_, i) => w[i]! * (1 - threeShare[i]!));
	const ftaW = rot.map(
		(p, i) => minutes[i]! * p.c.drawingFouls ** e.drawingFouls,
	);
	const teamThreeShare = (1.03 * sum(tpaW)) / Math.max(1e-9, sum(w));
	const teamFtSkill = wAvg(rot, ftaW, (p) => p.c.shootingFT);
	const teamTpSkill = wAvg(rot, tpaW, (p) => p.c.shootingThreePointer);
	// Free throws drawn: relative to a typical rotation (drawing fouls composite 0.41)
	const ftaRel =
		sum(ftaW) / Math.max(1e-9, sum(minutes)) / 0.41 ** e.drawingFouls;

	let fga = nonNeg(gauss(QS.fga * scale, QS.fgaSd));
	const tpa = Math.min(fga, nonNeg(fga * teamThreeShare + gauss(0, 2)));
	let fta = nonNeg(gauss(QS.fta * scale * ftaRel ** 0.7, QS.ftaSd));
	const ftp = helpers.bound(QS.ftp + 0.6 * (teamFtSkill - 0.35), 0.45, 0.9);
	let ft = Math.min(fta, nonNeg(fta * ftp + gauss(0, 1.5)));
	const tpp = helpers.bound(QS.tpp + 0.45 * (teamTpSkill - 0.43), 0.2, 0.5);
	let tp = Math.min(tpa, nonNeg(tpa * tpp + gauss(0, 1.5)));
	// 2-point makes from the points left
	let rest = pts - ft - 3 * tp;
	while (rest < 0 && tp > 0) {
		tp -= 1;
		rest += 3;
	}
	while (rest < 0 && ft > 0) {
		ft -= 1;
		rest += 1;
	}
	if (rest % 2 !== 0) {
		if (ft > 0 && (ft >= fta || Math.random() < 0.5)) {
			ft -= 1;
			rest += 1;
		} else {
			ft += 1;
			rest -= 1;
		}
	}
	fta = Math.max(fta, ft);
	const fg2 = Math.max(0, rest / 2);
	// Keep 2-point shooting plausible (32% to 68%) by changing the number of attempts
	const fga2 = helpers.bound(
		fga - tpa,
		Math.ceil(fg2 / 0.68),
		Math.max(Math.ceil(fg2 / 0.32), fg2),
	);
	fga = fga2 + tpa;

	const tov = nonNeg(gauss(QS.tov * scale, QS.tovSd));

	// Players: attempts by usage and shot mix, makes by skill
	const pTpa = share(tpa, tpaW);
	const pFga2 = share(fga2, fga2W);
	const pFta = share(fta, ftaW);
	const pTp = share(
		tp,
		rot.map((p, i) => pTpa[i]! * p.c.shootingThreePointer ** 0.9),
		pTpa,
	);
	const twoSkill = rot.map(
		(p) =>
			QS.locShare[0]! * p.c.shootingAtRim +
			QS.locShare[1]! * p.c.shootingLowPost +
			QS.locShare[2]! * p.c.shootingMidRange,
	);
	const pFg2 = share(
		fg2,
		rot.map((p, i) => pFga2[i]! * twoSkill[i]! ** 0.8),
		pFga2,
	);
	const pFt = share(
		ft,
		rot.map((p, i) => pFta[i]! * p.c.shootingFT ** 2),
		pFta,
	);
	const pTov = share(
		tov,
		rot.map((p, i) => minutes[i]! * p.c.turnovers ** e.turnovers),
	);
	return {
		fga: rot.map((_, i) => pTpa[i]! + pFga2[i]!),
		tpa: pTpa,
		fta: pFta,
		fg2: pFg2,
		tp: pTp,
		ft: pFt,
		tov: pTov,
	};
};

// Points of each regulation period (a little noise around even)
const splitPeriods = (pts: number, numPeriods: number) => {
	const out: number[] = [];
	let left = pts;
	for (let k = numPeriods; k > 1; k--) {
		const x = Math.round((left / k) * (0.92 + 0.16 * Math.random()));
		out.push(x);
		left -= x;
	}
	out.push(left);
	return out;
};

const SUMMED_TEAM_STATS = TEAM_STAT_KEYS.filter(
	(key) => key !== "dd" && key !== "td" && key !== "qd" && key !== "fxf",
);

/**
 * Play one game with the quick sim. Returns a result in the shape of the game sim's.
 */
export const quickSimGame = ({
	gid,
	day,
	home,
	away,
	neutralSite,
}: {
	gid: number;
	day: number | undefined;
	home: QuickTeam;
	away: QuickTeam;
	neutralSite: boolean;
}): GameResults => {
	const teams = [home, away] as const;
	const quarterLength = g.get("quarterLength");
	const numPeriods = g.get("numPeriods");
	const regMinutes = quarterLength * numPeriods;

	// ---- Score ----
	const diff = home.strength - away.strength;
	const margin =
		QS.marginPerStrength * diff +
		(neutralSite ? 0 : QS.homeCourt * (g.get("homeCourtAdvantage") / 1)) +
		gauss(0, QS.marginSd);
	const total =
		QS.totalBase +
		QS.totalPerStrength * (home.strength + away.strength) +
		gauss(0, QS.totalSd);
	const regPts = [
		Math.max(25, Math.round((total + margin) / 2)),
		Math.max(25, Math.round((total - margin) / 2)),
	];
	const otPts: number[][] = [[], []];
	const pts = [...regPts];
	let overtimes = 0;
	const otLength = g.get("overtimeLength");
	while (pts[0] === pts[1]) {
		overtimes += 1;
		const otMargin =
			(QS.marginPerStrength * diff * otLength) / regMinutes +
			gauss(0, QS.marginSd * Math.sqrt(otLength / regMinutes));
		const otTotal = 2 * QS.otPts * (otLength / 5) + gauss(0, 3);
		let home = Math.max(0, Math.round((otTotal + otMargin) / 2));
		const away = Math.max(0, Math.round((otTotal - otMargin) / 2));
		if (home === away && overtimes >= 6) {
			home += 1;
		}
		otPts[0]!.push(home);
		otPts[1]!.push(away);
		pts[0]! += home;
		pts[1]! += away;
	}
	const gameMinutes = regMinutes + overtimes * otLength;
	const scale = (gameMinutes / 40) * (regMinutes > 0 ? 40 / regMinutes : 1);

	// ---- Box scores ----
	const minutes = teams.map((t) => assignMinutes(t, gameMinutes));
	const shots = teams.map((t, i) =>
		shootingLine(t, minutes[i]!, pts[i]!, scale * (regMinutes / 40)),
	);
	const misses = shots.map(
		(s) =>
			s.fga.reduce((a, b) => a + b, 0) -
			s.fg2.reduce((a, b) => a + b, 0) -
			s.tp.reduce((a, b) => a + b, 0),
	);
	const ftMisses = shots.map(
		(s) => s.fta.reduce((a, b) => a + b, 0) - s.ft.reduce((a, b) => a + b, 0),
	);
	const reb = teams.map(
		(t, i) =>
			t.rotation.reduce((a, p, j) => a + minutes[i]![j]! * p.c.rebounding, 0) /
			Math.max(1, gameMinutes * 5),
	);

	for (const [i, t] of teams.entries()) {
		const o = 1 - i;
		const rot = t.rotation;
		const s = shots[i]!;
		const m = minutes[i]!;
		const opp = shots[o]!;
		// Rebounds: offensive rebounds of the team's own misses, defensive of the opponent's
		const orbRate = helpers.bound(
			QS.orbRate + 0.6 * (reb[i]! - reb[o]!),
			0.15,
			0.45,
		);
		const reboundable = (k: number) => misses[k]! + 0.45 * ftMisses[k]!;
		const orb = nonNeg(reboundable(i) * orbRate + gauss(0, 2));
		const oppOrbRate = helpers.bound(
			QS.orbRate + 0.6 * (reb[o]! - reb[i]!),
			0.15,
			0.45,
		);
		const drb = nonNeg(0.93 * reboundable(o) * (1 - oppOrbRate) + gauss(0, 2));
		const fg = sum(s.fg2) + sum(s.tp);
		const ast = Math.min(fg, nonNeg(fg * QS.astPerFg + gauss(0, 2.5)));
		const oppTov = opp.tov.reduce((a, b) => a + b, 0);
		const stl = Math.min(oppTov, nonNeg(oppTov * QS.stlPerTov + gauss(0, 1.5)));
		const opp2pa =
			opp.fga.reduce((a, b) => a + b, 0) - opp.tpa.reduce((a, b) => a + b, 0);
		const oppMissed2 = opp2pa - opp.fg2.reduce((a, b) => a + b, 0);
		const blk = Math.min(
			oppMissed2,
			nonNeg(opp2pa * QS.blkPer2pa + gauss(0, 1.5)),
		);
		const pf = nonNeg(
			gauss(QS.pf * scale, QS.pfSd) + 0.3 * (sum(opp.fta) - QS.fta * scale),
		);

		const e = QS.exp;
		const byMin = (f: (p: QuickPlayer) => number) =>
			rot.map((p, j) => m[j]! * f(p));
		const pOrb = share(
			orb,
			byMin((p) => p.c.rebounding ** e.orb),
		);
		const pDrb = share(
			drb,
			byMin((p) => p.c.rebounding ** e.drb),
		);
		const pAst = share(
			ast,
			byMin((p) => p.c.passing ** e.passing),
		);
		const pStl = share(
			stl,
			byMin((p) => p.c.stealing ** e.stealing),
		);
		const pBlk = share(
			blk,
			byMin((p) => p.c.blocking ** e.blocking),
		);
		const foulCap = g.get("foulsNeededToFoulOut");
		const pPf = share(
			pf,
			byMin((p) => p.c.fouling ** e.fouling),
			rot.map(() => (foulCap > 0 ? foulCap : 99)),
		);

		const margin = pts[i]! - pts[o]!;
		for (const [j, p] of rot.entries()) {
			const st = p.stat;
			const min = m[j]!;
			if (min <= 0) {
				continue;
			}
			st.gp = 1;
			st.gs = j < 5 ? 1 : 0;
			st.min = min;
			st.fga = s.fga[j]!;
			st.tpa = s.tpa[j]!;
			st.tp = s.tp[j]!;
			st.fg = s.fg2[j]! + s.tp[j]!;
			st.fta = s.fta[j]!;
			st.ft = s.ft[j]!;
			st.tov = s.tov[j]!;
			st.orb = pOrb[j]!;
			st.drb = pDrb[j]!;
			st.ast = pAst[j]!;
			st.stl = pStl[j]!;
			st.blk = pBlk[j]!;
			st.pf = pPf[j]!;
			st.pts = 2 * s.fg2[j]! + 3 * s.tp[j]! + s.ft[j]!;
			st.pm = Math.round((margin * min) / gameMinutes + gauss(0, 2));
			// Where the 2-point shots came from
			const fga2 = st.fga - st.tpa;
			const loc = share(fga2, [
				QS.locShare[0]! * 2 * p.c.shootingAtRim,
				QS.locShare[1]! * 2 * p.c.shootingLowPost,
				QS.locShare[2]! * 2 * p.c.shootingMidRange,
			]);
			const locMade = share(
				s.fg2[j]!,
				[
					loc[0]! * QS.locMake[0]!,
					loc[1]! * QS.locMake[1]!,
					loc[2]! * QS.locMake[2]!,
				],
				loc,
			);
			st.fgaAtRim = loc[0];
			st.fgaLowPost = loc[1];
			st.fgaMidRange = loc[2];
			st.fgAtRim = locMade[0];
			st.fgLowPost = locMade[1];
			st.fgMidRange = locMade[2];
		}
	}

	// Blocked attempts (ba): the opponent's blocks, among each team's missed 2s
	for (const [i, t] of teams.entries()) {
		const missed2 = t.rotation.map(
			(p) => p.stat.fga - p.stat.tpa - (p.stat.fg - p.stat.tp),
		);
		let oppBlk = 0;
		for (const p of teams[1 - i]!.rotation) {
			oppBlk += p.stat.blk;
		}
		const ba = share(oppBlk, missed2, missed2);
		for (const [j, p] of t.rotation.entries()) {
			p.stat.ba = ba[j]!;
		}
	}

	// Injuries: the game sim checks every player on the court every possession
	const baseRate = g.get("injuryRate") * (100 / g.get("pace"));
	const possessions = 70 * (gameMinutes / 40);
	for (const t of teams) {
		for (const p of t.rotation) {
			if (p.stat.min <= 0) {
				continue;
			}
			const rate = getInjuryRate(baseRate, p.age, p.injury.gamesRemaining > 0);
			const checks = 2 * possessions * (p.stat.min / gameMinutes);
			if (Math.random() < 1 - (1 - rate) ** checks) {
				p.injured = true;
				p.newInjury = true;
			}
		}
	}

	// Team totals and points by period
	for (const [i, t] of teams.entries()) {
		const st = t.stat;
		for (const p of t.player) {
			for (const key of SUMMED_TEAM_STATS) {
				st[key] += p.stat[key];
			}
		}
		st.pts = pts[i];
		st.ptsQtrs = [...splitPeriods(regPts[i]!, numPeriods), ...otPts[i]!];
	}

	return {
		gid,
		day,
		overtimes,
		team: teams.map((t) => ({
			id: t.id,
			cid: t.cid,
			did: t.did,
			won: t.won,
			lost: t.lost,
			ovr: t.ovr,
			stat: t.stat,
			player: t.player,
		})) as any,
		clutchPlays: [],
		playByPlay: undefined,
		numPlayersOnCourt: 5,
		neutralSite,
		quickSim: true,
	} as any;
};

/**
 * Play a day's quick sim games (see useQuickSim). Conference tournament games are on a neutral court, like in the full sim.
 */
export const playQuickGames = async (games: ScheduleGame[]) => {
	const tids = new Set<number>();
	for (const game of games) {
		tids.add(game.homeTid);
		tids.add(game.awayTid);
	}
	const teams = await loadQuickTeams([...tids]);
	const neutralSite = g.get("phase") === PHASE.AFTER_TRADE_DEADLINE;
	return games.map((game) =>
		quickSimGame({
			gid: game.gid,
			day: game.day,
			home: teams[game.homeTid]!,
			away: teams[game.awayTid]!,
			neutralSite,
		}),
	);
};

/**
 * With the quick sim on, the regular season's advanced stats (PER, win shares, ... for thousands of players) are updated every third day
 * and on the last day rather than every day.
 */
export const throttleAdvStats = (
	results: GameResults[],
	schedule: ScheduleGame[],
) => {
	if (
		g.get("phase") !== PHASE.REGULAR_SEASON ||
		!nativeFeatureEnabled("collegeQuickSim", (key) => g.get(key as any)) ||
		schedule.length === 0
	) {
		return false;
	}
	const day = results.find((r) => typeof r.day === "number")?.day;
	return day !== undefined && day % 3 !== 0;
};
