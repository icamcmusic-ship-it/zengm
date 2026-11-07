/* eslint-disable unicorn/prefer-single-call */
// Team and league pages: power tiers, the underachievers, the playoff cut line, the play-in explained, division races, the conferences head to head, parity, season series and renewed rivalries.

import { Ctx, P } from "./ctx.ts";
import { ALL_EDS, SEASON_EDS, addPage, arcPage, table } from "./kit.ts";
import {
	andList,
	fmt1,
	ordinal,
	plural,
	record,
	signed,
	winp,
	word,
} from "./text.ts";
import type { Block, NPTeam, Sidebar } from "./types.ts";

const diff = (t: NPTeam) =>
	t.pts !== undefined && t.oppPts !== undefined ? t.pts - t.oppPts : undefined;

const gb = (a: NPTeam, b: NPTeam) => (a.won - b.won + (b.lost - a.lost)) / 2;
const gbText = (g: number) =>
	g === 0 ? "level" : `${g % 1 ? g.toFixed(1) : g} ${g === 1 ? "game" : "games"}`;

// ---- Power rankings in tiers -----------------------------------------------

type Tier = { name: string; teams: NPTeam[] };

const powerOrder = (c: Ctx): { t: NPTeam; score: number }[] =>
	c.f.teams
		.filter((t) => t.gp > 0 || c.pre)
		.map((t) => {
			const d = diff(t);
			const score = c.pre
				? (c.teamOvr(t.tid) ?? 0)
				: winp(t) * 100 + (d !== undefined ? d * 0.8 : 0);
			return { t, score };
		})
		.toSorted((a, b) => b.score - a.score || a.t.tid - b.t.tid);

addPage(
	arcPage<{ order: { t: NPTeam; score: number }[]; tiers: Tier[] }>({
		id: "power-tiers",
		section: "teams",
		kicker: "Power rankings",
		eds: ALL_EDS,
		beat: "league",
		size: "feature",
		prep: (c) => {
			const order = powerOrder(c);
			if (order.length < 8) {
				return undefined;
			}
			const n = order.length;
			const cuts = [Math.ceil(n * 0.2), Math.ceil(n * 0.5), Math.ceil(n * 0.75)];
			const names = c.pre
				? ["Favorites", "Dark horses", "Middle of the pack", "Long shots"]
				: c.done
					? ["Contenders", "Playoff regulars", "On the bubble", "The lottery"]
					: ["Contenders", "In the hunt", "On the bubble", "Looking ahead"];
			const tiers: Tier[] = [
				{ name: names[0]!, teams: order.slice(0, cuts[0]).map((x) => x.t) },
				{ name: names[1]!, teams: order.slice(cuts[0], cuts[1]).map((x) => x.t) },
				{ name: names[2]!, teams: order.slice(cuts[1], cuts[2]).map((x) => x.t) },
				{ name: names[3]!, teams: order.slice(cuts[2]).map((x) => x.t) },
			];
			return { order, tiers };
		},
		photo: () => undefined,
		arcs: [
			{
				id: "tiers",
				heads: (x, c) => [
					`${c.pre ? "Preseason" : c.done ? "Final" : "Midseason"} power rankings, in tiers`,
					`${x.tiers[0]!.teams[0] ? c.tn(x.tiers[0]!.teams[0].tid) : ""} ${c.T("top", "topped")} the power rankings`,
					`Four tiers, one league: the ${c.season} power rankings`,
					`Where every team ${c.T("stands", "stood")}: power rankings`,
					`Sorting the league into tiers`,
				],
				build: (x, r, c) => {
					const out: Block[] = [
						P(
							c.pre
								? c.cycle("tiers-pre", [
										`Nothing has been played in ${c.season}, so these tiers rank rosters by the average rating of their eight best players.`,
										`With ${c.season} still ahead, the tiers below sort ${c.rows.length} rosters by the average rating of their eight best players.`,
										`Before the first game of ${c.season}, here are the ${c.rows.length} rosters in four tiers, ranked by their eight best players.`,
									])
								: `Teams are ordered by winning percentage and scoring margin${c.done ? " over the full season" : `, through ${c.f.gp} games`}.`,
						),
					];
					for (const tier of x.tiers) {
						out.push({ type: "sub", text: tier.name });
						out.push({
							type: "list",
							items: tier.teams.map((t) => [
								c.tl(t.tid, c.tfull(t.tid)),
								c.pre
									? ` (${fmt1(c.teamOvr(t.tid) ?? 0)} rating${t.prev ? `; ${record(t.prev)} last year` : ""})`
									: ` (${record(t)}${diff(t) !== undefined ? `, ${signed(diff(t)!)} a game` : ""})`,
							]),
						});
					}
					return out;
				},
			},
			{
				id: "top-ten",
				heads: (x, c) => [
					`The top ten: ${c.tn(x.order[0]!.t.tid)}, ${c.tn(x.order[1]!.t.tid)} and the field`,
					`Power rankings: the best ten teams in the league`,
					`${c.tn(x.order[0]!.t.tid)} ${c.T("sit", "sat")} on top of the power rankings`,
					`Ranking the best ten`,
				],
				build: (x, r, c) => {
					const top = x.order.slice(0, 10);
					return [
						P(
							c.tl(top[0]!.t.tid, c.tfull(top[0]!.t.tid)),
							` ${c.T("hold", "held")} the top spot${c.pre ? "" : ` at ${record(top[0]!.t)}`}, ahead of the `,
							c.tl(top[1]!.t.tid),
							c.pre ? "." : ` (${record(top[1]!.t)}).`,
						),
						table(
							c.pre
								? ["", "Team", "Rating", "Last year"]
								: ["", "Team", "W-L", "Diff", "Roster rank"],
							top.map((x2, i) =>
								c.pre
									? [
											[String(i + 1)],
											[c.tl(x2.t.tid, c.tfull(x2.t.tid))],
											[fmt1(c.teamOvr(x2.t.tid) ?? 0)],
											[x2.t.prev ? record(x2.t.prev) : "–"],
										]
									: [
											[String(i + 1)],
											[c.tl(x2.t.tid, c.tfull(x2.t.tid))],
											[record(x2.t)],
											[diff(x2.t) !== undefined ? signed(diff(x2.t)!) : "–"],
											[c.ovrRank(x2.t.tid) ? ordinal(c.ovrRank(x2.t.tid)!) : "–"],
										],
							),
							c.pre ? [0, 2] : [0, 2, 3],
						),
					];
				},
			},
		],
	}),
);

