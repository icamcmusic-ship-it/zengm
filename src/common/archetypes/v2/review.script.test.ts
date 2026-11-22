/* eslint-disable no-undef, curly */
// @ts-nocheck
// archreview: the user's review of 410 labels (200 league players, 210 draft prospects; 249 disagreements, each with the
// failing skill). ARCH_REVIEW_FILE: the joined review (one row per player: visible ratings, age, position, the label he was
// shown, agree, the failing skills), made by the scratchpad's archreview/build.py from the user's exports and CSV.
//   RUN_ARCHETYPE_REVIEW=1 ARCH_REVIEW_FILE=eval.json ARCH_REVIEW_OUT=report.txt npx vitest --run --project basketball \
//     src/common/archetypes/v2/review.script.test.ts
// Reports (1) how well the absolute gates (tests.ts ABS_GATES) reproduce the user's verdicts on the labels he was shown,
// (2) the engine's labels for the same players with the gates off and on (ARCH_REVIEW_VARIANTS: parameter sets): how many
// keep every gate, the plain fallback share, the most common labels, and the players the review names.
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { defaultNorms } from "../classify.ts";
import { isPos } from "../position.ts";
import { classifyV2 } from "./engine.ts";
import { gateGap } from "./tests.ts";

const NAMED = [
	"Richard Parent",
	"Brian Jeon",
	"Jaylon Parkinson",
	"Reed Holt",
	"John Arakelian",
	"Joe Long",
	"Josh Cash",
	"David Massey",
	"Travis Warren",
	"Chuma Showell",
	"Bernd Weber",
	"Jeremy Cochran",
	"Mladen Bozovic",
	"Tom Trujillo",
	"Vladimir Rautins",
	"Brylan Swann",
	"Nate Porter",
	"Ozzy Thomas",
	"Jacob Langford",
	"Kyle Logan",
	"Josue Porter",
	"Raimo Juntunen",
	"Leyton Johnson",
	"Mika Penttinen",
	"AJ Parsons",
	"Charlie White",
	"Greg Sherman",
	"Duop Leek",
	"Jawan Gearhart",
	"Vernard Vigille",
	"Tom Green",
	"Derrell Briggs",
	"Michael Puckett",
	"Cody Martin Jr.",
	"Tyler Knott",
	"Giles Cooper",
	"Ante Horvatincic",
];

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;

