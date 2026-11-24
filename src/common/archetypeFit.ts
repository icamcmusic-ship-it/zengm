// Archetype fit (basketball, the Archetypes feature): which of a team's composition warnings a new player would answer
// ("Fills a need" on the Free Agents, Trading Block and Trade pages), and lineup hints for the Roster page (the starting
// five and the bench unit after it). Pure: the worker gives the archetype ids, read the same way as everywhere else.
import {
	archetypeById,
	compositionOf,
	type Archetype,
	type ArchetypeGroup,
	type Rated,
	type Warning,
} from "./archetypes/index.ts";

export type Need = {
	kind: string;
	// Short name of what he brings: "Shooter"
	label: string;
	// The roster warning he answers
	text: string;
};

// What answers each composition warning (compositionOf). A warning that no single player answers (duplicates) is not here.
const NEED_LABELS: Record<string, string> = {
	playmaking: "Playmaker",
	spacing: "Shooter",
	rim: "Rim protector / rebounder",
	defense: "Defensive specialist",
	size: "Big man",
	ballhandling: "Guard",
};

// The warnings of the team's rotation a player could answer
export const fillableWarnings = (rows: Rated[]): Warning[] =>
	compositionOf(rows).warnings.filter((w) => NEED_LABELS[w.kind]);

// The needs `candidate` fills: the team's warnings that go away once he is in its rotation. Read through compositionOf
// itself, so the rules stay the roster panel's own. `warnings` is fillableWarnings(rows) (computed once per page).
export const needsFilled = (
	rows: Rated[],
	candidate: Rated,
	warnings: Warning[] = fillableWarnings(rows),
): Need[] => {
	if (warnings.length === 0 || !candidate.archetypeId) {
		return [];
	}
	// (he plays: put him at the top of the rotation, which compositionOf takes by ovr)
	const top = rows.reduce((m, r) => Math.max(m, r.ovr), 0) + 1;
	const after = new Set(
		compositionOf([
			...rows.filter((r) => r.pid !== candidate.pid),
			{ ...candidate, ovr: top },
		]).warnings.map((w) => w.kind),
	);
	return warnings
		.filter((w) => !after.has(w.kind))
		.map((w) => ({ kind: w.kind, label: NEED_LABELS[w.kind]!, text: w.text }));
};

// The tooltip of a "Fills a need" badge
export const needsTitle = (needs: Need[]) =>
	`Fills a need: ${needs.map((n) => `${n.label} (${n.text})`).join("; ")}`;

// ---- Lineup hints ----

export type LineupPlayer = {
	pid: number;
	name: string;
	pos?: string;
	archetypeId: string | undefined;
};

export type LineupHint = { kind: string; text: string };

export type LineupHints = {
	starters: LineupHint[];
	bench: LineupHint[];
};

// A position's size (as compositionOf reads it)
const POS_SIZE: Record<string, ArchetypeGroup> = {
	PG: "guard",
	G: "guard",
	SG: "guard",
	GF: "wing",
	SF: "wing",
	F: "forward",
	PF: "forward",
	FC: "big",
	C: "big",
};

type Read = LineupPlayer & { a: Archetype | undefined; size?: ArchetypeGroup };

const isShooter = (a: Archetype) =>
	a.family === "shooter" || a.tags.includes("shooting");
const isHandler = (a: Archetype) => a.family === "playmaker";
const isBig = (r: Read) => r.size === "big";
const isRim = (r: Read) =>
	!!r.a &&
	(r.a.group === "big" || isBig(r)) &&
	(r.a.family === "defender" || r.a.family === "rebounder");

const names = (list: Read[]) =>
	list.length <= 2
		? list.map((r) => r.name).join(" and ")
		: `${list
				.slice(0, -1)
				.map((r) => r.name)
				.join(", ")} and ${list.at(-1)!.name}`;

// The starting five, by roster order
const starterHints = (five: Read[]): LineupHint[] => {
	const hints: LineupHint[] = [];
	const known = five.filter((r) => r.a);
	if (known.length >= 4) {
		const shooters = known.filter((r) => isShooter(r.a!));
		const bigsNoShot = known.filter((r) => isBig(r) && !isShooter(r.a!));
		if (shooters.length === 0) {
			hints.push({
				kind: "spacing",
				text:
					bigsNoShot.length > 0
						? `${names(bigsNoShot)} ${bigsNoShot.length > 1 ? "are non-shooting bigs" : "is a non-shooting big"} with no shooter around: the paint will be crowded.`
						: "No shooter in the starting five: spacing will suffer.",
			});
		} else if (bigsNoShot.length >= 2) {
			hints.push({
				kind: "twoBigs",
				text: `${names(bigsNoShot)} are both non-shooting bigs: they will crowd each other in the paint.`,
			});
		}
		const handlers = known.filter((r) => isHandler(r.a!));
		if (handlers.length >= 2) {
			hints.push({
				kind: "handlers",
				text: `${names(handlers)} are ${handlers.length === 2 ? "both" : "all"} primary ball handlers: someone plays off the ball.`,
			});
		} else if (handlers.length === 0) {
			hints.push({
				kind: "noHandler",
				text: "No primary ball handler starts.",
			});
		}
		if (!known.some(isRim)) {
			hints.push({
				kind: "rim",
				text: "No rim protector or glass cleaner in the starting five.",
			});
		}
	}
	const sized = five.filter((r) => r.size);
	if (sized.length === 5) {
		const n = (g: ArchetypeGroup) => sized.filter((r) => r.size === g).length;
		if (n("forward") + n("big") === 0) {
			hints.push({
				kind: "small",
				text: "All-small lineup: no forward or big starts, so rebounding and rim protection will suffer.",
			});
		} else if (n("guard") === 0 && n("wing") <= 1) {
			hints.push({
				kind: "big",
				text: "All-big lineup: no guard and at most one wing start, so ball handling and perimeter defense will suffer.",
			});
		}
	}
	return hints;
};

// The bench unit (the next four in roster order), which plays together in stretches
const benchHints = (unit: Read[]): LineupHint[] => {
	const known = unit.filter((r) => r.a);
	if (known.length < 3) {
		return [];
	}
	const hints: LineupHint[] = [];
	if (!known.some((r) => isHandler(r.a!))) {
		hints.push({
			kind: "noHandler",
			text: "No ball handler on the bench to run the second unit.",
		});
	}
	if (!known.some((r) => isShooter(r.a!))) {
		hints.push({ kind: "spacing", text: "No shooter on the bench." });
	}
	const sized = unit.filter((r) => r.size);
	if (
		sized.length === unit.length &&
		!sized.some((r) => r.size === "big" || r.size === "forward")
	) {
		hints.push({ kind: "small", text: "No forward or big on the bench." });
	}
	return hints;
};

// Hints for a team's lineup: `players` in roster order (the first five start, the next four are the bench unit)
export const lineupHints = (
	players: LineupPlayer[],
	{ starters = 5, rotation = 9 }: { starters?: number; rotation?: number } = {},
): LineupHints => {
	const read: Read[] = players.slice(0, rotation).map((p) => ({
		...p,
		a: p.archetypeId ? archetypeById(p.archetypeId) : undefined,
		size: p.pos ? POS_SIZE[p.pos] : undefined,
	}));
	if (read.length < starters) {
		return { starters: [], bench: [] };
	}
	return {
		starters: starterHints(read.slice(0, starters)),
		bench: benchHints(read.slice(starters)),
	};
};
