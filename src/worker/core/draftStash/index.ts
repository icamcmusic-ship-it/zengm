// Draft-and-stash (basketball, core): store and move stashed players. The rules are in common/draftStash.ts; see
// docs/native-features.md, Draft-and-stash.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	aiShouldBringOver,
	aiShouldStash,
	bringOverBlockedReason,
	getOverseasLeague,
	getStashBuyout,
	getStashContract,
	getStashLapseSeason,
	rotationOvr,
	simulateStashSeason,
	stashBlockedReason,
	stashRightsLapse,
	type StashContractPlan,
} from "../../../common/draftStash.ts";
import { getProStats } from "../../../common/preDraft.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import g from "../../util/g.ts";
import helpers from "../../util/helpers.ts";
import local from "../../util/local.ts";
import logEvent from "../../util/logEvent.ts";
import toUI from "../../util/toUI.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { recomputeLocalUITeamOvrs } from "../../util/recomputeLocalUITeamOvrs.ts";
import { addContract, createContract } from "../contract/index.ts";
import getRookieContractLength from "../draft/getRookieContractLength.ts";
import getRookieSalaries from "../draft/getRookieSalaries.ts";
import { toCollegeProspect } from "../draft/generateCollegeStats.ts";
import { makeBlankPreDraftStatsRow } from "../player/normalizePreDraft.ts";
import { getNumPlayersTradedAwayNormalizedAll } from "../player/getNumPlayersTradedAwayNormalized.ts";
import addRatingsRow from "../player/addRatingsRow.ts";
import addToFreeAgents from "../player/addToFreeAgents.ts";
import develop from "../player/develop.ts";
import genContract from "../player/genContract.ts";
import updateValues from "../player/updateValues.ts";
import { formatAll } from "../player/format.ts";
import { developTraits } from "../player/traits.ts";
import getPayroll from "../team/getPayroll.ts";
import rosterAutoSort from "../team/rosterAutoSort.ts";

export const stashOn = () =>
	__SPORT === "basketball" && featureOn("draftStash");

// Players whose rights a team holds (every stashed player without tid)
export const getStashedPlayers = async (tid?: number) => {
	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.STASHED,
	);
	return tid === undefined
		? players
		: players.filter((p) => p.stash?.tid === tid);
};

// The team holding a player: his own team, or the team with his rights while he is stashed
export const getRightsTid = (p: { tid: number; stash?: { tid: number } }) =>
	p.tid === PLAYER.STASHED ? (p.stash?.tid ?? PLAYER.STASHED) : p.tid;

const isAiTeam = (tid: number) =>
	!g.get("userTids").includes(tid) ||
	!!local.autoPlayUntil ||
	g.get("spectator");

const playerLink = (p: Player) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return `<a href="${helpers.leagueUrl([
		"roster",
		`${info?.abbrev}_${tid}`,
		g.get("season"),
	])}">${info?.region} ${info?.name}</a>`;
};

// A team that no longer plays (disabled or contracted) can't hold rights
const teamGone = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return !info || info.disabled;
};

const seasonsWord = (n: number) => `${n} ${n === 1 ? "season" : "seasons"}`;

// Seasons he has played abroad since he was stashed
export const getSeasonsAbroad = (p: Player) =>
	p.stats.filter((row) => row.stash && !row.playoffs).length;

/**
 * Why he can't be stashed right now, or undefined when he can.
 */
export const getStashBlockedReason = (p: Player) => {
	if (!stashOn()) {
		return "Draft-and-stash is not available in this league.";
	}
	return stashBlockedReason({
		p,
		season: g.get("season"),
		phase: g.get("phase"),
		hasProStats: getProStats(p).length > 0,
		overseasLeague: getOverseasLeague(p),
	});
};

const rosterSize = async (tid: number) =>
	(await idb.cache.players.indexGetAll("playersByTid", tid)).length;

/**
 * The contract and buyout he would get if brought over now.
 */
export const getBringOverTerms = (
	p: Player,
): { contract: StashContractPlan; buyout: number } => {
	const season = g.get("season");
	let rookieAmount: number | undefined;
	if (g.get("draftPickAutoContract") && p.draft.round > 0 && p.draft.pick > 0) {
		const i = p.draft.pick - 1 + g.get("numActiveTeams") * (p.draft.round - 1);
		rookieAmount = getRookieSalaries()[i];
	}
	const contract = getStashContract({
		season,
		draftYear: p.draft.year,
		rookieAmount,
		rookieLength: getRookieContractLength(p.draft.round),
		marketAmount: genContract(p, false).amount,
		minContract: g.get("minContract"),
	});
	const buyout = getStashBuyout({
		league: p.stash?.league ?? "",
		seasonsAbroad: getSeasonsAbroad(p),
		minContract: g.get("minContract"),
	});
	return { contract, buyout };
};

