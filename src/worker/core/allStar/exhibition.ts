// The weekend's exhibition games that aren't on the schedule (Rising Stars, the tournament's semifinals): simulated with the
// All-Star Game's sim (allStarSim.ts), on their own seeded stream, nothing written to the players' stats or injuries. Returns a
// short box score and the MVP.
import type {
	AllStarMiniBoxPlayer,
	AllStarMiniGame,
	AllStarPlayer,
} from "../../../common/types.ts";
import { helpers } from "../../../common/helpers.ts";
import { withRandom } from "../../../common/random.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import GameSimBasketball from "../GameSim.basketball/index.ts";
import { processTeam } from "../game/loadTeams.ts";
import team from "../team/index.ts";
import { weekendRandom } from "./weekend.ts";

const loadSide = async (tid: -1 | -2, entries: AllStarPlayer[]) => {
	const players = [];
	for (const { pid } of entries) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			players.push(p);
		}
	}
	const depth = await team.genDepth(players);
	return processTeam(
		{ tid, playThroughInjuries: [0, 0], depth },
		{ cid: -1, did: -1, won: 0, lost: 0, tied: 0, otl: 0 },
		players,
	);
};

// The best line of the game: game score plus half the points, with a bonus for the winners (as for the All-Star MVP)
export const miniGameMvp = (
	box: AllStarMiniGame["players"],
	score: [number, number],
	gameScores: Map<number, number>,
) => {
	let best: { p: AllStarMiniBoxPlayer; key: number[] } | undefined;
	for (const i of [0, 1] as const) {
		const won = score[i] > score[i === 0 ? 1 : 0] ? 1 : 0;
		for (const p of box[i]) {
			const key = [
				(gameScores.get(p.pid) ?? 0) + p.pts / 2 + 8 * won,
				won,
				p.pts,
				-p.pid,
			];
			let better = best === undefined;
			if (best) {
				for (let k = 0; k < key.length; k++) {
					if (key[k] !== best.key[k]) {
						better = key[k]! > best.key[k]!;
						break;
					}
				}
			}
			if (better) {
				best = { p, key };
			}
		}
	}
	return best
		? { pid: best.p.pid, tid: best.p.tid, name: best.p.name }
		: undefined;
};

export const simExhibition = async ({
	teams,
	teamNames,
	targetScore,
	seedKey,
}: {
	teams: [AllStarPlayer[], AllStarPlayer[]];
	teamNames: [string, string];
	targetScore?: number;
	seedKey: string;
}): Promise<AllStarMiniGame> => {
	const t0 = await loadSide(-1, teams[0]);
	const t1 = await loadSide(-2, teams[1]);
	const season = g.get("season");
	const result = withRandom(weekendRandom(season, seedKey), () =>
		new GameSimBasketball({
			gid: -1,
			day: undefined,
			teams: [t0 as any, t1 as any],
			doPlayByPlay: false,
			// (its events are never read)
			storePbp: false,
			homeCourtFactor: 1,
			allStarGame: true,
			baseInjuryRate: 0,
			neutralSite: true,
			targetScore,
		}).run(),
	);

	const tidByPid = new Map<number, number>();
	for (const entry of [...teams[0], ...teams[1]]) {
		tidByPid.set(entry.pid, entry.tid);
	}
	const gameScores = new Map<number, number>();
	const players = result.team.map((t) =>
		t.player
			.filter((p: any) => p.stat.min > 0)
			.map((p: any): AllStarMiniBoxPlayer => {
				const s = p.stat;
				gameScores.set(p.id, helpers.gameScore(s));
				return {
					pid: p.id,
					tid: tidByPid.get(p.id) ?? -1,
					name: p.name,
					min: Math.round(s.min * 10) / 10,
					pts: s.pts,
					trb: s.orb + s.drb,
					ast: s.ast,
					stl: s.stl,
					blk: s.blk,
					fg: s.fg,
					fga: s.fga,
					tp: s.tp,
					tpa: s.tpa,
					ft: s.ft,
					fta: s.fta,
					rim: s.fgAtRim ?? 0,
				};
			})
			.sort(
				(a: AllStarMiniBoxPlayer, b: AllStarMiniBoxPlayer) => b.min - a.min,
			),
	) as AllStarMiniGame["players"];
	const score: [number, number] = [
		result.team[0].stat.pts,
		result.team[1].stat.pts,
	];

	return {
		teamNames,
		score,
		...(targetScore !== undefined ? { target: targetScore } : {}),
		overtimes: result.overtimes,
		players,
		mvp: miniGameMvp(players, score, gameScores),
	};
};
