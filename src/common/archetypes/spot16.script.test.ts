/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch16: the spot check (RUN_ARCHETYPE_SPOT16=1, ARCH_SPOT16_OUT=file, ARCH_SPOT16_DUMP=a new-league dump from
// longRun.script.test.ts LONG_RUN_ARCH_DUMP): the top 50 of a random league by overall and the top 75 of the real 2025
// ratings, each with his build, the runners-up and any fit note, then a list of famous players.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import {
	classify,
	defaultNorms,
	isPoorFit,
	scoreAll,
	ARCHETYPES,
} from "./classify.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { readLeagueDump } from "./userShares.script.test.ts";
import { archetypeById, explain } from "./classify.ts";
import { whyDrivers, whyLine } from "./whyText.ts";

const FAMOUS = [
	"Giannis Antetokounmpo",
	"Rudy Gobert",
	"Victor Wembanyama",
	"Evan Mobley",
	"Kawhi Leonard",
	"LeBron James",
	"Stephen Curry",
	"Nikola Jokic",
	"Luka Doncic",
	"Kevin Durant",
	"Joel Embiid",
	"Shai Gilgeous-Alexander",
	"Jayson Tatum",
	"Anthony Davis",
	"Jalen Brunson",
	"Anthony Edwards",
	"Draymond Green",
	"Klay Thompson",
	"Jimmy Butler",
	"Bam Adebayo",
	"Domantas Sabonis",
	"Chet Holmgren",
	"Jaren Jackson",
	"Paolo Banchero",
	"Zion Williamson",
	"Ja Morant",
	"Trae Young",
	"Devin Booker",
	"Donovan Mitchell",
	"Tyrese Haliburton",
	"Clint Capela",
	"Steven Adams",
	"Jrue Holiday",
	"Mikal Bridges",
	"Alex Caruso",
	"Lu Dort",
	"Brook Lopez",
	"Karl-Anthony Towns",
	"DeMar DeRozan",
	"Kyrie Irving",
];

test.skipIf(!process.env.RUN_ARCHETYPE_SPOT16)(
	"spot check",
	() => {
		const out = [];
		const line = (name, pos, ovr, c, sc) =>
			`${name} (${pos}, ovr ${ovr}): ${c.name} (${c.fit})${isPoorFit(c) ? " [poor fit]" : ""}${c.fitNote ? ` [note: ${c.fitNote}]` : ""} -- runners-up: ${sc
				.filter((s) => s.a.id !== c.id)
				.slice(0, 3)
				.map((s) => `${s.a.name} (${s.z.toFixed(2)})`)
				.join(", ")}`;
		if (process.env.ARCH_SPOT16_DUMP) {
			const d = readLeagueDump(process.env.ARCH_SPOT16_DUMP);
			out.push(`=== random league ${d.season}: top 50 by overall`);
			for (const x of d.players
				.filter((y) => y.tid >= -1)
				.sort((a, b) => b.ovr - a.ovr)
				.slice(0, 50)) {
				const sc = scoreAll(
					x.r,
					d.norms,
					ARCHETYPES,
					x.pos,
					undefined,
					x.read,
				).scored;
				out.push(line(x.name, x.pos, x.ovr, x.c, sc));
			}
			out.push("");
		}
		const rd = realData();
		const norms = realNorms(defaultNorms(false), false);
		const real = rd.d.ratings
			.filter((r) => r.season === 2025)
			.map((row) => realPlayer(rd, row));
		const show = (p) => {
			const read = { pos: p.pos, age: p.age, stats: p.stats };
			const c = classify(p.ratings, { norms, ...read });
			const sc = scoreAll(
				p.ratings,
				norms,
				ARCHETYPES,
				p.pos,
				undefined,
				read,
			).scored;
			const all = scoreAll(
				p.ratings,
				norms,
				ARCHETYPES,
				p.pos,
				undefined,
				read,
			);
			const cv = Object.entries(all.cv)
				.filter(([k]) =>
					[
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
					].includes(k),
				)
				.map(([k, v]) => `${k} ${v.toFixed(2)}`)
				.join(" ");
			const why = whyLine(
				whyDrivers({
					a: archetypeById(c.id),
					ratings: p.ratings,
					norms,
					read,
					rows: explain(c.id, p.ratings, norms, read),
				}),
			);
			return (
				line(p.name, p.pos, p.ovr, c, sc) +
				` -- why: ${why}` +
				(process.env.ARCH_SPOT16_CV ? ` || ${cv}` : "")
			);
		};
		out.push("=== real 2025: top 75 by overall");
		for (const p of [...real].sort((a, b) => b.ovr - a.ovr).slice(0, 75))
			out.push(show(p));
		out.push("", "=== famous players (2025)");
		for (const n of FAMOUS) {
			const p = real.find((x) =>
				x.name
					.normalize("NFD")
					.replace(/[\u0300-\u036f]/g, "")
					.startsWith(n),
			);
			if (p) out.push(show(p));
		}
		writeFileSync(
			process.env.ARCH_SPOT16_OUT ?? "/tmp/arch-spot16.txt",
			out.join("\n") + "\n",
		);
	},
	1800000,
);
