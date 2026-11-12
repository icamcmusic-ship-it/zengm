import { PLAYER } from "../../../common/constants.ts";
import { player, team } from "../index.ts";
import getBest from "./getBest.ts";
import {
	makeAiTraitValueFactorCache,
	traitsEnabled,
} from "../player/traits.ts";
import { getContractDemand } from "../contract/index.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { orderBy } from "../../../common/utils.ts";
import { shuffle } from "../../../common/random.ts";
import { getAllGmWeights } from "../gm/index.ts";
import {
	capExceptionsEnabled,
	makeAiCapExceptionPicker,
	recordCapExceptionSigning,
} from "../contract/capExceptions.ts";

/**
 * AI teams sign free agents.
 *
 * Each team (in random order) will sign free agents up to their salary cap or roster size limit. This should eventually be made smarter
 *
 * @memberOf core.freeAgents
 * @return {Promise}
 */
const autoSign = async () => {
	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);

	if (players.length === 0) {
		return;
	}

	// List of free agents, sorted by value
	let playersSorted = orderBy(players, "value", "desc");

	// Player traits: the same free agents are valued by every team, so remember their trait factors
	const getTraitFactor = makeAiTraitValueFactorCache();

	// Randomly order teams
	const teams = await idb.cache.teams.getAll();
	shuffle(teams);

	// AI GM personalities (setting): more or less active, star hunters or depth builders. Empty with the setting off
	const gms = await getAllGmWeights();

	for (const t of teams) {
		// Skip the user's team
		if (
			g.get("userTids").includes(t.tid) &&
			!local.autoPlayUntil &&
			!g.get("spectator")
		) {
			continue;
		}

		if (t.disabled) {
			continue;
		}

		let probSkip;
		if (__SPORT === "basketball") {
			probSkip = t.strategy === "rebuilding" ? 0.9 : 0.75;
		} else {
			probSkip = 0.5;
		}

		const gm = gms.get(t.tid);
		if (gm) {
			probSkip = 1 - (1 - probSkip) * gm.faActivity;
		}

		// Skip teams sometimes
		if (Math.random() < probSkip) {
			continue;
		}

		const playersOnRoster = await idb.cache.players.indexGetAll(
			"playersByTid",
			t.tid,
		);

		// With forceHistoricalRosters, only sign FAs if we have to
		if (
			playersOnRoster.length >= g.get("minRosterSize") &&
			g.get("forceHistoricalRosters")
		) {
			continue;
		}

		// Ignore roster size, will drop bad player if necessary in checkRosterSizes, and getBest won't sign min contract player unless under the roster limit
		const payroll = await team.getPayroll(t.tid);
		// Player traits (setting): this team's small trait adjustment to value, e.g. contenders and young rosters like savvy veterans, everyone avoids injury prone players
		let playersForTeam = playersSorted;
		let traitValues: Map<(typeof players)[number], number> | undefined;
		if (traitsEnabled()) {
			// Who is on the team: young players to mentor, and the locker room (AI teams are warier of adding another big ego or hot head)
			const traitTeam = getTraitFactor.teamContext(playersOnRoster);
			// Computed once per player, not in every comparison of the sort
			const values = new Map<(typeof players)[number], number>();
			for (const p of playersSorted) {
				values.set(
					p,
					p.value *
						(p.value > 0
							? getTraitFactor(p, { strategy: t.strategy, team: traitTeam })
							: 1),
				);
			}
			playersForTeam = orderBy(playersSorted, (p) => values.get(p)!, "desc");
			traitValues = values;
		}
		if (gm && gm.faStarShift !== 0) {
			// Star hunters lean to the expensive free agents (the stars), depth builders to cheaper ones, by up to a few value points
			const minContract = g.get("minContract");
			const range = Math.max(1, g.get("maxContract") - minContract);
			const keys = new Map<(typeof players)[number], number>();
			for (const p of playersForTeam) {
				const amount = getContractDemand(p).amount;
				const starness = Math.min(
					1,
					Math.max(-1, (2 * (amount - minContract)) / range - 1),
				);
				keys.set(
					p,
					(traitValues?.get(p) ?? p.value) + gm.faStarShift * starness,
				);
			}
			playersForTeam = orderBy(playersForTeam, (p) => keys.get(p)!, "desc");
		}
		// Salary cap exceptions (setting): an over the cap team can use its mid-level, bi-annual or room exception. Undefined with the setting off.
		const pickCapException = makeAiCapExceptionPicker({
			t,
			roster: playersOnRoster,
			payroll,
			gm,
		});
		const p = getBest(
			playersOnRoster,
			playersForTeam,
			payroll,
			pickCapException,
		);
		if (p) {
			// Remove from list of free agents
			playersSorted = playersSorted.filter((p2) => p2 !== p);

			const contractDemand = getContractDemand(p);
			if (
				capExceptionsEnabled() &&
				contractDemand.amount > g.get("minContract")
			) {
				// Under the cap it uses cap space, otherwise an exception (with the contract shortened to what the exception allows)
				const picked =
					contractDemand.amount + payroll <= g.get("salaryCap")
						? undefined
						: pickCapException?.(p, contractDemand);
				await player.sign(
					p,
					t.tid,
					picked ? { ...contractDemand, exp: picked.exp } : contractDemand,
					g.get("phase"),
					picked?.exception.type,
				);
				await recordCapExceptionSigning(t.tid, {
					pid: p.pid,
					amount: contractDemand.amount,
					exception: picked?.exception.type,
					payroll,
				});
			} else {
				await player.sign(p, t.tid, contractDemand, g.get("phase"));
			}
			await idb.cache.players.put(p);
			await team.rosterAutoSort(t.tid);
		}
	}
};

export default autoSign;
