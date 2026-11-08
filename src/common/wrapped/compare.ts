// "Compare two": two players, two teams (or one team's two seasons) or two seasons, side by side. Each side gets its own full list of candidate slides; the topics both sides have are shown as pairs with the side that stands out more named, the ones only one side has come after, and a scoreboard of plain numbers closes it. Pure, so tests cover it.
import { candidates, candidatesAsync } from "./build.ts";
import { finish } from "./deck.ts";
import type { LeagueIndex } from "./league.ts";
import type { Slide, WrappedMode } from "./types.ts";
import { fmtNum, fmtWinp, isNum, winPct } from "./util.ts";

export type SideKind = "p" | "t" | "s";

export type Side = { k: SideKind; id?: number; season: number };

const KIND_MODE: Record<SideKind, WrappedMode> = {
	p: "player",
	t: "team",
	s: "season",
};

// Scores closer than this count as even
export const EVEN = 0.03;

// "p12-2040", "t5-2040", "s2040"
export const parseSide = (str: string | undefined): Side | undefined => {
	if (!str) {
		return undefined;
	}
	const m = /^([pt])(\d{1,9})-(\d{1,5})$/i.exec(str.trim());
	if (m) {
		return {
			k: m[1]!.toLowerCase() as SideKind,
			id: Number(m[2]),
			season: Number(m[3]),
		};
	}
	const s = /^s(\d{1,5})$/i.exec(str.trim());
	if (s) {
		return { k: "s", season: Number(s[1]) };
	}
	return undefined;
};

export const sideSpec = (s: Side) =>
	s.k === "s" ? `s${s.season}` : `${s.k}${s.id}-${s.season}`;

export const sideLabel = (X: LeagueIndex, s: Side) => {
	if (s.k === "p") {
		return `${X.players.get(s.id!)?.name ?? "Player"} ${s.season}`;
	}
	if (s.k === "t") {
		return `${X.teamName(s.id!, s.season)} ${s.season}`;
	}
	return `The ${s.season} season`;
};

// Both sides must be of one kind and exist in the data
export const validSides = (X: LeagueIndex, a: Side, b: Side) => {
	if (a.k !== b.k) {
		return "Compare two of a kind: two players, two teams or two seasons.";
	}
	for (const s of [a, b]) {
		if (!X.seasons.includes(s.season)) {
			return `There is no ${s.season} season in this league.`;
		}
		if (s.k === "p" && !X.line(s.id!, s.season)) {
			return `${X.players.get(s.id!)?.name ?? "That player"} has no ${s.season} season.`;
		}
		if (s.k === "t" && !X.team(s.id!, s.season)) {
			return `That team did not play in ${s.season}.`;
		}
	}
	return undefined;
};

const SKIP = new Set(["intro", "summary"]);

const sideCtx = (X: LeagueIndex, s: Side) => ({
	X,
	mode: KIND_MODE[s.k],
	season: s.season,
	tid: s.k === "t" ? s.id : undefined,
	pid: s.k === "p" ? s.id : undefined,
	soFar: !X.decided(s.season),
});

const finishSide = (s: Side, all: Slide[]) => {
	const cands = all.filter((c) => !c.quiz && !SKIP.has(c.id) && c.score > 0);
	const seed = `cmp|${sideSpec(s)}`;
	return cands.map((c) => finish(c, seed));
};

// Every slide a side has, one per topic, with its headline chosen
export const sideSlides = (X: LeagueIndex, s: Side): Slide[] =>
	finishSide(s, candidates(sideCtx(X, s)));

// The same, but lets the caller do other work between topics
export const sideSlidesAsync = async (
	X: LeagueIndex,
	s: Side,
	pause: () => Promise<void>,
): Promise<Slide[]> =>
	finishSide(s, await candidatesAsync(sideCtx(X, s), pause));

const byTopic = (cands: Slide[]) => {
	const m = new Map<string, Slide>();
	for (const c of cands) {
		const o = m.get(c.id);
		if (!o || c.score > o.score) {
			m.set(c.id, c);
		}
	}
	return m;
};

export type Pair = { id: string; a: Slide; b: Slide; win: "a" | "b" | "even" };

export type Matched = { both: Pair[]; onlyA: Slide[]; onlyB: Slide[] };