/**
 * Why he can't be brought over right now, or undefined when he can.
 */
export const getBringOverBlockedReason = async (p: Player) => {
	if (p.tid !== PLAYER.STASHED || !p.stash) {
		return "He is not stashed overseas.";
	}
	const tid = p.stash.tid;
	const reason = bringOverBlockedReason({
		phase: g.get("phase"),
		rosterSize: await rosterSize(tid),
		maxRosterSize: g.get("maxRosterSize"),
	});
	if (reason) {
		return reason;
	}
	if (g.get("salaryCapType") === "hard") {
		const { contract } = getBringOverTerms(p);
		const payroll = await getPayroll(tid);
		if (payroll + contract.amount > g.get("salaryCap")) {
			return "His contract would put the team over the hard cap.";
		}
	}
	return undefined;
};

/**
 * Stash a drafted player: he leaves the roster (no roster spot, no salary) and keeps playing abroad while his team holds his rights.
 */
export const stashPlayer = async (
	p: Player,
	{ silent }: { silent?: boolean } = {},
) => {
	const reason = getStashBlockedReason(p);
	if (reason) {
		return reason;
	}
	const tid = p.tid;
	const season = g.get("season");

	// The rookie contract he got at the draft was never paid, so it is undone, not ended
	const lastContract = p.contracts.at(-1);
	if (
		lastContract &&
		!lastContract.endedEarly &&
		lastContract.type === "rookie" &&
		lastContract.payments.length === 0 &&
		lastContract.start > season
	) {
		p.contracts.pop();
	}
	delete p.contractDemand;
	await idb.cache.negotiations.delete(p.pid);

	p.tid = PLAYER.STASHED;
	p.stash = { tid, season, league: getOverseasLeague(p)! };
	p.gamesUntilTradable = 0;
	p.ptModifier = 1;
	await idb.cache.players.put(p);

	logEvent({
		type: "draftStash",
		text: `The ${teamLink(tid)} stashed draft pick ${playerLink(p)} overseas. He will keep playing for his club abroad while they hold his rights.`,
		showNotification: false,
		pids: [p.pid],
		tids: [tid],
		score: 0,
	});

	if (!silent) {
		await recomputeLocalUITeamOvrs();
		await toUI("realtimeUpdate", [["playerMovement"]]);
	}
	return undefined;
};

/**
 * Bring a stashed player over: he signs with the team holding his rights, which also pays the buyout of his club contract.
 */
export const bringOverPlayer = async (
	p: Player,
	{ silent }: { silent?: boolean } = {},
) => {
	const reason = await getBringOverBlockedReason(p);
	if (reason) {
		return reason;
	}
	const tid = p.stash!.tid;
	const season = g.get("season");
	const seasonsAbroad = getSeasonsAbroad(p);
	const { contract, buyout } = getBringOverTerms(p);

	if (buyout > 0) {
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[season, tid],
		);
		if (teamSeason) {
			teamSeason.expenses.salary += buyout;
			teamSeason.cash -= buyout;
			await idb.cache.teamSeasons.put(teamSeason);
		}
	}

	const contractText = `${helpers.formatCurrency(contract.amount / 1000, "M")}/yr through ${contract.exp}${contract.rookie ? " (rookie scale)" : ""}`;
	const eid = await logEvent({
		type: "draftStash",
		text: `The ${teamLink(tid)} brought ${playerLink(p)} over from overseas${
			seasonsAbroad > 0 ? ` after ${seasonsWord(seasonsAbroad)} abroad` : ""
		}, signing him for ${contractText}${
			buyout > 0
				? ` and paying a ${helpers.formatCurrency(buyout / 1000, "M")} buyout to his club`
				: ""
		}.`,
		showNotification: false,
		pids: [p.pid],
		tids: [tid],
		score: Math.round(helpers.bound(p.valueFuzz - 45, 0, Infinity)),
	});

	p.tid = tid;
	delete p.stash;
	delete p.contractDemand;
	p.gamesUntilTradable = 0;
	p.numDaysFreeAgent = 0;
	addContract(
		p,
		createContract({
			contract: {
				amount: contract.amount,
				exp: contract.exp,
				...(contract.rookie ? { rookie: true } : {}),
			},
			eid,
			type: contract.rookie ? "rookie" : "freeAgent",
		}),
	);
	await idb.cache.players.put(p);

	if (!silent) {
		if (!isAiTeam(tid)) {
			const t = await idb.cache.teams.get(tid);
			await rosterAutoSort(tid, t ? !t.keepRosterSorted : false);
		}
		await recomputeLocalUITeamOvrs();
		await toUI("realtimeUpdate", [["playerMovement"]]);
	}
	return undefined;
};

