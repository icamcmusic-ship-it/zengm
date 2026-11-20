// @ts-nocheck (node-only script, like src/test/ratingInflation/run.script.test.ts)
/* eslint-disable no-undef */
// Prospect variety metrics (docs/native-features.md, Prospect variety). Opt-in: RUN_PROSPECT_VARIETY=1.
//
// Env:
// - PV_CLASSES: number of draft classes to generate and measure (default 30; 0 to skip)
// - PV_LEAGUE_SEEDS: comma list of seeds for full-engine league runs (default: none)
// - PV_SEASONS: seasons per league run (default 4)
// - PV_CONFIG: settings for both (a key of src/test/ratingInflation/toggles.ts, default newDefaults)
// - PV_OUT: a file to append the JSON results to
//
// Reports: within-position-group profile cosine, ft-tp correlation, share of bigs who shoot, class top-5 ovr SD, development outcome skew
// (4 seasons after the draft), distinct archetype labels per class and the top label's share; with league runs, the guardrails (mean/SD of
// ovr and pot, rostered position shares, 3PA rate, TS%, points).
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE, PLAYER } from "../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { mockIDBLeague, resetCache, resetG } from "../helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { g } from "../../worker/util/index.ts";
import { draft, player } from "../../worker/core/index.ts";
import { OFF, mulberry32, runLeague } from "../ratingInflation/harness.ts";
import { TOGGLES } from "../ratingInflation/toggles.ts";
import { fuzzedArchetypeLabel } from "../../worker/core/player/archetype.ts";
import { DEFAULT_NORMS } from "../../common/archetypes/index.ts";

const KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];
const GROUP = {
	PG: "guard",
	SG: "guard",
	G: "guard",
	GF: "wing",
	SF: "wing",
	F: "wing",
	PF: "big",
	FC: "big",
	C: "big",
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const corr = (a, b) => {
	const ma = mean(a);
	const mb = mean(b);
	let c = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < a.length; i++) {
		c += (a[i] - ma) * (b[i] - mb);
		va += (a[i] - ma) ** 2;
		vb += (b[i] - mb) ** 2;
	}
	return c / Math.sqrt(va * vb);
};
const skew = (xs) => {
	const m = mean(xs);
	const s = sd(xs);
	return mean(xs.map((x) => ((x - m) / s) ** 3));
};
const r2 = (x) => Math.round(x * 1000) / 1000;
const vec = (r) => {
	const v = KEYS.map((k) => r[k]);
	const m = mean(v);
	return v.map((x) => x - m);
};
const cosine = (a, b) => {
	let d = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		d += a[i] * b[i];
		na += a[i] ** 2;
		nb += b[i] ** 2;
	}
	return d / Math.sqrt(na * nb);
};

const settingsOf = () => {
	const config = process.env.PV_CONFIG ?? "newDefaults";
	return { config, settings: { ...OFF, ...TOGGLES[config] } };
};

