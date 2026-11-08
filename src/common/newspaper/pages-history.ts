// History pages: the draft class of five years ago, where the stars of ten years ago are now, the MVP ledger, a look back, the title ledger, record chases, worst-to-first and franchise milestones.

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
} from "./text.ts";
import type { NPTeam } from "./types.ts";

const grp = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- The draft class, five years on --------------------------------------------

addPage(
	arcPage<NonNullable<Ctx["f"]["draftRetro"]>>({
		id: "draft-retro",
		section: "history",
		kicker: "Draft retrospective",
		eds: ALL_EDS,
		beat: "draft",
		size: "feature",
		prep: (c) => c.f.draftRetro,
		photo: () => undefined,
		arcs: [
			{
				id: "class",
				heads: (x, c) => [
					`The ${x.year} draft, ${c.season - x.year} years later`,
					`${c.season - x.year} years on: how the ${x.year} class turned out`,
					`Re-drafting ${x.year}: the first picks and what became of them`,
					`The ${x.year} first round, revisited`,
				],
				build: (x, r, c) => {
					const ws = x.picks.reduce((a, p) => a + p.ws, 0);
					const active = x.picks.filter(
						(p) => !p.retired && p.tid >= -1 && p.seasons > 0,
					).length;
					const years = c.season - x.year;
					// The same sentence every time; the variation pass swaps it for an alternative
					const lead = `${years} years on, the ${x.year} draft has produced ${fmt1(ws)} career win shares from ${x.picks.length} picks; ${active} of them are still playing.`;
					return [
						P(lead),
						table(
							["Pick", "Player", "Drafted by", "Now", "Career WS", "Points"],
							x.picks
								.slice(0, 10)
								.map((p) => [
									[`${p.round}-${p.pick}`],
									[c.pl(p.pid)],
									[c.tl(p.draftTid, c.team(p.draftTid)?.abbrev)],
									[
										p.retired
											? "retired"
											: p.tid >= 0
												? (c.team(p.tid)?.abbrev ?? "active")
												: "free agent",
									],
									[fmt1(p.ws)],
									[grp(p.pts)],
								]),
							[4, 5],
						),
					];
				},
			},
			{
				id: "stars",
				fit: (x) => x.picks.some((p) => p.ws > 0),
				heads: (x, c) => {
					const best = x.picks.toSorted((a, b) => b.ws - a.ws)[0]!;
					return [
						`${best.name} ${c.T("is", "was")} the best of the ${x.year} class`,
						`The best pick of ${x.year} went No. ${best.pick}`,
						`${x.year} draft: ${best.name} on top by career win shares`,
						`Of the ${x.year} class, only a few ${c.T("have", "had")} made their mark`,
					];
				},
				build: (x, r, c) => {
					const best = x.picks.toSorted((a, b) => b.ws - a.ws)[0]!;
					const first = x.picks.find((p) => p.pick === 1 && p.round === 1);
					const steal = x.picks
						.filter((p) => p.round > 1 || p.pick > 15)
						.toSorted((a, b) => b.ws - a.ws)[0];
					return [
						P(
							c.pl(best.pid),
							`, taken No. ${best.pick} in round ${best.round}, has the most career win shares in the ${x.year} class (${fmt1(best.ws)}) and ${grp(best.pts)} points${best.allStar > 0 ? `, with ${plural(best.allStar, "All-Star selection")}` : ""}.`,
						),
						first && first.pid !== best.pid
							? P(
									`The first pick, `,
									c.pl(first.pid),
									`, has ${fmt1(first.ws)} career win shares in ${plural(first.seasons, "season")}.`,
								)
							: P(""),
						steal && steal.pid !== best.pid
							? P(
									`The best value came later: `,
									c.pl(steal.pid),
									`, No. ${steal.pick} in round ${steal.round}, with ${fmt1(steal.ws)} career win shares.`,
								)
							: P(""),
					];
				},
			},
		],
	}),
);

// ---- Where are they now ---------------------------------------------------------