// ---- Hot seat: results against the ratings ----------------------------------

addPage(
	arcPage<{
		under: { t: NPTeam; rr: number; rk: number }[];
		over: { t: NPTeam; rr: number; rk: number }[];
	}>({
		id: "hot-seat",
		section: "teams",
		kicker: "On paper and in the standings",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			if (c.rows.length < 10 || c.f.gp < 10) {
				return undefined;
			}
			const rows = c.rows.map((t) => ({
				t,
				rk: c.rank(t.tid),
				rr: c.ovrRank(t.tid) ?? 0,
			}));
			if (rows.some((x) => x.rr === 0)) {
				return undefined;
			}
			const gap = (x: (typeof rows)[number]) => x.rk - x.rr;
			const under = rows.toSorted((a, b) => gap(b) - gap(a)).slice(0, 3);
			const over = rows.toSorted((a, b) => gap(a) - gap(b)).slice(0, 3);
			if (gap(under[0]!) < 5) {
				return undefined;
			}
			return { under, over };
		},
		arcs: [
			{
				id: "under",
				heads: (x, c) => [
					`${c.tn(x.under[0]!.t.tid)} ${c.T("are", "were")} falling short of their talent`,
					`Hot seat: the ${c.tn(x.under[0]!.t.tid)} and the ratings that say better`,
					`Why ${c.T("are", "were")} the ${c.tn(x.under[0]!.t.tid)} only ${ordinal(x.under[0]!.rk)}? The ratings ask`,
					`Big roster, small record: ${c.tn(x.under[0]!.t.tid)}`,
				],
				build: (x, r, c) => {
					const u = x.under[0]!;
					return [
						P(
							`By roster rating the `,
							c.tl(u.t.tid, c.tfull(u.t.tid)),
							` ${c.T("rank", "ranked")} ${ordinal(u.rr)} in the league. By record (${record(u.t)}) they ${c.T("rank", "ranked")} ${ordinal(u.rk)}.`,
						),
						P(
							"Others with a similar gap: ",
							...andList(
								x.under
									.slice(1)
									.map((y) => [
										c.tl(y.t.tid),
										` (${ordinal(y.rr)} on paper, ${ordinal(y.rk)} in the standings)`,
									]),
							),
							".",
						),
						{
							type: "aside",
							segs: [
								c.cycle("hot-seat-note", [
									`Ratings measure the eight best players on a roster; they do not measure coaching, chemistry or luck.`,
									`A rating gap is not a verdict: it ignores coaching, chemistry and luck, and rosters change.`,
									`These ranks come from ratings alone (${c.rows.length} teams), not from anything inside the locker room.`,
								]),
							],
						},
					];
				},
			},
			{
				id: "over",
				heads: (x, c) => [
					`${c.tn(x.over[0]!.t.tid)} ${c.T("are", "were")} beating their ratings`,
					`Better than the ratings: the ${c.tn(x.over[0]!.t.tid)}`,
					`The ${c.tn(x.over[0]!.t.tid)} ${c.T("outrun", "outran")} their roster`,
					`Overachievers: ${c.tn(x.over[0]!.t.tid)}, ${c.tn(x.over[1]!.t.tid)}`,
				],
				build: (x, r, c) => {
					const u = x.over[0]!;
					return [
						P(
							`The `,
							c.tl(u.t.tid, c.tfull(u.t.tid)),
							` ${c.T("rank", "ranked")} ${ordinal(u.rr)} by roster rating but ${ordinal(u.rk)} by record (${record(u.t)}).`,
						),
						table(
							["Team", "Roster rank", "Record rank", "W-L"],
							x.over.map((y) => [
								[c.tl(y.t.tid, c.tfull(y.t.tid))],
								[ordinal(y.rr)],
								[ordinal(y.rk)],
								[record(y.t)],
							]),
							[1, 2, 3],
						),
					];
				},
			},
		],
	}),
);

