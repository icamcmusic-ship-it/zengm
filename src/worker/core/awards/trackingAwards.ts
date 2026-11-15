// Advanced Tracking Stats (the advStats setting, see docs/native-features.md, "Advanced tracking stats" and "Award settings"): award
// variables computed from the tracking data, and the default formulas that use them with the setting on.
//
// Every tracking stat (common/advStats.ts) is an award variable, plus a "Playoffs" variant read from the season's playoff row
// (dfgpPlayoffs, onOffNetPlayoffs, ...). Without tracking data they are NaN, so a custom formula that uses them leaves those players
// out, like the GOAT lab. The composite scores below (trk*) are 0 without data instead, so the default formulas fall back to the stock
// ones exactly.
import {
	ADV_STAT_KEYS,
	ADV_STAT_META,
	PLAY_TYPES,
	type AdvStatKey,
} from "../../../common/advStats.ts";
import { defaultAwards } from "../../../common/defaultGameAttributes.ts";
import { defaultAwardsBasketball } from "../../../common/defaultGameAttributes.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import g from "../../util/g.ts";

// Derived award variables: [key, description]
export const TRACKING_DERIVED: [string, string][] = [
	[
		"dfgpVsExp",
		"Defended FG% vs expected: the league's defended FG% on his mix of 2s and 3s minus his, in points (positive is better)",
	],
	[
		"dfgp2VsExp",
		"Defended 2P% vs the league's, in points (positive is better)",
	],
	[
		"dfgp3VsExp",
		"Defended 3P% vs the league's, in points (positive is better)",
	],
	["rimDfgpVsExp", "Rim DFG% vs the league's, in points (positive is better)"],
	["con36", "Shots contested per 36 minutes (2PT + 3PT)"],
	[
		"trkImpact",
		"Impact score, -1 to 1: on-off net rating / 12, shrunk toward 0 by on-floor possessions (x poss / (poss + 2000)); 0 without tracking stats",
	],
	[
		"trkClutch",
		"Clutch score, -1 to 1: half clutch plus/minus / 40, half clutch points over 0.5 per clutch minute / 30, shrunk by clutch minutes (x min / (min + 30)); 0 without tracking stats",
	],
	[
		"trkDef",
		"Defense score, -1 to 1: 0.3 defended FG% vs expected (/4 pts), 0.25 rim DFG% vs the league (/6 pts), 0.15 shots deterred (/3), 0.1 contests per minute vs the league, 0.2 defensive on-off (/6), each shrunk by volume; 0 without tracking stats",
	],
	[
		"trkPtEff",
		"Play-type efficiency score, -1 to 1: points over the league's PPP of each of his play types, per 100 play-type possessions / 20, shrunk by possessions (x poss / (poss + 400)); 0 without tracking stats",
	],
];

const COMPOSITES = new Set(["trkImpact", "trkClutch", "trkDef", "trkPtEff"]);

const TRACKING_BASE = [...ADV_STAT_KEYS, ...TRACKING_DERIVED.map((x) => x[0])];
const TRACKING_BASE_SET: ReadonlySet<string> = new Set(TRACKING_BASE);

// Every tracking award variable (regular and playoff variants)
export const TRACKING_AWARD_VARS = [
	...TRACKING_BASE,
	...TRACKING_BASE.map((key) => `${key}Playoffs`),
];
export const TRACKING_PLAYOFFS_VARS = TRACKING_BASE.map(
	(key) => `${key}Playoffs`,
);
const TRACKING_AWARD_VAR_SET: ReadonlySet<string> = new Set(
	TRACKING_AWARD_VARS,
);
export const isTrackingAwardVar = (key: string) =>
	TRACKING_AWARD_VAR_SET.has(key);

const upper = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const PT_KEYS = PLAY_TYPES.map((pt) => upper(pt.key));

// Raw stats the derived variables are computed from
const DERIVED_INPUTS = [
	"min",
	"gp",
	"dfga",
	"dfgp",
	"dfga2",
	"dfga3",
	"dfgp2",
	"dfgp3",
	"rimDfga",
	"rimDfgp",
	"con2",
	"con3",
	"rimDeter",
	"onPoss",
	"onOffNet",
	"onOffDrtg",
	"clMin",
	"clPm",
	"clPts",
	"ptPoss",
	...PT_KEYS.flatMap((k) => [`pt${k}Poss`, `pt${k}Ppp`]),
];

