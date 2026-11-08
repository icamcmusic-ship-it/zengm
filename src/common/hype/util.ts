// Small pure helpers of the hype engine
import { hashString } from "../wrapped/util.ts";
import type { HListed, HRow, HTot, StatKey } from "./types.ts";

export const clamp = (x: number, a: number, b: number) =>
	Math.max(a, Math.min(b, x));

export const known = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

export const num = (x: unknown) => (known(x) ? x : 0);

// Raw points (any positive number) to 0-100: the more reasons and the bigger, the closer to 100
export const squash = (raw: number, k: number) =>
	Math.round(100 * (1 - Math.exp(-Math.max(0, raw) / k)));

export const PRE_K = 40;
export const POST_K = 38;

export const label = (s: number) =>
	s >= 90
		? "Legendary"
		: s >= 75
			? "Must-watch"
			: s >= 60
				? "Big game"
				: s >= 45
					? "Worth a look"
					: s >= 30
						? "Ordinary"
						: "Skippable";

export const fmtN = (x: number) => Math.round(x).toLocaleString("en-US");

// Pick one phrasing, the same one every time for the same game
export const pick = <T>(gid: number, salt: number, arr: readonly T[]): T =>
	arr[hashString(`${gid}:${salt}`) % arr.length]!;

// "a 7-point" or "an 8-point"
export const an = (n: number) =>
	/^(8|11|18|8\d|80\d)$/.test(String(n)) ? "an " : "a ";

// Player name as a link token that the UI turns into a link: [[p:pid|Name]]
export const pl = (p: { pid: number; name: string }) =>
	`[[p:${p.pid}|${p.name}]]`;

export const plainText = (t: string) =>
	t.replace(/\[\[p:[^\]|]*\|([^\]]*)]]/g, "$1");

// A total over rows of a stat, or null when any row is missing it
export const sumStat = (rows: readonly HTot[], k: StatKey): number | null => {
	let s = 0;
	for (const r of rows) {
		const v = r[k];
		if (!known(v)) {
			return null;
		}
		s += v;
	}
	return s;
};

export const sumGp = (rows: readonly HTot[]) =>
	rows.reduce((s, r) => s + num(r.gp), 0);

// Career total of a listed player through the game: rows of earlier seasons plus this season so far
export const careerTotal = (
	p: HListed,
	k: StatKey,
	tid?: number,
): number | null => {
	if (!p.cur) {
		return null;
	}
	const rows: HRow[] = [...p.rows, ...p.cur].filter(
		(r) => r.gp > 0 && (tid === undefined || r.tid === tid),
	);
	return sumStat(rows, k);
};

export const curTotal = (
	p: HListed,
	k: StatKey,
	tid?: number,
): number | null => {
	if (!p.cur) {
		return null;
	}
	return sumStat(
		p.cur.filter((r) => r.gp > 0 && (tid === undefined || r.tid === tid)),
		k,
	);
};

export const curGp = (p: HListed, tid?: number) =>
	p.cur ? sumGp(p.cur.filter((r) => tid === undefined || r.tid === tid)) : 0;

export const isBadText = (t: string) =>
	/\b(undefined|NaN|null|Infinity)\b|\[\[p:\d*\|]]/.test(t);

export const record = (t: {
	won: number;
	lost: number;
	otl: number;
	tied: number;
}) => {
	let s = `${t.won}-${t.lost}`;
	if (t.otl > 0) {
		s += `-${t.otl}`;
	}
	if (t.tied > 0) {
		s += `-${t.tied}`;
	}
	return s;
};

// A clutch play from the box score (HTML with player links) as text with [[p:pid|Name]] tokens
export const clutchText = (html: string) =>
	html
		.replace(
			/<a href="[^"]*\/player\/(\d+)[^"]*">([^<]*)<\/a>/g,
			(_m, pid: string, name: string) => `[[p:${pid}|${name}]]`,
		)
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.trim();
