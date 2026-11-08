// The quiz round: a few multiple-choice questions about the season, team, player or league history. Questions are seeded so a deck always asks the same ones, and none is about the champion, so the quiz never spoils the no-spoilers order.
import type { SeasonLine } from "./league.ts";
import type { Quiz, Slide } from "./types.ts";
import type { TopicCtx } from "./topics/helpers.ts";
import { fmtNum, isNum, pickBy, seededRng } from "./util.ts";

export const QUIZ_MAX = 4;

type Rng = () => number;

const shuffle = <T>(list: readonly T[], rng: Rng) => {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
};

// "Who was it" question from rows, best first. Needs four different names and no tie at the top.
const whoQ = (
	rng: Rng,
	kind: string,
	q: string,
	rows: { name: string; v: number }[],
	o: {
		clue?: string;
		chips?: [string, string][];
		extra?: string;
		eps?: number;
	},
): Quiz | null => {
	const seen = new Set<string>();
	const picks: { name: string; v: number }[] = [];
	for (const r of rows) {
		if (!seen.has(r.name) && isNum(r.v)) {
			seen.add(r.name);
			picks.push(r);
		}
		if (picks.length === 4) {
			break;
		}
	}
	if (picks.length < 4 || !(picks[0]!.v > 0)) {
		return null;
	}
	if (Math.abs(picks[0]!.v - picks[1]!.v) < (o.eps ?? 0.05)) {
		return null;
	}
	return {
		kind,
		q,
		clue: o.clue,
		chips: o.chips,
		opts: shuffle(
			picks.map((r, i) => ({ name: r.name, ok: i === 0 })),
			rng,
		),
		answer: { name: picks[0]!.name, extra: o.extra },
	};
};

// A numeric question: the right value and three close ones
const numQ = (
	rng: Rng,
	kind: string,
	q: string,
	v: number,
	dec: number,
	step: number,
	o: {
		clue?: string;
		extra?: string;
		min?: number;
		show?: (x: number) => string;
	},
): Quiz | null => {
	if (!isNum(v) || v <= 0) {
		return null;
	}
	const show = o.show ?? ((x: number) => fmtNum(x, dec));
	const round = (x: number) => Number(x.toFixed(dec));
	const pool = new Set<number>();
	for (let k = 1; k <= 5; k++) {
		for (const s of [-1, 1]) {
			const x = round(v + s * k * step);
			if (x !== round(v) && x >= (o.min ?? 0)) {
				pool.add(x);
			}
		}
	}
	// Prefer close values: take the three nearest after a shuffle of ties
	const others = shuffle([...pool], rng)
		.sort((a, b) => Math.abs(a - v) - Math.abs(b - v))
		.slice(0, 3);
	if (others.length < 3) {
		return null;
	}
	return {
		kind,
		q,
		clue: o.clue,
		opts: shuffle(
			[
				{ name: show(v), ok: true },
				...others.map((x) => ({ name: show(x), ok: false })),
			],
			rng,
		),
		answer: { name: show(v), extra: o.extra },
	};
};

const clueFor = (
	age: number | undefined,
	gp: number | undefined,
	pos?: string,
) =>
	`Clue: ${[pos, isNum(age) ? `age ${age}` : null, isNum(gp) ? `${gp} games` : null].filter(Boolean).join(" · ")}`;

const lineClue = (ctx: TopicCtx, l: SeasonLine) =>
	clueFor(l.age, l.gp, ctx.X.players.get(l.pid)?.pos?.[l.season]);

