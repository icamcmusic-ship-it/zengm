// Extra all-time topics: playoff history, franchises, eras, careers and people, the draft, and the money.
import type { Slide, WPlayer, WTeamSeason } from "../types.ts";
import { fmtNum, isNum, plural, span, winPct } from "../util.ts";
import { mk, type Topic } from "./helpers.ts";
import { money, pct, wpOf, type X } from "./kit.ts";

const careers = (X: X) =>
	X.cached("careers", () =>
		X.L.players
			.filter((p) => p.stats.some((r) => r.gp > 0))
			.map((p) => ({ p, c: X.career(p) })),
	);

const tname = (X: X, tid: number) => X.teamName(tid, X.L.season);
const nameAt = (X: X, tid: number, season: number) => X.teamName(tid, season);

const decidedTeamSeasons = (X: X) =>
	X.L.teamSeasons.filter((t) => X.decided(t.season) && t.won + t.lost > 10);

const champSeasons = (X: X) =>
	X.decidedSeasons()
		.map((s) => ({ s, t: X.champion(s), r: X.runnerUp(s) }))
		.filter((x) => x.t);

const tally = <K>(items: K[]) => {
	const m = new Map<K, number>();
	for (const k of items) {
		m.set(k, (m.get(k) ?? 0) + 1);
	}
	return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// ---------------------------------------------------------------------------------------------
// Playoffs and titles
// ---------------------------------------------------------------------------------------------

const finalsHistory: Topic = ({ X }) => {
	const ch = champSeasons(X);
	if (ch.length < 4) {
		return null;
	}
	const out: Slide[] = [];
	const losses = tally(ch.filter((x) => x.r).map((x) => x.r!.tid));
	const top = losses[0];
	if (top && top[1] >= 2) {
		const titles = X.titlesOf(top[0]).length;
		out.push(
			mk({
				id: "a-bridesmaid",
				group: "a-finals",
				theme: "playoffs",
				score: Math.min(0.75, 0.35 + top[1] * 0.08),
				kicker: "Always the bridesmaid",
				tid: top[0],
				heads: [
					`The ${tname(X, top[0])} have lost the finals ${top[1]} times`,
					`So close, ${top[1]} times over`,
				],
				hero: { text: `${top[1]}`, unit: "finals losses" },
				list: losses
					.slice(1, 4)
					.map(([t, n]) => ({
						name: tname(X, t),
						value: plural(n, "loss", "losses"),
						tid: t,
					})),
				lines: [
					titles > 0
						? `They have ${plural(titles, "title")} to show for it`
						: "And no title yet",
				],
			}),
		);
	}
	// Finals record
	const apps = new Map<number, { w: number; l: number }>();
	for (const x of ch) {
		const w = apps.get(x.t!.tid) ?? { w: 0, l: 0 };
		w.w += 1;
		apps.set(x.t!.tid, w);
		if (x.r) {
			const l = apps.get(x.r.tid) ?? { w: 0, l: 0 };
			l.l += 1;
			apps.set(x.r.tid, l);
		}
	}
	const best = [...apps.entries()]
		.filter(([, v]) => v.w + v.l >= 3)
		.sort(
			(a, b) =>
				b[1].w / (b[1].w + b[1].l) - a[1].w / (a[1].w + a[1].l) ||
				b[1].w - a[1].w,
		)[0];
	if (best) {
		out.push(
			mk({
				id: "a-finals-record",
				group: "a-finals",
				theme: "playoffs",
				score: Math.min(0.7, 0.3 + best[1].w * 0.06),
				kicker: "Finals record",
				tid: best[0],
				heads: [
					`The ${tname(X, best[0])} are ${best[1].w}-${best[1].l} in the finals`,
					`A finals specialist: ${tname(X, best[0])}`,
				],
				hero: { text: `${best[1].w}-${best[1].l}`, unit: "in the finals" },
				lines: [`${plural(best[1].w + best[1].l, "finals appearance")}`],
			}),
		);
	}
	// Finals pairings
	const pairs = tally(
		ch
			.filter((x) => x.r)
			.map((x) => [x.t!.tid, x.r!.tid].sort((a, b) => a - b).join("|")),
	);
	const pr = pairs[0];
	if (pr && pr[1] >= 2) {
		const [a, b] = pr[0].split("|").map(Number) as [number, number];
		out.push(
			mk({
				id: "a-finals-rivals",
				group: "a-finals",
				theme: "playoffs",
				score: Math.min(0.7, 0.3 + pr[1] * 0.1),
				kicker: "Finals rivals",
				tid: a,
				heads: [
					`${tname(X, a)} and ${tname(X, b)} have met in the finals ${pr[1]} times`,
					`The finals rivalry`,
				],
				hero: { text: `${pr[1]}`, unit: "finals meetings" },
				lines: [
					ch
						.filter(
							(x) =>
								x.r &&
								[x.t!.tid, x.r.tid].sort((p, q) => p - q).join("|") === pr[0],
						)
						.map((x) => `${x.s}: ${nameAt(X, x.t!.tid, x.s)} won`)
						.join("; "),
				],
			}),
		);
	}
	return out;
};

const champExtremes: Topic = ({ X }) => {
	const ch = champSeasons(X).filter(
		(x) => x.t!.gp > 10 || x.t!.won + x.t!.lost > 10,
	);
	if (ch.length < 4) {
		return null;
	}
	const out: Slide[] = [];
	const worst = [...ch].sort((a, b) => wpOf(a.t!) - wpOf(b.t!))[0]!;
	out.push(
		mk({
			id: "a-champ-worst",
			group: "a-champs",
			theme: "playoffs",
			score: Math.min(0.75, 0.3 + (0.6 - wpOf(worst.t!)) * 1.5),
			kicker: "Least likely champion",
			tid: worst.t!.tid,
			season: worst.s,
			heads: [
				`The ${worst.s} ${tname(X, worst.t!.tid)} won it all with ${worst.t!.won} wins`,
				`The worst regular season by a champion`,
			],
			hero: {
				text: `${worst.t!.won}-${worst.t!.lost}`,
				unit: "regular-season record",
			},
			lines: [
				worst.t!.seed !== undefined
					? `Entered as the No. ${worst.t!.seed} seed`
					: null,
			],
		}),
	);
	const seeded = ch.filter((x) => x.t!.seed !== undefined);
	const low = [...seeded].sort(
		(a, b) => b.t!.seed! - a.t!.seed! || a.s - b.s,
	)[0];
	if (low && low.t!.seed! >= 3) {
		out.push(
			mk({
				id: "a-low-seed",
				group: "a-champs",
				theme: "playoffs",
				score: Math.min(0.8, 0.25 + low.t!.seed! * 0.08),
				kicker: "Lowest seed to win it all",
				tid: low.t!.tid,
				season: low.s,
				heads: [
					`A No. ${low.t!.seed} seed won the ${low.s} title`,
					`The ${low.s} ${tname(X, low.t!.tid)} came from the back of the bracket`,
				],
				hero: { text: `No. ${low.t!.seed}`, unit: "seed" },
				lines: [`${low.t!.won}-${low.t!.lost} in the regular season`],
			}),
		);
	}
	const champSet = new Set(ch.map((x) => `${x.t!.tid}|${x.s}`));
	const best = decidedTeamSeasons(X)
		.filter((t) => !champSet.has(`${t.tid}|${t.season}`))
		.sort((a, b) => wpOf(b) - wpOf(a))[0];
	if (best) {
		const c = X.champion(best.season);
		out.push(
			mk({
				id: "a-best-nochamp",
				group: "a-champs",
				theme: "playoffs",
				score: 0.55,
				kicker: "The best team without a title",
				tid: best.tid,
				season: best.season,
				heads: [
					`The ${best.season} ${tname(X, best.tid)} went ${best.won}-${best.lost} and still came up short`,
					`No ring for the best record never to win it`,
				],
				hero: { text: `${best.won}-${best.lost}`, unit: "no title" },
				lines: [
					c ? `Champions that year: ${tname(X, c.tid)}` : null,
					best.playoffRoundsWon >= 0
						? `Out in round ${best.playoffRoundsWon + 1}`
						: "Missed the playoffs entirely",
				],
			}),
		);
	}
	// Champions that missed the playoffs the next year
	const hang = ch
		.map((x) => ({ x, nx: X.team(x.t!.tid, x.s + 1) }))
		.filter((h) => h.nx && X.decided(h.x.s + 1) && h.nx.playoffRoundsWon < 0);
	if (hang.length > 0) {
		const worstHang = [...hang].sort((a, b) => wpOf(a.nx!) - wpOf(b.nx!))[0]!;
		out.push(
			mk({
				id: "a-hangover",
				group: "a-champs",
				theme: "playoffs",
				score: Math.min(0.7, 0.35 + hang.length * 0.08),
				kicker: "The title hangover",
				tid: worstHang.x.t!.tid,
				season: worstHang.x.s + 1,
				heads: [
					`${plural(hang.length, "champion")} missed the playoffs the next year`,
					`From champions to the couch: ${tname(X, worstHang.x.t!.tid)}`,
				],
				hero: {
					text: `${hang.length}`,
					unit:
						hang.length === 1 ? "champion missed out" : "champions missed out",
				},
				lines: [
					`${worstHang.x.s + 1}: ${worstHang.nx!.won}-${worstHang.nx!.lost} for the ${nameAt(X, worstHang.x.t!.tid, worstHang.x.s + 1)}`,
				],
			}),
		);
	}
	return out;
};

const seriesStories: Topic = ({ X }) => {
	const out: Slide[] = [];
	let upset:
		| {
				season: number;
				w: number;
				l: number;
				ws: number;
				ls: number;
				sw: number;
				sl: number;
		  }
		| undefined;
	let sweeps = 0;
	let sevens = 0;
	const sevenList: { season: number; a: number; b: number; finals: boolean }[] =
		[];
	let total = 0;
	for (const ps of X.L.series) {
		if (!X.decided(ps.season)) {
			continue;
		}
		for (const [ri, round] of ps.rounds.entries()) {
			for (const m of round) {
				if (!m.away) {
					continue;
				}
				total += 1;
				const w = m.home.won > m.away.won ? m.home : m.away;
				const l = w === m.home ? m.away : m.home;
				if (l.won === 0 && w.won >= 3) {
					sweeps += 1;
				}
				if (w.won >= 3 && w.won + l.won === 2 * w.won - 1) {
					sevens += 1;
					sevenList.push({
						season: ps.season,
						a: w.tid,
						b: l.tid,
						finals: ri === ps.rounds.length - 1,
					});
				}
				const gap = w.seed - l.seed;
				if (
					gap > 0 &&
					(!upset ||
						gap > upset.ws - upset.ls ||
						(gap === upset.ws - upset.ls &&
							w.won - l.won < upset.sw - upset.sl))
				) {
					upset = {
						season: ps.season,
						w: w.tid,
						l: l.tid,
						ws: w.seed,
						ls: l.seed,
						sw: w.won,
						sl: l.won,
					};
				}
			}
		}
	}
	if (total < 8) {
		return null;
	}
	if (upset && upset.ws - upset.ls >= 3) {
		out.push(
			mk({
				id: "a-upset",
				group: "a-series",
				theme: "playoffs",
				score: Math.min(0.8, 0.3 + (upset.ws - upset.ls) * 0.07),
				kicker: "The biggest upset",
				tid: upset.w,
				season: upset.season,
				heads: [
					`No. ${upset.ws} ${nameAt(X, upset.w, upset.season)} beat No. ${upset.ls} ${nameAt(X, upset.l, upset.season)}`,
					`The upset of the ages, ${upset.season}`,
				],
				hero: { text: `${upset.sw}-${upset.sl}`, unit: "series result" },
				lines: [`A gap of ${upset.ws - upset.ls} seeds`],
			}),
		);
	}
	if (sweeps >= 3) {
		out.push(
			mk({
				id: "a-sweeps",
				group: "a-series",
				theme: "playoffs",
				score: Math.min(0.55, 0.2 + sweeps * 0.01),
				kicker: "Sweeps",
				heads: [
					`${plural(sweeps, "series", "series")} ended in a sweep`,
					`${pct(sweeps / total, 0)} of playoff series were over in a sweep`,
				],
				hero: { text: `${sweeps}`, unit: "sweeps" },
				lines: [`Out of ${plural(total, "series", "series")}`],
			}),
		);
	}
	if (sevens >= 2) {
		const f = sevenList.filter((x) => x.finals);
		out.push(
			mk({
				id: "a-game7",
				group: "a-series",
				theme: "playoffs",
				score: Math.min(0.7, 0.3 + sevens * 0.03 + f.length * 0.1),
				kicker: "Winner take all",
				tid: sevenList.at(-1)!.a,
				heads: [
					`${plural(sevens, "series", "series")} went the full distance`,
					`${plural(sevens, "deciding game")}`,
				],
				hero: { text: `${sevens}`, unit: "deciding games" },
				lines: [
					f.length > 0
						? `${f.length} of them in the finals: ${f.map((x) => x.season).join(", ")}`
						: "None in the finals",
				],
			}),
		);
	}
	// Most-played playoff opponents
	const pairs = new Map<string, number>();
	for (const ps of X.L.series) {
		if (!X.decided(ps.season)) {
			continue;
		}
		for (const round of ps.rounds) {
			for (const m of round) {
				if (m.away) {
					const k = [m.home.tid, m.away.tid].sort((a, b) => a - b).join("|");
					pairs.set(k, (pairs.get(k) ?? 0) + 1);
				}
			}
		}
	}
	const top = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
	if (top && top[1] >= 3) {
		const [a, b] = top[0].split("|").map(Number) as [number, number];
		out.push(
			mk({
				id: "a-po-rivals",
				group: "a-rivals",
				theme: "playoffs",
				score: Math.min(0.65, 0.25 + top[1] * 0.08),
				kicker: "The great playoff rivalry",
				tid: a,
				heads: [
					`${tname(X, a)} and ${tname(X, b)} have met ${top[1]} times in the playoffs`,
					`Nobody has seen more of each other in the playoffs`,
				],
				hero: { text: `${top[1]}`, unit: "playoff series" },
				lines: [],
			}),
		);
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// Franchises
// ---------------------------------------------------------------------------------------------

const franchiseTotals = (X: X) =>
	X.cached("frTotals", () =>
		[...new Set(X.L.teamSeasons.map((t) => t.tid))].map((tid) => {
			const h = X.teamHistory(tid).filter(
				(t) => X.decided(t.season) && t.won + t.lost > 10,
			);
			const won = h.reduce((a, t) => a + t.won, 0);
			const lost = h.reduce((a, t) => a + t.lost, 0);
			return { tid, h, won, lost, p: winPct(won, lost) };
		}),
	).filter((f) => f.h.length > 0);

const franchiseRecords: Topic = ({ X }) => {
	const fr = franchiseTotals(X).filter((f) => f.h.length >= 3);
	if (fr.length < 4) {
		return null;
	}
	const out: Slide[] = [];
	const best = [...fr].sort((a, b) => b.p - a.p)[0]!;
	const worst = [...fr].sort((a, b) => a.p - b.p)[0]!;
	out.push(
		mk({
			id: "a-fr-wins",
			group: "a-franchise",
			theme: "team",
			score: 0.6,
			kicker: "The winningest franchise",
			tid: best.tid,
			heads: [
				`The ${tname(X, best.tid)} have the best all-time record`,
				`${fmtNum(best.won)} wins and counting for the ${tname(X, best.tid)}`,
			],
			hero: { text: pct(best.p, 1), unit: "all-time win pct" },
			list: [...fr]
				.sort((a, b) => b.p - a.p)
				.slice(1, 4)
				.map((f) => ({
					name: tname(X, f.tid),
					value: pct(f.p, 1),
					tid: f.tid,
				})),
			lines: [
				`${fmtNum(best.won)}-${fmtNum(best.lost)} over ${plural(best.h.length, "season")}`,
			],
		}),
	);
	if (worst.tid !== best.tid) {
		out.push(
			mk({
				id: "a-fr-worst",
				group: "a-franchise",
				theme: "team",
				score: 0.45,
				kicker: "The long suffering",
				tid: worst.tid,
				heads: [
					`The ${tname(X, worst.tid)} have the worst all-time record`,
					`${fmtNum(worst.lost)} losses for the ${tname(X, worst.tid)}`,
				],
				hero: { text: pct(worst.p, 1), unit: "all-time win pct" },
				lines: [
					`${fmtNum(worst.won)}-${fmtNum(worst.lost)} over ${plural(worst.h.length, "season")}`,
				],
			}),
		);
	}
	return out;
};

const swings: Topic = ({ X }) => {
	const out: Slide[] = [];
	let up: { t: WTeamSeason; prev: WTeamSeason; d: number } | undefined;
	let down: typeof up;
	for (const t of decidedTeamSeasons(X)) {
		const prev = X.team(t.tid, t.season - 1);
		if (!prev || !X.decided(prev.season) || prev.won + prev.lost < 10) {
			continue;
		}
		const d = wpOf(t) - wpOf(prev);
		if (!up || d > up.d) {
			up = { t, prev, d };
		}
		if (!down || d < down.d) {
			down = { t, prev, d };
		}
	}
	if (up && up.d > 0.15) {
		out.push(
			mk({
				id: "a-turnaround",
				group: "a-swing",
				theme: "team",
				score: Math.min(0.7, 0.3 + up.d),
				kicker: "The biggest turnaround",
				tid: up.t.tid,
				season: up.t.season,
				heads: [
					`The ${up.t.season} ${tname(X, up.t.tid)} gained ${up.t.won - up.prev.won} wins in one year`,
					`From ${up.prev.won} wins to ${up.t.won}`,
				],
				hero: {
					text: `+${up.t.won - up.prev.won}`,
					unit: "wins in one season",
				},
				lines: [
					`${up.prev.won}-${up.prev.lost} in ${up.prev.season}, ${up.t.won}-${up.t.lost} in ${up.t.season}`,
				],
			}),
		);
	}
	if (down && down.d < -0.15) {
		out.push(
			mk({
				id: "a-collapse",
				group: "a-swing",
				theme: "team",
				score: Math.min(0.65, 0.25 - down.d),
				kicker: "The biggest collapse",
				tid: down.t.tid,
				season: down.t.season,
				heads: [
					`The ${down.t.season} ${tname(X, down.t.tid)} lost ${down.prev.won - down.t.won} wins from the year before`,
					`From ${down.prev.won} wins to ${down.t.won}`,
				],
				hero: {
					text: `-${down.prev.won - down.t.won}`,
					unit: "wins in one season",
				},
				lines: [
					`${down.prev.won}-${down.prev.lost} in ${down.prev.season}, ${down.t.won}-${down.t.lost} in ${down.t.season}`,
				],
			}),
		);
	}
	return out;
};

const waits: Topic = ({ X }) => {
	const ids = [...new Set(X.L.teamSeasons.map((t) => t.tid))];
	const decided = X.decidedSeasons();
	if (decided.length < 6) {
		return null;
	}
	const out: Slide[] = [];
	const never = ids
		.map((tid) => ({
			tid,
			n: X.teamHistory(tid).filter((t) => X.decided(t.season)).length,
			titles: X.titlesOf(tid).length,
		}))
		.filter((x) => x.titles === 0 && x.n >= 5)
		.sort((a, b) => b.n - a.n);
	if (never.length > 0) {
		out.push(
			mk({
				id: "a-never",
				group: "a-wait",
				theme: "playoffs",
				score: Math.min(0.6, 0.25 + never.length * 0.04),
				kicker: "Still waiting",
				tid: never[0]!.tid,
				heads: [
					`${plural(never.length, "team")} have never won a title`,
					`${tname(X, never[0]!.tid)}: ${never[0]!.n} seasons, no title`,
				],
				hero: {
					text: `${never.length}`,
					unit:
						never.length === 1
							? "team without a title"
							: "teams without a title",
				},
				list: never
					.slice(0, 4)
					.map((x) => ({
						name: tname(X, x.tid),
						value: plural(x.n, "season"),
						tid: x.tid,
					})),
			}),
		);
	}
	// Longest wait for a first title
	const first = ids
		.map((tid) => {
			const hist = X.teamHistory(tid).filter((t) => X.decided(t.season));
			const t1 = X.titlesOf(tid)[0];
			return {
				tid,
				wait: t1 !== undefined && hist[0] ? t1 - hist[0].season : -1,
				t1,
			};
		})
		.filter((x) => x.wait >= 3)
		.sort((a, b) => b.wait - a.wait)[0];
	if (first) {
		out.push(
			mk({
				id: "a-first-title",
				group: "a-wait",
				theme: "playoffs",
				score: Math.min(0.6, 0.25 + first.wait * 0.02),
				kicker: "Worth the wait",
				tid: first.tid,
				season: first.t1,
				heads: [
					`The ${tname(X, first.tid)} waited ${first.wait} seasons for their first title`,
					`Finally: ${first.t1}`,
				],
				hero: { text: `${first.wait}`, unit: "years to a first title" },
				lines: [],
			}),
		);
	}
	// Parity
	const champs = champSeasons(X);
	const distinct = new Set(champs.map((c) => c.t!.tid)).size;
	if (champs.length >= 8) {
		const teams = new Set(X.L.teamSeasons.map((t) => t.tid)).size;
		out.push(
			mk({
				id: "a-parity",
				group: "a-wait",
				theme: "playoffs",
				score: 0.35,
				kicker: "How many champions",
				heads: [
					`${distinct} different teams have won the title`,
					`${distinct} of ${teams} teams have a ring`,
				],
				hero: {
					text: `${distinct}`,
					unit: `champions in ${champs.length} seasons`,
				},
				lines: [
					distinct * 2 >= champs.length
						? "The title has been spread around"
						: "A few teams have kept it to themselves",
				],
			}),
		);
	}
	return out;
};

const eras: Topic = ({ X }) => {
	const ts = decidedTeamSeasons(X);
	if (ts.length < 20) {
		return null;
	}
	const out: Slide[] = [];
	const elite = tally(ts.filter((t) => wpOf(t) >= 0.73).map((t) => t.tid));
	if (elite[0]) {
		out.push(
			mk({
				id: "a-elite-seasons",
				group: "a-franchise",
				theme: "team",
				score: Math.min(0.6, 0.25 + elite[0][1] * 0.1),
				kicker: "Elite seasons",
				tid: elite[0][0],
				heads: [
					`${plural(elite[0][1], "season")} with a .730 record or better for the ${tname(X, elite[0][0])}`,
					`The ${tname(X, elite[0][0])} made excellence routine`,
				],
				hero: { text: `${elite[0][1]}`, unit: "elite seasons" },
				list: elite
					.slice(1, 4)
					.map(([t, n]) => ({ name: tname(X, t), value: `${n}`, tid: t })),
			}),
		);
	}
	// Best five-year stretch
	let best:
		| { tid: number; from: number; p: number; w: number; l: number }
		| undefined;
	for (const tid of new Set(ts.map((t) => t.tid))) {
		const h = X.teamHistory(tid).filter((t) => X.decided(t.season));
		for (let i = 0; i + 4 < h.length; i++) {
			const w = h.slice(i, i + 5).reduce((a, t) => a + t.won, 0);
			const l = h.slice(i, i + 5).reduce((a, t) => a + t.lost, 0);
			const p = winPct(w, l);
			if (!best || p > best.p) {
				best = { tid, from: h[i]!.season, p, w, l };
			}
		}
	}
	if (best) {
		out.push(
			mk({
				id: "a-decade-team",
				group: "a-era",
				theme: "team",
				score: 0.55,
				kicker: "The best five-year run",
				tid: best.tid,
				season: best.from + 4,
				heads: [
					`${best.from}–${best.from + 4}: ${best.w}-${best.l} for the ${tname(X, best.tid)}`,
					`The ${tname(X, best.tid)} ruled five seasons`,
				],
				hero: { text: pct(best.p, 1), unit: "win pct over five years" },
				lines: [
					`${X.titlesOf(best.tid).filter((s) => s >= best!.from && s <= best!.from + 4).length} titles in that span`,
				],
			}),
		);
	}
	return out;
};

const identity: Topic = ({ X }) => {
	const ids = [...new Set(X.L.teamSeasons.map((t) => t.tid))];
	const out: Slide[] = [];
	const renamed = ids
		.map((tid) => {
			const h = X.teamHistory(tid);
			let changes = 0;
			for (let i = 1; i < h.length; i++) {
				if (
					h[i]!.region !== h[i - 1]!.region ||
					h[i]!.name !== h[i - 1]!.name
				) {
					changes += 1;
				}
			}
			return { tid, changes, first: h[0], last: h.at(-1) };
		})
		.filter((x) => x.changes > 0 && x.first && x.last)
		.sort((a, b) => b.changes - a.changes);
	if (renamed[0]) {
		const r = renamed[0];
		out.push(
			mk({
				id: "a-names",
				group: "a-identity",
				theme: "history",
				score: Math.min(0.55, 0.25 + renamed.length * 0.05),
				kicker: "New name, same franchise",
				tid: r.tid,
				heads: [
					`${plural(renamed.length, "franchise")} changed identity`,
					`${r.first!.region} ${r.first!.name} became ${r.last!.region} ${r.last!.name}`,
				],
				hero: {
					text: `${renamed.length}`,
					unit: "franchises with a new identity",
				},
				lines: [
					`${r.first!.region} ${r.first!.name} (${r.first!.season}) became ${r.last!.region} ${r.last!.name}`,
				],
			}),
		);
	}
	const exp = ids
		.map((tid) => ({ tid, first: X.teamHistory(tid)[0]! }))
		.filter((x) => x.first.season > X.L.startingSeason)
		.sort((a, b) => a.first.season - b.first.season);
	if (exp.length > 0) {
		const e = exp[0]!;
		out.push(
			mk({
				id: "a-expansion",
				group: "a-identity",
				theme: "history",
				score: 0.4,
				kicker: "Expansion",
				tid: e.tid,
				season: e.first.season,
				heads: [
					`${plural(exp.length, "team")} joined after the start`,
					`The ${e.first.region} ${e.first.name} arrived in ${e.first.season}`,
				],
				hero: {
					text: `${exp.length}`,
					unit: exp.length === 1 ? "expansion team" : "expansion teams",
				},
				list: exp
					.slice(0, 4)
					.map((x) => ({
						name: `${x.first.region} ${x.first.name}`,
						value: `${x.first.season}`,
						sub: `${x.first.won}-${x.first.lost} in year one`,
						tid: x.tid,
					})),
			}),
		);
	}
	return out;
};

const homeCourt: Topic = ({ X }) => {
	const ts = decidedTeamSeasons(X).filter(
		(t) => isNum(t.wonHome) && isNum(t.lostHome),
	);
	if (ts.length < 20) {
		return null;
	}
	const hw = ts.reduce((a, t) => a + t.wonHome!, 0);
	const hl = ts.reduce((a, t) => a + t.lostHome!, 0);
	if (hw + hl < 500) {
		return null;
	}
	const bestHome = [...ts]
		.filter((t) => t.wonHome! + t.lostHome! >= 10)
		.sort(
			(a, b) =>
				b.wonHome! / (b.wonHome! + b.lostHome!) -
					a.wonHome! / (a.wonHome! + a.lostHome!) || b.wonHome! - a.wonHome!,
		)[0]!;
	return mk({
		id: "a-home-court",
		group: "a-home",
		theme: "schedule",
		score: 0.45,
		kicker: "Home-court advantage",
		tid: bestHome.tid,
		season: bestHome.season,
		heads: [
			`Home teams have won ${pct(hw / (hw + hl), 1)} of all games`,
			`Home cooking: ${pct(hw / (hw + hl), 1)} for the home side`,
		],
		hero: { text: pct(hw / (hw + hl), 1), unit: "home win pct, all-time" },
		lines: [
			`Best home record: ${bestHome.wonHome}-${bestHome.lostHome}, ${tname(X, bestHome.tid)}, ${bestHome.season}`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Careers and people
// ---------------------------------------------------------------------------------------------

const careerRows = (X: X) => careers(X);

const oneTeam: Topic = ({ X }) => {
	const rows = careerRows(X)
		.filter((x) => x.c.gp >= 300)
		.map((x) => {
			const rs = X.careerRows(x.p);
			const tids = new Set(rs.map((r) => r.tid));
			return {
				...x,
				tids,
				seasons: new Set(rs.map((r) => r.season)).size,
				tid: rs.at(-1)!.tid,
			};
		});
	const one = rows
		.filter((x) => x.tids.size === 1 && x.seasons >= 6)
		.sort((a, b) => b.seasons - a.seasons || b.c.ws - a.c.ws);
	if (one.length === 0) {
		return null;
	}
	const top = one[0]!;
	return mk({
		id: "a-one-team",
		group: "a-loyal",
		theme: "history",
		score: Math.min(0.7, 0.3 + top.seasons * 0.03),
		kicker: "One-team players",
		pid: top.p.pid,
		tid: top.tid,
		heads: [
			`${top.p.name} spent all ${top.seasons} seasons with the ${tname(X, top.tid)}`,
			`${plural(one.length, "player")} never left their team`,
		],
		hero: { text: `${top.seasons}`, unit: "seasons, one team" },
		list: one
			.slice(1, 5)
			.map((x) => ({
				name: x.p.name,
				value: plural(x.seasons, "season"),
				pid: x.p.pid,
			})),
		lines: [
			`${plural(one.length, "player")} with 6+ seasons, all for one franchise`,
		],
	});
};

const ringless: Topic = ({ X }) => {
	const rows = careerRows(X)
		.filter((x) => x.c.gp >= 300 && X.decidedSeasons().length >= 5)
		.map((x) => ({ ...x, rings: X.countAwards(x.p, "Won Championship") }));
	const ringless = rows
		.filter((x) => x.rings === 0)
		.sort((a, b) => b.c.ws - a.c.ws);
	const top = ringless[0];
	if (!top || top.c.ws < 20) {
		return null;
	}
	return mk({
		id: "a-ringless",
		group: "a-rings",
		theme: "awards",
		score: 0.5,
		kicker: "Best without a ring",
		pid: top.p.pid,
		heads: [
			`${top.p.name} produced ${fmtNum(top.c.ws, 1)} win shares and has no ring`,
			`The best career without a title`,
		],
		hero: { text: fmtNum(top.c.ws, 1), unit: "win shares, zero rings" },
		list: ringless
			.slice(1, 4)
			.map((x) => ({
				name: x.p.name,
				value: `${fmtNum(x.c.ws, 1)} WS`,
				pid: x.p.pid,
			})),
	});
};

const mvpClub: Topic = ({ X }) => {
	const rows = X.L.players
		.map((p) => ({ p, n: X.countAwards(p, "Most Valuable Player") }))
		.filter((x) => x.n >= 2)
		.sort((a, b) => b.n - a.n);
	const out: Slide[] = [];
	if (rows.length > 0) {
		out.push(
			mk({
				id: "a-mvp-club",
				group: "a-mvpfr",
				theme: "awards",
				score: Math.min(0.65, 0.3 + rows.length * 0.04),
				kicker: "The multiple-MVP club",
				pid: rows[0]!.p.pid,
				heads: [
					`${plural(rows.length, "player")} have won MVP more than once`,
					`${rows[0]!.p.name}: ${plural(rows[0]!.n, "MVP")}`,
				],
				list: rows
					.slice(0, 5)
					.map((x) => ({
						name: x.p.name,
						value: plural(x.n, "MVP"),
						pid: x.p.pid,
					})),
			}),
		);
	}
	// MVP winners by franchise
	const byTeam = tally(
		X.decidedSeasons()
			.map((s) => {
				const w = X.awardWinner(s, "Most Valuable Player");
				return w ? X.line(w.pid, s)?.tid : undefined;
			})
			.filter(isNum),
	);
	if (byTeam[0] && byTeam[0][1] >= 3) {
		out.push(
			mk({
				id: "a-mvp-teams",
				group: "a-mvpfr",
				theme: "awards",
				score: Math.min(0.55, 0.25 + byTeam[0][1] * 0.05),
				kicker: "MVP factory",
				tid: byTeam[0][0],
				heads: [
					`${plural(byTeam[0][1], "MVP")} have played for the ${tname(X, byTeam[0][0])}`,
					`The ${tname(X, byTeam[0][0])} grow MVPs`,
				],
				hero: { text: `${byTeam[0][1]}`, unit: "MVP seasons" },
				list: byTeam
					.slice(1, 4)
					.map(([t, n]) => ({ name: tname(X, t), value: `${n}`, tid: t })),
			}),
		);
	}
	// Rookies of the year who became MVPs
	const roy = X.L.players.filter(
		(p) =>
			X.countAwards(p, "Rookie of the Year") > 0 &&
			X.countAwards(p, "Most Valuable Player") > 0,
	);
	if (roy.length > 0) {
		out.push(
			mk({
				id: "a-roy-mvp",
				group: "a-late",
				theme: "awards",
				score: Math.min(0.6, 0.35 + roy.length * 0.05),
				kicker: "From rookie to MVP",
				pid: roy[0]!.pid,
				heads: [
					`${plural(roy.length, "Rookie of the Year")} later won MVP`,
					`${roy[0]!.name} did both`,
				],
				list: roy
					.slice(0, 4)
					.map((p) => ({
						name: p.name,
						value: plural(X.countAwards(p, "Most Valuable Player"), "MVP"),
						pid: p.pid,
					})),
			}),
		);
	}
	return out;
};

const allStarFacts: Topic = ({ X }) => {
	const out: Slide[] = [];
	const rows = X.L.players
		.map((p) => ({
			p,
			n: p.awards.filter((a) => a.type === "All-Star").length,
		}))
		.filter((x) => x.n >= 3)
		.sort((a, b) => b.n - a.n);
	if (rows[0]) {
		out.push(
			mk({
				id: "a-allstar-games",
				group: "a-honors4",
				theme: "awards",
				score: 0.45,
				kicker: "All-Star regulars",
				pid: rows[0].p.pid,
				heads: [
					`${rows[0].p.name} has ${rows[0].n} All-Star selections`,
					`The league’s ultimate All-Star: ${rows[0].p.name}`,
				],
				hero: { text: `${rows[0].n}`, unit: "All-Star games" },
				list: rows
					.slice(1, 5)
					.map((x) => ({ name: x.p.name, value: `${x.n}`, pid: x.p.pid })),
			}),
		);
	}
	// Oldest first-time All-Star
	let late: { p: WPlayer; age: number; season: number } | undefined;
	for (const p of X.L.players) {
		const first = p.awards
			.filter((a) => a.type === "All-Star")
			.sort((a, b) => a.season - b.season)[0];
		if (first && p.stats[0] && p.stats[0].season > X.L.startingSeason) {
			const age = first.season - p.bornYear;
			if (!late || age > late.age) {
				late = { p, age, season: first.season };
			}
		}
	}
	if (late && late.age >= 27) {
		out.push(
			mk({
				id: "a-late-allstar",
				group: "a-late",
				theme: "awards",
				score: Math.min(0.55, 0.2 + (late.age - 26) * 0.05),
				kicker: "Late bloomer",
				pid: late.p.pid,
				season: late.season,
				heads: [
					`${late.p.name} made his first All-Star team at ${late.age}`,
					`Better late than never: ${late.p.name}`,
				],
				hero: { text: `${late.age}`, unit: "years old, first All-Star team" },
				lines: [`In ${late.season}`],
			}),
		);
	}
	// Finals MVPs
	const fm = X.L.players
		.map((p) => ({ p, n: X.countAwards(p, "Finals MVP") }))
		.filter((x) => x.n >= 2)
		.sort((a, b) => b.n - a.n);
	if (fm[0]) {
		out.push(
			mk({
				id: "a-fmvp",
				group: "a-honors4",
				theme: "awards",
				score: Math.min(0.6, 0.3 + fm[0].n * 0.08),
				kicker: "Mr. Finals",
				pid: fm[0].p.pid,
				heads: [
					`${fm[0].p.name} won Finals MVP ${fm[0].n} times`,
					`The finals were his stage`,
				],
				hero: { text: `${fm[0].n}`, unit: "Finals MVPs" },
				list: fm
					.slice(1, 4)
					.map((x) => ({ name: x.p.name, value: `${x.n}`, pid: x.p.pid })),
			}),
		);
	}
	return out;
};

const ages: Topic = ({ X }) => {
	const out: Slide[] = [];
	let oldest:
		| { name: string; pid: number; age: number; season: number; tid: number }
		| undefined;
	let youngest: typeof oldest;
	for (const s of X.seasons) {
		for (const l of X.lines(s)) {
			if (l.gp < 5) {
				continue;
			}
			if (!oldest || l.age > oldest.age) {
				oldest = {
					name: l.name,
					pid: l.pid,
					age: l.age,
					season: s,
					tid: l.tid,
				};
			}
			const p = X.players.get(l.pid)!;
			if (
				p.stats[0]!.season > X.L.startingSeason &&
				(!youngest || l.age < youngest.age)
			) {
				youngest = {
					name: l.name,
					pid: l.pid,
					age: l.age,
					season: s,
					tid: l.tid,
				};
			}
		}
	}
	if (oldest && oldest.age >= 36) {
		out.push(
			mk({
				id: "a-oldest",
				group: "a-age",
				theme: "people",
				score: Math.min(0.6, 0.25 + (oldest.age - 35) * 0.06),
				kicker: "Still going",
				pid: oldest.pid,
				tid: oldest.tid,
				season: oldest.season,
				heads: [
					`${oldest.name} played at ${oldest.age}`,
					`The oldest player in league history: ${oldest.name}`,
				],
				hero: { text: `${oldest.age}`, unit: "years old" },
				lines: [
					`In ${oldest.season} for the ${nameAt(X, oldest.tid, oldest.season)}`,
				],
			}),
		);
	}
	if (youngest && youngest.age <= 19) {
		out.push(
			mk({
				id: "a-rookie",
				group: "a-age",
				theme: "people",
				score: Math.min(0.55, 0.25 + (20 - youngest.age) * 0.08),
				kicker: "The youngest ever",
				pid: youngest.pid,
				tid: youngest.tid,
				season: youngest.season,
				heads: [
					`${youngest.name} played at ${youngest.age}`,
					`The youngest player in league history: ${youngest.name}`,
				],
				hero: { text: `${youngest.age}`, unit: "years old" },
				lines: [`In ${youngest.season}`],
			}),
		);
	}
	return out;
};

const farewell: Topic = ({ X }) => {
	const rows = careerRows(X)
		.filter(
			(x) =>
				x.p.retiredYear < Infinity &&
				x.p.retiredYear <= X.L.season &&
				x.c.gp >= 200,
		)
		.sort((a, b) => b.c.ws - a.c.ws);
	const top = rows[0];
	if (!top) {
		return null;
	}
	const last = X.careerRows(top.p).at(-1)!;
	const yrs = new Set(X.careerRows(top.p).map((r) => r.season)).size;
	return mk({
		id: "a-farewell",
		group: "a-farewell",
		theme: "history",
		score: 0.5,
		kicker: "The greatest to retire",
		pid: top.p.pid,
		tid: last.tid,
		heads: [
			`${top.p.name} retired as the best to leave the game`,
			`Farewell, ${top.p.name}`,
		],
		hero: { text: fmtNum(top.c.ws, 1), unit: "career win shares" },
		list: rows
			.slice(1, 4)
			.map((x) => ({
				name: x.p.name,
				value: `${fmtNum(x.c.ws, 1)} WS`,
				pid: x.p.pid,
			})),
		lines: [`${plural(yrs, "season")}, retired in ${top.p.retiredYear}`],
	});
};

const peaks: Topic = ({ X }) => {
	const out: Slide[] = [];
	const rows = careerRows(X).filter((x) => x.c.gp >= 100);
	// Best three-year stretch by win shares
	let best: { p: WPlayer; ws: number; from: number } | undefined;
	for (const { p } of rows) {
		const seasons = [...new Set(X.careerRows(p).map((r) => r.season))].sort(
			(a, b) => a - b,
		);
		for (let i = 0; i + 2 < seasons.length; i++) {
			if (seasons[i + 2]! - seasons[i]! !== 2) {
				continue;
			}
			const ws = X.careerRows(p)
				.filter((r) => r.season >= seasons[i]! && r.season <= seasons[i + 2]!)
				.reduce((a, r) => a + r.ws, 0);
			if (!best || ws > best.ws) {
				best = { p, ws, from: seasons[i]! };
			}
		}
	}
	if (best) {
		out.push(
			mk({
				id: "a-peak3",
				group: "a-goat",
				theme: "efficiency",
				score: 0.55,
				kicker: "The best three-year peak",
				pid: best.p.pid,
				heads: [
					`${best.p.name}: ${fmtNum(best.ws, 1)} win shares in three years`,
					`Nobody peaked higher than ${best.p.name}`,
				],
				hero: {
					text: fmtNum(best.ws, 1),
					unit: `win shares, ${best.from}–${best.from + 2}`,
				},
				lines: [],
			}),
		);
	}
	// Per-minute leaders
	const minThreshold = Math.max(...rows.map((x) => x.c.min)) * 0.25;
	const rate = rows
		.filter((x) => x.c.min >= minThreshold)
		.map((x) => ({ ...x, r: (x.c.ws / x.c.min) * 48 }))
		.sort((a, b) => b.r - a.r);
	if (rate[0] && rate.length >= 5) {
		out.push(
			mk({
				id: "a-goat-rate",
				group: "a-goat",
				theme: "efficiency",
				score: 0.5,
				kicker: "The most efficient career",
				pid: rate[0].p.pid,
				heads: [
					`${rate[0].p.name} added wins faster than anyone in history`,
					`The best win shares per 48 minutes ever`,
				],
				hero: {
					text: fmtNum(rate[0].r, 3).replace(/^0/, ""),
					unit: "win shares per 48",
				},
				list: rate
					.slice(1, 4)
					.map((x) => ({
						name: x.p.name,
						value: fmtNum(x.r, 3).replace(/^0/, ""),
						pid: x.p.pid,
					})),
				note: "Win shares per 48 minutes: wins added per 48 minutes played (.100 is average)",
			}),
		);
	}
	// Playoff leaders
	const po = X.L.players
		.map((p) => ({
			p,
			pts: p.po.reduce((a, r) => a + r.pts, 0),
			gp: p.po.reduce((a, r) => a + r.gp, 0),
		}))
		.filter((x) => x.gp >= 30)
		.sort((a, b) => b.pts - a.pts);
	if (po.length >= 5) {
		const t = po[0]!;
		out.push(
			mk({
				id: "a-goat-playoffs",
				group: "a-goat",
				theme: "playoffs",
				score: 0.5,
				kicker: "Playoff scoring king",
				pid: t.p.pid,
				heads: [
					`${t.p.name} has scored ${fmtNum(t.pts)} playoff points`,
					`Nobody has scored more in the playoffs than ${t.p.name}`,
				],
				hero: { text: fmtNum(t.pts), unit: "playoff points" },
				list: po
					.slice(1, 4)
					.map((x) => ({ name: x.p.name, value: fmtNum(x.pts), pid: x.p.pid })),
				lines: [
					`${plural(t.gp, "playoff game")}, ${fmtNum(t.pts / t.gp, 1)} a night`,
				],
			}),
		);
	}
	return out;
};

const clubs: Topic = ({ X }) => {
	const rows = careerRows(X);
	const out: Slide[] = [];
	for (const [k, mark, noun, id] of [
		["pts", 20000, "points", "a-20k"],
		["ast", 5000, "assists", "a-5k-ast"],
		["trb", 7500, "rebounds", "a-7k-reb"],
	] as const) {
		const mem = rows
			.filter((x) => x.c[k] >= mark)
			.sort((a, b) => b.c[k] - a.c[k]);
		if (mem.length === 0) {
			continue;
		}
		out.push(
			mk({
				id,
				group: "a-clubs",
				theme: "history",
				score: Math.min(0.55, 0.25 + mem.length * 0.04),
				kicker: `${fmtNum(mark)}-${noun.replace(/s$/, "")} club`,
				pid: mem[0]!.p.pid,
				heads: [
					`${plural(mem.length, "player")} have reached ${fmtNum(mark)} ${noun}`,
					`The ${fmtNum(mark)}-${noun.replace(/s$/, "")} club`,
				],
				hero: {
					text: `${mem.length}`,
					unit: `players with ${fmtNum(mark)}+ ${noun}`,
				},
				list: mem
					.slice(0, 4)
					.map((x) => ({
						name: x.p.name,
						value: fmtNum(x.c[k]),
						pid: x.p.pid,
					})),
			}),
		);
	}
	return out;
};

const marathon: Topic = ({ X }) => {
	const rows = careerRows(X).sort((a, b) => b.c.gp - a.c.gp);
	const top = rows[0];
	if (!top || top.c.gp < 500) {
		return null;
	}
	const seasons = new Set(X.careerRows(top.p).map((r) => r.season)).size;
	return mk({
		id: "a-marathon",
		group: "a-longevity2",
		theme: "history",
		score: 0.4,
		kicker: "The marathon man",
		pid: top.p.pid,
		heads: [
			`${top.p.name} has played ${fmtNum(top.c.gp)} games`,
			`Nobody has played more than ${top.p.name}`,
		],
		hero: { text: fmtNum(top.c.gp), unit: "games played" },
		list: rows
			.slice(1, 4)
			.map((x) => ({ name: x.p.name, value: fmtNum(x.c.gp), pid: x.p.pid })),
		lines: [`${plural(seasons, "season")}, ${fmtNum(top.c.min)} minutes`],
	});
};

const seasonRecords: Topic = ({ X }) => {
	const q = X.allQualified().filter((l) => X.decided(l.season));
	if (q.length < 50) {
		return null;
	}
	const cats = [
		["ppg", "points", 1],
		["rpg", "rebounds", 1],
		["apg", "assists", 1],
		["spg", "steals", 1],
		["bpg", "blocks", 1],
		["tpg", "threes", 1],
	] as const;
	const list = cats.map(([k, noun, d]) => {
		const t = q.reduce((a, b) => (b[k] > a[k] ? b : a));
		return { noun, t, d, v: t[k] };
	});
	return mk({
		id: "a-season-records",
		group: "a-records",
		theme: "history",
		score: 0.5,
		kicker: "Single-season records",
		pid: list[0]!.t.pid,
		tid: list[0]!.t.tid,
		season: list[0]!.t.season,
		heads: [
			`The single-season records for per-game stats`,
			`The best per-game seasons ever`,
		],
		list: list.map((x) => ({
			name: `${x.noun[0]!.toUpperCase()}${x.noun.slice(1)} per game: ${x.t.name}`,
			value: fmtNum(x.v, x.d),
			sub: `${x.t.season}`,
			pid: x.t.pid,
		})),
	});
};

const mostTraded: Topic = ({ X }) => {
	const rows = X.L.players
		.map((p) => ({ p, n: p.moves.filter((m) => m.type === "trade").length }))
		.filter((x) => x.n >= 2)
		.sort((a, b) => b.n - a.n);
	if (!rows[0] || rows[0].n < 3) {
		return null;
	}
	const t = rows[0];
	return mk({
		id: "a-most-traded",
		group: "a-trades",
		theme: "moves",
		score: Math.min(0.55, 0.25 + t.n * 0.06),
		kicker: "Always on the block",
		pid: t.p.pid,
		heads: [
			`${t.p.name} was traded ${t.n} times`,
			`The most-traded player in league history`,
		],
		hero: { text: `${t.n}`, unit: "trades" },
		list: rows
			.slice(1, 4)
			.map((x) => ({
				name: x.p.name,
				value: plural(x.n, "trade"),
				pid: x.p.pid,
			})),
	});
};

const roots: Topic = ({ X }) => {
	const out: Slide[] = [];
	const all = careerRows(X);
	const colleges = tally(all.map((x) => x.p.college).filter(Boolean));
	if (colleges.length >= 5 && colleges[0]![1] >= 5) {
		out.push(
			mk({
				id: "a-college",
				group: "a-roots",
				theme: "people",
				score: 0.3,
				kicker: "The college pipeline",
				heads: [
					`${colleges[0]![0]} has sent ${colleges[0]![1]} players to the league`,
					`${colleges[0]![0]}: the top feeder school`,
				],
				hero: {
					text: `${colleges[0]![1]}`,
					unit: `players from ${colleges[0]![0]}`,
				},
				list: colleges
					.slice(1, 5)
					.map(([c, n]) => ({ name: c, value: plural(n, "player") })),
			}),
		);
	}
	const places = tally(all.map((x) => x.p.bornLoc).filter(Boolean));
	if (places.length >= 5) {
		out.push(
			mk({
				id: "a-birthplace",
				group: "a-roots",
				theme: "people",
				score: 0.3,
				kicker: "Where they come from",
				heads: [
					`Players have come from ${places.length} different places`,
					`${places[0]![0]} leads the way with ${places[0]![1]} players`,
				],
				hero: { text: `${places.length}`, unit: "birthplaces" },
				list: places
					.slice(0, 5)
					.map(([c, n]) => ({ name: c, value: plural(n, "player") })),
			}),
		);
	}
	// Families
	const fam = all.filter((x) =>
		x.p.relatives.some(
			(r) =>
				X.players.get(r.pid) && X.careerRows(X.players.get(r.pid)!).length > 0,
		),
	);
	if (fam.length >= 2) {
		const best = [...fam].sort((a, b) => b.c.ws - a.c.ws)[0]!;
		const rel = best.p.relatives.find(
			(r) =>
				X.players.get(r.pid) && X.careerRows(X.players.get(r.pid)!).length > 0,
		)!;
		out.push(
			mk({
				id: "a-family",
				group: "a-roots",
				theme: "people",
				score: 0.4,
				kicker: "Family business",
				pid: best.p.pid,
				heads: [
					`${plural(fam.length, "player")} have a relative who also played`,
					`${best.p.name} and his ${rel.type}, ${X.players.get(rel.pid)!.name}`,
				],
				hero: {
					text: `${fam.length}`,
					unit: "players with family in the league",
				},
				lines: [],
			}),
		);
	}
	return out;
};

const draftHistory: Topic = ({ X }) => {
	const decided = X.decidedSeasons();
	if (decided.length < 6) {
		return null;
	}
	const classes = new Map<
		number,
		{ ws: number; n: number; top?: { p: WPlayer; ws: number } }
	>();
	for (const p of X.L.players) {
		if (
			p.draft.round < 1 ||
			p.draft.year < X.seasons[0]! ||
			p.draft.year > X.L.season - 3
		) {
			continue;
		}
		const ws = X.career(p).ws;
		const c = classes.get(p.draft.year) ?? { ws: 0, n: 0 };
		c.ws += ws;
		c.n += 1;
		if (!c.top || ws > c.top.ws) {
			c.top = { p, ws };
		}
		classes.set(p.draft.year, c);
	}
	const list = [...classes.entries()]
		.filter(([, c]) => c.n >= 20)
		.sort((a, b) => b[1].ws - a[1].ws);
	const out: Slide[] = [];
	if (list.length >= 4) {
		const [y, c] = list[0]!;
		out.push(
			mk({
				id: "a-draft-deep",
				group: "a-draft",
				theme: "draft",
				score: 0.55,
				kicker: "The best draft class",
				pid: c.top?.p.pid,
				heads: [
					`The ${y} draft class is the best ever: ${fmtNum(c.ws, 0)} career win shares`,
					`Class of ${y}`,
				],
				hero: { text: fmtNum(c.ws, 0), unit: "win shares from the class" },
				lines: [
					c.top ? `Led by ${c.top.p.name}, ${fmtNum(c.top.ws, 1)} WS` : null,
				],
			}),
		);
		const [y2, c2] = list.at(-1)!;
		out.push(
			mk({
				id: "a-draft-thin",
				group: "a-draft",
				theme: "draft",
				score: 0.4,
				kicker: "The thinnest class",
				pid: c2.top?.p.pid,
				heads: [
					`The ${y2} class produced just ${fmtNum(c2.ws, 0)} win shares`,
					`Class of ${y2}: slim pickings`,
				],
				hero: { text: fmtNum(c2.ws, 0), unit: "win shares from the class" },
				lines: [
					c2.top
						? `The best of them: ${c2.top.p.name}, ${fmtNum(c2.top.ws, 1)} WS`
						: null,
				],
			}),
		);
	}
	// Number one picks
	const no1 = X.L.players
		.filter(
			(p) =>
				p.draft.round === 1 &&
				p.draft.pick === 1 &&
				p.draft.year >= X.seasons[0]! &&
				p.draft.year <= X.L.season - 2,
		)
		.map((p) => ({ p, ws: X.career(p).ws }))
		.sort((a, b) => b.ws - a.ws);
	if (no1.length >= 4) {
		out.push(
			mk({
				id: "a-no1",
				group: "a-draft2",
				theme: "draft",
				score: 0.45,
				kicker: "The No. 1 picks",
				pid: no1[0]!.p.pid,
				heads: [
					`${no1[0]!.p.name} is the best No. 1 pick in history`,
					`${no1.at(-1)!.p.name} is the worst`,
				],
				list: [no1[0]!, no1[1]!, no1.at(-1)!].map((x) => ({
					name: `${x.p.name} (${x.p.draft.year})`,
					value: `${fmtNum(x.ws, 1)} WS`,
					pid: x.p.pid,
				})),
				lines: [
					`${no1.filter((x) => x.ws > 0).length} of ${no1.length} No. 1 picks added value`,
				],
			}),
		);
	}
	// Best undrafted
	const und = careerRows(X)
		.filter((x) => x.p.draft.round < 1 && x.c.gp >= 100)
		.sort((a, b) => b.c.ws - a.c.ws);
	if (und[0] && und[0].c.ws > 5) {
		out.push(
			mk({
				id: "a-undrafted",
				group: "a-draft3",
				theme: "draft",
				score: 0.45,
				kicker: "Undrafted, unstoppable",
				pid: und[0].p.pid,
				heads: [
					`${und[0].p.name} was never drafted and produced ${fmtNum(und[0].c.ws, 1)} win shares`,
					`The best undrafted player in league history`,
				],
				hero: { text: fmtNum(und[0].c.ws, 1), unit: "win shares" },
				list: und
					.slice(1, 4)
					.map((x) => ({
						name: x.p.name,
						value: `${fmtNum(x.c.ws, 1)} WS`,
						pid: x.p.pid,
					})),
			}),
		);
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// Money and health
// ---------------------------------------------------------------------------------------------

const earningsAll: Topic = ({ X }) => {
	const rows = X.L.players
		.map((p) => ({
			p,
			v: (p.paid ?? [])
				.filter((x) => X.decided(x.season) || x.season < X.L.season)
				.reduce((a, x) => a + x.amount, 0),
		}))
		.filter((x) => x.v > 0)
		.sort((a, b) => b.v - a.v);
	if (rows.length < 20) {
		return null;
	}
	const out: Slide[] = [
		mk({
			id: "a-earnings",
			group: "a-money",
			theme: "money",
			score: 0.5,
			kicker: "Career earnings",
			pid: rows[0]!.p.pid,
			heads: [
				`${rows[0]!.p.name} has earned ${money(rows[0]!.v)} in salary`,
				`The highest-paid career: ${rows[0]!.p.name}`,
			],
			hero: { text: money(rows[0]!.v), unit: "career earnings" },
			list: rows
				.slice(1, 5)
				.map((x) => ({ name: x.p.name, value: money(x.v), pid: x.p.pid })),
		}),
	];
	// Payroll over time
	const avg = X.seasons
		.filter((s) => X.decided(s))
		.map((s) => {
			const ts = X.teamsIn(s).filter((t) => isNum(t.payroll) && t.payroll > 0);
			return ts.length >= 6
				? { s, v: ts.reduce((a, t) => a + t.payroll!, 0) / ts.length }
				: undefined;
		})
		.filter((x): x is { s: number; v: number } => x !== undefined);
	if (avg.length >= 6 && Math.abs(avg.at(-1)!.v / avg[0]!.v - 1) > 0.15) {
		const up = avg.at(-1)!.v > avg[0]!.v;
		out.push(
			mk({
				id: "a-salary-era",
				group: "a-money",
				theme: "money",
				score: 0.4,
				kicker: "The payroll era",
				heads: [
					up
						? `The average payroll grew from ${money(avg[0]!.v)} to ${money(avg.at(-1)!.v)}`
						: `Average payrolls shrank from ${money(avg[0]!.v)} to ${money(avg.at(-1)!.v)}`,
					`Salaries over the seasons`,
				],
				hero: {
					text: `${up ? "+" : ""}${fmtNum((avg.at(-1)!.v / avg[0]!.v - 1) * 100, 0)}%`,
					unit: `${span(avg[0]!.s, avg.at(-1)!.s)}`,
				},
				lines: [],
			}),
		);
	}
	return out;
};

const injuriesAll: Topic = ({ X }) => {
	const rows = X.L.players
		.map((p) => ({
			p,
			g: p.injuries.reduce((a, i) => a + i.games, 0),
			n: p.injuries.length,
		}))
		.filter((x) => x.g > 0)
		.sort((a, b) => b.g - a.g);
	if (rows.length < 20) {
		return null;
	}
	const out: Slide[] = [];
	out.push(
		mk({
			id: "a-injury",
			group: "a-health",
			theme: "people",
			score: 0.4,
			kicker: "The most injured",
			pid: rows[0]!.p.pid,
			heads: [
				`${rows[0]!.p.name} has missed ${fmtNum(rows[0]!.g)} games to injury`,
				`The longest injury list: ${rows[0]!.p.name}`,
			],
			hero: { text: fmtNum(rows[0]!.g), unit: "games lost to injury" },
			list: rows
				.slice(1, 4)
				.map((x) => ({
					name: x.p.name,
					value: `${fmtNum(x.g)} games`,
					pid: x.p.pid,
				})),
			lines: [`${plural(rows[0]!.n, "separate injury", "separate injuries")}`],
		}),
	);
	const types = tally(
		X.L.players.flatMap((p) => p.injuries.map((i) => i.type)),
	);
	if (types.length >= 3) {
		out.push(
			mk({
				id: "a-injury-types",
				group: "a-health",
				theme: "people",
				score: 0.3,
				kicker: "Common injuries",
				heads: [
					`${types[0]![0]} is the most common injury`,
					`${fmtNum(types.reduce((a, t) => a + t[1], 0))} injuries so far`,
				],
				list: types
					.slice(0, 5)
					.map(([t, n]) => ({ name: t, value: fmtNum(n) })),
			}),
		);
	}
	return out;
};

const decadeLeaders: Topic = ({ X }) => {
	const seasons = X.decidedSeasons();
	if (seasons.length < 10) {
		return null;
	}
	const first = seasons[0]!;
	const out: { from: number; to: number; p: WPlayer; pts: number }[] = [];
	for (let start = first; start + 4 <= seasons.at(-1)!; start += 5) {
		let best: { p: WPlayer; pts: number } | undefined;
		for (const p of X.L.players) {
			const pts = X.careerRows(p)
				.filter((r) => r.season >= start && r.season < start + 5)
				.reduce((a, r) => a + r.pts, 0);
			if (pts > 0 && (!best || pts > best.pts)) {
				best = { p, pts };
			}
		}
		if (best) {
			out.push({ from: start, to: start + 4, ...best });
		}
	}
	if (out.length < 2) {
		return null;
	}
	return mk({
		id: "a-scorers-decade",
		group: "a-era4",
		theme: "scoring",
		score: 0.45,
		kicker: "Scoring kings by era",
		pid: out.at(-1)!.p.pid,
		heads: [
			`${out.at(-1)!.p.name} scored the most from ${out.at(-1)!.from} to ${out.at(-1)!.to}`,
			`Five years at a time: the top scorers`,
		],
		list: out.map((o) => ({
			name: `${o.from}–${o.to}: ${o.p.name}`,
			value: `${fmtNum(o.pts)} pts`,
			pid: o.p.pid,
		})),
	});
};

const winStreak: Topic = ({ X }) => {
	let best: { tid: number; n: number; to: number } | undefined;
	for (const tid of new Set(X.L.teamSeasons.map((t) => t.tid))) {
		let run = 0;
		for (const t of X.teamHistory(tid)) {
			if (!X.decided(t.season) || t.won + t.lost < 10) {
				continue;
			}
			run = wpOf(t) > 0.5 ? run + 1 : 0;
			if (!best || run > best.n) {
				best = { tid, n: run, to: t.season };
			}
		}
	}
	if (!best || best.n < 5) {
		return null;
	}
	return mk({
		id: "a-winseasons",
		group: "a-streaks2",
		theme: "team",
		score: Math.min(0.55, 0.2 + best.n * 0.03),
		kicker: "Never a losing year",
		tid: best.tid,
		season: best.to,
		heads: [
			`${best.n} straight winning seasons for the ${tname(X, best.tid)}`,
			`${tname(X, best.tid)}: ${best.n} years above .500`,
		],
		hero: { text: `${best.n}`, unit: "winning seasons in a row" },
		lines: [`Through ${best.to}`],
	});
};

export const X_ALL: Topic[] = [
	finalsHistory,
	champExtremes,
	seriesStories,
	franchiseRecords,
	swings,
	waits,
	eras,
	identity,
	homeCourt,
	oneTeam,
	ringless,
	mvpClub,
	allStarFacts,
	ages,
	farewell,
	peaks,
	clubs,
	marathon,
	seasonRecords,
	mostTraded,
	roots,
	draftHistory,
	earningsAll,
	injuriesAll,
	decadeLeaders,
	winStreak,
];