// ---- The playoff cut line ---------------------------------------------------

const perConf = (c: Ctx) =>
	c.f.numPlayoffTeams
		? Math.max(1, Math.round(c.f.numPlayoffTeams / Math.max(1, c.f.confs.length)))
		: undefined;

const confRows = (c: Ctx, cid: number) =>
	c.f.confs.length > 1 ? c.rows.filter((t) => t.cid === cid) : c.rows;

addPage(
	arcPage<{
		groups: { name: string; cut: number; rows: NPTeam[] }[];
		made?: NPTeam[];
	}>({
		id: "cut-line",
		section: "teams",
		kicker: "The cut line",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const n = perConf(c);
			if (!n || c.f.gp < 10) {
				return undefined;
			}
			const groups = (c.f.confs.length > 1 ? c.f.confs : [{ cid: -1, name: "League" }]).map(
				(conf) => ({
					name: conf.name,
					cut: n,
					rows: conf.cid === -1 ? c.rows : confRows(c, conf.cid),
				}),
			);
			if (groups.some((g) => g.rows.length <= g.cut + 1)) {
				return undefined;
			}
			return { groups };
		},
		arcs: [
			{
				id: "bubble",
				heads: (x, c) => {
					const g = x.groups[0]!;
					const last = g.rows[g.cut - 1]!;
					const first = g.rows[g.cut]!;
					return [
						`${c.tn(last.tid)} ${c.T("cling", "clung")} to the last playoff spot`,
						`On the bubble: ${c.tn(last.tid)} and ${c.tn(first.tid)}`,
						`The cut line: who ${c.T("is", "was")} in and who ${c.T("is", "was")} out`,
						`${c.tn(first.tid)} ${c.T("are", "were")} knocking on the door`,
					];
				},
				build: (x, r, c) => {
					const out: Block[] = [
						P(
							c.done
								? "A look at the teams on either side of the playoff line, by final record."
								: `The playoff line sits at ${word(x.groups[0]!.cut)} teams${x.groups.length > 1 ? " per conference" : ""}. Here is who is on either side of it${c.inPlayoffs ? " as the regular season ended" : `, after ${c.f.gp} games`}.`,
						),
					];
					for (const g of x.groups) {
						const last = g.rows[g.cut - 1]!;
						const first = g.rows[g.cut]!;
						const gap = gb(last, first);
						out.push(
							P(
								x.groups.length > 1 ? `${g.name}: ` : "",
								"The ",
								c.tl(last.tid),
								` (${record(last)}) ${c.T("hold", "held")} the last spot, `,
								gap === 0 ? "level with" : `${gbText(gap)} ahead of`,
								" the ",
								c.tl(first.tid),
								` (${record(first)}), the first team out.`,
							),
						);
					}
					return out;
				},
			},
			{
				id: "table",
				heads: (x, c) => [
					`Playoff picture: the last four in and the first four out`,
					`The race for the final spots`,
					`${c.f.gp} games in, the bracket is still taking shape`,
					`Who ${c.T("makes", "made")} it, who ${c.T("misses", "missed")}`,
				],
				build: (x, r, c) => {
					const out: Block[] = [];
					for (const g of x.groups) {
						const slice = g.rows.slice(Math.max(0, g.cut - 4), g.cut + 4);
						const lastIn = g.rows[g.cut - 1]!;
						out.push({ type: "sub", text: x.groups.length > 1 ? g.name : "The line" });
						out.push(
							table(
								["", "Team", "W-L", "GB of the line"],
								slice.map((t, i) => {
									const idx = Math.max(0, g.cut - 4) + i;
									const behind = gb(lastIn, t);
									return [
										[String(idx + 1)],
										[c.tl(t.tid, c.tfull(t.tid))],
										[record(t)],
										[idx < g.cut ? (behind === 0 ? "on the line" : `+${gbText(-behind).replace("level", "0")}`) : gbText(behind)],
									];
								}),
								[0, 2, 3],
								g.cut - Math.max(0, g.cut - 4) - 1,
							),
						);
					}
					return out;
				},
			},
		],
	}),
);