const bySc = (a: Slide, b: Slide) =>
	b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const matchCands = (candsA: Slide[], candsB: Slide[]): Matched => {
	const A = byTopic(candsA);
	const B = byTopic(candsB);
	const both: Pair[] = [];
	const onlyA: Slide[] = [];
	const onlyB: Slide[] = [];
	for (const [id, a] of A) {
		const b = B.get(id);
		if (!b) {
			onlyA.push(a);
			continue;
		}
		const d = a.score - b.score;
		both.push({
			id,
			a,
			b,
			win: Math.abs(d) < EVEN ? "even" : d > 0 ? "a" : "b",
		});
	}
	for (const [id, b] of B) {
		if (!A.has(id)) {
			onlyB.push(b);
		}
	}
	both.sort(
		(x, y) =>
			Math.max(y.a.score, y.b.score) - Math.max(x.a.score, x.b.score) ||
			(x.id < y.id ? -1 : 1),
	);
	onlyA.sort(bySc);
	onlyB.sort(bySc);
	return { both, onlyA, onlyB };
};

export const tally = (m: Matched) => {
	const o = {
		both: m.both.length,
		a: 0,
		b: 0,
		even: 0,
		onlyA: m.onlyA.length,
		onlyB: m.onlyB.length,
	};
	for (const p of m.both) {
		o[p.win] += 1;
	}
	return o;
};

export type StatRow = {
	label: string;
	a: string;
	b: string;
	// Which side has the better value, when both are known and differ
	better: "a" | "b" | null;
};

const row = (
	label: string,
	va: number | undefined,
	vb: number | undefined,
	ta: string,
	tb: string,
	lower = false,
): StatRow => {
	let better: "a" | "b" | null = null;
	if (isNum(va) && isNum(vb) && Math.abs(va - vb) > 1e-9) {
		better = va > vb !== lower ? "a" : "b";
	}
	return { label, a: ta, b: tb, better };
};

const text = (r: StatRow) => r;

const finishText = (X: LeagueIndex, tid: number, season: number) => {
	const t = X.team(tid, season);
	if (!t) {
		return { v: undefined, t: "–" };
	}
	if (!X.decided(season)) {
		return { v: undefined, t: "In progress" };
	}
	const n = X.numRounds(season);
	if (t.playoffRoundsWon < 0) {
		return { v: -1, t: "Missed" };
	}
	if (t.playoffRoundsWon >= n && n > 0) {
		return { v: n + 1, t: "Champion" };
	}
	return {
		v: t.playoffRoundsWon,
		t:
			t.playoffRoundsWon === n - 1
				? "Lost the finals"
				: `Lost in round ${t.playoffRoundsWon + 1}`,
	};
};

