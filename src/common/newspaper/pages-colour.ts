/* eslint-disable unicorn/prefer-single-call */
// Colour pages: letters, classifieds, the hot stove, overheard in the arena, the forecast, the quiz, and the preseason pages (title odds, five questions, last year's leaders). Colour is the newsroom's own voice: the facts are real, the voices are invented, and the page says so.

import { Ctx, P } from "./ctx.ts";
import {
	PLAYED,
	PRE_ONLY,
	addPage,
	arcPage,
	table,
} from "./kit.ts";
import { fmt1, money, ordinal, plural, record, winp } from "./text.ts";
import type { Block, NPPlayer, NPTeam, Seg } from "./types.ts";

const city = (c: Ctx, t: NPTeam) => t.region || c.f.leagueName;

// ---- Letters ----------------------------------------------------------------------

addPage(
	arcPage<{
		worst: NPTeam;
		best: NPTeam;
		scorer?: NPPlayer;
		hot?: NPTeam;
	}>({
		id: "letters",
		section: "colour",
		kicker: "Letters to the editor",
		eds: PLAYED,
		beat: "opinion",
		colour: true,
		prep: (c) => {
			if (c.rows.length < 8 || c.f.gp < 10) {
				return undefined;
			}
			const worst = c.rows.at(-1)!;
			const best = c.rows[0]!;
			const scorer = c.qual.toSorted((a, b) => b.pts - a.pts)[0];
			const hot = c.f.teams
				.filter((t) => t.streak >= 4)
				.toSorted((a, b) => b.streak - a.streak)[0];
			return { worst, best, scorer, hot };
		},
		arcs: [
			{
				id: "bag",
				heads: (x, c) => [
					`Letters: a ${city(c, x.worst)} reader, ${x.worst.lost} losses in`,
					`Mailbag: ${x.best.name} fans write in, and so do the others`,
					`Dear editor: the ${c.season} mailbag`,
					`Your letters, answered with numbers`,
				],
				build: (x, r, c) => {
					const out: Block[] = [];
					const w = x.worst;
					out.push(
						c.quote(
							c.cycle("letter-worst", [
								`Sir: ${w.lost} losses${c.done ? "" : " and counting"}. I would like the ${w.name} to explain themselves, or at least to win something soon.`,
								`I have followed the ${w.name} for years and ${record(w)} is a cruel thing to do to a person.`,
								`Dear editor, tell me again that a ${record(w)} team is "building".`,
							]),
							`A reader in ${city(c, w)}`,
						),
					);
					out.push(
						c.quote(
							c.cycle("letter-best", [
								`Why does nobody believe in the ${x.best.name}? They ${c.T("are", "were")} ${record(x.best)}.`,
								`The ${x.best.name} ${c.T("are", "were")} ${record(x.best)} and the paper still ${c.T("buries", "buried")} them on page nine.`,
								`Not one headline calls the ${x.best.name} the best team around, and ${record(x.best)} says it.`,
							]),
							`A reader in ${city(c, x.best)}`,
						),
					);
					if (x.scorer) {
						out.push(
							c.quote(
								c.cycle("letter-scorer", [
									`${x.scorer.name} ${c.T("is putting", "put")} up ${fmt1(x.scorer.pts)} a night and I ${c.T("am", "was")} told to look at the standings instead.`,
									`If ${fmt1(x.scorer.pts)} points a game is not worth a front page, I do not know what is.`,
									`I would watch ${x.scorer.name} score ${fmt1(x.scorer.pts)} a game even if the team ${c.T("were", "had been")} ${c.rec(x.scorer.tid)}.`,
								]),
								`A reader in ${city(c, c.team(x.scorer.tid) ?? x.best)}`,
							),
						);
					}
					out.push(
						P(
							c.cycle("letters-reply", [
								`The editors reply: the ${w.name} ${c.T("are", "were")} ${record(w)}, and the standings are what they are.`,
								`Our answer: ${record(w)} is ${c.T("what the ledger says", "what the ledger said")}, and the ledger does not take requests.`,
								`The editors thank every reader and note that the ${x.best.name} ${c.T("are", "were")} ${record(x.best)}.`,
							]),
						),
					);
					return out;
				},
			},
		],
	}),
);