// ---- The play-in explained --------------------------------------------------

export const playInSidebar = (c: Ctx): Sidebar | undefined => {
	if (!c.f.playIn) {
		return undefined;
	}
	return {
		id: "play-in",
		title: "How the play-in works",
		body: [
			{
				type: "list",
				items: [
					["Seeds 1 to 6 in each conference go straight to the playoffs."],
					["Seeds 7 and 8 play one game; the winner takes the 7th seed."],
					["Seeds 9 and 10 play one game; the loser is out."],
					[
						"The loser of the 7-8 game plays the winner of the 9-10 game for the 8th seed.",
					],
				],
			},
		],
	};
};

addPage(
	arcPage<{ zones: { name: string; rows: NPTeam[] }[] }>({
		id: "play-in",
		section: "teams",
		kicker: "The play-in",
		eds: [...SEASON_EDS],
		beat: "playoffs",
		prep: (c) => {
			if (!c.f.playIn || c.f.gp < 10) {
				return undefined;
			}
			const groups = c.f.confs.length > 1 ? c.f.confs : [{ cid: -1, name: "League" }];
			const zones = groups.map((g) => ({
				name: g.name,
				rows: (g.cid === -1 ? c.rows : confRows(c, g.cid)).slice(6, 10),
			}));
			if (zones.some((z) => z.rows.length < 4)) {
				return undefined;
			}
			return { zones };
		},
		arcs: [
			{
				id: "explain",
				heads: (x, c) => [
					`The play-in, explained: seeds 7 to 10 ${c.T("play", "played")} for two spots`,
					`Four teams, two playoff spots: how the play-in works`,
					`Seeds 7 through 10: the play-in zone`,
					`Why the ${c.season} race ${c.T("goes", "went")} to a play-in`,
				],
				build: (x, r, c) => [
					P(
						"Seeds 1 through 6 in each conference are safe. The next four teams, seeds 7 through 10, ",
						c.T("play", "played"),
						" a short tournament for the last two playoff spots: 7 against 8 and 9 against 10, with the loser of the first game getting a second chance against the winner of the second.",
					),
					...x.zones.map((z): Block =>
						P(
							x.zones.length > 1 ? `${z.name}: ` : "",
							c.T("Right now the play-in field is ", "The play-in field was "),
							...andList(
								z.rows.map((t, i) => [
									`${ordinal(7 + i)} `,
									c.tl(t.tid),
									` (${record(t)})`,
								]),
							),
							".",
						),
					),
				],
			},
		],
	}),
);

