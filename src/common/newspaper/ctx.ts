// Shared context for the article builders: lookups, links, tense and seeded choices for one paper.

import {
	Rng,
	fmt1,
	ordinal,
	record,
	tidySegs,
	winp,
} from "./text.ts";
import type {
	Article,
	Block,
	NPAward,
	NPPlayer,
	NPTeam,
	NewsFacts,
	Seg,
} from "./types.ts";

const FIRST = [
	"Ada",
	"Marcus",
	"Lena",
	"Theo",
	"Priya",
	"Walt",
	"June",
	"Omar",
	"Rosa",
	"Dmitri",
	"Hazel",
	"Calvin",
	"Imani",
	"Felix",
	"Nora",
	"Gus",
	"Mei",
	"Abe",
	"Tess",
	"Rafael",
	"Ida",
	"Luther",
	"Sana",
	"Hank",
	"Greta",
	"Desmond",
	"Ines",
	"Otis",
	"Pearl",
	"Ruben",
	"Yara",
	"Clem",
];
const LAST = [
	"Whitlock",
	"Okafor",
	"Brannigan",
	"Castellanos",
	"Lindqvist",
	"Mbeki",
	"Halloran",
	"Petrakis",
	"Achebe",
	"Duquesne",
	"Farrow",
	"Nakamura",
	"Oyelaran",
	"Pruitt",
	"Quillen",
	"Rasmussen",
	"Szabo",
	"Tremblay",
	"Underwood",
	"Varga",
	"Wexler",
	"Zamora",
	"Abernathy",
	"Beaumont",
	"Delacroix",
	"Ellison",
	"Fairbanks",
	"Hightower",
	"Kowalczyk",
];
const BEATS: Record<string, string> = {
	front: "Senior writer",
	playoffs: "Playoffs correspondent",
	awards: "League reporter",
	moves: "Front-office reporter",
	draft: "Draft analyst",
	league: "National writer",
	features: "Features writer",
	numbers: "Statistician",
	obits: "Staff writer",
	opinion: "Columnist",
	local: "Beat writer",
};

const QUOTE_SOURCES = [
	"a rival executive",
	"a veteran scout",
	"an opposing assistant coach",
	"one longtime general manager",
	"a league source with a long memory",
	"a scout who saw every game",
	"an assistant GM who asked not to be named",
	"a courtside regular",
	"a retired coach",
	"a front-office analyst",
];

export class Ctx {
	readonly f: NewsFacts;
	readonly season: number;
	readonly tid: number | undefined;
	private readonly teamMap = new Map<number, NPTeam>();
	private readonly playerMap = new Map<number, NPPlayer>();
	readonly rows: NPTeam[];
	// Players with enough games to count in leaderboards
	readonly qual: NPPlayer[];
	private readonly usedHeads = new Set<string>();
	private readonly usedPids = new Set<string>();

	constructor(facts: NewsFacts, tid?: number) {
		this.f = facts;
		this.season = facts.season;
		this.tid = tid;
		for (const t of facts.teams) {
			this.teamMap.set(t.tid, t);
		}
		for (const p of facts.players) {
			this.playerMap.set(p.pid, p);
		}
		this.rows = facts.teams
			.filter((t) => t.gp > 0 || facts.edition === "preseason")
			.toSorted(
				(a, b) =>
					winp(b) - winp(a) || b.won - b.lost - (a.won - a.lost) || a.tid - b.tid,
			);
		const minGp = Math.max(1, Math.ceil(facts.gp * (this.done ? 0.6 : 0.5)));
		this.qual = facts.players.filter((p) => p.gp >= minGp && p.min >= 12);
	}

	get done() {
		return this.f.edition === "final";
	}
	get mid() {
		return this.f.edition === "midseason";
	}
	get pre() {
		return this.f.edition === "preseason";
	}
	get inPlayoffs() {
		return this.f.edition === "playoffs";
	}

	// Present tense while the season is being played, past once it is over
	T(present: string, past: string) {
		return this.done ? past : present;
	}

	rng(...tags: (string | number)[]) {
		return new Rng(
			[this.f.seedKey, this.season, this.tid ?? "", ...tags].join("|"),
		);
	}

	team(tid: number) {
		return this.teamMap.get(tid);
	}
	player(pid: number) {
		return this.playerMap.get(pid);
	}

