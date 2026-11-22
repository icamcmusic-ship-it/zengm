// @ts-nocheck
/* eslint-disable no-undef */
// Position shares of the user's league players (ExportPlayers files), re-read from their ratings under a POSITION_BIAS
// variant. RUN_POS_LEAGUE=<comma list of files>, POS_BIAS='{"F":..}', POS_OUT=file.
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { positionFor, POSITION_BIAS } from "./position.ts";

test.skipIf(!process.env.RUN_POS_LEAGUE)(
	"league position shares",
	() => {
		const bias = process.env.POS_BIAS ? JSON.parse(process.env.POS_BIAS) : {};
		Object.assign(POSITION_BIAS, bias);
		const out: any[] = [];
		for (const f of process.env.RUN_POS_LEAGUE.split(",")) {
			let s = readFileSync(f, "utf8");
			if (s.charCodeAt(0) === 0xfeff) {
				s = s.slice(1);
			}
			const d = JSON.parse(s);
			const ps = d.players ?? d;
			const c: Record<string, number> = {};
			const stored: Record<string, number> = {};
			for (const p of ps) {
				const r = { ...p.ratings, season: undefined };
				const pos = positionFor(r, true);
				c[pos] = (c[pos] ?? 0) + 1;
				stored[p.pos] = (stored[p.pos] ?? 0) + 1;
			}
			const n = ps.length;
			const g = (x: Record<string, number>) => {
				const pct = (ks: string[]) =>
					Math.round((1000 * ks.reduce((s2, k) => s2 + (x[k] ?? 0), 0)) / n) /
					10;
				return {
					G: pct(["PG", "G", "SG"]),
					W: pct(["GF", "SF"]),
					F: pct(["F", "PF"]),
					B: pct(["FC", "C"]),
				};
			};
			out.push({ f: f.slice(-30), n, reread: g(c), stored: g(stored) });
		}
		writeFileSync(
			process.env.POS_OUT ?? "/tmp/posLeague.json",
			JSON.stringify(out),
		);
	},
	600000,
);