/**
 * After the playoffs: every stashed player gets the season that just ended as an overseas season (stats row with stash: true). Not for a player stashed this season (he was stashed after it).
 */
export const addStashSeasons = async () => {
	if (__SPORT !== "basketball") {
		return;
	}
	const season = g.get("season");
	for (const p of await getStashedPlayers()) {
		if (!p.stash || p.stash.season >= season) {
			continue;
		}
		if (p.stats.some((row) => row.stash && row.season === season)) {
			continue;
		}
		const r = p.ratings.at(-1)!;
		const line = simulateStashSeason({
			pid: p.pid,
			season,
			league: p.stash.league,
			ratings: toCollegeProspect(p, season).ratings,
			ovr: r.ovr,
			age: season - p.born.year,
			pos: r.pos,
		});
		const row: any = makeBlankPreDraftStatsRow(season);
		for (const [key, value] of Object.entries(line.stats)) {
			row[key] = value;
		}
		for (const [key, value] of Object.entries(line.max)) {
			row[key] = value;
		}
		row.teamName = p.stash.league;
		row.stash = true;
		p.stats.push(row);
		await idb.cache.players.put(p);
	}
};

/**
 * Preseason: stashed players develop like anyone else (a new ratings row, a year of development, values). Returns them so the preseason can do the rest (archetypes, faces) with everyone. Separate from the main loop so a league without stashed players develops exactly as before.
 */
export const developStashed = async (scoutingLevel: number | undefined) => {
	const players = await getStashedPlayers();
	for (const p of players) {
		addRatingsRow(p, scoutingLevel);
		await develop(p, 1, false);
		developTraits(p as any, g.get("season"));
	}
	for (const p of players) {
		await updateValues(p);
	}
	await idb.cache.players.putAll(players);
	return players;
};

const teamRotationOvr = async (tid: number, players?: Player[]) => {
	const roster =
		players ?? (await idb.cache.players.indexGetAll("playersByTid", tid));
	return rotationOvr(roster.map((p) => p.ratings.at(-1)!.ovr));
};

const pickNumOf = (p: Player) =>
	p.draft.pick + (p.draft.round - 1) * g.get("numActiveTeams");

/**
 * End of the draft (start of the after draft phase): AI teams stash their eligible picks by the rule in aiShouldStash, worst first.
 */
export const aiStashAfterDraft = async () => {
	if (!stashOn()) {
		return;
	}
	const season = g.get("season");
	const drafted = (
		await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
			[season],
			[season, Infinity],
		])
	).filter((p) => p.tid >= 0 && isAiTeam(p.tid));
	const byTid = Map.groupBy(drafted, (p) => p.tid);
	for (const [tid, picks] of [...byTid].sort((a, b) => a[0] - b[0])) {
		const eligible = picks
			.filter((p) => getStashBlockedReason(p) === undefined)
			.sort(
				(a, b) =>
					a.ratings.at(-1)!.ovr - b.ratings.at(-1)!.ovr || a.pid - b.pid,
			);
		if (eligible.length === 0) {
			continue;
		}
		const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
		let size = roster.length;
		const bar = await teamRotationOvr(tid, roster);
		for (const p of eligible) {
			if (
				aiShouldStash({
					pickNum: pickNumOf(p),
					ovr: p.ratings.at(-1)!.ovr,
					teamRotationOvr: bar,
					rosterSize: size,
					maxRosterSize: g.get("maxRosterSize"),
				})
			) {
				const error = await stashPlayer(p, { silent: true });
				if (error === undefined) {
					size -= 1;
				}
			}
		}
	}
};

/**
 * Start of free agency: AI teams bring over the stashed players who are ready (aiShouldBringOver), then rights that reached their limit lapse and those players become free agents.
 */