// ---- Classifieds -------------------------------------------------------------------

addPage(
	arcPage<{ items: Seg[][] }>({
		id: "classifieds",
		section: "colour",
		kicker: "Classifieds",
		eds: PLAYED,
		beat: "opinion",
		colour: true,
		prep: (c) => {
			if (c.rows.length < 8) {
				return undefined;
			}
			const items: Seg[][] = [];
			const worst = c.rows.at(-1)!;
			items.push([
				c.cycle("cl-worst", [
					`FOR SALE: season tickets, ${city(c, worst)}, lightly used after ${worst.lost} losses; ask for the `,
					`WANTED: a first win streak for the ${worst.won}-${worst.lost} `,
					`NOTICE: one losing habit, ${worst.lost} losses and no receipts, from the `,
				]),
				c.tl(worst.tid),
				".",
			]);
			const scoring = c.f.teams.filter((t) => t.pts !== undefined).toSorted((a, b) => a.pts! - b.pts!);
			if (scoring.length >= 8) {
				const t = scoring[0]!;
				items.push([
					`HELP WANTED: a second scorer for the `,
					c.tl(t.tid),
					`, ${c.T("last", "last")} in the league at ${fmt1(t.pts!)} points a game; references not required.`,
				]);
			}
			const defense = c.f.teams.filter((t) => t.oppPts !== undefined).toSorted((a, b) => b.oppPts! - a.oppPts!);
			if (defense.length >= 8) {
				const t = defense[0]!;
				items.push([
					`WANTED: a defender, any defender, for the `,
					c.tl(t.tid),
					` (${fmt1(t.oppPts!)} points allowed a game); must be able to stand in front of things.`,
				]);
			}
			const threes = c.qual
				.filter((p) => p.tp * p.gp >= 30)
				.toSorted((a, b) => a.tpp - b.tpp)[0];
			if (threes) {
				items.push([
					`LOST: one three-point shot, last seen at ${fmt1(threes.tpp)}% in the hands of `,
					c.pl(threes.pid),
					"; reward offered.",
				]);
			}
			const hot = c.f.teams.filter((t) => t.streak >= 4).toSorted((a, b) => b.streak - a.streak)[0];
			if (hot) {
				items.push([
					`FOUND: a winning streak, ${hot.streak} games long, currently in the possession of the `,
					c.tl(hot.tid),
					"; do not disturb.",
				]);
			}
			const old = c.qual.filter((p) => p.min >= 20).toSorted((a, b) => b.age - a.age)[0];
			if (old) {
				items.push([
					`FOR SALE: one very reliable veteran, ${old.age} years old and still playing ${fmt1(old.min)} minutes a night; inquire with `,
					c.pl(old.pid),
					".",
				]);
			}
			return items.length >= 3 ? { items } : undefined;
		},
		arcs: [
			{
				id: "ads",
				heads: (x, c) => [
					`Classifieds: ${c.season} edition`,
					`Wanted, for sale, lost and found: ${c.season}`,
					`The back page: classifieds`,
					`Small ads, big numbers`,
				],
				build: (x) => [
					{ type: "list", items: x.items },
				],
			},
		],
	}),
);

// ---- The hot stove -------------------------------------------------------------------

