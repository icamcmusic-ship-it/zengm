// archv2: compositional archetype names, like NBA 2K's. A name is a core ROLE (what he is first of all: Playmaker, Slasher,
// Stretch, Board Enforcer, Perimeter Lock, ...) with up to two DESCRIPTORS in front of it (2-Way, Crafty, Mid-Paint,
// Glass-Cleaning, Shot-Erasing, ...). Every word is a yes/no test against players at his position (v2/tests.ts, the
// rulebook's bars: rulebook.data.ts), so a name only says what he has: promises are kept by construction.
//
// Adding a word is one entry: a role (ROLES) or a descriptor (DESCRIPTORS) naming the rulebook concept its test reads (or a
// custom test in tests.ts), its display words and, for a descriptor, its slot. The archgaps proposals (Glue, Game Manager,
// Energy) go in that way once approved.
//
// A composed name that is one of our builds' names (or a 2K alias of one) IS that build (its id, description, colours and
// family); any other composed name is shown as it is, with a generated description, under a composed id ("v2:" + role +
// ":" + descriptors) that archetypeById resolves (composedArchetype).
import { conceptsOf, CONCEPTS } from "../twoK/concepts.ts";
import type { Family } from "../families.ts";
import type {
	Archetype,
	ArchetypeFamily,
	ArchetypeGroup,
	Pos,
} from "../types.ts";

export type PosGroup = "guard" | "wing" | "big";
export const GROUP_OF: Record<Pos, PosGroup> = {
	PG: "guard",
	G: "guard",
	SG: "guard",
	GF: "wing",
	SF: "wing",
	F: "wing",
	PF: "big",
	FC: "big",
	C: "big",
};
const ALL: PosGroup[] = ["guard", "wing", "big"];

// A role: the head of the name
export type RoleDef = {
	key: string;
	// Display: the default name, and alternatives that the labeled neighbours' names may pick (v2/engine.ts word votes)
	names: string[];
	// The rulebook concepts it is tested on: the first at its lead bar (and his head skill must be one of his three best),
	// the rest at their support bar. A custom test (tests.ts CUSTOM_TESTS) may stand in for a concept key.
	concepts: string[];
	groups: PosGroup[];
	// The name when a descriptor is in front (default: names[0]), e.g. "Open-Lane Burner" alone, "2-Way Burner" with one
	withDesc?: string;
	// The display word for a size group, when it differs (Stretch Four / Stretch Five style)
	byGroup?: Partial<Record<PosGroup, string>>;
	// archv3: a role that takes no descriptor (the role players' names: "no standout" has nothing to add)
	bare?: boolean;
};

// A descriptor: a word in front of the role
export type DescDef = {
	key: string;
	names: string[];
	concept: string;
	// 0: 2-Way; 1: style (Crafty, Physical, High-Flying); 2: skill (Mid-Paint, Glass-Cleaning, Shot-Erasing, ...). A name
	// has at most one word per slot 0 and 1, and its descriptors are written in slot order (2K's order)
	slot: 0 | 1 | 2;
	groups?: PosGroup[];
	// archv3: the word at a size group (the neighbours' variant is not taken over it)
	byGroup?: Partial<Record<PosGroup, string>>;
};

