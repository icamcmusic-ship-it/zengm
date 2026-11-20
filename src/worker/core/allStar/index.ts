import create from "./create.ts";
import draftAll from "./draftAll.ts";
import draftOne from "./draftOne.ts";
import draftUser from "./draftUser.ts";
import * as dunkContest from "./dunkContest.ts";
import futureGameIsAllStar from "./futureGameIsAllStar.ts";
import getOrCreate from "./getOrCreate.ts";
import nextGameIsAllStar from "./nextGameIsAllStar.ts";
import prepareGame, {
	replaceUnavailable,
	simContests,
	skipGame,
} from "./prepareGame.ts";
import * as threeContest from "./threeContest.ts";

export default {
	create,
	draftAll,
	draftOne,
	draftUser,
	dunkContest,
	futureGameIsAllStar,
	getOrCreate,
	nextGameIsAllStar,
	prepareGame,
	replaceUnavailable,
	simContests,
	skipGame,
	threeContest,
};
