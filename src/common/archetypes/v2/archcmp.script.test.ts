/* eslint-disable no-undef, curly */
// @ts-nocheck
// archcmp: the architecture comparison's data (RUN_ARCHCMP=1, ARCHCMP_OUT=dir). Writes, for every labeled player (the
// user's 2K list, the judged key, the user's shipped picks), his features (FAM_FEATS, class values, ratings, sub-ratings)
// and v2's reading as the held-out evaluation reads him (test split: the neighbours from the tune split only; tune split
// and picks: leave-one-out), with every candidate and what scored it; and the neighbours' table (shipped rows and picks).
// The variants are fitted and scored offline from this (scratchpad archcmp/cmp.py).
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../../worker/util/index.ts";
import {
	archetypeById,
	defaultNorms,
	scoreAll,
	ARCHETYPES,
} from "../classify.ts";
import { FAMILIES } from "../families.ts";
import { mergedId } from "../merges.data.ts";
import { FAM_FEATS } from "../model.ts";
import { nameAt } from "../posNames.ts";
import { SIM_SUB_NORMS } from "../judgedSim.data.ts";
import {
	generatedSubs,
	realData,
	realNorms,
	realPlayer,
	SUBS_ON,
} from "../real.testutil.ts";
import { judgedPlayers } from "../fit.script.test.ts";
import { userPlayers } from "../twoK/user2k.script.test.ts";
import { canonOf, classifyV2, V2_PARAMS } from "./engine.ts";
import { familyOfName, parseName } from "./grammar.ts";
import {
	BUCKET_OF,
	FEAT_FROM_FAMX,
	FEAT_W,
	shippedRefs,
	standardize,
} from "./knn.ts";
import { refsFromPicks } from "./picks.ts";
import { USER_PICKS } from "./userPicks.data.ts";
import { VOTER_REL } from "./voters.data.ts";

const OUT = process.env.ARCHCMP_OUT ?? "/tmp/claude-0/archcmp";
const NORMS = defaultNorms(false);
const REAL_NORMS = realNorms(NORMS, false);
const ratingsOfRow = (row) => {
	const r = {};
	for (const k of RATING_KEYS) r[k] = row[k];
	if (SUBS_ON && Array.isArray(row.sub)) r.sub = row.sub;
	return r;
};

