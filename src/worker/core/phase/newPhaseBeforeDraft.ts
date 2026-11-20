import { autoImportLinkedCollegeClass } from "../draft/linkedCollege.ts";
import { clearPaidReleasedContracts } from "../contract/index.ts";
import { PLAYER } from "../../../common/constants.ts";
import { draft, player, season, team, league } from "../index.ts";
import { idb } from "../../db/index.ts";
import {
	achievement,
	g,
	helpers,
	local,
	toUI,
	logEvent,
} from "../../util/index.ts";
import type {
	Conditions,
	PhaseReturn,
	Player,
	LogEventType,
	GameAttributesLeague,
} from "../../../common/types.ts";
import setGameAttributes from "../league/setGameAttributes.ts";
import { doExpand, doRelocate } from "./relocateExpand.ts";
import addAward from "../player/addAward.ts";
import { analyticsEventLocal } from "../../../common/analyticsEventLocal.ts";
import { updateColaAfterPlayoffs } from "../draft/cola.ts";
import { logClassHeadline } from "../draft/classShape.ts";
import { last } from "../../../common/utils.ts";
import { randInt, shuffle, truncGauss } from "../../../common/random.ts";
import { genMessage } from "./genMessage.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { env } from "../../util/env.ts";
import { orderTeams } from "../../util/orderTeams.ts";
import { doAwards } from "../awards/doAwards.ts";
import { awardExecOfTheYear } from "../awards/coachExecAwards.ts";
import * as staff from "../staff/index.ts";
import * as gm from "../gm/index.ts";
import * as college from "../college/index.ts";
import { pruneSeasonLineups } from "../player/advStatsStorage.ts";
import { addStashSeasons } from "../draftStash/index.ts";

const INFLATION_GAME_ATTRIBUTES = [
	"salaryCap",
	"minContract",
	"maxContract",
	"minPayroll",
	"luxuryPayroll",
] as const;

// Keys an upcoming scheduled event sets itself (absolute values, e.g. real salary caps). Inflation still applies to the other keys, so a season with a scheduled event doesn't freeze minContract/luxuryPayroll etc.
const keysSetByUpcomingScheduledEvents = async () => {
	const scheduledEvents = await idb.merged.scheduledEvents.getAll();
	const keys = new Set<(typeof INFLATION_GAME_ATTRIBUTES)[number]>();
	for (const event of scheduledEvents) {
		if (event.type === "gameAttributes") {
			for (const key of INFLATION_GAME_ATTRIBUTES) {
				if (Object.hasOwn(event.info, key)) {
					keys.add(key);
				}
			}
		}
	}
	return keys;
};

const doInflation = async (conditions: Conditions) => {
	const scheduledKeys = await keysSetByUpcomingScheduledEvents();
	if (scheduledKeys.size === INFLATION_GAME_ATTRIBUTES.length) {
		return;
	}

	const inflationMin = g.get("inflationMin");
	const inflationMax = g.get("inflationMax");
	const inflationAvg = g.get("inflationAvg");
	const inflationStd = g.get("inflationStd");

	let inflation;

	if (inflationMin === inflationMax) {
		inflation = inflationMin;
	} else if (inflationStd === 0 || scheduledKeys.size > 0) {
		// With a scheduled event, use the average instead of a random draw: these seasons used to skip inflation, so a draw here would shift the random stream
		inflation = helpers.bound(inflationAvg, inflationMin, inflationMax);
	} else {
		try {
			inflation = truncGauss(
				inflationAvg,
				inflationStd,
				inflationMin,
				inflationMax,
			);
		} catch {
			inflation = randInt(inflationMin, inflationMax);
		}
	}

	// Round to 0.1%
	inflation = Math.round(inflation * 10) / 10;

	if (inflation === 0) {
		return;
	}

	const updatedGameAttributes: Partial<GameAttributesLeague> = {};

	for (const key of INFLATION_GAME_ATTRIBUTES) {
		if (scheduledKeys.has(key)) {
			continue;
		}
		const oldValue = g.get(key);
		const newValue = helpers.roundContract(oldValue * (1 + inflation / 100));
		if (oldValue !== newValue) {
			updatedGameAttributes[key] = helpers.roundContract(
				g.get(key) * (1 + inflation / 100),
			);
		}
	}

	if (Object.keys(updatedGameAttributes).length > 0) {
		await league.setGameAttributes(updatedGameAttributes);

		logEvent(
			{
				type: "gameAttribute",
				text: scheduledKeys.has("salaryCap")
					? `An inflation rate of ${inflation}% ${
							inflation > 0 ? "increased" : "decreased"
						} contract and payroll limits.`
					: `An inflation rate of ${inflation}% ${
							inflation > 0 ? "increased" : "decreased"
						} the salary cap to ${helpers.formatCurrency(
							g.get("salaryCap") / 1000,
							"M",
						)}.`,
				tids: [],
				persistent: true,
				hideInLiveGame: true,
				extraClass: "",
				score: 20,
			},
			conditions,
		);
	}
};

