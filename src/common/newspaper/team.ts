/* eslint-disable unicorn/prefer-single-call */
// The local team edition: one team's own front page.

import { Ctx, P } from "./ctx.ts";
import { table } from "./kit.ts";
import { champFacts, seriesOf, sides } from "./front.ts";
import {
	andList,
	capFirst,
	fmt1,
	money,
	ordinal,
	plural,
	poss,
	record,
	signed,
	winp,
} from "./text.ts";
import type { Article, Block, NPPlayer, NPTeam, Seg } from "./types.ts";

export const teamLead = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t) {
		return undefined;
	}
	const r = c.rng("team-lead");
	const tn = t.name;
	const rk = c.rank(tid);
	const nT = c.rows.length;
	const champ = c.done && c.f.champion === tid;
	const body: Block[] = [];
	let heads: string[];

	if (c.pre || t.gp === 0) {
		heads = [
			`${tn} open the ${c.season} season`,
			`The ${c.season} ${tn}: a season preview`,
			`A new season for the ${tn}`,
		];
		if (t.prev) {
			body.push(
				P(
					`Last season the `,
					c.tl(tid, c.tfull(tid)),
					` went ${record(t.prev)} and ${c.fate(t.prev.playoffRoundsWon)}.`,
				),
			);
		}
		const roster = c.f.players
			.filter((p) => p.tid === tid)
			.toSorted((a, b) => b.ovr - a.ovr)
			.slice(0, 4);
		if (roster.length >= 2) {
			body.push(
				P(
					c.noRatings
						? "The best players on the roster: "
						: "The highest-rated players on the roster: ",
					...andList(
						roster.map((p) => [
							c.pl(p.pid),
							c.noRatings ? ` (age ${p.age})` : ` (${p.ovr}, age ${p.age})`,
						]),
					),
					".",
				),
			);
		}
	} else {
		if (champ) {
			heads = [
				`${tn} are champions`,
				`Champions: the ${c.season} ${tn}`,
				`The ${tn} win the ${c.season} title`,
			];
		} else if (c.done) {
			const fate = c.fate(t.playoffRoundsWon);
			heads = [
				`${tn} go ${record(t)} and ${fate}`,
				`A ${record(t)} year for the ${tn}, who ${fate}`,
			];
		} else if (c.inPlayoffs) {
			heads =
				t.playoffRoundsWon >= 0
					? [
							`${tn} (${record(t)}) in the playoffs`,
							`Playoff time for the ${record(t)} ${tn}`,
						]
					: [
							`${tn} finish ${record(t)}, out of the playoffs`,
							`No playoffs for the ${record(t)} ${tn}`,
						];
		} else {
			heads = [
				`${tn} are ${record(t)} after ${plural(t.gp, "game")}`,
				`The ${tn} sit ${ordinal(rk)} of ${nT} at ${record(t)}`,
				`The ${tn} so far: ${record(t)}`,
			];
		}
		body.push(
			P(
				"The ",
				c.tl(tid, c.tfull(tid)),
				` ${c.T("are", "went")} ${record(t)}${c.done ? "" : ` through ${plural(t.gp, "game")}`}, ${ordinal(rk)} of ${nT} in the league`,
				t.pts !== undefined && t.oppPts !== undefined
					? `, ${c.T("scoring", "scoring")} ${fmt1(t.pts)} and allowing ${fmt1(t.oppPts)} a game.`
					: ".",
			),
		);
		const home = `${t.wonHome}-${t.lostHome}`;
		const away = `${t.wonAway}-${t.lostAway}`;
		body.push(
			P(
				`At home they ${c.T("are", "were")} ${home}; on the road, ${away}.`,
				t.streak >= 3
					? ` They ${c.T("have won", "closed on")} ${t.streak} straight.`
					: t.streak <= -3
						? ` They ${c.T("have lost", "closed on a run of")} ${-t.streak} ${c.T("straight", "losses")}.`
						: "",
			),
		);
		if (t.prev) {
			const d = winp(t) - winp(t.prev);
			body.push(
				P(
					`A year ago they went ${record(t.prev)}${Math.abs(d) >= 0.08 ? `; this is ${d > 0 ? "a clear step forward" : "a step back"}` : ", much the same"}.`,
				),
			);
		}
		const path = seriesOf(c, tid);
		if (path.length > 0) {
			const legs = path.map(({ s, round }) => {
				const { me, opp } = sides(s, tid);
				if (!opp) {
					return [`a bye in the ${c.roundPhrase(round)}`];
				}
				const won = (me?.won ?? 0) > opp.won;
				return [
					`${won ? "beat" : (me?.won ?? 0) === opp.won ? "were level with" : "lost to"} the `,
					c.tl(opp.tid),
					` ${me?.won ?? 0}-${opp.won} in the ${c.roundPhrase(round)}`,
				];
			});
			body.push(
				P(
					`In the playoffs, as the No. ${sides(path[0]!.s, tid).me?.seed} seed, they `,
					...andList(legs),
					".",
				),
			);
		}
		if (champ) {
			const x = champFacts(c);
			if (x) {
				body.push(
					P(
						x.nTitles === 1
							? "It is the first title in franchise history."
							: `It is the franchise's ${ordinal(x.nTitles)} title.`,
					),
				);
			}
		}
	}
	const top = c.teamPlayers(tid)[0];
	return {
		id: "lead",
		size: "lead",
		kicker: `Local edition · ${c.tfull(tid)}`,
		head: c.freshHead(r, heads)!,
		deck: c.pre
			? ["Nothing has been played yet."]
			: c.mid
				? [`${plural(t.gp, "game")} played, the rest still to come.`]
				: undefined,
		byline: c.byline("local", t.region),
		photoPid: top?.pid,
		body,
	};
};