// The plain numbers of the two sides, a stat missing on a side shows "–" and is never marked better
export const statRows = (X: LeagueIndex, A: Side, B: Side): StatRow[] => {
	const rows: StatRow[] = [];
	const N = (v: number | undefined, d = 0) => (isNum(v) ? fmtNum(v, d) : "–");
	if (A.k === "p") {
		const la = X.line(A.id!, A.season);
		const lb = X.line(B.id!, B.season);
		const team = (l: typeof la, s: number) =>
			l ? (X.teamAny(l.tid, s)?.abbrev ?? "–") : "–";
		rows.push(
			{
				label: "Team",
				a: team(la, A.season),
				b: team(lb, B.season),
				better: null,
			},
			row("Games", la?.gp, lb?.gp, N(la?.gp), N(lb?.gp)),
		);
		const pairs: [
			string,
			(l: NonNullable<typeof la>) => number | undefined,
			number,
		][] = [
			["Minutes per game", (l) => l.mpg, 1],
			["Points per game", (l) => l.ppg, 1],
			["Rebounds per game", (l) => l.rpg, 1],
			["Assists per game", (l) => l.apg, 1],
			["Steals per game", (l) => l.spg, 1],
			["Blocks per game", (l) => l.bpg, 1],
			["Threes per game", (l) => l.tpg, 1],
			["True shooting %", (l) => (l.tsPct > 0 ? l.tsPct * 100 : undefined), 1],
			["PER", (l) => l.per, 1],
			["Win shares", (l) => l.ws, 1],
		];
		for (const [label, f, d] of pairs) {
			const va = la ? f(la) : undefined;
			const vb = lb ? f(lb) : undefined;
			rows.push(row(label, va, vb, N(va, d), N(vb, d)));
		}
		const aw = (pid: number, s: number) => [
			...new Set(
				X.players
					.get(pid)
					?.awards.filter(
						(x) => x.season === s && (X.decided(s) || x.type === "All-Star"),
					)
					.map((x) => x.type),
			),
		];
		const wa = aw(A.id!, A.season);
		const wb = aw(B.id!, B.season);
		if (wa.length > 0 || wb.length > 0) {
			rows.push({
				label: "Awards",
				a: wa.length ? wa.join(", ") : "None",
				b: wb.length ? wb.join(", ") : "None",
				better: null,
			});
		}
	} else if (A.k === "t") {
		const ta = X.team(A.id!, A.season);
		const tb = X.team(B.id!, B.season);
		const rec = (t: typeof ta) =>
			t
				? `${t.won}-${t.lost}${t.tied ? `-${t.tied}` : ""}${t.otl ? `-${t.otl}` : ""}`
				: "–";
		const wp = (t: typeof ta) =>
			t && t.won + t.lost + t.tied > 0
				? winPct(t.won, t.lost, t.tied)
				: undefined;
		rows.push(
			row("Record", wp(ta), wp(tb), rec(ta), rec(tb)),
			row(
				"Win %",
				wp(ta),
				wp(tb),
				isNum(wp(ta)) ? fmtWinp(wp(ta)!) : "–",
				isNum(wp(tb)) ? fmtWinp(wp(tb)!) : "–",
			),
		);
		const mg = (t: typeof ta) =>
			t && t.gp > 0 ? (t.pts - t.oppPts) / t.gp : undefined;
		const sg = (v: number | undefined) =>
			isNum(v) ? `${v >= 0 ? "+" : ""}${fmtNum(v, 1)}` : "–";
		rows.push(
			row("Point margin per game", mg(ta), mg(tb), sg(mg(ta)), sg(mg(tb))),
		);
		const fa = finishText(X, A.id!, A.season);
		const fb = finishText(X, B.id!, B.season);
		rows.push(row("Playoffs", fa.v, fb.v, fa.t, fb.t));
		const star = (tid: number, s: number) =>
			[...X.teamLines(tid, s)].sort((x, y) => y.ws - x.ws)[0];
		const sa = star(A.id!, A.season);
		const sb = star(B.id!, B.season);
		rows.push({
			label: "Top player by win shares",
			a: sa ? `${sa.name} (${fmtNum(sa.ws, 1)} WS)` : "–",
			b: sb ? `${sb.name} (${fmtNum(sb.ws, 1)} WS)` : "–",
			better: null,
		});
		if (isNum(ta?.payroll) && isNum(tb?.payroll)) {
			rows.push(
				row(
					"Payroll",
					ta!.payroll!,
					tb!.payroll!,
					`$${fmtNum(ta!.payroll! / 1000, 1)}M`,
					`$${fmtNum(tb!.payroll! / 1000, 1)}M`,
					true,
				),
			);
		}
	} else {
		const champ = (s: number) => {
			const c = X.champion(s);
			return c ? X.teamName(c.tid, s) : "–";
		};
		rows.push({
			label: "Champion",
			a: champ(A.season),
			b: champ(B.season),
			better: null,
		});
		const mvp = (s: number) =>
			X.awardWinner(s, "Most Valuable Player")?.name ?? "–";
		rows.push({
			label: "MVP",
			a: mvp(A.season),
			b: mvp(B.season),
			better: null,
		});
		const teams = (s: number) => X.teamsIn(s).filter((t) => t.gp > 0);
		const na = teams(A.season).length;
		const nb = teams(B.season).length;
		rows.push(
			row(
				"Teams",
				na || undefined,
				nb || undefined,
				N(na || undefined),
				N(nb || undefined),
			),
		);
		const best = (s: number) =>
			[...teams(s)].sort(
				(x, y) => winPct(y.won, y.lost, y.tied) - winPct(x.won, x.lost, x.tied),
			)[0];
		const ba = best(A.season);
		const bb = best(B.season);
		rows.push(
			row(
				"Best record",
				ba ? winPct(ba.won, ba.lost, ba.tied) : undefined,
				bb ? winPct(bb.won, bb.lost, bb.tied) : undefined,
				ba ? `${ba.abbrev} ${ba.won}-${ba.lost}` : "–",
				bb ? `${bb.abbrev} ${bb.won}-${bb.lost}` : "–",
			),
		);
		const ppg = (s: number) => {
			const ts = teams(s);
			const g = ts.reduce((a, t) => a + t.gp, 0);
			return g > 0 ? ts.reduce((a, t) => a + t.pts, 0) / g : undefined;
		};
		rows.push(
			row(
				"Points per team per game",
				ppg(A.season),
				ppg(B.season),
				N(ppg(A.season), 1),
				N(ppg(B.season), 1),
			),
		);
		const lead = (s: number) =>
			[...X.qualified(s)].sort((x, y) => y.ppg - x.ppg)[0];
		const la = lead(A.season);
		const lb = lead(B.season);
		rows.push({
			label: "Scoring leader",
			a: la ? `${la.name} (${fmtNum(la.ppg, 1)})` : "–",
			b: lb ? `${lb.name} (${fmtNum(lb.ppg, 1)})` : "–",
			better: null,
		});
	}
	return rows.map(text);
};
