// College mode: what happens between seasons. Departures (graduation, the off-screen pro draft), the automatic transfer portal, recruiting
// (class generation, targets, signing day, walk-ons), the preseason bookkeeping and expectations. See docs/college-mode.md.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	COLLEGE_ELIGIBILITY_YEARS,
	COLLEGE_SCHOLARSHIPS,
	classYearAbbrev,
} from "../../../common/college/constants.ts";
import type {
	CollegeClassRanking,
	CollegeCommit,
	CollegeDeparture,
	CollegeProDraftPick,
	PlayerCollegeExit,
	PlayerPortal,
	PlayerRecruit,
} from "../../../common/college/types.ts";
import { getCollegeTournamentSize } from "../../../common/college/teams.ts";
import { realGauss } from "../../../common/random.ts";
import type {
	Conditions,
	Player,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { addContract, createContract } from "../contract/index.ts";
import { updateCollegeArchive } from "./archive.ts";
import { signCommitted } from "./recruiting.ts";
import { getExpectations } from "./expectations.ts";
import {
	genCollegePlayer,
	getTalentShare,
	getTeamPrestige,
	recruitScore,
	starsFromQuantile,
} from "./players.ts";

export type CollegePlayer = Player & {
	classYear?: number;
	recruit?: PlayerRecruit;
	collegeExit?: PlayerCollegeExit;
	portal?: PlayerPortal;
	// Number of times he transferred (one transfer without sitting out; a player who transferred once does not enter the portal again)
	transfers?: number;
	redshirt?: number;
};

export const playerLink = (p: {
	pid: number;
	firstName: string;
	lastName: string;
}) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

export const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return `<a href="${helpers.leagueUrl([
		"roster",
		`${info?.abbrev}_${tid}`,
	])}">${info?.region}</a>`;
};

export const getClassYear = (p: CollegePlayer) =>
	p.classYear ?? helpers.bound(g.get("season") - p.draft.year, 1, 4);

export const getActiveTeams = async () =>
	(await idb.cache.teams.getAll()).filter((t) => !t.disabled);

export const getRosters = async () => {
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	return Map.groupBy(players, (p) => p.tid);
};

// G / F / C
export const posGroup = (pos: string) =>
	pos === "C" || pos === "FC" ? 2 : pos.includes("F") ? 1 : 0;
export const IDEAL_BY_GROUP = [5, 5, 3];

export const groupCounts = (roster: CollegePlayer[]) => {
	const counts = [0, 0, 0];
	for (const p of roster) {
		counts[posGroup(last(p.ratings).pos)]! += 1;
	}
	return counts;
};

// ---- Departures ----

// How the pros see a player: what he is, what he could be, and how old he is
const proStock = (p: CollegePlayer) => {
	const ratings = last(p.ratings);
	const age = g.get("season") - p.born.year;
	return 0.5 * ratings.ovr + 0.5 * ratings.pot - 0.9 * (age - 19);
};

export const getNumProDraftPicks = (numTeams: number) =>
	helpers.bound(Math.round(numTeams / 2), 4, 60);

export const leaveSchool = async (
	p: CollegePlayer,
	exit: PlayerCollegeExit,
	text: string,
	conditions: Conditions,
) => {
	const tid = p.tid;
	// No conditions: no Hall of Fame for college careers
	await player.retire(p, undefined, { logRetiredEvent: false });
	p.collegeExit = exit;
	logEvent(
		{
			type: "retired",
			text,
			showNotification: false,
			pids: [p.pid],
			tids: [tid],
			score: exit.type === "pro" ? 10 : 0,
		},
		conditions,
	);
	await idb.cache.players.put(p);
};

/**
 * Seniors graduate and the best players turn pro (the off-screen pro draft). Entering the Departures phase.
 */
