// More storyline kinds, about players: leaders, milestones, odd careers, draft classes and trades. Same rules as index.ts: facts only from the snapshot, only decided seasons for anything that depends on playoffs or awards.

import type { SeasonLine } from "../wrapped/league.ts";
import { fmtNum, listText, ordinal, plural, span } from "../wrapped/util.ts";
import {
	isActive,
	leadersBy,
	lineText,
	pLink,
	regRows,
	seasonsOf,
	titleSeasons,
	tLink,
	topN,
	type Draft,
	type Kind,
	type RateKey,
	lineOf,
	careerOf,
} from "./kit.ts";

const AWARD_MVP = "Most Valuable Player";

const firstSeason = (rows: { season: number }[]) => rows[0]?.season;

// A league-leader "crown" kind: players who led in a rate several times
const crown = (
	kind: string,
	key: RateKey,
	what: string,
	unit: string,
): Kind => ({
	kind,
	find: (X) => {
		const crowns = new Map<number, number[]>();
		for (const s of X.decidedSeasons()) {
			const top = leadersBy(X, s, key)[0];
			if (top && top[key] > 0) {
				crowns.set(top.pid, [...(crowns.get(top.pid) ?? []), s]);
			}
		}
		const out: Draft[] = [];
		for (const [pid, ss] of crowns) {
			if (ss.length < 2) {
				continue;
			}
			const p = X.players.get(pid)!;
			const best = Math.max(...ss.map((s) => lineOf(X, pid, s)![key]));
			out.push({
				key: `${pid}`,
				kind,
				shape: "career",
				season: ss.at(-1)!,
				score: 18 + ss.length * 7,
				pids: [pid],
				tids: [],
				heads: [
					`${p.name} has ${ss.length} ${what} titles`,
					`The ${what} champion again: ${p.name}`,
					`${p.name} owns the ${what} crown`,
				],
				bodies: [
					`${pLink(p)} led the league in ${unit} ${plural(ss.length, "time")}: ${ss.join(", ")}.`,
					`${ss.length} seasons at the top of the ${unit} list for ${pLink(p)}, with a best of ${fmtNum(best, 1)} a game.`,
				],
				evidence: [
					[`${what[0]!.toUpperCase()}${what.slice(1)} titles`, `${ss.length}`],
					["Best", fmtNum(best, 1)],
				],
			});
		}
		return out;
	},
});

const pg = (l: SeasonLine) =>
	`${fmtNum(l.ppg, 1)}-${fmtNum(l.rpg, 1)}-${fmtNum(l.apg, 1)}`;