addPage(
	arcPage<NonNullable<Ctx["f"]["then"]>>({
		id: "where-now",
		section: "history",
		kicker: "Where are they now",
		eds: ALL_EDS,
		beat: "features",
		prep: (c) => c.f.then,
		arcs: [
			{
				id: "table",
				heads: (x, c) => [
					`The stars of ${x.year}: where are they now?`,
					`${c.season - 1 - x.year} years later: the leaders of ${x.year}`,
					`From ${x.year} to today: ${x.list[0]!.name} and the leaders of that year`,
					`Whatever happened to the best players of ${x.year}?`,
				],
				build: (x, r, c) => [
					P(
						`The leading names of ${x.year}, and where they stand in ${c.season}:`,
					),
					table(
						["Player", `${x.year}`, "Now"],
						x.list.map((p) => [
							[c.pl(p.pid, p.name)],
							[
								c.tl(p.tid, c.team(p.tid)?.abbrev),
								` ${fmt1(p.pts)} ppg, ${fmt1(p.ws)} WS`,
							],
							[
								p.retired
									? "retired"
									: p.nowTid >= 0 && c.team(p.nowTid)
										? `${c.team(p.nowTid)!.abbrev}${p.age ? `, age ${p.age}` : ""}${p.nowPpg !== undefined ? `, ${fmt1(p.nowPpg)} ppg` : ""}`
										: "free agent",
							],
						]),
					),
				],
			},
			{
				id: "survivors",
				fit: (x) => x.list.some((p) => !p.retired && p.nowPpg !== undefined),
				heads: (x, c) => [
					`Still going: ${x.list.find((p) => !p.retired && p.nowPpg !== undefined)!.name} ${c.T("is", "was")} a star in ${x.year} and now`,
					`Survivors from ${x.year}'s best`,
					`${x.list.filter((p) => !p.retired).length} of the ${x.year} stars ${c.T("are", "were")} still active`,
					`Staying power: the ${x.year} leaders`,
				],
				build: (x, r, c) => {
					const alive = x.list.filter(
						(p) => !p.retired && p.nowPpg !== undefined,
					);
					const gone = x.list.filter((p) => p.retired);
					return [
						P(
							`Of the six leading names of ${x.year}, ${alive.length} ${alive.length === 1 ? "is" : "are"} still averaging real minutes: `,
							...andList(
								alive.map((p) => [
									c.pl(p.pid, p.name),
									` (${fmt1(p.nowPpg!)} ppg last season)`,
								]),
							),
							".",
						),
						gone.length > 0
							? P(
									`Retired since: `,
									...andList(gone.map((p) => [c.pl(p.pid, p.name)])),
									".",
								)
							: P(""),
					];
				},
			},
		],
	}),
);

// ---- The MVP ledger -----------------------------------------------------------------

