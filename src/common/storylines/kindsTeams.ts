// More storyline kinds, about teams: seasons, runs, finals, rosters and rivalries. Playoff and title facts only for decided seasons.

import type { SeasonLine } from "../wrapped/league.ts";
import type { WPlayer, WTeamSeason } from "../wrapped/types.ts";
import {
	fmtNum,
	fmtRecord,
	fmtWinp,
	listText,
	plural,
	span,
	winPct,
} from "../wrapped/util.ts";
import {
	pLink,
	roundLabel,
	runsOf,
	teamsWithHistory,
	titleSeasons,
	tLink,
	topN,
	topOn,
	type Draft,
	type Kind,
} from "./kit.ts";

const rec = (t: WTeamSeason) => fmtRecord(t.won, t.lost, t.tied, t.otl);
const wp = (t: WTeamSeason) => winPct(t.won, t.lost, t.tied);
const gamesOf = (t: WTeamSeason) => t.won + t.lost + t.tied + t.otl;
const mov = (t: WTeamSeason) => (t.gp > 0 ? (t.pts - t.oppPts) / t.gp : 0);

const decidedTeams = (X: Parameters<Kind["find"]>[0]) =>
	X.L.teamSeasons.filter((t) => X.decided(t.season) && gamesOf(t) >= 20);

// The playoff series of a team in a season: [{round, opp, won, lost, seed, oppSeed}]
const pathOf = (
	X: Parameters<Kind["find"]>[0],
	tid: number,
	season: number,
) => {
	const ps = X.series(season);
	const out: {
		round: number;
		opp: number;
		w: number;
		l: number;
		oppSeed: number;
	}[] = [];
	ps?.rounds.forEach((round, i) => {
		for (const m of round) {
			if (!m.away) {
				continue;
			}
			if (m.home.tid === tid) {
				out.push({
					round: i,
					opp: m.away.tid,
					w: m.home.won,
					l: m.away.won,
					oppSeed: m.away.seed,
				});
			} else if (m.away.tid === tid) {
				out.push({
					round: i,
					opp: m.home.tid,
					w: m.away.won,
					l: m.home.won,
					oppSeed: m.home.seed,
				});
			}
		}
	});
	return out;
};

const finalsOf = (X: Parameters<Kind["find"]>[0], s: number) => {
	const f = X.series(s)?.rounds.at(-1)?.[0];
	if (!f?.away || !X.decided(s)) {
		return undefined;
	}
	const [w, l] = f.home.won > f.away.won ? [f.home, f.away] : [f.away, f.home];
	return { w, l };
};

const AWARDS_INDIVIDUAL = [
	"Most Valuable Player",
	"Defensive Player of the Year",
	"Rookie of the Year",
	"Sixth Man of the Year",
	"Most Improved Player",
	"Finals MVP",
];

