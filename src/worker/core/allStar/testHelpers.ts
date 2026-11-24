// Invariant and quality checks for All-Star selection, shared by allStar.test.ts (mock leagues) and selection.script.test.ts
// (real leagues played to the All-Star break). Test-only.
import type { AllStarPlayer, AllStars } from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { isEligible } from "./create.ts";
import { courtOf } from "./weekend.ts";

// Everyone named an All-Star this season: both teams, the tournament's four teams and the ones left out (injured, undrafted)
export const allEntries = (allStars: AllStars) => {
	const entries: AllStarPlayer[] = [
		...allStars.teams[0],
		...allStars.teams[1],
		...allStars.remaining,
	];
	if (allStars.tournament) {
		entries.push(...allStars.tournament.teams.flat());
	}
	return entries;
};

const tourneyBeforeSemis = (allStars: AllStars) =>
	allStars.tournament !== undefined &&
	allStars.tournament.semis.some((semi) => semi.winner === undefined);

// The players who would play: on a team (or in the draft pool, or a tournament team), not listed as injured
export const playingEntries = (allStars: AllStars) => {
	const sides = tourneyBeforeSemis(allStars)
		? allStars.tournament!.teams
		: allStars.teams;
	return [...sides.flat(), ...allStars.remaining.filter((p) => !p.injured)];
};

// Problems with a selection (empty if none). stage "selection": right after create; "game": after prepareGame, before the
// game is played; "final": after the game (when an All-Star may have been hurt in it)
export const checkInvariants = async (
	allStars: AllStars,
	stage: "selection" | "game" | "final",
) => {
	const problems: string[] = [];
	const season = g.get("season");
	const allStarNum = g.get("allStarNum");

	// No duplicates on the teams (a tournament's four teams hold the same players as teams 0/1 after the semis, so not both)
	const sides = tourneyBeforeSemis(allStars)
		? allStars.tournament!.teams
		: allStars.teams;
	const seen = new Set<number>();
	for (const p of [...sides.flat(), ...allStars.remaining]) {
		if (seen.has(p.pid)) {
			problems.push(`duplicate pid ${p.pid}`);
		}
		seen.add(p.pid);
	}

	// Everyone who'd play is eligible, healthy and listed with his current team
	for (const entry of playingEntries(allStars)) {
		const p = await idb.cache.players.get(entry.pid);
		if (!p) {
			problems.push(`missing player ${entry.pid}`);
			continue;
		}
		if (!isEligible(p)) {
			problems.push(`ineligible player ${entry.pid} (tid ${p.tid})`);
		}
		if (p.injury.gamesRemaining > 0 && stage !== "final") {
			problems.push(`injured player ${entry.pid} would play`);
		}
		if (p.tid !== entry.tid) {
			problems.push(
				`player ${entry.pid} listed with tid ${entry.tid}, on ${p.tid}`,
			);
		}
	}

	// Team sizes: allStarNum a side when the league has enough healthy candidates, else within one of each other (and the
	// game is called off before it's played if a side can't field a lineup)
	const numHealthyCandidates = (
		await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
	).filter((p) => isEligible(p) && p.injury.gamesRemaining === 0).length;
	const numPlaying = playingEntries(allStars).length;
	const expected = Math.min(2 * allStarNum, numHealthyCandidates);
	if (stage === "selection" && numPlaying !== expected) {
		problems.push(`${numPlaying} playing All-Stars, expected ${expected}`);
	}
	if (
		stage === "game" &&
		(!allStars.tournament || tourneyBeforeSemis(allStars)) &&
		numPlaying < expected &&
		numPlaying < numHealthyCandidates
	) {
		problems.push(
			`${numPlaying} playing All-Stars after replacements, expected ${expected}`,
		);
	}
	if (allStars.type === "byConf" || allStars.type === "top") {
		const [a, b] = allStars.teams.map((t) => t.length);
		if (
			numPlaying >= 2 * allStarNum &&
			(a !== allStarNum || b !== allStarNum)
		) {
			problems.push(`team sizes ${a}/${b}, expected ${allStarNum}`);
		}
		if (Math.abs(a! - b!) > 1 && allStars.type === "top") {
			problems.push(`uneven teams ${a}/${b}`);
		}
	}

	// East vs West: each team from its own conference when picked (an All-Star traded across conferences later still plays
	// for the side he was picked to, under his new team's label, prepareGame.ts)
	if (allStars.type === "byConf" && stage === "selection") {
		const confs = orderBy(g.get("confs"), "cid", "asc");
		const cidByTid = new Map(
			(await idb.cache.teams.getAll()).map((t) => [t.tid, t.cid]),
		);
		for (const [i, team] of allStars.teams.entries()) {
			for (const p of team) {
				if (cidByTid.get(p.tid) !== confs[i]?.cid) {
					problems.push(
						`player ${p.pid} on team ${i} is from conference ${cidByTid.get(p.tid)}`,
					);
				}
			}
		}
	}

	// Awards: one All-Star award per All-Star, nobody else
	const named = new Set(allEntries(allStars).map((p) => p.pid));
	const players = await idb.cache.players.getAll();
	for (const p of players) {
		const n = p.awards.filter(
			(a) => a.type === "All-Star" && a.season === season,
		).length;
		if (n > 1) {
			problems.push(`player ${p.pid} has ${n} All-Star awards`);
		}
		if (n === 1 && !named.has(p.pid)) {
			problems.push(
				`player ${p.pid} has an All-Star award but isn't an All-Star`,
			);
		}
		if (n === 0 && named.has(p.pid)) {
			problems.push(`All-Star ${p.pid} has no award`);
		}
	}

	return problems;
};

