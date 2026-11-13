// @ts-nocheck (node-only script, like run.script.test.ts)
/* eslint-disable no-undef */
// The owner fires the user, who takes over another team and plays on: a new league with the new-league defaults (not spectator
// mode), played the way the UI plays it, with the owner's mood set so he fires the user after the first season. Run with
// RUN_FIRED_USER=1 npx vitest run --project basketball src/test/ratingInflation/firedUser.script.test.ts
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { nativeFeatureNewLeagueDefaults } from "../../common/nativeFeatures.ts";
import { last } from "../../common/utils.ts";
import { getCurrentContract } from "../../common/contracts.ts";
import {
	draft,
	freeAgents,
	game,
	league,
	phase,
	player,
	team,
} from "../../worker/core/index.ts";
import { getContractDemand } from "../../worker/core/contract/index.ts";
import { idb } from "../../worker/db/index.ts";
import { getDefaultSettings } from "../../worker/views/newLeague.ts";
import { g, helpers, local } from "../../worker/util/index.ts";
import { mulberry32 } from "./harness.ts";

const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		await player.release(players.shift(), false);
	}
	if (players.length < g.get("minRosterSize")) {
		const fas = await idb.cache.players.indexGetAll("playersByTid", -1);
		fas.sort((a, b) => b.value - a.value);
		while (players.length < g.get("minRosterSize")) {
			const p = fas.shift() ?? (await player.genRandomFreeAgent());
			await player.sign(p, tid, getContractDemand(p), g.get("phase"));
			await idb.cache.players.put(p);
			players.push(p);
		}
	}
};

const playSeason = async () => {
	await fixUserRoster();
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	let days = 0;
	while (
		g.get("phase") === PHASE.REGULAR_SEASON ||
		g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
		g.get("phase") === PHASE.PLAYOFFS
	) {
		await fixUserRoster();
		await game.play(g.get("phase") === PHASE.PLAYOFFS ? 100 : 7, {});
		days += 1;
		if (days > 500) {
			throw new Error("stuck");
		}
	}
};

test.skipIf(!process.env.RUN_FIRED_USER)(
	"fired user takes a new team",
	async () => {
		await import("fake-indexeddb/auto");
		const origRandom = Math.random;
		Math.random = mulberry32(Number(process.env.FIRED_SEED ?? 3));
		try {
			const settings = {
				...getDefaultSettings(),
				...nativeFeatureNewLeagueDefaults(),
			};
			await league.createStream(
				{},
				{
					confs: last(defaultGameAttributes.confs).value,
					divs: last(defaultGameAttributes.divs).value,
					fromFile: {
						gameAttributes: undefined,
						hasRookieContracts: true,
						maxGid: undefined,
						startingSeason: undefined,
						teams: undefined,
						version: LEAGUE_DATABASE_VERSION,
					},
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 0,
					name: "fired",
					setLeagueCreationStatus: () => {},
					settings,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			local.autoPlayUntil = undefined;
			const season = g.get("season");
			await league.setGameAttributes({ gracePeriodEnd: season });
			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[0, season],
			);
			ts.ownerMood = { wins: -2, playoffs: -2, money: -2 };
			await idb.cache.teamSeasons.put(ts);

			await playSeason();
			assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
			assert.isTrue(g.get("gameOver"), "fired");

			const newTid = 7;
			await team.switchTo(newTid);
			assert.isFalse(g.get("gameOver"));
			assert.strictEqual(g.get("userTid"), newTid);

			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			const negotiations = await idb.cache.negotiations.getAll();
			for (const n of negotiations) {
				assert.strictEqual(
					n.tid,
					newTid,
					"re-signing negotiations are the new team's",
				);
			}
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await fixUserRoster();
				await freeAgents.play(30, {});
			}
			assert.strictEqual(g.get("phase"), PHASE.PRESEASON);
			// The old team got its own GM back (AI GM personalities) and the AI runs it again
			const oldTeam = await idb.cache.teams.get(0);
			const players0 = await idb.cache.players.indexGetAll("playersByTid", 0);
			for (const p of [
				...players0,
				...(await idb.cache.players.indexGetAll("playersByTid", newTid)),
			]) {
				assert.isDefined(getCurrentContract(p), `p${p.pid} has a contract`);
			}
			await playSeason();
			const ts2 = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[newTid, season + 1],
			);
			console.log(
				JSON.stringify({
					oldTeamGm: oldTeam.gm?.gmid ?? null,
					oldTeamBudget: oldTeam.budget,
					oldRoster: players0.length,
					newOwnerMood: ts2.ownerMood,
					gameOver: g.get("gameOver"),
					messages: (await idb.cache.messages.getAll()).map((m) => [
						m.year,
						m.tid,
						m.subject,
					]),
				}),
			);
		} finally {
			Math.random = origRandom;
		}
	},
	3_600_000,
);