addPage(
	arcPage<{ list: NonNullable<Ctx["f"]["mvps"]> }>({
		id: "mvp-ledger",
		section: "history",
		kicker: "The MVP ledger",
		eds: ALL_EDS,
		beat: "awards",
		prep: (c) => {
			const list = (c.f.mvps ?? []).toSorted((a, b) => b.season - a.season);
			return list.length >= 4 ? { list } : undefined;
		},
		photo: (x) => x.list[0]?.pid,
		arcs: [
			{
				id: "recent",
				heads: (x, c) => [
					`The last ${Math.min(8, x.list.length)} MVPs`,
					`MVP history: ${x.list[0]!.name} and the winners before him`,
					`Who has won the MVP, ${x.list.at(-1)!.season} to ${x.list[0]!.season}`,
					`The league's MVP ledger`,
				],
				build: (x, r, c) => [
					P(
						`${x.list.length} MVPs have been named since ${x.list.at(-1)!.season}. The most recent ${Math.min(8, x.list.length)}:`,
					),
					table(
						["Season", "MVP", "Team", "Age"],
						x.list
							.slice(0, 8)
							.map((m) => [
								[String(m.season)],
								[c.pl(m.pid, m.name)],
								[c.tl(m.tid, c.team(m.tid)?.abbrev)],
								[m.age ? String(m.age) : "–"],
							]),
						[0, 3],
					),
				],
			},
			{
				id: "repeat",
				fit: (x) => {
					const counts = new Map<number, number>();
					for (const m of x.list) {
						counts.set(m.pid, (counts.get(m.pid) ?? 0) + 1);
					}
					return [...counts.values()].some((n) => n >= 2);
				},
				heads: (x, c) => {
					const counts = new Map<number, { n: number; name: string }>();
					for (const m of x.list) {
						counts.set(m.pid, {
							n: (counts.get(m.pid)?.n ?? 0) + 1,
							name: m.name,
						});
					}
					const top = [...counts.values()].toSorted((a, b) => b.n - a.n)[0]!;
					return [
						`${top.name}: ${top.n} MVPs and counting`,
						`Repeat winners: who has won the MVP more than once`,
						`${top.n} MVP awards for ${top.name}`,
						`The multiple MVPs`,
					];
				},
				build: (x, r, c) => {
					const counts = new Map<
						number,
						{ n: number; name: string; years: number[] }
					>();
					for (const m of x.list) {
						const cur = counts.get(m.pid) ?? { n: 0, name: m.name, years: [] };
						cur.n += 1;
						cur.years.push(m.season);
						counts.set(m.pid, cur);
					}
					const multi = [...counts.entries()]
						.filter(([, v]) => v.n >= 2)
						.toSorted((a, b) => b[1].n - a[1].n);
					return [
						P(
							`${plural(multi.length, "player")} ${multi.length === 1 ? "has" : "have"} won more than one MVP: `,
							...andList(
								multi.map(([pid, v]) => [
									c.pl(pid, v.name),
									` (${v.n}: ${v.years.toSorted((a, b) => a - b).join(", ")})`,
								]),
							),
							".",
						),
						P(
							`Among ${x.list.length} winners on file, ${counts.size} different players have taken the award.`,
						),
					];
				},
			},
			{
				id: "age",
				fit: (x) => x.list.filter((m) => m.age).length >= 5,
				heads: (x, c) => [
					`How old are MVPs? The ledger says ${Math.round(x.list.filter((m) => m.age).reduce((a, m) => a + m.age!, 0) / x.list.filter((m) => m.age).length)}`,
					`The youngest and oldest MVPs through ${c.season - 1}`,
					`Age and the MVP`,
					`MVP ages, from youngest to oldest`,
				],
				build: (x, r, c) => {
					const aged = x.list
						.filter((m) => m.age)
						.toSorted((a, b) => a.age! - b.age!);
					const young = aged[0]!;
					const old = aged.at(-1)!;
					return [
						P(
							`The youngest MVP on file was `,
							c.pl(young.pid, young.name),
							` at ${young.age} (${young.season}); the oldest, `,
							c.pl(old.pid, old.name),
							` at ${old.age} (${old.season}). The average winner was ${fmt1(aged.reduce((a, m) => a + m.age!, 0) / aged.length)} years old.`,
						),
					];
				},
			},
		],
	}),
);

// ---- A look back --------------------------------------------------------------------

addPage(
	arcPage<{
		year: number;
		champ?: NonNullable<Ctx["f"]["champions"]>[number];
		mvp?: NonNullable<Ctx["f"]["mvps"]>[number];
		best?: { t: NPTeam; won: number; lost: number };
	}>({
		id: "years-ago",
		section: "history",
		kicker: "Looking back",
		eds: ALL_EDS,
		beat: "features",
		prep: (c) => {
			const year = [10, 7, 5]
				.map((n) => c.season - n)
				.find((y) => y >= c.f.firstSeason);
			if (year === undefined) {
				return undefined;
			}
			const champ = c.f.champions?.find((x) => x.season === year);
			const mvp = c.f.mvps?.find((x) => x.season === year);
			let best: { t: NPTeam; won: number; lost: number } | undefined;
			for (const t of c.f.teams) {
				const h = t.hist?.find((x) => x.season === year);
				if (h && (!best || winp(h) > winp(best))) {
					best = { t, won: h.won, lost: h.lost };
				}
			}
			if (!champ && !mvp && !best) {
				return undefined;
			}
			return { year, champ, mvp, best };
		},
		photo: (x) => x.mvp?.pid,
		arcs: [
			{
				id: "then",
				heads: (x, c) => {
					const n = c.season - x.year;
					return [
						`${n} years ago: the ${x.year} season`,
						`Looking back to ${x.year}`,
						`The league in ${x.year}, ${n} years on`,
						`Turn back ${n} years: ${x.year} in review`,
					];
				},
				build: (x, r, c) => {
					const n = c.season - x.year;
					const items = [];
					if (x.champ) {
						items.push({
							lead: "Champion:",
							segs: [
								c.tl(x.champ.tid, c.tfull(x.champ.tid)),
								x.champ.runnerUp !== undefined && c.team(x.champ.runnerUp)
									? [", over the ", c.tl(x.champ.runnerUp)]
									: "",
								x.champ.fmvp ? `; Finals MVP ${x.champ.fmvp}.` : ".",
							].flat(),
						});
					}
					if (x.mvp) {
						items.push({
							lead: "MVP:",
							segs: [
								c.pl(x.mvp.pid, x.mvp.name),
								x.mvp.age ? `, ${x.mvp.age}.` : ".",
							],
						});
					}
					if (x.best) {
						items.push({
							lead: "Best record:",
							segs: [
								c.tl(x.best.t.tid, c.tfull(x.best.t.tid)),
								` at ${x.best.won}-${x.best.lost}.`,
							],
						});
					}
					return [
						P(`What the league looked like ${n} years ago (${x.year}):`),
						{ type: "notebook", items },
					];
				},
			},
		],
	}),
);

