// @ts-nocheck (node-only script, like src/test/frontOffice/calibration.script.test.ts)
/* eslint-disable no-undef */
// Scouting Director & Regions and Coaching Staff Depth calibration (docs/native-features.md). Run with RUN_STAFF_DEPTH=1.
// Env: SD_SEEDS (default 1,2), SD_SEASONS (default 10), SD_CONFIGS (on,off), SD_OUT (output directory).
//
// Headless leagues (src/test/ratingInflation/harness.ts) with the new-league defaults; "off" turns both features off. One JSON line per
// season with: the head coach pool by career start, promotions, the user's prospect fuzz narrowing by region coverage, league ovr and
// injuries; and, at the end of each "on" league, a counterfactual development experiment (the same players and random numbers developed
// with and without a plan, a shooting coach and a strength & conditioning coach one z above average).
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { PHASE, PLAYER } from "../../common/constants.ts";
import {
	ALL_ON,
	createLeague,
	mulberry32,
} from "../ratingInflation/harness.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import { player } from "../../worker/core/index.ts";
import { FOCUSES, focusLevel } from "../../common/staffDepth/devPlans.ts";
import {
	conditioningDeltas,
	shootingDeltas,
} from "../../common/staffDepth/coaching.ts";
import {
	ditherDeltas,
	planDevelopment,
	staffFocusFor,
} from "../../worker/core/staffDepth/coaching.ts";
import { subRatingsOn } from "../../worker/core/player/subRatings.ts";

const bucket = (c) =>
	c < 0.18 ? "blind" : c < 0.3 ? "thin" : c < 0.55 ? "covered" : "strong";

const seasonRow = async (config, seed) => {
	const season = g.get("season");
	const coaches = await idb.cache.coaches.getAll();
	const heads = coaches.filter((c) => c.tid >= 0 && c.role === "head");
	const origin = (c) =>
		!c.tree
			? "unknown"
			: c.tree.exPlayer !== undefined
				? "exPlayer"
				: c.tree.initial && c.tree.start === "head"
					? "initialHead"
					: c.tree.initial
						? "initialAssistant"
						: c.tree.start === "head"
							? "newHead"
							: "newAssistant";
	const headOrigins = {};
	for (const c of heads) {
		headOrigins[origin(c)] = (headOrigins[origin(c)] ?? 0) + 1;
	}
	const employed = coaches.filter((c) => c.tid >= 0);
	const startedAssistant = employed.filter(
		(c) => c.tree && c.tree.start !== "head",
	).length;
	const promotions = coaches.reduce(
		(a, c) =>
			a +
			(c.tree?.promotions ?? []).filter(
				(p) => p.season === season + 1 || p.season === season,
			).length,
		0,
	);
	// Promoted from another team's staff (hired away), this offseason
	const poached = coaches.filter((c) =>
		(c.tree?.promotions ?? []).some(
			(p) =>
				(p.season === season + 1 || p.season === season) &&
				c.transactions.some(
					(t) => t.type === "left" && t.season === season && t.tid !== p.tid,
				),
		),
	).length;
	const everPromotedHeads = heads.filter(
		(c) => (c.tree?.promotions ?? []).length > 0,
	).length;
	// The user's view of the class at the draft lottery
	const prospects = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter((p) => p.draft.year === season);
	const fuzzBy = {};
	for (const p of prospects) {
		const L = p.scoutLooks;
		if (!L) {
			continue;
		}
		const b = bucket(L.cov ?? 0);
		const row = (fuzzBy[b] ??= {
			n: 0,
			factor: 0,
			looks: 0,
			absFuzz: 0,
			absBase: 0,
		});
		row.n += 1;
		row.factor += L.a;
		row.looks += L.n;
		row.absFuzz += Math.abs(p.ratings.at(-1).fuzz);
		row.absBase += Math.abs(L.b);
	}
	const active = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const ovrs = active.map((p) => p.ratings.at(-1).ovr).sort((a, b) => b - a);
	const injuries = active.reduce(
		(a, p) => a + p.injuries.filter((i) => i.season === season).length,
		0,
	);
	return {
		config,
		seed,
		season,
		heads: heads.length,
		headOrigins,
		employed: employed.length,
		startedAssistant,
		promotions,
		poached,
		everPromotedHeads,
		fuzzBy,
		meanOvr: ovrs.reduce((a, b) => a + b, 0) / ovrs.length,
		top50Ovr: ovrs.slice(0, 50).reduce((a, b) => a + b, 0) / 50,
		injuries,
		numTeams: g.get("numActiveTeams"),
	};
};

