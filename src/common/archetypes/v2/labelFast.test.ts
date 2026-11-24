// classifyV2Label (speed: the noun reading alone when it names him) gives the label classifyV2 gives, for prospects and
// players, with and without last season's label, with and without his position
import { assert, test } from "vitest";
import { DEFAULT_NORMS } from "../index.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";
import { classifyV2, classifyV2Label } from "./engine.ts";

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
const POS: (Pos | undefined)[] = [
	"PG",
	"SG",
	"SF",
	"PF",
	"C",
	"G",
	"GF",
	"F",
	"FC",
	undefined,
];
const rng = (i: number) => (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;

test("classifyV2Label is classifyV2's label", () => {
	for (let i = 0; i < 250; i++) {
		const r = {} as ArchetypeRatings;
		for (const k of KEYS) {
			// (a few with very high or low ratings: specials, traits and honest names)
			const spread = i % 5 === 0 ? 95 : 60;
			r[k] = Math.round(
				(i % 5 === 0 ? 3 : 25) +
					spread * rng(i * 37 + k.length * 11 + k.charCodeAt(0)),
			);
		}
		const ovr = 25 + Math.round(50 * rng(i * 101 + 7));
		const age = 19 + (i % 16);
		const base = {
			norms: DEFAULT_NORMS,
			pos: POS[i % POS.length],
			ovr,
			pot: age <= 22 ? ovr + Math.round(15 * rng(i * 7 + 3)) : ovr,
			...(i % 2 === 0 ? { prospect: true } : { age }),
		};
		const full = classifyV2(r, base);
		assert.strictEqual(classifyV2Label(r, base), full.label, `player ${i}`);
		// Last season's label: his own, or another player's
		const prev = i % 3 === 0 ? full.id : classifyV2({ ...r, tp: 90 }, base).id;
		const withPrev = { ...base, previousId: prev };
		assert.strictEqual(
			classifyV2Label(r, withPrev),
			classifyV2(r, withPrev).label,
			`player ${i} with ${prev}`,
		);
	}
}, 120_000);