addPage(
	arcPage<{ cands: { p: NPPlayer; t: NPTeam }[] }>({
		id: "hot-stove",
		section: "colour",
		kicker: "Hot stove",
		eds: PLAYED,
		beat: "moves",
		colour: true,
		prep: (c) => {
			if (c.f.gp < 10) {
				return undefined;
			}
			const cands = c.f.players
				.filter((p) => p.contractExp !== undefined && p.contractExp <= c.season && p.gp > 0)
				.map((p) => ({ p, t: c.team(p.tid) }))
				.filter((x): x is { p: NPPlayer; t: NPTeam } => x.t !== undefined && winp(x.t) < 0.45)
				.toSorted((a, b) => b.p.ovr - a.p.ovr)
				.slice(0, 4);
			return cands.length >= 2 ? { cands } : undefined;
		},
		photo: (x) => x.cands[0]?.p.pid,
		arcs: [
			{
				id: "expiring",
				heads: (x, c) => [
					`Rumor mill: could ${x.cands[0]!.p.name} be on the move?`,
					`Hot stove: expiring deals on losing teams`,
					`Speculation, ${c.season}: ${x.cands[0]!.t.name} and the contract-year question`,
					`Names to watch before the ${c.season} market opens`,
				],
				build: (x, r, c) => [
					P(
						`${plural(x.cands.length, "player")} on expiring contracts ${c.T("play", "played")} for teams winning less than 45% of their games in ${c.season}: `,
						...x.cands.flatMap((y, i): Seg[] => [
							i > 0 ? (i === x.cands.length - 1 ? " and " : ", ") : "",
							c.pl(y.p.pid),
							` (${y.p.ovr} rating, `,
							c.tl(y.t.tid),
							` ${record(y.t)})`,
						]),
						".",
					),
				],
			},
		],
	}),
);

// ---- Overheard ------------------------------------------------------------------------

addPage(
	arcPage<{ lead: NPTeam; scorer: NPPlayer; worst: NPTeam }>({
		id: "overheard",
		section: "colour",
		kicker: "Overheard",
		eds: PLAYED,
		beat: "opinion",
		colour: true,
		prep: (c) => {
			const scorer = c.qual.toSorted((a, b) => b.pts - a.pts)[0];
			if (!scorer || c.rows.length < 8 || c.f.gp < 10) {
				return undefined;
			}
			return { lead: c.rows[0]!, scorer, worst: c.rows.at(-1)! };
		},
		photo: (x) => x.scorer.pid,
		arcs: [
			{
				id: "arena",
				heads: (x, c) => [
					`Overheard at the arena: ${c.season}`,
					`Courtside chatter`,
					`What they ${c.T("are", "were")} saying in the cheap seats`,
					`Overheard: ${x.scorer.name}, ${x.lead.name} and the long walk home`,
				],
				build: (x, r, c) => [
					c.quote(
						c.cycle("oh-1", [
							`He ${c.T("is", "was")} at ${fmt1(x.scorer.pts)} a game, and at some point you stop calling it a hot streak.`,
							`${fmt1(x.scorer.pts)} points a night and he still ${c.T("looks", "looked")} bored.`,
							`Ask me who scores the most and I will say ${x.scorer.name} before you finish the question, ${fmt1(x.scorer.pts)} a game or not.`,
							`${x.scorer.name} at ${fmt1(x.scorer.pts)} a night ${c.T("makes", "made")} the other ${x.scorer.pos}s look like they ${c.T("are", "were")} jogging.`,
							`I ${c.T("have", "had")} stopped checking the box score on ${x.scorer.name}; ${fmt1(x.scorer.pts)} is just the number now.`,
						]),
						"a usher in " + city(c, c.team(x.scorer.tid) ?? x.lead),
					),
					c.quote(
						c.cycle("oh-2", [
							`The ${x.lead.name} ${c.T("are", "were")} ${record(x.lead)}, and nobody wants to see them in April.`,
							`${record(x.lead)}, and the ${x.lead.name} still ${c.T("act", "acted")} like they owe somebody money.`,
							`I have seen what ${record(x.lead)} looks like from the other bench, and it looks like a long night against the ${x.lead.name}.`,
							`Nobody in the league enjoys the ${x.lead.name} at ${record(x.lead)}, and they know it.`,
							`If the ${x.lead.name} ${c.T("keep", "kept")} ${record(x.lead)} going, the rest of us ${c.T("are", "were")} playing for second.`,
						]),
						"a visiting coach",
					),
					c.quote(
						c.cycle("oh-3", [
							`${x.worst.lost} losses${c.done ? "" : " so far"} for the ${x.worst.name}, and the popcorn ${c.T("has been", "was")} the highlight.`,
							`We ${c.T("keep", "kept")} coming back to watch the ${x.worst.name} at ${record(x.worst)}, and I could not tell you why.`,
							`${record(x.worst)} and the lines for the concessions in ${city(c, x.worst)} are still long.`,
							`The ${x.worst.name} ${c.T("are", "were")} ${record(x.worst)}, but the hot dogs ${c.T("are", "were")} undefeated.`.replace("undefeated", "perfect"),
							`${x.worst.won} wins is ${x.worst.won === 1 ? "a number" : "a number"} you can count on two hands, and we ${c.T("still count", "still counted")} every one.`,
						]),
						"a season-ticket holder in " + city(c, x.worst),
					),
			],
			},
		],
	}),
);