const reading = (p, extra) => {
	const read = {
		norms: p.norms,
		pos: p.pos,
		age: p.age,
		stats: p.stats,
		prospect: p.prospect,
		pt: p.pt,
		traits: p.traits,
	};
	const s = scoreAll(
		p.ratings,
		read.norms,
		ARCHETYPES,
		read.pos,
		read.traits,
		read,
	);
	const c = classifyV2(p.ratings, { ...read, ...extra });
	const v = c.v2;
	return {
		pos: s.pos,
		bucket: BUCKET_OF[s.pos],
		famX: Object.fromEntries(FAM_FEATS.map((k, i) => [k, s.famX[i]])),
		x: standardize(FEAT_FROM_FAMX(s.famX), BUCKET_OF[s.pos]),
		cv: s.cv,
		ratings: Object.fromEntries(RATING_KEYS.map((k) => [k, p.ratings[k]])),
		sub: p.ratings.sub ?? null,
		statZ: p.stats?.z ?? null,
		v2: {
			id: c.id,
			name: c.name,
			family: v.family,
			famScore: v.famScore,
			voters: v.voters,
			probs: v.probs,
			classicConf: v.classicConf,
			classicTop: v.classicTop,
			classicScore: v.classicScore,
			votes: {
				family: v.votes.family,
				role: v.votes.role,
				desc: v.votes.desc,
				canon: v.votes.canon,
			},
			roles: v.roles,
			cands: v.candidates.map((x) => ({
				id: x.id,
				name: x.name,
				canon: x.canon,
				family: x.family,
				role: x.role ?? null,
				descs: x.descs,
				classic: !!x.classic,
				kind: x.kind,
				score: x.score,
			})),
		},
	};
};
// A sample league (30 teams of 15: generated players 19-34, developed, ovr 40+): the players v2 is least sure of (its
// confidence: the margin to the runner-up, halved when the family voters disagree), for the user to label
const uncertain = async () => {
	const { Rng } = await import("../../ratingsBuilds/rng.ts");
	const { DEFAULT_LEVEL } = await import("../../budgetLevels.ts");
	const generate = (await import("../../../worker/core/player/generate.ts"))
		.default;
	const develop = (await import("../../../worker/core/player/develop.ts"))
		.default;
	const ovrFn = (await import("../../../worker/core/player/ovr.ts")).default;
	const { ensureSubs } =
		await import("../../../worker/core/player/subRatings.ts");
	const { positionFor } = await import("../position.ts");
	const rng = new Rng("archcmp-sample-league");
	const orig = Math.random;
	Math.random = () => rng.random();
	const ps = [];
	try {
		while (ps.length < 450) {
			const k = rng.int(0, 15);
			const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
			if (k > 0) await develop(p, k, true);
			else if (SUBS_ON) ensureSubs(p);
			const row = p.ratings.at(-1);
			const ovr = ovrFn(row);
			if (ovr < 40) continue;
			const ratings = ratingsOfRow(row);
			ps.push({
				name: `Player ${ps.length + 1} (team ${(ps.length % 30) + 1})`,
				age: 19 + k,
				ovr,
				ratings,
				pos: positionFor(ratings, true),
			});
		}
	} finally {
		Math.random = orig;
	}
	const out = [];
	for (const p of ps) {
		const c = classifyV2(p.ratings, { norms: NORMS, pos: p.pos, age: p.age });
		const v = c.v2;
		const top = v.candidates.slice(0, 3);
		const fam = Object.entries(v.famScore).sort((a, b) => b[1] - a[1]);
		out.push({ p, c, v, top, fam });
	}
	// (least sure first: his confidence, then how close the runner-up is)
	const gap = (x) => Math.abs(x.top[0].score - (x.top[1]?.score ?? 0));
	out.sort((a, b) => a.c.confidence - b.c.confidence || gap(a) - gap(b));
	const R = (r) =>
		[
			"hgt",
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
		]
			.map((k) => `${k} ${r[k]}`)
			.join(", ");
	const lines = [
		"archcmp: the 20 players of a sample league (450 generated players, 30 teams of 15, ages 19-34, ovr 40+) v2 is least sure of.",
		"For each: v2's label and its two runners-up, the family scores and what each family voter said, and his ratings.",
		"Label each with the build (or 2K name) you would give him.",
		"",
	];
	for (const [i, x] of out.slice(0, 20).entries()) {
		lines.push(
			`${i + 1}. ${x.p.name}, ${x.p.pos}, age ${x.p.age}, ovr ${x.p.ovr}: ${x.c.name} (confidence ${Math.round(100 * x.c.confidence)}%; runners-up ${x.top
				.slice(1)
				.map((t) => t.name)
				.join(", ")})`,
			`   families: ${x.fam
				.slice(0, 3)
				.map(([f, s]) => `${f} ${s.toFixed(2)}`)
				.join(", ")}; voters ${Object.entries(x.v.voters)
				.filter(([, f]) => f)
				.map(([k, f]) => `${k} ${f}`)
				.join(
					", ",
				)}${x.v.layers ? `; categories ${x.v.layers.top.join(" + ")}, tree role ${x.v.layers.treeRole}` : ""}`,
			`   ratings: ${R(x.p.ratings)}`,
		);
	}
	writeFileSync(`${OUT}/uncertain.txt`, lines.join("\n") + "\n");
};
const targetOf = (names, pos) =>
	names.map((nm) => {
		const pr = parseName(nm, pos);
		return {
			name: nm,
			canon: canonOf(nm),
			family: familyOfName(nm, pos),
			role: pr.role ?? null,
			descs: pr.descs,
		};
	});

