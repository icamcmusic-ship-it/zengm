// @ts-nocheck (node-only script, like run.script.test.ts)
/* eslint-disable no-undef */
// Rumor calibration: headless multi-season sim with every League extra on, printing how often each type and confidence level of
// rumor came true. Run with
// RUN_RUMORS=1 npx vitest run --project basketball src/test/ratingInflation/rumors.script.test.ts
// Env: RUMOR_SEEDS (comma list, default 1), RUMOR_SEASONS (default 3), RUMOR_REPORT (text report, default /tmp/rumorsAudit.txt),
// RUMOR_OUT (json file with every rumor).
// RUMOR_FP=<file> RUMOR_ON=0|1 instead plays one season and some of the next (one seed) and writes what the AI decided, to compare
// the mill on and off in two processes:
// for on in 0 1; do RUN_RUMORS=1 RUMOR_FP=/tmp/fp$on.json RUMOR_ON=$on npx vitest run --project basketball src/test/ratingInflation/rumors.script.test.ts; done; cmp /tmp/fp0.json /tmp/fp1.json
import { appendFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { accuracyByLevel, accuracyByType } from "../../common/rumors/logic.ts";
import { renderRumorText } from "../../common/rumors/text.ts";
import { RUMOR_TYPE_NAMES } from "../../common/rumors/types.ts";
import { g, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import { ALL_ON, createLeague, mulberry32, simFingerprint } from "./harness.ts";

const report = process.env.RUMOR_REPORT ?? "/tmp/rumorsAudit.txt";
const log = (text) => appendFileSync(report, `${text}\n`);
const table = (rows) => {
	for (const row of rows) {
		log(
			Object.entries(row)
				.map(
					([key, value]) =>
						`${key}=${typeof value === "number" ? Math.round(value * 100) / 100 : value}`,
				)
				.join("  "),
		);
	}
	log("");
};

const seeds = (process.env.RUMOR_SEEDS ?? "1").split(",").map(Number);
const seasons = Number(process.env.RUMOR_SEASONS ?? 3);

test.skipIf(!process.env.RUN_RUMORS || !process.env.RUMOR_FP)(
	"rumor mill on/off fingerprint",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const on = process.env.RUMOR_ON === "1";
		const origRandom = Math.random;
		Math.random = mulberry32(seeds[0]);
		try {
			await createLeague({
				...ALL_ON,
				featureRumors: on,
				rumors: on
					? { seed: 77, nextRid: 0, tick: 0, items: [], stats: {} }
					: undefined,
			});
			const season = g.get("season");
			await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
			await startAutoPlay(season + 1, PHASE.REGULAR_SEASON, {});
			local.autoPlayUntil = undefined;
			writeFileSync(
				process.env.RUMOR_FP,
				JSON.stringify({
					fingerprint: await simFingerprint(),
					nextRandom: [Math.random(), Math.random(), Math.random()],
				}),
			);
			log(
				`fingerprint (rumors ${on ? "on" : "off"}): ${on ? g.get("rumors").items.length : 0} rumors`,
			);
		} finally {
			Math.random = origRandom;
			local.autoPlayUntil = undefined;
		}
	},
	3_600_000,
);

test.skipIf(!process.env.RUN_RUMORS || !!process.env.RUMOR_FP)(
	"rumor calibration",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const all = [];
		for (const seed of seeds) {
			const origRandom = Math.random;
			Math.random = mulberry32(seed);
			try {
				await createLeague({
					...ALL_ON,
					featureRumors: true,
					rumors: {
						seed: 1000 + seed,
						nextRid: 0,
						tick: 0,
						items: [],
						stats: {},
					},
				});
				const byRid = new Map();
				for (let i = 0; i < seasons; i++) {
					const season = g.get("season");
					const t0 = Date.now();
					await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
					await startAutoPlay(season + 1, PHASE.PRESEASON, {});
					for (const r of g.get("rumors").items) {
						byRid.set(r.rid, r);
					}
					log(
						`seed ${seed} season ${season}: ${byRid.size} rumors so far, ${Math.round((Date.now() - t0) / 1000)}s`,
					);
				}
				const state = g.get("rumors");
				const items = [...byRid.values()];
				all.push(...items);
				table(accuracyByType(state.stats, RUMOR_TYPE_NAMES));
				const name = (tid) => g.get("teamInfoCache")[tid]?.name ?? "?";
				for (const r of items.slice(0, 60)) {
					log(
						`[${r.season} ph${r.phase} ${r.type}${r.kind ? `/${r.kind}` : ""} ${r.confidence}] ${renderRumorText(r.text, name)} => ${r.status}${r.outcome ? `: ${renderRumorText(r.outcome, name)}` : ""}`,
					);
				}
			} finally {
				Math.random = origRandom;
				local.autoPlayUntil = undefined;
			}
		}
		table(accuracyByLevel(all));
		// By type, kind and confidence (tenths)
		const kinds = new Map();
		for (const r of all) {
			if (r.status === "open") {
				continue;
			}
			const key = `${r.type}/${r.kind ?? ""}/${Math.floor(r.confidence * 5) / 5}`;
			const row = kinds.get(key) ?? { n: 0, confirmed: 0, conf: 0 };
			row.n += 1;
			row.confirmed += r.status === "confirmed" ? 1 : 0;
			row.conf += r.confidence;
			kinds.set(key, row);
		}
		table(
			[...kinds.entries()]
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(([key, row]) => ({
					key,
					n: row.n,
					rate: Math.round((100 * row.confirmed) / row.n),
					meanConf: Math.round((100 * row.conf) / row.n),
				})),
		);
		if (process.env.RUMOR_OUT) {
			writeFileSync(process.env.RUMOR_OUT, JSON.stringify(all));
		}
	},
	3_600_000,
);
