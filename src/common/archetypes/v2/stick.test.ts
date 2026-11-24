// archstick: last season's label is kept while it still passes every rule and is about as good as this season's pick
import { assert, describe, test } from "vitest";
import { mergedId } from "../merges.data.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";
import { classifyV2 } from "./engine.ts";
import { composedId, isComposedId, ROLE_BY_KEY } from "./grammar.ts";
import {
	coverCtxOf,
	coverPromises,
	coverSkills,
	nounScores,
	NOUNS,
	type CoverScore,
} from "./nouns.ts";
import { pickNouns } from "./cover.ts";

const KEYS = [
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
] as const;
const POS: Pos[] = ["PG", "SG", "SF", "PF", "C", "G", "GF", "F", "FC"];
const rng = (i: number) => (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
const player = (i: number) => {
	const r = {} as ArchetypeRatings;
	for (const k of KEYS) {
		r[k] = Math.round(25 + 60 * rng(i * 37 + k.length * 11 + k.charCodeAt(0)));
	}
	const ovr = 30 + Math.round(35 * rng(i * 101 + 7));
	const age = 19 + (i % 16);
	return {
		r,
		opts: {
			pos: POS[i % POS.length]!,
			age,
			ovr,
			pot: age <= 22 ? ovr + Math.round(15 * rng(i * 7 + 3)) : ovr,
		},
	};
};
// The same player a season on: every rating moved by up to `d`
const nudged = (r: ArchetypeRatings, i: number, d: number) => {
	const out = { ...r };
	for (const k of KEYS) {
		if (k !== "hgt") {
			out[k] = Math.max(
				0,
				Math.min(
					100,
					r[k] + Math.round((2 * rng(i * 53 + k.charCodeAt(1)) - 1) * d),
				),
			);
		}
	}
	return out;
};
const read = (r: ArchetypeRatings, opts: object, prev?: { id: string }) =>
	classifyV2(r, {
		...opts,
		...(prev ? { previousId: prev.id } : {}),
	});

describe("archstick: sticky labels", () => {
	test("a player whose ratings did not move keeps his whole label", () => {
		for (let i = 0; i < 160; i++) {
			const { r, opts } = player(i);
			const a = read(r, opts);
			const b = read(r, opts, { id: a.id });
			assert.strictEqual(b.label, a.label, `player ${i}`);
		}
	}, 60_000);

	test("labels change less from season to season, and a kept label keeps every word's promise", () => {
		let fresh = 0;
		let sticky = 0;
		let kept = 0;
		for (let i = 0; i < 150; i++) {
			const { r, opts } = player(i);
			const a = read(r, opts);
			const r2 = nudged(r, i, 3);
			const b0 = read(r2, opts);
			const b = read(r2, opts, { id: a.id });
			fresh += b0.label !== a.label ? 1 : 0;
			sticky += b.label !== a.label ? 1 : 0;
			// (a main name kept over this season's pick: every word of it still keeps its promise)
			const main = b.label.split(" · ")[0]!;
			if (
				main !== b0.label.split(" · ")[0] &&
				main === a.label.split(" · ")[0]
			) {
				kept++;
				const x = {
					r: r2,
					pos: opts.pos,
					ovr: opts.ovr,
					pot: opts.pot,
					age: opts.age,
					prev: {
						id: isComposedId(a.id) ? a.id : mergedId(a.id),
					},
				};
				const p = pickNouns(x);
				assert.deepEqual(
					coverPromises(main, p.main ?? [], coverCtxOf(x)),
					[],
					`player ${i}: ${main}`,
				);
			}
		}
		assert.isAbove(kept, 0);
		assert.isBelow(sticky, fresh);
	}, 60_000);

	test("a development name is not kept once he outgrows it", () => {
		const role = ROLE_BY_KEY.get("hDevShoot")!;
		const id = composedId(role, [], "guard", { hDevShoot: role.names[0]! });
		const r = {
			...player(3).r,
			tp: 85,
			fg: 70,
			ft: 80,
			oiq: 65,
			drb: 60,
			pss: 55,
		};
		const c = read(r, { pos: "SG", age: 26, ovr: 52, pot: 52 }, { id });
		assert.notStrictEqual(c.id, id);
		assert.notMatch(c.name, /Raw|Developing|Project|Late Bloomer|Lottery/);
	});

	test("ties are broken the same way every time, and a near tie goes to last season's noun", () => {
		const s = (key: (typeof NOUNS)[number], pct: number): CoverScore => ({
			key,
			value: 70,
			pct,
			league: pct,
			group: pct,
			above: 0,
		});
		const scores = [s("reb", 0.8), s("three", 0.8), s("pass", 0.8)];
		const order = (xs: CoverScore[], fav?: Set<(typeof NOUNS)[number]>) =>
			coverSkills(xs, fav).map((x) => x.key);
		const want = [...scores]
			.map((x) => x.key)
			.sort((a, b) => NOUNS.indexOf(a) - NOUNS.indexOf(b));
		assert.deepEqual(order(scores), want);
		assert.deepEqual(order([...scores].reverse()), want);
		// (within STICK_TIE: last season's noun first; further: the standing decides)
		assert.strictEqual(
			order([s("three", 0.81), s("pass", 0.8)], new Set(["pass"]))[0],
			"pass",
		);
		assert.strictEqual(
			order([s("three", 0.85), s("pass", 0.8)], new Set(["pass"]))[0],
			"three",
		);
		// (and the same reading twice is the same label)
		const { r, opts } = player(9);
		assert.strictEqual(read(r, opts).label, read(r, opts).label);
		assert.deepEqual(
			nounScores(r).map((x) => x.key),
			nounScores({ ...r }).map((x) => x.key),
		);
	});
});
