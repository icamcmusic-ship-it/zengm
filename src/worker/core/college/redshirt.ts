// College mode: redshirts (docs/college-mode.md, Redshirts). A redshirted player practices with the team but does not play in games, and the
// season does not count against his four years of eligibility: p.redshirt is the season he sits out.
import type { Player } from "../../../common/types.ts";
import { PHASE } from "../../../common/constants.ts";
import { getCurrentContract } from "../../../common/contracts.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

export const isRedshirting = (p: Pick<Player, "tid"> & { redshirt?: number }) =>
	p.redshirt !== undefined && p.redshirt === g.get("season") && p.tid >= 0;

// Redshirting keeps the year: his eligibility (the scholarship "contract") runs one season longer
const setRedshirtRaw = (p: Player & { redshirt?: number }, on: boolean) => {
	const season = g.get("season");
	const contract = getCurrentContract(p);
	if (on && p.redshirt !== season) {
		p.redshirt = season;
		if (contract) {
			contract.amounts.push(contract.amounts.at(-1) ?? 0);
		}
	} else if (!on && p.redshirt === season) {
		delete p.redshirt;
		if (contract && contract.amounts.length > 1) {
			contract.amounts.pop();
		}
	}
};

const gamesThisSeason = (p: Player) => {
	let gp = 0;
	for (const row of p.stats) {
		if (row.season === g.get("season")) {
			gp += row.gp ?? 0;
		}
	}
	return gp;
};

/**
 * Can this player be redshirted (or have his redshirt removed) now? A freshman who has not played this season, before the national
 * tournament, and who has never been redshirted before.
 */
export const canRedshirt = (
	p: Player & { classYear?: number; redshirt?: number; redshirted?: number },
) => {
	const phase = g.get("phase");
	return (
		p.tid >= 0 &&
		(p.classYear ?? 0) === 1 &&
		phase >= PHASE.PRESEASON &&
		phase <= PHASE.AFTER_TRADE_DEADLINE &&
		gamesThisSeason(p) === 0 &&
		(p.redshirted === undefined || p.redshirted === g.get("season"))
	);
};

export const setRedshirt = async (p: Player, on: boolean) => {
	if (!canRedshirt(p)) {
		return false;
	}
	setRedshirtRaw(p, on);
	if (on) {
		(p as any).redshirted = g.get("season");
	} else {
		delete (p as any).redshirted;
	}
	await idb.cache.players.put(p);
	return true;
};

/**
 * AI schools redshirt their deep-bench freshmen (12th man and below by value, at most two) at the start of the regular season.
 *
 * Phased in over a new league's first REDSHIRT_PHASE_IN seasons: a league starts with four class years and no fifth-year seniors, so
 * the first redshirted class leaves a year late all at once, and the year it should have left the seniors (and so the open spots,
 * and the next recruiting class) dropped by a quarter in a full league, an echo that came back every four years. Phased in, the
 * shift is spread over four classes.
 */
export const REDSHIRT_PHASE_IN = 4;
export const aiRedshirtChance = (season: number, startingSeason: number) =>
	0.7 * Math.min(1, (season - startingSeason + 1) / REDSHIRT_PHASE_IN);

export const aiRedshirts = async () => {
	const chance = aiRedshirtChance(g.get("season"), g.get("startingSeason"));
	const userTids = g.get("userTids");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	for (const t of teams) {
		if (userTids.includes(t.tid) && !g.get("spectator")) {
			continue;
		}
		const roster = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
			.filter((p) => !isRedshirting(p))
			.sort((a, b) => b.value - a.value);
		if (roster.length < 11) {
			continue;
		}
		let n = 0;
		for (const p of roster.slice(10)) {
			if (n < 2 && canRedshirt(p) && Math.random() < chance) {
				await setRedshirt(p, true);
				n += 1;
			}
		}
	}
};