export const teamPlayerFeatures = (c: Ctx, tid: number): Article[] => {
	if (c.pre) {
		return [];
	}
	const tn = c.tn(tid);
	return c
		.teamPlayers(tid)
		.filter((p) => p.gp >= 5)
		.slice(0, 3)
		.map((p: NPPlayer, i) => {
			const r = c.rng("team-player", p.pid);
			const aw = c.awardsOf(p.pid).filter((a) => !a.group);
			const body: Block[] = [
				P(
					c.pl(p.pid),
					`, ${p.age}, ${c.T("is averaging", "averaged")} ${c.lineWords(p)} in ${plural(p.gp, "game")} for the `,
					c.tl(tid),
					`, with ${fmt1(p.ws)} win shares.`,
				),
			];
			const k = c.statRank(p.pid, "pts");
			if (k && k <= 10) {
				body.push(
					P(
						`That ${c.T("ranks", "ranked")} ${ordinal(k)} in the league in scoring.`,
					),
				);
			}
			if (p.prevOvr !== undefined && p.ovr !== p.prevOvr && !c.noRatings) {
				body.push(
					P(
						`His rating ${p.ovr > p.prevOvr ? "rose" : "fell"} from ${p.prevOvr} to ${p.ovr} over the year.`,
					),
				);
			}
			if (aw.length > 0) {
				body.push(P(`Honors: ${aw.map((a) => a.name).join(", ")}.`));
			}
			if (
				p.contractExp !== undefined &&
				p.contractAmount !== undefined &&
				p.contractExp <= c.season + 1
			) {
				body.push(P(`His contract runs through ${p.contractExp}.`));
			}
			return {
				id: `team-player-${p.pid}`,
				size: i === 0 ? "feature" : "brief",
				kicker:
					i === 0 ? (c.done ? "Player of the year" : "Team leader") : "Profile",
				head: c.freshHead(r, [
					`${p.name}: ${fmt1(p.pts)} points a game for the ${tn}`,
					i === 0
						? `${p.name} ${c.T("leads", "led")} the ${tn} with ${fmt1(p.ws)} win shares`
						: `${poss(p.name)} season in numbers`,
					`${p.name}, ${p.age}, ${c.T("keeps", "kept")} producing for the ${tn}`,
				])!,
				byline: c.byline("local"),
				photoPid: p.pid,
				body,
			};
		});
};

