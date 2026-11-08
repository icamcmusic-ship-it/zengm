// Storyline kinds about single games, from the box scores the league still has. Each links to the box score.

import type { LeagueIndex } from "../wrapped/league.ts";
import type { WBoxLine, WGame } from "../wrapped/types.ts";
import { fmtNum, plural } from "../wrapped/util.ts";
import { gLink, pLink, tLink, topN, type Draft, type Kind } from "./kit.ts";

const MAX_PER_KIND = 25;

// Candidates are scored first and only the best few are written up, so a league with thousands of stored games stays cheap
type Cand = { score: number; make: () => Draft };
const pick = (cands: Cand[]) =>
	topN(cands, MAX_PER_KIND, (c) => c.score).map((c) => c.make());

type Side = WGame["teams"][number];

const sides = (g: WGame) =>
	[
		[g.teams[0], g.teams[1]],
		[g.teams[1], g.teams[0]],
	] as const;

const result = (t: Side, o: Side) =>
	`${t.pts > o.pts ? "a win" : "a loss"}, ${t.pts}–${o.pts}`;

const where = (g: WGame) => (g.playoffs ? " in the playoffs" : "");

// A kind where one player's line in one game meets a bar. `measure` gives the headline number, `ok` the bar.
const playerGame = (
	kind: string,
	ok: (l: WBoxLine, g: WGame) => boolean,
	measure: (l: WBoxLine) => number,
	say: (l: WBoxLine) => string,
	heads: (l: WBoxLine, g: WGame) => string[],
	score: (l: WBoxLine, g: WGame) => number,
	extra: (l: WBoxLine) => [string, string][] = () => [],
): Kind => ({
	kind,
	find: (X) => {
		const out: Cand[] = [];
		for (const g of X.L.games) {
			for (const [t, o] of sides(g)) {
				for (const l of t.players) {
					if (!ok(l, g)) {
						continue;
					}
					out.push({
						score: score(l, g),
						make: () => ({
							key: `${g.gid}|${l.pid}`,
							kind,
							shape: "season",
							season: g.season,
							score: score(l, g),
							pids: [l.pid],
							tids: [t.tid, o.tid],
							gids: [g.gid],
							heads: heads(l, g),
							bodies: [
								`${pLink(l)} ${say(l)} for the ${tLink(X, t.tid, g.season)} against the ${tLink(X, o.tid, g.season)}${where(g)} in ${g.season}, ${result(t, o)}. ${gLink(g, "Box score")}`,
								`${g.season}${where(g)}: ${t.pts > o.pts ? "a win over" : "a loss to"} the ${tLink(X, o.tid, g.season)}, ${t.pts}–${o.pts}, and ${pLink(l)} ${say(l)}. ${gLink(g, "Box score")}`,
							],
							evidence: [
								[LABEL[kind] ?? "Stat", fmtNum(measure(l))],
								...(LABEL[kind] === "PTS"
									? []
									: [["PTS", `${l.pts}`] as [string, string]]),
								...extra(l),
							],
						}),
					});
				}
			}
		}
		return pick(out);
	},
});

const teamGame = (
	kind: string,
	ok: (a: Side, b: Side, g: WGame) => boolean,
	score: (a: Side, b: Side, g: WGame) => number,
	heads: (X: LeagueIndex, a: Side, b: Side, g: WGame) => string[],
	body: (X: LeagueIndex, a: Side, b: Side, g: WGame) => string[],
	ev: (a: Side, b: Side, g: WGame) => [string, string][],
): Kind => ({
	kind,
	find: (X) => {
		const out: Cand[] = [];
		for (const g of X.L.games) {
			// a is the side the story is about (the winner for lopsided games)
			const [a, b] =
				g.teams[0].pts >= g.teams[1].pts
					? [g.teams[0], g.teams[1]]
					: [g.teams[1], g.teams[0]];
			if (!ok(a, b, g)) {
				continue;
			}
			out.push({
				score: score(a, b, g),
				make: () => ({
					key: `${g.gid}`,
					kind,
					shape: "season",
					season: g.season,
					score: score(a, b, g),
					pids: [],
					tids: [a.tid, b.tid],
					gids: [g.gid],
					heads: heads(X, a, b, g),
					bodies: body(X, a, b, g),
					evidence: ev(a, b, g),
				}),
			});
		}
		return pick(out);
	},
});

const LABEL: Record<string, string> = {
	"Three-point barrage": "3PM",
	"Block party": "BLK",
	"Steals party": "STL",
	"Rebound monster": "REB",
	"Assist machine": "AST",
	"Playoff career night": "PTS",
	"Big triple-double": "PTS",
};

const rebs = (l: WBoxLine) => l.trb;

