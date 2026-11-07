// Playoff pages: the upset ledger, how long the series ran, the closest series by points, how the seeds fared and both finalists' roads.

import { Ctx, P } from "./ctx.ts";
import { inGames, seriesOf, sides } from "./front.ts";
import { addPage, arcPage, table } from "./kit.ts";
import { andList, capFirst, plural, word } from "./text.ts";
import type { NPSeries, NPSeriesTeam } from "./types.ts";

type Done = {
	s: NPSeries;
	round: number;
	w: NPSeriesTeam;
	l: NPSeriesTeam;
};

// Series that are over: any series of a finished round, or all of them once the season is done
const finished = (c: Ctx): Done[] => {
	const out: Done[] = [];
	for (const [round, list] of c.f.series.entries()) {
		if (!c.done && round >= c.f.currentRound) {
			continue;
		}
		for (const s of list) {
			if (!s.away || s.home.won === s.away.won) {
				continue;
			}
			const w = s.home.won > s.away.won ? s.home : s.away;
			const l = w === s.home ? s.away : s.home;
			out.push({ s, round, w, l });
		}
	}
	return out;
};

const PO_EDS = ["playoffs", "final"] as const;

addPage(
	arcPage<{ done: Done[]; upsets: Done[] }>({
		id: "upsets",
		section: "playoffs",
		kicker: "Upset ledger",
		eds: PO_EDS,
		beat: "playoffs",
		prep: (c) => {
			const done = finished(c);
			if (done.length < 3) {
				return undefined;
			}
			return { done, upsets: done.filter((d) => d.w.seed > d.l.seed) };
		},
		arcs: [
			{
				id: "ledger",
				fit: (x) => x.upsets.length > 0,
				heads: (x, c) => {
					const u = x.upsets.toSorted((a, b) => b.w.seed - b.l.seed - (a.w.seed - a.l.seed))[0]!;
					return [
						`No. ${u.w.seed} ${c.tn(u.w.tid)} ${c.T("topple", "toppled")} No. ${u.l.seed} ${c.tn(u.l.tid)}`,
						`${plural(x.upsets.length, "upset")} in the ${c.season} bracket`,
						`The upset ledger: ${x.upsets.length} of ${x.done.length} series`,
						`Chaos in the bracket: ${c.tn(u.w.tid)} over ${c.tn(u.l.tid)}`,
					];
				},
				build: (x, r, c) => [
					P(
						`In ${c.season}, ${plural(x.upsets.length, "series", "series")} of ${x.done.length} ${c.T("have gone", "went")} to the lower seed.`,
					),
					table(
						["Round", "Winner", "Loser", "Series"],
						x.upsets
							.toSorted((a, b) => b.w.seed - b.l.seed - (a.w.seed - a.l.seed))
							.slice(0, 8)
							.map((d) => [
								[capFirst(c.roundPhrase(d.round))],
								[`(${d.w.seed}) `, c.tl(d.w.tid)],
								[`(${d.l.seed}) `, c.tl(d.l.tid)],
								[`${d.w.won}-${d.l.won}`],
							]),
						[3],
					),
				],
			},
			{
				id: "chalk",
				fit: (x) => x.upsets.length === 0,
				heads: (x, c) => [
					`The favorites ${c.T("are holding", "held")} serve`,
					`No upsets: ${x.done.length} series, ${x.done.length} higher seeds`,
					`Chalk, chalk and more chalk`,
					`Not one upset in the ${c.season} bracket`,
				],
				build: (x, r, c) => [
					P(
						`Every one of the ${x.done.length} series ${c.T("has gone", "went")} to the higher seed.`,
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ done: Done[] }>({
		id: "series-length",
		section: "playoffs",
		kicker: "How long it lasted",
		eds: PO_EDS,
		beat: "playoffs",
		prep: (c) => {
			const done = finished(c);
			return done.length >= 3 ? { done } : undefined;
		},
		arcs: [
			{
				id: "lengths",
				heads: (x, c) => {
					const sweeps = x.done.filter((d) => d.l.won === 0).length;
					return [
						`${plural(sweeps, "sweep")}, ${x.done.filter((d) => d.w.won + d.l.won >= 7).length} that went the distance`,
						`How long the series ${c.T("run", "ran")}`,
						`Brooms and Game 7s: the ${c.season} series lengths`,
						`The longest series of the ${c.season} playoffs`,
					];
				},
				build: (x, r, c) => {
					const longest = x.done.toSorted((a, b) => b.w.won + b.l.won - (a.w.won + a.l.won))[0]!;
					const sweeps = x.done.filter((d) => d.l.won === 0);
					const rounds = [...new Set(x.done.map((d) => d.round))].toSorted((a, b) => a - b);
					return [
						P(
							sweeps.length === 0
								? `No ${c.season} series ${c.T("has", "")} ended in a sweep. The longest, `.replace("  ", " ")
								: `${plural(sweeps.length, "series", "series")} ${c.T("have ended", "ended")} in sweeps. The longest, `,
							c.tl(longest.w.tid),
							` over `,
							c.tl(longest.l.tid),
							`, ${c.T("took", "took")} ${word(longest.w.won + longest.l.won)} games.`,
						),
						table(
							["Round", "Series", "Sweeps", "Average games"],
							rounds.map((rd) => {
								const rs = x.done.filter((d) => d.round === rd);
								return [
									[capFirst(c.roundPhrase(rd))],
									[String(rs.length)],
									[String(rs.filter((d) => d.l.won === 0).length)],
									[
										(
											rs.reduce((a, d) => a + d.w.won + d.l.won, 0) / rs.length
										).toFixed(1),
									],
								];
							}),
							[1, 2, 3],
						),
					];
				},
			},
		],
	}),
);

addPage(
	arcPage<{ rows: { d: Done; margin: number; games: number }[] }>({
		id: "series-margins",
		section: "playoffs",
		kicker: "By the points",
		eds: PO_EDS,
		beat: "playoffs",
		prep: (c) => {
			const rows = finished(c)
				.map((d) => {
					const games = c.f.games.filter((g) => d.s.gids.includes(g.gid));
					if (games.length < 3 || games.length < d.s.gids.length * 0.8) {
						return undefined;
					}
					const margin = games.reduce(
						(a, g) =>
							a +
							(g.won.tid === d.w.tid ? 1 : -1) * (g.won.pts - g.lost.pts),
						0,
					);
					return { d, margin, games: games.length };
				})
				.filter((x): x is NonNullable<typeof x> => x !== undefined);
			return rows.length >= 3 ? { rows } : undefined;
		},
		arcs: [
			{
				id: "closest",
				heads: (x, c) => {
					const y = x.rows.toSorted((a, b) => Math.abs(a.margin) - Math.abs(b.margin))[0]!;
					return [
						`${c.tn(y.d.w.tid)} ${c.T("edge", "edged")} ${c.tn(y.d.l.tid)} by ${Math.abs(y.margin)} points over ${word(y.games)} games`,
						`The closest series of the playoffs`,
						`Decided by inches: ${c.tn(y.d.w.tid)} and ${c.tn(y.d.l.tid)}`,
						`Margins that thin: the ${c.season} series by points`,
					];
				},
				build: (x, r, c) => {
					const sorted = x.rows.toSorted((a, b) => Math.abs(a.margin) - Math.abs(b.margin));
					const y = sorted[0]!;
					return [
						P(
							`Over ${word(y.games)} games the `,
							c.tl(y.d.w.tid),
							` outscored the `,
							c.tl(y.d.l.tid),
							` by only ${Math.abs(y.margin)} ${Math.abs(y.margin) === 1 ? "point" : "points"} in total, the closest series by margin.`,
						),
						table(
							["Series", "Result", "Net points"],
							sorted.slice(0, 5).map((z) => [
								[c.tl(z.d.w.tid), " over ", c.tl(z.d.l.tid)],
								[`${z.d.w.won}-${z.d.l.won}`],
								[z.margin >= 0 ? `+${z.margin}` : `${z.margin}`],
							]),
							[1, 2],
						),
					];
				},
			},
			{
				id: "blowout",
				heads: (x, c) => {
					const y = x.rows.toSorted((a, b) => b.margin - a.margin)[0]!;
					return [
						`${c.tn(y.d.w.tid)} ${c.T("outscore", "outscored")} ${c.tn(y.d.l.tid)} by ${y.margin}`,
						`The most lopsided series`,
						`No contest: ${c.tn(y.d.w.tid)} over ${c.tn(y.d.l.tid)}`,
						`The widest series margin of the ${c.season} playoffs`,
					];
				},
				build: (x, r, c) => {
					const y = x.rows.toSorted((a, b) => b.margin - a.margin)[0]!;
					return [
						P(
							`The `,
							c.tl(y.d.w.tid),
							` beat the `,
							c.tl(y.d.l.tid),
							` ${inGames(y.d.w.won, y.d.l.won)} and outscored them by ${y.margin} points over the series, the widest margin of the playoffs.`,
						),
					];
				},
			},
		],
	}),
);

addPage(
	arcPage<{ byRound: { round: number; top: number; low: number }[] }>({
		id: "seed-report",
		section: "playoffs",
		kicker: "How the seeds fared",
		eds: PO_EDS,
		beat: "playoffs",
		prep: (c) => {
			const done = finished(c);
			if (done.length < 4) {
				return undefined;
			}
			const rounds = [...new Set(done.map((d) => d.round))].toSorted((a, b) => a - b);
			return {
				byRound: rounds.map((round) => ({
					round,
					top: done.filter((d) => d.round === round && d.w.seed < d.l.seed).length,
					low: done.filter((d) => d.round === round && d.w.seed > d.l.seed).length,
				})),
			};
		},
		arcs: [
			{
				id: "rounds",
				heads: (x, c) => [
					`Seeds ${c.T("are", "were")} ${x.byRound.reduce((a, r) => a + r.top, 0) >= x.byRound.reduce((a, r) => a + r.low, 0) ? "worth something" : "no guide"} this spring`,
					`Higher seeds against lower seeds, round by round`,
					`The bracket by seed`,
					`Did the ${c.season} favorites win?`,
				],
				build: (x, r, c) => [
					P(
						`In the ${c.season} playoffs, ${x.byRound.reduce((a, r) => a + r.top, 0)} of ${x.byRound.reduce((a, r) => a + r.top + r.low, 0)} series ${c.T("have gone", "went")} to the higher seed; round by round:`,
					),
					table(
						["Round", "Higher seed won", "Lower seed won"],
						x.byRound.map((y) => [
							[capFirst(c.roundPhrase(y.round))],
							[String(y.top)],
							[String(y.low)],
						]),
						[1, 2],
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ roads: { tid: number; legs: { round: number; opp: number; w: number; l: number; seed?: number }[] }[] }>({
		id: "finalists-roads",
		section: "playoffs",
		kicker: "Two roads to the finals",
		eds: PO_EDS,
		beat: "playoffs",
		prep: (c) => {
			const last = c.f.series[c.f.numRounds - 1]?.[0];
			if (!last?.away || (!c.done && c.f.currentRound < c.f.numRounds - 1)) {
				return undefined;
			}
			const roads = [last.home.tid, last.away.tid].map((tid) => ({
				tid,
				legs: seriesOf(c, tid)
					.filter((x) => x.round < c.f.numRounds - 1)
					.map(({ s, round }) => {
						const { me, opp } = sides(s, tid);
						return {
							round,
							opp: opp?.tid ?? -1,
							w: me?.won ?? 0,
							l: opp?.won ?? 0,
							seed: opp?.seed,
						};
					})
					.filter((l) => l.opp >= 0),
			}));
			return roads.every((r) => r.legs.length > 0) ? { roads } : undefined;
		},
		arcs: [
			{
				id: "roads",
				heads: (x, c) => [
					`${c.tn(x.roads[0]!.tid)} and ${c.tn(x.roads[1]!.tid)}: two roads to the finals`,
					`How the finalists got here`,
					`The paths: ${c.tn(x.roads[0]!.tid)} ${c.T("vs.", "vs.")} ${c.tn(x.roads[1]!.tid)}`,
					`Finals preview: the road behind each team`,
				],
				build: (x, r, c) =>
					x.roads.map((road) => ({
						type: "p" as const,
						segs: [
							"The ",
							c.tl(road.tid),
							" ",
							...andList(
								road.legs.map((l) => [
									`${l.w > l.l ? "beat" : "lost to"} the `,
									l.seed ? `No. ${l.seed} ` : "",
									c.tl(l.opp),
									` ${l.w}-${l.l} in the ${c.roundPhrase(l.round)}`,
								]),
							),
							".",
						],
					})),
			},
		],
	}),
);