export const ROLES: RoleDef[] = [
	{
		key: "playmaker",
		names: ["Playmaker", "Dimer"],
		concepts: ["pass"],
		groups: ALL,
	},
	{
		key: "engine",
		names: ["Offensive Engine"],
		concepts: ["pass", "creator", "scorer"],
		groups: ["guard", "wing"],
	},
	{
		key: "creator",
		// (archv3: "Creator" alone is not a name; "Shot Creator" is 2K's)
		names: ["Shot Creator"],
		withDesc: "Creator",
		concepts: ["creator"],
		groups: ["guard", "wing"],
	},
	{
		key: "shotHunter",
		names: ["Shot Hunter"],
		concepts: ["shotHunt", "creator"],
		groups: ["guard", "wing"],
	},
	{
		key: "sniper",
		names: ["Sniper"],
		concepts: ["shotHunt"],
		groups: ["guard", "wing"],
	},
	{
		key: "sharpshooter",
		names: ["Sharpshooter"],
		concepts: ["catchShoot"],
		groups: ["guard", "wing"],
	},
	{
		key: "stretch",
		// (archv3: "Stretch" alone read as a half name, "v2:stretch::big" in the user's pick; with a word in front it is
		// 2K's "Board-Crashing Stretch")
		names: ["Stretch Big"],
		withDesc: "Stretch",
		concepts: ["catchShoot"],
		groups: ["big"],
	},
	{
		key: "bucketChaser",
		names: ["Bucket Chaser"],
		concepts: ["chaser", "scorer"],
		groups: ["guard", "wing"],
	},
	{
		key: "maestro",
		names: ["Mid-Range Maestro"],
		withDesc: "Maestro",
		concepts: ["mid"],
		groups: ALL,
	},
	{
		key: "slasher",
		names: ["Slasher"],
		concepts: ["slash"],
		groups: ["guard", "wing"],
	},
	{
		key: "finisher",
		names: ["Finisher", "Laymaker"],
		concepts: ["finish"],
		groups: ALL,
		// (archv5: the user's "2-Way Interior Finisher" for a big)
		byGroup: { big: "Interior Finisher" },
	},
	{
		key: "burner",
		names: ["Open-Lane Burner"],
		withDesc: "Burner",
		concepts: ["burner"],
		groups: ["guard", "wing"],
	},
	{
		key: "highFlyer",
		names: ["High Flyer"],
		concepts: ["air"],
		groups: ["guard", "wing"],
	},
	{
		key: "cutter",
		names: ["Off-Ball Cutter"],
		withDesc: "Cutter",
		concepts: ["cutter"],
		groups: ["wing", "big"],
	},
	{
		key: "hammer",
		names: ["Rim Hammer"],
		withDesc: "Hammer",
		concepts: ["hammer"],
		groups: ["big"],
	},
	{
		key: "rimRunner",
		names: ["Rim Runner"],
		concepts: ["run"],
		groups: ["big"],
	},
	{
		key: "lobThreat",
		names: ["Lob Threat"],
		concepts: ["lob"],
		groups: ["big"],
	},
	{
		key: "lock",
		names: ["Lockdown Defender"],
		withDesc: "Lock",
		concepts: ["lockdown"],
		groups: ["guard", "wing"],
	},
	{
		key: "ballHawk",
		names: ["Ball Hawk"],
		concepts: ["steal"],
		groups: ["guard", "wing"],
	},
	{
		key: "rimProtector",
		names: ["Shot Eraser", "Paint Protector", "Rim Protector"],
		concepts: ["rimD"],
		groups: ["wing", "big"],
	},
	{
		key: "boardEnforcer",
		names: ["Board Enforcer", "Glass Cleaner"],
		concepts: ["reb"],
		groups: ["wing", "big"],
	},
	{
		key: "boardHunter",
		names: ["Board Hunter"],
		concepts: ["oreb"],
		groups: ["wing", "big"],
	},
	{
		key: "postBully",
		names: ["Post Bully"],
		withDesc: "Bully",
		concepts: ["post", "strength"],
		groups: ["wing", "big"],
	},
	{
		key: "postPro",
		names: ["Post Pro"],
		concepts: ["post"],
		groups: ["wing", "big"],
	},
	// archgaps (user-approved): the role players' roles (custom tests in tests.ts: breadth, no standout)
	// archv3 (the user's 2K list, batch 4): a defender who guards inside and out (perimeter and rim D both his)
	{
		key: "switchDefender",
		bare: true,
		names: ["Switch Defender"],
		concepts: ["switchD"],
		groups: ["wing", "big"],
	},
	{
		key: "glueWing",
		bare: true,
		names: ["Glue Wing"],
		concepts: ["glueWing"],
		groups: ["wing"],
	},
	{
		key: "glueGuard",
		bare: true,
		names: ["Glue Guard"],
		concepts: ["glueGuard"],
		groups: ["guard"],
	},
	// archv4 gap roles (the archv3 gap dump's weak clusters): a small guard who scores on floaters and touch, and a
	// prospect with the burst and the handle who is still raw on offense
	{
		key: "floaterGuard",
		bare: true,
		names: ["Crafty Floater Guard"],
		concepts: ["floaterRole"],
		groups: ["guard"],
	},
	{
		key: "rawHandler",
		bare: true,
		names: ["Raw Athletic Handler"],
		concepts: ["rawHandlerRole"],
		groups: ["guard", "wing"],
	},
	// archv5 (the user's labels of the archcmp sample): an interior scorer with no jumper, a physical rebounding big with
	// no jumper, a scoring guard who does not defend, and the low-ovr labels (no skill good in absolute terms: young
	// players "Prospect", with the one tool he has; older ones "Depth Piece"). Their tests read his ratings themselves.
	{
		key: "paintBeast",
		names: ["Paint Beast"],
		concepts: ["paintBeastRole"],
		groups: ["wing", "big"],
	},
	{
		key: "interiorForce",
		bare: true,
		names: ["Interior Force"],
		concepts: ["interiorForceRole"],
		groups: ["wing", "big"],
	},
	{
		key: "offGuard",
		bare: true,
		names: ["Offensive-Minded Guard"],
		concepts: ["offGuardRole"],
		groups: ["guard"],
	},
	{
		key: "prospect",
		names: ["Prospect"],
		concepts: ["prospectRole"],
		groups: ALL,
	},
	{
		key: "depthPiece",
		bare: true,
		names: ["Depth Piece"],
		concepts: ["depthPieceRole"],
		groups: ALL,
	},
	{
		key: "gameManager",
		bare: true,
		names: ["Steady Game Manager"],
		concepts: ["gameManagerRole"],
		groups: ["guard"],
	},
	{
		key: "energyBig",
		bare: true,
		names: ["Energy Big"],
		concepts: ["energyRole"],
		groups: ["big"],
	},
];