export const GAME_KINDS: Kind[] = [
	teamGame(
		"Blowout",
		(a, b) => a.pts - b.pts >= 40,
		(a, b) => 12 + (a.pts - b.pts - 40) * 1.5,
		(X, a, b, g) => [
			`${X.teamName(a.tid, g.season)} won by ${a.pts - b.pts}`,
			`A ${a.pts - b.pts}-point blowout`,
			`${a.pts}–${b.pts}: no contest`,
		],
		(X, a, b, g) => [
			`The ${tLink(X, a.tid, g.season)} beat the ${tLink(X, b.tid, g.season)} ${a.pts}–${b.pts}${where(g)} in ${g.season}, a margin of ${a.pts - b.pts}. ${gLink(g, "Box score")}`,
			`${a.pts}–${b.pts}${where(g)}: the ${tLink(X, a.tid, g.season)} routed the ${tLink(X, b.tid, g.season)} in ${g.season}. ${gLink(g, "Box score")}`,
		],
		(a, b) => [
			["Margin", `${a.pts - b.pts}`],
			["Score", `${a.pts}–${b.pts}`],
		],
	),
	teamGame(
		"Marathon",
		(_a, _b, g) => g.overtimes >= 3,
		(_a, _b, g) => 18 + g.overtimes * 8,
		(X, a, b, g) => [
			`${g.overtimes} overtimes between the ${X.teamAny(a.tid, g.season)?.name} and the ${X.teamAny(b.tid, g.season)?.name}`,
			`A game that would not end: ${g.overtimes} extra periods`,
			`${a.pts}–${b.pts} after ${g.overtimes} overtimes`,
		],
		(X, a, b, g) => [
			`The ${tLink(X, a.tid, g.season)} beat the ${tLink(X, b.tid, g.season)} ${a.pts}–${b.pts} in ${plural(g.overtimes, "overtime")}${where(g)} in ${g.season}. ${gLink(g, "Box score")}`,
		],
		(a, b, g) => [
			["Overtimes", `${g.overtimes}`],
			["Score", `${a.pts}–${b.pts}`],
		],
	),
	teamGame(
		"Shootout",
		(a, b) => a.pts + b.pts >= 300,
		(a, b) => 12 + (a.pts + b.pts - 300) * 0.8,
		(_X, a, b) => [
			`${a.pts + b.pts} points in one game`,
			`${a.pts}–${b.pts}: a shootout`,
			"Nobody played defense",
		],
		(X, a, b, g) => [
			`The ${tLink(X, a.tid, g.season)} and the ${tLink(X, b.tid, g.season)} combined for ${a.pts + b.pts} points${where(g)} in ${g.season}; the ${X.teamAny(a.tid, g.season)?.name} won ${a.pts}–${b.pts}. ${gLink(g, "Box score")}`,
		],
		(a, b) => [
			["Total", `${a.pts + b.pts}`],
			["Score", `${a.pts}–${b.pts}`],
		],
	),
	playerGame(
		"Three-point barrage",
		(l) => l.tp >= 10,
		(l) => l.tp,
		(l) => `made ${l.tp} threes`,
		(l) => [
			`${l.name} hit ${l.tp} threes`,
			`${l.tp} from deep for ${l.name}`,
			`${l.name} could not miss from three`,
		],
		(l) => 10 + (l.tp - 9) * 8,
	),
	playerGame(
		"Block party",
		(l) => l.blk >= 9,
		(l) => l.blk,
		(l) => `blocked ${l.blk} shots`,
		(l) => [
			`${l.name} rejected ${l.blk} shots`,
			`${l.blk} blocks for ${l.name}`,
			`Not in ${l.name}’s house: ${l.blk} blocks`,
		],
		(l) => 10 + (l.blk - 8) * 8,
	),
	playerGame(
		"Steals party",
		(l) => l.stl >= 8,
		(l) => l.stl,
		(l) => `stole the ball ${l.stl} times`,
		(l) => [
			`${l.name} had ${l.stl} steals`,
			`${l.stl} steals for ${l.name}`,
			`${l.name} picked pockets all night`,
		],
		(l) => 10 + (l.stl - 7) * 8,
	),
	playerGame(
		"Rebound monster",
		(l) => l.trb >= 25,
		rebs,
		(l) => `grabbed ${l.trb} rebounds`,
		(l) => [
			`${l.name} pulled down ${l.trb} rebounds`,
			`${l.trb} boards for ${l.name}`,
			`${l.name} owned the glass`,
		],
		(l) => 10 + (l.trb - 24) * 4,
	),
	playerGame(
		"Assist machine",
		(l) => l.ast >= 20,
		(l) => l.ast,
		(l) => `dished ${l.ast} assists`,
		(l) => [
			`${l.name} had ${l.ast} assists`,
			`${l.ast} dimes for ${l.name}`,
			`${l.name} ran the show`,
		],
		(l) => 10 + (l.ast - 19) * 5,
	),
	playerGame(
		"Playoff career night",
		(l, g) => g.playoffs && l.pts >= 45,
		(l) => l.pts,
		(l) => `scored ${l.pts} points`,
		(l) => [
			`${l.name} dropped ${l.pts} in the playoffs`,
			`A playoff career night: ${l.pts} for ${l.name}`,
			`${l.pts} points when it mattered: ${l.name}`,
		],
		(l) => 20 + (l.pts - 44) * 3,
	),
	playerGame(
		"Big triple-double",
		(l) => l.pts >= 25 && l.trb >= 12 && l.ast >= 12,
		(l) => l.pts,
		(l) => `had ${l.pts} points, ${l.trb} rebounds and ${l.ast} assists`,
		(l) => [
			`${l.name}: ${l.pts}-${l.trb}-${l.ast}`,
			`${l.name} filled the box score`,
			`A triple-double for the books: ${l.name}`,
		],
		(l) => 14 + l.pts / 3 + l.trb + l.ast,
		(l) => [
			["REB", `${l.trb}`],
			["AST", `${l.ast}`],
		],
	),
];
