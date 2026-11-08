// Player pages: milestones, draft value, positions, team leaders, one-man teams and depth, the clubs, injuries, rookies and awards coverage.

import { Ctx, P } from "./ctx.ts";
import {
	DONE_ONLY,
	PLAYED,
	SEASON_EDS,
	addPage,
	arcPage,
	table,
} from "./kit.ts";
import { andList, fmt1, plural, record } from "./text.ts";
import type { NPPlayer, Seg } from "./types.ts";

const short = (p: Pick<NPPlayer, "pts" | "trb" | "ast">) =>
	`${fmt1(p.pts)}/${fmt1(p.trb)}/${fmt1(p.ast)}`;

// ---- Milestones -------------------------------------------------------------

type Stat = "pts" | "trb" | "ast";
const STAT_WORD: Record<Stat, string> = {
	pts: "points",
	trb: "rebounds",
	ast: "assists",
};

const thresholds = (stat: Stat, total: number) => {
	const step =
		stat === "pts"
			? total < 10000
				? 1000
				: 2500
			: stat === "trb"
				? 1000
				: 500;
	return step;
};

type Mile = {
	p: NPPlayer;
	stat: Stat;
	mark: number;
	before: number;
	now: number;
};

const milestoneData = (c: Ctx) => {
	const crossed: Mile[] = [];
	const near: Mile[] = [];
	for (const p of c.f.players) {
		if (!p.career || p.gp === 0) {
			continue;
		}
		for (const stat of ["pts", "trb", "ast"] as const) {
			const before = p.career[stat];
			const now = Math.round(before + p[stat] * p.gp);
			const step = thresholds(stat, now);
			const mark = Math.floor(now / step) * step;
			if (
				mark > 0 &&
				before < mark &&
				now >= mark &&
				mark >= (stat === "pts" ? 1000 : 500)
			) {
				crossed.push({ p, stat, mark, before, now });
			}
			const next = (Math.floor(now / step) + 1) * step;
			if (next - now <= step * 0.18 && now >= step) {
				near.push({ p, stat, mark: next, before, now });
			}
		}
	}
	crossed.sort((a, b) => b.mark - a.mark);
	near.sort((a, b) => a.mark - a.now - (b.mark - b.now));
	return { crossed, near };
};

addPage(
	arcPage<{ crossed: Mile[]; near: Mile[] }>({
		id: "milestones",
		section: "players",
		kicker: "Milestones",
		eds: PLAYED,
		beat: "numbers",
		prep: (c) => {
			const m = milestoneData(c);
			if (m.crossed.length === 0 && m.near.length === 0) {
				return undefined;
			}
			return m;
		},
		photo: (x) => (x.crossed[0] ?? x.near[0])?.p.pid,
		arcs: [
			{
				id: "crossed",
				fit: (x) => x.crossed.length > 0,
				heads: (x, c) => {
					const m = x.crossed[0]!;
					return [
						`${m.p.name} ${c.T("passes", "passed")} ${m.mark.toLocaleString("en-US")} career ${STAT_WORD[m.stat]}`,
						`Milestone: ${m.mark.toLocaleString("en-US")} ${STAT_WORD[m.stat]} for ${m.p.name}`,
						`${m.p.name} ${c.T("reaches", "reached")} a career mark`,
						`The ${c.season} milestones: ${m.p.name} and ${x.crossed.length - 1 || "no"} more`,
					];
				},
				build: (x, r, c) => [
					P(
						c.pl(x.crossed[0]!.p.pid),
						` ${c.T("has gone", "went")} past ${x.crossed[0]!.mark.toLocaleString("en-US")} career ${STAT_WORD[x.crossed[0]!.stat]}, ${c.T("reaching", "reaching")} ${x.crossed[0]!.now.toLocaleString("en-US")} ${c.T("with the games played so far", "by the end of the season")}.`,
					),
					{
						type: "list",
						items: x.crossed
							.slice(0, 8)
							.map((m) => [
								c.pl(m.p.pid),
								` (`,
								c.tl(m.p.tid, c.team(m.p.tid)?.abbrev),
								`): ${m.mark.toLocaleString("en-US")} career ${STAT_WORD[m.stat]} (${m.before.toLocaleString("en-US")} before the season, ${m.now.toLocaleString("en-US")} now)`,
							]),
					},
				],
			},
			{
				id: "next",
				fit: (x) => x.near.length > 0,
				heads: (x, c) => {
					const m = x.near[0]!;
					return [
						`${m.p.name} ${c.T("is closing in on", "came up just short of")} ${m.mark.toLocaleString("en-US")}`,
						`Within reach: ${m.mark.toLocaleString("en-US")} career ${STAT_WORD[m.stat]}`,
						`Milestone watch: ${m.p.name} and the next marks`,
						`${m.mark - m.now} ${STAT_WORD[m.stat]} from a mark: ${m.p.name}`,
					];
				},
				build: (x, r, c) => [
					P(
						c.T(
							"Players close to a round career number:",
							"Players who ended the season within sight of a round career number:",
						),
					),
					{
						type: "list",
						items: x.near
							.slice(0, 8)
							.map((m) => [
								c.pl(m.p.pid),
								`: ${m.now.toLocaleString("en-US")} career ${STAT_WORD[m.stat]}, ${(m.mark - m.now).toLocaleString("en-US")} from ${m.mark.toLocaleString("en-US")}`,
							]),
					},
				],
			},
		],
	}),
);

