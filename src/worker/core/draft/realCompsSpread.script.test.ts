// @ts-nocheck
/* eslint-disable no-undef */
// How spread out the real-player comps of generated classes are (the user: "a few of the same name for late second round
// picks"). RUN_COMPS_SPREAD=1 (COMPS_OUT=file).
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import { getRealComps, resetRealCompsForTests } from "./realComps.ts";

test.skipIf(!process.env.RUN_COMPS_SPREAD)(
	"comps spread",
	async () => {
		resetG();
		g.setWithoutSavingToDB("featureRealComps" as any, true);
		await resetCache({});
		idb.league = mockIDBLeague();
		resetRealCompsForTests();
		const lines: string[] = [];
		const tiers = { top: new Map(), mid: new Map(), late: new Map() };
		let classes = 0;
		for (let c = 0; c < 4; c++) {
			await draft.genPlayers(g.get("season") + c, DEFAULT_LEVEL);
			classes++;
		}
		const all = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		const comps = await getRealComps(all);
		const byYear = new Map<number, typeof all>();
		for (const p of all) {
			const list = byYear.get(p.draft.year) ?? [];
			list.push(p);
			byYear.set(p.draft.year, list);
		}
		let late = 0;
		for (const [year, list] of byYear) {
			list.sort((a, b) => b.value - a.value);
			list.forEach((p, i) => {
				const tier = i < 30 ? "top" : i < 45 ? "mid" : "late";
				const cs = comps.get(p.pid) ?? [];
				for (const cmp of cs) {
					tiers[tier].set(cmp.name, (tiers[tier].get(cmp.name) ?? 0) + 1);
				}
				if (tier === "late") {
					late++;
				}
				lines.push(
					`${year} #${i + 1} ${p.ratings.at(-1).pos} ovr${p.ratings.at(-1).ovr}: ${cs.map((x) => `${x.name} (${x.similarity})`).join(" | ")}`,
				);
			});
		}
		const summary = Object.entries(tiers).map(([t, m]) => {
			const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
			const total = [...m.values()].reduce((a, b) => a + b, 0);
			return `${t}: ${m.size} distinct of ${total} comp slots; most used ${top.map(([n, k]) => `${n} ${k}`).join(", ")}`;
		});
		writeFileSync(
			process.env.COMPS_OUT ?? "/tmp/comps.txt",
			[...summary, "", ...lines].join("\n"),
		);
	},
	600000,
);