// ---- The title ledger -----------------------------------------------------------------

addPage(
	arcPage<{ champs: NonNullable<Ctx["f"]["champions"]> }>({
		id: "dynasties",
		section: "history",
		kicker: "The title ledger",
		eds: ALL_EDS,
		beat: "league",
		prep: (c) => {
			const champs = (c.f.champions ?? []).filter(
				(x) => x.season >= c.season - 10,
			);
			return champs.length >= 5 ? { champs } : undefined;
		},
		arcs: [
			{
				id: "decade",
				heads: (x, c) => {
					const counts = new Map<number, number>();
					for (const ch of x.champs) {
						counts.set(ch.tid, (counts.get(ch.tid) ?? 0) + 1);
					}
					const top = [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]!;
					return [
						`${plural(counts.size, "champion")} in ${x.champs.length} years: who ${c.T("owns", "owned")} the decade`,
						`The ${c.tn(top[0])} and the title ledger`,
						`${top[1] > 1 ? `${top[1]} banners in ${x.champs.length} seasons` : "No dynasty in sight"}`,
						`Champions, season by season`,
					];
				},
				build: (x, r, c) => {
					const counts = new Map<number, number>();
					for (const ch of x.champs) {
						counts.set(ch.tid, (counts.get(ch.tid) ?? 0) + 1);
					}
					const ranked = [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
					return [
						P(
							`From ${x.champs[0]!.season} to ${x.champs.at(-1)!.season}, ${plural(counts.size, "franchise")} ${counts.size === 1 ? "has" : "have"} won the title; the most successful, the `,
							c.tl(ranked[0]![0], c.tfull(ranked[0]![0])),
							`, ${c.T("have", "had")} ${plural(ranked[0]![1], "championship")}.`,
						),
						{
							type: "timeline",
							items: x.champs
								.toSorted((a, b) => b.season - a.season)
								.map((ch) => ({
									label: String(ch.season),
									segs: [
										c.tl(ch.tid, c.tfull(ch.tid)),
										ch.runnerUp !== undefined && c.team(ch.runnerUp)
											? [" over ", c.tl(ch.runnerUp)]
											: "",
									].flat(),
								})),
						},
					];
				},
			},
		],
	}),
);

// ---- Record chase ------------------------------------------------------------------------

addPage(
	arcPage<{
		top: { t: NPTeam; season: number; won: number; lost: number }[];
		best?: NPTeam;
	}>({
		id: "record-book",
		section: "history",
		kicker: "The record book",
		eds: SEASON_EDS,
		beat: "numbers",
		prep: (c) => {
			const all: { t: NPTeam; season: number; won: number; lost: number }[] =
				[];
			for (const t of c.f.teams) {
				for (const h of t.hist ?? []) {
					all.push({ t, season: h.season, won: h.won, lost: h.lost });
				}
			}
			if (all.length < 30) {
				return undefined;
			}
			const top = all.toSorted((a, b) => winp(b) - winp(a)).slice(0, 5);
			return { top, best: c.rows[0] };
		},
		arcs: [
			{
				id: "chase",
				heads: (x, c) => [
					`The all-time best records, and ${c.T("where the leaders sit", "where this season landed")}`,
					`The ${x.top[0]!.season} ${x.top[0]!.t.name} (${x.top[0]!.won}-${x.top[0]!.lost}) still ${c.T("stand", "stood")} as the record`,
					`Chasing history: the five best seasons on file through ${c.season - 1}`,
					`Record book: the best ${x.top.length} regular seasons`,
				],
				build: (x, r, c) => {
					const b = x.best;
					const beats = b && winp(b) > winp(x.top[0]!);
					return [
						P(
							b
								? `This season's best team, the `
								: "The best regular season on file is the ",
							b ? c.tl(b.tid) : "",
							b
								? ` (${record(b)}), ${c.T("is", "was")} ${beats ? "ahead of" : "behind"} the record of ${x.top[0]!.won}-${x.top[0]!.lost}${c.done ? "" : `, with ${b.gp} games played`}, set by the ${x.top[0]!.season} `
								: `${x.top[0]!.season} `,
							c.tl(x.top[0]!.t.tid, c.tfull(x.top[0]!.t.tid)),
							".",
						),
						table(
							["Season", "Team", "Record"],
							x.top.map((y) => [
								[String(y.season)],
								[c.tl(y.t.tid, c.tfull(y.t.tid))],
								[`${y.won}-${y.lost}`],
							]),
							[0, 2],
						),
					];
				},
			},
		],
	}),
);

// ---- Worst to first ----------------------------------------------------------------------

addPage(
	arcPage<{ jumps: { t: NPTeam; was: number; now: number }[] }>({
		id: "worst-to-first",
		section: "history",
		kicker: "Climbers and fallers",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const withPrev = c.f.teams.filter((t) => t.prev && t.gp >= 10);
			if (withPrev.length < 10) {
				return undefined;
			}
			const prevRank = (t: NPTeam) =>
				withPrev.filter((o) => winp(o.prev!) > winp(t.prev!)).length + 1;
			const jumps = withPrev
				.map((t) => ({ t, was: prevRank(t), now: c.rank(t.tid) }))
				.filter((x) => x.now > 0)
				.toSorted((a, b) => b.was - b.now - (a.was - a.now));
			if (jumps[0]!.was - jumps[0]!.now < 8) {
				return undefined;
			}
			return { jumps: jumps.slice(0, 4) };
		},
		arcs: [
			{
				id: "climb",
				heads: (x, c) => {
					const j = x.jumps[0]!;
					return [
						`${c.tn(j.t.tid)}: from ${ordinal(j.was)} to ${ordinal(j.now)}`,
						`The biggest climb in the standings: ${c.tn(j.t.tid)}`,
						`${c.tn(j.t.tid)} ${c.T("move", "moved")} up ${j.was - j.now} places`,
						`Last year's ${ordinal(j.was)}, this year's ${ordinal(j.now)}`,
					];
				},
				build: (x, r, c) => {
					const j = x.jumps[0]!;
					return [
						P(
							`The `,
							c.tl(j.t.tid, c.tfull(j.t.tid)),
							` ranked ${ordinal(j.was)} by record last season (${record(j.t.prev!)}). ${c.T("This season they are", "This season they finished")} ${ordinal(j.now)} (${record(j.t)}), a climb of ${j.was - j.now} places.`,
						),
						table(
							["Team", "Last year", "This year", "Places"],
							x.jumps.map((y) => [
								[c.tl(y.t.tid, c.tfull(y.t.tid))],
								[`${ordinal(y.was)} (${record(y.t.prev!)})`],
								[`${ordinal(y.now)} (${record(y.t)})`],
								[signed(y.was - y.now, 0)],
							]),
							[3],
						),
					];
				},
			},
		],
	}),
);