export const PLAYER_KINDS: Kind[] = [
	{
		kind: "Triple-double average",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				for (const l of X.qualified(s)) {
					if (l.ppg < 8 || l.rpg < 8 || l.apg < 8) {
						continue;
					}
					const full = l.ppg >= 10 && l.rpg >= 10 && l.apg >= 10;
					const p = X.players.get(l.pid)!;
					out.push({
						key: `${l.pid}|${s}`,
						kind: "Triple-double average",
						shape: "season",
						season: s,
						score: 25 + (l.ppg + l.rpg + l.apg) / 2 + (full ? 25 : 0),
						pids: [l.pid],
						tids: [l.tid],
						heads: full
							? [
									`${p.name} averaged a triple-double`,
									`Triple-double season: ${p.name}, ${s}`,
									`${pg(l)} for ${p.name}`,
								]
							: [
									`${p.name} nearly averaged a triple-double`,
									`${pg(l)}: ${p.name}’s all-around ${s}`,
									`Points, boards and dimes: ${p.name}`,
								],
						bodies: [
							`${pLink(p)} put up ${lineText(l)} for the ${tLink(X, l.tid, s)} in ${s}.`,
							`In ${s}, ${pLink(p)} was in the top tier of three categories at once: ${pg(l)} (points, rebounds, assists).`,
						],
						evidence: [
							["PTS", fmtNum(l.ppg, 1)],
							["REB", fmtNum(l.rpg, 1)],
							["AST", fmtNum(l.apg, 1)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Twenty and twelve",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				for (const l of X.qualified(s)) {
					if (l.ppg < 20 || l.rpg < 12) {
						continue;
					}
					const p = X.players.get(l.pid)!;
					out.push({
						key: `${l.pid}|${s}`,
						kind: "Twenty and twelve",
						shape: "season",
						season: s,
						score: 15 + (l.ppg - 20) * 2 + (l.rpg - 12) * 3,
						pids: [l.pid],
						tids: [l.tid],
						heads: [
							`${p.name} gave 20 and 12 a night`,
							`${fmtNum(l.ppg, 1)} and ${fmtNum(l.rpg, 1)}: ${p.name} in ${s}`,
							`The big man’s big year: ${p.name}`,
						],
						bodies: [
							`${pLink(p)} averaged ${fmtNum(l.ppg, 1)} points and ${fmtNum(l.rpg, 1)} rebounds for the ${tLink(X, l.tid, s)} in ${s}.`,
							`Only ${plural(X.qualified(s).filter((q) => q.ppg >= 20 && q.rpg >= 12).length, "player")} reached 20 points and 12 rebounds a game in ${s}. ${pLink(p)} was one: ${fmtNum(l.ppg, 1)} and ${fmtNum(l.rpg, 1)}.`,
						],
						evidence: [
							["PTS", fmtNum(l.ppg, 1)],
							["REB", fmtNum(l.rpg, 1)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "50-40-90",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const full = X.maxGp(s);
				for (const l of X.qualified(s)) {
					if (l.fga <= 0 || l.tpa < 1.5 * full || l.fta < 1.5 * full) {
						continue;
					}
					const fg = l.fg / l.fga;
					const tp = l.tp / l.tpa;
					const ft = l.ft / l.fta;
					if (fg < 0.5 || tp < 0.4 || ft < 0.9) {
						continue;
					}
					const p = X.players.get(l.pid)!;
					const txt = `${fmtNum(fg * 100, 1)}% from the field, ${fmtNum(tp * 100, 1)}% from three and ${fmtNum(ft * 100, 1)}% at the line`;
					out.push({
						key: `${l.pid}|${s}`,
						kind: "50-40-90",
						shape: "season",
						season: s,
						score: 45 + (fg - 0.5 + tp - 0.4 + ft - 0.9) * 100,
						pids: [l.pid],
						tids: [l.tid],
						heads: [
							`${p.name} joined the 50-40-90 club`,
							`Shooting like a machine: ${p.name}, ${s}`,
							`50-40-90: ${p.name}’s perfect shooting year`,
						],
						bodies: [
							`${pLink(p)} shot ${txt} in ${s}, with ${fmtNum(l.ppg, 1)} points a game for the ${tLink(X, l.tid, s)}.`,
							`Half his shots, 40% of his threes, 90% of his free throws: ${pLink(p)} did it all in ${s} (${txt}).`,
						],
						evidence: [
							["FG%", fmtNum(fg * 100, 1)],
							["3P%", fmtNum(tp * 100, 1)],
							["FT%", fmtNum(ft * 100, 1)],
						],
					});
				}
			}
			return out;
		},
	},
	crown("Rebounding king", "rpg", "rebounding", "rebounds per game"),
	crown("Assist king", "apg", "assist", "assists per game"),
	crown("Steals king", "spg", "steals", "steals per game"),
	crown("Blocks king", "bpg", "blocks", "blocks per game"),
	{
		kind: "Two categories",
		find: (X) => {
			const out: Draft[] = [];
			const keys: [RateKey, string][] = [
				["ppg", "scoring"],
				["rpg", "rebounding"],
				["apg", "assists"],
				["spg", "steals"],
				["bpg", "blocks"],
			];
			for (const s of X.decidedSeasons()) {
				const won = new Map<number, string[]>();
				for (const [k, label] of keys) {
					const top = leadersBy(X, s, k)[0];
					if (top && top[k] > 0) {
						won.set(top.pid, [...(won.get(top.pid) ?? []), label]);
					}
				}
				for (const [pid, labels] of won) {
					if (labels.length < 2) {
						continue;
					}
					const l = lineOf(X, pid, s)!;
					const p = X.players.get(pid)!;
					out.push({
						key: `${pid}|${s}`,
						kind: "Two categories",
						shape: "season",
						season: s,
						score: 20 + labels.length * 18,
						pids: [pid],
						tids: [l.tid],
						heads: [
							`${p.name} led the league in ${labels.length === 2 ? "two categories" : `${labels.length} categories`}`,
							`${p.name} on top of ${listText(labels)}`,
							`A double crown for ${p.name} in ${s}`,
						],
						bodies: [
							`In ${s} ${pLink(p)} led the league in ${listText(labels)}, with ${lineText(l)}.`,
							`${listText(labels.map((x) => x[0]!.toUpperCase() + x.slice(1)))}: ${pLink(p)} finished first in ${labels.length} categories for the ${tLink(X, l.tid, s)} in ${s}.`,
						],
						evidence: labels.map((x) => ["Led in", x]),
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Alone at the top",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				const [a, b] = leadersBy(X, s, "ws");
				if (!a || !b || a.ws < 12 || a.ws - b.ws < Math.max(3, a.ws * 0.2)) {
					continue;
				}
				const p = X.players.get(a.pid)!;
				const q = X.players.get(b.pid)!;
				out.push({
					key: `${s}`,
					kind: "Alone at the top",
					shape: "season",
					season: s,
					score: 20 + (a.ws - b.ws) * 4,
					pids: [a.pid, b.pid],
					tids: [a.tid],
					heads: [
						`Nobody was close to ${p.name} in ${s}`,
						`${p.name}: ${fmtNum(a.ws, 1)} win shares, and a gap`,
						`The league’s best player by a mile: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} led the league with ${fmtNum(a.ws, 1)} win shares in ${s}. ${pLink(q)} was next with ${fmtNum(b.ws, 1)}.`,
						`${fmtNum(a.ws - b.ws, 1)} win shares separated ${pLink(p)} (${fmtNum(a.ws, 1)}) from ${q.name} (${fmtNum(b.ws, 1)}) in ${s}.`,
					],
					evidence: [
						["WS", fmtNum(a.ws, 1)],
						["Next best", fmtNum(b.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Scoring jump",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				for (const l of X.qualified(s)) {
					const prev = lineOf(X, l.pid, s - 1);
					if (
						!prev ||
						prev.gp < 20 ||
						prev.ppg < 3 ||
						l.ppg < 12 ||
						l.ppg < prev.ppg * 1.8
					) {
						continue;
					}
					const p = X.players.get(l.pid)!;
					out.push({
						key: `${l.pid}|${s}`,
						kind: "Scoring jump",
						shape: "season",
						season: s,
						span: [s - 1, s],
						score: 15 + (l.ppg - prev.ppg) * 2.5,
						pids: [l.pid],
						tids: [l.tid],
						heads: [
							`${p.name} nearly doubled his scoring`,
							`From ${fmtNum(prev.ppg, 1)} to ${fmtNum(l.ppg, 1)}: ${p.name}’s leap`,
							`Where did the points come from? Ask ${p.name}`,
						],
						bodies: [
							`${pLink(p)} averaged ${fmtNum(prev.ppg, 1)} points in ${s - 1} and ${fmtNum(l.ppg, 1)} in ${s}, at age ${l.age}.`,
							`${s - 1}: ${fmtNum(prev.ppg, 1)} points a game. ${s}: ${fmtNum(l.ppg, 1)}. ${pLink(p)} went from ${fmtNum(prev.mpg, 1)} to ${fmtNum(l.mpg, 1)} minutes along the way.`,
						],
						evidence: [
							["PPG before", fmtNum(prev.ppg, 1)],
							["PPG after", fmtNum(l.ppg, 1)],
							["Age", `${l.age}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Rookie sensation",
		find: (X) => {
			const out: Draft[] = [];
			for (const s of X.decidedSeasons()) {
				for (const l of X.qualified(s)) {
					const p = X.players.get(l.pid)!;
					const first = firstSeason(regRows(p));
					if (
						first !== s ||
						s <= X.L.startingSeason ||
						(l.ppg < 17 && l.ws < 8)
					) {
						continue;
					}
					const roy = X.awardPids(s, "Rookie of the Year").includes(l.pid);
					out.push({
						key: `${l.pid}`,
						kind: "Rookie sensation",
						shape: "season",
						season: s,
						score: 15 + l.ppg * 1.2 + l.ws + (roy ? 8 : 0),
						pids: [l.pid],
						tids: [l.tid],
						heads: [
							`${p.name} arrived with a bang`,
							`A rookie like no other: ${p.name}`,
							`${fmtNum(l.ppg, 1)} points as a rookie for ${p.name}`,
						],
						bodies: [
							`${pLink(p)} averaged ${lineText(l)} as a rookie in ${s}${roy ? " and was named Rookie of the Year" : ""}.`,
							`${roy ? "Rookie of the Year" : "A rookie"} in ${s}: ${pLink(p)} added ${fmtNum(l.ws, 1)} win shares for the ${tLink(X, l.tid, s)}.`,
						],
						evidence: [
							["PPG", fmtNum(l.ppg, 1)],
							["WS", fmtNum(l.ws, 1)],
							["ROY", roy ? "Yes" : "No"],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Sudden fall",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const lines = seasonsOf(regRows(p))
					.filter((s) => X.decided(s))
					.map((s) => lineOf(X, p.pid, s))
					.filter((l): l is SeasonLine => !!l);
				if (lines.length < 3) {
					continue;
				}
				let peak = lines[0]!;
				for (const l of lines) {
					if (l.ws > peak.ws) {
						peak = l;
					}
					if (
						l.season > peak.season &&
						peak.ws >= 10 &&
						l.ws <= peak.ws * 0.35 &&
						l.age <= 31 &&
						l.gp >= X.maxGp(l.season) * 0.5
					) {
						out.push({
							key: `${p.pid}`,
							kind: "Sudden fall",
							shape: "career",
							season: l.season,
							score: 15 + (peak.ws - l.ws) * 2.5,
							pids: [p.pid],
							tids: [l.tid],
							heads: [
								`${p.name} fell off a cliff`,
								`What happened to ${p.name}?`,
								`From ${fmtNum(peak.ws, 1)} win shares to ${fmtNum(l.ws, 1)}: ${p.name}`,
							],
							bodies: [
								`${pLink(p)} had ${fmtNum(peak.ws, 1)} win shares and ${fmtNum(peak.ppg, 1)} points a game in ${peak.season}. In ${l.season}, at ${l.age}, he had ${fmtNum(l.ws, 1)} and ${fmtNum(l.ppg, 1)}, playing ${fmtNum(l.gp)} games.`,
							],
							evidence: [
								["Peak WS", fmtNum(peak.ws, 1)],
								["Then", fmtNum(l.ws, 1)],
								["Age", `${l.age}`],
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
		kind: "Comeback",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const bySeason = new Map<number, { games: number; type: string }>();
				for (const i of p.injuries) {
					const cur = bySeason.get(i.season);
					if (!cur || i.games > cur.games) {
						bySeason.set(i.season, { games: i.games, type: i.type });
					}
				}
				for (const [s, inj] of bySeason) {
					const before = lineOf(X, p.pid, s - 1);
					const missed = lineOf(X, p.pid, s);
					const back = lineOf(X, p.pid, s + 1);
					if (
						inj.games < 40 ||
						!X.decided(s + 1) ||
						!back ||
						!before ||
						before.ws < 7 ||
						back.gp < X.maxGp(s + 1) * 0.6 ||
						back.ws < before.ws * 0.8 ||
						(missed && missed.gp >= X.maxGp(s) * 0.7)
					) {
						continue;
					}
					out.push({
						key: `${p.pid}|${s}`,
						kind: "Comeback",
						shape: "career",
						season: s + 1,
						span: [s, s + 1],
						score: 15 + inj.games / 4 + back.ws,
						pids: [p.pid],
						tids: [back.tid],
						heads: [
							`${p.name} came back strong`,
							`Back from ${inj.type.toLowerCase()}: ${p.name}`,
							`${p.name} returns after ${plural(inj.games, "missed game")}`,
						],
						bodies: [
							`${pLink(p)} missed ${plural(inj.games, "game")} with ${inj.type.toLowerCase()} in ${s}, then returned in ${s + 1} with ${fmtNum(back.ppg, 1)} points a game and ${fmtNum(back.ws, 1)} win shares (${fmtNum(before.ws, 1)} in ${s - 1}).`,
						],
						evidence: [
							["Games missed", `${inj.games}`],
							["WS before", fmtNum(before.ws, 1)],
							["WS after", fmtNum(back.ws, 1)],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Lost years",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const inj = p.injuries.filter(
					(i) => X.decided(i.season) || i.season < X.L.season,
				);
				const games = inj.reduce((a, i) => a + i.games, 0);
				const c = careerOf(X, p);
				if (games < 300 || c.ws < 25 || inj.length < 4) {
					continue;
				}
				const worst = [...inj].sort((a, b) => b.games - a.games)[0]!;
				out.push({
					key: `${p.pid}`,
					kind: "Lost years",
					shape: "career",
					season: Math.max(...inj.map((i) => i.season)),
					score: 12 + games / 20 + c.ws / 8,
					pids: [p.pid],
					tids: [],
					heads: [
						`${p.name} lost ${fmtNum(games)} games to injury`,
						`The injury bug followed ${p.name}`,
						`What might have been: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} missed ${plural(games, "game")} across ${plural(inj.length, "injury", "injuries")}, the longest ${plural(worst.games, "game")} in ${worst.season}. He still put up ${fmtNum(c.ws, 1)} career win shares.`,
					],
					evidence: [
						["Games lost", fmtNum(games)],
						["Injuries", `${inj.length}`],
						["Career WS", fmtNum(c.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Young All-Star",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const first = p.awards
					.filter((a) => a.type === "All-Star")
					.map((a) => a.season)
					.sort((a, b) => a - b)[0];
				if (first === undefined) {
					continue;
				}
				const age = first - p.bornYear;
				if (age > 21) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Young All-Star",
					shape: "career",
					season: first,
					score: 15 + (22 - age) * 9,
					pids: [p.pid],
					tids: [lineOf(X, p.pid, first)?.tid ?? p.tid].filter((t) => t >= 0),
					heads: [
						`${p.name} was an All-Star at ${age}`,
						`Too young to be this good: ${p.name}`,
						`A ${age}-year-old in the All-Star Game`,
					],
					bodies: [
						`${pLink(p)} made the All-Star team in ${first}, at age ${age}${lineOf(X, p.pid, first) ? `, with ${fmtNum(lineOf(X, p.pid, first)!.ppg, 1)} points a game` : ""}.`,
					],
					evidence: [
						["Age", `${age}`],
						["Season", `${first}`],
					],
				});
			}
			return topN(out, 20, (d) => d.score);
		},
	},
	{
		kind: "Veteran All-Star",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const old = p.awards
					.filter((a) => a.type === "All-Star")
					.map((a) => a.season)
					.sort((a, b) => b - a)
					.find((s) => s - p.bornYear >= 35);
				if (old === undefined) {
					continue;
				}
				const age = old - p.bornYear;
				const as = p.awards.filter((a) => a.type === "All-Star").length;
				out.push({
					key: `${p.pid}`,
					kind: "Veteran All-Star",
					shape: "career",
					season: old,
					score: 12 + (age - 34) * 9,
					pids: [p.pid],
					tids: [lineOf(X, p.pid, old)?.tid ?? p.tid].filter((t) => t >= 0),
					heads: [
						`${p.name} was still an All-Star at ${age}`,
						`Old but gold: ${p.name}`,
						`${age} and still among the best`,
					],
					bodies: [
						`${pLink(p)} was named an All-Star in ${old}, at age ${age}, one of ${plural(as, "selection")} in his career.`,
					],
					evidence: [
						["Age", `${age}`],
						["All-Stars", `${as}`],
					],
				});
			}
			return topN(out, 20, (d) => d.score);
		},
	},
	{
		kind: "Late-career peak",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const lines = seasonsOf(regRows(p))
					.filter((s) => X.decided(s))
					.map((s) => lineOf(X, p.pid, s))
					.filter((l): l is SeasonLine => !!l);
				if (lines.length < 8) {
					continue;
				}
				const best = [...lines].sort((a, b) => b.ws - a.ws)[0]!;
				if (best.age < 32 || best.ws < 8) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Late-career peak",
					shape: "career",
					season: best.season,
					score: 12 + (best.age - 31) * 6 + best.ws,
					pids: [p.pid],
					tids: [best.tid],
					heads: [
						`${p.name} saved his best for last`,
						`Peaking at ${best.age}: ${p.name}`,
						`The best year came late for ${p.name}`,
					],
					bodies: [
						`${pLink(p)} had the best season of his career at ${best.age}: ${fmtNum(best.ws, 1)} win shares and ${fmtNum(best.ppg, 1)} points a game for the ${tLink(X, best.tid, best.season)} in ${best.season}, his ${ordinal(lines.indexOf(best) + 1)} year.`,
					],
					evidence: [
						["Age", `${best.age}`],
						["WS", fmtNum(best.ws, 1)],
						["Season No.", `${lines.indexOf(best) + 1}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "MVP on the move",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				for (const a of p.awards) {
					if (a.type !== AWARD_MVP || !X.decided(a.season)) {
						continue;
					}
					const t = p.moves.find(
						(m) =>
							m.type === "trade" &&
							m.fromTid !== undefined &&
							m.fromTid >= 0 &&
							m.tid >= 0 &&
							(m.season === a.season || m.season === a.season + 1) &&
							X.decided(m.season),
					);
					if (!t) {
						continue;
					}
					out.push({
						key: `${p.pid}|${a.season}`,
						kind: "MVP on the move",
						shape: "season",
						season: t.season,
						score: 38,
						pids: [p.pid],
						tids: [t.tid, t.fromTid!],
						heads: [
							`The ${X.teamName(t.fromTid!, t.season)} traded their MVP`,
							`${p.name}, an MVP, is on the move`,
							`MVP ${p.name} changes teams`,
						],
						bodies: [
							`${pLink(p)} won the MVP award in ${a.season}. In ${t.season} he was traded from the ${tLink(X, t.fromTid!, t.season)} to the ${tLink(X, t.tid, t.season)}.`,
						],
						evidence: [
							["MVP", `${a.season}`],
							["Traded", `${t.season}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Free-agent jackpot",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const m = p.moves.find((x) => x.type === "freeAgent" && x.tid >= 0);
				if (!m || !X.decided(m.season + 1)) {
					continue;
				}
				// The first season he played for the signing team after signing
				const row = regRows(p).find(
					(r) => r.tid === m.tid && r.season >= m.season,
				);
				if (!row) {
					continue;
				}
				const l = lineOf(X, p.pid, row.season);
				const as = p.awards.some(
					(a) => a.type === "All-Star" && a.season === row.season,
				);
				if (!l || !X.decided(row.season) || l.ws < 10 || !as) {
					continue;
				}
				const before = regRows(p).filter((r) => r.season < row.season);
				const prevTid = before.at(-1)?.tid;
				if (before.length === 0 || prevTid === m.tid) {
					continue;
				}
				out.push({
					key: `${p.pid}|${row.season}`,
					kind: "Free-agent jackpot",
					shape: "season",
					season: row.season,
					score: 15 + l.ws * 2,
					pids: [p.pid],
					tids: [m.tid],
					heads: [
						`${p.name} signed as a free agent and starred`,
						`A signing that paid off: ${p.name}`,
						`The ${X.teamName(m.tid, row.season)} got a bargain in ${p.name}`,
					],
					bodies: [
						`${pLink(p)} signed with the ${tLink(X, m.tid, row.season)} as a free agent and made the All-Star team in ${row.season}, with ${fmtNum(l.ppg, 1)} points a game and ${fmtNum(l.ws, 1)} win shares.`,
					],
					evidence: [
						["Signed", `${m.season}`],
						["WS", fmtNum(l.ws, 1)],
						["PPG", fmtNum(l.ppg, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Late-pick star",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const late =
					p.draft.round >= 2 || (p.draft.round === 1 && p.draft.pick >= 25);
				if (!late || p.draft.round <= 0 || p.stats.length === 0) {
					continue;
				}
				const as = p.awards.filter((a) => a.type === "All-Star").length;
				const c = careerOf(X, p);
				if (as < 2 && c.ws < 45) {
					continue;
				}
				out.push({
					key: `${p.pid}`,
					kind: "Late-pick star",
					shape: "career",
					season: p.draft.year,
					score: 18 + as * 5 + c.ws / 6 + (p.draft.round - 1) * 6,
					pids: [p.pid],
					tids: p.draft.tid >= 0 ? [p.draft.tid] : [],
					heads: [
						`${p.name} was picked late and became a star`,
						`The steal of the ${p.draft.year} draft: ${p.name}`,
						`${p.name}, a round ${p.draft.round} pick, made it big`,
					],
					bodies: [
						`${pLink(p)} was taken with pick ${p.draft.pick} of round ${p.draft.round} in ${p.draft.year}. He went on to ${plural(as, "All-Star selection")} and ${fmtNum(c.ws, 1)} career win shares.`,
					],
					evidence: [
						["Draft", `R${p.draft.round} #${p.draft.pick}`],
						["All-Stars", `${as}`],
						["Career WS", fmtNum(c.ws, 1)],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "No. 1 pick, MVP",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				const mvps = p.awards.filter(
					(a) => a.type === AWARD_MVP && X.decided(a.season),
				);
				if (p.draft.round !== 1 || p.draft.pick !== 1 || mvps.length === 0) {
					continue;
				}
				const first = mvps.map((a) => a.season).sort((a, b) => a - b)[0]!;
				out.push({
					key: `${p.pid}`,
					kind: "No. 1 pick, MVP",
					shape: "career",
					season: first,
					score: 35 + mvps.length * 8,
					pids: [p.pid],
					tids: p.draft.tid >= 0 ? [p.draft.tid] : [],
					heads: [
						`The No. 1 pick became the MVP: ${p.name}`,
						`${p.name} lived up to the top pick`,
						`First pick, first in the league: ${p.name}`,
					],
					bodies: [
						`${pLink(p)} went first in the ${p.draft.year} draft${p.draft.tid >= 0 ? ` to the ${tLink(X, p.draft.tid, p.draft.year)}` : ""} and won the MVP award in ${first}${mvps.length > 1 ? `, one of ${plural(mvps.length, "MVP")} in all` : ""}.`,
					],
					evidence: [
						["Draft", `${p.draft.year}, No. 1`],
						["MVPs", `${mvps.length}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Stacked draft class",
		find: (X) => {
			const out: Draft[] = [];
			const byYear = new Map<number, typeof X.L.players>();
			for (const p of X.L.players) {
				if (p.draft.round > 0) {
					byYear.set(p.draft.year, [...(byYear.get(p.draft.year) ?? []), p]);
				}
			}
			for (const [year, ps] of byYear) {
				const stars = ps.filter((p) =>
					p.awards.some((a) => a.type === "All-Star"),
				);
				if (stars.length < 4) {
					continue;
				}
				const mvps = ps.reduce((a, p) => a + X.countAwards(p, AWARD_MVP), 0);
				const top = topN(stars, 3, (p) => careerOf(X, p).ws);
				out.push({
					key: `${year}`,
					kind: "Stacked draft class",
					shape: "season",
					season: year,
					score: 20 + stars.length * 6 + mvps * 4,
					pids: top.map((p) => p.pid),
					tids: [],
					heads: [
						`The ${year} draft class was loaded`,
						`${stars.length} All-Stars came out of the ${year} draft`,
						`Class of ${year}: a draft for the ages`,
					],
					bodies: [
						`${plural(stars.length, "player")} from the ${year} draft became All-Stars, led by ${listText(top.map(pLink))}${mvps > 0 ? ` (${plural(mvps, "MVP award")} among them)` : ""}.`,
					],
					evidence: [
						["All-Stars", `${stars.length}`],
						["MVP awards", `${mvps}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Career milestone",
		find: (X) => {
			const out: Draft[] = [];
			const cats: [string, "pts" | "trb" | "ast", number[], string][] = [
				[
					"points",
					"pts",
					[10000, 15000, 20000, 25000, 30000, 35000],
					"scoring",
				],
				["rebounds", "trb", [5000, 7500, 10000, 12500, 15000], "rebounding"],
				["assists", "ast", [3000, 5000, 7500, 10000], "passing"],
			];
			for (const p of X.L.players) {
				const rows = regRows(p);
				for (const [label, key, marks, word] of cats) {
					let total = 0;
					let hit: { mark: number; season: number } | undefined;
					for (const r of rows) {
						total += r[key];
						for (const m of marks) {
							if (total >= m && (!hit || m > hit.mark)) {
								hit = { mark: m, season: r.season };
							}
						}
					}
					if (!hit) {
						continue;
					}
					const age = hit.season - p.bornYear;
					const idx = marks.indexOf(hit.mark);
					out.push({
						key: `${p.pid}|${key}`,
						kind: "Career milestone",
						shape: "career",
						season: hit.season,
						score: 14 + idx * 6 + hit.mark / (key === "pts" ? 1500 : 800),
						pids: [p.pid],
						tids: [],
						heads: [
							`${p.name} passed ${fmtNum(hit.mark)} career ${label}`,
							`${fmtNum(hit.mark)} ${label} for ${p.name}`,
							`A ${word} milestone: ${p.name}, ${hit.season}`,
						],
						bodies: [
							`${pLink(p)} went past ${fmtNum(hit.mark)} career ${label} in ${hit.season}, at age ${age}. He ${isActive(X, p) ? "has " : "finished with "}${fmtNum(total)}${isActive(X, p) ? " so far" : ""}.`,
						],
						evidence: [
							[label[0]!.toUpperCase() + label.slice(1), fmtNum(total)],
							["Milestone", fmtNum(hit.mark)],
							["Age", `${age}`],
						],
					});
				}
			}
			return out;
		},
	},
	{
		kind: "Hall of Famer",
		find: (X) => {
			const out: Draft[] = [];
			for (const p of X.L.players) {
				if (!p.hof || p.stats.length === 0) {
					continue;
				}
				const c = careerOf(X, p);
				const ss = seasonsOf(regRows(p));
				const titles = titleSeasons(X, p).length;
				const mvps = X.countAwards(p, AWARD_MVP);
				const as = p.awards.filter((a) => a.type === "All-Star").length;
				out.push({
					key: `${p.pid}`,
					kind: "Hall of Famer",
					shape: "career",
					season:
						p.retiredYear <= X.L.season
							? p.retiredYear
							: (ss.at(-1) ?? X.L.season),
					score: 20 + c.ws / 4 + mvps * 4 + titles * 3,
					pids: [p.pid],
					tids: [],
					heads: [
						`${p.name} is a Hall of Famer`,
						`Enshrined: ${p.name}`,
						`${p.name} takes his place in the Hall of Fame`,
					],
					bodies: [
						`${pLink(p)} is in the Hall of Fame after ${plural(ss.length, "season")} (${span(ss[0]!, ss.at(-1)!)}): ${fmtNum(c.pts)} points, ${fmtNum(c.ws, 1)} win shares, ${plural(as, "All-Star selection")}${mvps > 0 ? `, ${plural(mvps, "MVP")}` : ""}${titles > 0 ? `, ${plural(titles, "title")}` : ""}.`,
					],
					evidence: [
						["Seasons", `${ss.length}`],
						["WS", fmtNum(c.ws, 1)],
						["All-Stars", `${as}`],
					],
				});
			}
			return out;
		},
	},
	{
		kind: "Like father, like son",
		find: (X) => {
			const out: Draft[] = [];
			const seen = new Set<string>();
			for (const p of X.L.players) {
				for (const r of p.relatives) {
					if (r.type !== "son" && r.type !== "father") {
						continue;
					}
					const q = X.players.get(r.pid);
					if (!q) {
						continue;
					}
					const [dad, kid] = r.type === "son" ? [p, q] : [q, p];
					const key = `${dad.pid}|${kid.pid}`;
					if (seen.has(key)) {
						continue;
					}
					seen.add(key);
					const asD = dad.awards.filter((a) => a.type === "All-Star").length;
					const asK = kid.awards.filter((a) => a.type === "All-Star").length;
					const cD = careerOf(X, dad);
					const cK = careerOf(X, kid);
					if (
						asD + asK < 2 ||
						cD.ws + cK.ws < 30 ||
						kid.stats.length === 0 ||
						dad.stats.length === 0
					) {
						continue;
					}
					out.push({
						key,
						kind: "Like father, like son",
						shape: "career",
						season: seasonsOf(regRows(kid))[0] ?? X.L.season,
						score: 18 + asD * 2 + asK * 2 + (cD.ws + cK.ws) / 10,
						pids: [dad.pid, kid.pid],
						tids: [],
						heads: [
							`${dad.name} and his son ${kid.name} both made it`,
							`Like father, like son: ${kid.name}`,
							`A basketball family: ${dad.name} and ${kid.name}`,
						],
						bodies: [
							`${pLink(dad)} had ${fmtNum(cD.ws, 1)} career win shares and ${plural(asD, "All-Star selection")}. His son ${pLink(kid)} has ${fmtNum(cK.ws, 1)} and ${plural(asK, "selection")}.`,
						],
						evidence: [
							["Father WS", fmtNum(cD.ws, 1)],
							["Son WS", fmtNum(cK.ws, 1)],
						],
					});
				}
			}
			return out;
		},
	},
];