export const TEAM_KINDS: Kind[] = [
	{
		kind: "Title hangover",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const c = X.champion(s);
				const b = X.team(c?.tid ?? -1, s + 1);
				if (
					!c ||
					!b ||
					!X.decided(s + 1) ||
					gamesOf(b) < 20 ||
					b.playoffRoundsWon >= 0
				) {
					continue;
				}
				const top = topOn(X, c.tid, s);
				out.push({
					key: `${c.tid}|${s}`,
					kind: "Title hangover",
					shape: "team",
					season: s + 1,
					score: 30 + (c.won - b.won) * 1.2,
					pids: top ? [top.pid] : [],
					tids: [c.tid],
					heads: [
						`The ${c.name} won it all, then missed the playoffs`,
						`From a title to the lottery: the ${b.region} ${b.name}`,
						`A year after the parade, the ${b.name} are home in April`,
					],
					bodies: [
						`The ${tLink(X, c.tid, s)} won the ${s} title at ${rec(c)}. In ${s + 1} they went ${rec(b)} and missed the playoffs.`,
						`${rec(c)} and a title in ${s}. ${rec(b)} and no playoffs in ${s + 1}: the ${tLink(X, c.tid, s + 1)} could not hold on.`,
					],
					evidence: [
						["Title year", rec(c)],
						["Next year", rec(b)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Big leap",
		find: (X) => {
			const out: Draft[] = [];
			for (const b of decidedTeams(X)) {
				const a = X.team(b.tid, b.season - 1);
				if (!a || gamesOf(a) < 20) {
					continue;
				}
				const d = wp(b) - wp(a);
				if (d < 0.27) {
					continue;
				}
				const gain = Math.round(d * gamesOf(b));
				const top = topOn(X, b.tid, b.season);
				out.push({
					key: `${b.tid}|${b.season}`,
					kind: "Big leap",
					shape: "team",
					season: b.season,
					score: 20 + d * 120,
					pids: top ? [top.pid] : [],
					tids: [b.tid],
					heads: [
						`The ${b.name} won ${gain} more games than last year`,
						`From ${rec(a)} to ${rec(b)}: the ${b.season} ${b.name}`,
						`The biggest turnaround of ${b.season}: the ${b.name}`,
					],
					bodies: [
						`The ${tLink(X, b.tid, b.season)} went from ${rec(a)} in ${b.season - 1} to ${rec(b)} in ${b.season}, ${gain} more wins.${top ? ` ${pLink(top)} led them with ${fmtNum(top.ws, 1)} win shares.` : ""}`,
					],
					evidence: [
						["Before", rec(a)],
						["After", rec(b)],
						["Win% up", fmtNum(d * 100, 0)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Best record, no ring",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const teams = [...X.teamsIn(s)].filter((t) => gamesOf(t) >= 20);
				const best = [...teams].sort(
					(a, b) => wp(b) - wp(a) || a.tid - b.tid,
				)[0];
				const c = X.champion(s);
				if (!best || !c || c.tid === best.tid || wp(best) < 0.7) {
					continue;
				}
				const n = X.numRounds(s);
				const label =
					best.playoffRoundsWon < 0
						? "missed the playoffs"
						: `went out in ${roundLabel(best.playoffRoundsWon, n)}`;
				out.push({
					key: `${s}`,
					kind: "Best record, no ring",
					shape: "playoffs",
					season: s,
					score: 20 + (wp(best) - 0.7) * 100,
					pids: [],
					tids: [best.tid, c.tid],
					heads: [
						`The best team of ${s} did not win the title`,
						`${rec(best)} and no ring for the ${best.name}`,
						`The ${best.name} ruled the regular season, then ${label}`,
					],
					bodies: [
						`The ${tLink(X, best.tid, s)} had the league’s best record in ${s} (${rec(best)}) but ${label}. The ${tLink(X, c.tid, s)} (${rec(c)}) won it all.`,
					],
					evidence: [
						["Best record", rec(best)],
						["Champion", rec(c)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Juggernaut",
		find: (X) => {
			const out: Draft[] = [];
			for (const t of decidedTeams(X)) {
				if (wp(t) < 0.85) {
					continue;
				}
				const champ = X.champion(t.season)?.tid === t.tid;
				out.push({
					key: `${t.tid}|${t.season}`,
					kind: "Juggernaut",
					shape: "team",
					season: t.season,
					score: 30 + (wp(t) - 0.85) * 200 + (champ ? 12 : 0),
					pids: [],
					tids: [t.tid],
					heads: [
						`${t.won} wins: the ${t.season} ${t.name} were unstoppable`,
						`The ${t.name} went ${rec(t)}`,
						`One of the best regular seasons ever: the ${t.region} ${t.name}`,
					],
					bodies: [
						`The ${tLink(X, t.tid, t.season)} went ${rec(t)} in ${t.season} (${fmtWinp(wp(t))}) with a scoring margin of ${fmtNum(mov(t), 1)} points a game${champ ? ", and finished the job with the title" : ""}.`,
					],
					evidence: [
						["Record", rec(t)],
						["Margin", fmtNum(mov(t), 1)],
						["Title", champ ? "Yes" : "No"],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Historic futility",
		find: (X) => {
			const out: Draft[] = [];
			for (const t of decidedTeams(X)) {
				if (wp(t) > 0.15) {
					continue;
				}
				out.push({
					key: `${t.tid}|${t.season}`,
					kind: "Historic futility",
					shape: "team",
					season: t.season,
					score: 25 + (0.15 - wp(t)) * 200,
					pids: [],
					tids: [t.tid],
					heads: [
						`The ${t.name} won just ${t.won} games`,
						`${rec(t)}: a season to forget for the ${t.name}`,
						`Rock bottom in ${t.season}: the ${t.region} ${t.name}`,
					],
					bodies: [
						`The ${tLink(X, t.tid, t.season)} went ${rec(t)} in ${t.season}, a win rate of ${fmtWinp(wp(t))}, and were outscored by ${fmtNum(Math.abs(mov(t)), 1)} points a game.`,
					],
					evidence: [
						["Record", rec(t)],
						["Margin", fmtNum(mov(t), 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Playoff streak",
		find: (X) => {
			const out: Draft[] = [];
			const now = X.decidedSeasons().at(-1);
			for (const tid of teamsWithHistory(X)) {
				const hist = X.teamHistory(tid).filter((t) => X.decided(t.season));
				const ss = hist.map((t) => t.season);
				const runs = runsOf(
					ss,
					(s) => (X.team(tid, s)?.playoffRoundsWon ?? -1) >= 0,
				);
				for (const run of runs) {
					if (run.length < 8) {
						continue;
					}
					const t = X.team(tid, run.at(-1)!)!;
					const titles = run.filter((s) => X.champion(s)?.tid === tid);
					const ongoing = run.at(-1) === now;
					out.push({
						key: `${tid}|${run[0]}`,
						kind: "Playoff streak",
						shape: "team",
						season: run.at(-1)!,
						score: 15 + run.length * 3 + titles.length * 3,
						pids: [],
						tids: [tid],
						heads: [
							`${run.length} straight playoff trips for the ${t.name}`,
							`The ${t.name} are a postseason fixture`,
							`${run.length} years of playoff basketball: the ${t.region} ${t.name}`,
						],
						bodies: [
							`The ${tLink(X, tid, run.at(-1)!)} made the playoffs ${plural(run.length, "year")} in a row (${span(run[0]!, run.at(-1)!)})${titles.length > 0 ? `, winning ${plural(titles.length, "title")} along the way` : ""}${ongoing ? ", and the run is still going" : ""}.`,
						],
						evidence: [
							["Years", `${run.length}`],
							["Titles", `${titles.length}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Lost decade",
		find: (X) => {
			const out: Draft[] = [];
			const now = X.decidedSeasons().at(-1);
			for (const tid of teamsWithHistory(X)) {
				const ss = X.teamHistory(tid)
					.filter((t) => X.decided(t.season))
					.map((t) => t.season);
				const runs = runsOf(
					ss,
					(s) => (X.team(tid, s)?.playoffRoundsWon ?? -1) < 0,
				);
				for (const run of runs) {
					if (run.length < 7) {
						continue;
					}
					const t = X.team(tid, run.at(-1)!)!;
					const wins = run.reduce((a, s) => a + (X.team(tid, s)?.won ?? 0), 0);
					const gms = run.reduce((a, s) => a + gamesOf(X.team(tid, s)!), 0);
					const ongoing = run.at(-1) === now;
					out.push({
						key: `${tid}|${run[0]}`,
						kind: "Lost decade",
						shape: "team",
						season: run.at(-1)!,
						score: 12 + run.length * 3,
						pids: [],
						tids: [tid],
						heads: [
							`${run.length} years without the playoffs for the ${t.name}`,
							`The ${t.name}’ long winter`,
							`No postseason in ${run.length} years: the ${t.region} ${t.name}`,
						],
						bodies: [
							`The ${tLink(X, tid, run.at(-1)!)} missed the playoffs ${plural(run.length, "year")} running (${span(run[0]!, run.at(-1)!)}), winning ${fmtNum(wins)} of ${fmtNum(gms)} games (${fmtWinp(winPct(wins, gms - wins))})${ongoing ? ". It is not over yet" : ""}.`,
						],
						evidence: [
							["Years", `${run.length}`],
							["Win%", fmtWinp(winPct(wins, gms - wins))],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Dominant stretch",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of teamsWithHistory(X)) {
				const ss = X.teamHistory(tid)
					.filter((t) => X.decided(t.season))
					.map((t) => t.season);
				const runs = runsOf(ss, (s) => {
					const t = X.team(tid, s);
					return !!t && gamesOf(t) >= 20 && wp(t) >= 0.6;
				});
				for (const run of runs) {
					if (run.length < 6) {
						continue;
					}
					const t = X.team(tid, run.at(-1)!)!;
					const wins = run.reduce((a, s) => a + X.team(tid, s)!.won, 0);
					const gms = run.reduce((a, s) => a + gamesOf(X.team(tid, s)!), 0);
					const titles = run.filter((s) => X.champion(s)?.tid === tid).length;
					out.push({
						key: `${tid}|${run[0]}`,
						kind: "Dominant stretch",
						shape: "team",
						season: run.at(-1)!,
						score: 15 + run.length * 4 + titles * 5,
						pids: [],
						tids: [tid],
						heads: [
							`${run.length} winning seasons in a row for the ${t.name}`,
							`The ${t.name} did not lose their touch`,
							`A golden era in ${t.region}`,
						],
						bodies: [
							`The ${tLink(X, tid, run.at(-1)!)} won at least 60% of their games ${plural(run.length, "year")} in a row (${span(run[0]!, run.at(-1)!)}): ${fmtNum(wins)}-${fmtNum(gms - wins)}${titles > 0 ? `, with ${plural(titles, "title")}` : ""}.`,
						],
						evidence: [
							["Years", `${run.length}`],
							["Record", `${wins}-${gms - wins}`],
							["Titles", `${titles}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Rebuild complete",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of teamsWithHistory(X)) {
				const hist = X.teamHistory(tid).filter(
					(t) => X.decided(t.season) && gamesOf(t) >= 20,
				);
				let lastLow: WTeamSeason | undefined;
				let used = -1;
				for (const t of hist) {
					if (wp(t) <= 0.35) {
						lastLow = t;
						continue;
					}
					if (
						lastLow &&
						wp(t) >= 0.65 &&
						t.season - lastLow.season <= 4 &&
						lastLow.season > used
					) {
						used = lastLow.season;
						const champ = X.champion(t.season)?.tid === tid;
						out.push({
							key: `${tid}|${t.season}`,
							kind: "Rebuild complete",
							shape: "team",
							season: t.season,
							score: 22 + (wp(t) - wp(lastLow)) * 60 + (champ ? 12 : 0),
							pids: [],
							tids: [tid],
							heads: [
								`The ${t.name} went from the basement to contender`,
								`${rec(lastLow)} to ${rec(t)}: the ${t.name} rebuilt fast`,
								`The rebuild paid off in ${t.season}`,
							],
							bodies: [
								`The ${tLink(X, tid, lastLow.season)} went ${rec(lastLow)} in ${lastLow.season}. Just ${plural(t.season - lastLow.season, "season")} later they went ${rec(t)}${champ ? " and won the title" : ""}.`,
							],
							evidence: [
								["Low point", rec(lastLow)],
								["Then", rec(t)],
							],
						});
					}
					if (wp(t) > 0.35) {
						lastLow = undefined;
					}
				}
			}
			return out;
		},
	},
	{
		kind: "Complete team",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const teams = X.teamsIn(s).filter((t) => t.gp >= 20);
				if (teams.length < 8) {
					continue;
				}
				const off = [...teams].sort((a, b) => b.pts / b.gp - a.pts / a.gp);
				const def = [...teams].sort(
					(a, b) => a.oppPts / a.gp - b.oppPts / b.gp,
				);
				const t = off[0]!;
				if (def[0]!.tid !== t.tid) {
					continue;
				}
				const champ = X.champion(s)?.tid === t.tid;
				out.push({
					key: `${t.tid}|${s}`,
					kind: "Complete team",
					shape: "team",
					season: s,
					score: 28 + mov(t) * 2 + (champ ? 10 : 0),
					pids: [],
					tids: [t.tid],
					heads: [
						`The ${t.name} had the best offense and the best defense`,
						`No weak spot: the ${s} ${t.name}`,
						`First in scoring and first in defense: the ${t.region} ${t.name}`,
					],
					bodies: [
						`The ${tLink(X, t.tid, s)} led the league in points scored (${fmtNum(t.pts / t.gp, 1)} a game) and in fewest allowed (${fmtNum(t.oppPts / t.gp, 1)}) in ${s}, going ${rec(t)}${champ ? " and winning the title" : ""}.`,
					],
					evidence: [
						["PF", fmtNum(t.pts / t.gp, 1)],
						["PA", fmtNum(t.oppPts / t.gp, 1)],
						["Record", rec(t)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Better or worse than the numbers",
		find: (X) => {
			const out: Draft[] = [];
			for (const t of decidedTeams(X)) {
				if (t.gp < 20 || t.pts <= 0 || t.oppPts <= 0) {
					continue;
				}
				const e = 14;
				const exp = t.pts ** e / (t.pts ** e + t.oppPts ** e);
				const diff = t.won - exp * gamesOf(t);
				if (Math.abs(diff) < 7) {
					continue;
				}
				const lucky = diff > 0;
				out.push({
					key: `${t.tid}|${t.season}`,
					kind: "Better or worse than the numbers",
					shape: "team",
					season: t.season,
					score: 12 + Math.abs(diff) * 2.5,
					pids: [],
					tids: [t.tid],
					heads: lucky
						? [
								`The ${t.name} won more than their scoring says they should`,
								`${rec(t)}, but the points say ${Math.round(exp * gamesOf(t))} wins`,
								`Close-game magic for the ${t.region} ${t.name}`,
							]
						: [
								`The ${t.name} deserved better`,
								`${rec(t)}, but the points say ${Math.round(exp * gamesOf(t))} wins`,
								`Tough luck in close games: the ${t.region} ${t.name}`,
							],
					bodies: [
						`The ${tLink(X, t.tid, t.season)} scored ${fmtNum(t.pts / t.gp, 1)} and allowed ${fmtNum(t.oppPts / t.gp, 1)} a game in ${t.season}, numbers that usually mean about ${Math.round(exp * gamesOf(t))} wins. They won ${t.won}.`,
					],
					evidence: [
						["Wins", `${t.won}`],
						["Expected", `${Math.round(exp * gamesOf(t))}`],
						["Margin", fmtNum(mov(t), 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Point differential king",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const teams = X.teamsIn(s).filter((t) => t.gp >= 20);
				const t = [...teams].sort((a, b) => mov(b) - mov(a))[0];
				if (!t || mov(t) < 8) {
					continue;
				}
				const champ = X.champion(s)?.tid === t.tid;
				out.push({
					key: `${s}`,
					kind: "Point differential king",
					shape: "team",
					season: s,
					score: 14 + mov(t) * 2 + (champ ? 0 : 6),
					pids: [],
					tids: [t.tid],
					heads: [
						`The ${t.name} outscored everyone by ${fmtNum(mov(t), 1)} a game`,
						`The most lopsided team of ${s}: the ${t.name}`,
						`+${fmtNum(mov(t), 1)} a night for the ${t.region} ${t.name}`,
					],
					bodies: [
						`The ${tLink(X, t.tid, s)} had the league’s best scoring margin in ${s}, ${fmtNum(mov(t), 1)} points a game (${fmtNum(t.pts / t.gp, 1)} to ${fmtNum(t.oppPts / t.gp, 1)}), and ${champ ? "won the title" : `finished ${rec(t)} without winning it all`}.`,
					],
					evidence: [
						["Margin", fmtNum(mov(t), 1)],
						["Record", rec(t)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Finals rematch",
		find: (X) => {
			const out: Draft[] = [];
			const ss = X.decidedSeasons();
			for (const s of ss) {
				const a = finalsOf(X, s);
				const b = finalsOf(X, s + 1);
				if (!a || !b) {
					continue;
				}
				const pa = [a.w.tid, a.l.tid].sort((x, y) => x - y).join("|");
				const pb = [b.w.tid, b.l.tid].sort((x, y) => x - y).join("|");
				if (pa !== pb) {
					continue;
				}
				const revenge = a.l.tid === b.w.tid;
				out.push({
					key: `${pb}|${s + 1}`,
					kind: "Finals rematch",
					shape: "playoffs",
					season: s + 1,
					score: 32 + (revenge ? 6 : 0),
					pids: [],
					tids: [b.w.tid, b.l.tid],
					heads: [
						`The ${s} finals, again`,
						`${X.teamName(b.w.tid, s + 1)} and ${X.teamName(b.l.tid, s + 1)} met in the finals once more`,
						revenge ? "Revenge in the finals" : "A repeat in the finals",
					],
					bodies: [
						`The ${tLink(X, a.w.tid, s)} beat the ${tLink(X, a.l.tid, s)} ${a.w.won}-${a.l.won} in the ${s} finals. In ${s + 1} they met again, and the ${tLink(X, b.w.tid, s + 1)} won ${b.w.won}-${b.l.won}${revenge ? ", turning the tables" : ""}.`,
					],
					evidence: [
						[`${s}`, `${a.w.won}-${a.l.won}`],
						[`${s + 1}`, `${b.w.won}-${b.l.won}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Finals to the last game",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const f = finalsOf(X, s);
				if (!f || f.w.won < 3 || f.l.won !== f.w.won - 1) {
					continue;
				}
				out.push({
					key: `${s}`,
					kind: "Finals to the last game",
					shape: "playoffs",
					season: s,
					score: 30 + f.w.won,
					pids: [],
					tids: [f.w.tid, f.l.tid],
					heads: [
						`The ${s} finals went the distance`,
						`${f.w.won}-${f.l.won}: a finals decided in the last game`,
						`${X.teamName(f.w.tid, s)} survived a seventh game`,
					],
					bodies: [
						`The ${tLink(X, f.w.tid, s)} beat the ${tLink(X, f.l.tid, s)} ${f.w.won}-${f.l.won} in the ${s} finals, decided in the last possible game.`,
					],
					evidence: [["Series", `${f.w.won}-${f.l.won}`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Cruise to the title",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const c = X.champion(s);
				if (!c) {
					continue;
				}
				const path = pathOf(X, c.tid, s);
				if (path.length < 2) {
					continue;
				}
				const losses = path.reduce((a, p) => a + p.l, 0);
				const wins = path.reduce((a, p) => a + p.w, 0);
				if (losses > 2) {
					continue;
				}
				out.push({
					key: `${s}`,
					kind: "Cruise to the title",
					shape: "playoffs",
					season: s,
					score: 28 + (3 - losses) * 6,
					pids: [],
					tids: [c.tid],
					heads: [
						`The ${c.name} lost only ${plural(losses, "playoff game")}`,
						`A walk through the ${s} playoffs for the ${c.name}`,
						`${wins}-${losses}: the ${c.region} ${c.name} ran the table`,
					],
					bodies: [
						`The ${tLink(X, c.tid, s)} won the ${s} title going ${wins}-${losses} in ${plural(path.length, "series", "series")}.`,
					],
					evidence: [
						["Playoff record", `${wins}-${losses}`],
						["Series", `${path.length}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Least likely champion",
		find: (X) => {
			const champs = X.decidedSeasons()
				.map((s) => X.champion(s))
				.filter((t): t is WTeamSeason => !!t && gamesOf(t) >= 20);
			if (champs.length < 6) {
				return [];
			}
			return topN(champs, 3, (t) => -wp(t))
				.filter((t) => wp(t) < 0.6)
				.map((t) => ({
					key: `${t.tid}|${t.season}`,
					kind: "Least likely champion",
					shape: "playoffs" as const,
					season: t.season,
					score: 30 + (0.6 - wp(t)) * 100,
					pids: [],
					tids: [t.tid],
					heads: [
						`The ${t.name} won the title with just ${t.won} wins`,
						`The weakest champion yet: ${t.season} ${t.name}`,
						`${rec(t)} in the regular season, champions in the end`,
					],
					bodies: [
						`The ${tLink(X, t.tid, t.season)} went ${rec(t)} in ${t.season}, the weakest regular season of any champion in this league’s history so far, and won the title anyway.`,
					],
					evidence: [
						["Record", rec(t)],
						["Seed", t.seed ? `${t.seed}` : "–"],
					],
				}));
		},
	},
	{
		kind: "Franchise record",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of teamsWithHistory(X)) {
				const hist = X.teamHistory(tid).filter(
					(t) => X.decided(t.season) && gamesOf(t) >= 20,
				);
				let best = 0;
				hist.forEach((t, i) => {
					if (t.won > best && i >= 8 && wp(t) >= 0.6) {
						const prev = hist
							.slice(0, i)
							.reduce((a, x) => (x.won > a.won ? x : a));
						out.push({
							key: `${tid}|${t.season}`,
							kind: "Franchise record",
							shape: "team",
							season: t.season,
							score: 18 + (t.won - best) * 1.5 + i * 0.3,
							pids: [],
							tids: [tid],
							heads: [
								`${t.won} wins: a franchise record for the ${t.name}`,
								`The best season in ${t.region} history`,
								`The ${t.name} set a new standard in ${t.season}`,
							],
							bodies: [
								`The ${tLink(X, tid, t.season)} went ${rec(t)} in ${t.season}, the most wins in franchise history, beating the ${prev.won} of ${prev.season}.`,
							],
							evidence: [
								["Wins", `${t.won}`],
								["Old record", `${prev.won} (${prev.season})`],
							],
						});
					}
					best = Math.max(best, t.won);
				});
			}
			return out;
		},
	},
	{
		kind: "League record",
		find: (X) => {
			const out: Draft[] = [];
			let best = 0;
			let prevT: WTeamSeason | undefined;
			X.decidedSeasons().forEach((s, i) => {
				const t = [...X.teamsIn(s)]
					.filter((x) => gamesOf(x) >= 20)
					.sort((a, b) => b.won - a.won || a.tid - b.tid)[0];
				if (!t) {
					return;
				}
				if (t.won > best && i >= 6 && prevT) {
					out.push({
						key: `${s}`,
						kind: "League record",
						shape: "team",
						season: s,
						score: 40 + (t.won - best) * 2,
						pids: [],
						tids: [t.tid, prevT.tid],
						heads: [
							`${t.won} wins: a new league record`,
							`The ${t.name} broke the wins record`,
							`Nobody has won more than the ${s} ${t.name}`,
						],
						bodies: [
							`The ${tLink(X, t.tid, s)} won ${t.won} games in ${s}, more than any team before them in this league. The old mark was ${best}, by the ${tLink(X, prevT.tid, prevT.season)} in ${prevT.season}.`,
						],
						evidence: [
							["Wins", `${t.won}`],
							["Old record", `${best}`],
						],
					});
				}
				if (t.won > best) {
					best = t.won;
					prevT = t;
				}
			});
			return out;
		},
	},
	{
		kind: "Awards haul",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const byTeam = new Map<number, { pid: number; award: string }[]>();
				for (const a of AWARDS_INDIVIDUAL) {
					for (const pid of X.awardPids(s, a)) {
						const l = X.line(pid, s);
						if (l) {
							byTeam.set(l.tid, [
								...(byTeam.get(l.tid) ?? []),
								{ pid, award: a },
							]);
						}
					}
				}
				for (const [tid, list] of byTeam) {
					if (list.length < 3) {
						continue;
					}
					const t = X.team(tid, s);
					if (!t) {
						continue;
					}
					const names = list.map((x) => `${pLinkOf(X, x.pid)} (${x.award})`);
					out.push({
						key: `${tid}|${s}`,
						kind: "Awards haul",
						shape: "team",
						season: s,
						score: 20 + list.length * 8,
						pids: list.map((x) => x.pid).slice(0, 3),
						tids: [tid],
						heads: [
							`${list.length} award winners on one team: the ${t.name}`,
							`The ${t.name} swept the awards in ${s}`,
							`A trophy case full of ${t.region} players`,
						],
						bodies: [
							`The ${tLink(X, tid, s)} had ${plural(list.length, "major award winner")} in ${s}: ${listText(names)}.`,
						],
						evidence: [
							["Awards", `${list.length}`],
							["Record", rec(t)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "All-Star team",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const byTeam = new Map<number, SeasonLine[]>();
				for (const pid of X.awardPids(s, "All-Star")) {
					const l = X.line(pid, s);
					if (l) {
						byTeam.set(l.tid, [...(byTeam.get(l.tid) ?? []), l]);
					}
				}
				for (const [tid, ls] of byTeam) {
					const t = X.team(tid, s);
					if (ls.length < 4 || !t) {
						continue;
					}
					out.push({
						key: `${tid}|${s}`,
						kind: "All-Star team",
						shape: "team",
						season: s,
						score: 18 + ls.length * 6,
						pids: ls.slice(0, 3).map((l) => l.pid),
						tids: [tid],
						heads: [
							`${ls.length} All-Stars on the ${t.name}`,
							`A roster of stars: the ${s} ${t.name}`,
							`The ${t.region} ${t.name} sent ${ls.length} to the All-Star Game`,
						],
						bodies: [
							`The ${tLink(X, tid, s)} had ${plural(ls.length, "All-Star")} in ${s}: ${listText(ls.map((l) => pLinkOf(X, l.pid)))}. They went ${rec(t)}.`,
						],
						evidence: [
							["All-Stars", `${ls.length}`],
							["Record", rec(t)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Big three",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const byTeam = new Map<number, SeasonLine[]>();
				for (const l of X.lines(s)) {
					if (l.ws >= 9 && l.gp >= X.maxGp(s) * 0.5) {
						byTeam.set(l.tid, [...(byTeam.get(l.tid) ?? []), l]);
					}
				}
				for (const [tid, ls] of byTeam) {
					const t = X.team(tid, s);
					if (ls.length < 3 || !t) {
						continue;
					}
					const trio = topN(ls, 3, (l) => l.ws);
					const champ = X.champion(s)?.tid === tid;
					out.push({
						key: `${tid}|${s}`,
						kind: "Big three",
						shape: "team",
						season: s,
						score:
							18 + trio.reduce((a, l) => a + l.ws, 0) / 2 + (champ ? 10 : 0),
						pids: trio.map((l) => l.pid),
						tids: [tid],
						heads: [
							`A big three in ${t.region}`,
							`${trio.map((l) => X.players.get(l.pid)!.lastName).join(", ")}: the ${t.name}’ trio`,
							`Three stars, one team: the ${s} ${t.name}`,
						],
						bodies: [
							`${listText(trio.map((l) => `${pLinkOf(X, l.pid)} (${fmtNum(l.ws, 1)} WS)`))} each topped nine win shares for the ${tLink(X, tid, s)} in ${s}. They went ${rec(t)}${champ ? " and won the title" : ""}.`,
						],
						evidence: trio.map((l) => [
							X.players.get(l.pid)!.lastName,
							`${fmtNum(l.ws, 1)} WS`,
						]),
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Deep roster",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const byTeam = new Map<number, SeasonLine[]>();
				for (const l of X.lines(s)) {
					if (l.ppg >= 10 && l.gp >= X.maxGp(s) * 0.3) {
						byTeam.set(l.tid, [...(byTeam.get(l.tid) ?? []), l]);
					}
				}
				for (const [tid, ls] of byTeam) {
					const t = X.team(tid, s);
					if (ls.length < 7 || !t) {
						continue;
					}
					out.push({
						key: `${tid}|${s}`,
						kind: "Deep roster",
						shape: "team",
						season: s,
						score: 15 + ls.length * 4,
						pids: topN(ls, 3, (l) => l.ppg).map((l) => l.pid),
						tids: [tid],
						heads: [
							`${ls.length} players in double figures for the ${t.name}`,
							`No weak links: the ${s} ${t.name}`,
							`Everyone scored for the ${t.region} ${t.name}`,
						],
						bodies: [
							`${plural(ls.length, "player")} scored 10 or more points a game for the ${tLink(X, tid, s)} in ${s}. They went ${rec(t)}.`,
						],
						evidence: [
							["Double-figure scorers", `${ls.length}`],
							["Record", rec(t)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Age of champions",
		find: (X) => {
			const rows: { t: WTeamSeason; age: number }[] = [];
			for (const s of X.decidedSeasons()) {
				const c = X.champion(s);
				if (!c) {
					continue;
				}
				const ls = X.lines(s).filter((l) => l.tid === c.tid && l.min > 0);
				const min = ls.reduce((a, l) => a + l.min, 0);
				if (min <= 0) {
					continue;
				}
				rows.push({
					t: c,
					age: ls.reduce((a, l) => a + l.age * l.min, 0) / min,
				});
			}
			if (rows.length < 6) {
				return [];
			}
			const out: Draft[] = [];
			const mk = (
				r: { t: WTeamSeason; age: number },
				young: boolean,
			): Draft => ({
				key: `${young ? "y" : "o"}|${r.t.season}`,
				kind: "Age of champions",
				shape: "team",
				season: r.t.season,
				score: 26,
				pids: [],
				tids: [r.t.tid],
				heads: young
					? [
							`The youngest champions yet: the ${r.t.season} ${r.t.name}`,
							`Kids win it all in ${r.t.region}`,
							`A title for a team averaging ${fmtNum(r.age, 1)} years old`,
						]
					: [
							`The oldest champions yet: the ${r.t.season} ${r.t.name}`,
							`Veterans win it all in ${r.t.region}`,
							`A title for a team averaging ${fmtNum(r.age, 1)} years old`,
						],
				bodies: [
					`Weighted by minutes played, the ${tLink(X, r.t.tid, r.t.season)} averaged ${fmtNum(r.age, 1)} years old in ${r.t.season}, the ${young ? "youngest" : "oldest"} of any champion in this league’s history so far (the average champion: ${fmtNum(rows.reduce((a, x) => a + x.age, 0) / rows.length, 1)}).`,
				],
				evidence: [
					["Average age", fmtNum(r.age, 1)],
					["Record", rec(r.t)],
				],
			});
			const sorted = [...rows].sort((a, b) => a.age - b.age);
			out.push(mk(sorted[0]!, true), mk(sorted.at(-1)!, false));
			return out;
		},
	},
	{
		kind: "Total overhaul",
		find: (X) => {
			const out: Draft[] = [];
			for (const t of decidedTeams(X)) {
				const a = X.team(t.tid, t.season - 1);
				if (!a || gamesOf(a) < 20) {
					continue;
				}
				const rot = topN(
					X.lines(t.season - 1).filter((l) => l.tid === t.tid),
					10,
					(l) => l.min,
				);
				if (rot.length < 8) {
					continue;
				}
				const gone = rot.filter(
					(l) =>
						!X.lines(t.season).some(
							(m) => m.pid === l.pid && m.tids.includes(t.tid),
						),
				);
				const d = t.won - a.won;
				if (gone.length < 7 || Math.abs(d) < 12) {
					continue;
				}
				out.push({
					key: `${t.tid}|${t.season}`,
					kind: "Total overhaul",
					shape: "team",
					season: t.season,
					score: 14 + gone.length * 2 + Math.abs(d) * 0.8,
					pids: topN(gone, 2, (l) => l.ws).map((l) => l.pid),
					tids: [t.tid],
					heads: [
						`${gone.length} of the top ten left the ${t.name}`,
						`A new team in ${t.region}: ${gone.length} rotation players gone`,
						`The ${t.name} blew it up, and went ${rec(t)}`,
					],
					bodies: [
						`Of the ${tLink(X, t.tid, t.season - 1)}’ ten busiest players in ${t.season - 1}, ${gone.length} were gone by ${t.season}. The team went from ${rec(a)} to ${rec(t)}.`,
					],
					evidence: [
						["Rotation gone", `${gone.length} of ${rot.length}`],
						["Before", rec(a)],
						["After", rec(t)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "The core",
		find: (X) => {
			const out: Draft[] = [];
			for (const tid of teamsWithHistory(X)) {
				const seasons = X.teamHistory(tid)
					.filter((t) => X.decided(t.season))
					.map((t) => t.season);
				const top5 = new Map<number, Set<number>>();
				for (const s of seasons) {
					top5.set(
						s,
						new Set(
							topN(
								X.lines(s).filter((l) => l.tid === tid),
								5,
								(l) => l.ws,
							).map((l) => l.pid),
						),
					);
				}
				let i = 0;
				while (i < seasons.length) {
					let common = top5.get(seasons[i]!)!;
					let j = i;
					while (
						j + 1 < seasons.length &&
						seasons[j + 1] === seasons[j]! + 1 &&
						[...common].filter((p) => top5.get(seasons[j + 1]!)!.has(p))
							.length >= 3
					) {
						common = new Set(
							[...common].filter((p) => top5.get(seasons[j + 1]!)!.has(p)),
						);
						j++;
					}
					if (j - i + 1 >= 4 && common.size >= 3) {
						const from = seasons[i]!;
						const to = seasons[j]!;
						const ps = topN(
							[...common].map((pid) => X.players.get(pid)!),
							3,
							(p: WPlayer) => X.career(p).ws,
						);
						const titles = seasons
							.slice(i, j + 1)
							.filter((s) => X.champion(s)?.tid === tid).length;
						const t = X.team(tid, to)!;
						out.push({
							key: `${tid}|${from}`,
							kind: "The core",
							shape: "team",
							season: to,
							score: 18 + (j - i + 1) * 4 + titles * 6,
							pids: ps.map((p) => p.pid),
							tids: [tid],
							heads: [
								`${ps.map((p) => p.lastName).join(", ")}: ${j - i + 1} years together`,
								`The ${t.name}’ core stayed together`,
								`A trio that lasted: ${listText(ps.map((p) => p.lastName))}`,
							],
							bodies: [
								`${listText(ps.map(pLink))} were all among the ${tLink(X, tid, to)}’ five best players by win shares for ${plural(j - i + 1, "season")} running (${span(from, to)})${titles > 0 ? `, winning ${plural(titles, "title")}` : ""}.`,
							],
							evidence: [
								["Seasons", `${j - i + 1}`],
								["Titles", `${titles}`],
							],
						});
						i = j + 1;
					} else {
						i++;
					}
				}
			}
			return out;
		},
	},
	{
		kind: "Playoff rivalry",
		find: (X) => {
			const out: Draft[] = [];
			const meets = new Map<
				string,
				{ season: number; w: number; l: number; a: number }[]
			>();
			for (const s of X.decidedSeasons()) {
				X.series(s)?.rounds.forEach((round) => {
					for (const m of round) {
						if (!m.away) {
							continue;
						}
						const [a, b] =
							m.home.tid < m.away.tid ? [m.home, m.away] : [m.away, m.home];
						const k = `${a.tid}|${b.tid}`;
						meets.set(k, [
							...(meets.get(k) ?? []),
							{ season: s, w: a.won, l: b.won, a: a.tid },
						]);
					}
				});
			}
			for (const [k, list] of meets) {
				if (list.length < 4) {
					continue;
				}
				const [a, b] = k.split("|").map(Number) as [number, number];
				const last = list.at(-1)!;
				const aWins = list.filter((x) => x.w > x.l).length;
				out.push({
					key: k,
					kind: "Playoff rivalry",
					shape: "playoffs",
					season: last.season,
					score: 15 + list.length * 5,
					pids: [],
					tids: [a, b],
					heads: [
						`${X.teamName(a, last.season)} and ${X.teamName(b, last.season)}: ${list.length} playoff series`,
						`A playoff rivalry: ${X.teamAny(a, last.season)?.name} and ${X.teamAny(b, last.season)?.name}`,
						`They keep meeting in April`,
					],
					bodies: [
						`The ${tLink(X, a, last.season)} and the ${tLink(X, b, last.season)} have met in the playoffs ${plural(list.length, "time")} (${list.map((x) => x.season).join(", ")}). ${X.teamAny(a, last.season)?.name} won ${aWins}, ${X.teamAny(b, last.season)?.name} won ${list.length - aWins}.`,
					],
					evidence: [
						["Series", `${list.length}`],
						["Split", `${aWins}-${list.length - aWins}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Finals MVP repeat",
		find: (X) => {
			const out: Draft[] = [];
			const by = new Map<number, number[]>();
			for (const s of X.decidedSeasons()) {
				const p = X.awardWinner(s, "Finals MVP");
				if (p) {
					by.set(p.pid, [...(by.get(p.pid) ?? []), s]);
				}
			}
			for (const [pid, ss] of by) {
				if (ss.length < 2) {
					continue;
				}
				const p = X.players.get(pid)!;
				out.push({
					key: `${pid}`,
					kind: "Finals MVP repeat",
					shape: "career",
					season: ss.at(-1)!,
					score: 24 + ss.length * 9,
					pids: [pid],
					tids: [],
					heads: [
						`${p.name} is a ${ss.length}-time Finals MVP`,
						`Finals after finals, ${p.name} delivers`,
						`The finals belong to ${p.name}`,
					],
					bodies: [
						`${pLink(p)} was Finals MVP ${plural(ss.length, "time")}: ${ss.join(", ")}.`,
					],
					evidence: [["Finals MVPs", `${ss.length}`]],
				});
			}
			return out;
		},
	},
	{
		kind: "Lone star",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const top = topN(
					X.poLines(s).filter((l) => l.gp >= 4 && l.mpg >= 20),
					1,
					(l) => l.ppg,
				)[0];
				const c = X.champion(s);
				const t = top ? X.team(top.tid, s) : undefined;
				if (!top || !c || !t || c.tid === top.tid || top.ppg < 25) {
					continue;
				}
				const p = X.players.get(top.pid)!;
				out.push({
					key: `${s}`,
					kind: "Lone star",
					shape: "playoffs",
					season: s,
					score: 14 + top.ppg,
					pids: [top.pid],
					tids: [top.tid],
					heads: [
						`${p.name} led all playoff scorers, but it wasn’t enough`,
						`${fmtNum(top.ppg, 1)} a game and out early: ${p.name}`,
						`A great playoffs for ${p.name} ends in defeat`,
					],
					bodies: [
						`${pLink(p)} averaged ${fmtNum(top.ppg, 1)} points in the ${s} playoffs, the most of anyone, but the ${tLink(X, top.tid, s)} ${t.playoffRoundsWon < 0 ? "did not advance" : `lost in ${roundLabel(t.playoffRoundsWon, X.numRounds(s))}`}.`,
					],
					evidence: [
						["Playoff PPG", fmtNum(top.ppg, 1)],
						["Games", `${top.gp}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Ring collector",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const titles = titleSeasons(X, p);
				if (titles.length < 3) {
					continue;
				}
				const tids = [...new Set(titles.map((s) => X.champion(s)!.tid))];
				out.push({
					key: `${p.pid}`,
					kind: "Ring collector",
					shape: "career",
					season: titles.at(-1)!,
					score: 20 + titles.length * 9,
					pids: [p.pid],
					tids,
					heads: [
						`${p.name} has ${titles.length} rings`,
						`${titles.length} titles for ${p.name}`,
						`A winner: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} won ${plural(titles.length, "title")}: ${titles.join(", ")}${tids.length > 1 ? `, with ${plural(tids.length, "different team")}` : ""}.`,
					],
					evidence: [
						["Titles", `${titles.length}`],
						["Teams", `${tids.length}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Champion with two teams",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const titles = titleSeasons(X, p);
				const tids = [...new Set(titles.map((s) => X.champion(s)!.tid))];
				if (tids.length < 2 || titles.length > 2) {
					continue;
				}
				const first = titles[0]!;
				const last = titles.at(-1)!;
				out.push({
					key: `${p.pid}`,
					kind: "Champion with two teams",
					shape: "career",
					season: last,
					score: 24 + (last - first),
					pids: [p.pid],
					tids,
					heads: [
						`${p.name} won it all with two different teams`,
						`Title in ${first} and title in ${last}, for different teams: ${p.name}`,
						`A ring on each team: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} won a title with the ${tLink(X, X.champion(first)!.tid, first)} in ${first} and another with the ${tLink(X, X.champion(last)!.tid, last)} in ${last}.`,
					],
					evidence: [
						["Titles", titles.join(", ")],
						["Teams", `${tids.length}`],
					],
				});
			}
			return out;
		},
	},
];

const pLinkOf = (X: Parameters<Kind["find"]>[0], pid: number) => {
	const p = X.players.get(pid);
	return p ? pLink(p) : "a player";
};