// ---- Franchise win milestones -------------------------------------------------------------

addPage(
	arcPage<{
		marks: { t: NPTeam; total: number; mark: number; crossed: boolean }[];
	}>({
		id: "franchise-marks",
		section: "history",
		kicker: "Franchise marks",
		eds: SEASON_EDS,
		beat: "numbers",
		prep: (c) => {
			const marks: {
				t: NPTeam;
				total: number;
				mark: number;
				crossed: boolean;
			}[] = [];
			for (const t of c.f.teams) {
				if ((t.hist?.length ?? 0) < 5) {
					continue;
				}
				const before = (t.hist ?? []).reduce((a, h) => a + h.won, 0);
				const now = before + t.won;
				const step = now < 1000 ? 250 : 500;
				const crossedMark = Math.floor(now / step) * step;
				if (crossedMark > 0 && before < crossedMark && now >= crossedMark) {
					marks.push({ t, total: now, mark: crossedMark, crossed: true });
				} else if (step * Math.ceil(now / step) - now <= 40) {
					marks.push({
						t,
						total: now,
						mark: step * Math.ceil(now / step),
						crossed: false,
					});
				}
			}
			return marks.length > 0
				? {
						marks: marks.toSorted(
							(a, b) =>
								Number(b.crossed) - Number(a.crossed) || b.mark - a.mark,
						),
					}
				: undefined;
		},
		arcs: [
			{
				id: "wins",
				heads: (x, c) => {
					const m = x.marks[0]!;
					return [
						m.crossed
							? `${c.tn(m.t.tid)} ${c.T("pass", "passed")} ${grp(m.mark)} franchise wins`
							: `${c.tn(m.t.tid)} ${c.T("are", "were")} closing on ${grp(m.mark)} franchise wins`,
						`Franchise milestone: ${grp(m.mark)} wins`,
						`${grp(m.total)} wins and counting for the ${m.t.name}`,
						`A round number for the ${m.t.name}`,
					];
				},
				build: (x, r, c) => [
					P(
						`${plural(x.marks.length, "team")} ${x.marks.length === 1 ? "sits" : "sit"} at or near a round franchise win total, counted from ${c.f.firstSeason}.`,
					),
					{
						type: "list",
						items: x.marks
							.slice(0, 6)
							.map((m) => [
								c.tl(m.t.tid, c.tfull(m.t.tid)),
								m.crossed
									? ` ${c.T("have passed", "passed")} ${grp(m.mark)} wins (${grp(m.total)} in all)`
									: ` ${c.T("stand", "stood")} at ${grp(m.total)}, ${m.mark - m.total} short of ${grp(m.mark)}`,
							]),
					},
				],
			},
		],
	}),
);