const stripPlayoffs = (key: string) =>
	key.endsWith("Playoffs") ? key.slice(0, -"Playoffs".length) : key;

// What getPlayers needs to load for these formula variables
export const trackingNeeds = (variables: Iterable<string>) => {
	const stats = new Set<string>();
	let playoffs = false;
	let derived = false;
	for (const v of variables) {
		if (!TRACKING_AWARD_VAR_SET.has(v)) {
			continue;
		}
		const base = stripPlayoffs(v);
		if (base !== v) {
			playoffs = true;
		}
		if (TRACKING_BASE_SET.has(base) && !ADV_STAT_KEYS.includes(base as any)) {
			derived = true;
		} else {
			stats.add(base);
		}
	}
	if (derived) {
		for (const s of DERIVED_INPUTS) {
			stats.add(s);
		}
	}
	return { stats, playoffs, any: playoffs || derived || stats.size > 0 };
};

type Row = Record<string, any>;

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;
const clamp = (x: number, lim = 1) => Math.max(-lim, Math.min(lim, x));
const shrink = (n: number, k: number) => (n > 0 ? n / (n + k) : 0);

type LeagueContext = {
	dfgp2?: number;
	dfgp3?: number;
	rimDfgp?: number;
	con36?: number;
	ppp: Record<string, number | undefined>;
};

export const leagueContext = (rows: Row[]): LeagueContext => {
	let a2 = 0;
	let m2 = 0;
	let a3 = 0;
	let m3 = 0;
	let ra = 0;
	let rm = 0;
	let con = 0;
	let min = 0;
	const ptPoss: Record<string, number> = {};
	const ptPts: Record<string, number> = {};
	for (const r of rows) {
		const d2 = num(r.dfga2) ?? 0;
		const d3 = num(r.dfga3) ?? 0;
		const p2 = num(r.dfgp2);
		const p3 = num(r.dfgp3);
		if (d2 > 0 && p2 !== undefined) {
			a2 += d2;
			m2 += (d2 * p2) / 100;
		}
		if (d3 > 0 && p3 !== undefined) {
			a3 += d3;
			m3 += (d3 * p3) / 100;
		}
		const rA = num(r.rimDfga) ?? 0;
		const rP = num(r.rimDfgp);
		if (rA > 0 && rP !== undefined) {
			ra += rA;
			rm += (rA * rP) / 100;
		}
		const totMin = (num(r.min) ?? 0) * (num(r.gp) ?? 0);
		if (totMin >= 500 && (num(r.dfga) ?? 0) > 0) {
			con += (num(r.con2) ?? 0) + (num(r.con3) ?? 0);
			min += totMin;
		}
		for (const k of PT_KEYS) {
			const poss = num(r[`pt${k}Poss`]) ?? 0;
			const ppp = num(r[`pt${k}Ppp`]);
			if (poss > 0 && ppp !== undefined) {
				ptPoss[k] = (ptPoss[k] ?? 0) + poss;
				ptPts[k] = (ptPts[k] ?? 0) + poss * ppp;
			}
		}
	}
	const ppp: Record<string, number | undefined> = {};
	for (const k of PT_KEYS) {
		ppp[k] = ptPoss[k] ? ptPts[k]! / ptPoss[k]! : undefined;
	}
	return {
		dfgp2: a2 > 0 ? (100 * m2) / a2 : undefined,
		dfgp3: a3 > 0 ? (100 * m3) / a3 : undefined,
		rimDfgp: ra > 0 ? (100 * rm) / ra : undefined,
		con36: min > 0 ? (36 * con) / min : undefined,
		ppp,
	};
};

