// All-Star weekend in the paper (basketball): the facts, taken from the season's stored AllStars object (pure, so the worker
// and the tests share it), and the weekend recap story: the game and its MVP, the contest winners, the best dunk, Rising
// Stars, the skills challenge and the fans' vote. No ratings anywhere.
import { dunkInfos } from "../dunkContest.ts";
import type { AllStarMiniGame, AllStars } from "../types.ts";
import { type Ctx, P } from "./ctx.ts";
import { plural } from "./text.ts";
import type { Article, NPAllStar, NPAllStarLine, Seg } from "./types.ts";

const DUNK_SCORE_PERFECT = 50;

// A dunk in words: "a between-the-legs 360° from 12 feet, the ball tossed off the side of the backboard"
export const dunkDescription = (dunk: {
	toss: string;
	distance: string;
	move1: string;
	move2: string;
}) => {
	const moves = [dunk.move1, dunk.move2]
		.filter((m) => m !== "none")
		.map((m) => dunkInfos.move[m]?.name ?? m);
	const distance =
		dunk.distance !== "at-rim"
			? dunkInfos.distance[dunk.distance]?.name.replace(/ \(.*\)/, "")
			: undefined;
	const toss =
		dunk.toss !== "none" ? dunkInfos.toss[dunk.toss]?.name : undefined;
	let s = moves.length > 0 ? `a ${moves.join(", ")} dunk` : "a dunk";
	if (distance) {
		s += ` from ${distance}`;
	}
	if (toss) {
		s += `, the toss ${toss}`;
	}
	return s;
};

const miniLine = (
	game: AllStarMiniGame,
	pid: number,
): NPAllStarLine | undefined => {
	for (const side of game.players) {
		const p = side.find((x) => x.pid === pid);
		if (p) {
			return {
				pid: p.pid,
				tid: p.tid,
				name: p.name,
				pts: p.pts,
				trb: p.trb,
				ast: p.ast,
				tp: p.tp,
			};
		}
	}
};

// The weekend's facts. mvpLine: the All-Star Game MVP's box score line, from the stored game. Undefined until something
// (a contest or a game) has happened
export const allStarFacts = (
	allStars: AllStars,
	mvpLine?: Omit<NPAllStarLine, "pid" | "tid" | "name">,
): NPAllStar | undefined => {
	const out: NPAllStar = {
		format: allStars.type ?? "draft",
		teamNames: allStars.teamNames,
	};
	let any = false;

	if (allStars.score) {
		any = true;
		out.score = allStars.score;
		out.gid = allStars.gid;
		out.overtimes = allStars.overtimes;
		if (allStars.mvp) {
			out.mvp = {
				...allStars.mvp,
				pts: mvpLine?.pts ?? 0,
				trb: mvpLine?.trb ?? 0,
				ast: mvpLine?.ast ?? 0,
				tp: mvpLine?.tp ?? 0,
			};
		}
	}

	if (allStars.votes && allStars.votes.length > 0) {
		const leader = allStars.votes.reduce((a, b) =>
			b.fanVotes > a.fanVotes ? b : a,
		);
		out.fanLeader = {
			pid: leader.pid,
			tid: leader.tid,
			name: leader.name,
			fanVotes: leader.fanVotes,
		};
		out.numReplacements = allStars.votes.filter(
			(v) => v.selected === "replacement",
		).length;
	}

	const dunk = allStars.dunk;
	if (dunk?.winner !== undefined) {
		any = true;
		let best: NonNullable<NPAllStar["dunk"]>["best"];
		for (const round of dunk.rounds) {
			for (const d of round.dunks) {
				const last = d.attempts.at(-1);
				if (
					d.made &&
					d.score !== undefined &&
					last &&
					(!best || d.score > best.score)
				) {
					best = {
						...dunk.players[d.index]!,
						score: d.score,
						desc: dunkDescription(last),
					};
				}
			}
		}
		out.dunk = { winner: dunk.players[dunk.winner], best };
	}

	const three = allStars.three;
	if (three?.winner !== undefined) {
		any = true;
		// His score in the last round
		let score: number | undefined;
		const lastRound = three.rounds.at(-1);
		const result = lastRound?.results.find((r) => r.index === three.winner);
		if (result) {
			score = 0;
			for (const rack of result.racks) {
				for (const [i, made] of rack.entries()) {
					if (made) {
						score += i === 4 ? 2 : 1;
					}
				}
			}
		}
		out.three = { winner: three.players[three.winner], score };
	}

	const skills = allStars.skills;
	if (skills?.winner !== undefined) {
		any = true;
		const final = skills.rounds.at(-1)!;
		const run = final.runs.find((r) => r.index === skills.winner);
		const other = final.runs.find((r) => r.index !== skills.winner);
		out.skills = {
			winner: skills.players[skills.winner],
			time: run?.time,
			runnerUp: other ? skills.players[other.index] : undefined,
		};
	}

	const rsGame = allStars.risingStars?.game;
	if (rsGame) {
		any = true;
		out.risingStars = {
			teamNames: rsGame.teamNames,
			score: rsGame.score,
			mvp: rsGame.mvp ? miniLine(rsGame, rsGame.mvp.pid) : undefined,
		};
	}

	const semis = allStars.tournament?.semis
		.map((semi) => semi.game)
		.filter((game) => game !== undefined);
	if (semis && semis.length > 0) {
		any = true;
		out.semis = semis.map((game) => ({
			teamNames: game.teamNames,
			score: game.score,
		}));
	}

	return any ? out : undefined;
};