// ---- Draft value: steals and slow starts -------------------------------------

const slotOf = (p: NPPlayer, c: Ctx) =>
	p.draftRound > 0
		? p.draftPick + (p.draftRound - 1) * Math.max(30, c.f.teams.length)
		: undefined;

addPage(
	arcPage<{
		steals: { p: NPPlayer; slot: number }[];
		slow: { p: NPPlayer; slot: number }[];
	}>({
		id: "draft-value",
		section: "players",
		kicker: "Draft value",
		eds: SEASON_EDS,
		beat: "draft",
		prep: (c) => {
			const young = c.f.players.filter(
				(p) =>
					p.draftYear >= c.season - 3 &&
					p.draftYear < c.season &&
					p.gp >= Math.max(10, c.f.gp * 0.4),
			);
			const withSlot = young
				.map((p) => ({ p, slot: slotOf(p, c) }))
				.filter(
					(x): x is { p: NPPlayer; slot: number } => x.slot !== undefined,
				);
			const steals = withSlot
				.filter((x) => x.slot > 20)
				.toSorted((a, b) => b.p.ws - a.p.ws)
				.slice(0, 5);
			const slow = withSlot
				.filter((x) => x.slot <= 5)
				.toSorted((a, b) => a.p.ws - b.p.ws)
				.slice(0, 4);
			if (steals.length < 2) {
				return undefined;
			}
			return { steals, slow };
		},
		photo: (x) => x.steals[0]?.p.pid,
		arcs: [
			{
				id: "steals",
				heads: (x, c) => [
					`${x.steals[0]!.p.name}, pick No. ${x.steals[0]!.slot}, ${c.T("is", "was")} a draft-night steal`,
					`Late picks, big numbers: ${x.steals[0]!.p.name} and company`,
					`The best value from the last three drafts`,
					`Draft slot is not destiny: ${x.steals[0]!.p.name}`,
				],
				build: (x, r, c) => [
					P(
						"Of players drafted in the last three years who went after the 20th pick, the most productive ",
						c.T("is", "was"),
						" ",
						c.pl(x.steals[0]!.p.pid),
						` (No. ${x.steals[0]!.slot}, ${fmt1(x.steals[0]!.p.ws)} win shares${c.done ? "" : " so far"}) of the `,
						c.tl(x.steals[0]!.p.tid),
						".",
					),
					table(
						["Player", "Team", "Pick", "WS", "PTS/REB/AST"],
						x.steals.map((y) => [
							[c.pl(y.p.pid)],
							[c.tl(y.p.tid, c.team(y.p.tid)?.abbrev)],
							[`No. ${y.slot} (${y.p.draftYear})`],
							[fmt1(y.p.ws)],
							[short(y.p)],
						]),
						[3],
					),
				],
			},
			{
				id: "slow",
				fit: (x) => x.slow.length >= 2,
				heads: (x, c) => [
					`Top-five picks still waiting to deliver: ${x.slow[0]!.p.name}`,
					`${x.slow[0]!.p.name}, a No. ${x.slow[0]!.slot} pick, ${c.T("has", "had")} ${fmt1(x.slow[0]!.p.ws)} win shares`,
					`Slow starts from the top of the draft`,
					`The top of recent drafts, measured so far`,
				],
				build: (x, r, c) => [
					P(
						"Among top-five picks of the last three drafts who have played, the lowest win-share totals belong to ",
						...andList(
							x.slow.map((y) => [
								c.pl(y.p.pid),
								` (No. ${y.slot}, ${fmt1(y.p.ws)})`,
							]),
						),
						".",
					),
					{
						type: "aside",
						segs: [
							"Ratings and playing time can still change; this is a snapshot, not a verdict.",
						],
					},
				],
			},
		],
	}),
);

