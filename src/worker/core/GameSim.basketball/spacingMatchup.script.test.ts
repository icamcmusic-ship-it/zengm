// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of the Spacing & Shot Creation and Matchup Defense settings: league per-team-game averages with each setting off and on (all
// the other new-league defaults on, coaching systems included), assisted shares by shot type, and the effects of each setting. Run with
// SM_CAL=1 npx vitest --run --project basketball <this file> (SM_LEAGUES, SM_GAMES to change the size, SM_FEATURE=spacingCreation or
// matchupDefense for one of them, SM_STOCK=1 for the other settings at their existing-league defaults)
import { test } from "vitest";
import GameSim from "./index.ts";
import { genLeague, simLeague, boxAverages } from "./coachSystemsMetrics.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import { range } from "../../../common/utils.ts";
import {
	NON_SHOOTER_THREAT,
	SPACING,
	spacingAround,
} from "./spacingCreation.ts";

const mean = (xs) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

const TYPES = [
	"threePointer",
	"atRim",
	"lowPost",
	"midRange",
	"putBack",
	"tipIn",
];

// Counters filled by the wrappers below
let diag;
const resetDiag = () => {
	diag = {
		made: Object.fromEntries(TYPES.map((t) => [t, 0])),
		ast: Object.fromEntries(TYPES.map((t) => [t, 0])),
		passing: [],
		synergyOff: [],
		spacingRim: [],
		spacingAll: [],
		cramped: 0,
		othersAvg: [],
		crampedPen: [],
		self: 0,
		shots: 0,
		matchDelta: [],
		mismatchPost: 0,
		mismatchDrive: 0,
		matchShots: 0,
		postTilt: [],
		relByType: {},
		driveTilt: [],
	};
};
resetDiag();

const proto = GameSim.prototype;
const origDoFg = proto.doFg;
proto.doFg = function (p, passer, type, andOne) {
	diag.made[type] += 1;
	if (passer) {
		diag.ast[type] += 1;
		diag.passing.push(passer.compositeRating.passing);
	}
	return origDoFg.call(this, p, passer, type, andOne);
};
const origSyn = proto.updateSynergy;
proto.updateSynergy = function () {
	origSyn.call(this);
	diag.synergyOff.push(this.team[0].synergy.off, this.team[1].synergy.off);
};
const origInfo = proto.getShotInfo;
proto.getShotInfo = function (args) {
	const out = origInfo.call(this, args);
	if (!args.putBack && !args.tipInFromOutOfBounds) {
		diag.shots += 1;
		if (this.spacingCreation && (this.creator === args.p || !this.creator)) {
			diag.self += 1;
		}
		if (this.spacingCreation) {
			const ls = this.lineupSpacing[this.o];
			const threat = args.p.compositeRating.spacingThreat;
			const sp = spacingAround(ls, threat, this.numPlayersOnCourt - 1);
			diag.spacingAll.push(sp);
			if (out.type === "atRim") {
				diag.spacingRim.push(sp);
			}
			const others = ls.nonShooters - (threat < NON_SHOOTER_THREAT ? 1 : 0);
			diag.cramped += others >= 2 ? 1 : 0;
			diag.othersAvg.push((ls.sum - threat) / (this.numPlayersOnCourt - 1));
			diag.crampedPen.push(Math.max(0, others - 1) * SPACING.crampedStep);
		}
		if (this.matchupDefense && this.lastMatchup) {
			const m = this.lastMatchup;
			diag.matchShots += 1;
			diag.matchDelta.push(m.delta);
			if (m.post > 0) {
				diag.mismatchPost += 1;
			}
			if (m.drive > 0) {
				diag.mismatchDrive += 1;
			}
			diag.postTilt.push(m.post);
			if (!out.blocked) {
				(diag.relByType[out.type] ??= []).push(m.fitRel);
			}
			diag.driveTilt.push(m.drive);
		}
	}
	return out;
};

const SIM = [
	"realisticPossessions",
	"simFixes",
	"positionalComposites",
	"realisticRotations",
	"expandedRatings",
	"playerTraits",
	"perimeterDefense",
	"technicalFouls",
];

const playerSpread = (rows) => {
	// per player (pid within the pair's games): points per 36 and TS%, for players with 300+ minutes
	const acc = new Map();
	for (const row of rows) {
		for (const t of row.team) {
			for (const p of t.player) {
				const key = p.id;
				const a = acc.get(key) ?? { min: 0, pts: 0, fga: 0, fta: 0 };
				a.min += p.stat.min;
				a.pts += p.stat.pts;
				a.fga += p.stat.fga;
				a.fta += p.stat.fta;
				acc.set(key, a);
			}
		}
	}
	const per36 = [];
	const ts = [];
	for (const a of acc.values()) {
		if (a.min >= 300) {
			per36.push((36 * a.pts) / a.min);
			ts.push(a.pts / (2 * (a.fga + 0.44 * a.fta)));
		}
	}
	return { per36: sd(per36), ts: sd(ts), n: per36.length };
};