export const doDepartures = async (conditions: Conditions) => {
	const season = g.get("season");
	const userTid = g.get("userTid");
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	const numTeams = (await getActiveTeams()).length;
	const numPicks = getNumProDraftPicks(numTeams);

	const board = players
		.map((p) => ({ p, stock: proStock(p) + realGauss(0, 1.5) }))
		.sort((a, b) => b.stock - a.stock);

	const picks: CollegeProDraftPick[] = [];
	const drafted = new Map<number, number>();
	for (const { p } of board) {
		if (picks.length >= numPicks) {
			break;
		}
		const slot = picks.length + 1;
		const frac = slot / numPicks;
		const senior = getClassYear(p) >= COLLEGE_ELIGIBILITY_YEARS;
		// Underclassmen only leave when they are projected high enough
		const probDeclare = senior
			? 1
			: frac <= 0.25
				? 0.97
				: frac <= 0.5
					? 0.8
					: frac <= 0.75
						? 0.45
						: 0.2;
		if (Math.random() >= probDeclare) {
			continue;
		}
		const ratings = last(p.ratings);
		picks.push({
			pick: slot,
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: ratings.pos,
			tid: p.tid,
			classYear: getClassYear(p),
			age: season - p.born.year,
			ovr: ratings.ovr,
			pot: ratings.pot,
		});
		drafted.set(p.pid, slot);
	}

	const userTexts: string[] = [];
	let graduated = 0;
	for (const p of players) {
		const pick = drafted.get(p.pid);
		const senior = getClassYear(p) >= COLLEGE_ELIGIBILITY_YEARS;
		if (pick === undefined && !senior) {
			continue;
		}
		const tid = p.tid;
		let text;
		if (pick !== undefined) {
			text = `${playerLink(p)} (${classYearAbbrev(getClassYear(p))}, ${teamLink(tid)}) was selected with pick ${pick} of the <a href="${helpers.leagueUrl(["college_departures", season])}">pro draft</a>.`;
		} else {
			graduated += 1;
			text = `${playerLink(p)} graduated from ${teamLink(tid)}.`;
		}
		if (tid === userTid) {
			userTexts.push(
				pick !== undefined
					? `${playerLink(p)} was drafted (pick ${pick})`
					: `${playerLink(p)} graduated`,
			);
		}
		const draftedPick = pick;
		await leaveSchool(
			p,
			{
				season,
				type: draftedPick !== undefined ? "pro" : "graduated",
				...(draftedPick !== undefined ? { pick: draftedPick } : {}),
				tid,
			},
			text,
			conditions,
		);
	}

	if (userTexts.length > 0 && !g.get("spectator")) {
		logEvent(
			{
				type: "retiredList",
				text: `<b>Leaving your program</b><br>${userTexts.join("<br>")}`,
				showNotification: !local.autoPlayUntil,
				pids: [],
				tids: [userTid],
				saveToDb: false,
			},
			conditions,
		);
	}

	await updateCollegeArchive({ proDraft: picks, graduated });
};

// ---- Transfer portal ----

export const seasonMinutes = (p: CollegePlayer, season: number) => {
	let min = 0;
	let gp = 0;
	for (const row of p.stats) {
		if (row.season === season && !row.playoffs) {
			min += row.min ?? 0;
			gp += row.gp ?? 0;
		}
	}
	return { min, gp };
};

/**
 * The automatic transfer portal: players buried on the bench leave for minutes, a few good players at small programs move up. Entering
 * the Transfer portal phase.
 */