// Same players, same random numbers: develop one season with and without each effect
const developmentExperiment = async (seed) => {
	const season = g.get("season") + 1;
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
	).slice(0, 400);
	const out = { plan: [], shoot: [], sc: [] };
	const run = async (p0, traitDev, s) => {
		const p = helpers.deepCopy(p0);
		const r = { ...p.ratings.at(-1), season };
		p.ratings.push(r);
		const orig = Math.random;
		Math.random = mulberry32(s);
		try {
			await player.develop(p, 1, false, 50, true, undefined, traitDev);
		} finally {
			Math.random = orig;
		}
		return p;
	};
	const neutral = { baseChangeDelta: 0, dropScale: 1 };
	for (const p0 of players) {
		const age = season - p0.born.year;
		const f = staffFocusFor(p0, season);
		const s = seed * 100000 + p0.pid;
		const before = p0.ratings.at(-1);
		const ctrl = await run(p0, neutral, s);
		const planned = planDevelopment(p0, f, age, 55, subRatingsOn());
		const plan = await run(
			p0,
			{
				...neutral,
				ratingDelta: ditherDeltas(planned.ratingDelta, `${p0.pid}|${season}`),
				subTilt: planned.subTilt,
			},
			s,
		);
		const rc = ctrl.ratings.at(-1);
		const rp = plan.ratings.at(-1);
		out.plan.push({
			age,
			focus: f,
			ctrl: focusLevel(rc, f) - focusLevel(before, f),
			plan: focusLevel(rp, f) - focusLevel(before, f),
			ovrCtrl: rc.ovr - before.ovr,
			ovrPlan: rp.ovr - before.ovr,
		});
		const shoot = await run(
			p0,
			{
				...neutral,
				ratingDelta: ditherDeltas(
					shootingDeltas(1, age),
					`${p0.pid}|${season}`,
				),
			},
			s,
		);
		out.shoot.push({
			age,
			d: shoot.ratings.at(-1).tp - rc.tp,
			dFt: shoot.ratings.at(-1).ft - rc.ft,
		});
		if (age >= 27) {
			const sc = await run(
				p0,
				{
					...neutral,
					ratingDelta: ditherDeltas(
						conditioningDeltas(1, age),
						`${p0.pid}|${season}`,
					),
				},
				s,
			);
			const rs = sc.ratings.at(-1);
			out.sc.push({
				age,
				d: (rs.spd + rs.jmp + rs.endu - rc.spd - rc.jmp - rc.endu) / 3,
			});
		}
	}
	const mean = (xs) =>
		xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
	const byFocus = {};
	for (const row of out.plan) {
		const b = (byFocus[row.focus] ??= { n: 0, gain: 0, ovr: 0 });
		b.n += 1;
		b.gain += row.plan - row.ctrl;
		b.ovr += row.ovrPlan - row.ovrCtrl;
	}
	for (const b of Object.values(byFocus)) {
		b.gain /= b.n;
		b.ovr /= b.n;
	}
	return {
		experiment: true,
		seed,
		n: out.plan.length,
		planFocusCtrl: mean(out.plan.map((r) => r.ctrl)),
		planFocusPlan: mean(out.plan.map((r) => r.plan)),
		planGain: mean(out.plan.map((r) => r.plan - r.ctrl)),
		planGainYoung: mean(
			out.plan.filter((r) => r.age <= 22).map((r) => r.plan - r.ctrl),
		),
		planGainOld: mean(
			out.plan.filter((r) => r.age >= 30).map((r) => r.plan - r.ctrl),
		),
		planOvr: mean(out.plan.map((r) => r.ovrPlan - r.ovrCtrl)),
		byFocus: Object.fromEntries(
			Object.entries(byFocus).map(([k, v]) => [FOCUSES[k].name, v]),
		),
		shootTp: mean(out.shoot.map((r) => r.d)),
		shootFt: mean(out.shoot.map((r) => r.dFt)),
		scAthletic: mean(out.sc.map((r) => r.d)),
	};
};

test.skipIf(!process.env.RUN_STAFF_DEPTH)(
	"staff depth calibration",
	async () => {
		if ((globalThis as any).IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const seeds = (process.env.SD_SEEDS ?? "1,2").split(",").map(Number);
		const seasons = Number(process.env.SD_SEASONS ?? 10);
		const configs = (process.env.SD_CONFIGS ?? "on,off").split(",");
		const outDir = process.env.SD_OUT ?? "/tmp/staffDepth";
		mkdirSync(outDir, { recursive: true });
		for (const seed of seeds) {
			for (const config of configs) {
				const file = `${outDir}/${config}-${seed}.jsonl`;
				const origRandom = Math.random;
				Math.random = mulberry32(seed);
				const t0 = Date.now();
				try {
					await createLeague({
						...ALL_ON,
						featureScoutingDepth: config === "on",
						featureCoachingDepth: config === "on",
					});
					g.setWithoutSavingToDB("spectator", false);
					for (let i = 0; i < seasons; i++) {
						const season = g.get("season");
						await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
						appendFileSync(
							file,
							JSON.stringify(await seasonRow(config, seed)) + "\n",
						);
						console.log(
							config,
							seed,
							season,
							`${Math.round((Date.now() - t0) / 1000)}s`,
						);
						if (i < seasons - 1) {
							await startAutoPlay(season + 1, PHASE.PRESEASON, {});
						}
					}
					if (config === "on") {
						appendFileSync(
							file,
							JSON.stringify(await developmentExperiment(seed)) + "\n",
						);
					}
				} finally {
					Math.random = origRandom;
					local.autoPlayUntil = undefined;
				}
			}
		}
	},
	24 * 3600 * 1000,
);