// Quality of a basketball selection: how many of the league's best (by value, 2.5 x EWA + WS, among healthy candidates who
// played enough) made it, the worst pick's rank, games and minutes, and the court balance
export const qualityReport = async (allStars: AllStars) => {
	const season = g.get("season");
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	const teamGp = new Map(
		teamSeasons.map((ts) => [
			ts.tid,
			ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0),
		]),
	);
	const maxTeamGp = Math.max(0, ...teamGp.values());
	const rows = [];
	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) {
		if (!isEligible(p) || p.injury.gamesRemaining > 0) {
			continue;
		}
		let gp = 0;
		let min = 0;
		let value = 0;
		let numTeams = 0;
		for (const row of p.stats) {
			if (row.season === season && !row.playoffs) {
				gp += row.gp ?? 0;
				min += row.min ?? 0;
				value += 2.5 * (row.ewa ?? 0) + (row.ows ?? 0) + (row.dws ?? 0);
				numTeams += 1;
			}
		}
		rows.push({
			pid: p.pid,
			tid: p.tid,
			gp,
			mpg: gp > 0 ? min / gp : 0,
			value,
			rate: gp > 0 ? value / gp : 0,
			court: courtOf(p.ratings.at(-1)!.pos),
			numTeams,
			teamGp: teamGp.get(p.tid) ?? 0,
		});
	}
	const byValue = orderBy(rows, ["value", "pid"], ["desc", "asc"]);
	const rankOf = new Map(byValue.map((r, i) => [r.pid, i + 1]));
	const selectedPids = new Set(playingEntries(allStars).map((p) => p.pid));
	const selected = rows.filter((r) => selectedPids.has(r.pid));
	const share = (n: number) =>
		byValue.slice(0, n).filter((r) => selectedPids.has(r.pid)).length /
		Math.max(1, Math.min(n, byValue.length));
	// Elite by rate: the best value per game among players with 40% of the most team games
	const byRate = orderBy(
		rows.filter((r) => r.gp >= 0.4 * maxTeamGp && r.gp > 0),
		["rate", "pid"],
		["desc", "asc"],
	);
	return {
		numSelected: selected.length,
		top10Share: share(10),
		top24Share: share(24),
		worstValueRank: Math.max(0, ...selected.map((r) => rankOf.get(r.pid)!)),
		minGpShare: Math.min(
			1,
			...selected.map((r) => (maxTeamGp > 0 ? r.gp / maxTeamGp : 1)),
		),
		minMpg: Math.min(99, ...selected.map((r) => r.mpg)),
		minTeamGpShare: Math.min(
			1,
			...selected.map((r) => (maxTeamGp > 0 ? r.teamGp / maxTeamGp : 1)),
		),
		backcourt: selected.filter((r) => r.court === "backcourt").length,
		frontcourt: selected.filter((r) => r.court === "frontcourt").length,
		traded: selected.filter((r) => r.numTeams > 1).length,
		top5RateMissing: byRate.slice(0, 5).filter((r) => !selectedPids.has(r.pid))
			.length,
		maxTeamGp,
	};
};