const setChampNoPlayoffs = async (conditions: Conditions) => {
	const teams = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: [
			"cid",
			"did",
			"won",
			"lost",
			"tied",
			"otl",
			"winp",
			"pts",
			"wonDiv",
			"lostDiv",
			"tiedDiv",
			"otlDiv",
			"wonConf",
			"lostConf",
			"tiedConf",
			"otlConf",
		],
		stats: ["pts", "oppPts", "gp"],
		season: g.get("season"),
		showNoStats: true,
	});

	const ordered = await orderTeams(teams, teams);

	const { tid } = ordered[0]!;

	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	if (!teamSeason) {
		return;
	}

	teamSeason.playoffRoundsWon = 0;
	teamSeason.hype += 0.2;
	teamSeason.hype = helpers.bound(teamSeason.hype, 0, 1);

	logEvent(
		{
			type: "playoffs",
			text: `The <a href="${helpers.leagueUrl([
				"roster",
				`${g.get("teamInfoCache")[tid]?.abbrev}_${tid}`,
				g.get("season"),
			])}">${
				g.get("teamInfoCache")[tid]?.name
			}</a> finished in 1st place and are league champions!`,
			showNotification: true,
			hideInLiveGame: true,
			tids: [tid],
			score: 20,
			saveToDb: true,
		},
		conditions,
	);

	await idb.cache.teamSeasons.put(teamSeason);
};

const doThanosMode = async (conditions: Conditions) => {
	const thanosCooldownEnd = g.get("thanosCooldownEnd");
	if (
		(thanosCooldownEnd === undefined || g.get("season") >= thanosCooldownEnd) &&
		Math.random() < g.get("challengeThanosMode") / 100
	) {
		const activePlayers = await idb.cache.players.indexGetAll("playersByTid", [
			0,
			Infinity,
		]);
		shuffle(activePlayers);
		const snappedPlayers = activePlayers.slice(0, activePlayers.length / 2);

		const userSnappedPlayers = [];

		for (const p of snappedPlayers) {
			// Real players are retired players are  killed
			if (p.tid === g.get("userTid")) {
				userSnappedPlayers.push(p);
			}

			let action;
			let type: LogEventType;
			if (p.real) {
				action = "retired due to";
				type = "retired";
			} else {
				p.diedYear = g.get("season");
				action = "was killed in";
				type = "tragedy";
			}
			logEvent(
				{
					type,
					text: `<a href="${helpers.leagueUrl(["player", p.pid])}">${
						p.firstName
					} ${p.lastName}</a> ${action} a Thanos snap.`,
					showNotification: false,
					pids: [p.pid],
					tids: [p.tid],
					score: 20,
				},
				conditions,
			);

			await player.retire(p, conditions, {
				logRetiredEvent: false,
			});
		}
		await idb.cache.players.putAll(snappedPlayers);

		let text = "A Thanos event has occurred! ";
		const numPlayers = userSnappedPlayers.length;
		if (numPlayers === 0) {
			text += "Somehow your team did not lose any players.";
		} else {
			text += `Your team lost ${numPlayers} ${helpers.plural(
				"player",
				numPlayers,
			)}: `;
			for (let i = 0; i < numPlayers; i++) {
				const p = userSnappedPlayers[i]!;
				if (i > 0 && numPlayers === 2) {
					text += " and ";
				} else if (i > 0 && i === numPlayers - 1) {
					text += ", and ";
				} else if (i > 0) {
					text += ", ";
				}

				text += `<a href="${helpers.leagueUrl(["player", p.pid])}">${
					p.firstName
				} ${p.lastName}</a>`;
			}
			text += ".";
		}
		logEvent(
			{
				type: "tragedy",
				text,
				showNotification: true,
				pids: [],
				tids: [g.get("userTid")],
				persistent: true,
			},
			conditions,
		);

		// Make sure another event won't happen within the next 2 seasons to prevent running out of players
		await league.setGameAttributes({
			thanosCooldownEnd: g.get("season") + 3,
		});
	}
};

