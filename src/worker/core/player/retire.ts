import { PLAYER } from "../../../common/constants.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import madeHof from "./madeHof.ts";
import type { Conditions, Player } from "../../../common/types.ts";
import { player } from "../index.ts";
import addAward from "./addAward.ts";
import { endContractEarly } from "../contract/index.ts";
import { advOnRetire } from "./advStatsStorage.ts";
import { storeHofStoryAtInduction } from "../../util/hofStory.ts";
import { hofBallotOn } from "../hallOfFame/index.ts";
import { endRunningStreaks } from "./featLedger.ts";

/**
 * Have a player retire, including all event and HOF bookkeeping.
 *
 * This just updates a player object. You need to write it to the database after.
 *
 * @memberOf core.player
 * @param {IDBTransaction} ot An IndexedDB transaction on events.
 * @param {Object} p Player object.
 * @return {Object} p Updated (retired) player object.
 */
const retire = async (
	p: Player,
	conditions?: Conditions,
	{
		logRetiredEvent = true,
		forceHofNotification = false,
		died = false,
	}: {
		logRetiredEvent?: boolean;
		forceHofNotification?: boolean;
		died?: boolean;
	} = {},
) => {
	if (conditions && logRetiredEvent) {
		logEvent(
			{
				type: "retired",
				text: `<a href="${helpers.leagueUrl(["player", p.pid])}">${
					p.firstName
				} ${p.lastName}</a> retired.`,
				showNotification: false,
				pids: [p.pid],
				tids: [p.tid],
				score: p.tid >= 0 ? 10 : 0,
			},
			conditions,
		);
	}

	// Add to Hall of Fame? With the Hall of Fame Ballot (League Extras) he is voted in later instead (core/hallOfFame)
	let inducted = false;
	if (conditions && !p.hof && !hofBallotOn() && madeHof(p)) {
		p.hof = 1;
		inducted = true;
		addAward(p, {
			season: g.get("season"),
			type: "Inducted into the Hall of Fame",
		});

		logEvent(
			{
				type: "hallOfFame",
				text: `<a href="${helpers.leagueUrl(["player", p.pid])}">${
					p.firstName
				} ${p.lastName}</a> was inducted into the <a href="${helpers.leagueUrl([
					"hall_of_fame",
				])}">Hall of Fame</a>.`,
				showNotification:
					p.statsTids.includes(g.get("userTid")) || forceHofNotification,
				pids: [p.pid],
				tids: p.statsTids,
				score: 20,
			},
			conditions,
		);
	}

	// Any remaining seasons on his contract won't be paid. Contracts owed by teams that released him are still owed.
	endContractEarly(p, {
		season: g.get("season"),
		phase: g.get("phase"),
		reason: died ? "died" : "retired",
	});
	delete p.contractDemand;

	p.tid = PLAYER.RETIRED;
	p.retiredYear = g.get("season");
	// Advanced Tracking Stats: his tracking folded into a career total ("Keep Career Tracking for Retired Players"), or only his last
	// few seasons keep their records (setting off)
	await advOnRetire(p);
	p.injury = {
		type: "Healthy",
		gamesRemaining: 0,
	};
	p.numDaysFreeAgent = 0;
	p.gamesUntilTradable = 0;
	// Feat Rarity & Streaks: his running streaks end
	endRunningStreaks(p.pid);
	delete p.numPlayersTradedAwayNormalized;

	await player.checkJerseyNumberRetirement(p);

	// His plaque text and induction speech, written once now (with his career complete) and stored on him
	if (inducted) {
		// Inducted because he died (killOne sets diedYear right after this, to the same season): the words say it was posthumous
		if (died && p.diedYear === undefined) {
			p.diedYear = g.get("season");
		}
		await storeHofStoryAtInduction(p);
	}
};

export default retire;
