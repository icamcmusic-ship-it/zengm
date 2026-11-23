// Tournament format (allStarType "tournament", basketball): the All-Stars in four teams, two semifinals played to a target
// score (untimed) right before the All-Star Game, whose winners meet in the All-Star Game itself, also to a target score.
import type { AllStarPlayer, Conditions } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, logEvent } from "../../util/index.ts";
import { simExhibition } from "./exhibition.ts";

// Plays whatever semifinals aren't played yet and puts the winners in teams[0] and teams[1]. Returns false if a semifinal team
// can't field a lineup (then the All-Star Game is called off, like any other game without enough players)
export const playSemis = async (conditions: Conditions) => {
	const season = g.get("season");
	const allStars = await idb.cache.allStars.get(season);
	const tourney = allStars?.tournament;
	if (!allStars || !tourney) {
		return true;
	}
	const numPlayersOnCourt = g.get("numPlayersOnCourt");

	for (const [i, semi] of tourney.semis.entries()) {
		if (semi.winner !== undefined) {
			continue;
		}
		const teams = semi.teams.map((ind) =>
			tourney.teams[ind]!.filter((p) => !p.injured),
		) as [AllStarPlayer[], AllStarPlayer[]];
		if (teams.some((t) => t.length < numPlayersOnCourt)) {
			return false;
		}
		semi.game = await simExhibition({
			teams,
			teamNames: [
				tourney.teamNames[semi.teams[0]]!,
				tourney.teamNames[semi.teams[1]]!,
			],
			targetScore: tourney.targetSemis,
			seedKey: `semi${i}`,
		});
		const [a, b] = semi.game.score;
		semi.winner = a > b ? semi.teams[0] : semi.teams[1];
		logEvent(
			{
				type: "info",
				text: `All-Star tournament: ${semi.game.teamNames[0]} ${a}, ${semi.game.teamNames[1]} ${b}. ${tourney.teamNames[semi.winner]} advances to the All-Star Game.`,
				tids: [],
				showNotification: false,
				score: 0,
			},
			conditions,
		);
	}

	const w0 = tourney.semis[0]!.winner!;
	const w1 = tourney.semis[1]!.winner!;
	allStars.teams = [
		tourney.teams[w0]!.filter((p) => !p.injured),
		tourney.teams[w1]!.filter((p) => !p.injured),
	];
	allStars.teamNames = [tourney.teamNames[w0]!, tourney.teamNames[w1]!];
	await idb.cache.allStars.put(allStars);
	return true;
};