export const DESCRIPTORS: DescDef[] = [
	{ key: "twoWay", names: ["2-Way"], concept: "twoWay", slot: 0 },
	{ key: "crafty", names: ["Crafty"], concept: "crafty", slot: 1 },
	{
		key: "physical",
		names: ["Physical", "Bruising", "Rugged"],
		concept: "strength",
		slot: 1,
	},
	{
		key: "highFlying",
		names: ["High-Flying", "Bouncy"],
		concept: "air",
		slot: 1,
	},
	{
		key: "ballHawking",
		names: ["Ball-Hawking", "Pesky"],
		concept: "steal",
		slot: 2,
	},
	{ key: "defensive", names: ["Defensive"], concept: "lockdown", slot: 2 },
	{
		key: "shotErasing",
		names: ["Shot-Erasing", "Paint-Protecting", "Backline"],
		concept: "rimD",
		slot: 2,
	},
	{
		key: "glass",
		names: ["Glass-Cleaning", "Board-Enforcing"],
		concept: "reb",
		slot: 2,
	},
	{ key: "boardHunting", names: ["Board-Hunting"], concept: "oreb", slot: 2 },
	{
		key: "playmaking",
		names: ["Playmaking", "Diming"],
		concept: "pass",
		slot: 2,
	},
	{
		key: "iso",
		names: ["Iso", "Shifty"],
		concept: "creator",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{ key: "threeLevel", names: ["3-Level"], concept: "threeLevel", slot: 2 },
	{ key: "insideOut", names: ["Inside-Out"], concept: "insideOut", slot: 2 },
	{ key: "threePt", names: ["3PT"], concept: "shotHunt", slot: 2 },
	// archv5 (the user's "Sharpshooting Slasher"): a catch-and-shoot word for guards and wings (Stretch is the bigs'); it
	// keeps the Sharpshooter's bar (rulebook.data.ts WORD_RULES.sniper) and floor (tests.ts ABS_FLOORS)
	{
		key: "sharpshooting",
		names: ["Sharpshooting"],
		concept: "catchShoot",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{
		key: "stretchy",
		names: ["Stretch"],
		concept: "catchShoot",
		slot: 2,
		// (archv3: a big's word; on a wing "Stretch Cutter" read wrong)
		groups: ["big"],
	},
	{ key: "midPaint", names: ["Mid-Paint"], concept: "midPaint", slot: 2 },
	{
		key: "midPost",
		names: ["Mid-Post"],
		concept: "midPost",
		slot: 2,
		groups: ["wing", "big"],
	},
	{ key: "middy", names: ["Middy", "Hash-Sinking"], concept: "mid", slot: 2 },
	{
		key: "pullUp",
		names: ["Pull-Up"],
		concept: "pullUp",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{
		key: "postScoring",
		names: ["Post-Scoring"],
		concept: "post",
		slot: 2,
		groups: ["wing", "big"],
	},
	{
		key: "slashing",
		names: ["Slashing", "Downhill"],
		concept: "slash",
		slot: 2,
	},
	{
		key: "rimRocking",
		names: ["Rim-Rocking", "Rim-Wrecking"],
		concept: "dunk",
		slot: 2,
	},
	{
		key: "rimRunning",
		names: ["Rim-Running", "Wing-Running"],
		// (archv3: a big runs to the rim, a guard or wing the wings: "2-Way Wing-Running Shot Eraser" read wrong)
		byGroup: {
			big: "Rim-Running",
			guard: "Wing-Running",
			wing: "Wing-Running",
		},
		concept: "run",
		slot: 2,
	},
];

export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));
export const DESC_BY_KEY = new Map(DESCRIPTORS.map((d) => [d.key, d]));

// Concepts that say the same kind of thing: a name never says one twice (no "Playmaking Playmaker", no "Mid-Paint
// Middy ...", no "Shot-Erasing Shot Eraser")
const CONCEPT_GROUP: Record<string, string> = {
	catchShoot: "shoot",
	shotHunt: "shoot",
	mid: "mid",
	midPaint: "mid",
	midPost: "mid",
	pullUp: "mid",
	chaser: "mid",
	threeLevel: "mid",
	slash: "finish",
	finish: "finish",
	dunk: "finish",
	hammer: "finish",
	paint: "finish",
	scoop: "finish",
	lob: "finish",
	air: "ath",
	run: "ath",
	burner: "ath",
	cutter: "ath",
	lockdown: "perD",
	steal: "perD",
	pressure: "perD",
	twoWay: "def",
	rimD: "rimD",
	reb: "reb",
	oreb: "reb",
	grabGo: "reb",
	pass: "pass",
	wizard: "pass",
	outlet: "pass",
	creator: "handle",
	tempo: "handle",
	post: "post",
	highLow: "post",
	strength: "stre",
	crafty: "style",
	glueWing: "glue",
	glueGuard: "glue",
	switchD: "perD",
	gameManagerRole: "glue",
	energyRole: "finish",
	floaterRole: "finish",
	rawHandlerRole: "handle",
	insideOut: "insideOut",
	paintBeastRole: "finish",
	interiorForceRole: "reb",
	offGuardRole: "offMind",
	prospectRole: "lowOvr",
	depthPieceRole: "lowOvr",
};
// Pairs that may share a group after all (2K says them): a mid-range word with the Maestro role
const ALLOWED_SAME: ReadonlySet<string> = new Set(["mid|maestro"]);
// Groups that overlap another (3-Level is a shot and a mid-range; Inside-Out a shot and a finish)
const ALSO: Record<string, string[]> = {
	// (archv3: "Defensive" after "2-Way" says defense twice)
	lockdown: ["def"],
	threeLevel: ["shoot"],
	insideOut: ["shoot", "finish"],
	chaser: ["shoot"],
	postBully: ["stre"],
};
const groupsOfConcept = (c: string) => [
	CONCEPT_GROUP[c] ?? c,
	...(ALSO[c] ?? []),
];
const roleGroups = (r: RoleDef) => [
	...new Set([
		...r.concepts.filter((c) => c !== "scorer").flatMap(groupsOfConcept),
		...(ALSO[r.key] ?? []),
	]),
];

const DEFENSIVE_ROLES: ReadonlySet<string> = new Set([
	"lock",
	"ballHawk",
	"rimProtector",
]);
// Words that read against a role (the mid-range maestro is no three-point or above-the-rim scorer)
// (the lockdown defender and the ball hawk take defensive, physical and athletic words, not a scorer's; a bully is no
// finesse player; an off-ball cutter does not isolate; a finisher with a three is Inside-Out)
const SCORER_WORDS = [
	"crafty",
	"iso",
	"threePt",
	"stretchy",
	"playmaking",
	"middy",
	"midPaint",
	"midPost",
	"pullUp",
	"postScoring",
	"insideOut",
	"threeLevel",
] as const;
const CLASHES: Partial<Record<string, readonly string[]>> = {
	maestro: ["threePt", "rimRocking", "rimRunning", "highFlying"],
	ballHawk: SCORER_WORDS,
	finisher: ["threePt"],
	lock: SCORER_WORDS,
	postBully: ["crafty"],
	cutter: ["iso"],
};
// Whether a role and descriptors make a valid name: no word group twice (except the allowed pairs), one 2-Way, one style
// word, at most two descriptors, each allowed at his size
export const compatible = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
): boolean => {
	if (
		descs.length > 2 ||
		!role.groups.includes(group) ||
		(role.bare && descs.length > 0) ||
		// (archv5: a Prospect's one word is his one tool: tests.ts lowOvrTools, engine.ts TOOL_DESC)
		// (a Paint Beast takes one word: "Diming Paint Beast")
		(role.key === "paintBeast" && descs.length > 1) ||
		(role.key === "prospect" &&
			(descs.length > 1 || descs.some((d) => !TOOL_DESC_KEYS.has(d.key)))) ||
		// (archv3: "2-Way" on a defender's role says defense twice: "2-Way Lock", "2-Way Shot Eraser"; a word that reads
		// against the role: "3PT Maestro", "Rim-Rocking Maestro")
		(DEFENSIVE_ROLES.has(role.key) && descs.some((d) => d.key === "twoWay")) ||
		descs.some((d) => CLASHES[role.key]?.includes(d.key))
	) {
		return false;
	}
	const used = new Map<string, string>();
	for (const g of roleGroups(role)) {
		used.set(g, "role");
	}
	const slots = new Set<number>();
	for (const d of descs) {
		if (d.groups && !d.groups.includes(group)) {
			return false;
		}
		if (d.slot < 2) {
			if (slots.has(d.slot)) {
				return false;
			}
			slots.add(d.slot);
		}
		for (const g of groupsOfConcept(d.concept)) {
			const prev = used.get(g);
			if (prev !== undefined) {
				if (!(prev === "role" && ALLOWED_SAME.has(`${g}|${role.key}`))) {
					return false;
				}
			}
			used.set(g, d.key);
		}
	}
	return true;
};

