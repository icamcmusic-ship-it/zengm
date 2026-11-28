// archcov: the reference set (reference.data.ts): players the user labelled by hand, rerun after every rule change.
// Reports how many the engine names as he does (the whole label, the main name, the same skills) and guards against a
// change that loses many of them at once. A fresh reading (no last-season label), as after a new reading version.
import { assert, test } from "vitest";
import { defaultNormsFor } from "../classify.ts";
import type { Norms } from "../types.ts";
import { classifyV2 } from "./engine.ts";
import { DEF_NOUNS, familyOf, nounsOfName } from "./nouns.ts";
import { REFERENCE_LEAGUE, REFERENCE_PLAYERS } from "./reference.data.ts";
import { HONEST_ROLES } from "./honest.ts";

// archskill (reading 29): the honest, depth and development names are retired at the user's request, so a player he
// labelled with one can't be named that way: he is left out of the share (and counted)
const RETIRED = new Set(HONEST_ROLES.flatMap((h) => h.names));

// The share of the reference set the engine must keep naming as the user does (main name, or the same skills)
// (archskill, reading 29: of the players not labelled with a retired honest name, reading 28 named 36 of 99 this way and
// reading 29 32: his labels predate the twelve new skills, which name some of them by a skill his label doesn't say)
// (archaudit 2059: 0.29, one player lower: the audit's two-skill rule for low-ovr players names a second skill the older
// reference labels leave out, Hunter Edwards and Michael McCoy)
const FLOOR = 0.29;

// (archfam: a label's skills as reading 28 says them: one per family (shooting, creation, perimeter D), and his defense
// as one, whether a defensive word, the old defensive tag or 2-Way says it)
const skillsOf = (label: string) =>
	[
		...new Set(
			label.split(" · ").flatMap((part) => {
				const nn = nounsOfName(part);
				return [
					...(nn?.nouns ?? []).map((n) =>
						DEF_NOUNS.has(n) ? "defense" : familyOf(n),
					),
					...(nn?.twoWay ? ["defense"] : []),
				];
			}),
		),
	]
		.sort()
		.join();

export const readReference = () => {
	let exact = 0;
	let main = 0;
	let skills = 0;
	let retired = 0;
	const misses: string[] = [];
	for (const p of REFERENCE_PLAYERS) {
		if (RETIRED.has(p.expected.split(" · ")[0]!)) {
			retired++;
			continue;
		}
		const c = classifyV2(p.ratings, {
			norms: {
				...defaultNormsFor(p.ratings),
				nq: REFERENCE_LEAGUE.nq,
				ng: REFERENCE_LEAGUE.ng,
			} as Norms,
			pos: p.pos,
			ovr: p.ovr,
			pot: p.pot,
			age: p.age,
			traits: p.traits,
		});
		const e = p.expected;
		const okExact = c.label === e;
		const okMain = c.label.split(" · ")[0] === e.split(" · ")[0];
		const se = skillsOf(e);
		const okSkills = se !== "" && se === skillsOf(c.label);
		exact += okExact ? 1 : 0;
		main += okMain ? 1 : 0;
		skills += okMain || okSkills ? 1 : 0;
		if (!okMain && !okSkills) {
			misses.push(`${p.name} (${p.pos} ${p.ovr}): ${c.label} [expected ${e}]`);
		}
	}
	return {
		n: REFERENCE_PLAYERS.length - retired,
		retired,
		exact,
		main,
		skills,
		misses,
	};
};

test("the reference set: the engine names the user's players as he does", () => {
	const r = readReference();
	const pc = (a: number) => `${Math.round((100 * a) / r.n)}%`;
	console.log(
		`reference set ${r.n} (${r.retired} more labelled with a retired honest name): whole label ${r.exact} (${pc(r.exact)}), main name ${r.main} (${pc(r.main)}), main name or the same skills ${r.skills} (${pc(r.skills)})`,
	);
	assert.isAtLeast(r.skills / r.n, FLOOR, r.misses.join("\n"));
}, 60_000);
