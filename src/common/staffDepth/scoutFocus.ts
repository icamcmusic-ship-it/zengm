// Scout Specialties & Assignments (featureScoutSpecialties): every scout's focus, a region (US college, international), a position group
// (guards, bigs) or a skill (shooting, athleticism). Derived from his seeded identity (no stored state, no random draws off the main stream):
// his specialty where it already says one, else a seeded pick.
import { Rng } from "../ratingsBuilds/rng.ts";
import type { Scout } from "../scoutingReports/types.ts";
import type { ScoutRegion } from "./types.ts";

export type ScoutFocus =
	| "usCollege"
	| "intl"
	| "guards"
	| "bigs"
	| "shooting"
	| "athleticism";

export const SCOUT_FOCUS_NAMES: Record<ScoutFocus, string> = {
	usCollege: "US college",
	intl: "International",
	guards: "Guards",
	bigs: "Bigs",
	shooting: "Shooting",
	athleticism: "Athleticism",
};

export const SCOUT_FOCUS_KIND: Record<ScoutFocus, string> = {
	usCollege: "region",
	intl: "region",
	guards: "position",
	bigs: "position",
	shooting: "skill",
	athleticism: "skill",
};

export const scoutFocusOf = (s: Pick<Scout, "seed" | "specialty">) => {
	switch (s.specialty) {
		case "college":
			return "usCollege";
		case "international":
			return "intl";
		case "athletes":
			return "athleticism";
		case "shooters":
			return "shooting";
		default: {
			// Pro personnel scouts look at the draft by position group (or, sometimes, a skill)
			const x = new Rng(`focus|${s.seed}`).random();
			return x < 0.4 ? "guards" : x < 0.8 ? "bigs" : "shooting";
		}
	}
};

const GUARD_POS = new Set(["PG", "SG", "G"]);
const BIG_POS = new Set(["C", "PF", "FC"]);

// Whether a prospect falls in a scout's focus
export const inScoutFocus = (
	focus: ScoutFocus,
	p: {
		region?: ScoutRegion;
		overseas?: boolean;
		pos: string;
		athletic: boolean;
		shooter: boolean;
	},
) => {
	switch (focus) {
		case "usCollege":
			return (
				p.overseas === false || (p.region !== undefined && p.region !== "intl")
			);
		case "intl":
			return p.overseas === true || p.region === "intl";
		case "guards":
			return GUARD_POS.has(p.pos);
		case "bigs":
			return BIG_POS.has(p.pos);
		case "shooting":
			return p.shooter;
		case "athleticism":
			return p.athletic;
	}
};

// Looks from a scout in his focus count this much more toward narrowing the fuzz
export const FOCUS_LOOKS_MULT = 1.35;
// A report by a scout in his focus: his own error shrinks to this
export const FOCUS_SIGMA_MULT = 0.75;

// Quick ratings-based reads for prospects (the worker side, where there are ratings and no category scores)
export const ratingsAthletic = (r: {
	spd: number;
	jmp: number;
	endu: number;
}) => (r.spd + r.jmp + 0.5 * r.endu) / 2.5 >= 55;
export const ratingsShooter = (r: { tp: number; fg: number; ft: number }) =>
	(1.5 * r.tp + r.fg + 0.5 * r.ft) / 3 >= 52;