// ---- Positions --------------------------------------------------------------

addPage(
	arcPage<{
		rows: {
			pos: string;
			n: number;
			pts: number;
			trb: number;
			ast: number;
			top: NPPlayer;
		}[];
	}>({
		id: "positions",
		section: "players",
		kicker: "By position",
		eds: PLAYED,
		beat: "numbers",
		prep: (c) => {
			const by = new Map<string, NPPlayer[]>();
			for (const p of c.qual) {
				if (!p.pos) {
					continue;
				}
				by.set(p.pos, [...(by.get(p.pos) ?? []), p]);
			}
			const rows = [...by.entries()]
				.filter(([, ps]) => ps.length >= 4)
				.map(([pos, ps]) => ({
					pos,
					n: ps.length,
					pts: ps.reduce((a, p) => a + p.pts, 0) / ps.length,
					trb: ps.reduce((a, p) => a + p.trb, 0) / ps.length,
					ast: ps.reduce((a, p) => a + p.ast, 0) / ps.length,
					top: ps.toSorted((a, b) => b.ws - a.ws)[0]!,
				}))
				.toSorted((a, b) => b.pts - a.pts);
			return rows.length >= 3 ? { rows } : undefined;
		},
		photo: (x) => x.rows[0]?.top.pid,
		arcs: [
			{
				id: "table",
				heads: (x, c) => [
					`Who ${c.T("scores", "scored")} from which position`,
					`${x.rows[0]!.pos}s ${c.T("lead", "led")} the scoring by position`,
					`Position by position: the ${c.season} averages`,
					`Guards, wings and bigs, by the numbers`,
				],
				build: (x, r, c) => [
					P(
						`Among qualified players, ${x.rows[0]!.pos}s ${c.T("average", "averaged")} the most points (${fmt1(x.rows[0]!.pts)}), while ${x.rows.toSorted((a, b) => b.trb - a.trb)[0]!.pos}s ${c.T("lead", "led")} in rebounds (${fmt1(x.rows.toSorted((a, b) => b.trb - a.trb)[0]!.trb)}) and ${x.rows.toSorted((a, b) => b.ast - a.ast)[0]!.pos}s in assists (${fmt1(x.rows.toSorted((a, b) => b.ast - a.ast)[0]!.ast)}).`,
					),
					table(
						["Pos", "Players", "PPG", "RPG", "APG", "Top by win shares"],
						x.rows.map((y) => [
							[y.pos],
							[String(y.n)],
							[fmt1(y.pts)],
							[fmt1(y.trb)],
							[fmt1(y.ast)],
							[c.pl(y.top.pid)],
						]),
						[1, 2, 3, 4],
					),
				],
			},
		],
	}),
);

// ---- Team by team -----------------------------------------------------------

addPage(
	arcPage<{
		rows: { t: (typeof Ctx.prototype.rows)[number]; p: NPPlayer }[];
	}>({
		id: "team-leaders",
		section: "teams",
		kicker: "Team by team",
		eds: PLAYED,
		beat: "league",
		size: "feature",
		prep: (c) => {
			const rows = c.rows
				.map((t) => ({ t, p: c.teamPlayers(t.tid)[0] }))
				.filter(
					(x): x is { t: (typeof c.rows)[number]; p: NPPlayer } =>
						x.p !== undefined,
				);
			return rows.length >= 8 ? { rows } : undefined;
		},
		photo: (x) => x.rows[0]?.p.pid,
		arcs: [
			{
				id: "table",
				heads: (x, c) => [
					`One name for every team: the ${c.season} leaders`,
					`Team by team: the best player on each roster`,
					`Who ${c.T("carries", "carried")} each team`,
					`${x.rows.length} rosters, ${x.rows.length} leaders`,
				],
				build: (x, r, c) => [
					P(
						c.cycle("team-leaders-intro", [
							`The most productive player on every roster by win shares${c.done ? "" : " so far"}, teams in order of record; ${x.rows[0]!.p.name} leads all ${x.rows.length} with ${fmt1(x.rows.toSorted((a, b) => b.p.ws - a.p.ws)[0]!.p.ws)}.`,
							`${x.rows.length} teams, ${x.rows.length} leaders: the top name by win shares on each roster, best record first.`,
							`Every roster has one player who ${c.T("does", "did")} the most, and here is each of them by win shares.`,
						]),
					),
					table(
						["Team", "W-L", "Leader", "WS", "PTS/REB/AST"],
						x.rows.map((y) => [
							[c.tl(y.t.tid, c.tfull(y.t.tid))],
							[record(y.t)],
							[c.pl(y.p.pid)],
							[fmt1(y.p.ws)],
							[short(y.p)],
						]),
						[1, 3],
					),
				],
			},
		],
	}),
);

