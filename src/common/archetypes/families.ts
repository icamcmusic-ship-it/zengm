// arch14: build families. Every build belongs to one of ten families (what a player with it is first of all), and a player
// is read family first, then the best build within it (classify.ts, with a soft fallback when the family is uncertain).
// A build's family is its name's head noun ("Sniper" in "Crafty 3PT Sniper"; modifiers such as "2-Way", "Physical",
// "Crafty" or "Scorer" are skipped), with the size of the players it is for: a shooting name for bigs only is a stretch big,
// a finishing, post or strength name for bigs only an interior (post) big.
import { conceptsOf } from "./twoK/concepts.ts";
import type { Archetype, Pos } from "./types.ts";

export const FAMILIES = [
	"playmaker",
	"scorer",
	"shooter",
	"slasher",
	"wingDefender",
	"rimProtector",
	"glass",
	"stretchBig",
	"postBig",
	"allAround",
] as const;
export type Family = (typeof FAMILIES)[number];

export const FAMILY_NAMES: Record<Family, string> = {
	playmaker: "Playmaker",
	scorer: "Scorer / creator",
	shooter: "Shooter",
	slasher: "Slasher / athlete",
	wingDefender: "Perimeter defender",
	rimProtector: "Rim protector",
	glass: "Rebounder",
	stretchBig: "Stretch big",
	postBig: "Post / interior big",
	allAround: "All-around",
};

// Concepts that qualify a name rather than say what he is
const MODIFIERS = new Set(["strength", "skill", "twoWay", "scorer", "riser"]);
const BIG_POS = new Set<Pos>(["SF", "F", "PF", "FC", "C"]);
// Names whose family the rule gets wrong (nicknames, or a head noun that is not what the build is about)
const OVERRIDES: Record<string, Family> = {
	"the-anomaly": "allAround",
	"master-of-both-ends": "allAround",
	footer: "postBig",
	"fluid-four": "scorer",
};

const familyRule = (a: Archetype): Family => {
	if (OVERRIDES[a.id]) {
		return OVERRIDES[a.id]!;
	}
	if (a.tags.includes("allAround")) {
		return "allAround";
	}
	const keys = conceptsOf(a.name).map((c) => c.key);
	const core = keys.filter((k) => !MODIFIERS.has(k));
	const head = core.at(-1) ?? keys.at(-1);
	const big = a.positions.every((p) => BIG_POS.has(p));
	switch (head) {
		case "pass":
		case "outlet":
		case "tripleDouble":
		case "tempo":
			return "playmaker";
		case "reb":
		case "oreb":
			return keys.includes("post") && !keys.includes("pass")
				? "postBig"
				: "glass";
		case "rimD":
			return "rimProtector";
		case "lockdown":
		case "steal":
		case "twoWay":
			return "wingDefender";
		case "catchShoot":
		case "shotHunt":
			return big ? "stretchBig" : "shooter";
		case "post":
			return big ? "postBig" : "scorer";
		case "slash":
		case "finish":
		case "dunk":
		case "lob":
		case "paint":
		case "strength":
			return big ? "postBig" : "slasher";
		case "air":
		case "run":
			return "slasher";
		case "creator":
			return keys.includes("pass")
				? "playmaker"
				: keys.includes("shotHunt")
					? "shooter"
					: "scorer";
		default:
			return "scorer";
	}
};

const cache = new WeakMap<Archetype, Family>();
export const familyOf = (a: Archetype): Family => {
	let f = cache.get(a);
	if (!f) {
		f = familyRule(a);
		cache.set(a, f);
	}
	return f;
};