export const teamGames = (c: Ctx, tid: number): Article | undefined => {
	const mine = c.f.games.filter((g) => g.won.tid === tid || g.lost.tid === tid);
	if (mine.length === 0) {
		return undefined;
	}
	const wins = mine
		.filter((g) => g.won.tid === tid)
		.toSorted((a, b) => b.won.pts - b.lost.pts - (a.won.pts - a.lost.pts));
	const losses = mine
		.filter((g) => g.lost.tid === tid)
		.toSorted((a, b) => b.won.pts - b.lost.pts - (a.won.pts - a.lost.pts));
	const items: { lead: string; segs: (string | ReturnType<Ctx["pl"]>)[] }[] =
		[];
	const sl = (g: (typeof mine)[number]) =>
		`${c.team(g.won.tid)?.abbrev} ${g.won.pts}, ${c.team(g.lost.tid)?.abbrev} ${g.lost.pts}`;
	const star = (g: (typeof mine)[number]) => g.stars.find((s) => s.tid === tid);
	for (const [lead, g] of [
		["Best win:", wins[0]],
		["Worst loss:", losses[0]],
	] as const) {
		if (g) {
			const s = star(g);
			items.push({
				lead,
				segs: [
					c.gl(g.gid, tid, sl(g)),
					g.playoffs ? " (playoffs)" : "",
					s ? [`; `, c.pl(s.pid, s.name), ` had ${s.pts} points`].flat() : [],
					".",
				].flat(),
			});
		}
	}
	const ot = mine.filter((g) => g.overtimes > 0);
	if (ot.length > 0) {
		items.push({
			lead: "Overtime:",
			segs: [
				`${plural(ot.length, "game")} went to overtime; they won ${ot.filter((g) => g.won.tid === tid).length}.`,
			],
		});
	}
	const topNight = mine
		.flatMap((g) => g.stars.filter((s) => s.tid === tid).map((s) => ({ s, g })))
		.toSorted((a, b) => b.s.pts - a.s.pts)[0];
	if (topNight) {
		items.push({
			lead: "Top scoring night:",
			segs: [
				c.pl(topNight.s.pid, topNight.s.name),
				`, ${topNight.s.pts} points in `,
				c.gl(topNight.g.gid, tid, sl(topNight.g)),
				".",
			],
		});
	}
	return {
		id: "team-games",
		size: "brief",
		kicker: "Scoreboard",
		head: `The ${c.tn(tid)} games to remember`,
		byline: c.byline("local"),
		body: [{ type: "notebook", items }],
	};
};

// ---- More of the local edition: injuries, rookies, the road through the playoffs, ranks, the franchise, the roster and back issues ----

const short = (p: Pick<NPPlayer, "pts" | "trb" | "ast">) =>
	`${fmt1(p.pts)}/${fmt1(p.trb)}/${fmt1(p.ast)}`;

export const teamInjuries = (c: Ctx, tid: number): Article | undefined => {
	const list = c.f.injuries
		.filter((i) => i.tid === tid && i.gamesRemaining > 0)
		.toSorted((a, b) => b.gamesRemaining - a.gamesRemaining);
	if (list.length === 0 || c.done) {
		return undefined;
	}
	const tn = c.tn(tid);
	const r = c.rng("team-injuries");
	const total = list.reduce((a, i) => a + i.gamesRemaining, 0);
	return {
		id: "team-injuries",
		type: "team-injuries",
		size: "brief",
		kicker: "Training room",
		head: c.freshHead(r, [
			`${list[0]!.name} out ${plural(list[0]!.gamesRemaining, "more game")} for the ${tn}`,
			`${plural(list.length, "player")} on the ${tn} injury list`,
			`The ${tn} are missing ${total} games of players`,
		])!,
		byline: c.byline("local"),
		photoPid: list[0]!.pid,
		body: [
			{
				type: "list",
				items: list.map((i) => [
					c.pl(i.pid, i.name),
					`: ${i.type.toLowerCase()}, ${plural(i.gamesRemaining, "more game")}`,
					c.player(i.pid) ? ` (${short(c.player(i.pid)!)} this season)` : "",
				]),
			},
		],
	};
};