// ---- Division races ---------------------------------------------------------

addPage(
	arcPage<{ divs: { name: string; rows: NPTeam[] }[] }>({
		id: "division-races",
		section: "teams",
		kicker: "Division races",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const divs = (c.f.divs ?? [])
				.map((d) => ({
					name: d.name,
					rows: c.rows.filter((t) => t.did === d.did),
				}))
				.filter((d) => d.rows.length >= 3);
			if (divs.length < 2 || c.f.gp < 10) {
				return undefined;
			}
			return { divs };
		},
		arcs: [
			{
				id: "leaders",
				heads: (x, c) => [
					`The ${x.divs.length} division races, ${c.T("so far", "settled")}`,
					`Division by division: who ${c.T("leads", "led")}`,
					`${x.divs.toSorted((a, b) => winp(b.rows[0]!) - winp(a.rows[0]!))[0]!.name} ${c.T("has", "had")} the best leader in the league`,
					`Around the divisions`,
				],
				build: (x, r, c) => [
					P(
						c.T(`Here is who is on top of the ${x.divs.length} divisions, led by the ${x.divs.toSorted((a, b) => winp(b.rows[0]!) - winp(a.rows[0]!))[0]!.rows[0]!.name} at ${record(x.divs.toSorted((a, b) => winp(b.rows[0]!) - winp(a.rows[0]!))[0]!.rows[0]!)}.`, `Here is who finished on top of the ${x.divs.length} divisions, led by the ${x.divs.toSorted((a, b) => winp(b.rows[0]!) - winp(a.rows[0]!))[0]!.rows[0]!.name} at ${record(x.divs.toSorted((a, b) => winp(b.rows[0]!) - winp(a.rows[0]!))[0]!.rows[0]!)}.`),
					),
					{
						type: "list",
						items: x.divs.map((d) => {
							const [a, b] = d.rows as [NPTeam, NPTeam];
							const gap = gb(a, b);
							return [
								`${d.name}: `,
								c.tl(a.tid),
								` (${record(a)}), `,
								gap === 0 ? "level with" : `${gbText(gap)} ahead of`,
								" the ",
								c.tl(b.tid),
							];
						}),
					},
				],
			},
			{
				id: "tight",
				fit: (x) => x.divs.some((d) => gb(d.rows[0]!, d.rows[1]!) <= 1.5),
				heads: (x, c) => {
					const d = x.divs.toSorted(
						(a, b) => gb(a.rows[0]!, a.rows[1]!) - gb(b.rows[0]!, b.rows[1]!),
					)[0]!;
					return [
						`${d.name}: ${c.tn(d.rows[0]!.tid)} and ${c.tn(d.rows[1]!.tid)} ${c.T("are", "were")} inseparable`,
						`The closest division race: ${d.name}`,
						`Two teams, one ${d.name} title`,
						`${d.name} ${c.T("is", "was")} a coin flip`,
					];
				},
				build: (x, r, c) => {
					const d = x.divs.toSorted(
						(a, b) => gb(a.rows[0]!, a.rows[1]!) - gb(b.rows[0]!, b.rows[1]!),
					)[0]!;
					const [a, b, e] = d.rows as [NPTeam, NPTeam, NPTeam];
					return [
						P(
							`In the ${d.name}, the `,
							c.tl(a.tid),
							` (${record(a)}) and the `,
							c.tl(b.tid),
							` (${record(b)}) ${c.T("are", "were")} ${gb(a, b) === 0 ? "level" : `${gbText(gb(a, b))} apart`}`,
							e
								? `, with the ${e.name} (${record(e)}) ${gbText(gb(a, e))} back.`
								: ".",
						),
					];
				},
			},
		],
	}),
);

// ---- East against West ------------------------------------------------------

