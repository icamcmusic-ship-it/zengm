// Building blocks for the back pages: the page registry, arc pages (one topic told in different shapes), and ranked-list pages (the leader, the table, the podium, the two ends).

import { Ctx, P } from "./ctx.ts";
import type { Rng } from "./text.ts";
import { andList, capFirst, fmt1, plural, poss, record } from "./text.ts";
import type { Article, Block, EditionId, Seg } from "./types.ts";

export type SectionId =
	| "features"
	| "teams"
	| "players"
	| "numbers"
	| "money"
	| "history"
	| "colour"
	| "awards"
	| "playoffs"
	| "draft";

export type PageDef = {
	id: string;
	section: SectionId;
	kicker: string;
	// Editions in which the page runs. Default: everything but the preview
	eds?: readonly EditionId[];
	build: (c: Ctx) => Article | undefined;
};

export const PAGES: PageDef[] = [];

export const SEASON_EDS: readonly EditionId[] = [
	"midseason",
	"playoffs",
	"final",
];
export const ALL_EDS: readonly EditionId[] = [
	"preseason",
	"midseason",
	"playoffs",
	"final",
];
export const DONE_ONLY: readonly EditionId[] = ["final"];
export const PRE_ONLY: readonly EditionId[] = ["preseason"];
export const PLAYED: readonly EditionId[] = ["midseason", "playoffs", "final"];

export const addPage = (def: PageDef) => {
	if (PAGES.some((p) => p.id === def.id)) {
		throw new Error(`Duplicate newspaper page ${def.id}`);
	}
	PAGES.push(def);
};

// ---- Arc pages -------------------------------------------------------------

export type Arc<X> = {
	id: string;
	fit?: (x: X, c: Ctx) => boolean;
	// Headline variants, null for one that does not apply
	heads: (x: X, c: Ctx) => (string | null | false | undefined)[];
	build: (x: X, r: Rng, c: Ctx) => Block[];
};

export type ArcPageSpec<X> = {
	id: string;
	section: SectionId;
	kicker: string;
	eds?: readonly EditionId[];
	beat: string;
	size?: "feature" | "brief";
	prep: (c: Ctx) => X | undefined;
	arcs: Arc<X>[];
	photo?: (x: X, c: Ctx) => number | undefined;
	dateline?: (x: X, c: Ctx) => string | undefined;
	colour?: boolean;
	deck?: (x: X, c: Ctx) => Seg[] | undefined;
};

// A head that has not run in this paper yet, stepping through the variants one place a season
export const headFrom = (
	c: Ctx,
	key: string,
	heads: (string | null | false | undefined)[],
) => {
	const ok = heads.filter(
		(h): h is string => typeof h === "string" && h.length > 0,
	);
	if (ok.length === 0) {
		return undefined;
	}
	const start = c.cycle(key, ok);
	const i = ok.indexOf(start);
	// A generic headline (no names, no numbers) gets the season, so it never repeats from one year to the next
	const dated = (h: string) =>
		!/\d/.test(h) && /^[A-Z][^A-Z]*$/.test(h) ? `${h}, ${c.season}` : h;
	for (let k = 0; k < ok.length; k++) {
		const h = dated(ok[(i + k) % ok.length]!);
		if (c.claim(`head|${h}`)) {
			return h;
		}
	}
	return dated(ok[i]!);
};

export const arcPage = <X>(spec: ArcPageSpec<X>): PageDef => ({
	id: spec.id,
	section: spec.section,
	kicker: spec.kicker,
	eds: spec.eds,
	build: (c) => {
		const x = spec.prep(c);
		if (x === undefined) {
			return undefined;
		}
		const fit = spec.arcs.filter((a) => !a.fit || a.fit(x, c));
		if (fit.length === 0) {
			return undefined;
		}
		const arc = c.cycle(`${spec.id}|arc`, fit);
		const head = headFrom(c, `${spec.id}|${arc.id}|head`, arc.heads(x, c));
		if (!head) {
			return undefined;
		}
		const r = c.rng(spec.id, arc.id);
		const body = arc.build(x, r, c);
		if (body.length === 0) {
			return undefined;
		}
		return {
			id: spec.id,
			type: spec.id,
			size: spec.size ?? "brief",
			kicker: spec.kicker,
			head,
			deck: spec.deck?.(x, c),
			byline: c.byline(spec.beat, spec.dateline?.(x, c)),
			photoPid: spec.photo?.(x, c),
			colour: spec.colour,
			body,
		};
	},
});

export const table = (
	head: string[],
	rows: Seg[][][],
	numCols?: number[],
	hl?: number,
): Block => ({ type: "table", head, rows, numCols, hl });