export const teamRookies = (c: Ctx, tid: number): Article | undefined => {
	const rookies = c.f.players
		.filter((p) => p.tid === tid && p.rookie && (c.pre || p.gp > 0))
		.toSorted((a, b) => (c.pre ? b.pot - a.pot : b.min - a.min));
	const drafted = c.done ? c.f.draft.filter((d) => d.tid === tid) : [];
	if (rookies.length === 0 && drafted.length === 0) {
		return undefined;
	}
	const tn = c.tn(tid);
	const r = c.rng("team-rookies");
	const body: Block[] = [];
	if (rookies.length > 0) {
		body.push(
			P(
				c.pre
					? "First-year players on the roster: "
					: `${plural(rookies.length, "rookie")} ${c.T("have", "had")} a role: `,
				...andList(
					rookies
						.slice(0, 4)
						.map((p) => [
							c.pl(p.pid),
							c.pre
								? c.noRatings
									? ` (age ${p.age})`
									: ` (${p.ovr} now, ${p.pot} potential)`
								: ` (${fmt1(p.pts)} points in ${fmt1(p.min)} minutes, ${plural(p.gp, "game")})`,
						]),
				),
				".",
			),
		);
	}
	if (drafted.length > 0) {
		body.push(
			table(
				["Pick", "Player", "Pos", "Age", ...(c.noRatings ? [] : ["Ovr/Pot"])],
				drafted
					.toSorted((a, b) => a.round - b.round || a.pick - b.pick)
					.slice(0, 6)
					.map((d) => [
						[`${d.round}-${d.pick}`],
						[c.pl(d.pid, d.name)],
						[d.pos],
						[String(d.age)],
						...(c.noRatings ? [] : [[`${d.ovr}/${d.pot}`]]),
					]),
				[3],
			),
		);
	}
	return {
		id: "team-rookies",
		type: "team-rookies",
		size: "brief",
		kicker: "Rookie watch",
		head: c.freshHead(r, [
			rookies[0] ? `${rookies[0].name} leads the ${tn} rookies` : null,
			`The ${tn} and their newcomers`,
			`First-year report: the ${tn}`,
		])!,
		byline: c.byline("draft"),
		photoPid: rookies[0]?.pid,
		body,
	};
};

// The whole road through the playoffs: every series, and every game of it we have a score for
export const teamPlayoffPath = (c: Ctx, tid: number): Article | undefined => {
	const path = seriesOf(c, tid);
	if (path.length === 0) {
		return undefined;
	}
	const t = c.team(tid)!;
	const r = c.rng("team-path");
	const body: Block[] = [];
	const finishedRound = (round: number) => c.done || round < c.f.currentRound;
	for (const { s, round } of path) {
		const { me, opp } = sides(s, tid);
		if (!opp || !me) {
			body.push({ type: "sub", text: capFirst(c.roundPhrase(round)) });
			body.push(P(`A bye in the ${c.roundPhrase(round)}.`));
			continue;
		}
		const done = finishedRound(round);
		const games = s.gids
			.map((gid) => c.f.games.find((g) => g.gid === gid))
			.filter((g): g is NonNullable<typeof g> => g !== undefined);
		body.push({
			type: "sub",
			text:
				me.won + opp.won === 0 && !done
					? `${capFirst(c.roundPhrase(round))}: yet to tip off`
					: `${capFirst(c.roundPhrase(round))}: ${me.won > opp.won ? (done ? "won" : "lead") : me.won < opp.won ? (done ? "lost" : "trail") : "level"} ${Math.max(me.won, opp.won)}-${Math.min(me.won, opp.won)}`,
		});
		body.push(
			P(
				`No. ${me.seed} seed against No. ${opp.seed} `,
				c.tl(opp.tid, c.tfull(opp.tid)),
				`${opp.seed < me.seed ? ", the higher seed" : ""}.`,
			),
		);
		if (games.length > 0) {
			body.push({
				type: "timeline",
				items: games.map((g, i) => ({
					label: `Game ${i + 1}`,
					segs: [
						g.won.tid === tid ? "W " : "L ",
						c.gl(
							g.gid,
							tid,
							`${c.team(g.won.tid)?.abbrev} ${g.won.pts}, ${c.team(g.lost.tid)?.abbrev} ${g.lost.pts}`,
						),
						g.overtimes > 0 ? " (OT)" : "",
					],
				})),
			});
		}
	}
	const star = c.f.players
		.filter((p) => p.tid === tid && p.po && p.po.gp >= 2)
		.toSorted((a, b) => b.po!.pts - a.po!.pts)[0];
	if (star?.po) {
		body.push(
			P(
				"Their leading playoff scorer ",
				c.T("is", "was"),
				" ",
				c.pl(star.pid),
				` (${fmt1(star.po.pts)} points, ${fmt1(star.po.trb)} rebounds and ${fmt1(star.po.ast)} assists a game in ${plural(star.po.gp, "game")}).`,
			),
		);
	}
	return {
		id: "team-path",
		type: "team-path",
		size: "feature",
		kicker: "The playoff road",
		head: c.freshHead(r, [
			`${poss(`The ${t.name}`)} road through the ${c.season} playoffs`,
			`Series by series: the ${t.name} in the postseason`,
			`${t.name} in the playoffs, game by game`,
		])!,
		byline: c.byline("playoffs", t.region),
		photoPid: star?.pid,
		body,
	};
};

