// @ts-nocheck
/* eslint-disable no-undef */
// archnouns3: the user's improvement 6: the engine on real players' real seasons, to spot-check labels on names he knows.
// RUN_REAL_SPOT=<season> (REAL_SPOT_OUT=file.csv)
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { resetG } from "../../../test/helpers.ts";
import loadDataBasketball from "../../../worker/core/realRosters/loadData.basketball.ts";
import ovrFn from "../../../worker/core/player/ovr.basketball.ts";
import { positionFor } from "../position.ts";
import { ratingQuantiles } from "./gateScale.ts";
import { classifyV2 } from "./engine.ts";
import { defaultNormsFor } from "../classify.ts";

test.skipIf(!process.env.RUN_REAL_SPOT)(
	"real players' labels",
	async () => {
		resetG();
		const season = Number(process.env.RUN_REAL_SPOT);
		const data = await loadDataBasketball();
		const rows = data.ratings.filter((r) => r.season === season);
		const players = rows.map((r) => {
			const ratings = { ...r };
			const pos = positionFor(ratings, true);
			const ovr = ovrFn(ratings, pos);
			const bio = data.bios[r.slug];
			return {
				r,
				ratings,
				pos,
				ovr,
				name: bio?.name ?? r.slug,
				age: bio ? season - bio.bornYear : undefined,
			};
		});
		const q = ratingQuantiles(
			players.map((p) => ({ ratings: p.ratings, ovr: p.ovr })),
		);
		players.sort((a, b) => b.ovr - a.ovr);
		const out = ["name,pos,age,ovr,label"];
		for (const p of players.slice(0, 120)) {
			const norms = { ...defaultNormsFor(p.ratings), rq: q, nq: q };
			const c = classifyV2(p.ratings, {
				pos: p.pos,
				ovr: p.ovr,
				age: p.age,
				norms,
			});
			out.push(
				[p.name, p.pos, p.age ?? "", p.ovr, c.label]
					.map((v) => `"${String(v).replaceAll('"', '""')}"`)
					.join(","),
			);
		}
		writeFileSync(
			process.env.REAL_SPOT_OUT ?? "/tmp/realSpot.csv",
			out.join("\n"),
		);
	},
	600000,
);
