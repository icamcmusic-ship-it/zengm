/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch17: the profiles behind the re-judged answer key (RUN_ARCHETYPE_REJUDGE=1, ARCH_REJUDGE_DIR=dir). Writes, for the
// judge, every judged player's full profile: base ratings, his skill classes, sub-ratings (as values and as leans against
// the league's own table), his box score and (simulated league) his play-type mix against his position's peers, plus the
// build list. No build is shown: the judges never see the reading's pick. ARCH_REJUDGE_SIM=a league dump from
// longRun.script.test.ts LONG_RUN_ARCH_DUMP (3 seasons in, Advanced Tracking Stats on): also samples SIM_N of its players
// with play types across positions and levels (sim.json: their ratings and reading, for judged.data.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES, defaultNorms, scoreAll } from "./classify.ts";
import { JUDGED } from "./judged.data.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { generatedSubs } from "./real.testutil.ts";
import { readLeagueDump } from "./userShares.script.test.ts";
import { subLeans, PT_FEATS } from "./subStyle.ts";
import { SUB_DEFS } from "../subRatings.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { positionFor } from "./position.ts";
import { POS_BUCKET } from "./norms.ts";
import { playTypeProfile, sumAdv } from "../advStats.ts";
import { playTypesOf } from "./subStyle.ts";
import { seedFromString } from "../subRatingsGen.ts";

const SIM_N = 150;
const CLS = [
	"shoot",
	"mid",
	"finish",
	"post",
	"handle",
	"pass",
	"reb",
	"rimD",
	"perD",
	"ath",
];
const PT_NAME = {
	iso: "iso",
	prb: "PnR-ball",
	spot: "spot-up",
	post: "post-up",
	cut: "cut",
	prr: "roll",
	tr: "transition",
	pb: "putback",
	offs: "off-screen/handoff",
};

const subText = (r, sn) => {
	if (!r.sub) return "subs: none";
	const l = subLeans(r, sn);
	const vals = SUB_DEFS.map((d, i) => `${d.key}${r.sub[i]}`).join(" ");
	const lean = SUB_DEFS.map((d, i) => [d.name, l[i]])
		.filter(([, z]) => Math.abs(z) >= 1)
		.sort((a, b) => b[1] - a[1])
		.map(([n, z]) => `${n} ${z > 0 ? "+" : ""}${z.toFixed(1)}`)
		.join(", ");
	return `subs: ${vals}\n  sub leans (z vs league): ${lean || "flat"}`;
};

const statText = (rows) => {
	const s = { gp: 0, min: 0, pts: 0, trb: 0, ast: 0, stl: 0, blk: 0, fga: 0 };
	let tpa = 0;
	let fta = 0;
	let tov = 0;
	let usg = 0;
	let rim = 0;
	let post = 0;
	let mid = 0;
	for (const r of rows) {
		s.gp += r.gp ?? 0;
		s.min += r.min ?? 0;
		s.pts += r.pts ?? 0;
		s.trb += (r.orb ?? 0) + (r.drb ?? 0) || (r.trb ?? 0);
		s.ast += r.ast ?? 0;
		s.stl += r.stl ?? 0;
		s.blk += r.blk ?? 0;
		s.fga += r.fga ?? 0;
		tpa += r.tpa ?? 0;
		fta += r.fta ?? 0;
		tov += r.tov ?? 0;
		usg += (r.usgp ?? 0) * (r.min ?? 0);
		rim += r.fgaAtRim ?? 0;
		post += r.fgaLowPost ?? 0;
		mid += r.fgaMidRange ?? 0;
	}
	if (s.min < 50) return "stats: none";
	const p36 = (x) => ((x * 36) / s.min).toFixed(1);
	let t = `stats: ${s.gp}g ${(s.min / Math.max(1, s.gp)).toFixed(0)}mpg, per36 ${p36(s.pts)}p ${p36(s.trb)}r ${p36(s.ast)}a ${p36(s.stl)}s ${p36(s.blk)}b ${p36(tov)}tov, 3PA rate ${((100 * tpa) / Math.max(1, s.fga)).toFixed(0)}%, FTr ${((100 * fta) / Math.max(1, s.fga)).toFixed(0)}%, usg ${(usg / s.min).toFixed(0)}%`;
	if (rim + post + mid > 0)
		t += `, FGA rim/post/mid/3 ${[rim, post, mid, tpa].map((x) => ((100 * x) / Math.max(1, s.fga)).toFixed(0)).join("/")}%`;
	return t;
};

const ptText = (pt, z) => {
	if (!pt) return "play types: none";
	return `play types (${pt.poss} poss; share, z vs position peers): ${PT_FEATS.map(
		(f) =>
			`${PT_NAME[f]} ${(100 * pt.freq[f]).toFixed(0)}%${z ? ` (${z.f[f] > 0 ? "+" : ""}${z.f[f].toFixed(1)})` : ""}`,
	).join(", ")}`;
};