	tn(tid: number) {
		return this.team(tid)?.name ?? "team";
	}
	tfull(tid: number) {
		const t = this.team(tid);
		return t ? `${t.region} ${t.name}` : "team";
	}
	city(tid: number) {
		return this.team(tid)?.region ?? this.f.leagueName;
	}
	tl(tid: number, label?: string): Seg {
		return { tid, t: label ?? this.tn(tid), season: this.season };
	}
	pl(pid: number, name?: string): Seg {
		return { pid, t: name ?? this.player(pid)?.name ?? "Unknown" };
	}
	gl(gid: number, tid: number, t: string): Seg {
		return { gid, tid, season: this.season, t };
	}
	rec(tid: number) {
		const t = this.team(tid);
		return t ? record(t) : "";
	}
	rank(tid: number) {
		return this.rows.findIndex((t) => t.tid === tid) + 1;
	}

	award(key: string) {
		return this.f.awards.find((a) => a.key === key && a.group === undefined);
	}
	awardsOf(pid: number): NPAward[] {
		return this.f.awards.filter((a) => a.pid === pid);
	}

	teamPlayers(tid: number) {
		return this.f.players
			.filter((p) => p.tid === tid && p.gp > 0)
			.toSorted((a, b) => b.ws - a.ws);
	}

	// Per-game rank among qualified players, 1-based, or undefined
	statRank(pid: number, key: "pts" | "trb" | "ast" | "stl" | "blk" | "ws" | "per") {
		const sorted = this.qual.toSorted((a, b) => b[key] - a[key]);
		const i = sorted.findIndex((p) => p.pid === pid);
		return i >= 0 ? i + 1 : undefined;
	}

	lineWords(p: { pts: number; trb: number; ast: number }) {
		return `${fmt1(p.pts)} points, ${fmt1(p.trb)} rebounds and ${fmt1(p.ast)} assists`;
	}

	// "first round", "conference finals", "finals"
	roundPhrase(i: number) {
		const R = this.f.numRounds;
		if (i === R - 1) {
			return "finals";
		}
		if (i === R - 2) {
			return this.f.confs.length > 1 ? "conference finals" : "semifinals";
		}
		return `${["first", "second", "third", "fourth", "fifth"][i] ?? ordinal(i + 1)} round`;
	}

	fate(roundsWon: number) {
		if (roundsWon < 0) {
			return "missed the playoffs";
		}
		if (roundsWon >= this.f.numRounds) {
			return "won the title";
		}
		return `lost in the ${this.roundPhrase(roundsWon)}`;
	}

	byline(beat: string, dateline?: string) {
		const era = Math.floor((this.season - this.f.firstSeason) / 7);
		const r = new Rng([this.f.seedKey, "staff", beat, era].join("|"));
		return {
			name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
			role: BEATS[beat] ?? "Staff writer",
			dateline: dateline?.toUpperCase(),
		};
	}

	quoteSource(r: Rng) {
		return r.pick(QUOTE_SOURCES);
	}

	// Avoid two stories in one paper sharing a headline
	freshHead(r: Rng, heads: (string | null | undefined | false)[]) {
		const ok = heads.filter(
			(h): h is string => typeof h === "string" && h.length > 0,
		);
		if (ok.length === 0) {
			return undefined;
		}
		const fresh = ok.filter((h) => !this.usedHeads.has(h));
		const head = r.pick(fresh.length > 0 ? fresh : ok);
		this.usedHeads.add(head);
		return head;
	}

	// Track which players already got a feature in a section, so the same player doesn't fill a page
	claim(key: string) {
		if (this.usedPids.has(key)) {
			return false;
		}
		this.usedPids.add(key);
		return true;
	}
}

export const P = (...segs: (Seg | Seg[] | null | undefined | false)[]): Block => {
	const out: Seg[] = [];
	for (const s of segs) {
		if (s === null || s === undefined || s === false) {
			continue;
		}
		if (Array.isArray(s)) {
			out.push(...s);
		} else {
			out.push(s);
		}
	}
	return { type: "p", segs: tidySegs(out) };
};

// Drop empty paragraphs and tidy everything in an article
export const finishArticle = (a: Article): Article => {
	const body: Block[] = [];
	for (const b of a.body) {
		if (b.type === "p") {
			const segs = tidySegs(b.segs);
			if (segs.length > 0) {
				body.push({ type: "p", segs });
			}
		} else if (b.type === "list") {
			if (b.items.length > 0) {
				body.push({ ...b, items: b.items.map(tidySegs) });
			}
		} else if (b.type === "notebook") {
			if (b.items.length > 0) {
				body.push({
					...b,
					items: b.items.map((x) => ({ lead: x.lead, segs: tidySegs(x.segs) })),
				});
			}
		} else if (b.type === "table") {
			if (b.rows.length > 0) {
				body.push(b);
			}
		} else if (b.type === "nums") {
			if (b.items.length > 0) {
				body.push(b);
			}
		} else {
			body.push(b);
		}
	}
	return {
		...a,
		deck: a.deck ? tidySegs(a.deck) : undefined,
		body,
	};
};
