// Small pure helpers shared by Wrapped and Storylines: seeded randomness, number formatting, text polish, and rank-based scores.

export const isNum = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// FNV-1a string hash, so the same seed text always gives the same number
export const hashString = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

// mulberry32, seeded from text
export const seededRng = (seed: string) => {
	let a = hashString(seed) || 1;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

// Deterministic choice of one item by a seed
export const pickBy = <T>(seed: string, list: readonly T[]): T => {
	return list[hashString(seed) % list.length]!;
};

export const fmtNum = (n: number, d: number = 0) =>
	isNum(n)
		? n.toLocaleString("en-US", {
				minimumFractionDigits: d,
				maximumFractionDigits: d,
			})
		: "–";

export const ordinal = (n: number) => {
	const v = Math.abs(n) % 100;
	const s = ["th", "st", "nd", "rd"];
	return fmtNum(n) + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export const plural = (n: number, one: string, many?: string) =>
	`${fmtNum(n)} ${n === 1 ? one : (many ?? `${one}s`)}`;

export const winPct = (won: number, lost: number, tied: number = 0) => {
	const gp = won + lost + tied;
	return gp > 0 ? (won + tied / 2) / gp : 0;
};

export const fmtWinp = (x: number) => x.toFixed(3).replace(/^0/, "");

export const fmtRecord = (won: number, lost: number, tied = 0, otl = 0) => {
	let out = `${won}-${lost}`;
	if (otl > 0) {
		out += `-${otl}`;
	}
	if (tied > 0) {
		out += `-${tied}`;
	}
	return out;
};

export const span = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

// Rank 1 of n scores 1, the median about 0. Small populations are damped, since being the best of 5 is less unusual than the best of 5,000.
export const rankScore = (rank: number, n: number) => {
	if (!isNum(rank) || !isNum(n) || n < 2 || rank < 1) {
		return 0;
	}
	const damp = Math.min(1, 0.25 + (0.75 * Math.log10(n)) / 3);
	return clamp01((Math.log(n / Math.min(rank, n)) / Math.log(n)) * damp);
};

// 1 + number of values strictly greater than v
export const rankOf = (values: readonly number[], v: number) => {
	let r = 1;
	for (const x of values) {
		if (x > v) {
			r += 1;
		}
	}
	return r;
};

const SING: Record<string, string> = {
	seasons: "season",
	games: "game",
	points: "point",
	wins: "win",
	losses: "loss",
	years: "year",
	titles: "title",
	players: "player",
	teams: "team",
	times: "time",
	rounds: "round",
	trades: "trade",
	franchises: "franchise",
	MVPs: "MVP",
	rings: "ring",
	stops: "stop",
	appearances: "appearance",
	selections: "selection",
};
const ONE_RE = new RegExp(
	`(^|[^\\w.,/$#\\-–])1 (${Object.keys(SING).join("|")})\\b`,
	"g",
);

// Fix up generated text: "1 seasons" -> "1 season", "2040–2040" -> "2040", straight apostrophes, double spaces
export const polish = (t: string) => {
	let s = t;
	s = s.replace(ONE_RE, (_m, pre: string, w: string) => `${pre}1 ${SING[w]}`);
	s = s.replace(/([A-Za-z])'(s|t|re|ll|d|ve|m)\b/g, "$1’$2");
	s = s
		.replace(/\b(\d{4})–\1\b/g, "$1")
		.replace(/\bfrom (\d{4}) to \1\b/g, "in $1");
	s = s.replace(/(\S) {2,}(?=\S)/g, "$1 ");
	s = s.replace(
		/\b(the|The) 1st-(best|biggest|worst|highest|lowest)\b/g,
		"$1 $2",
	);
	return s;
};

// Text that must never reach the screen
export const isBadText = (t: string) =>
	/\b(undefined|NaN|null|Infinity)\b/.test(t);

export const listText = (items: string[]) => {
	if (items.length <= 1) {
		return items[0] ?? "";
	}
	if (items.length === 2) {
		return `${items[0]} and ${items[1]}`;
	}
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
};
