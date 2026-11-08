// @ts-nocheck
import { appendFileSync } from "node:fs";
import { test } from "vitest";
const log = (...a: any[]) =>
	appendFileSync(
		"/tmp/claude-0/arch-report.txt",
		a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") +
			"\n",
	);
import { sampleLeague } from "./sample.testutil.ts";
import { ARCHETYPES, classify } from "./classify.ts";

test.skipIf(!process.env.RUN_ARCHETYPE_REPORT)(
	"report",
	async () => {
		const sample = await sampleLeague(8000, "report-v1");
		const counts: Record<string, number> = {};
		let hyb = 0;
		let conf = 0;
		for (const p of sample) {
			const c = classify(p.ratings, { ovr: p.ovr });
			counts[c.id] = (counts[c.id] ?? 0) + 1;
			if (c.secondary) hyb++;
			conf += c.confidence;
		}
		const rows = ARCHETYPES.map(
			(a) =>
				[a.name, a.group, (100 * (counts[a.id] ?? 0)) / sample.length] as const,
		).sort((a, b) => b[2] - a[2]);
		log(
			"used",
			rows.filter((r) => r[2] > 0).length,
			"hybrid",
			(hyb / sample.length).toFixed(2),
			"conf",
			(conf / sample.length).toFixed(2),
		);
		log(rows.map((r) => `${r[0]} (${r[1]}) ${r[2].toFixed(2)}`).join("\n"));
		const byGroup: Record<string, number> = {};
		for (const r of rows) byGroup[r[1]] = (byGroup[r[1]] ?? 0) + r[2];
		log(byGroup);
	},
	600000,
);
