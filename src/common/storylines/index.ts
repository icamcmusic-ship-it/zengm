import {
	isLeagueIndex,
	LeagueIndex,
	type SeasonLine,
} from "../wrapped/league.ts";
import type { WLeague } from "../wrapped/types.ts";
import {
	fmtNum,
	fmtRecord,
	fmtWinp,
	isBadText,
	listText,
	ordinal,
	pickBy,
	plural,
	polish,
	span,
	winPct,
} from "../wrapped/util.ts";
import {
	isActive,
	overlapsSeason,
	plainText,
	pLink,
	regRows,
	seasonsOf,
	spanOf,
	stints,
	titleSeasons,
	tLink,
	type Draft,
	type Kind,
	type Story,
	champion,
	lineOf,
	teamsInSeason,
	careerOf,
} from "./kit.ts";
import { GAME_KINDS } from "./kindsGames.ts";
import { PLAYER_KINDS } from "./kindsPlayers.ts";
import { TEAM_KINDS } from "./kindsTeams.ts";

export { overlapsSeason, plainText, pLink, spanOf, stints, tLink };
export type { Story, StoryShape } from "./kit.ts";

const KINDS: Kind[] = [
	{
		kind: "Ring chaser",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const titles = titleSeasons(X, p);
				const first = titles[0];
				if (first === undefined) {
					continue;
				}
				const before = seasonsOf(regRows(p)).filter((s) => s < first).length;
				const age = first - p.bornYear;
				if (before < 8 || age < 31) {
					continue;
				}
				const tid = champion(X, first)!.tid;
				out.push({
					key: `${p.pid}`,
					kind: "Ring chaser",
					shape: "career",
					season: first,
					score: 40 + before * 3,
					pids: [p.pid],
					tids: [tid],
					heads: [
						`${p.name} finally got his ring`,
						`After ${before} seasons, a title for ${p.name}`,
					],
					bodies: [
						`${pLink(p)} won his first title with the ${tLink(X, tid, first)} in ${first}, at age ${age}, after ${plural(before, "season")} without one.`,
					],
					evidence: [
						["Seasons before", `${before}`],
						["Age", `${age}`],
						["Title", `${first}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Homecoming",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const st = stints(p);
				if (st.length < 3) {
					continue;
				}
				const home = st[0]!;
				const back = st.slice(2).find((s) => s.tid === home.tid);
				if (!back || home.to - home.from < 2) {
					continue;
				}
				const away = back.from - home.to - 1;
				if (away < 2) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Homecoming",
					shape: "career",
					season: back.from,
					span: [home.from, back.from],
					score: 20 + away * 3 + home.ws / 2,
					pids: [p.pid],
					tids: [home.tid],
					heads: [`${p.name} came home`, `Back where it started: ${p.name}`],
					bodies: [
						`${pLink(p)} began his career with the ${tLink(X, home.tid, home.from)} (${span(home.from, home.to)}), spent ${plural(away, "season")} elsewhere, and returned in ${back.from}.`,
					],
					evidence: [
						["First stint", span(home.from, home.to)],
						["Away", plural(away, "season")],
						["Back", `${back.from}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "The one that got away",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const st = stints(p);
				if (st.length < 2) {
					continue;
				}
				const first = st[0]!;
				const after = st.slice(1).filter((s) => s.tid !== first.tid);
				const ws = after.reduce((a, s) => a + s.ws, 0);
				const as = p.awards.filter(
					(a) => a.type === "All-Star" && a.season > first.to,
				).length;
				if (first.to - first.from > 3 || ws < 30 || first.ws > ws / 3) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "The one that got away",
					shape: "career",
					season: first.to,
					score: ws / 2 + as * 4,
					pids: [p.pid],
					tids: [first.tid],
					heads: [
						`The ${X.teamName(first.tid, first.to)} let ${p.name} go`,
						`${p.name}: the one that got away`,
					],
					bodies: [
						`${pLink(p)} left the ${tLink(X, first.tid, first.to)} after ${first.to} with ${fmtNum(first.ws, 1)} win shares there, then piled up ${fmtNum(ws, 1)} more elsewhere${as > 0 ? `, with ${plural(as, "All-Star selection")}` : ""}.`,
					],
					evidence: [
						["WS with them", fmtNum(first.ws, 1)],
						["WS after", fmtNum(ws, 1)],
						["All-Star after", `${as}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Drought",
		find: (X) => {
			const out: Draft[] = [];
			const decided = X.decidedSeasons();
			const now = decided.at(-1);
			if (now === undefined) {
				return out;
			}
			for (const t of teamsInSeason(X, now)) {
				const hist = X.teamHistory(t.tid).filter((x) => X.decided(x.season));
				const titles = X.titlesOf(t.tid);
				const last = titles.at(-1);
				const from = last ?? hist[0]!.season - 1;
				const n = now - from;
				if (n < 10) {
					continue;
				}
				out.push({
					key: `${t.tid}`,
					kind: "Drought",
					shape: "team",
					season: now,
					span: [from + 1, now],
					score: n * 2,
					pids: [],
					tids: [t.tid],
					heads: [
						`${n} years and counting for the ${t.region} ${t.name}`,
						`The ${t.name} are still waiting`,
					],
					bodies: [
						last !== undefined
							? `The ${tLink(X, t.tid, now)} last won it all in ${last}. That was ${plural(n, "season")} ago.`
							: `The ${tLink(X, t.tid, now)} have played ${plural(hist.length, "season")} without a title.`,
					],
					evidence: [
						["Seasons", `${n}`],
						["Last title", last !== undefined ? `${last}` : "Never"],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Cinderella run",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const ps = X.series(s);
				if (!ps) {
					continue;
				}
				const seeds = ps.rounds[0]!.flatMap((m) => [m.home, m.away]).filter(
					(x) => x !== undefined,
				);
				const maxSeed = Math.max(...seeds.map((x) => x.seed));
				const n = X.numRounds(s);
				for (const side of seeds) {
					const ts = X.team(side.tid, s);
					if (
						!ts ||
						side.seed < Math.max(4, maxSeed / 2) ||
						ts.playoffRoundsWon < n - 1
					) {
						continue;
					}
					const won = ts.playoffRoundsWon >= n;
					out.push({
						key: `${s}|${side.tid}`,
						kind: "Cinderella run",
						shape: "playoffs",
						season: s,
						score: side.seed * 6 + (won ? 30 : 0),
						pids: [],
						tids: [side.tid],
						heads: won
							? [
									`A No. ${side.seed} seed won the title`,
									`Cinderella wins it all in ${s}`,
								]
							: [
									`A No. ${side.seed} seed reached the finals`,
									`The ${ts.name}’ unlikely run`,
								],
						bodies: [
							`The ${tLink(X, side.tid, s)} went ${fmtRecord(ts.won, ts.lost, ts.tied, ts.otl)} and entered the ${s} playoffs as the No. ${side.seed} seed, then ${won ? "won the title" : "made it all the way to the finals"}.`,
						],
						evidence: [
							["Seed", `${side.seed}`],
							["Record", fmtRecord(ts.won, ts.lost, ts.tied, ts.otl)],
							["Result", won ? "Champions" : "Finals"],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Collapse",
		find: (X) => {
			const out: Draft[] = [];
			for (const b of X.L.teamSeasons) {
				const a = X.team(b.tid, b.season - 1);
				if (
					!a ||
					b.won + b.lost < 20 ||
					(b.season === X.L.season && !X.decided(b.season))
				) {
					continue;
				}
				const d = winPct(a.won, a.lost, a.tied) - winPct(b.won, b.lost, b.tied);
				if (d < 0.25 || winPct(a.won, a.lost, a.tied) < 0.6) {
					continue;
				}
				// The best player who left
				const gone = X.lines(b.season - 1)
					.filter(
						(l) =>
							l.tid === b.tid &&
							!X.lines(b.season).some(
								(m) => m.pid === l.pid && m.tids.includes(b.tid),
							),
					)
					.sort((x, y) => y.ws - x.ws)[0];
				out.push({
					key: `${b.tid}|${b.season}`,
					kind: "Collapse",
					shape: "team",
					season: b.season,
					span: [b.season - 1, b.season],
					score: d * 100 + (gone ? 5 : 0),
					pids: gone ? [gone.pid] : [],
					tids: [b.tid],
					heads: [
						`The ${b.region} ${b.name} fell apart`,
						`From ${fmtRecord(a.won, a.lost, a.tied)} to ${fmtRecord(b.won, b.lost, b.tied)}`,
					],
					bodies: [
						`The ${tLink(X, b.tid, b.season)} went ${fmtRecord(a.won, a.lost, a.tied)} in ${b.season - 1} and ${fmtRecord(b.won, b.lost, b.tied)} in ${b.season}.${gone && gone.ws >= 4 ? ` ${pLink(gone)} (${fmtNum(gone.ws, 1)} WS the year before) was no longer on the team.` : ""}`,
					],
					evidence: [
						["Before", fmtWinp(winPct(a.won, a.lost, a.tied))],
						["After", fmtWinp(winPct(b.won, b.lost, b.tied))],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Worst to first",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const c = champion(X, s);
				if (!c) {
					continue;
				}
				for (let back = 1; back <= 3; back++) {
					const prev = teamsInSeason(X, s - back);
					const mine = X.team(c.tid, s - back);
					if (!mine || prev.length < 4) {
						continue;
					}
					const rank =
						[...prev]
							.sort(
								(a, b) =>
									winPct(a.won, a.lost, a.tied) - winPct(b.won, b.lost, b.tied),
							)
							.indexOf(mine) + 1;
					if (rank <= 3) {
						out.push({
							key: `${s}|${c.tid}`,
							kind: "Worst to first",
							shape: "team",
							season: s,
							score: 45 + (4 - back) * 6 + (4 - rank) * 2,
							pids: [],
							tids: [c.tid],
							heads: [
								`Worst to first: the ${c.region} ${c.name}`,
								`From the bottom to a title in ${plural(back, "season")}`,
							],
							bodies: [
								`In ${s - back} the ${tLink(X, c.tid, s - back)} had the ${rank === 1 ? "" : `${ordinal(rank)}-`}worst record in the league (${fmtRecord(mine.won, mine.lost, mine.tied)}). In ${s} they won the title.`,
							],
							evidence: [
								["Low point", `${s - back}`],
								["Record then", fmtRecord(mine.won, mine.lost, mine.tied)],
								["Title", `${s}`],
							],
						});
						break;
					}
				}
			}
			return out;
		},
	},
	{
		kind: "One-team legend",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const rows = regRows(p);
				const tids = new Set(rows.map((r) => r.tid));
				const n = seasonsOf(rows).length;
				if (tids.size !== 1 || n < 10) {
					continue;
				}
				const tid = rows[0]!.tid;
				const c = careerOf(X, p);
				const active = isActive(X, p);
				out.push({
					key: `${p.pid}`,
					kind: "One-team legend",
					shape: "career",
					season: rows.at(-1)!.season,
					span: [rows[0]!.season, rows.at(-1)!.season],
					score: 15 + n * 2 + c.ws / 6,
					pids: [p.pid],
					tids: [tid],
					heads: [
						`${p.name}: ${n} seasons, one team`,
						`Loyal to the end: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} has played all ${plural(n, "season")} of his career for the ${tLink(X, tid, rows.at(-1)!.season)}${active ? ", and he isn’t done yet" : ""}: ${fmtNum(c.pts)} points and ${fmtNum(c.ws, 1)} win shares.`,
					],
					evidence: [
						["Seasons", `${n}`],
						["Points", fmtNum(c.pts)],
						["WS", fmtNum(c.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Journeyman",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const rows = regRows(p);
				const tids = [...new Set(rows.map((r) => r.tid))];
				if (tids.length < 6) {
					continue;
				}
				const ss = seasonsOf(rows);
				out.push({
					key: `${p.pid}`,
					kind: "Journeyman",
					shape: "career",
					season: ss.at(-1)!,
					score: tids.length * 6 + ss.length,
					pids: [p.pid],
					tids,
					heads: [
						`${p.name} has seen ${tids.length} teams`,
						`Have bag, will travel: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} has played for ${plural(tids.length, "team")} in ${plural(ss.length, "season")}: ${listText(tids.slice(0, 8).map((t) => X.teamAny(t, ss.at(-1)!)?.abbrev ?? "?"))}.`,
					],
					evidence: [
						["Teams", `${tids.length}`],
						["Seasons", span(ss[0]!, ss.at(-1)!)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Iron man",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const ss = seasonsOf(regRows(p));
				let run = 0;
				let best = { n: 0, to: 0 };
				for (const s of ss) {
					const full = X.maxGp(s);
					const l = lineOf(X, p.pid, s);
					run = l && full > 20 && l.gp >= full ? run + 1 : 0;
					if (run > best.n) {
						best = { n: run, to: s };
					}
				}
				if (best.n < 4) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Iron man",
					shape: "career",
					season: best.to,
					span: [best.to - best.n + 1, best.to],
					score: 20 + best.n * 4,
					pids: [p.pid],
					tids: [],
					heads: [
						`${p.name} never missed a game`,
						`${best.n} straight seasons without missing a game`,
					],
					bodies: [
						`${pLink(p)} played every game for ${plural(best.n, "straight season")} (${span(best.to - best.n + 1, best.to)}).`,
					],
					evidence: [
						["Seasons", `${best.n}`],
						["Span", span(best.to - best.n + 1, best.to)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Late bloomer",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const as = p.awards
					.filter((a) => a.type === "All-Star")
					.map((a) => a.season)
					.sort((a, b) => a - b);
				const first = as[0];
				if (first === undefined) {
					continue;
				}
				const age = first - p.bornYear;
				const before = seasonsOf(regRows(p)).filter((s) => s < first).length;
				if (age < 29 || before < 5) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Late bloomer",
					shape: "career",
					season: first,
					score: 20 + (age - 29) * 8 + before,
					pids: [p.pid],
					tids: [],
					heads: [
						`${p.name} became an All-Star at ${age}`,
						`Better late than never: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} made his first All-Star team in ${first}, at age ${age}, in his ${ordinal(before + 1)} season.${as.length > 1 ? ` He has made ${plural(as.length, "All-Star team")} since.` : ""}`,
					],
					evidence: [
						["Age", `${age}`],
						["Season No.", `${before + 1}`],
						["All-Stars", `${as.length}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "One-season wonder",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const lines = seasonsOf(regRows(p))
					.map((s) => lineOf(X, p.pid, s))
					.filter((l): l is SeasonLine => !!l && X.decided(l.season));
				if (lines.length < 5 || isActive(X, p)) {
					continue;
				}
				const sorted = [...lines].sort((a, b) => b.ws - a.ws);
				const top = sorted[0]!;
				const next = sorted[1]!;
				if (top.ws < 8 || top.ws < next.ws * 2) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "One-season wonder",
					shape: "career",
					season: top.season,
					score: 10 + (top.ws - next.ws) * 4,
					pids: [p.pid],
					tids: [top.tid],
					heads: [
						`${p.name}’s magical ${top.season}`,
						`One year to remember for ${p.name}`,
					],
					bodies: [
						`In ${top.season} ${pLink(p)} put up ${fmtNum(top.ppg, 1)} points a game and ${fmtNum(top.ws, 1)} win shares. No other season of his reached even ${fmtNum(next.ws + 0.05, 1)}.`,
					],
					evidence: [
						["Best WS", fmtNum(top.ws, 1)],
						["Next best", fmtNum(next.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Ageless wonder",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				let best: SeasonLine | undefined;
				for (const s of seasonsOf(regRows(p))) {
					const l = lineOf(X, p.pid, s);
					if (l && l.age >= 36 && l.ws >= 5 && (!best || l.ws > best.ws)) {
						best = l;
					}
				}
				if (!best) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Ageless wonder",
					shape: "career",
					season: best.season,
					score: 15 + (best.age - 35) * 10,
					pids: [p.pid],
					tids: [best.tid],
					heads: [
						`${p.name} was still great at ${best.age}`,
						`Father Time can wait: ${p.name}`,
					],
					bodies: [
						`At ${best.age}, ${pLink(p)} produced ${fmtNum(best.ws, 1)} win shares and ${fmtNum(best.ppg, 1)} points a game for the ${tLink(X, best.tid, best.season)} in ${best.season}.`,
					],
					evidence: [
						["Age", `${best.age}`],
						["WS", fmtNum(best.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Rookie to MVP",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const m = p.awards
					.filter(
						(a) => a.type === "Most Valuable Player" && X.decided(a.season),
					)
					.map((a) => a.season)
					.sort((a, b) => a - b)[0];
				const first = seasonsOf(regRows(p))[0];
				if (
					m === undefined ||
					first === undefined ||
					first <= X.L.startingSeason ||
					m - first > 2
				) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Rookie to MVP",
					shape: "career",
					season: m,
					score: 40 + (2 - (m - first)) * 10,
					pids: [p.pid],
					tids: [],
					heads: [
						m === first
							? `${p.name} was MVP as a rookie`
							: `${p.name} was MVP in year ${m - first + 1}`,
						"Instant superstar",
					],
					bodies: [
						`${pLink(p)} won the MVP award in ${m}, ${m === first ? "his rookie season" : `only his ${ordinal(m - first + 1)} season in the league`}.`,
					],
					evidence: [
						["Rookie year", `${first}`],
						["MVP", `${m}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Back-to-back MVPs",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const m = p.awards
					.filter(
						(a) => a.type === "Most Valuable Player" && X.decided(a.season),
					)
					.map((a) => a.season)
					.sort((a, b) => a - b);
				let run = 1;
				let best = { n: 1, to: m[0] ?? 0 };
				for (let i = 1; i < m.length; i++) {
					run = m[i] === m[i - 1]! + 1 ? run + 1 : 1;
					if (run > best.n) {
						best = { n: run, to: m[i]! };
					}
				}
				if (best.n < 2) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Back-to-back MVPs",
					shape: "career",
					season: best.to,
					score: 30 + best.n * 12,
					pids: [p.pid],
					tids: [],
					heads: [
						best.n === 2
							? `Back-to-back MVPs for ${p.name}`
							: `${best.n} straight MVPs for ${p.name}`,
					],
					bodies: [
						`${pLink(p)} won the MVP award ${best.n} years running (${span(best.to - best.n + 1, best.to)})${m.length > best.n ? `, and ${plural(m.length, "MVP")} in all` : ""}.`,
					],
					evidence: [
						["Streak", `${best.n}`],
						["Total MVPs", `${m.length}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Scoring king",
		find: (X) => {
			const crowns = new Map<number, number[]>();
			for (const s of X.decidedSeasons()) {
				const top = [...X.qualified(s)].sort((a, b) => b.ppg - a.ppg)[0];
				if (top) {
					crowns.set(top.pid, [...(crowns.get(top.pid) ?? []), s]);
				}
			}
			const out: Draft[] = [];
			for (const [pid, ss] of crowns) {
				if (ss.length < 2) {
					continue;
				}
				const p = X.players.get(pid)!;
				out.push({
					key: `${pid}`,
					kind: "Scoring king",
					shape: "career",
					season: ss.at(-1)!,
					score: 20 + ss.length * 7,
					pids: [pid],
					tids: [],
					heads: [
						`${p.name} has ${ss.length} scoring titles`,
						`Bucket getter: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} led the league in points per game ${plural(ss.length, "time")}: ${ss.join(", ")}.`,
					],
					evidence: [["Scoring titles", `${ss.length}`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Dynasty",
		find: (X) => {
			const out: Draft[] = [];
			const champs = X.decidedSeasons().map((s) => ({
				s,
				tid: champion(X, s)?.tid,
			}));
			const seen = new Set<string>();
			for (const { s, tid } of champs) {
				if (tid === undefined) {
					continue;
				}
				const win = champs
					.filter((c) => c.tid === tid && c.s >= s && c.s <= s + 7)
					.map((c) => c.s);
				if (win.length < 3 || seen.has(`${tid}|${win.at(-1)}`)) {
					continue;
				}
				seen.add(`${tid}|${win.at(-1)}`);
				const t = X.team(tid, win.at(-1)!)!;
				out.push({
					key: `${tid}|${s}`,
					kind: "Dynasty",
					shape: "team",
					season: win.at(-1)!,
					span: [s, win.at(-1)!],
					score: 30 + win.length * 10,
					pids: [],
					tids: [tid],
					heads: [
						`The ${t.region} ${t.name} dynasty`,
						`${win.length} titles in ${win.at(-1)! - s + 1} years`,
					],
					bodies: [
						`The ${tLink(X, tid, win.at(-1)!)} won ${plural(win.length, "title")} between ${s} and ${win.at(-1)}: ${win.join(", ")}.`,
					],
					evidence: [
						["Titles", `${win.length}`],
						["Span", span(s, win.at(-1)!)],
					],
				});
			}
			return out.filter(
				(d, i) =>
					!out.some(
						(e, j) =>
							j !== i &&
							e.tids[0] === d.tids[0] &&
							e.season >= d.season &&
							Number(e.evidence[0]![1]) > Number(d.evidence[0]![1]),
					),
			);
		},
	},
	{
		kind: "So close",
		find: (X) => {
			const lost = new Map<number, number[]>();
			for (const s of X.decidedSeasons()) {
				const ru = X.runnerUp(s);
				if (!ru) {
					continue;
				}
				for (const l of X.poLines(s)) {
					// Only players who mattered in that run
					if (l.tids.includes(ru.tid) && l.gp >= 3 && l.mpg >= 20) {
						lost.set(l.pid, [...(lost.get(l.pid) ?? []), s]);
					}
				}
			}
			const out: Draft[] = [];
			for (const [pid, ss] of lost) {
				const p = X.players.get(pid)!;
				if (
					ss.length < 2 ||
					titleSeasons(X, p).length > 0 ||
					(ss.length === 2 && careerOf(X, p).ws < 25)
				) {
					continue;
				}
				out.push({
					key: `${pid}`,
					kind: "So close",
					shape: "career",
					season: ss.at(-1)!,
					score: 20 + ss.length * 8 + careerOf(X, p).ws / 10,
					pids: [pid],
					tids: [],
					heads: [
						`${p.name} has lost ${ss.length} finals`,
						`Always the bridesmaid: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} reached the finals ${plural(ss.length, "time")} (${ss.join(", ")}) and lost every one.${isActive(X, p) ? " He’s still chasing a title." : ""}`,
					],
					evidence: [["Finals lost", `${ss.length}`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Best never to win",
		find: (X) => {
			const out: Draft[] = [];
			const list = X.L.players
				.filter(
					(p) =>
						!isActive(X, p) &&
						p.stats.length > 0 &&
						titleSeasons(X, p).length === 0,
				)
				.map((p) => ({ p, c: careerOf(X, p) }))
				.filter((x) => x.c.ws >= 40)
				.sort((a, b) => b.c.ws - a.c.ws)
				.slice(0, 5);
			list.forEach(({ p, c }, i) => {
				out.push({
					key: `${p.pid}`,
					kind: "Best never to win",
					shape: "career",
					season: p.retiredYear,
					score: 40 - i * 3 + c.ws / 10,
					pids: [p.pid],
					tids: [],
					heads: [`${p.name} never won it all`, "No ring for a great"],
					bodies: [
						`${pLink(p)} retired in ${p.retiredYear} with ${fmtNum(c.ws, 1)} win shares, the ${i > 0 ? `${ordinal(i + 1)}-` : ""}most of any retired player without a title.`,
					],
					evidence: [
						["Career WS", fmtNum(c.ws, 1)],
						["Points", fmtNum(c.pts)],
					],
				});
			});
			return out;
		},
	},
	{
		kind: "Undrafted gem",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				if (p.draft.round > 0 || p.stats.length === 0) {
					continue;
				}
				const c = careerOf(X, p);
				const as = p.awards.filter((a) => a.type === "All-Star").length;
				if (c.ws < 25) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Undrafted gem",
					shape: "career",
					season: seasonsOf(regRows(p))[0]!,
					score: 20 + c.ws / 5 + as * 3,
					pids: [p.pid],
					tids: [],
					heads: [
						`Nobody drafted ${p.name}`,
						`Undrafted, and then some: ${p.name}`,
					],
					bodies: [
						`Every team passed on ${pLink(p)} in the ${p.draft.year} draft. He went on to ${fmtNum(c.pts)} points and ${fmtNum(c.ws, 1)} win shares${as > 0 ? `, with ${plural(as, "All-Star selection")}` : ""}.`,
					],
					evidence: [
						["Draft", "Undrafted"],
						["Career WS", fmtNum(c.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Bust",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				if (
					p.draft.round !== 1 ||
					p.draft.pick > 3 ||
					isActive(X, p) ||
					p.stats.length === 0
				) {
					continue;
				}
				const c = careerOf(X, p);
				if (c.ws > 8) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Bust",
					shape: "career",
					season: p.retiredYear,
					score: 15 + (4 - p.draft.pick) * 4,
					pids: [p.pid],
					tids: [p.draft.tid],
					heads: [
						`No. ${p.draft.pick} pick ${p.name} never panned out`,
						`What happened to ${p.name}?`,
					],
					bodies: [
						`${pLink(p)} went No. ${p.draft.pick} in the ${p.draft.year} draft${p.draft.tid >= 0 ? ` to the ${tLink(X, p.draft.tid, p.draft.year)}` : ""}, but finished his career with ${fmtNum(c.ws, 1)} win shares.`,
					],
					evidence: [
						["Pick", `${p.draft.pick}`],
						["Career WS", fmtNum(c.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Repeat champions",
		find: (X) => {
			const out: Draft[] = [];
			const ds = X.decidedSeasons();
			for (const s of ds) {
				const c = champion(X, s);
				const p = champion(X, s - 1);
				const pp = champion(X, s - 2);
				if (
					!c ||
					!p ||
					c.tid !== p.tid ||
					(pp && pp.tid === c.tid) ||
					champion(X, s + 1)?.tid === c.tid
				) {
					continue;
				}
				out.push({
					key: `${c.tid}|${s}`,
					kind: "Repeat champions",
					shape: "team",
					season: s,
					span: [s - 1, s],
					score: 35,
					pids: [],
					tids: [c.tid],
					heads: [`The ${c.region} ${c.name} went back-to-back`, "Repeat!"],
					bodies: [
						`The ${tLink(X, c.tid, s)} won titles in ${s - 1} and ${s}.`,
					],
					evidence: [["Titles", `${s - 1}, ${s}`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Upset",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const ps = X.series(s);
				ps?.rounds[0]?.forEach((m) => {
					if (!m.away) {
						return;
					}
					const [w, l] =
						m.home.won > m.away.won ? [m.home, m.away] : [m.away, m.home];
					if (l.seed !== 1 || w.seed === 1) {
						return;
					}
					out.push({
						key: `${s}|${l.tid}`,
						kind: "Upset",
						shape: "playoffs",
						season: s,
						score: 30 + w.seed * 2,
						pids: [],
						tids: [l.tid, w.tid],
						heads: [
							"A No. 1 seed went out in the first round",
							`One and done for the No. 1 ${X.team(l.tid, s)?.name ?? "seed"}`,
						],
						bodies: [
							`The top-seeded ${tLink(X, l.tid, s)} lost their first-round series ${l.won}-${w.won} to the No. ${w.seed} ${tLink(X, w.tid, s)} in ${s}.`,
						],
						evidence: [
							["Series", `${w.won}-${l.won}`],
							["Seeds", `${w.seed} over 1`],
						],
					});
				});
			}
			return out;
		},
	},
	{
		kind: "Family",
		find: (X) => {
			const out: Draft[] = [];
			const seen = new Set<string>();
			for (const p of X.L.players) {
				for (const r of p.relatives) {
					const q = X.players.get(r.pid);
					if (!q) {
						continue;
					}
					const key = [p.pid, q.pid].sort((a, b) => a - b).join("|");
					if (seen.has(key)) {
						continue;
					}
					const together = p.stats.filter(
						(a) =>
							a.gp > 0 &&
							q.stats.some(
								(b) => b.gp > 0 && b.season === a.season && b.tid === a.tid,
							),
					);
					if (together.length === 0) {
						continue;
					}
					seen.add(key);
					const s = together[0]!;
					const rel =
						r.type === "brother"
							? "brothers"
							: r.type === "son" || r.type === "father"
								? "father and son"
								: "relatives";
					out.push({
						key,
						kind: "Family",
						shape: "career",
						season: s.season,
						score: 15 + seasonsOf(together).length * 3,
						pids: [p.pid, q.pid],
						tids: [s.tid],
						heads: [
							`${p.name} and ${q.name}: ${rel} on one team`,
							`Family business: ${rel} on the ${X.teamName(s.tid, s.season)}`,
						],
						bodies: [
							`${pLink(p)} and ${pLink(q)}, ${rel}, played together for the ${tLink(X, s.tid, s.season)} in ${listText(seasonsOf(together).map(String))}.`,
						],
						evidence: [
							["Relation", rel],
							["Seasons together", `${seasonsOf(together).length}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Trade that won a title",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				for (const t of p.moves) {
					if (t.type !== "trade") {
						continue;
					}
					for (const s of [t.season, t.season + 1]) {
						const c = champion(X, s);
						const po = X.poLines(s).find((l) => l.pid === p.pid);
						if (!c || c.tid !== t.tid || !po || !po.tids.includes(c.tid)) {
							continue;
						}
						const fmvp = X.awardWinner(s, "Finals MVP")?.pid === p.pid;
						const top = [...X.poLines(s)]
							.filter((l) => l.tids.includes(c.tid))
							.sort((a, b) => b.ws - a.ws)[0];
						if (!fmvp && top?.pid !== p.pid) {
							continue;
						}
						out.push({
							key: `${p.pid}|${s}`,
							kind: "Trade that won a title",
							shape: "season",
							season: s,
							score: 50 + (fmvp ? 10 : 0),
							pids: [p.pid],
							tids: [c.tid],
							heads: [
								`The ${c.name} traded for ${p.name}, then won it all`,
								"The trade that won a title",
							],
							bodies: [
								`The ${tLink(X, c.tid, s)} acquired ${pLink(p)} in a trade${t.fromTid !== undefined && t.fromTid >= 0 ? ` from the ${tLink(X, t.fromTid, t.season)}` : ""} in ${t.season}. In the ${s} playoffs he ${fmvp ? "was Finals MVP" : "led the team in win shares"} as they won the title.`,
							],
							evidence: [
								["Traded", `${t.season}`],
								["Title", `${s}`],
								["Playoff PPG", fmtNum(po.ppg, 1)],
							],
						});
						break;
					}
				}
			}
			return out;
		},
	},
	{
		kind: "Drought over",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of new Set(X.L.teamSeasons.map((t) => t.tid))) {
				let miss = 0;
				for (const t of X.teamHistory(tid)) {
					if (!X.decided(t.season)) {
						continue;
					}
					if (t.playoffRoundsWon < 0) {
						miss += 1;
						continue;
					}
					if (miss >= 5) {
						out.push({
							key: `${tid}|${t.season}`,
							kind: "Drought over",
							shape: "team",
							season: t.season,
							score: 15 + miss * 3 + t.playoffRoundsWon * 4,
							pids: [],
							tids: [tid],
							heads: [
								`The ${t.region} ${t.name} are back in the playoffs`,
								`${miss} years later, playoff basketball for the ${t.name}`,
							],
							bodies: [
								`After missing the playoffs ${plural(miss, "season")} in a row, the ${tLink(X, tid, t.season)} went ${fmtRecord(t.won, t.lost, t.tied, t.otl)} in ${t.season} and got back in.`,
							],
							evidence: [
								["Seasons missed", `${miss}`],
								["Record", fmtRecord(t.won, t.lost, t.tied, t.otl)],
							],
						});
					}
					miss = 0;
				}
			}
			return out;
		},
	},
	{
		kind: "First title",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of new Set(X.L.teamSeasons.map((t) => t.tid))) {
				const titles = X.titlesOf(tid);
				const first = titles[0];
				const hist = X.teamHistory(tid);
				if (first === undefined || first === hist[0]!.season) {
					continue;
				}
				const before = hist.filter((t) => t.season < first).length;
				const t = X.team(tid, first)!;
				const fmvp = X.awardWinner(first, "Finals MVP");
				out.push({
					key: `${tid}`,
					kind: "First title",
					shape: "team",
					season: first,
					score: 20 + before * 2,
					pids: fmvp ? [fmvp.pid] : [],
					tids: [tid],
					heads: [
						`The ${t.region} ${t.name} win their first title`,
						"A first banner",
					],
					bodies: [
						`After ${plural(before, "season")} without one, the ${tLink(X, tid, first)} won the franchise’s first title in ${first}.${fmvp ? ` ${pLink(fmvp)} was Finals MVP.` : ""}`,
					],
					evidence: [
						["Seasons waited", `${before}`],
						["Record", fmtRecord(t.won, t.lost, t.tied, t.otl)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Finals sweep",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const f = X.series(s)?.rounds.at(-1)?.[0];
				if (!f?.away) {
					continue;
				}
				const [w, l] =
					f.home.won > f.away.won ? [f.home, f.away] : [f.away, f.home];
				if (l.won !== 0 || w.won < 2) {
					continue;
				}
				out.push({
					key: `${s}`,
					kind: "Finals sweep",
					shape: "playoffs",
					season: s,
					score: 30,
					pids: [],
					tids: [w.tid, l.tid],
					heads: [
						`A finals sweep in ${s}`,
						`The ${X.team(w.tid, s)?.name ?? "champions"} swept the finals`,
					],
					bodies: [
						`The ${tLink(X, w.tid, s)} swept the ${tLink(X, l.tid, s)} ${w.won}-0 in the ${s} finals.`,
					],
					evidence: [["Series", `${w.won}-0`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Hometown hero",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const city = p.bornLoc.split(",")[0]!.trim();
				if (city.length < 3) {
					continue;
				}
				const rows = regRows(p);
				const tids = [...new Set(rows.map((r) => r.tid))].filter(
					(tid) => X.teamAny(tid, rows.at(-1)!.season)?.region === city,
				);
				for (const tid of tids) {
					const mine = rows.filter((r) => r.tid === tid);
					const ws = mine.reduce((a, r) => a + r.ws, 0);
					if (ws < 15) {
						continue;
					}
					const ss = seasonsOf(mine);
					out.push({
						key: `${p.pid}|${tid}`,
						kind: "Hometown hero",
						shape: "career",
						season: ss.at(-1)!,
						score: 15 + ws / 3,
						pids: [p.pid],
						tids: [tid],
						heads: [
							`${p.name}, starring for his hometown team`,
							`${city}’s own ${p.name}`,
						],
						bodies: [
							`Born in ${p.bornLoc}, ${pLink(p)} played ${plural(ss.length, "season")} for the ${tLink(X, tid, ss.at(-1)!)} and produced ${fmtNum(ws, 1)} win shares for them.`,
						],
						evidence: [
							["Born", p.bornLoc],
							["Seasons", `${ss.length}`],
							["WS", fmtNum(ws, 1)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Breakout",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				for (const l of X.qualified(s)) {
					const prev = lineOf(X, l.pid, s - 1);
					if (!prev || l.ws - prev.ws < 7 || l.ws < 9) {
						continue;
					}
					const p = X.players.get(l.pid)!;
					out.push({
						key: `${l.pid}|${s}`,
						kind: "Breakout",
						shape: "season",
						season: s,
						span: [s - 1, s],
						score: 10 + (l.ws - prev.ws) * 3,
						pids: [l.pid],
						tids: [l.tid],
						heads: [
							`${p.name} broke out in ${s}`,
							`Where did ${p.name} come from?`,
						],
						bodies: [
							`${pLink(p)} went from ${fmtNum(prev.ppg, 1)} points and ${fmtNum(prev.ws, 1)} win shares in ${s - 1} to ${fmtNum(l.ppg, 1)} and ${fmtNum(l.ws, 1)} in ${s}, at age ${l.age}.`,
						],
						evidence: [
							["WS before", fmtNum(prev.ws, 1)],
							["WS after", fmtNum(l.ws, 1)],
							["Age", `${l.age}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Farewell",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				if (p.retiredYear > X.L.season || p.stats.length === 0) {
					continue;
				}
				const c = careerOf(X, p);
				if (c.ws < 50) {
					continue;
				}
				const mvps = X.countAwards(p, "Most Valuable Player");
				const titles = titleSeasons(X, p).length;
				out.push({
					key: `${p.pid}`,
					kind: "Farewell",
					shape: "career",
					season: p.retiredYear,
					score: 10 + c.ws / 3 + mvps * 5,
					pids: [p.pid],
					tids: [],
					heads: [`${p.name} retires`, `So long, ${p.name}`],
					bodies: [
						`${pLink(p)} retired in ${p.retiredYear} after ${plural(seasonsOf(regRows(p)).length, "season")}: ${fmtNum(c.pts)} points, ${fmtNum(c.ws, 1)} win shares${mvps > 0 ? `, ${plural(mvps, "MVP")}` : ""}${titles > 0 ? `, ${plural(titles, "title")}` : ""}.`,
					],
					evidence: [
						["Points", fmtNum(c.pts)],
						["WS", fmtNum(c.ws, 1)],
						["Titles", `${titles}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Scoring explosion",
		find: (X) => {
			const out: Draft[] = [];
			for (const g of X.L.games) {
				for (let i = 0; i < 2; i++) {
					const t = g.teams[i]!;
					const o = g.teams[1 - i]!;
					for (const l of t.players) {
						if (l.pts < 55) {
							continue;
						}
						out.push({
							key: `${g.gid}|${l.pid}`,
							kind: "Scoring explosion",
							shape: "season",
							season: g.season,
							score: 10 + (l.pts - 50) * 3,
							pids: [l.pid],
							tids: [t.tid],
							gids: [g.gid],
							heads: [
								`${l.name} scored ${l.pts}`,
								`${l.pts} points in one night`,
							],
							bodies: [
								`${pLink(l)} put up ${l.pts} points, ${l.trb} rebounds and ${l.ast} assists for the ${tLink(X, t.tid, g.season)} against the ${tLink(X, o.tid, g.season)}${g.playoffs ? " in the playoffs" : ""} in ${g.season}, a ${t.pts > o.pts ? "win" : "loss"}, ${t.pts}–${o.pts}.`,
							],
							evidence: [
								["PTS", `${l.pts}`],
								["REB", `${l.trb}`],
								["AST", `${l.ast}`],
							],
						});
					}
				}
			}
			return out;
		},
	},
];

export const ALL_KINDS: Kind[] = [
	...KINDS,
	...PLAYER_KINDS,
	...TEAM_KINDS,
	...GAME_KINDS,
];

export const kindSlug = (kind: string) =>
	kind
		.toLowerCase()
		.replace(/[^\da-z]+/g, "-")
		.replace(/^-|-$/g, "");

export const KIND_NAMES = ALL_KINDS.map((k) => k.kind);

const draftToStory = (k: Kind, d: Draft): Story | undefined => {
	const id = `${k.kind}|${d.key}`;
	const { key: _key, heads, bodies, ...rest } = d;
	const story: Story = {
		...rest,
		id,
		headline: polish(pickBy(`${id}|h`, heads)),
		body: polish(pickBy(`${id}|b`, bodies)),
		evidence: d.evidence.map(([a, b]) => [a, polish(b)]),
	};
	if (
		isBadText(
			plainText(
				`${story.headline} ${story.body} ${story.evidence.flat().join(" ")}`,
			),
		)
	) {
		return undefined;
	}
	return story;
};

const findKind = (X: LeagueIndex, k: Kind, out: Story[]) => {
	let drafts: Draft[];
	try {
		drafts = k.find(X);
	} catch (error) {
		console.error(error);
		return;
	}
	for (const d of drafts) {
		const story = draftToStory(k, d);
		if (story) {
			out.push(story);
		}
	}
};

export const findStories = (L: WLeague | LeagueIndex): Story[] => {
	const X = isLeagueIndex(L) ? L : new LeagueIndex(L);
	const out: Story[] = [];
	for (const k of ALL_KINDS) {
		findKind(X, k, out);
	}
	return diversify(out);
};

// The same, but lets the caller do other work (like answer messages) between kinds. Gives exactly what findStories gives.
export const findStoriesAsync = async (
	L: WLeague | LeagueIndex,
	pause: () => Promise<void>,
): Promise<Story[]> => {
	const X = isLeagueIndex(L) ? L : new LeagueIndex(L);
	const out: Story[] = [];
	let t0 = performance.now();
	for (const k of ALL_KINDS) {
		findKind(X, k, out);
		if (performance.now() - t0 > 30) {
			await pause();
			t0 = performance.now();
		}
	}
	return diversify(out);
};

// Biggest stories first, but each further story of the same kind counts a little less, so one kind can't fill the top of the list
export const diversify = (stories: Story[]) => {
	const sorted = [...stories].sort(
		(a, b) =>
			b.score - a.score || b.season - a.season || (a.id < b.id ? -1 : 1),
	);
	const seen = new Map<string, number>();
	const ranked = sorted.map((s) => {
		const k = seen.get(s.kind) ?? 0;
		seen.set(s.kind, k + 1);
		return { s, v: s.score * 0.85 ** k };
	});
	ranked.sort((a, b) => b.v - a.v || (a.s.id < b.s.id ? -1 : 1));
	return ranked.map((r) => r.s);
};