// ---- The forecast ---------------------------------------------------------------------------

addPage(
	arcPage<{ hot: NPTeam[]; cold: NPTeam[] }>({
		id: "forecast",
		section: "colour",
		kicker: "Forecast",
		eds: ["midseason", "playoffs"],
		beat: "opinion",
		colour: true,
		prep: (c) => {
			const hot = c.f.teams.filter((t) => t.streak >= 3).toSorted((a, b) => b.streak - a.streak).slice(0, 3);
			const cold = c.f.teams.filter((t) => t.streak <= -3).toSorted((a, b) => a.streak - b.streak).slice(0, 3);
			return hot.length + cold.length >= 3 ? { hot, cold } : undefined;
		},
		arcs: [
			{
				id: "weather",
				heads: (x, c) => [
					`Forecast: heat in ${city(c, x.hot[0] ?? x.cold[0]!)}, ice elsewhere`,
					`The league weather report, ${c.season}`,
					`Hot fronts and cold snaps around the league`,
					`Today's forecast: streaks`,
				],
				build: (x, r, c) => [
					{
						type: "notebook",
						items: [
							...(x.hot.length
								? [
										{
											lead: "Heat advisory:",
											segs: x.hot.flatMap((t, i): Seg[] => [
												i > 0 ? ", " : "",
												c.tl(t.tid),
												` (${t.streak} straight wins)`,
											]),
										},
									]
								: []),
							...(x.cold.length
								? [
										{
											lead: "Freeze warning:",
											segs: x.cold.flatMap((t, i): Seg[] => [
												i > 0 ? ", " : "",
												c.tl(t.tid),
												` (${-t.streak} straight losses)`,
											]),
										},
									]
								: []),
						],
					},
				],
			},
		],
	}),
);

// ---- The quiz ---------------------------------------------------------------------------------