export const doTransferPortal = async (conditions: Conditions) => {
	const season = g.get("season");
	const userTid = g.get("userTid");
	const teams = await getActiveTeams();
	const prestige = new Map(
		teams.map((t) => [t.tid, getTeamPrestige(t as any)]),
	);
	const rosters = await getRosters();
	const numGames = g.get("numGames");

	const allOvrs = [...rosters.values()]
		.flat()
		.map((p) => last(p.ratings).ovr)
		.sort((a, b) => b - a);
	const topOvr = allOvrs[Math.floor(allOvrs.length * 0.08)] ?? 99;

	type Entry = { p: CollegePlayer; from: number; up: boolean };
	const portal: Entry[] = [];
	for (const t of teams) {
		const roster = [...(rosters.get(t.tid) ?? [])].sort(
			(a, b) => last(b.ratings).ovr - last(a.ratings).ovr,
		);
		let left = 0;
		for (const [i, p] of roster.entries()) {
			if (left >= 3 || roster.length - left <= 6) {
				break;
			}
			const classYear = getClassYear(p);
			if (classYear >= COLLEGE_ELIGIBILITY_YEARS || classYear < 1) {
				continue;
			}
			const { min } = seasonMinutes(p, season);
			const mpg = min / Math.max(1, numGames);
			const buried = i >= 8 && mpg < 8;
			const up =
				i < 2 &&
				last(p.ratings).ovr >= topOvr &&
				prestige.get(t.tid)! < 70 &&
				mpg > 20;
			if ((buried && Math.random() < 0.3) || (up && Math.random() < 0.25)) {
				portal.push({ p, from: t.tid, up });
				left += 1;
			}
		}
	}

	// Best players choose first
	portal.sort((a, b) => last(b.p.ratings).ovr - last(a.p.ratings).ovr);
	const size = new Map(
		teams.map((t) => [t.tid, (rosters.get(t.tid) ?? []).length]),
	);

	const transfers: CollegeDeparture[] = [];
	const userTexts: string[] = [];
	for (const { p, from, up } of portal) {
		const ovr = last(p.ratings).ovr;
		let best: { tid: number; score: number } | undefined;
		for (const t of teams) {
			if (t.tid === from || size.get(t.tid)! >= COLLEGE_SCHOLARSHIPS) {
				continue;
			}
			const roster = (rosters.get(t.tid) ?? []).filter(
				(p2) => p2.tid === t.tid,
			);
			const better = roster.filter((p2) => last(p2.ratings).ovr > ovr).length;
			// He goes where he would play
			if (better > (up ? 4 : 6)) {
				continue;
			}
			const pres = prestige.get(t.tid)!;
			if (up && pres < prestige.get(from)! + 5) {
				continue;
			}
			const score = pres - 2 * better + realGauss(0, 6);
			if (!best || score > best.score) {
				best = { tid: t.tid, score };
			}
		}
		if (!best) {
			// Nobody had a spot where he would play: he stays
			continue;
		}
		const to = best.tid;
		// His spot only opens once he has somewhere to go
		size.set(from, size.get(from)! - 1);
		size.set(to, size.get(to)! + 1);
		const ratings = last(p.ratings);
		transfers.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: ratings.pos,
			tid: from,
			classYear: getClassYear(p),
			ovr: ratings.ovr,
			toTid: to,
		});

		p.tid = to;
		p.gamesUntilTradable = 0;
		if (!p.transactions) {
			p.transactions = [];
		}
		const eid = await logEvent(
			{
				type: "freeAgent",
				text: `${playerLink(p)} (${ratings.pos}, ${classYearAbbrev(getClassYear(p))}) transferred from ${teamLink(from)} to ${teamLink(to)}.`,
				showNotification: false,
				pids: [p.pid],
				tids: [to],
				score: 5,
			},
			conditions,
		);
		p.transactions.push({
			season,
			phase: g.get("phase"),
			tid: to,
			type: "freeAgent",
			eid,
		});
		player.setJerseyNumber(p, await player.genJerseyNumber(p));
		await idb.cache.players.put(p);
		// Keep the roster lists current for the players who choose after him
		rosters.get(to)?.push(p);

		if (from === userTid) {
			userTexts.push(`${playerLink(p)} transferred to ${teamLink(to)}`);
		} else if (to === userTid) {
			userTexts.push(`${playerLink(p)} transferred in from ${teamLink(from)}`);
		}
	}

	if (userTexts.length > 0 && !g.get("spectator")) {
		logEvent(
			{
				type: "info",
				text: `<b>Transfer portal</b><br>${userTexts.join("<br>")}`,
				showNotification: !local.autoPlayUntil,
				saveToDb: false,
			},
			conditions,
		);
	}

	await updateCollegeArchive({ transfers });
};

// ---- Recruiting ----

/**
 * A class of high school seniors who sign at the end of the current season. Not saved: tid is PLAYER.UNDRAFTED and draft.year the current
 * season.
 */