const pl = (p: { pid: number; name: string }): Seg => ({
	pid: p.pid,
	t: p.name,
});

const winnerLoser = (names: [string, string], score: [number, number]) => {
	const w = score[0] >= score[1] ? 0 : 1;
	const l = w === 0 ? 1 : 0;
	return { w: names[w], l: names[l], ws: score[w], ls: score[l] };
};

const item = (...xs: (Seg | Seg[])[]): Seg[] => xs.flat();

const statLine = (p: NPAllStarLine) =>
	`${plural(p.pts, "point")}, ${plural(p.trb, "rebound")} and ${plural(p.ast, "assist")}${p.tp >= 4 ? `, with ${p.tp} threes` : ""}`;

// The weekend recap: runs in every edition after the weekend
export const allStarWeekendStory = (c: Ctx): Article | undefined => {
	const a = c.f.allStar;
	if (!a || c.pre) {
		return undefined;
	}
	const r = c.rng("allStarWeekend");
	const body: Article["body"] = [];
	let head: string | undefined;

	if (a.score) {
		const { w, l, ws, ls } = winnerLoser(a.teamNames, a.score);
		const ot =
			a.overtimes && a.overtimes > 0
				? ` in ${a.overtimes > 1 ? `${a.overtimes} overtimes` : "overtime"}`
				: "";
		body.push(
			P(
				`${w} beat ${l}, ${ws}-${ls}${ot}, in the All-Star Game`,
				a.format === "tournament"
					? ", the final of the All-Star tournament"
					: "",
				a.mvp
					? [`. `, pl(a.mvp), ` was named MVP with ${statLine(a.mvp)}.`]
					: ".",
				ws + ls >= 340 ? " Defense was optional, as tradition demands." : "",
			),
		);
		head = a.mvp
			? r.pick([
					`${a.mvp.name} steals the show at the All-Star Game`,
					`${a.mvp.name} takes All-Star MVP honors`,
					`All-Star Game: ${w} ${ws}, ${l} ${ls}`,
				])
			: `All-Star Game: ${w} ${ws}, ${l} ${ls}`;
	}

	if (a.semis && a.semis.length > 0) {
		body.push(
			P(
				"In the tournament semifinals, ",
				a.semis
					.map((s) => {
						const { w, l, ws, ls } = winnerLoser(s.teamNames, s.score);
						return `${w} beat ${l} ${ws}-${ls}`;
					})
					.join(" and "),
				".",
			),
		);
	}

	const contestItems: Seg[][] = [];
	if (a.dunk?.winner) {
		contestItems.push(
			item(
				"Slam Dunk Contest: ",
				pl(a.dunk.winner),
				a.dunk.best
					? a.dunk.best.pid === a.dunk.winner.pid
						? `, whose best was ${a.dunk.best.desc}${a.dunk.best.score >= DUNK_SCORE_PERFECT ? " for a perfect 50" : ` (${a.dunk.best.score})`}`
						: [
								". Dunk of the night: ",
								pl(a.dunk.best),
								` with ${a.dunk.best.desc} (${a.dunk.best.score})`,
							]
					: "",
			),
		);
		head ??= `${a.dunk.winner.name} wins the dunk contest`;
	}
	if (a.three?.winner) {
		contestItems.push(
			item(
				"Three-Point Contest: ",
				pl(a.three.winner),
				a.three.score !== undefined
					? `, with ${a.three.score} points in the final round`
					: "",
			),
		);
		head ??= `${a.three.winner.name} wins the three-point contest`;
	}
	if (a.skills?.winner) {
		contestItems.push(
			item(
				"Skills Challenge: ",
				pl(a.skills.winner),
				a.skills.time !== undefined
					? `, through the course in ${a.skills.time.toFixed(1)} seconds`
					: "",
				a.skills.runnerUp ? [", ahead of ", pl(a.skills.runnerUp)] : "",
			),
		);
		head ??= `${a.skills.winner.name} wins the skills challenge`;
	}
	if (a.risingStars) {
		const { w, l, ws, ls } = winnerLoser(
			a.risingStars.teamNames,
			a.risingStars.score,
		);
		contestItems.push(
			item(
				`Rising Stars: ${w} ${ws}, ${l} ${ls}`,
				a.risingStars.mvp
					? [
							". MVP ",
							pl(a.risingStars.mvp),
							` (${statLine(a.risingStars.mvp)})`,
						]
					: "",
			),
		);
		head ??= `Rising Stars: ${w} beat ${l}`;
	}
	if (contestItems.length > 0) {
		body.push(
			{ type: "sub", text: "Around the weekend" },
			{ type: "list", items: contestItems },
		);
	}

	if (a.fanLeader) {
		body.push(
			P(
				pl(a.fanLeader),
				` led the fan vote with ${a.fanLeader.fanVotes.toLocaleString("en-US")} ballots`,
				a.numReplacements
					? `, and the commissioner named ${plural(a.numReplacements, "injury replacement")}`
					: "",
				".",
			),
		);
	}

	if (!head) {
		return undefined;
	}

	return {
		id: "all-star-weekend",
		type: "allStarWeekend",
		size: "feature",
		kicker: "All-Star weekend",
		head,
		byline: c.byline("league"),
		photoPid: a.mvp?.pid ?? a.dunk?.winner?.pid,
		body,
	};
};