addPage(
	arcPage<{
		cids: [number, number];
		wins: [number, number];
		avg: [number, number];
		best: [NPTeam, NPTeam];
	}>({
		id: "conference-war",
		section: "teams",
		kicker: "East vs. West",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			if (c.f.confs.length !== 2 || !c.f.h2h || c.f.gp < 10) {
				return undefined;
			}
			const [a, b] = c.f.confs as [{ cid: number; name: string }, { cid: number; name: string }];
			let aw = 0;
			let bw = 0;
			for (const h of c.f.h2h) {
				const ta = c.team(h.a);
				const tb = c.team(h.b);
				if (!ta || !tb || ta.cid === tb.cid) {
					continue;
				}
				// ta's wins are h.aw
				if (ta.cid === a.cid) {
					aw += h.aw;
					bw += h.bw;
				} else {
					aw += h.bw;
					bw += h.aw;
				}
			}
			if (aw + bw < 20 || aw === bw) {
				return undefined;
			}
			const mean = (cid: number) => {
				const rows = c.rows.filter((t) => t.cid === cid);
				return rows.reduce((s, t) => s + winp(t), 0) / Math.max(1, rows.length);
			};
			const best = (cid: number) => c.rows.find((t) => t.cid === cid)!;
			return {
				cids: [a.cid, b.cid],
				wins: [aw, bw],
				avg: [mean(a.cid), mean(b.cid)],
				best: [best(a.cid), best(b.cid)],
			};
		},
		arcs: [
			{
				id: "head-to-head",
				heads: (x, c) => {
					const winner = x.wins[0] > x.wins[1] ? 0 : 1;
					const n = c.f.confs[winner]!.name;
					return [
						`The ${n} ${c.T("has", "had")} the better of the cross-conference games`,
						`${n} ${c.T("holds", "held")} the edge, ${Math.max(...x.wins)}-${Math.min(...x.wins)}`,
						`East against West: ${x.wins[0]}-${x.wins[1]}`,
						`${plural(x.wins[0] + x.wins[1], "game")} between the conferences, one winner`,
					];
				},
				build: (x, r, c) => {
					const a = c.f.confs[0]!;
					const b = c.f.confs[1]!;
					const lead = x.wins[0] > x.wins[1] ? a : b;
					return [
						P(
							`In games between the two conferences, the ${a.name} ${c.T("are", "were")} ${x.wins[0]}-${x.wins[1]} against the ${b.name}. The ${lead.name} ${c.T("has", "had")} the edge.`,
						),
						P(
							`The best record in the ${a.name} ${c.T("belongs", "belonged")} to the `,
							c.tl(x.best[0].tid),
							` (${record(x.best[0])}); in the ${b.name}, to the `,
							c.tl(x.best[1].tid),
							` (${record(x.best[1])}).`,
						),
					];
				},
			},
			{
				id: "averages",
				heads: (x, c) => [
					`${c.f.confs[x.avg[0] > x.avg[1] ? 0 : 1]!.name} teams ${c.T("average", "averaged")} the better record`,
					`Conference check: the average team in each`,
					`How deep ${c.T("is", "was")} each conference?`,
					`The two conferences by the average`,
				],
				build: (x, r, c) => {
					const a = c.f.confs[0]!;
					const b = c.f.confs[1]!;
					return [
						P(
							`The average ${a.name} team ${c.T("has", "had")} a .${Math.round(x.avg[0] * 1000)} winning percentage; the average ${b.name} team, .${Math.round(x.avg[1] * 1000)}.`,
						),
						{
							type: "tape",
							a: a.name,
							b: b.name,
							rows: [
								{
									label: "Head to head",
									a: String(x.wins[0]),
									b: String(x.wins[1]),
								},
								{
									label: "Best record",
									a: record(x.best[0]),
									b: record(x.best[1]),
								},
								{
									label: "Average win pct.",
									a: `.${Math.round(x.avg[0] * 1000)}`,
									b: `.${Math.round(x.avg[1] * 1000)}`,
								},
							],
						},
					];
				},
			},
		],
	}),
);

// ---- Parity -----------------------------------------------------------------

const spread = (rows: { won: number; lost: number }[]) => {
	const ps = rows.filter((r) => r.won + r.lost > 0).map((r) => winp(r));
	if (ps.length < 8) {
		return undefined;
	}
	const m = ps.reduce((a, b) => a + b, 0) / ps.length;
	return Math.sqrt(ps.reduce((a, b) => a + (b - m) ** 2, 0) / ps.length);
};