export const genRecruitingClass = async (
	numRecruits: number,
	numTeams: number,
) => {
	const share = getTalentShare(numTeams);
	const recruits: PlayerWithoutKey[] = [];
	for (let i = 0; i < numRecruits; i++) {
		const p = await genCollegePlayer({
			tid: PLAYER.UNDRAFTED,
			quantile: ((i + Math.random()) / numRecruits) * share,
			yearsInCollege: 0,
		});
		recruits.push(p);
	}
	// The recruiting services see most of what a player is, not all of it
	const scored = recruits
		.map((p) => ({ p, score: recruitScore(p) + realGauss(0, 1.5) }))
		.sort((a, b) => b.score - a.score);
	const posRanks: Record<string, number> = {};
	const numNational = numRecruits / share;
	for (const [i, { p }] of scored.entries()) {
		const pos = last(p.ratings).pos;
		posRanks[pos] = (posRanks[pos] ?? 0) + 1;
		const recruit: PlayerRecruit = {
			stars: starsFromQuantile((i + 0.5) / numNational),
			rank: i + 1,
			posRank: posRanks[pos],
			state: p.born.loc,
		};
		(p as any).recruit = recruit;
		(p as any).classYear = 0;
	}
	return scored.map((row) => row.p);
};

export const getRecruitingClassSize = (
	numTeams: number,
	numSeniors?: number,
) => {
	// Seniors, early entrants and a margin, so the last schools still have someone to sign
	const leaving = numSeniors ?? Math.round(numTeams * 3.2);
	return (
		leaving +
		Math.round(getNumProDraftPicks(numTeams) * 0.6) +
		Math.round(numTeams * 0.5)
	);
};

/**
 * Generate and save next year's recruiting class (preseason), unless there already is one.
 */
export const addRecruitingClass = async () => {
	const season = g.get("season");
	const existing = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter((p) => p.draft.year === season);
	if (existing.length > 0) {
		return;
	}
	const teams = await getActiveTeams();
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	const numSeniors = players.filter(
		(p) => getClassYear(p) >= COLLEGE_ELIGIBILITY_YEARS,
	).length;
	const recruits = await genRecruitingClass(
		getRecruitingClassSize(teams.length, numSeniors),
		teams.length,
	);
	for (const p of recruits) {
		await player.updateValues(p);
		await idb.cache.players.add(p as any);
	}
};

export const getRecruits = async () =>
	(
		(await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		)) as CollegePlayer[]
	)
		.filter((p) => p.draft.year === g.get("season") && p.recruit)
		.sort((a, b) => a.recruit!.rank - b.recruit!.rank);

// What a school's interest is worth to a recruit, before luck: prestige and how much it needs his position
export const schoolScore = (pres: number, counts: number[], pos: string) => {
	const group = posGroup(pos);
	const need = IDEAL_BY_GROUP[group]! - counts[group]!;
	return pres + 2.5 * helpers.bound(need, -2, 3);
};

// Interest bonus for the user's targets: the staff's attention. The first targets get more of it
export const targetBonus = (priority: number, openings: number) => {
	if (priority > Math.max(3, openings * 3)) {
		return 0;
	}
	return priority <= Math.max(1, openings) ? 7 : 4;
};

/**
 * The user's recruiting board: every recruit of the class with how interested he is in the user's school (the prestige of the school he
 * would otherwise expect to sign with against the user's).
 */
export const getRecruitingBoard = async () => {
	const userTid = g.get("userTid");
	const teams = await getActiveTeams();
	const rosters = await getRosters();
	const recruits = await getRecruits();

	// The schools' open scholarships once this year's seniors are gone, best programs first: where the n-th best recruit would land
	const slots: number[] = [];
	let userOpenings = 0;
	for (const t of teams) {
		const roster = rosters.get(t.tid) ?? [];
		const staying = roster.filter(
			(p) =>
				getClassYear(p) < COLLEGE_ELIGIBILITY_YEARS ||
				g.get("phase") >= PHASE.DRAFT,
		).length;
		const openings = Math.max(0, COLLEGE_SCHOLARSHIPS - staying);
		if (t.tid === userTid) {
			userOpenings = openings;
		}
		for (let i = 0; i < openings; i++) {
			slots.push(getTeamPrestige(t as any));
		}
	}
	slots.sort((a, b) => b - a);

	const userTeam = teams.find((t) => t.tid === userTid);
	const userPrestige = userTeam ? getTeamPrestige(userTeam as any) : 60;
	const counts = groupCounts(
		(rosters.get(userTid) ?? []).filter(
			(p) =>
				getClassYear(p) < COLLEGE_ELIGIBILITY_YEARS ||
				g.get("phase") >= PHASE.DRAFT,
		),
	);

	const board = recruits.map((p, i) => {
		const expected = slots[Math.min(i, slots.length - 1)] ?? 50;
		const ratings = last(p.ratings);
		const diff = schoolScore(userPrestige, counts, ratings.pos) - expected;
		return {
			p,
			expected,
			// With the bonus of a top target
			interest: diff + 7,
		};
	});

	return { board, userOpenings, userPrestige };
};