export const teamRanks = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t || (t.gp === 0 && !c.pre)) {
		return undefined;
	}
	const rank = (f: (x: NPTeam) => number | undefined, high = true) => {
		const mine = f(t);
		if (mine === undefined) {
			return undefined;
		}
		const all = c.f.teams.map(f).filter((v): v is number => v !== undefined);
		return all.filter((v) => (high ? v > mine : v < mine)).length + 1;
	};
	const n = c.f.teams.length;
	const rows: { label: string; value: string; rank: number | undefined }[] =
		c.pre
			? [
					{
						label: "Roster rating",
						value: fmt1(c.teamOvr(tid) ?? 0),
						rank: c.ovrRank(tid),
					},
				]
			: [
					{
						label: "Win percentage",
						value: `.${Math.round(winp(t) * 1000)}`,
						rank: rank((x) => (x.gp > 0 ? winp(x) : undefined)),
					},
					{
						label: "Points scored",
						value: t.pts !== undefined ? fmt1(t.pts) : "",
						rank: rank((x) => x.pts),
					},
					{
						label: "Points allowed",
						value: t.oppPts !== undefined ? fmt1(t.oppPts) : "",
						rank: rank((x) => x.oppPts, false),
					},
					{
						label: "Point differential",
						value:
							t.pts !== undefined && t.oppPts !== undefined
								? signed(t.pts - t.oppPts)
								: "",
						rank: rank((x) =>
							x.pts !== undefined && x.oppPts !== undefined
								? x.pts - x.oppPts
								: undefined,
						),
					},
					{
						label: "At home",
						value: `${t.wonHome}-${t.lostHome}`,
						rank: rank((x) =>
							x.wonHome + x.lostHome > 0
								? x.wonHome / (x.wonHome + x.lostHome)
								: undefined,
						),
					},
					{
						label: "On the road",
						value: `${t.wonAway}-${t.lostAway}`,
						rank: rank((x) =>
							x.wonAway + x.lostAway > 0
								? x.wonAway / (x.wonAway + x.lostAway)
								: undefined,
						),
					},
					{
						label: "Close games",
						value: t.close ? `${t.close.w}-${t.close.l}` : "",
						rank:
							t.close && t.close.w + t.close.l >= 6
								? rank((x) =>
										x.close && x.close.w + x.close.l >= 6
											? x.close.w / (x.close.w + x.close.l)
											: undefined,
									)
								: undefined,
					},
					{
						label: "Roster rating",
						value: fmt1(c.teamOvr(tid) ?? 0),
						rank: c.ovrRank(tid),
					},
				];
	const shown = rows.filter(
		(x) =>
			x.value !== "" &&
			x.rank !== undefined &&
			x.value !== "0.0" &&
			!(c.noRatings && x.label === "Roster rating"),
	);
	if (shown.length < 3) {
		return undefined;
	}
	const best = shown.toSorted((a, b) => a.rank! - b.rank!)[0]!;
	const worst = shown.toSorted((a, b) => b.rank! - a.rank!)[0]!;
	const r = c.rng("team-ranks");
	return {
		id: "team-ranks",
		type: "team-ranks",
		size: "brief",
		kicker: "Where they rank",
		head: c.freshHead(r, [
			`The ${t.name}: ${ordinal(best.rank!)} in ${best.label.toLowerCase()}, ${ordinal(worst.rank!)} in ${worst.label.toLowerCase()}`,
			`The ${t.name} by the numbers, ranked among ${n} teams`,
			`Strengths and weaknesses: the ${t.name}`,
		])!,
		byline: c.byline("numbers"),
		body: [
			P(
				`Best: ${best.label.toLowerCase()} (${best.value}, ${ordinal(best.rank!)} of ${n}). Weakest: ${worst.label.toLowerCase()} (${worst.value}, ${ordinal(worst.rank!)}).`,
			),
			table(
				["", "Value", `Rank of ${n}`],
				shown.map((x) => [[x.label], [x.value], [ordinal(x.rank!)]]),
				[1, 2],
			),
		],
	};
};