// ---- The all-time list on the move ------------------------------------------------------------

addPage(
	arcPage<{
		rows: {
			pid: number;
			name: string;
			was: number;
			now: number;
			pts: number;
		}[];
	}>({
		id: "rankings-move",
		section: "history",
		kicker: "All-time rankings",
		eds: SEASON_EDS,
		beat: "numbers",
		prep: (c) => {
			const board = c.f.careerBoard ?? [];
			if (board.length < 10) {
				return undefined;
			}
			const rows = board.map((b) => {
				const p = c.player(b.pid);
				const add = p ? p.pts * p.gp : 0;
				return { pid: b.pid, name: b.name, base: b.pts, total: b.pts + add };
			});
			const was = rows.toSorted((a, b) => b.base - a.base);
			const now = rows.toSorted((a, b) => b.total - a.total);
			const moved = now
				.map((r, i) => ({
					pid: r.pid,
					name: r.name,
					now: i + 1,
					was: was.findIndex((w) => w.pid === r.pid) + 1,
					pts: Math.round(r.total),
				}))
				.filter((r) => r.was > r.now)
				.slice(0, 5);
			return moved.length > 0 ? { rows: moved } : undefined;
		},
		photo: (x) => x.rows[0]?.pid,
		arcs: [
			{
				id: "climbers",
				heads: (x, c) => [
					`${x.rows[0]!.name} ${c.T("moves", "moved")} up the all-time scoring list`,
					`Climbing the career list: ${x.rows[0]!.name} to No. ${x.rows[0]!.now}`,
					`The all-time list shifts in ${c.season}`,
					`${x.rows[0]!.name} ${c.T("passes", "passed")} ${x.rows[0]!.was - x.rows[0]!.now} names`,
				],
				build: (x, r, c) => [
					P(`Changes to the all-time rankings this season, biggest first:`),
					{
						type: "list",
						items: x.rows.map((m) => [
							c.pl(m.pid, m.name),
							` moves from No. ${m.was} to No. ${m.now} among the league's top scorers (${grp(m.pts)} points${c.done ? "" : " so far"})`,
						]),
					},
				],
			},
		],
	}),
);