// archv5: the words a Prospect's tool may be (engine.ts TOOL_DESC)
export const TOOL_DESC_KEYS: ReadonlySet<string> = new Set([
	"glass",
	"rimRocking",
	"postScoring",
	"slashing",
	"threePt",
	"stretchy",
	"middy",
	"iso",
	"playmaking",
	"defensive",
	"crafty",
]);

// 2K's order: 2-Way, then the style word, then skill words (defensive and hustle words before scoring words)
const SKILL_ORDER = DESCRIPTORS.map((d) => d.key);
export const orderDescs = (descs: readonly DescDef[]): DescDef[] =>
	[...descs].sort(
		(x, y) =>
			x.slot - y.slot ||
			SKILL_ORDER.indexOf(x.key) - SKILL_ORDER.indexOf(y.key),
	);

// Display choices: the default word, or the variant the neighbours' names use most (engine.ts)
export type WordPick = Partial<Record<string, string>>;

export const roleWord = (
	role: RoleDef,
	group: PosGroup,
	hasDesc: boolean,
	pick?: WordPick,
): string =>
	pick?.[role.key] ??
	role.byGroup?.[group] ??
	(hasDesc ? (role.withDesc ?? role.names[0]!) : role.names[0]!);

export const descWord = (
	d: DescDef,
	pick?: WordPick,
	group?: PosGroup,
): string =>
	(group ? d.byGroup?.[group] : undefined) ?? pick?.[d.key] ?? d.names[0]!;

