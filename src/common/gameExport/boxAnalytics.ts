// Per-game download: basketball analytics from the box score alone (works for every stored game, with or without play-by-play): Four
// Factors, possessions, offensive and defensive ratings, pace, each player's true shooting and usage, and the bench's points. Pure.
import { possEstimate } from "./pbpAnalysis.ts";

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ratio = (a: number, b: number) => (b > 0 ? r3(a / b) : null);

export type BoxTeam = Record<string, any> & {
	tid: number;
	players: Record<string, any>[];
};

const line = (t: Record<string, any>) => ({
	pts: n(t.pts),
	fga: n(t.fga),
	fg: n(t.fg),
	tpa: n(t.tpa),
	tp: n(t.tp),
	fta: n(t.fta),
	ft: n(t.ft),
	orb: n(t.orb),
	drb: n(t.drb),
	tov: n(t.tov),
	min: n(t.min),
});

export const boxAnalytics = (
	teams: readonly [BoxTeam, BoxTeam],
	numPlayersOnCourt = 5,
) => {
	const lines = teams.map(line) as [
		ReturnType<typeof line>,
		ReturnType<typeof line>,
	];
	const poss = possEstimate(lines[0], lines[1]);
	// Team minutes / players on the court: the game's length in minutes
	const gameMin =
		lines[0].min > 0 ? lines[0].min / numPlayersOnCourt : undefined;
	return {
		possessions: r1(poss),
		pace:
			gameMin !== undefined && gameMin > 0 ? r1((poss * 48) / gameMin) : null,
		teams: teams.map((t, i) => {
			const us = lines[i]!;
			const them = lines[1 - i]!;
			const bench = t.players
				.filter((p) => !n(p.gs))
				.reduce((sum, p) => sum + n(p.pts), 0);
			return {
				tid: t.tid,
				fourFactors: {
					efg: ratio(us.fg + 0.5 * us.tp, us.fga),
					tovPct: ratio(us.tov, us.fga + 0.44 * us.fta + us.tov),
					orbPct: ratio(us.orb, us.orb + them.drb),
					ftRate: ratio(us.ft, us.fga),
				},
				ortg: poss > 0 ? r1((100 * us.pts) / poss) : null,
				drtg: poss > 0 ? r1((100 * them.pts) / poss) : null,
				benchPts: bench,
				players: t.players
					.filter((p) => n(p.min) > 0)
					.map((p) => {
						const tsa = n(p.fga) + 0.44 * n(p.fta);
						const own = n(p.fga) + 0.44 * n(p.fta) + n(p.tov);
						const team = us.fga + 0.44 * us.fta + us.tov;
						return {
							pid: p.pid as number,
							tsPct: tsa > 0 ? r3(n(p.pts) / (2 * tsa)) : null,
							usgPct:
								n(p.min) > 0 && team > 0
									? r1(
											(100 * own * (us.min / numPlayersOnCourt)) /
												(n(p.min) * team),
										)
									: null,
						};
					}),
			};
		}),
	};
};