export const teamFranchise = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t || !t.hist || t.hist.length < 3) {
		return undefined;
	}
	const hist = t.hist.toSorted((a, b) => b.season - a.season);
	const wins = hist.reduce((a, h) => a + h.won, 0);
	const best = hist.toSorted((a, b) => winp(b) - winp(a))[0]!;
	const worst = hist.toSorted((a, b) => winp(a) - winp(b))[0]!;
	const playoffs = hist.filter((h) => h.playoffRoundsWon >= 0).length;
	const r = c.rng("team-franchise");
	const tn = t.name;
	return {
		id: "team-franchise",
		type: "team-franchise",
		size: "feature",
		kicker: "Franchise history",
		head: c.freshHead(r, [
			`${hist.length} seasons of the ${tn}: ${t.titles.length > 0 ? plural(t.titles.length, "title") : "no title yet"}`,
			`The ${tn} through the years`,
			`${grp(wins)} wins and counting for the ${tn}`,
		])!,
		byline: c.byline("features", t.region),
		body: [
			P(
				`Since ${t.firstSeason}, the `,
				c.tl(tid, c.tfull(tid)),
				` have won ${grp(wins)} regular-season games in ${plural(hist.length, "season")} before this one, reaching the playoffs ${plural(playoffs, "time")}${t.titles.length > 0 ? ` and winning titles in ${t.titles.join(", ")}` : ""}.`,
			),
			P(
				`The best season on file ${c.T("is", "was")} ${best.season} (${record(best)}); the worst, ${worst.season} (${record(worst)}).`,
			),
			table(
				["Season", "Record", "Result"],
				hist
					.slice(0, 10)
					.map((h) => [
						[String(h.season)],
						[record(h)],
						[
							h.playoffRoundsWon < 0
								? "missed the playoffs"
								: h.playoffRoundsWon >= c.f.numRounds
									? "champions"
									: `lost in the ${c.roundPhrase(h.playoffRoundsWon)}`,
						],
					]),
			),
		],
	};
};

const grp = (n: number) => Math.round(n).toLocaleString("en-US");

export const teamRoster = (c: Ctx, tid: number): Article | undefined => {
	const ps = c.f.players
		.filter((p) => p.tid === tid && (c.pre || p.gp > 0))
		.toSorted((a, b) => (c.pre ? b.ovr - a.ovr : b.ws - a.ws))
		.slice(0, 12);
	if (ps.length < 5) {
		return undefined;
	}
	const t = c.team(tid)!;
	const r = c.rng("team-roster");
	return {
		id: "team-roster",
		type: "team-roster",
		size: "feature",
		kicker: "The roster",
		head: c.freshHead(r, [
			`The ${t.name} roster at a glance`,
			`${ps.length} names that make the ${t.name}`,
			`Who is on the ${t.name}`,
		])!,
		byline: c.byline("local", t.region),
		body: [
			P(
				c.pre
					? c.noRatings
						? `The ${t.name} roster, best players first.`
						: `The ${t.name} roster, best rating first.`
					: `The ${t.name} rotation by win shares${c.done ? "" : " so far"}.`,
			),
			table(
				c.pre
					? c.noRatings
						? ["Player", "Pos", "Age", "Salary"]
						: ["Player", "Pos", "Age", "Ovr/Pot", "Salary"]
					: ["Player", "Pos", "Age", "PTS/REB/AST", "WS", "Salary"],
				ps.map((p) =>
					c.pre
						? [
								[c.pl(p.pid)],
								[p.pos],
								[String(p.age)],
								...(c.noRatings ? [] : [[`${p.ovr}/${p.pot}`]]),
								[p.contractAmount ? money(p.contractAmount) : "–"],
							]
						: [
								[c.pl(p.pid)],
								[p.pos],
								[String(p.age)],
								[short(p)],
								[fmt1(p.ws)],
								[p.contractAmount ? money(p.contractAmount) : "–"],
							],
				),
				c.pre ? [2] : [2, 4],
			),
			t.payroll
				? P(
						`Contracts on the roster add up to ${money(t.payroll)}${c.f.salaryCap ? `, ${t.payroll > c.f.salaryCap ? `${money(t.payroll - c.f.salaryCap)} over` : `${money(c.f.salaryCap - t.payroll)} under`} the ${money(c.f.salaryCap)} cap` : ""}.`,
					)
				: P(""),
		],
	};
};

