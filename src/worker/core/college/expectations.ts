// College mode: what a program's prestige expects (docs/college-mode.md, AI behaviour): its rank by prestige in the league, and the winning
// percentage that goes with it. Used for the user's job security and the Coach of the Year.
import { idb } from "../../db/index.ts";
import { getTeamPrestige } from "./players.ts";

export const getExpectations = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const sorted = teams
		.map((t) => ({ tid: t.tid, prestige: getTeamPrestige(t as any) }))
		.sort((a, b) => a.prestige - b.prestige);
	const out = new Map<number, { pct: number; expectedWinp: number }>();
	for (const [i, t] of sorted.entries()) {
		const pct = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
		out.set(t.tid, { pct, expectedWinp: 0.3 + 0.45 * pct });
	}
	return out;
};

export const getExpectedWinps = async () =>
	new Map(
		[...(await getExpectations())].map(([tid, row]) => [tid, row.expectedWinp]),
	);