// ---- One-man teams and depth -------------------------------------------------

addPage(
	arcPage<{
		rows: {
			tid: number;
			top: NPPlayer;
			share: number;
			total: number;
			top3: number;
		}[];
	}>({
		id: "depth",
		section: "teams",
		kicker: "Stars and depth",
		eds: PLAYED,
		beat: "numbers",
		prep: (c) => {
			const rows = c.rows
				.map((t) => {
					const ps = c.teamPlayers(t.tid).filter((p) => p.ws > 0);
					const total = ps.reduce((a, p) => a + p.ws, 0);
					if (ps.length < 5 || total < 5) {
						return undefined;
					}
					return {
						tid: t.tid,
						top: ps[0]!,
						share: ps[0]!.ws / total,
						total,
						top3: ps.slice(0, 3).reduce((a, p) => a + p.ws, 0) / total,
					};
				})
				.filter((x): x is NonNullable<typeof x> => x !== undefined);
			return rows.length >= 8 ? { rows } : undefined;
		},
		photo: (x) => x.rows.toSorted((a, b) => b.share - a.share)[0]?.top.pid,
		arcs: [
			{
				id: "one-man",
				heads: (x, c) => {
					const y = x.rows.toSorted((a, b) => b.share - a.share)[0]!;
					return [
						`${y.top.name} ${c.T("is", "was")} the ${c.tn(y.tid)}`,
						`One-man show: ${y.top.name} and the ${c.tn(y.tid)}`,
						`${Math.round(y.share * 100)}% of the ${c.tn(y.tid)} win shares ${c.T("belong", "belonged")} to one player`,
						`Carrying the load: ${y.top.name}`,
					];
				},
				build: (x, r, c) => {
					const sorted = x.rows
						.toSorted((a, b) => b.share - a.share)
						.slice(0, 5);
					const y = sorted[0]!;
					return [
						P(
							c.pl(y.top.pid),
							` ${c.T("accounts", "accounted")} for ${Math.round(y.share * 100)}% of the `,
							c.tl(y.tid),
							` win shares (${fmt1(y.top.ws)} of ${fmt1(y.total)}), the largest share on any team.`,
						),
						table(
							["Team", "Player", "Share of team WS"],
							sorted.map((z) => [
								[c.tl(z.tid, c.tfull(z.tid))],
								[c.pl(z.top.pid)],
								[`${Math.round(z.share * 100)}%`],
							]),
							[2],
						),
					];
				},
			},
			{
				id: "deep",
				heads: (x, c) => {
					const y = x.rows.toSorted((a, b) => a.top3 - b.top3)[0]!;
					return [
						`The ${c.tn(y.tid)} ${c.T("win", "won")} with depth, not stars`,
						`Balance sheet: ${c.tn(y.tid)} ${c.T("spread", "spread")} the work`,
						`No one carries the ${c.tn(y.tid)}, and that ${c.T("is", "was")} the point`,
						`The deepest team in the league`,
					];
				},
				build: (x, r, c) => {
					const sorted = x.rows.toSorted((a, b) => a.top3 - b.top3).slice(0, 5);
					const y = sorted[0]!;
					return [
						P(
							`The `,
							c.tl(y.tid),
							` ${c.T("get", "got")} just ${Math.round(y.top3 * 100)}% of their win shares from their top three players, the most evenly spread of any team. Their best, `,
							c.pl(y.top.pid),
							`, ${c.T("has", "had")} ${fmt1(y.top.ws)}.`,
						),
						table(
							["Team", "W-L", "Top three share"],
							sorted.map((z) => [
								[c.tl(z.tid, c.tfull(z.tid))],
								[c.rec(z.tid)],
								[`${Math.round(z.top3 * 100)}%`],
							]),
							[1, 2],
						),
					];
				},
			},
		],
	}),
);