export const teamRecordBook = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t || t.gp < 10) {
		return undefined;
	}
	const items: { lead: string; segs: Seg[] }[] = [];
	if (t.bestStreak) {
		items.push({
			lead: "Longest winning streak:",
			segs: [`${t.bestStreak} games.`],
		});
	}
	if (t.worstStreak) {
		items.push({
			lead: "Longest losing streak:",
			segs: [`${t.worstStreak} games.`],
		});
	}
	if (t.close && t.close.w + t.close.l >= 4) {
		items.push({
			lead: "Games decided by five or fewer:",
			segs: [`${t.close.w}-${t.close.l}.`],
		});
	}
	if (t.ot && t.ot.w + t.ot.l >= 1) {
		items.push({ lead: "In overtime:", segs: [`${t.ot.w}-${t.ot.l}.`] });
	}
	const e = c.pyth(t);
	if (e !== undefined) {
		items.push({
			lead: "Wins the scoring margin predicted:",
			segs: [`${fmt1(e)} against ${t.won} actual.`],
		});
	}
	if (items.length < 3) {
		return undefined;
	}
	const r = c.rng("team-record-book");
	return {
		id: "team-record-book",
		type: "team-record-book",
		size: "brief",
		kicker: "Season notebook",
		head: c.freshHead(r, [
			`The ${t.name} season in streaks and close calls`,
			`${t.name}: ${t.bestStreak ?? 0} straight at the best`,
			`The ${t.name} notebook`,
		])!,
		byline: c.byline("local"),
		body: [{ type: "notebook", items }],
	};
};

export const teamLetter = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t || t.gp < 10) {
		return undefined;
	}
	const top = c.teamPlayers(tid)[0];
	const r = c.rng("team-letter");
	const text = c.cycle("team-letter", [
		`Sir: the ${t.name} ${c.T("are", "went")} ${record(t)} and I ${c.T("have", "had")} thoughts. Mostly about ${top ? top.name : "the bench"}.`,
		`I have a ${t.region} ticket and a ${record(t)} team; the least you can do is explain it.`,
		`${top ? `${top.name} at ${fmt1(top.pts)} a game` : `${record(t)}`} is the only reason I still read the ${t.name} coverage.`,
		`Dear editor: ${c.T("is", "was")} ${record(t)} what we ${c.T("were", "were")} promised?`,
		`${record(t)}. The ${t.name} are my team and I will say no more.`,
	]);
	return {
		id: "team-letter",
		type: "team-letter",
		size: "brief",
		kicker: "Letters",
		colour: true,
		head: c.freshHead(r, [
			`A ${t.region} reader writes`,
			`Letters: ${t.name} fans on the ${record(t)}`,
			`From the mailbag: the ${t.name}`,
		])!,
		byline: c.byline("opinion"),
		body: [c.quote(text, `A reader in ${t.region}`)],
	};
};

// Links to other editions: the league paper, this team's other issues and the division rivals
export const teamBackIssues = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t) {
		return undefined;
	}
	const items: Seg[][] = [
		[
			{
				paper: { team: "all", season: c.season },
				t: `The ${c.season} league edition`,
			},
		],
	];
	if (c.season > c.f.firstSeason) {
		items.push([
			{
				paper: { team: tid, season: c.season - 1 },
				t: `The ${t.name} local edition of ${c.season - 1}`,
			},
		]);
		items.push([
			{
				paper: { team: "all", season: c.season - 1 },
				t: `The ${c.season - 1} league edition`,
			},
		]);
	}
	const rivals = c.f.teams.filter((x) => x.did === t.did && x.tid !== tid);
	if (rivals.length > 0) {
		items.push([
			"Division rivals' local editions: ",
			...andList(
				rivals.map((x) => [
					{ paper: { team: x.tid, season: c.season }, t: x.name } as Seg,
				]),
			),
		]);
	}
	return {
		id: "team-back-issues",
		type: "team-back-issues",
		size: "brief",
		kicker: "In the archive",
		head: `More from the ${t.name} desk`,
		byline: c.byline("local"),
		body: [{ type: "list", items }],
	};
};
