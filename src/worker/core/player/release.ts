import addToFreeAgents from "./addToFreeAgents.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import type { Player } from "../../../common/types.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	applyStretchProvision,
	getStretchedAmounts,
	stretchHardCapSeason,
	stretchProvisionEnabled,
} from "../contract/capExceptions.ts";
import getPayroll from "../team/getPayroll.ts";
import {
	endContractEarly,
	setContractDemandFromCurrentContract,
} from "../contract/index.ts";
import { applyReleaseGuarantees } from "../contract/options.ts";
import { getNumPlayersTradedAwayNormalizedAll } from "./getNumPlayersTradedAwayNormalized.ts";

/**
 * Release player.
 *
 * This keeps track of what the player's current team owes him, and then calls addToFreeAgents.
 *
 * @memberOf core.player
 * @param {Object} p Player object.
 * @param {boolean} justDrafted True if the player was just drafted by his current team and the regular season hasn't started yet. False otherwise. If True, then the player can be released without paying his salary.
 * @return {Promise}
 */
// Stretch provision with a hard cap: the first season stretching this player's contract would put his team over the hard cap, or
// undefined if it wouldn't (or there's no hard cap)
export const getStretchHardCapSeason = async (p: Player) => {
	if (g.get("salaryCapType") !== "hard" || p.tid < 0) {
		return;
	}
	const contract = getCurrentContract(p);
	if (!contract) {
		return;
	}
	const after = helpers.deepCopy(contract);
	applyReleaseGuarantees(after);
	const stretched = getStretchedAmounts(after);
	if (!stretched) {
		return;
	}
	const payrolls = new Map<number, number>();
	for (let season = stretched.firstSeason; season <= stretched.exp; season++) {
		payrolls.set(season, await getPayroll(p.tid, season));
	}
	return stretchHardCapSeason({
		before: contract,
		after,
		payrollBySeason: (season) => payrolls.get(season) ?? 0,
		salaryCap: g.get("salaryCap"),
	});
};

const release = async (
	p: Player,
	justDrafted: boolean,
	// Stretch provision (setting): spread what's owed after the current season over twice the remaining seasons plus one
	stretch: boolean = false,
) => {
	let stretched = false;
	// Hard cap: no stretching that would put the team over it
	if (
		stretch &&
		stretchProvisionEnabled() &&
		!justDrafted &&
		(await getStretchHardCapSeason(p)) !== undefined
	) {
		stretch = false;
	}
	// Before his contract ends, since that's what his contract demand is based on
	setContractDemandFromCurrentContract(p);

	const contract = getCurrentContract(p);
	if (contract) {
		if (justDrafted) {
			// Just drafted players can be released without paying anything
			p.contracts = p.contracts.filter((row) => row !== contract);
		} else {
			// The team still owes the rest of the contract, unless it has already been fully paid
			endContractEarly(p, {
				season: g.get("season"),
				phase: g.get("phase"),
				reason: "released",
				tid: p.tid,
			});

			// Partially guaranteed seasons and team options are not owed in full
			if (contract.endedEarly) {
				applyReleaseGuarantees(contract);
				if (stretch && stretchProvisionEnabled()) {
					stretched = applyStretchProvision(contract);
				}
			}
		}
	}

	logEvent({
		type: "release",
		text: `The <a href="${helpers.leagueUrl([
			"roster",
			`${g.get("teamInfoCache")[p.tid]?.abbrev}_${p.tid}`,
			g.get("season"),
		])}">${
			g.get("teamInfoCache")[p.tid]?.name
		}</a> released <a href="${helpers.leagueUrl(["player", p.pid])}">${
			p.firstName
		} ${p.lastName}</a>${
			stretched
				? `, using the stretch provision to spread what they owe him through ${getContractExp(contract!)}`
				: ""
		}.`,
		showNotification: false,
		pids: [p.pid],
		tids: [p.tid],
	});
	addToFreeAgents(p, await getNumPlayersTradedAwayNormalizedAll());
	await idb.cache.players.put(p);
};

export default release;