// The derived variables of one stats row (in place). Composites are 0 without data, the others NaN.
export const addDerived = (r: Row, L: LeagueContext) => {
	const dfga2 = num(r.dfga2) ?? 0;
	const dfga3 = num(r.dfga3) ?? 0;
	const dfga = dfga2 + dfga3;
	const dfgp = num(r.dfgp);
	const dfgp2 = num(r.dfgp2);
	const dfgp3 = num(r.dfgp3);

	let dfgpVsExp: number | undefined;
	if (
		dfga > 0 &&
		dfgp !== undefined &&
		L.dfgp2 !== undefined &&
		L.dfgp3 !== undefined
	) {
		const exp = (L.dfgp2 * dfga2 + L.dfgp3 * dfga3) / dfga;
		dfgpVsExp = exp - dfgp;
	}
	const dfgp2VsExp =
		dfgp2 !== undefined && L.dfgp2 !== undefined ? L.dfgp2 - dfgp2 : undefined;
	const dfgp3VsExp =
		dfgp3 !== undefined && L.dfgp3 !== undefined ? L.dfgp3 - dfgp3 : undefined;
	const rimDfga = num(r.rimDfga) ?? 0;
	const rimDfgp = num(r.rimDfgp);
	const rimDfgpVsExp =
		rimDfga > 0 && rimDfgp !== undefined && L.rimDfgp !== undefined
			? L.rimDfgp - rimDfgp
			: undefined;
	const totMin = (num(r.min) ?? 0) * (num(r.gp) ?? 0);
	const con = (num(r.con2) ?? 0) + (num(r.con3) ?? 0);
	const hasTracking = r.ptPoss !== undefined || r.onPoss !== undefined;
	const con36 = hasTracking && totMin > 0 ? (36 * con) / totMin : undefined;

	r.dfgpVsExp = dfgpVsExp ?? Number.NaN;
	r.dfgp2VsExp = dfgp2VsExp ?? Number.NaN;
	r.dfgp3VsExp = dfgp3VsExp ?? Number.NaN;
	r.rimDfgpVsExp = rimDfgpVsExp ?? Number.NaN;
	r.con36 = con36 ?? Number.NaN;

	const onPoss = num(r.onPoss) ?? 0;
	const onOffNet = num(r.onOffNet);
	r.trkImpact =
		onOffNet !== undefined ? clamp(onOffNet / 12) * shrink(onPoss, 2000) : 0;

	// Clutch: plus/minus (/40) and points over half a point per clutch minute (/30), shrunk by clutch minutes
	const clMin = num(r.clMin) ?? 0;
	const clPm = num(r.clPm);
	const clPts = num(r.clPts) ?? 0;
	r.trkClutch =
		clPm !== undefined && clMin > 0
			? clamp(
					(0.5 * clamp(clPm / 40) + 0.5 * clamp((clPts - 0.5 * clMin) / 30)) *
						shrink(clMin, 30),
				)
			: 0;

	// Defense: shot defense vs expected, rim protection, deterrence, activity and the team's defense with him on the floor
	let def = 0;
	if (dfgpVsExp !== undefined) {
		def += 0.3 * clamp(dfgpVsExp / 4) * shrink(dfga, 300);
	}
	if (rimDfgpVsExp !== undefined) {
		def += 0.25 * clamp(rimDfgpVsExp / 6) * shrink(rimDfga, 200);
	}
	const rimDeter = num(r.rimDeter);
	if (rimDeter !== undefined) {
		def += 0.1 * clamp(-rimDeter / 3) * shrink(onPoss, 2000);
	}
	if (con36 !== undefined && L.con36 !== undefined && L.con36 > 0) {
		def += 0.1 * clamp((con36 / L.con36 - 1) / 0.5) * shrink(totMin, 800);
	}
	const onOffDrtg = num(r.onOffDrtg);
	if (onOffDrtg !== undefined) {
		def += 0.2 * clamp(-onOffDrtg / 6) * shrink(onPoss, 2000);
	}
	r.trkDef = clamp(def);

	// Play-type efficiency: points over the league's PPP of each of his play types
	let added = 0;
	let poss = 0;
	for (const k of PT_KEYS) {
		const n = num(r[`pt${k}Poss`]) ?? 0;
		const ppp = num(r[`pt${k}Ppp`]);
		const lppp = L.ppp[k];
		if (n > 0 && ppp !== undefined && lppp !== undefined) {
			added += n * (ppp - lppp);
			poss += n;
		}
	}
	r.trkPtEff =
		poss > 0 ? clamp((100 * added) / poss / 20) * shrink(poss, 400) : 0;
};

