import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import makeItWork from "./makeItWork.ts";
import summary from "./summary.ts";
import get from "./get.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import explain from "./explain.ts";
import tryProtections from "./tryProtections.ts";

/**
 * Make a trade work
 *
 * This should be called for a trade negotiation, as it will update the trade objectStore.
 *
 * @memberOf core.trade
 * @return {Promise.string} Resolves to a string containing a message to be dispalyed to the user, as if it came from the AI GM.
 */
const makeItWorkTrade = async () => {
	const tr = await get();
	const teams0 = tr.teams;
	const valueChangeCalculator = new ValueChangeCalculator();
	// Explain why the AI didn't like the original offer, if it didn't
	let explanation;
	try {
		const explanation0 = await explain(teams0);
		if (!explanation0.accepts) {
			explanation = explanation0;
		}
	} catch (error) {
		console.error(error);
	}

	// First see if the AI would do it with protections on its own picks
	if (explanation) {
		const protectedTeams = await tryProtections(
			helpers.deepCopy(teams0),
			valueChangeCalculator,
		);
		if (protectedTeams) {
			const s = await summary(protectedTeams);
			if (!s.warning) {
				const tr2 = await get();
				tr2.teams = protectedTeams;
				await idb.cache.trade.put(tr2);
				const top = protectedTeams[1].pickConditions?.at(-1);
				return {
					changed: true,
					explanation,
					message: `${
						g.get("teamInfoCache")[teams0[1].tid]?.region
					} GM: "I can do that if our ${helpers.plural("pick", teams0[1].dpids.length)} ${teams0[1].dpids.length === 1 ? "is" : "are"} protected${top?.type === "protection" ? ` (top ${top.top}, rolling over a year, then unprotected)` : ""}."`,
				};
			}
		}
	}

	const teams = await makeItWork(helpers.deepCopy(teams0), {
		holdUserConstant: false,
		valueChangeCalculator,
	});

	if (!teams) {
		return {
			changed: false,
			explanation,
			message: `${
				g.get("teamInfoCache")[teams0[1].tid]?.region
			} GM: "I can't afford to give up so much."`,
		};
	}

	const s = await summary(teams); // Store AI's proposed trade in database, if it's different

	let updated = false;

	for (const i of [0, 1] as const) {
		if (teams[i].tid !== teams0[i].tid) {
			updated = true;
			break;
		}

		if (teams[i].pids.toString() !== teams0[i].pids.toString()) {
			updated = true;
			break;
		}

		if (teams[i].dpids.toString() !== teams0[i].dpids.toString()) {
			updated = true;
			break;
		}
	}

	if (updated) {
		const tr2 = await get();
		tr2.teams = teams;
		await idb.cache.trade.put(tr2);
	}

	if (s.warning) {
		return {
			changed: updated,
			explanation,
			message: `${
				g.get("teamInfoCache")[teams[1].tid]?.region
			} GM: "Something like this would work if you can figure out how to get it done without breaking the salary cap rules."`,
		};
	}

	return {
		changed: updated,
		explanation,
		message: `${
			g.get("teamInfoCache")[teams[1].tid]?.region
		} GM: "How does this sound?"`,
	};
};

export default makeItWorkTrade;