test.skipIf(!process.env.RUN_ARCHCMP)(
	"archcmp data",
	async () => {
		resetG();
		g.setWithoutSavingToDB("improvedPositions", true);
		if (SUBS_ON) g.setWithoutSavingToDB("subRatings", true);
		if (process.env.ARCHCMP_MODE === "uncertain") {
			await uncertain();
			return;
		}
		const rows = [];
		for (const x of userPlayers()) {
			const p = {
				...x.p,
				norms: x.norms,
				age: x.read.age,
				stats: x.read.stats,
			};
			const extra =
				x.split === "test"
					? { srID: p.slug, knn: { tuneOnly: true } }
					: { srID: p.slug };
			const rd = reading(p, extra);
			rows.push({
				key: p.slug,
				who: `${x.r.name} ${p.season}`,
				src: x.r.allTime ? "2kAllTime" : "2k",
				split: x.split,
				w: x.w,
				ovr: p.ovr,
				ovr2k: x.r.ovr ?? null,
				target: targetOf([x.r.arch], rd.pos),
				...rd,
			});
		}
		const data = realData();
		for (const jp of judgedPlayers(false, NORMS)) {
			let p;
			if (jp.j.slug) {
				const row = data.d.ratings.find(
					(x) => x.slug === jp.j.slug && x.season === jp.j.season,
				);
				p = { ...realPlayer(data, row, ratingsOfRow), norms: REAL_NORMS };
			} else if (jp.j.src === "sim") {
				p = {
					ratings: { ...jp.j.ratings },
					pos: jp.pos,
					age: jp.j.age,
					norms: { ...NORMS, sub: SIM_SUB_NORMS },
					stats: jp.j.read?.stats,
					pt: jp.j.read?.pt,
				};
			} else {
				const ratings = { ...jp.j.ratings };
				const sub = generatedSubs(ratings, jp.j.key);
				if (sub) ratings.sub = sub;
				p = {
					ratings,
					pos: jp.pos,
					age: jp.j.age,
					prospect: jp.j.prospect,
					norms: NORMS,
				};
			}
			const key = jp.j.slug ?? jp.j.key;
			const extra =
				jp.j.split === "test"
					? { srID: key, knn: { tuneOnly: true } }
					: { srID: key };
			const rd = reading(p, extra);
			const names = jp.j.ids
				.map(mergedId)
				.map((id) => archetypeById(id))
				.filter(Boolean)
				.map((a) => nameAt(a, rd.pos));
			rows.push({
				key,
				who: p.name ?? key,
				src: "judged",
				split: jp.j.split,
				w: 1,
				ovr: p.ovr ?? null,
				ovr2k: null,
				target: targetOf(names, rd.pos),
				...rd,
			});
		}
		for (const pk of USER_PICKS) {
			if (!pk.input || !pk.picked) continue;
			const inp = pk.input;
			const p = {
				ratings: inp.ratings,
				pos: inp.pos,
				age: inp.age,
				prospect: inp.prospect,
				stats: inp.stats,
				pt: inp.pt,
				traits: inp.traits,
				norms: defaultNorms(typeof inp.ratings.wng === "number"),
			};
			const rd = reading(p, { srID: `upick:${pk.uid}` });
			rows.push({
				key: `upick:${pk.uid}`,
				who: `${pk.name} ${pk.season}`,
				src: "pick",
				split: "pick",
				w: 1,
				ovr: inp.ovr ?? null,
				ovr2k: null,
				target: targetOf(
					[nameAt(archetypeById(mergedId(pk.picked)), rd.pos)],
					rd.pos,
				),
				...rd,
			});
		}
		const refs = [...shippedRefs(), ...refsFromPicks(USER_PICKS, true)].map(
			(r) => ({
				key: r.key,
				name: r.name,
				pos: r.pos,
				bucket: r.bucket,
				src: r.src,
				split: r.split,
				family: r.family,
				role: r.role ?? null,
				descs: r.descs,
				canon: canonOf(r.name),
				x: r.x,
			}),
		);
		writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows));
		writeFileSync(
			`${OUT}/meta.json`,
			JSON.stringify({
				refs,
				FEAT_W,
				FAM_FEATS,
				FAMILIES,
				VOTER_REL,
				V2_PARAMS,
			}),
		);
	},
	3600000,
);
