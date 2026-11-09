import aiOffers from "./aiOffers.ts";
import betweenAiTeams from "./betweenAiTeams.ts";

// The daily AI trade activity (AI-to-AI trades, AI offers to the user). It is only background activity, so an error in it
// is logged rather than thrown: otherwise one bad trade attempt would stop the sim in the middle of a day, which looks
// like the game is stuck.
const runAiTradesSafely = async () => {
	try {
		await betweenAiTeams();
	} catch (error) {
		console.error("Error in AI-to-AI trades", error);
	}
	try {
		await aiOffers();
	} catch (error) {
		console.error("Error in AI trade offers", error);
	}
};

export default runAiTradesSafely;
