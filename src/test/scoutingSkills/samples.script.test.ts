// @ts-nocheck (node-only script, like src/test/staffDepth/calibration.script.test.ts)
/* eslint-disable no-undef */
// Strengths & weaknesses of prospects' scouting reports: sample reports and a coverage count in a headless league (new-league
// defaults) played to the draft lottery of its second season (so last season's report exists for the trend arrows).
// Run with RUN_SKILL_SAMPLES=1; SKILL_OUT (default /tmp/skillSamples.txt) gets the samples and the counts.
import { appendFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE, PLAYER } from "../../common/constants.ts";
import {
	ALL_ON,
	createLeague,
	mulberry32,
} from "../ratingInflation/harness.ts";
import { idb } from "../../worker/db/index.ts";
import { g } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import {
	clearScoutingCache,
	getPlayerScoutingPage,
} from "../../worker/core/scoutingReports/index.ts";

const format = (label, page) => {
	const k = page.report.skills;
	const lines = [
		`=== ${label}: ${page.report.name} (${page.pos}, ${page.age}) — overall ${page.report.overall.grade}, ${page.report.header.rangeLine} ===`,
		`${k.voice}. ${k.certaintyNote}`,
	];
	for (const x of [...k.strengths, ...k.weaknesses]) {
		const arrow = x.trend
			? x.trend.dir === "up"
				? " ▲"
				: x.trend.dir === "down"
					? " ▼"
					: " ■"
			: "";
		lines.push(
			`${x.side === "strength" ? "+" : "-"} [${x.tierLabel}] ${x.title}${arrow}: ${x.text}`,
		);
		for (const e of x.evidence) {
			lines.push(`    ${e.src}: ${e.text}`);
		}
		if (x.trend) {
			lines.push(`    trend: ${x.trend.text}`);
		}
		if (x.fix) {
			lines.push(`    ${x.fix.text}`);
		}
		if (x.dissent) {
			lines.push(`    ${x.dissent}`);
		}
	}
	lines.push(
		k.swing.text +
			(k.swing.evidence
				? ` (${k.swing.evidence.src}: ${k.swing.evidence.text})`
				: ""),
		`${k.role.text} Risk: ${k.role.risk} (${k.role.why}).`,
	);
	if (k.anchor) {
		lines.push(k.anchor);
	}
	lines.push(...k.contradictions);
	return lines.join("\n");
};

test.skipIf(!process.env.RUN_SKILL_SAMPLES)(
	"strengths & weaknesses samples",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const out = process.env.SKILL_OUT ?? "/tmp/skillSamples.txt";
		writeFileSync(out, "");
		const origRandom = Math.random;
		Math.random = mulberry32(Number(process.env.SKILL_SEED ?? 3));
		try {
			await createLeague({ ...ALL_ON });
			g.setWithoutSavingToDB("spectator", false);
			const season = g.get("season");
			await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
			if (!process.env.SKILL_ONE_SEASON) {
				await startAutoPlay(season + 1, PHASE.PRESEASON, {});
				await startAutoPlay(season + 1, PHASE.DRAFT_LOTTERY, {});
			}
			clearScoutingCache();
			const year = g.get("season");
			const list = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			)
				.filter((p) => p.draft.year === year)
				.sort((a, b) => b.valueFuzz - a.valueFuzz);
			const counts = {};
			const tiers = {};
			let trends = 0;
			let dissents = 0;
			let n = 0;
			const t0 = Date.now();
			const pages = [];
			for (const p of list) {
				const page = await getPlayerScoutingPage(p.pid);
				pages.push(page);
				const k = page.report.skills;
				n += 1;
				for (const x of [...k.strengths, ...k.weaknesses]) {
					counts[x.key] = (counts[x.key] ?? 0) + 1;
					tiers[x.tier] = (tiers[x.tier] ?? 0) + 1;
					trends += x.trend ? 1 : 0;
					dissents += x.dissent ? 1 : 0;
				}
			}
			const ms = (Date.now() - t0) / n;
			const picks = [
				["Elite", 0],
				["Mid", Math.floor(list.length / 2)],
				["Long shot", list.length - 1],
			];
			for (const [label, i] of picks) {
				appendFileSync(out, `${format(label, pages[i])}\n\n`);
			}
			appendFileSync(
				out,
				`${JSON.stringify({ prospects: n, msPerReport: Math.round(ms), trends, dissents, tiers, counts }, null, 1)}\n`,
			);
		} finally {
			Math.random = origRandom;
		}
	},
	3_600_000,
);
