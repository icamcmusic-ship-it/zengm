export type Ratings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	ins: number;
	dnk: number;
	ft: number;
	fg: number;
	tp: number;
	oiq: number;
	diq: number;
	drb: number;
	pss: number;
	reb: number;
};

export type FPlayer = {
	pid: number;
	name: string;
	pos: string;
	// 0 or 1: the index of his team in the box score
	t: 0 | 1;
	R: Ratings;
};

export type TeamLabel = {
	// "Lakers": nickname, used after "the" (or alone, for an exhibition of named teams like the All-Star Game)
	name: string;
	abbrev: string;
};

const DEFAULT_RATING = 50;

export const RATING_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
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

export const makeRatings = (
	raw: Record<string, number> | undefined,
): Ratings => {
	const R: any = {};
	for (const key of RATING_KEYS) {
		const v = raw?.[key];
		R[key] = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_RATING;
	}
	return R;
};

export const cap = (t: string) =>
	t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

export const R100 = (x: number) => Math.max(0, Math.min(100, x)) / 100;

/* Rarity: how often a kind of play comes up, scaled by how far the player's ratings clear its bar.
   common 1, uncommon .35, rare .1, epic .025; below the bar it never happens. */
export const TIER = { c: 1, u: 0.35, r: 0.1, e: 0.025 };
export const gate = (v: number, bar: number) =>
	v < bar ? 0 : 0.4 + Math.min(1.6, (v - bar) / 15);

export const clockOf = (sec: number) => {
	const s = Math.max(0, Math.round(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// "an 8-0 run", "an 11-0 run", "a 9-0 run"
export const aRun = (label: string) =>
	`${/^(8|11|18)\b/.test(label) || /^8\d\b/.test(label) ? "an" : "a"} ${label} run`;

// "a 12-point lead" but "an 18-point lead"
export const aNum = (n: number) =>
	/^(8|11|18|8\d)$/.test(String(n)) ? "an" : "a";

// "Hammonds'" but "Smith's"
export const poss = (name: string) =>
	/s$/i.test(name) ? `${name}'` : `${name}'s`;

// "the Lakers" -> "Lakers"
export const bare = (x: string) => x.replace(/^the /i, "");
