import { Defs, RARITY_RANK, type AchievementDef, formatValue } from "./defs.ts";
import type { AData } from "./adapter.ts";
import type { AchResult, Best, Occurrence } from "./engine.ts";
import type { Who } from "./labels.ts";

export * from "./defs.ts";
export * from "./labels.ts";
export * from "./engine.ts";
export { toAData, type AData, type AExtras } from "./adapter.ts";

// The catalogue as shown: retired and merged tiers are computed but never shown, counted or announced
export const DEFS: AchievementDef[] = Defs.defs;
export const DEF_BY_ID = Defs.byId;

// Tiers unlocked in these results that aren't in `seen`, rarest first, then in the order they happened, then catalogue order. Deterministic for the same results.
export const newUnlocks = (
	results: Map<string, AchResult>,
	seen: { has: (id: string) => boolean },
): AchievementDef[] => {
	const out: { d: AchievementDef; at: number }[] = [];
	for (const d of DEFS) {
		const r = results.get(d.id);
		if (r?.state === "unlocked" && !seen.has(d.id)) {
			out.push({ d, at: r.first?.at ?? 0 });
		}
	}
	out.sort(
		(a, b) =>
			RARITY_RANK[b.d.rarity] - RARITY_RANK[a.d.rarity] ||
			a.at - b.at ||
			a.d.i - b.d.i,
	);
	return out.map((x) => x.d);
};

// Metrics whose `other` is a player (a relative), not an opposing team
const REL = new Set(["relPair", "relMates", "relTitle", "relAS"]);
// League-wide feats whose note says what it was about
const NOTED = new Set([
	"clsWs",
	"clsTenK",
	"clsLong",
	"clsHof",
	"clsMvps",
	"clsTop3Stars",
	"drClassStars",
	"orSurname",
	"orMates",
	"orCollege",
	"countries",
]);

export type Lookup = {
	player: (pid: number) => string | undefined;
	team: (
		tid: number,
		season: number | undefined,
	) => { abbrev: string; name: string } | undefined;
	hasGame: (gid: number) => boolean;
};

export const makeLookup = (data: AData): Lookup => {
	const players = new Map(data.players.map((p) => [p.pid, p.name]));
	const teams = new Map(data.teams.map((t) => [t.tid, t]));
	const games = new Set(data.games.map((gm) => gm.gid));
	return {
		player: (pid) => players.get(pid),
		team: (tid, season) => {
			const t = teams.get(tid);
			if (!t) {
				return undefined;
			}
			const s =
				season === undefined
					? t.seasons.at(-1)
					: (t.seasons.find((x) => x.season === season) ?? t.seasons.at(-1));
			return {
				abbrev: s?.abbrev ?? t.abbrev,
				name: s ? `${s.region} ${s.name}` : `${t.region} ${t.name}`,
			};
		},
		hasGame: (gid) => games.has(gid),
	};
};

const isId = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x) && x >= 0;

export const whoOf = (
	look: Lookup,
	d: AchievementDef,
	o: Occurrence | Best | null | undefined,
): Who | undefined => {
	if (!o) {
		return undefined;
	}
	const w: Who = {};
	if (isId(o.pid)) {
		w.pid = o.pid;
		w.name = look.player(o.pid) ?? `Player ${o.pid}`;
	}
	const season = typeof o.season === "number" ? o.season : undefined;
	if (isId(o.tid)) {
		const t = look.team(o.tid, season);
		if (t) {
			w.tid = o.tid;
			w.abbrev = t.abbrev;
			w.team = t.name;
		}
	}
	if (isId(o.other)) {
		if (REL.has(d.metric)) {
			w.pid2 = o.other;
			w.name2 = look.player(o.other) ?? `Player ${o.other}`;
		} else {
			const t = look.team(o.other, season);
			if (t) {
				w.tid2 = o.other;
				w.abbrev2 = t.abbrev;
			}
		}
	}
	if (season !== undefined) {
		w.season = season;
	}
	if (isId(o.gid) && look.hasGame(o.gid)) {
		w.gid = o.gid;
	}
	const note = (o as Occurrence).note;
	if (typeof note === "string" && note && NOTED.has(d.metric)) {
		w.note = note;
	}
	return w;
};

// Plain text of a Who: "LeBron James (CLE, 2031)"
export const whoText = (w: Who | undefined) => {
	if (!w) {
		return "";
	}
	const parts: string[] = [];
	if (w.name) {
		parts.push(w.name2 ? `${w.name} and ${w.name2}` : w.name);
	} else if (w.team) {
		parts.push(w.team);
	}
	const tail: string[] = [];
	if (w.name && w.abbrev) {
		tail.push(w.abbrev);
	}
	if (w.abbrev2) {
		tail.push(`vs ${w.abbrev2}`);
	}
	if (w.note) {
		tail.push(w.note);
	}
	if (w.season !== undefined) {
		tail.push(String(w.season));
	}
	if (tail.length > 0) {
		parts.push(`(${tail.join(", ")})`);
	}
	return parts.join(" ");
};

// "Closest: 54 of 60 points" / "Closest: 12 (needs 10 or fewer)"; undefined when nothing qualifying is recorded yet (unknown, not zero)
export const bestText = (d: AchievementDef, best: Best | null | undefined) => {
	if (!best || !Number.isFinite(best.v)) {
		return undefined;
	}
	const v = formatValue(best.v, d);
	const t = formatValue(d.t, d);
	const unit =
		d.unit &&
		!d.unit.includes("(") &&
		d.metric !== "tall" &&
		d.metric !== "short"
			? ` ${d.unit}`
			: "";
	if (d.low) {
		return `${v}${unit} (needs ${t} or fewer)`;
	}
	return `${v} of ${t}${unit}`;
};

// A locked tier never reads 100%: floor, capped at 99 below the threshold
export const progressPct = (p: number) => {
	const x = Math.max(0, Math.min(1, p || 0));
	return x >= 1 ? 100 : Math.min(99, Math.floor(x * 100));
};