// ---- Ranked pages ----------------------------------------------------------

export type Item = {
	kind: "p" | "t";
	id: number;
	v: number;
	// Shown beside the name in the table
	note?: string;
};

export type RankSpec = {
	id: string;
	section: SectionId;
	kicker: string;
	eds?: readonly EditionId[];
	beat: string;
	// "three-point shooting"
	topic: string;
	// "per game", "percent"
	unit: string;
	fmt: (v: number) => string;
	items: (c: Ctx) => Item[] | undefined;
	// Name of the value column
	col: string;
	// Whether the bottom of the list says something (teams do, qualified players seldom do)
	ends?: boolean;
	// Words for the bottom of the list
	endWord?: string;
	// An extra sentence about the whole list
	note?: (c: Ctx, items: Item[]) => string | undefined;
	// The leader must have at least this much, or the page is not worth running
	minTop?: number;
	size?: "feature" | "brief";
	tableRows?: number;
	// A plain sentence that can open the table instead of the usual ones (the variation pass in vary.ts has rewrites for some of them)
	lead?: (c: Ctx, items: Item[]) => string | undefined;
};

const who = (c: Ctx, it: Item): Seg =>
	it.kind === "p" ? c.pl(it.id) : c.tl(it.id, c.tfull(it.id));
const nameOf = (c: Ctx, it: Item) =>
	it.kind === "p" ? c.pname(it.id) : c.tn(it.id);
const teamId = (c: Ctx, it: Item) =>
	it.kind === "p" ? c.player(it.id)?.tid : it.id;
const recOf = (c: Ctx, it: Item) => {
	const tid = teamId(c, it);
	return tid === undefined ? "" : c.rec(tid);
};
// Teams are plural ("the Hornets lead"), players singular
const be = (c: Ctx, it: Item) =>
	it.kind === "t" ? c.T("are", "were") : c.T("is", "was");
const leads = (c: Ctx, it: Item) =>
	it.kind === "t" ? c.T("lead", "led") : c.T("leads", "led");
const nameWith = (c: Ctx, it: Item) =>
	it.kind === "p"
		? `${nameOf(c, it)} (${c.team(teamId(c, it) ?? -1)?.abbrev ?? ""})`
		: nameOf(c, it);

const teamClause = (c: Ctx, it: Item): Seg[] => {
	const tid = teamId(c, it);
	const t = tid === undefined ? undefined : c.team(tid);
	if (!t || it.kind === "t") {
		return [];
	}
	return [", playing for the ", c.tl(t.tid), t.gp > 0 ? ` (${record(t)})` : ""];
};