const doSisyphusMode = async (conditions: Conditions) => {
	const { swappedTid } = await league.swapWorstRoster(true);
	let text = "Sisyphus Mode activated! ";
	const tids = [g.get("userTid")];
	if (swappedTid !== undefined) {
		const teamInfo = g.get("teamInfoCache")[swappedTid]!;
		text += `Your roster has been swapped with the worst team in the league, the ${teamInfo.region} ${teamInfo.name}.`;
		tids.push(swappedTid);
	} else {
		text +=
			"But somehow your roster is already the worst in the league, so it didn't do anything.";
	}

	logEvent(
		{
			type: "sisyphusTeam",
			text,
			showNotification: true,
			hideInLiveGame: true,
			pids: [],
			tids,
			persistent: true,
			score: 20,
		},
		conditions,
	);
};

const newPhaseBeforeDraft = async (
	conditions: Conditions,
	liveGameInProgress: boolean = false,
): Promise<PhaseReturn> => {
	// In case some weird situation results in games still in the schedule, clear them
	await idb.cache.schedule.clear();

	if (g.get("numGamesPlayoffSeries").length === 0) {
		// Set champ of the league!
		await setChampNoPlayoffs(conditions);
	}

	await doAwards(conditions);

	// Advanced Tracking Stats: the season's lineups, down to the most used ones
	await pruneSeasonLineups();

	// College mode: keep the season's polls, brackets and selection with the awards
	if (college.isCollege()) {
		await college.archiveSeason();
	}

	// Executive of the Year, before the GM carousel so the GM who ran the season still runs the team (Coach of the Year is given in
	// staff.runOffseason, once the coaches' season records are written)
	await awardExecOfTheYear();

	// AI GM records, firings and the GM carousel (before the coaching market, so new GMs run it)
	await gm.runOffseason();

	// Coaching staff records, Coach of the Year, and the offseason coaching market
	await staff.runOffseason();

	// College mode: conference realignment (setting), for next season
	if (college.isCollege()) {
		await college.afterSeasonOver();
	}
	// Linked college league (pro league): its latest departed class becomes this draft's class
	if (!college.isCollege()) {
		await autoImportLinkedCollegeClass();
	}

	const teams = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: ["playoffRoundsWon"],
		season: g.get("season"),
		active: true,
	});

	// Give award to all players on the championship team
	const t = teams.find(
		(t2) =>
			t2.seasonAttrs.playoffRoundsWon ===
			g.get("numGamesPlayoffSeries", "current").length,
	);

	if (t !== undefined) {
		const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);

		for (const p of players) {
			addAward(p, {
				season: g.get("season"),
				type: "Won Championship",
			});
		}
		await idb.cache.players.putAll(players);
	}

	// Check here after adding awards, for run_it_back
	await achievement.check("afterPlayoffs", conditions);

	if (g.get("challengeLoseBestPlayer")) {
		const tids = g.get("userTids");
		for (const tid of tids) {
			const players = await idb.cache.players.indexGetAll("playersByTid", tid);

			let bestOvr = 0;
			let bestPlayer: Player | undefined;
			for (const p of players) {
				const ovr = last(p.ratings).ovr;
				if (ovr > bestOvr) {
					bestOvr = ovr;
					bestPlayer = p;
				}
			}

			if (bestPlayer) {
				// Kill/retire player, depending on if he's a real player or not
				if (bestPlayer.real) {
					await player.retire(bestPlayer, conditions);
					await idb.cache.players.put(bestPlayer);

					// Similar to the tragic death notification
					logEvent(
						{
							type: "tragedy",
							text: `<a href="${helpers.leagueUrl([
								"player",
								bestPlayer.pid,
							])}">${bestPlayer.firstName} ${
								bestPlayer.lastName
							}</a> decided to retire in the prime of ${helpers.pronoun(
								g.get("gender"),
								"his",
							)} career.`,
							showNotification: true,
							pids: [bestPlayer.pid],
							tids: [tid],
							persistent: true,
							score: 20,
						},
						conditions,
					);
				} else {
					await player.killOne(conditions, bestPlayer);
				}
			}
		}
	}

	await doThanosMode(conditions);

	if (g.get("challengeSisyphusMode") && t?.tid === g.get("userTid")) {
		await doSisyphusMode(conditions);
	}

	const repeatSeasonType = g.get("repeatSeason")?.type;

	if (repeatSeasonType !== "playersAndRosters") {
		// Do annual tasks for each player, like checking for retirement
		const players = await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		]);

		const retiredPlayersByTeam = new Map<number, Player[]>();

		const playersToSave = [];
		for (const p of players) {
			let update = false;

			if (!repeatSeasonType) {
				if (await player.shouldRetire(p)) {
					if (p.tid >= 0) {
						const retiredPlayers = retiredPlayersByTeam.getOrInsert(p.tid, []);
						retiredPlayers.push(p);
					}
					await player.retire(p, conditions);
					update = true;
				} else if (p.tid === PLAYER.FREE_AGENT) {
					p.yearsFreeAgent += 1;
					update = true;
				} else if (p.tid >= 0 && p.yearsFreeAgent > 0) {
					p.yearsFreeAgent = 0;
					update = true;
				}
			}

			// Heal injures - this happens for repeatSeasonType === "players" too!
			if (p.injury.gamesRemaining > 0 || p.injury.type !== "Healthy") {
				const numGames = defaultGameAttributes.numGames[0].value;
				// This doesn't use g.get("numGames") because that would unfairly make injuries last longer if it was lower - if anything injury duration should be modulated based on that, but oh well
				if (p.injury.gamesRemaining <= numGames) {
					p.injury = {
						type: "Healthy",
						gamesRemaining: 0,
					};
				} else {
					p.injury.gamesRemaining -= numGames;
				}

				update = true;
			}

			if (update) {
				playersToSave.push(p);
			}
		}
		await idb.cache.players.putAll(playersToSave);

		for (const [tid, retiredPlayers] of retiredPlayersByTeam) {
			const text = retiredPlayers
				.map(
					(p) =>
						`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${
							p.lastName
						}</a> retired.`,
				)
				.join("<br>");
			logEvent(
				{
					type: "retiredList",
					text,
					showNotification: tid === g.get("userTid"),
					pids: retiredPlayers.map((p) => p.pid),
					tids: [tid],
					saveToDb: false,
				},
				conditions,
			);
		}

		await clearPaidReleasedContracts();

		await team.updateStrategies();
		await achievement.check("afterAwards", conditions);
		const response = await season.updateOwnerMood();
		if (response) {
			await genMessage(response.deltas, response.cappedDeltas);
		}

		if (!repeatSeasonType) {
			if (
				g.get("draftType") === "noLottery" ||
				g.get("draftType") === "noLotteryReverse" ||
				g.get("draftType") === "random"
			) {
				await draft.genOrder(false, conditions);
			}
		}
	}

	if (g.get("gameOver")) {
		await achievement.check("afterFired", conditions);
	}

	await doInflation(conditions);

	await updateColaAfterPlayoffs();

	// Draft Class Shapes: this year's class in the news
	await logClassHeadline(g.get("season"), conditions);

	// Draft-and-stash: the season that just ended, abroad, for every stashed player
	if (!college.isCollege()) {
		await addStashSeasons();
	}

	// Randomize order of doRelocate and doExpand, because we want one to block the other but not always the same one. Never in a college
	// league: schools don't relocate, and the field is the real college list (conferences change by realignment instead)
	if (college.isCollege()) {
		// Nothing
	} else if (Math.random() > 0.5) {
		const relocated = await doRelocate();
		if (!relocated) {
			await doExpand();
		}
	} else {
		const expanded = await doExpand();
		if (!expanded) {
			await doRelocate();
		}
	}

	// Don't redirect if we're viewing a live game now
	let redirect;
	if (!liveGameInProgress) {
		redirect = {
			url: helpers.leagueUrl(["history"]),
			text: "View season summary",
		};
	} else {
		local.unviewedSeasonSummary = true;
	}

	await setGameAttributes({
		riggedLottery: undefined,
	});

	if (env.enableLogging) {
		toUI(
			"analyticsEvent",
			[
				"completed_season",
				{
					season: g.get("season"),
					league_id: g.get("lid"),
				},
			],
			conditions,
		);
		analyticsEventLocal("completed_season");
	}

	return {
		redirect,
		updateEvents: ["playerMovement"],
	};
};

export default newPhaseBeforeDraft;