const classMetrics = async (numClasses) => {
	const { config, settings } = settingsOf();
	const realRandom = Math.random;
	Math.random = mulberry32(Number(process.env.PV_SEED ?? 1));
	try {
		resetG();
		Object.assign(g, settings, {
			lid: 0,
			phase: PHASE.DRAFT_LOTTERY,
			playerTraitsSeed: 12345,
			generateCollegeStats: false,
			rerandomizeDraftClassRatings: false,
		});
		idb.league = mockIDBLeague();
		await resetCache({});
		const classes = [];
		const deltas = [];
		const vsPot = [];
		const startSeason = g.get("season");
		for (let i = 0; i < numClasses; i++) {
			g.setWithoutSavingToDB("season", startSeason + i);
			await draft.genPlayers(startSeason + i, DEFAULT_LEVEL);
			const players = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).filter((p) => p.draft.year === startSeason + i);
			classes.push(players);
			// Development: the drafted part of the class (top 60), 4 seasons of development with default coaching, from its own season
			if (i < 15) {
				const top = [...players].sort((a, b) => b.value - a.value).slice(0, 60);
				for (const p0 of top) {
					const p = structuredClone(p0);
					const ovr0 = p.ratings.at(-1).ovr;
					const pot0 = p.ratings.at(-1).pot;
					for (let y = 0; y < 4; y++) {
						g.setWithoutSavingToDB("season", startSeason + i + y + 1);
						player.addRatingsRow(p, DEFAULT_LEVEL);
						await player.develop(p, 1, false, DEFAULT_LEVEL, true);
					}
					g.setWithoutSavingToDB("season", startSeason + i);
					const ovr4 = p.ratings.at(-1).ovr;
					deltas.push(ovr4 - ovr0);
					vsPot.push(ovr4 - pot0);
				}
			}
		}

		const all = classes.flat();
		const rows = all.map((p) => p.ratings.at(-1));
		// Within position group: mean pairwise cosine of the centered 14-rating profiles
		const cos = {};
		for (const grp of ["guard", "wing", "big"]) {
			const vs = rows
				.filter((r) => GROUP[r.pos] === grp)
				.slice(0, 500)
				.map(vec);
			const cs = [];
			for (let i = 0; i < vs.length; i++) {
				for (let j = i + 1; j < vs.length; j++) {
					cs.push(cosine(vs[i], vs[j]));
				}
			}
			cos[grp] = r2(mean(cs));
		}
		const tps = rows.map((r) => r.tp).sort((a, b) => a - b);
		const tp90 = tps[Math.floor(0.9 * tps.length)];
		const bigs = rows.filter((r) => GROUP[r.pos] === "big");
		const top5 = classes.map((c) =>
			mean(
				c
					.map((p) => p.ratings.at(-1).ovr)
					.sort((a, b) => b - a)
					.slice(0, 5),
			),
		);
		const top1 = classes.map((c) =>
			Math.max(...c.map((p) => p.ratings.at(-1).ovr)),
		);

		// Archetype labels of the drafted part of each class (top 60 by value)
		const labelsPer = [];
		const topShare = [];
		for (const c of classes) {
			const top = [...c].sort((a, b) => b.value - a.value).slice(0, 60);
			const counts = new Map();
			for (const p of top) {
				const r = p.ratings.at(-1);
				const label = fuzzedArchetypeLabel(r, 0, DEFAULT_NORMS, {
					ovr: r.ovr,
					pot: r.pot,
				});
				counts.set(label, (counts.get(label) ?? 0) + 1);
			}
			labelsPer.push(counts.size);
			topShare.push(Math.max(...counts.values()) / top.length);
		}

		const ages = all.map((p) => p.draft.year - p.born.year);
		const ageShares = {};
		for (const a of ages) {
			ageShares[a] = (ageShares[a] ?? 0) + 1 / ages.length;
		}
		const top10Ages = classes.flatMap((c) =>
			[...c]
				.sort((a, b) => b.value - a.value)
				.slice(0, 10)
				.map((p) => p.draft.year - p.born.year),
		);
		const posShares = {};
		for (const r of rows) {
			posShares[r.pos] = (posShares[r.pos] ?? 0) + 1 / rows.length;
		}

		const out = {
			kind: "classes",
			config,
			classes: classes.length,
			cosine: cos,
			ftTp: r2(
				corr(
					rows.map((r) => r.ft),
					rows.map((r) => r.tp),
				),
			),
			spdJmp: r2(
				corr(
					rows.map((r) => r.spd),
					rows.map((r) => r.jmp),
				),
			),
			streDnk: r2(
				corr(
					rows.map((r) => r.stre),
					rows.map((r) => r.dnk),
				),
			),
			drbPss: r2(
				corr(
					rows.map((r) => r.drb),
					rows.map((r) => r.pss),
				),
			),
			tp90,
			tpMax: tps.at(-1),
			bigsWhoShoot: r2(bigs.filter((r) => r.tp >= tp90).length / bigs.length),
			// 6'11" and taller (hgt 63+) in the class's top 10% from three; 6'6" and shorter (hgt 44-) in its top 10% inside
			tallShooters: (() => {
				const tall = rows.filter((r) => r.hgt >= 63);
				return r2(tall.filter((r) => r.tp >= tp90).length / tall.length);
			})(),
			smallInside: (() => {
				const ins = rows.map((r) => r.ins).sort((a, b) => a - b);
				const ins90 = ins[Math.floor(0.9 * ins.length)];
				const small = rows.filter((r) => r.hgt <= 44);
				return r2(small.filter((r) => r.ins >= ins90).length / small.length);
			})(),
			top5Mean: r2(mean(top5)),
			top5Sd: r2(sd(top5)),
			top1Mean: r2(mean(top1)),
			top1Sd: r2(sd(top1)),
			ovrMean: r2(mean(rows.map((r) => r.ovr))),
			ovrSd: r2(sd(rows.map((r) => r.ovr))),
			potMean: r2(mean(rows.map((r) => r.pot))),
			potSd: r2(sd(rows.map((r) => r.pot))),
			labelsPerClass: r2(mean(labelsPer)),
			topLabelShare: r2(mean(topShare)),
			dev4Mean: r2(mean(deltas)),
			dev4Sd: r2(sd(deltas)),
			dev4Skew: r2(skew(deltas)),
			dev4VsPotMean: r2(mean(vsPot)),
			bustShare: r2(deltas.filter((d) => d <= 0).length / deltas.length),
			boomShare: r2(deltas.filter((d) => d >= 15).length / deltas.length),
			ageShares: Object.fromEntries(
				Object.entries(ageShares).map(([k, v]) => [k, r2(v)]),
			),
			top10AgeMean: r2(mean(top10Ages)),
			posShares: Object.fromEntries(
				Object.entries(posShares)
					.sort()
					.map(([k, v]) => [k, r2(v)]),
			),
		};
		return out;
	} finally {
		Math.random = realRandom;
	}
};