export const interestLabel = (interest: number) =>
	interest >= 6
		? "Very high"
		: interest >= 1
			? "High"
			: interest >= -4
				? "Medium"
				: interest >= -10
					? "Low"
					: "None";

/**
 * Pick the user's targets automatically: for each open scholarship, the best recruits who are realistically interested.
 */
export const autoSetTargets = async () => {
	const { board, userOpenings } = await getRecruitingBoard();
	const max = Math.max(3, userOpenings * 3);
	let priority = 0;
	for (const row of board) {
		const recruit = row.p.recruit!;
		const wanted = priority < max && row.interest >= -2;
		const newTarget = wanted ? ++priority : undefined;
		if (recruit.userTarget !== newTarget) {
			if (newTarget === undefined) {
				delete recruit.userTarget;
			} else {
				recruit.userTarget = newTarget;
			}
			await idb.cache.players.put(row.p);
		}
	}
};

export const enroll = async (p: CollegePlayer, tid: number) => {
	p.tid = tid;
	p.classYear = 0;
	p.draft.tid = -1;
	p.draft.originalTid = -1;
	p.draft.round = 0;
	p.draft.pick = 0;
	// He starts next season: the contract (eligibility) runs four seasons from then
	const contract = {
		amount: g.get("minContract"),
		exp: g.get("season") + COLLEGE_ELIGIBILITY_YEARS,
	};
	p.contracts = [];
	p.contractDemand = { ...contract };
	addContract(p, createContract({ contract, type: "freeAgent" }));
	p.draft.year = g.get("season");
	p.recruit = {
		...(p.recruit ?? { stars: 2, rank: 9999, posRank: 999, state: p.born.loc }),
		committed: tid,
		season: g.get("season"),
	};
	player.setJerseyNumber(p, await player.genJerseyNumber(p));
};

/**
 * Signing day: every recruit, best first, signs with the school he likes best among those with an open scholarship. Then walk-ons fill
 * what is left and the unsigned recruits are removed. Entering the Signing day phase.
 */