addPage(
	arcPage<{ qs: { q: string; a: Seg[] }[] }>({
		id: "quiz",
		section: "colour",
		kicker: "Numbers desk quiz",
		eds: PLAYED,
		beat: "numbers",
		colour: true,
		prep: (c) => {
			const qs: { q: string; a: Seg[] }[] = [];
			const scorer = c.qual.toSorted((a, b) => b.pts - a.pts)[0];
			if (scorer) {
				qs.push({
					q: `Who ${c.T("leads", "led")} the ${c.season} league in scoring (a ${scorer.pos} for a team in ${city(c, c.team(scorer.tid) ?? c.rows[0]!)})?`,
					a: [c.pl(scorer.pid), ` (${fmt1(scorer.pts)} a game)`],
				});
			}
			const home = c.f.teams
				.filter((t) => t.wonHome + t.lostHome >= 8)
				.toSorted((a, b) => winp({ won: b.wonHome, lost: b.lostHome }) - winp({ won: a.wonHome, lost: a.lostHome }))[0];
			if (home) {
				qs.push({
					q: `Which team has the best home record in ${c.season}, ${home.wonHome}-${home.lostHome} (its city starts with ${city(c, home).charAt(0)})?`,
					a: [c.tl(home.tid, c.tfull(home.tid)), ` (${home.wonHome}-${home.lostHome})`],
				});
			}
			const old = c.qual.filter((p) => p.min >= 15).toSorted((a, b) => b.age - a.age)[0];
			if (old) {
				qs.push({
					q: `Who is the oldest regular in the ${c.season} league, at ${old.age}?`,
					a: [c.pl(old.pid), `, ${old.age}`],
				});
			}
			const rb = c.qual.toSorted((a, b) => b.trb - a.trb)[0];
			if (rb) {
				qs.push({
					q: `Who grabs the most rebounds a game in ${c.season}, ${fmt1(rb.trb)}?`,
					a: [c.pl(rb.pid), ` (${fmt1(rb.trb)})`],
				});
			}
			const best = c.rows[0];
			if (best) {
				qs.push({
					q: `Which team has the best record in ${c.season}${c.done ? "" : " right now"}, ${record(best)}?`,
					a: [c.tl(best.tid, c.tfull(best.tid)), ` (${record(best)})`],
				});
			}
			return qs.length >= 4 ? { qs } : undefined;
		},
		arcs: [
			{
				id: "quiz",
				heads: (x, c) => [
					`Quiz: ${x.qs.length} questions from the ${c.season} numbers`,
					`Test yourself: the ${c.season} league in ${x.qs.length} questions`,
					`Pop quiz from the numbers desk`,
					`How well do you know the ${c.season} season?`,
				],
				build: (x) => [
					{
						type: "list",
						ordered: true,
						items: x.qs.map((q) => [q.q]),
					},
					{ type: "sub", text: "Answers" },
					{
						type: "list",
						ordered: true,
						items: x.qs.map((q) => q.a),
					},
				],
			},
		],
	}),
);

// ---- Preseason ---------------------------------------------------------------------------------