const ratingText = (r) =>
	`ratings: ${RATING_KEYS.map((k) => `${k} ${r[k]}`).join(", ")}`;

const clsText = (cv) =>
	`skill classes (z): ${CLS.map((k) => `${k} ${cv[k].toFixed(1)}`).join(", ")}`;

test.skipIf(!process.env.RUN_ARCHETYPE_REJUDGE)(
	"re-judge profiles",
	() => {
		const dir = process.env.ARCH_REJUDGE_DIR;
		mkdirSync(dir, { recursive: true });
		const norms = defaultNorms(false);
		const rnorms = realNorms(norms, false);
		const data = realData();
		const profiles = [];
		for (const j of JUDGED) {
			let r;
			let pos;
			let age = j.age;
			let nm = norms;
			let stats = "stats: none";
			let read;
			if (j.slug) {
				nm = rnorms;
				const row = data.d.ratings.find(
					(x) => x.slug === j.slug && x.season === j.season,
				);
				const p = realPlayer(data, row);
				r = p.ratings;
				pos = p.pos;
				age = p.age;
				read = { age, stats: p.stats };
				stats = statText(
					(data.st.stats[j.slug] ?? []).filter(
						(x) => x.season === j.season - 1 && !x.playoffs,
					),
				);
			} else {
				r = { ...j.ratings };
				const sub = generatedSubs(r, j.key);
				if (sub) r.sub = sub;
				pos = positionFor(r, true);
				read = { age, prospect: j.prospect };
			}
			const cv = scoreAll(r, nm, ARCHETYPES, pos, undefined, read).cv;
			profiles.push({
				key: j.key,
				src: j.src,
				text: [
					`${j.key} [${j.src}${j.prospect ? ", prospect" : ""}] ${pos}, age ${age ?? "?"}`,
					ratingText(r),
					clsText(cv),
					subText(r, nm.sub ?? norms.sub ?? rnorms.sub),
					stats,
					"play types: none",
				].join("\n  "),
			});
		}
		// the simulated league
		const sim = [];
		if (process.env.ARCH_REJUDGE_SIM) {
			const d = readLeagueDump(process.env.ARCH_REJUDGE_SIM);
			const pool = d.players.filter((x) => x.tid >= 0 && x.read?.pt);
			// 5 position buckets x 3 levels, by a hash of the name
			const buckets = {};
			for (const x of pool) {
				const lv = x.ovr >= 55 ? 2 : x.ovr >= 47 ? 1 : 0;
				(buckets[`${POS_BUCKET[x.pos]}|${lv}`] ??= []).push(x);
			}
			const per = Math.ceil(SIM_N / Object.keys(buckets).length);
			for (const xs of Object.values(buckets)) {
				xs.sort(
					(a, b) =>
						seedFromString(`a17|${a.p.pid}`) - seedFromString(`a17|${b.p.pid}`),
				);
				sim.push(...xs.slice(0, per));
			}
			sim.splice(SIM_N);
			const season = d.season;
			const subNorms = d.norms.sub;
			for (const x of sim) {
				const r = {};
				for (const k of RATING_KEYS) r[k] = x.r[k];
				if (x.r.sub) r.sub = x.r.sub;
				const read = { ...x.read, pos: x.pos };
				const cv = scoreAll(
					r,
					{ ...norms, sub: subNorms },
					ARCHETYPES,
					x.pos,
					undefined,
					x.read,
				).cv;
				const last = x.p.stats.filter((s) => s.season === season - 1);
				const key = `Sim ${x.name} ${x.p.pid}`;
				x.key = key;
				profiles.push({
					key,
					src: "sim",
					text: [
						`${key} [sim league, ${season}, ovr ${x.ovr}] ${x.pos}, age ${x.read.age}`,
						ratingText(r),
						clsText(cv),
						subText(r, subNorms),
						statText(last),
						ptText(playTypesOf(playTypeProfile(sumAdv(last))), x.read.pt),
					].join("\n  "),
				});
				x.out = { key, pos: x.pos, ratings: r, age: x.read.age, read };
			}
			writeFileSync(
				`${dir}/sim.json`,
				JSON.stringify({ subNorms, players: sim.map((x) => x.out) }),
			);
		}
		writeFileSync(`${dir}/profiles.json`, JSON.stringify(profiles));
		// the build list
		const builds = ARCHETYPES.map(
			(a) =>
				`${a.id} | ${[a.name, ...Object.values(a.posNames ?? {})].join(" / ")} | ${a.family} | ${a.desc}`,
		);
		writeFileSync(`${dir}/builds.txt`, builds.join("\n") + "\n");
	},
	1800000,
);