export const doSigningDay = async (conditions: Conditions) => {
	const season = g.get("season");
	const userTid = g.get("userTid");
	const spectator = g.get("spectator");
	const auto =
		g.get("collegeAutoRecruit") || spectator || !!local.autoPlayUntil;
	if (auto && !spectator) {
		await autoSetTargets();
	}

	const teams = await getActiveTeams();
	const rosters = await getRosters();
	const recruits = await getRecruits();

	const info = new Map(
		teams.map((t) => {
			const roster = rosters.get(t.tid) ?? [];
			return [
				t.tid,
				{
					prestige: getTeamPrestige(t as any),
					openings: Math.max(0, COLLEGE_SCHOLARSHIPS - roster.length),
					counts: groupCounts(roster),
				},
			];
		}),
	);
	const userOpenings = info.get(userTid)?.openings ?? 0;

	// Recruiting v2: verbal commitments and offers first
	const openingsLeft = new Map(
		[...info.entries()].map(([tid, row]) => [tid, row.openings]),
	);
	const v2Signed = await signCommitted(openingsLeft);

	const commits: CollegeCommit[] = [];
	const userCommits: CollegeCommit[] = [];
	const signed = new Set<number>();

	const sign = async (p: CollegePlayer, tid: number) => {
		const row = info.get(tid)!;
		row.openings -= 1;
		const ratings = last(p.ratings);
		row.counts[posGroup(ratings.pos)]! += 1;
		await enroll(p, tid);
		signed.add(p.pid);
		const commit: CollegeCommit = {
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: ratings.pos,
			tid,
			stars: p.recruit!.stars,
			rank: p.recruit!.rank,
			state: p.recruit!.state,
			ovr: ratings.ovr,
			pot: ratings.pot,
		};
		commits.push(commit);
		if (tid === userTid) {
			userCommits.push(commit);
		}
		const notable = p.recruit!.stars >= 4;
		if (notable || tid === userTid) {
			logEvent(
				{
					type: "freeAgent",
					text: `${"★".repeat(p.recruit!.stars)} ${ratings.pos} ${playerLink(p)} (No. ${p.recruit!.rank}, ${p.recruit!.state}) signed with ${teamLink(tid)}.`,
					showNotification: false,
					pids: [p.pid],
					tids: [tid],
					score: p.recruit!.stars >= 5 ? 10 : 5,
				},
				conditions,
			);
		}
		await idb.cache.players.put(p);
	};

	for (const p of recruits) {
		const tid = v2Signed.get(p.pid);
		if (tid !== undefined) {
			await sign(p, tid);
		}
	}

	// Two passes: first the user's school only gets its targets (unless auto mode already picked them), then whoever is left looks at
	// every school with a spot
	for (const pass of [0, 1]) {
		for (const p of recruits) {
			if (signed.has(p.pid)) {
				continue;
			}
			const pos = last(p.ratings).pos;
			let best: { tid: number; score: number } | undefined;
			for (const t of teams) {
				const row = info.get(t.tid)!;
				if (row.openings <= 0) {
					continue;
				}
				let score = schoolScore(row.prestige, row.counts, pos);
				if (t.tid === userTid && !spectator) {
					const priority = p.recruit!.userTarget;
					if (priority === undefined) {
						if (pass === 0) {
							continue;
						}
					} else {
						score += targetBonus(priority, userOpenings);
					}
				}
				score += realGauss(0, 5);
				if (!best || score > best.score) {
					best = { tid: t.tid, score };
				}
			}
			if (best) {
				await sign(p, best.tid);
			}
		}
	}

	// Walk-ons for the schools that still have room
	let walkOns = 0;
	for (const t of teams) {
		const row = info.get(t.tid)!;
		while (row.openings > 0) {
			const p = (await genCollegePlayer({
				tid: t.tid,
				quantile: 0.9 + 0.1 * Math.random(),
				yearsInCollege: 0,
				extraShift: -3,
			})) as CollegePlayer;
			p.recruit = {
				stars: 2,
				rank: recruits.length + ++walkOns,
				posRank: 0,
				state: p.born.loc,
				walkOn: true,
			};
			await enroll(p, t.tid);
			await player.updateValues(p);
			await idb.cache.players.add(p as any);
			row.openings -= 1;
		}
	}

	// The rest of the class does not play Division I
	const unsigned = recruits.filter((p) => !signed.has(p.pid)).map((p) => p.pid);
	await player.remove(unsigned);

	for (const t of teams) {
		await team.rosterAutoSort(t.tid);
	}

	if (!spectator) {
		const lines = userCommits
			.sort((a, b) => a.rank - b.rank)
			.map(
				(c) =>
					`${"★".repeat(c.stars)} ${c.pos} <a href="${helpers.leagueUrl(["player", c.pid])}">${c.name}</a> (No. ${c.rank})`,
			);
		logEvent(
			{
				type: "info",
				text: `<b>Signing day</b><br>${
					lines.length > 0
						? lines.join("<br>")
						: "No recruit signed with your program."
				}`,
				showNotification: !local.autoPlayUntil,
				saveToDb: false,
			},
			conditions,
		);
	}

	await updateCollegeArchive({
		commits: commits.filter(
			(c) => c.stars >= 4 || c.tid === userTid || c.rank <= 150,
		),
		classRankings: getClassRankings(commits),
	});
	return season;
};

const STAR_POINTS = [0, 0, 10, 30, 60, 100];

/**
 * Recruiting class rankings: points for every recruit by stars, a little more for the best ranked ones.
 */