export const rankPage = (spec: RankSpec): PageDef => {
	const T = capFirst(spec.topic);
	return arcPage<{ items: Item[]; top: number }>({
		id: spec.id,
		section: spec.section,
		kicker: spec.kicker,
		eds: spec.eds,
		beat: spec.beat,
		size: spec.size,
		prep: (c) => {
			const items = spec.items(c);
			if (!items || items.length < 6) {
				return undefined;
			}
			if (items.some((it) => !Number.isFinite(it.v))) {
				return undefined;
			}
			if (spec.minTop !== undefined && items[0]!.v < spec.minTop) {
				return undefined;
			}
			return { items, top: Math.min(items.length, spec.tableRows ?? 8) };
		},
		photo: (x, c) => (x.items[0]?.kind === "p" ? x.items[0].id : undefined),
		arcs: [
			{
				id: "leader",
				heads: (x, c) => {
					const [a, b] = x.items as [Item, Item];
					const n = nameOf(c, a);
					return [
						`${n} ${leads(c, a)} the league in ${spec.topic}`,
						`${n}: ${spec.fmt(a.v)} ${spec.unit}`,
						`Nobody ${c.T("tops", "topped")} ${poss(n)} ${spec.topic}`,
						`${n} ${a.kind === "t" ? c.T("set", "set") : c.T("sets", "set")} the pace in ${spec.topic}`,
						`${T}: ${n} in front, ${nameOf(c, b)} next`,
					];
				},
				build: (x, r, c) => {
					const [a, b, d] = x.items as [Item, Item, Item];
					const lead = c.cycle(`${spec.id}|leadin`, [
						(): Seg[] => [
							who(c, a),
							` ${leads(c, a)} the league in ${spec.topic} at ${spec.fmt(a.v)} ${spec.unit}`,
							...teamClause(c, a),
							`, ahead of `,
							who(c, b),
							` (${spec.fmt(b.v)}).`,
						],
						(): Seg[] => [
							`At ${spec.fmt(a.v)} ${spec.unit}, `,
							who(c, a),
							` ${be(c, a)} the league's best in ${spec.topic}`,
							...teamClause(c, a),
							`; `,
							who(c, b),
							` ${be(c, b)} next at ${spec.fmt(b.v)}.`,
						],
						(): Seg[] => [
							`The ${spec.topic} list ${c.T("starts", "started")} with `,
							who(c, a),
							` (${spec.fmt(a.v)} ${spec.unit})`,
							`, followed by `,
							who(c, b),
							` (${spec.fmt(b.v)}) and `,
							who(c, d),
							` (${spec.fmt(d.v)}).`,
						],
					]);
					const out: Block[] = [P(lead())];
					const rest = x.items.slice(3, 6);
					if (rest.length > 0) {
						out.push(
							P(
								r.pick(["Behind them: ", "Next on the list: ", "Rounding out the top six: "]),
								...andList(
									rest.map((it) => [who(c, it), ` (${spec.fmt(it.v)})`]),
								),
								".",
							),
						);
					}
					const note = spec.note?.(c, x.items);
					if (note) {
						out.push(P(note));
					}
					return out;
				},
			},
			{
				id: "lead-table",
				fit: (x, c) => spec.lead?.(c, x.items) !== undefined,
				heads: (x, c) => {
					const a = x.items[0]!;
					return [
						`${T}: ${nameOf(c, a)} at the top`,
						`${T}, ${c.season}`,
						`The ${spec.topic} list`,
					];
				},
				build: (x, r, c) => {
					const rows = x.items.slice(0, x.top);
					const isP = x.items[0]!.kind === "p";
					return [
						P(spec.lead!(c, x.items)!),
						table(
							isP ? ["", "Player", "Team", spec.col] : ["", "Team", spec.col],
							rows.map((it, i) =>
								isP
									? [
											[String(i + 1)],
											[who(c, it)],
											[c.team(teamId(c, it) ?? -1) ? c.tl(teamId(c, it)!, c.team(teamId(c, it)!)?.abbrev) : (it.note ?? "–")],
											[spec.fmt(it.v)],
										]
									: [[String(i + 1)], [who(c, it)], [spec.fmt(it.v)]],
							),
							isP ? [0, 3] : [0, 2],
						),
					];
				},
			},
			{
				id: "table",
				heads: (x, c) => {
					const a = x.items[0]!;
					return [
						`${T}, ${c.season}: the top ${x.top}`,
						`The ${spec.topic} leaderboard`,
						`${nameOf(c, a)} heads the ${spec.topic} table`,
						`Who ${c.T("is", "was")} best at ${spec.topic}: the list`,
						`${T} ranked: ${nameOf(c, a)} on top`,
					];
				},
				build: (x, r, c) => {
					const a = x.items[0]!;
					const rows = x.items.slice(0, x.top);
					const isP = a.kind === "p";
					const out: Block[] = [
						P(
							r.pick([
								`Here is how the league ${c.T("stacks", "stacked")} up in ${spec.topic}${c.done ? " over the season" : " so far"}, with ${nameOf(c, a)} on top at ${spec.fmt(a.v)}.`,
								`The ${x.top} best in ${spec.topic}, ${c.T("by the numbers so far", "by the final numbers")}, ${spec.fmt(a.v)} for ${nameOf(c, a)} at the head:`,
								`${T}, ranked${c.done ? "" : " as of today"}; ${nameOf(c, a)} ${a.kind === "t" ? c.T("lead", "led") : c.T("leads", "led")} at ${spec.fmt(a.v)}:`,
							]),
						),
						table(
							isP
								? ["", "Player", "Team", spec.col]
								: ["", "Team", c.pre ? "Last year" : "W-L", spec.col],
							rows.map((it, i) => [
								[String(i + 1)],
								[who(c, it)],
								isP
									? c.team(teamId(c, it) ?? -1)
										? [
												c.tl(teamId(c, it)!, c.team(teamId(c, it)!)?.abbrev),
												it.note ? ` ${it.note}` : "",
											]
										: [it.note ?? "–"]
									: [c.pre ? (c.team(it.id)?.prev ? record(c.team(it.id)!.prev!) : "–") : recOf(c, it)],
								[spec.fmt(it.v)],
							]),
							[0, 3],
						),
					];
					const note = spec.note?.(c, x.items);
					if (note) {
						out.push({ type: "aside", segs: [note] });
					}
					return out;
				},
			},
			{
				id: "podium",
				heads: (x, c) => {
					const [a, b, d] = x.items as [Item, Item, Item];
					return [
						`${nameOf(c, a)}, ${nameOf(c, b)} and ${nameOf(c, d)} ${c.T("lead", "led")} in ${spec.topic}`,
						`The ${spec.topic} podium: ${nameOf(c, a)}, ${nameOf(c, b)}, ${nameOf(c, d)}`,
						`Three at the top of ${spec.topic}`,
						`${T}: gold, silver and bronze`,
					];
				},
				build: (x, r, c) => {
					const [a, b, d] = x.items as [Item, Item, Item];
					const gap = Math.abs(a.v - d.v);
					return [
						P(
							`Three names ${c.T("stand", "stood")} above the rest in ${spec.topic}: `,
							who(c, a),
							` (${spec.fmt(a.v)}), `,
							who(c, b),
							` (${spec.fmt(b.v)}) and `,
							who(c, d),
							` (${spec.fmt(d.v)}).`,
						),
						P(
							gap === 0
								? `${nameOf(c, a)} and ${nameOf(c, d)} ${c.T("are", "were")} level at ${spec.fmt(a.v)} ${spec.unit}.`
								: `First and third ${c.T("are", "were")} ${spec.fmt(gap)} apart, ${spec.fmt(a.v)} to ${spec.fmt(d.v)}.`,
							x.items[3]
								? [
										` The next best, `,
										who(c, x.items[3]),
										`, ${c.T("has", "had")} ${spec.fmt(x.items[3].v)}.`,
									]
								: "",
						),
					];
				},
			},
			{
				id: "ends",
				fit: (x) => !!spec.ends && x.items.length >= 8,
				heads: (x, c) => {
					const a = x.items[0]!;
					const z = x.items.at(-1)!;
					return [
						`From ${nameOf(c, a)} to ${nameOf(c, z)}: the ${spec.topic} spread`,
						`${T}: the best and the worst`,
						`The two ends of ${spec.topic}`,
						`${nameOf(c, a)} on top, ${nameOf(c, z)} at the bottom`,
					];
				},
				build: (x, r, c) => {
					const a = x.items[0]!;
					const z = x.items.at(-1)!;
					const mid = x.items[Math.floor(x.items.length / 2)]!;
					return [
						P(
							`The best in ${spec.topic} ${c.T("is", "was")} `,
							who(c, a),
							` at ${spec.fmt(a.v)}; the ${spec.endWord ?? "lowest"} ${c.T("is", "was")} `,
							who(c, z),
							` at ${spec.fmt(z.v)}.`,
						),
						P(
							`The middle of the list ${c.T("sits", "sat")} at ${spec.fmt(mid.v)}, with `,
							who(c, mid),
							` there.`,
						),
						table(
							["", "Name", spec.col],
							[
								...x.items
									.slice(0, 3)
									.map((it, i) => [
										[String(i + 1)],
										[who(c, it)],
										[spec.fmt(it.v)],
									]),
								...x.items
									.slice(-3)
									.map((it, i) => [
										[String(x.items.length - 2 + i)],
										[who(c, it)],
										[spec.fmt(it.v)],
									]),
							],
							[0, 2],
						),
					];
				},
			},
			{
				id: "chaser",
				fit: (x) => x.items[1] !== undefined,
				heads: (x, c) => {
					const [a, b] = x.items as [Item, Item];
					return [
						`${nameOf(c, b)} ${b.kind === "t" ? c.T("chase", "chased") : c.T("chases", "chased")} ${nameOf(c, a)} in ${spec.topic}`,
						a.v === b.v
							? `${T}: ${nameOf(c, b)} ${be(c, b)} level with ${nameOf(c, a)}`
							: `${T}: ${nameOf(c, b)} ${be(c, b)} ${spec.fmt(Math.abs(a.v - b.v))} behind`,
						`Second best in ${spec.topic}: ${nameOf(c, b)}`,
						`${nameOf(c, a)} ${a.kind === "t" ? c.T("hold", "held") : c.T("holds", "held")} off ${nameOf(c, b)}`,
					];
				},
				build: (x, r, c) => {
					const [a, b] = x.items as [Item, Item];
					const gap = a.v - b.v;
					return [
						P(
							who(c, b),
							` ${be(c, b)} second in ${spec.topic} at ${spec.fmt(b.v)} ${spec.unit}`,
							gap === 0
								? `, level with `
								: `, ${spec.fmt(Math.abs(gap))} behind `,
							who(c, a),
							` (${spec.fmt(a.v)}).`,
						),
						x.items[2]
							? P(
									`${nameWith(c, a)} and ${nameWith(c, b)} ${c.T("are", "were")} clear of the field; the next name on the list ${c.T("is", "was")} `,
									who(c, x.items[2]),
									` at ${spec.fmt(x.items[2].v)}.`,
								)
							: P(""),
					];
				},
			},
		],
	});
};

export { fmt1, plural };