addPage(
	arcPage<{
		now: number;
		past: { season: number; v: number }[];
		within: number;
		n: number;
	}>({
		id: "parity",
		section: "numbers",
		kicker: "Parity index",
		eds: SEASON_EDS,
		beat: "numbers",
		prep: (c) => {
			if (c.f.gp < 20) {
				return undefined;
			}
			const now = spread(c.f.teams);
			if (now === undefined) {
				return undefined;
			}
			const seasons = new Set<number>();
			for (const t of c.f.teams) {
				for (const h of t.hist ?? []) {
					seasons.add(h.season);
				}
			}
			const past: { season: number; v: number }[] = [];
			for (const s of [...seasons].toSorted((a, b) => a - b)) {
				const v = spread(
					c.f.teams.flatMap((t) => t.hist?.filter((h) => h.season === s) ?? []),
				);
				if (v !== undefined) {
					past.push({ season: s, v });
				}
			}
			if (past.length < 3) {
				return undefined;
			}
			const within = c.f.teams.filter(
				(t) => t.gp > 0 && Math.abs(winp(t) - 0.5) <= 0.1,
			).length;
			return { now, past, within, n: c.f.teams.length };
		},
		arcs: [
			{
				id: "history",
				heads: (x, c) => {
					const more = x.past.filter((p) => p.v > x.now).length;
					return [
						more === 0
							? `The most lopsided league in ${x.past.length + 1} seasons`
							: more === x.past.length
								? `The most balanced league in ${x.past.length + 1} seasons`
								: `How balanced ${c.T("is", "was")} ${c.season}?`,
						`Parity index: ${c.season} against ${x.past.length} earlier seasons`,
						`${x.within} of ${x.n} teams ${c.T("sit", "sat")} within ten points of an even record`,
						`Top-heavy or level? The ${c.season} spread`,
					];
				},
				build: (x, r, c) => {
					const rank = x.past.filter((p) => p.v < x.now).length + 1;
					const widest = x.past.toSorted((a, b) => b.v - a.v)[0]!;
					const tight = x.past.toSorted((a, b) => a.v - b.v)[0]!;
					return [
						P(
							`The standard deviation of team winning percentage ${c.T("is", "was")} ${x.now.toFixed(3)} in ${c.season}${c.done ? "" : " so far"}. Among ${x.past.length + 1} seasons on file, that ${c.T("ranks", "ranked")} ${ordinal(rank)} from the most balanced.`,
						),
						P(
							`${x.within} of ${x.n} teams ${c.T("are", "were")} within ten points of an even record this season, and the ${x.now.toFixed(3)} spread compares with ${widest.v.toFixed(3)} in ${widest.season}, the widest on file, and ${tight.v.toFixed(3)} in ${tight.season}, the tightest.`,
						),
					];
				},
			},
		],
	}),
);

// ---- Season series and renewed rivalries ------------------------------------