test.skipIf(!process.env.SM_CAL)(
	"spacing & matchup calibration",
	async () => {
		const numLeagues = Number(process.env.SM_LEAGUES ?? 2);
		const gamesPerPair = Number(process.env.SM_GAMES ?? 20);
		const base = process.env.SM_STOCK
			? {}
			: Object.fromEntries(
					Object.entries(nativeFeatureNewLeagueDefaults()).filter(
						([k]) => SIM.includes(k) || k === "coachSystems",
					),
				);
		const feature = process.env.SM_FEATURE;
		const features = feature
			? [feature]
			: ["spacingCreation", "matchupDefense"];
		const configs = process.env.SM_CONFIGS
			? JSON.parse(process.env.SM_CONFIGS)
			: [
					{ name: "off", on: [] },
					...features.map((x) => ({ name: x, on: [x] })),
					...(features.length > 1 ? [{ name: "both", on: features }] : []),
				];
		const out = {};
		for (const config of configs) {
			const settings = {
				...base,
				spacingCreation: false,
				matchupDefense: false,
			};
			for (const k of config.on) {
				settings[k] = true;
			}
			resetDiag();
			const rows = [];
			for (const L of range(numLeagues)) {
				const league = await genLeague({
					numPairs: 15,
					seed: 100 + L,
					settings,
				});
				rows.push(
					...(await simLeague({
						league,
						seed: 200 + L,
						gamesPerPair,
						coaches: !process.env.SM_STOCK,
						settings,
					})),
				);
			}
			const box = boxAverages(rows);
			let min = 0;
			let n = 0;
			for (const row of rows) {
				for (const t of row.team) {
					n += 1;
					for (const p of t.player) {
						min += p.stat.min;
					}
				}
			}
			box.min = min / n;
			const astShare = {};
			for (const t of TYPES) {
				astShare[t] = diag.ast[t] / diag.made[t];
			}
			const totalMade = TYPES.reduce((a, t) => a + diag.made[t], 0);
			const totalAst = TYPES.reduce((a, t) => a + diag.ast[t], 0);
			astShare.all = totalAst / totalMade;
			const spread = playerSpread(rows);
			out[config.name] = {
				box,
				astShare,
				spread,
				passing: mean(diag.passing),
				synergyOff: mean(diag.synergyOff),
				self: diag.self / diag.shots,
				spacingAll: mean(diag.spacingAll),
				spacingRim: mean(diag.spacingRim),
				cramped: diag.cramped / diag.shots,
				othersAvg: mean(diag.othersAvg),
				crampedPen: mean(diag.crampedPen),
				matchDelta: mean(diag.matchDelta),
				matchDeltaSd: sd(diag.matchDelta),
				mismatchPost: diag.mismatchPost / Math.max(1, diag.matchShots),
				mismatchDrive: diag.mismatchDrive / Math.max(1, diag.matchShots),
				postTilt: mean(diag.postTilt),
				driveTilt: mean(diag.driveTilt),
			};
			console.log(
				`done ${config.name}; mean matchup rel by shot type: ${Object.entries(
					diag.relByType,
				)
					.map(([k, v]) => `${k} ${f(mean(v), 4)}`)
					.join(", ")}`,
			);
		}
		const names = Object.keys(out);
		console.log(`stat | ${names.join(" | ")}`);
		for (const key of [
			"pts",
			"fgp",
			"tpaRate",
			"tpp",
			"ast",
			"tov",
			"orb",
			"fta",
			"stl",
			"blk",
			"pf",
			"poss",
			"min",
		]) {
			console.log(
				`${key} | ${names.map((x) => f(out[x].box[key], key === "fgp" || key === "tpaRate" || key === "tpp" ? 4 : 2)).join(" | ")}`,
			);
		}
		for (const t of [...TYPES, "all"]) {
			console.log(
				`assisted ${t} | ${names.map((x) => f(out[x].astShare[t])).join(" | ")}`,
			);
		}
		for (const key of [
			"passing",
			"synergyOff",
			"self",
			"spacingAll",
			"spacingRim",
			"cramped",
			"othersAvg",
			"crampedPen",
			"matchDelta",
			"matchDeltaSd",
			"mismatchPost",
			"postTilt",
			"driveTilt",
			"mismatchDrive",
		]) {
			console.log(
				`${key} | ${names.map((x) => f(out[x][key], 4)).join(" | ")}`,
			);
		}
		console.log(
			`player SD pts/36 | ${names.map((x) => f(out[x].spread.per36, 3)).join(" | ")}`,
		);
		console.log(
			`player SD TS% | ${names.map((x) => f(out[x].spread.ts, 4)).join(" | ")}`,
		);
	},
	3_600_000,
);