export const questions = (ctx: TopicCtx): Quiz[] => {
	const { X, mode, season, soFar } = ctx;
	const rng = seededRng(
		`quiz|${mode}|${season}|${ctx.tid ?? ""}|${ctx.pid ?? ""}`,
	);
	const out: (Quiz | null)[] = [];
	const verb = (t: string) =>
		soFar
			? t
					.replace(/\bled\b/, "leads")
					.replace(/\bhad\b/, "has")
					.replace("?", " so far?")
			: t;

	if (mode === "season") {
		const qual = X.qualified(season);
		if (qual.length < 20) {
			return [];
		}
		const mvp = X.awardWinner(season, "Most Valuable Player");
		if (mvp && !soFar) {
			const l = X.line(mvp.pid, season);
			const others = [...qual]
				.filter((x) => x.pid !== mvp.pid)
				.sort((a, b) => b.ws - a.ws)
				.slice(0, 3);
			if (others.length === 3) {
				out.push(
					whoQ(
						rng,
						"mvp",
						`Who was the ${season} MVP?`,
						[
							{ name: mvp.name, v: 1 },
							...others.map((x) => ({ name: x.name, v: 0 })),
						],
						{
							clue: l ? lineClue(ctx, l) : undefined,
							chips: l
								? [
										["PPG", fmtNum(l.ppg, 1)],
										["RPG", fmtNum(l.rpg, 1)],
										["APG", fmtNum(l.apg, 1)],
										["WS", fmtNum(l.ws, 1)],
									]
								: undefined,
							extra: l ? X.teamName(l.tid, season) : undefined,
						},
					),
				);
			}
		}
		for (const [k, q, u] of [
			["ppg", "Who led the league in scoring?", "PPG"],
			["apg", "Who led the league in assists?", "APG"],
			["rpg", "Who led the league in rebounds?", "RPG"],
			["bpg", "Who led the league in blocks?", "BPG"],
			["spg", "Who led the league in steals?", "SPG"],
		] as const) {
			const rows = [...qual].sort((a, b) => b[k] - a[k]);
			const top = rows[0]!;
			out.push(
				whoQ(
					rng,
					k,
					verb(q),
					rows.map((x) => ({ name: x.name, v: x[k] })),
					{
						clue: lineClue(ctx, top),
						chips: [[u, fmtNum(top[k], 1)]],
						extra: `${fmtNum(top[k], 1)} ${u} · ${X.teamName(top.tid, season)}`,
					},
				),
			);
		}
		const teams = X.teamsIn(season)
			.filter((t) => t.gp > 0)
			.sort((a, b) => b.won - a.won);
		if (teams.length >= 4 && teams[0]!.won > teams[1]!.won) {
			const four = teams.slice(0, 4).map((t) => X.teamName(t.tid, season));
			if (new Set(four).size === 4) {
				out.push({
					kind: "record",
					q: verb("Which team had the best record?"),
					clue: `Clue: ${teams[0]!.won} wins in ${teams[0]!.gp} games`,
					opts: shuffle(
						four.map((name, i) => ({ name, ok: i === 0 })),
						rng,
					),
					answer: {
						name: four[0]!,
						extra: `${teams[0]!.won}-${teams[0]!.lost}`,
					},
				});
			}
		}
	} else if (mode === "team" && ctx.tid !== undefined) {
		const t = X.team(ctx.tid, season);
		if (!t || t.gp <= 0) {
			return [];
		}
		const roster = X.teamLines(ctx.tid, season).filter(
			(l) => l.gp >= Math.max(5, t.gp * 0.4),
		);
		for (const [k, q, u] of [
			["ppg", `Who led the ${t.name} in scoring?`, "PPG"],
			["rpg", `Who led the ${t.name} in rebounds?`, "RPG"],
			["apg", `Who led the ${t.name} in assists?`, "APG"],
			["ws", `Who had the most win shares for the ${t.name}?`, "WS"],
		] as const) {
			const rows = [...roster].sort((a, b) => b[k] - a[k]);
			const top = rows[0];
			if (top) {
				out.push(
					whoQ(
						rng,
						k,
						verb(q),
						rows.map((x) => ({ name: x.name, v: x[k] })),
						{
							clue: lineClue(ctx, top),
							chips: [[u, fmtNum(top[k], 1)]],
							extra: `${fmtNum(top[k], 1)} ${u}`,
						},
					),
				);
			}
		}
		if (t.gp === t.won + t.lost && t.gp >= 8) {
			const q = numQ(
				rng,
				"trec",
				soFar ? "What is their record so far?" : "What was their record?",
				t.won,
				0,
				Math.max(2, Math.round(t.gp / 20)),
				{
					min: 0,
					show: (w) => (w <= t.gp ? `${w}-${t.gp - w}` : ""),
					clue: `Clue: ${t.gp} games played`,
					extra: X.teamName(ctx.tid, season),
				},
			);
			if (q && q.opts.every((o) => o.name !== "")) {
				out.push(q);
			}
		}
	} else if (mode === "player" && ctx.pid !== undefined) {
		const l = X.line(ctx.pid, season);
		if (!l) {
			return [];
		}
		const last = l.name.split(" ").at(-1)!;
		const step = (v: number) => Math.max(0.8, Number((v * 0.14).toFixed(1)));
		const clue = lineClue(ctx, l);
		out.push(
			numQ(
				rng,
				"pppg",
				`How many points a game did ${last} average?`,
				l.ppg,
				1,
				step(l.ppg),
				{ clue, extra: `${fmtNum(l.ppg, 1)} PPG` },
			),
		);
		if (l.rpg >= 3) {
			out.push(
				numQ(
					rng,
					"prpg",
					`How many rebounds a game did ${last} average?`,
					l.rpg,
					1,
					step(l.rpg),
					{ extra: `${fmtNum(l.rpg, 1)} RPG` },
				),
			);
		}
		if (l.apg >= 3) {
			out.push(
				numQ(
					rng,
					"papg",
					`How many assists a game did ${last} average?`,
					l.apg,
					1,
					step(l.apg),
					{ extra: `${fmtNum(l.apg, 1)} APG` },
				),
			);
		}
		if (l.gp >= 8) {
			out.push(
				numQ(
					rng,
					"pgp",
					`How many games did ${last} play?`,
					l.gp,
					0,
					Math.max(3, Math.round(l.gp / 12)),
					{ min: 1, extra: "regular season" },
				),
			);
		}
		const mine = X.games(season).flatMap((g) =>
			g.teams.flatMap((tm) => tm.players.filter((p) => p.pid === ctx.pid)),
		);
		if (mine.length >= 5) {
			const top = Math.max(...mine.map((p) => p.pts));
			out.push(
				numQ(
					rng,
					"phigh",
					"How many points in his best scoring game?",
					top,
					0,
					Math.max(2, Math.round(top * 0.1)),
					{
						min: 1,
						clue: `Clue: from ${mine.length} games with box scores`,
						extra: "season high",
					},
				),
			);
		}
	} else if (mode === "all") {
		const people = X.cached("careers", () =>
			X.L.players
				.filter((p) => p.stats.some((r) => r.gp > 0))
				.map((p) => ({ p, c: X.career(p) })),
		);
		for (const [k, q, noun] of [
			["pts", "Who has scored the most points in league history?", "points"],
			["ast", "Who has the most career assists?", "assists"],
			["trb", "Who has the most career rebounds?", "rebounds"],
		] as const) {
			const rows = [...people].sort((a, b) => b.c[k] - a.c[k]).slice(0, 8);
			out.push(
				whoQ(
					rng,
					`c${k}`,
					q,
					rows.map((r) => ({ name: r.p.name, v: r.c[k] })),
					{
						eps: 0.5,
						clue: rows[0]
							? `Clue: ${fmtNum(rows[0].c.gp)} games${rows[0].p.retiredYear < Infinity ? `, retired ${rows[0].p.retiredYear}` : ", still active"}`
							: undefined,
						extra: rows[0] ? `${fmtNum(rows[0].c[k])} ${noun}` : undefined,
					},
				),
			);
		}
		const mvps = X.L.players
			.map((p) => ({
				name: p.name,
				v: X.countAwards(p, "Most Valuable Player"),
			}))
			.sort((a, b) => b.v - a.v);
		if (mvps[0] && mvps[0].v >= 2) {
			out.push(
				whoQ(
					rng,
					"mvps",
					"Who has won the most MVP awards?",
					mvps.slice(0, 8),
					{ eps: 0.5, extra: `${mvps[0].v} awards` },
				),
			);
		}
		const ids = [...new Set(X.L.teamSeasons.map((t) => t.tid))];
		const titles = ids
			.map((tid) => ({ tid, n: X.titlesOf(tid).length }))
			.sort((a, b) => b.n - a.n);
		if (
			titles.length >= 4 &&
			titles[0]!.n > titles[1]!.n &&
			titles[0]!.n >= 2
		) {
			const four = titles.slice(0, 4).map((x) => X.teamName(x.tid, X.L.season));
			if (new Set(four).size === 4) {
				out.push({
					kind: "titles",
					q: "Which franchise has won the most titles?",
					opts: shuffle(
						four.map((name, i) => ({ name, ok: i === 0 })),
						rng,
					),
					answer: { name: four[0]!, extra: `${titles[0]!.n} titles` },
				});
			}
		}
	}
	const ok = shuffle(
		out.filter((x): x is Quiz => x !== null),
		rng,
	);
	// One question per kind family
	return ok.slice(0, QUIZ_MAX);
};

// Quiz questions as slides, flagged core so the normal deck planner leaves them alone
export const quizSlides = (ctx: TopicCtx): Slide[] =>
	questions(ctx).map((q, i) => ({
		id: `quiz${i + 1}`,
		group: "quiz",
		theme: "quiz",
		score: 0,
		core: true,
		kicker: "Quiz time",
		heads: [q.q],
		lines: [],
		quiz: q,
		season: ctx.season,
	}));

export const quizHead = (seed: string, i: number) =>
	pickBy(`${seed}|quizhead|${i}`, [
		"Quiz time",
		"Test yourself",
		"Who was it?",
	]);