addPage(
	arcPage<{
		sweeps: { a: NPTeam; b: NPTeam; aw: number; bw: number }[];
		close: { a: NPTeam; b: NPTeam; aw: number; bw: number; margin: number }[];
		renewed: { a: number; b: number }[];
	}>({
		id: "rivalry",
		section: "teams",
		kicker: "Rivalry watch",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const h2h = c.f.h2h ?? [];
			if (h2h.length < 20) {
				return undefined;
			}
			const full = h2h
				.map((h) => ({ a: c.team(h.a), b: c.team(h.b), aw: h.aw, bw: h.bw, margin: h.margin }))
				.filter(
					(h): h is { a: NPTeam; b: NPTeam; aw: number; bw: number; margin: number } =>
						h.a !== undefined && h.b !== undefined,
				);
			const sweeps = full
				.filter((h) => (h.aw === 0 || h.bw === 0) && h.aw + h.bw >= 3)
				.toSorted((p, q) => q.aw + q.bw - (p.aw + p.bw));
			const close = full
				.filter((h) => h.aw + h.bw >= 3 && Math.abs(h.aw - h.bw) <= 1)
				.toSorted((p, q) => Math.abs(p.margin) - Math.abs(q.margin));
			const prev = c.f.prevPairs ?? [];
			const renewed: { a: number; b: number }[] = [];
			for (const list of c.f.series) {
				for (const s of list) {
					if (
						s.away &&
						prev.some(
							([x, y]) =>
								(x === s.home.tid && y === s.away!.tid) ||
								(y === s.home.tid && x === s.away!.tid),
						)
					) {
						renewed.push({ a: s.home.tid, b: s.away.tid });
					}
				}
			}
			if (sweeps.length === 0 && close.length === 0 && renewed.length === 0) {
				return undefined;
			}
			return { sweeps, close, renewed };
		},
		arcs: [
			{
				id: "sweeps",
				fit: (x) => x.sweeps.length > 0,
				heads: (x, c) => {
					const s = x.sweeps[0]!;
					const w = s.aw > 0 ? s.a : s.b;
					const l = s.aw > 0 ? s.b : s.a;
					return [
						`${w.name} ${c.T("sweep", "swept")} the season series from ${l.name}`,
						`${plural(x.sweeps.length, "season series")} ${c.T("end", "ended")} in a sweep`,
						`${l.name} ${c.T("have", "had")} no answer for ${w.name}`,
						`Perfect against one opponent: ${w.name}`,
					];
				},
				build: (x, r, c) => [
					P(
						`${plural(x.sweeps.length, "season series")} ${c.T("have", "had")} a clean sweep. The longest: `,
						...(() => {
							const s = x.sweeps[0]!;
							const w = s.aw > 0 ? s.a : s.b;
							const l = s.aw > 0 ? s.b : s.a;
							return [
								"the ",
								c.tl(w.tid),
								` beat the `,
								c.tl(l.tid),
								` all ${Math.max(s.aw, s.bw)} times they met.`,
							];
						})(),
					),
					{
						type: "list",
						items: x.sweeps.slice(0, 5).map((s) => {
							const w = s.aw > 0 ? s.a : s.b;
							const l = s.aw > 0 ? s.b : s.a;
							return [
								c.tl(w.tid),
								` ${Math.max(s.aw, s.bw)}, `,
								c.tl(l.tid),
								" 0",
							];
						}),
					},
				],
			},
			{
				id: "dead-even",
				fit: (x) => x.close.length > 0,
				heads: (x, c) => {
					const s = x.close[0]!;
					return [
						`${s.a.name} and ${s.b.name} ${c.T("cannot", "could not")} be separated`,
						`A season series that ${c.T("won't", "would not")} pick a side: ${s.a.name}-${s.b.name}`,
						`${s.aw}-${s.bw}: ${s.a.name} against ${s.b.name}`,
						`Even steven: the ${s.a.name} and the ${s.b.name}`,
					];
				},
				build: (x, r, c) => {
					const s = x.close[0]!;
					return [
						P(
							`The `,
							c.tl(s.a.tid),
							` and the `,
							c.tl(s.b.tid),
							` ${c.T("are", "were")} ${s.aw}-${s.bw} in their games this season, and the total margin ${c.T("is", "was")} ${Math.abs(s.margin)} ${Math.abs(s.margin) === 1 ? "point" : "points"} in favor of the ${s.margin >= 0 ? s.a.name : s.b.name}.`,
						),
						{
							type: "list",
							items: x.close.slice(1, 5).map((y) => [
								c.tl(y.a.tid),
								` ${y.aw}, `,
								c.tl(y.b.tid),
								` ${y.bw}`,
							]),
						},
					];
				},
			},
			{
				id: "renewed",
				fit: (x) => x.renewed.length > 0,
				heads: (x, c) => {
					const s = x.renewed[0]!;
					return [
						`${c.tn(s.a)} and ${c.tn(s.b)}: the rematch`,
						`A playoff rivalry renewed: ${c.tn(s.a)}-${c.tn(s.b)}`,
						`Same bracket, same opponent: ${c.tn(s.a)} and ${c.tn(s.b)}`,
						`${c.tn(s.a)} ${c.T("meet", "met")} ${c.tn(s.b)} in the playoffs again`,
					];
				},
				build: (x, r, c) => [
					P(
						`${plural(x.renewed.length, "playoff series")} ${c.T("repeat", "repeated")} a pairing from the ${c.season - 1} postseason: `,
						...andList(
							x.renewed.map((s) => [c.tl(s.a), " and ", c.tl(s.b)]),
						),
						".",
					),
				],
			},
		],
	}),
);