// archv3: 2K's own name for a role with these descriptors (whatever the display variants), from the user's list
// (archv5: the user's own wording for some of the names he labeled; "@group": at that size only)
const COMBO_NAMES: Record<string, string> = {
	"rimProtector|physical": "Rugged Rim Protector",
	"creator|ballHawking+playmaking": "Pesky Playmaking Creator",
	"finisher|highFlying": "Athletic Finisher",
	"finisher|twoWay+highFlying": "2-Way Athletic Finisher",
	"slasher|iso": "Shot-Creating Slasher",
	"slasher|twoWay+iso": "2-Way Shot-Creating Slasher",
	"slasher|twoWay@wing": "2-Way Slashing Wing",
	"playmaker|postScoring": "Post Playmaker",
	"creator|highFlying": "High-Flying Shot Creator",
	"paintBeast|playmaking": "Diming Paint Beast",
};
const comboKey = (role: RoleDef, descs: readonly DescDef[]) =>
	`${role.key}|${orderDescs(descs)
		.map((d) => d.key)
		.join("+")}`;
const comboName = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
): string | undefined => {
	const k = comboKey(role, descs);
	return COMBO_NAMES[`${k}@${group}`] ?? COMBO_NAMES[k];
};
export const composeName = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
	pick?: WordPick,
): string =>
	comboName(role, descs, group) ??
	[
		...orderDescs(descs).map((d) => descWord(d, pick, group)),
		roleWord(role, group, shortForm(role, descs), pick),
	].join(" ");
// The role's short form ("Bully", "Creator") follows a style or skill word; after 2-Way alone the role keeps its whole
// name where the short form is no name of its own ("2-Way Post Bully", not "2-Way Bully": archv3)
const FULL_AFTER_2WAY: ReadonlySet<string> = new Set([
	"postBully",
	"creator",
	"maestro",
	"cutter",
]);
const shortForm = (role: RoleDef, descs: readonly DescDef[]) =>
	descs.length > 0 &&
	!(FULL_AFTER_2WAY.has(role.key) && descs.every((d) => d.slot === 0));

// ---- composed ids ----
// "v2:<role>+<desc>+<desc>:<group>[:<word>=<variant>,...]": the role, the descriptors, his size group, and any display
// variants picked
export const COMPOSED_PREFIX = "v2:";
export const isComposedId = (id: string | undefined): id is string =>
	typeof id === "string" && id.startsWith(COMPOSED_PREFIX);