// ---- Statistical clubs ------------------------------------------------------

addPage(
	arcPage<{ clubs: { name: string; members: NPPlayer[] }[] }>({
		id: "clubs",
		section: "players",
		kicker: "The clubs",
		eds: PLAYED,
		beat: "numbers",
		prep: (c) => {
			const q = c.qual;
			const defs: [string, (p: NPPlayer) => boolean][] = [
				["20 points a game", (p) => p.pts >= 20],
				["25 points a game", (p) => p.pts >= 25],
				["10 rebounds a game", (p) => p.trb >= 10],
				["8 assists a game", (p) => p.ast >= 8],
				["2 steals a game", (p) => p.stl >= 2],
				["2 blocks a game", (p) => p.blk >= 2],
				[
					"20-5-5 (points, rebounds, assists)",
					(p) => p.pts >= 20 && p.trb >= 5 && p.ast >= 5,
				],
				[
					"50-40-80 shooting",
					(p) =>
						p.fgp >= 50 && p.tpp >= 40 && (p.ftp ?? 0) >= 80 && p.tp >= 0.5,
				],
			];
			const clubs = defs
				.map(([name, f]) => ({
					name,
					members: q.filter(f).toSorted((a, b) => b.ws - a.ws),
				}))
				.filter((x) => x.members.length > 0);
			return clubs.length >= 3 ? { clubs } : undefined;
		},
		photo: (x) => x.clubs[0]?.members[0]?.pid,
		arcs: [
			{
				id: "roster",
				heads: (x, c) => [
					`Club membership: who ${c.T("has", "had")} the numbers`,
					`The ${c.season} clubs, from 20 points to 50-40-80`,
					`Membership roll: ${x.clubs[0]!.members.length} players in the ${x.clubs[0]!.name} club`,
					`Joining the clubs: the ${c.season} roll call`,
				],
				build: (x, r, c) => [
					P(
						c.T(
							`${x.clubs.length} clubs have members so far; the players at these marks:`,
							`${x.clubs.length} clubs had members; the players who finished at these marks:`,
						),
					),
					{
						type: "notebook",
						items: x.clubs.map((club) => ({
							lead: `${club.name} (${club.members.length}):`,
							segs: andList(
								club.members.slice(0, 6).map((p) => [c.pl(p.pid)]),
							).concat(
								club.members.length > 6
									? [` and ${club.members.length - 6} more.`]
									: ["."],
							),
						})),
					},
				],
			},
		],
	}),
);

// ---- Injuries ----------------------------------------------------------------

addPage(
	arcPage<{
		byTeam: { tid: number; n: number; games: number }[];
		longest: NonNullable<Ctx["f"]["injuries"][number]>[];
	}>({
		id: "injury-ledger",
		section: "teams",
		kicker: "The training room",
		eds: ["midseason", "playoffs"],
		beat: "league",
		prep: (c) => {
			const list = c.f.injuries.filter((i) => i.gamesRemaining > 0);
			if (list.length < 5) {
				return undefined;
			}
			const by = new Map<number, { n: number; games: number }>();
			for (const i of list) {
				const cur = by.get(i.tid) ?? { n: 0, games: 0 };
				by.set(i.tid, { n: cur.n + 1, games: cur.games + i.gamesRemaining });
			}
			const byTeam = [...by.entries()]
				.map(([tid, v]) => ({ tid, ...v }))
				.toSorted((a, b) => b.games - a.games)
				.slice(0, 6);
			return {
				byTeam,
				longest: list
					.toSorted((a, b) => b.gamesRemaining - a.gamesRemaining)
					.slice(0, 5),
			};
		},
		photo: (x) => x.longest[0]?.pid,
		arcs: [
			{
				id: "teams",
				heads: (x, c) => [
					`The ${c.tn(x.byTeam[0]!.tid)} have the longest injury list`,
					`Hurting: which rosters are missing the most games`,
					`${x.byTeam[0]!.games} games of injuries on the ${c.tn(x.byTeam[0]!.tid)}`,
					`The training room, team by team`,
				],
				build: (x, r, c) => [
					P(
						"The ",
						c.tl(x.byTeam[0]!.tid),
						` have ${plural(x.byTeam[0]!.n, "player")} out for a combined ${x.byTeam[0]!.games} more games, the heaviest injury load in the league.`,
					),
					table(
						["Team", "Players out", "Games still to miss"],
						x.byTeam.map((y) => [
							[c.tl(y.tid, c.tfull(y.tid))],
							[String(y.n)],
							[String(y.games)],
						]),
						[1, 2],
					),
				],
			},
			{
				id: "longest",
				heads: (x) => [
					`${x.longest[0]!.name} faces the longest layoff`,
					`Out for ${x.longest[0]!.gamesRemaining} more: ${x.longest[0]!.name}`,
					`The longest absences in the league`,
					`Sidelined for the long haul`,
				],
				build: (x, r, c) => [
					P(
						c.pl(x.longest[0]!.pid, x.longest[0]!.name),
						` (`,
						c.tl(x.longest[0]!.tid, c.team(x.longest[0]!.tid)?.abbrev),
						`) has the longest wait: ${x.longest[0]!.type.toLowerCase()}, ${plural(x.longest[0]!.gamesRemaining, "more game")}.`,
					),
					{
						type: "list",
						items: x.longest
							.slice(1)
							.map((i) => [
								c.pl(i.pid, i.name),
								` (`,
								c.tl(i.tid, c.team(i.tid)?.abbrev),
								`): ${i.type.toLowerCase()}, ${plural(i.gamesRemaining, "game")} left`,
							]),
					},
				],
			},
		],
	}),
);