addPage(
	arcPage<{ odds: { t: NPTeam; p: number; ovr: number }[] }>({
		id: "odds-board",
		section: "teams",
		kicker: "Title odds",
		eds: PRE_ONLY,
		beat: "league",
		prep: (c) => {
			const rated = c.f.teams
				.map((t) => ({ t, ovr: c.teamOvr(t.tid) }))
				.filter((x): x is { t: NPTeam; ovr: number } => x.ovr !== undefined);
			if (rated.length < 8) {
				return undefined;
			}
			const mean = rated.reduce((a, x) => a + x.ovr, 0) / rated.length;
			const weights = rated.map((x) => Math.exp((x.ovr - mean) / 1.8));
			const total = weights.reduce((a, b) => a + b, 0);
			const odds = rated
				.map((x, i) => ({ ...x, p: weights[i]! / total }))
				.toSorted((a, b) => b.p - a.p)
				.slice(0, 8);
			return { odds };
		},
		arcs: [
			{
				id: "odds",
				heads: (x, c) => [
					`${c.tn(x.odds[0]!.t.tid)} lead the preseason title odds`,
					`Title odds: the ${c.season} board`,
					`Who wins it all? The numbers' answer`,
					`A one-in-${Math.round(1 / x.odds[0]!.p)} favorite: ${c.tn(x.odds[0]!.t.tid)}`,
				],
				build: (x, r, c) => [
					{
						type: "aside",
						segs: [
							c.cycle("odds-note", [
								`A model, not a bookmaker: the ${c.season} odds come only from the average rating of each team's eight best players.`,
								`These odds know one thing, the rating of each roster's eight best players, and nothing about luck, injuries or coaching in ${c.season}.`,
								`Title chances for ${c.season}, from roster ratings alone; think of it as a model with strong opinions.`,
								`Not a betting line: just ${x.odds.length} rosters of ${c.season} ranked by the average rating of their eight best players.`,
							]),
						],
					},
					table(
						["Team", "Roster rating", "Title chance"],
						x.odds.map((y) => [
							[c.tl(y.t.tid, c.tfull(y.t.tid))],
							[fmt1(y.ovr)],
							[`${(y.p * 100).toFixed(1)}%`],
						]),
						[1, 2],
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ rows: NPPlayer[] }>({
		id: "last-year-leaders",
		section: "players",
		kicker: "Last year's leaders",
		eds: PRE_ONLY,
		beat: "numbers",
		prep: (c) => {
			const rows = c.f.players
				.filter((p) => p.prevLine && p.prevLine.gp >= 40)
				.toSorted((a, b) => b.prevLine!.pts - a.prevLine!.pts)
				.slice(0, 8);
			return rows.length >= 5 ? { rows } : undefined;
		},
		photo: (x) => x.rows[0]?.pid,
		arcs: [
			{
				id: "scoring",
				heads: (x, c) => [
					`Last year's top scorers: where ${x.rows[0]!.name} and the others play now`,
					`The ${c.season - 1} scoring leaders, and their new addresses`,
					`Back for more: last season's scoring list`,
					`Last season's best scorers, one season older`,
				],
				build: (x, r, c) => [
					P(
						`Last season's scoring leaders among regulars, with their teams for ${c.season}:`,
					),
					table(
						["Player", "Last season", "Age", "Team now"],
						x.rows.map((p) => [
							[c.pl(p.pid)],
							[`${fmt1(p.prevLine!.pts)} ppg`],
							[String(p.age)],
							[c.tl(p.tid, c.team(p.tid)?.abbrev)],
						]),
						[2],
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ qs: Seg[][] }>({
		id: "five-questions",
		section: "features",
		kicker: "Five questions",
		eds: PRE_ONLY,
		beat: "features",
		prep: (c) => {
			const teams = c.f.teams;
			const rated = teams
				.map((t) => ({ t, ovr: c.teamOvr(t.tid) }))
				.filter((x): x is { t: NPTeam; ovr: number } => x.ovr !== undefined)
				.toSorted((a, b) => b.ovr - a.ovr);
			if (rated.length < 8) {
				return undefined;
			}
			const qs: Seg[][] = [];
			qs.push([
				`Can the `,
				c.tl(rated[0]!.t.tid),
				` live up to the best roster rating in the league (${fmt1(rated[0]!.ovr)})?`,
			]);
			const champ = teams.find((t) => t.titles.includes(c.season - 1));
			if (champ) {
				qs.push([
					`Does the defending champion `,
					c.tl(champ.tid),
					` rank ${ordinal(c.ovrRank(champ.tid) ?? 0)} by roster rating hold up?`,
				]);
			}
			const young = c.f.players.filter((p) => p.age <= 22).toSorted((a, b) => b.pot - a.pot)[0];
			if (young) {
				qs.push([
					`How far can `,
					c.pl(young.pid),
					` (${young.age}, ${young.ovr} now, ${young.pot} potential) climb?`,
				]);
			}
			const old = c.f.players.toSorted((a, b) => b.ovr - a.ovr).find((p) => p.age >= 34);
			if (old) {
				qs.push([
					`Is ${old.age} too old for `,
					c.pl(old.pid),
					` to stay a ${old.ovr}?`,
				]);
			}
			const big = c.f.signings.toSorted((a, b) => b.amount - a.amount)[0];
			if (big) {
				qs.push([
					`Will `,
					c.pl(big.pid, big.name),
					`'s ${money(big.amount)} a year look smart in April?`,
				]);
			}
			return qs.length >= 4 ? { qs } : undefined;
		},
		arcs: [
			{
				id: "questions",
				heads: (x, c) => [
					`${plural(x.qs.length, "question")} for the ${c.season} season`,
					`Five things to watch before opening night`,
					`The questions of ${c.season}`,
					`Preseason: what the numbers cannot answer yet`,
				],
				build: (x, _r, c) => [
					P(
						c.cycle("five-intro", [
							`Nothing has been played in ${c.season}, so the numbers can only ask:`,
							`${plural(x.qs.length, "question")} the ${c.season} ratings cannot answer yet:`,
							`Before a game is played in ${c.season}, here is what the ratings leave open:`,
						]),
					),
					{ type: "list", ordered: true, items: x.qs },
				],
			},
		],
	}),
);