const leagueExtras = async () => {
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const pos = {};
	for (const p of players) {
		const r = p.ratings.at(-1);
		pos[r.pos] = (pos[r.pos] ?? 0) + 1 / players.length;
	}
	const teamStats = (await idb.cache.teamStats.getAll()).filter(
		(ts) => ts.season === season && !ts.playoffs,
	);
	let pts = 0;
	let fga = 0;
	let fta = 0;
	let tpa = 0;
	for (const ts of teamStats) {
		pts += ts.pts;
		fga += ts.fga;
		fta += ts.fta;
		tpa += ts.tpa;
	}
	return {
		posShares: Object.fromEntries(
			Object.entries(pos)
				.sort()
				.map(([k, v]) => [k, r2(v)]),
		),
		tpaRate: r2(tpa / fga),
		ts: r2(pts / (2 * (fga + 0.44 * fta))),
	};
};

test.skipIf(!process.env.RUN_PROSPECT_VARIETY)(
	"prospect variety metrics",
	async () => {
		const write = (o) => {
			console.log(JSON.stringify(o));
			if (process.env.PV_OUT) {
				appendFileSync(process.env.PV_OUT, JSON.stringify(o) + "\n");
			}
		};
		const numClasses = Number(process.env.PV_CLASSES ?? 30);
		if (numClasses > 0) {
			write(await classMetrics(numClasses));
		}
		const seeds = (process.env.PV_LEAGUE_SEEDS ?? "")
			.split(",")
			.filter((x) => x !== "")
			.map(Number);
		const seasons = Number(process.env.PV_SEASONS ?? 4);
		const { config, settings } = settingsOf();
		for (const seed of seeds) {
			await runLeague({
				config,
				settings,
				seed,
				seasons,
				onSeason: async (s) => {
					write({
						kind: "league",
						seed,
						season: s.season,
						ovrMean: s.ovrMean,
						ovrSd: s.ovrSd,
						potMean: s.potMean,
						potSd: s.potSd,
						rookieOvr: s.rookieOvr,
						rookiePot: s.rookiePot,
						nextClassTop30: s.nextClassTop30,
						ptsPerGame: s.ptsPerGame,
						tpaPerGame: s.tpaPerGame,
						...(await leagueExtras()),
					});
				},
			});
		}
	},
	24 * 3600 * 1000,
);