export const composedId = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
	pick?: WordPick,
): string => {
	const ds = orderDescs(descs);
	const variants: string[] = [];
	if (comboName(role, ds, group)) {
		pick = undefined;
	}
	const rw = roleWord(role, group, shortForm(role, ds), pick);
	if (rw !== roleWord(role, group, shortForm(role, ds))) {
		variants.push(`${role.key}=${role.names.indexOf(rw)}`);
	}
	for (const d of ds) {
		const w = descWord(d, pick, group);
		if (w !== d.names[0]) {
			variants.push(`${d.key}=${d.names.indexOf(w)}`);
		}
	}
	// (archv3: "v2:<role>[+<desc>...]:<group>[:<variants>]", with no empty part; the reading-17 form
	// "v2:<role>:<desc>+<desc>:<group>[:...]" is still read)
	return `${COMPOSED_PREFIX}${[role.key, ...ds.map((d) => d.key)].join("+")}:${group}${variants.length > 0 ? `:${variants.join(",")}` : ""}`;
};
export const parseComposedId = (
	id: string,
):
	| { role: RoleDef; descs: DescDef[]; group: PosGroup; pick: WordPick }
	| undefined => {
	if (!isComposedId(id)) {
		return undefined;
	}
	const parts = id.slice(COMPOSED_PREFIX.length).split(":");
	// (the current form has the group second; the reading-17 form has the descriptors second, maybe empty)
	const current = ALL.includes(parts[1] as PosGroup);
	const [head, ...descHead] = (parts[0] ?? "").split("+");
	const roleKey = head;
	const descKeys = current ? descHead.join("+") : parts[1];
	const group = current ? parts[1] : parts[2];
	const variants = current ? parts[2] : parts[3];
	const role = ROLE_BY_KEY.get(roleKey ?? "");
	if (!role || !ALL.includes(group as PosGroup)) {
		return undefined;
	}
	const descs: DescDef[] = [];
	for (const k of (descKeys ?? "").split("+").filter(Boolean)) {
		const d = DESC_BY_KEY.get(k);
		if (!d) {
			return undefined;
		}
		descs.push(d);
	}
	const pick: WordPick = {};
	for (const v of (variants ?? "").split(",").filter(Boolean)) {
		const [k, i] = v.split("=");
		const def = ROLE_BY_KEY.get(k!) ?? DESC_BY_KEY.get(k!);
		const w = def?.names[Number(i)];
		if (w) {
			pick[k!] = w;
		}
	}
	return { role, descs, group: group as PosGroup, pick };
};