test.skipIf(!process.env.RUN_ARCHETYPE_REVIEW)(
	"archetype review",
	async () => {
		const rows = JSON.parse(readFileSync(process.env.ARCH_REVIEW_FILE, "utf8"));
		const out = [];
		const ratingsOf = (x) => {
			const r = { ...x.r };
			delete r.ovr;
			delete r.pot;
			return r;
		};
		// (1) the gates as a judge of the labels he was shown
		{
			const cm = { tp: 0, fp: 0, tn: 0, fn: 0 };
			const bySet = {};
			for (const x of rows) {
				const ok = gateGap(x.label, ratingsOf(x), x.r.ovr) <= 0;
				const k = `${ok ? "gates pass" : "gates fail"} / user ${x.agree ? "agrees" : "disagrees"}`;
				bySet[k] = (bySet[k] ?? 0) + 1;
				if (ok && x.agree) cm.tp++;
				else if (ok && !x.agree) cm.fp++;
				else if (!ok && !x.agree) cm.tn++;
				else cm.fn++;
			}
			out.push(
				`(1) gates vs the user's verdicts on the ${rows.length} labels he was shown: agree on ${pct(cm.tp + cm.tn, rows.length)}`,
				...Object.entries(bySet).map(([k, v]) => `    ${k}: ${v}`),
				"    disagreements the gates pass (first 25):",
			);
			for (const x of rows
				.filter((x) => !x.agree && gateGap(x.label, ratingsOf(x), x.r.ovr) <= 0)
				.slice(0, 25))
				out.push(
					`      ${x.name} (${x.pos}, ${x.age}, ovr ${x.r.ovr}) "${x.label}": ${x.fails.join("; ")}`,
				);
			out.push("    agreements the gates fail (first 25):");
			for (const x of rows
				.filter((x) => x.agree && gateGap(x.label, ratingsOf(x), x.r.ovr) > 0)
				.slice(0, 25))
				out.push(
					`      ${x.name} (${x.pos}, ${x.age}, ovr ${x.r.ovr}) "${x.label}" short ${gateGap(x.label, ratingsOf(x), x.r.ovr)}`,
				);
		}
		// (2) the engine on the same players
		const variants = process.env.ARCH_REVIEW_VARIANTS
			? JSON.parse(process.env.ARCH_REVIEW_VARIANTS)
			: {
					before: { gatePen: 0, honest: false },
					gates: { honest: false },
					honest: {},
				};
		const norms = defaultNorms(true);
		const labels = {};
		for (const [vn, params] of Object.entries(variants)) {
			const counts = {};
			let keep = 0,
				plain = 0,
				n = 0;
			const res = new Map();
			for (const x of rows) {
				const prospect = x.tid === -2;
				const c = classifyV2(ratingsOf(x), {
					norms,
					pos: isPos(x.pos) ? x.pos : "F",
					age: prospect ? undefined : x.age,
					prospect,
					ovr: x.r.ovr,
					pot: x.r.pot,
					pickKey: `review:${x.file}:${x.pid}`,
					params,
				});
				res.set(x.name + x.file, c);
				n++;
				counts[c.name] = (counts[c.name] ?? 0) + 1;
				if (gateGap(c.name, ratingsOf(x), x.r.ovr) <= 0) keep++;
				if (/^(Raw|Reserve) (Guard|Wing|Big)$/.test(c.name)) plain++;
			}
			labels[vn] = res;
			const { ELITE_RE, tierOf } = await import("./honest.ts");
			const { archetypeById } = await import("../classify.ts");
			for (const f of new Set(rows.map((x) => x.file))) {
				const xs = rows.filter((x) => x.file === f);
				let ok = 0,
					tierOk = 0,
					honest = 0;
				const cnt = {};
				for (const x of xs) {
					const c = res.get(x.name + x.file);
					const r = ratingsOf(x);
					const h = archetypeById(c.id)?.tags?.includes("honest");
					if (h || gateGap(c.name, r, x.r.ovr) <= 0) ok++;
					if (tierOf(x.r.ovr) === "elite" || !ELITE_RE.test(c.name)) tierOk++;
					if (h) honest++;
					cnt[c.name] = (cnt[c.name] ?? 0) + 1;
				}
				out.push(
					`    ${f} (n=${xs.length}): words true ${pct(ok, xs.length)}, no elite word below the top tier ${pct(tierOk, xs.length)}, honest names ${pct(honest, xs.length)}; ${Object.keys(cnt).length} distinct; top: ${Object.entries(
						cnt,
					)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 8)
						.map(([k, v]) => `${k} ${v}`)
						.join(", ")}`,
				);
			}
			const pros = rows.filter((x) => x.tid === -2);
			const plainPros = pros.filter((x) =>
				/^(Raw|Reserve) /.test(res.get(x.name + x.file).name),
			).length;
			const plainLeague = plain - plainPros;
			out.push(
				`== ${vn} ${JSON.stringify(params)}: every word true (gates) ${pct(keep, n)}; plain names ${pct(plain, n)} (league ${plainLeague} of ${n - pros.length}, prospects ${plainPros} of ${pros.length}); ${Object.keys(counts).length} distinct; top: ${Object.entries(
					counts,
				)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10)
					.map(([k, v]) => `${k} ${v}`)
					.join(", ")}`,
			);
		}
		const vns = Object.keys(variants);
		out.push(`== the players the review names (${vns.join(" -> ")}):`);
		for (const nm of NAMED) {
			for (const x of rows.filter((x) => x.name === nm)) {
				out.push(
					`  ${x.name} (${x.pos}, ${x.age}, ovr ${x.r.ovr}${x.tid === -2 ? ", prospect" : ""}) shown "${x.label}"${x.agree ? " (agreed)" : ""}: ${vns.map((vn) => labels[vn].get(x.name + x.file).name).join(" -> ")}`,
				);
			}
		}
		writeFileSync(
			process.env.ARCH_REVIEW_OUT ?? "/tmp/review.txt",
			out.join("\n") + "\n",
		);
	},
	600000,
);