// Playoff variants: from the season's playoff row (NaN without one; composites 0)
export const addPlayoffVariants = (r: Row, playoffsRow: Row | undefined) => {
	for (const key of TRACKING_BASE) {
		const value = playoffsRow?.[key];
		r[`${key}Playoffs`] =
			typeof value === "number" ? value : COMPOSITES.has(key) ? 0 : Number.NaN;
	}
};

// Default formulas with Advanced Tracking Stats on. Weights calibrated over 8 simulated leagues x 3 seasons (docs/native-features.md):
// each term is bounded (the variables are -1 to 1) and small next to the spread of the leading candidates' stock scores.
export const TRACKING_WEIGHTS = {
	mvpImpact: 0.1,
	mvpClutch: 0.05,
	def: 1,
	smoyImpact: 0.4,
	smoyPtEff: 0.3,
	fmvpImpact: 8,
};

export const TRACKING_FORMULA_TERMS = {
	mvp: `seasonFraction * (${TRACKING_WEIGHTS.mvpImpact} * trkImpact + ${TRACKING_WEIGHTS.mvpClutch} * trkClutch)`,
	def: `${TRACKING_WEIGHTS.def} * seasonFraction * trkDef`,
	smoy: `seasonFraction * (${TRACKING_WEIGHTS.smoyImpact} * trkImpact + ${TRACKING_WEIGHTS.smoyPtEff} * trkPtEff)`,
	fmvp: `${TRACKING_WEIGHTS.fmvpImpact} * trkImpactPlayoffs`,
};

export const advStatsOn = () =>
	__SPORT === "basketball" &&
	nativeFeatureEnabled("advStats", (key) => g.get(key as any));

type AwardLike = {
	formula: string;
	formulaByPos?: unknown;
	statRange?: unknown;
	numTeams?: number;
};

// MVP, All-League, 6MOY and Finals MVP (the defense awards are in perimeterDefense.ts): the formula the award is scored with, if the
// setting replaces the stock one. Edited awards are left alone.
export const trackingAwardFormula = (award: AwardLike) => {
	if (__SPORT !== "basketball" || award.formulaByPos !== undefined) {
		return;
	}
	let term: string | undefined;
	if (award.statRange === undefined) {
		if (
			award.formula === defaultAwards.mvp.formula ||
			award.formula === defaultAwards.all.formula
		) {
			term = TRACKING_FORMULA_TERMS.mvp;
		} else if (award.formula === defaultAwardsBasketball.smoy.formula) {
			term = TRACKING_FORMULA_TERMS.smoy;
		}
	} else if (
		award.statRange === defaultAwards.fmvp.statRange &&
		award.formula === defaultAwards.fmvp.formula
	) {
		term = TRACKING_FORMULA_TERMS.fmvp;
	}
	if (term !== undefined && advStatsOn()) {
		return `${award.formula} + ${term}`;
	}
};

// Awards only given with Advanced Tracking Stats on (Clutch Player of the Year)
export const awardActive = (award: { advStats?: boolean }) =>
	!award.advStats || advStatsOn();

// The award editor's list of tracking variables, grouped, with a description each
const groupOf = (key: string) => {
	if (key.startsWith("pt")) {
		return "Play types";
	}
	if (/^(ast|unast|astp)|^(cs3|pu3)/.test(key)) {
		return "Shooting splits";
	}
	if (/^(dfg|rimD|con)/.test(key) || key === "trkDef") {
		return "Defense";
	}
	if (/^(on|off)/.test(key) || key === "trkImpact") {
		return "On/off";
	}
	if (key.startsWith("cl") || key === "trkClutch") {
		return "Clutch";
	}
	return "Scores";
};
export const TRACKING_VARIABLE_GROUPS = [
	"Play types",
	"Shooting splits",
	"Defense",
	"On/off",
	"Clutch",
	"Scores",
] as const;

export const trackingVariableDocs = () => {
	const derived = new Map(TRACKING_DERIVED);
	return TRACKING_BASE.map((key) => {
		const desc =
			derived.get(key) ?? ADV_STAT_META[key as AdvStatKey]?.desc ?? key;
		return {
			key,
			playoffsKey: `${key}Playoffs`,
			desc,
			group: groupOf(key),
		};
	});
};