// ---- families of names ----
// The family of a name at a position: its head word (the last word that is not a modifier), with the size of the player,
// as families.ts reads a build's (and the words the user's 2K list added: Hammer, Burner, Cutter, ...)
// (archv5: "Prospect" too: "Glass-Cleaning Prospect" is a rebounder; a Prospect alone is no family's)
const MODIFIERS = new Set([
	"strength",
	"skill",
	"twoWay",
	"scorer",
	"riser",
	"lowOvr",
]);
const BIG = new Set<Pos>(["F", "PF", "FC", "C"]);
export const familyOfName = (name: string, pos: Pos | undefined): Family => {
	const keys = conceptsOf(name).map((c) => c.key);
	const core = keys.filter((k) => !MODIFIERS.has(k));
	const head = core.at(-1) ?? keys.at(-1);
	const big = pos !== undefined && BIG.has(pos);
	switch (head) {
		case "pass":
		case "outlet":
		case "tripleDouble":
		case "tempo":
		case "wizard":
			return "playmaker";
		case "reb":
		case "oreb":
		case "grabGo":
			return keys.includes("post") && !keys.includes("pass")
				? "postBig"
				: "glass";
		case "rimD":
			return "rimProtector";
		case "lockdown":
		case "steal":
		case "twoWay":
		case "pressure":
			return "wingDefender";
		case "catchShoot":
		case "shotHunt":
			return big ? "stretchBig" : "shooter";
		case "post":
		case "highLow":
			return big ? "postBig" : "scorer";
		case "slash":
		case "finish":
		case "dunk":
		case "lob":
		case "paint":
		case "strength":
		case "hammer":
		case "scoop":
			return big ? "postBig" : "slasher";
		case "air":
		case "run":
		case "burner":
		case "cutter":
			return "slasher";
		case "glue":
			return "wingDefender";
		case "gameManager":
			return "playmaker";
		case "energy":
			return "postBig";
		// archv5
		case "interior":
			return big ? "postBig" : "slasher";
		case "lowOvr":
			return "allAround";
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

// The role a name is (its head word), and its descriptors: how the labeled players' names (the user's 2K list, the
// judged builds, the user's picks) are read for the neighbour vote. A word the grammar does not have is skipped.
const CONCEPT_ROLE: Record<string, string> = {
	pass: "playmaker",
	outlet: "playmaker",
	tempo: "playmaker",
	wizard: "playmaker",
	tripleDouble: "playmaker",
	creator: "creator",
	shotHunt: "sniper",
	catchShoot: "sharpshooter",
	chaser: "bucketChaser",
	mid: "maestro",
	midPaint: "maestro",
	midPost: "maestro",
	pullUp: "maestro",
	slash: "slasher",
	finish: "finisher",
	paint: "finisher",
	scoop: "finisher",
	burner: "burner",
	air: "highFlyer",
	cutter: "cutter",
	hammer: "hammer",
	dunk: "hammer",
	run: "rimRunner",
	lob: "lobThreat",
	lockdown: "lock",
	pressure: "lock",
	twoWay: "lock",
	steal: "ballHawk",
	rimD: "rimProtector",
	reb: "boardEnforcer",
	grabGo: "boardEnforcer",
	oreb: "boardHunter",
	post: "postPro",
	highLow: "postPro",
	strength: "postBully",
	glue: "glueWing",
	gameManager: "gameManager",
	energy: "energyBig",
};
const CONCEPT_DESC: Record<string, string> = Object.fromEntries(
	DESCRIPTORS.map((d) => [d.concept, d.key]),
);
export type ParsedName = { role?: string; descs: string[]; words: WordPick };
// archv5: role names that are a whole phrase (the concept the role's own words read as, if any)
const NAME_ROLES: { re: RegExp; role: string; concept?: string }[] = [
	{ re: /Paint Beast/, role: "paintBeast", concept: "interior" },
	{ re: /Interior Force/, role: "interiorForce", concept: "interior" },
	{ re: /Offensive-Minded/, role: "offGuard", concept: "offMind" },
	{ re: /Prospect/, role: "prospect", concept: "lowOvr" },
	{ re: /Depth Piece/, role: "depthPiece", concept: "lowOvr" },
];
export const parseName = (name: string, pos: Pos | undefined): ParsedName => {
	const cs = conceptsOf(name).map((c) => c.key);
	const core = cs.filter((k) => !MODIFIERS.has(k));
	// (archv5: the names whose role is a whole phrase: the role claims its own concept, if any, and every other word is a
	// descriptor)
	const own = NAME_ROLES.find((x) => x.re.test(name));
	const headKey = own ? own.concept : (core.at(-1) ?? cs.at(-1));
	let role = own ? own.role : headKey ? CONCEPT_ROLE[headKey] : undefined;
	const big = pos !== undefined && GROUP_OF[pos] === "big";
	if (role === "sharpshooter" && big) {
		role = "stretch";
	}
	if (role === "sniper" && cs.includes("creator") && /Shot Hunter/.test(name)) {
		role = "shotHunter";
	}
	if (role === "playmaker" && /Engine/.test(name)) {
		role = "engine";
	}
	if (role === "postPro" && cs.includes("strength")) {
		role = "postBully";
	}
	const descs: string[] = [];
	let headSeen = false;
	for (let i = cs.length - 1; i >= 0; i--) {
		const k = cs[i]!;
		if (!headSeen && k === headKey) {
			headSeen = true;
			continue;
		}
		let d = k === "skill" && /Crafty/.test(name) ? "crafty" : CONCEPT_DESC[k];
		// (archv5: a catch-and-shoot word in front is "Stretch" on a big, "Sharpshooting" on a guard or wing)
		if (d === "stretchy" && pos !== undefined && !big) {
			d = "sharpshooting";
		}
		if (d && !descs.includes(d)) {
			descs.push(d);
		}
	}
	// (the words he is called by: which display variant his name uses)
	const words: WordPick = {};
	for (const def of [...ROLES, ...DESCRIPTORS]) {
		for (const w of def.names) {
			if (name.includes(w)) {
				words[def.key] = w;
			}
		}
	}
	return { role, descs, words };
};

// ---- the archetype a composed id stands for ----
const FAMILY_TO_OLD: Record<Family, ArchetypeFamily> = {
	playmaker: "playmaker",
	scorer: "scorer",
	shooter: "shooter",
	slasher: "slasher",
	wingDefender: "defender",
	rimProtector: "defender",
	glass: "rebounder",
	stretchBig: "shooter",
	postBig: "skilled",
	allAround: "balanced",
};
const GROUP_TO_ARCH: Record<PosGroup, ArchetypeGroup> = {
	guard: "guard",
	wing: "wing",
	big: "big",
};
const POSITIONS_OF: Record<PosGroup, Pos[]> = {
	guard: ["PG", "G", "SG"],
	wing: ["GF", "SF", "F"],
	big: ["PF", "FC", "C"],
};
const ROLE_NOUN: Record<string, string> = {
	playmaker: "A playmaker",
	engine: "The engine of the offense",
	creator: "A shot creator",
	shotHunter: "A shot hunter",
	sniper: "A sniper",
	sharpshooter: "A sharpshooter",
	stretch: "A stretch big",
	bucketChaser: "A bucket chaser",
	maestro: "A mid-range scorer",
	slasher: "A slasher",
	finisher: "A finisher",
	burner: "A burner",
	highFlyer: "A high flyer",
	cutter: "A cutter",
	hammer: "A big who hammers it home",
	rimRunner: "A rim-running big",
	lobThreat: "A lob threat",
	lock: "A perimeter stopper",
	ballHawk: "A ball hawk",
	rimProtector: "A rim protector",
	boardEnforcer: "A rebounder",
	boardHunter: "An offensive rebounder",
	postBully: "A post bully",
	postPro: "A post scorer",
	glueWing: "A role-playing wing",
	switchDefender: "A defender",
	glueGuard: "A role-playing guard",
	gameManager: "A steady point guard",
	energyBig: "An energy big",
	floaterGuard: "A small guard",
	rawHandler: "A young ball handler",
	paintBeast: "An interior scorer",
	interiorForce: "A physical big",
	offGuard: "A scoring guard",
	prospect: "A young player",
	depthPiece: "A role player",
};
const CONCEPT_PHRASE = new Map(CONCEPTS.map((c) => [c.key, c.phrase]));
const CUSTOM_PHRASE: Record<string, string> = {
	glueWing: "defends, moves the ball and does a bit of everything",
	switchD: "guards on the perimeter and at the rim, so he can switch",
	glueGuard: "defends and keeps the offense moving",
	gameManagerRole: "runs the offense without mistakes",
	energyRole: "runs the floor, finishes at the rim and protects it",
	floaterRole: "scores in the lane with floaters and touch rather than burst",
	rawHandlerRole:
		"has the burst and the handle but is still raw as a shooter and decision-maker",
	crafty: "wins with craft and touch",
	paintBeastRole:
		"finishes inside with size or power and has no jumper to speak of",
	interiorForceRole: "rebounds and plays physical inside, with no jumper",
	offGuardRole: "looks for his shot and gives little on defense",
	prospectRole: "has no skill that is good yet in absolute terms",
	depthPieceRole: "has no skill that is good in absolute terms",
	air: "plays above the rim",
};
const joinPhrases = (xs: string[]) =>
	xs.length <= 1
		? (xs[0] ?? "")
		: `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

// A one-line description from the words: "A playmaker who defends his position and scores from mid-range and in the paint."
export const describe = (role: RoleDef, descs: readonly DescDef[]): string => {
	const own = role.concepts
		.filter((c) => c !== "scorer")
		.map((c) => CUSTOM_PHRASE[c] ?? CONCEPT_PHRASE.get(c))
		.filter((x): x is string => !!x);
	const extra = orderDescs(descs)
		.map((d) => CUSTOM_PHRASE[d.concept] ?? CONCEPT_PHRASE.get(d.concept))
		.filter((x): x is string => !!x);
	const phrases = [...new Set([...own.slice(1), ...extra])];
	const head = ROLE_NOUN[role.key] ?? "A player";
	const lead = own[0];
	const body = [lead, ...phrases].filter(Boolean) as string[];
	return `${head} who ${joinPhrases(body)}.`;
};

const composedCache = new Map<string, Archetype | null>();
// The archetype a composed id stands for (name, description, family, group, positions; a profile from its words'
// concepts so the why and the regenerator read it like a build), or undefined
export const composedArchetype = (
	id: string,
	familyOf: (name: string, pos: Pos | undefined) => Family = familyOfName,
): Archetype | undefined => {
	const hit = composedCache.get(id);
	if (hit !== undefined) {
		return hit ?? undefined;
	}
	const parsed = parseComposedId(id);
	let out: Archetype | null = null;
	if (parsed) {
		const { role, descs, group, pick } = parsed;
		const name = composeName(role, descs, group, pick);
		const w: Archetype["w"] = {};
		const tags = new Set<string>();
		for (const c of conceptsOf(name)) {
			for (const [k, v] of Object.entries(c.w)) {
				w[k as keyof typeof w] = Math.max(w[k as keyof typeof w] ?? 0, v!);
			}
			if (c.tag) {
				tags.add(c.tag);
			}
		}
		const positions = POSITIONS_OF[group];
		const fam = familyOf(name, positions[1]);
		out = {
			id,
			name,
			group: GROUP_TO_ARCH[group],
			family: FAMILY_TO_OLD[fam],
			desc: describe(role, descs),
			w,
			hgt: [0, 100],
			positions,
			tags: [...tags, "composed"],
			prior: 1,
			custom: true,
		};
	}
	composedCache.set(id, out);
	return out ?? undefined;
};