// ---- Awards coverage -----------------------------------------------------------

const AWARD_ORDER = ["MVP", "DPOY", "ROY", "SMOY", "MIP"];

addPage(
	arcPage<{ ballots: { key: string; name: string; order: NPPlayer[] }[] }>({
		id: "ballots",
		section: "awards",
		kicker: "The ballots",
		eds: DONE_ONLY,
		beat: "awards",
		prep: (c) => {
			const ballots = AWARD_ORDER.map((key) => {
				const a = c.award(key);
				if (!a) {
					return undefined;
				}
				const order = a.order
					.map((pid) => c.player(pid))
					.filter((p): p is NPPlayer => p !== undefined)
					.slice(0, 3);
				return order.length >= 2 ? { key, name: a.name, order } : undefined;
			}).filter((x): x is NonNullable<typeof x> => x !== undefined);
			return ballots.length >= 2 ? { ballots } : undefined;
		},
		photo: (x) => x.ballots[0]?.order[0]?.pid,
		arcs: [
			{
				id: "order",
				heads: (x, c) => [
					`How the ${c.season} votes fell`,
					`Award voting, ${c.season}: the order of finish`,
					`The ballots of ${c.season}, read closely`,
					`Winners and runners-up: the ${c.season} awards`,
				],
				build: (x, r, c) => [
					P(
						c.cycle("ballots-intro", [
							`Top three in the voting for ${x.ballots.length} awards, winner first.`,
							`${x.ballots.length} ballots, ${x.ballots.length * 3} names: the order of finish, winner first.`,
							`The ${c.season} voting, ${x.ballots.length} awards deep, with winners on the left.`,
						]),
					),
					table(
						["Award", "First", "Second", "Third"],
						x.ballots.map((b) => [
							[b.name],
							...[0, 1, 2].map((i): Seg[] =>
								b.order[i]
									? [c.pl(b.order[i]!.pid), ` (${short(b.order[i]!)})`]
									: ["–"],
							),
						]),
					),
				],
			},
			{
				id: "second",
				heads: (x, c) => {
					const b = x.ballots[0]!;
					return [
						`${b.order[1]!.name} finished second for ${b.key}`,
						`So close: the runners-up of ${c.season}`,
						`Second place, ${c.season}: the ones who just missed`,
						`${b.order[0]!.name} over ${b.order[1]!.name}`,
					];
				},
				build: (x, r, c) => [
					P(
						`Runners-up are often the better story, and the ${c.season} ones are: `,
						...andList(
							x.ballots.map((b) => [
								c.pl(b.order[1]!.pid),
								` (${b.key}, behind `,
								c.pl(b.order[0]!.pid),
								")",
							]),
						),
						".",
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{
		conf: { name: string; award: string; pid: number; tid: number }[];
	}>({
		id: "conf-awards",
		section: "awards",
		kicker: "By conference",
		eds: ["playoffs", "final"],
		beat: "awards",
		prep: (c) => {
			const conf = c.f.awards
				.filter((a) => a.group !== undefined)
				.map((a) => ({
					name: a.group!,
					award: a.name,
					pid: a.pid,
					tid: a.tid,
				}));
			return conf.length >= 1 ? { conf } : undefined;
		},
		photo: (x) => x.conf[0]?.pid,
		arcs: [
			{
				id: "list",
				heads: (x, c) => [
					`Conference honors, ${c.season}: ${x.conf.length === 1 ? x.conf[0]!.award : "the winners"}`,
					`${c.season} conference awards`,
					`Who ${c.T("takes", "took")} the conference awards`,
					`The conferences hand out their own honors`,
				],
				build: (x, r, c) => [
					P(
						c.cycle("conf-awards-intro", [
							`${plural(x.conf.length, "honor")} ${x.conf.length === 1 ? "goes" : "go"} to one conference at a time in ${c.season}, apart from the league-wide awards:`,
							`Beyond the league-wide awards, ${plural(x.conf.length, "conference prize")} ${x.conf.length === 1 ? "was" : "were"} handed out in ${c.season}, starting with ${x.conf[0]!.award}:`,
							`The conferences award their own ${plural(x.conf.length, "honor")} too in ${c.season}:`,
						]),
					),
					{
						type: "list",
						items: x.conf.map((a) => [
							`${a.award}: `,
							c.pl(a.pid),
							` (`,
							c.tl(a.tid),
							`)`,
							c.player(a.pid) ? `, ${short(c.player(a.pid)!)}` : "",
						]),
					},
				],
			},
		],
	}),
);

addPage(
	arcPage<{
		snubs: NPPlayer[];
		teamCount: { tid: number; n: number }[];
		pids: Set<number>;
	}>({
		id: "all-league-notes",
		section: "awards",
		kicker: "All-League notes",
		eds: DONE_ONLY,
		beat: "awards",
		prep: (c) => {
			const pids = new Set<number>();
			for (const ta of c.f.teamAwards) {
				if (!/league/i.test(ta.name)) {
					continue;
				}
				for (const t of ta.teams) {
					for (const pid of t.pids) {
						pids.add(pid);
					}
				}
			}
			if (pids.size < 5) {
				return undefined;
			}
			const snubs = c.qual
				.toSorted((a, b) => b.ws - a.ws)
				.slice(0, 20)
				.filter((p) => !pids.has(p.pid))
				.slice(0, 4);
			const by = new Map<number, number>();
			for (const pid of pids) {
				const p = c.player(pid);
				if (p) {
					by.set(p.tid, (by.get(p.tid) ?? 0) + 1);
				}
			}
			const teamCount = [...by.entries()]
				.map(([tid, n]) => ({ tid, n }))
				.toSorted((a, b) => b.n - a.n)
				.slice(0, 5);
			return { snubs, teamCount, pids };
		},
		photo: (x) => x.snubs[0]?.pid,
		arcs: [
			{
				id: "snubs",
				fit: (x) => x.snubs.length >= 2,
				heads: (x, c) => [
					`Left off the All-League teams: ${x.snubs[0]!.name}`,
					`Snubbed? ${x.snubs[0]!.name} and the All-League omissions`,
					`${fmt1(x.snubs[0]!.ws)} win shares and no All-League spot`,
					`Who missed the cut in ${c.season}`,
				],
				build: (x, r, c) => [
					P(
						`Among the 20 most productive players by win shares, these did not make an All-League team: `,
						...andList(
							x.snubs.map((p) => [
								c.pl(p.pid),
								` (${fmt1(p.ws)} WS, `,
								c.tl(p.tid, c.team(p.tid)?.abbrev),
								")",
							]),
						),
						".",
					),
				],
			},
			{
				id: "by-team",
				heads: (x, c) => [
					`${c.tn(x.teamCount[0]!.tid)} ${c.T("have", "had")} the most All-League players`,
					`All-League by franchise: ${c.tn(x.teamCount[0]!.tid)} on top`,
					`Where the honors went, team by team`,
					`${x.teamCount[0]!.n} All-League players for one team`,
				],
				build: (x, r, c) => [
					P(
						"The ",
						c.tl(x.teamCount[0]!.tid),
						` placed ${x.teamCount[0]!.n} players on the All-League teams, the most of any franchise.`,
					),
					table(
						["Team", "All-League players"],
						x.teamCount.map((y) => [
							[c.tl(y.tid, c.tfull(y.tid))],
							[String(y.n)],
						]),
						[1],
					),
				],
			},
		],
	}),
);