export const getClassRankings = (
	commits: CollegeCommit[],
): CollegeClassRanking[] => {
	const byTid = new Map<number, CollegeClassRanking>();
	for (const c of commits) {
		let row = byTid.get(c.tid);
		if (!row) {
			row = { tid: c.tid, rank: 0, points: 0, count: 0, stars: [0, 0, 0] };
			byTid.set(c.tid, row);
		}
		row.points += STAR_POINTS[c.stars] ?? 0;
		row.points += Math.max(0, 20 - c.rank / 25);
		row.count += 1;
		if (c.stars >= 3) {
			row.stars[5 - c.stars]! += 1;
		}
	}
	const rows = [...byTid.values()].sort((a, b) => b.points - a.points);
	for (const [i, row] of rows.entries()) {
		row.rank = i + 1;
		row.points = Math.round(row.points);
	}
	return rows;
};

// ---- Preseason ----

/**
 * Start of a new season, after the players developed: class years advance (recruits become freshmen), prestige follows last season, and
 * next year's recruiting class is generated.
 */
export const onPreseason = async () => {
	const season = g.get("season");
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	for (const p of players) {
		// Redshirt last season: the year did not count
		if ((p as any).redshirt === season - 1 && p.classYear !== undefined) {
			continue;
		}
		p.classYear = helpers.bound(
			(p.classYear ?? season - 1 - p.draft.year) + 1,
			1,
			COLLEGE_ELIGIBILITY_YEARS,
		);
		await idb.cache.players.put(p);
	}

	await updatePrestige();
	await addRecruitingClass();
};

// Prestige follows results slowly: a great season is worth a couple of points, and every program drifts back toward where it started
const updatePrestige = async () => {
	const season = g.get("season") - 1;
	const teams = await getActiveTeams();
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	if (teamSeasons.length === 0) {
		return;
	}
	const numRounds = g.get("numGamesPlayoffSeries", "current").length;
	const bySeason = new Map(teamSeasons.map((ts) => [ts.tid, ts]));
	for (const t of teams) {
		const ts = bySeason.get(t.tid);
		if (!ts) {
			continue;
		}
		const gp = ts.won + ts.lost;
		if (gp === 0) {
			continue;
		}
		const current = getTeamPrestige(t as any);
		const base = (t as any).collegePrestigeBase ?? current;
		const winp = ts.won / gp;
		let delta = 6 * (winp - 0.5);
		if (ts.playoffRoundsWon >= 0) {
			delta += 0.5 + (2.5 * ts.playoffRoundsWon) / Math.max(1, numRounds);
		}
		// What this prestige already expects
		delta -= (current - 70) / 12;
		delta += 0.08 * (base - current);
		(t as any).collegePrestigeBase = base;
		(t as any).collegePrestige =
			Math.round(helpers.bound(current + delta, 35, 100) * 10) / 10;
		await idb.cache.teams.put(t);
	}
};

// ---- Expectations (the user's job security) ----

/**
 * How the season went against what the program's prestige predicts, as the "wins" and "playoffs" parts of the owner mood.
 */
export const getExpectationDeltas = async ({
	won,
	lost,
	playoffRoundsWon,
}: {
	won: number;
	lost: number;
	playoffRoundsWon: number;
}) => {
	const userTid = g.get("userTid");
	const teams = await getActiveTeams();
	const { pct, expectedWinp } = (await getExpectations()).get(userTid) ?? {
		pct: 0.5,
		expectedWinp: 0.525,
	};
	const gp = won + lost;
	const winp = gp > 0 ? won / gp : 0.5;

	const numRounds = g.get("numGamesPlayoffSeries", "current").length;
	const fieldShare = getCollegeTournamentSize(teams.length) / teams.length;
	const expectedIn = pct > 1 - 0.8 * fieldShare;

	let playoffs;
	if (playoffRoundsWon < 0) {
		playoffs = expectedIn ? -0.2 : -0.02;
	} else if (playoffRoundsWon < numRounds) {
		playoffs = (expectedIn ? 0 : 0.1) + (0.16 / numRounds) * playoffRoundsWon;
	} else {
		playoffs = 0.25;
	}
	return {
		wins: 0.6 * (winp - expectedWinp),
		playoffs,
	};
};