export const stashFreeAgencyStart = async () => {
	if (__SPORT !== "basketball") {
		return;
	}
	const season = g.get("season");
	const stashed = (await getStashedPlayers()).sort(
		(a, b) => b.value - a.value || a.pid - b.pid,
	);

	if (stashOn()) {
		for (const p of stashed) {
			const tid = p.stash?.tid;
			if (tid === undefined || !isAiTeam(tid) || teamGone(tid)) {
				continue;
			}
			const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
			if (
				aiShouldBringOver({
					ovr: p.ratings.at(-1)!.ovr,
					teamRotationOvr: await teamRotationOvr(tid, roster),
					rosterSize: roster.length,
					maxRosterSize: g.get("maxRosterSize"),
					lastChance: stashRightsLapse(p, season),
				})
			) {
				await bringOverPlayer(p, { silent: true });
			}
		}
	}

	const numPlayersTradedAwayNormalized =
		await getNumPlayersTradedAwayNormalizedAll();
	for (const p of stashed) {
		// Rights also lapse when the feature is off, so nobody is left stuck abroad
		if (p.tid !== PLAYER.STASHED) {
			continue;
		}
		// (and when the team holding them is gone: contracted or disabled)
		if (
			stashOn() &&
			!stashRightsLapse(p, season) &&
			p.stash !== undefined &&
			!teamGone(p.stash.tid)
		) {
			continue;
		}
		const tid = p.stash?.tid;
		const seasonsAbroad = getSeasonsAbroad(p);
		delete p.stash;
		// His demand is normalized with the other free agents right after this
		addToFreeAgents(p, numPlayersTradedAwayNormalized);
		await idb.cache.players.put(p);
		logEvent({
			type: "draftStash",
			text:
				tid !== undefined && tid >= 0 && !teamGone(tid)
					? `The ${teamLink(tid)} never brought ${playerLink(p)} over, and their rights lapsed after ${seasonsWord(seasonsAbroad)} overseas. He is now a free agent.`
					: `The rights to ${playerLink(p)} lapsed after ${seasonsWord(seasonsAbroad)} overseas. He is now a free agent.`,
			showNotification: tid !== undefined && !isAiTeam(tid),
			pids: [p.pid],
			tids: tid !== undefined && tid >= 0 ? [tid] : [],
			score: 0,
		});
	}
};

// For the UI: the stash info of a player (or undefined), for the player and roster pages
export const getStashInfo = async (p: Player) => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const userTid = g.get("userTid");
	if (p.tid === PLAYER.STASHED && p.stash) {
		const userCanAct =
			g.get("userTids").includes(p.stash.tid) && !g.get("spectator");
		const blocked = await getBringOverBlockedReason(p);
		const { contract, buyout } = getBringOverTerms(p);
		return {
			type: "stashed" as const,
			tid: p.stash.tid,
			abbrev: g.get("teamInfoCache")[p.stash.tid]?.abbrev ?? "",
			season: p.stash.season,
			league: p.stash.league,
			seasonsAbroad: getSeasonsAbroad(p),
			lapseSeason: getStashLapseSeason(p),
			userCanAct,
			bringOverBlocked: blocked,
			contract: { ...contract, amount: contract.amount / 1000 },
			buyout: buyout / 1000,
		};
	}
	if (p.tid === userTid || g.get("userTids").includes(p.tid)) {
		const blocked = getStashBlockedReason(p);
		// Only offered for players it could ever apply to: drafted this season from overseas
		if (
			stashOn() &&
			!g.get("spectator") &&
			p.draft.year === g.get("season") &&
			getOverseasLeague(p) !== undefined &&
			g.get("phase") >= PHASE.DRAFT
		) {
			return {
				type: "canStash" as const,
				tid: p.tid,
				league: getOverseasLeague(p)!,
				stashBlocked: blocked,
				lapseSeason: getStashLapseSeason(p),
			};
		}
	}
	return undefined;
};

export type StashInfo = Awaited<ReturnType<typeof getStashInfo>>;

// For the roster page: a team's stashed players (with what bringing each over would cost) and, for the user's team, its
// draft picks that can be stashed
export const getTeamStashView = async (tid: number) => {
	if (!stashOn()) {
		return undefined;
	}
	const season = g.get("season");
	const stashedRaw = await getStashedPlayers(tid);
	const userTeam = g.get("userTids").includes(tid) && !g.get("spectator");
	const stashedFormatted = await formatAll(stashedRaw, {
		attrs: ["pid", "firstName", "lastName", "age", "draft"],
		ratings: ["ovr", "pot", "pos"],
		season,
		showNoStats: true,
		showRookies: true,
		fuzz: true,
	});
	const stashed = [];
	for (const p of stashedFormatted) {
		const raw = stashedRaw.find((p2) => p2.pid === p.pid)!;
		const info = await getStashInfo(raw);
		if (info?.type !== "stashed") {
			continue;
		}
		stashed.push({
			...info,
			pid: p.pid as number,
			name: `${p.firstName} ${p.lastName}`,
			age: p.age as number,
			pos: p.ratings.pos as string,
			ovr: p.ratings.ovr as number,
			pot: p.ratings.pot as number,
			draft: p.draft as { year: number; round: number; pick: number },
			userCanAct: userTeam && info.userCanAct,
		});
	}

	const canStash = [];
	if (userTeam) {
		for (const p of await idb.cache.players.indexGetAll("playersByTid", tid)) {
			const info = await getStashInfo(p);
			if (info?.type === "canStash") {
				canStash.push({
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					league: info.league,
					blocked: info.stashBlocked,
				});
			}
		}
	}

	if (stashed.length === 0 && canStash.length === 0) {
		return undefined;
	}
	return { stashed, canStash, userTeam };
};

export type TeamStashView = Awaited<ReturnType<typeof getTeamStashView>>;
