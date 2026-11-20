// League Eras (League Extra "leagueEras", docs/native-features.md). Once a season is over, the game-style settings (ERA_KEYS) take a
// small step of a bounded random walk on a log scale, pulled back toward the league's baseline style (mean reversion) and nudged toward
// what the best teams did that season. Now and then the league office also puts a rule change to a vote. The season's style, its era
// name and any vote are kept on the season's awards row (key "era") for the League Eras page.
//
// Randomness comes from its own seeded stream (Rng, keyed by the season and the league salt), never Math.random, so turning the
// feature on or off doesn't shift the main random stream and a league replays the same eras.
import { PHASE } from "../../../common/constants.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import {
	ERA_KEYS,
	eraLabel,
	type EraKey,
	type EraRecord,
	type EraValues,
	type RuleProposalType,
	type RuleVote,
} from "../../../common/leagueEras.ts";
import type { Conditions, DraftType } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { league, team } from "../index.ts";
import * as college from "../college/index.ts";

// Per key: mean reversion per season, step size and the farthest the style can get from the baseline (all on a log scale)
const WALK: Record<EraKey, { revert: number; step: number; bound: number }> = {
	threePointTendencyFactor: { revert: 0.12, step: 0.035, bound: 0.4 },
	pace: { revert: 0.15, step: 0.012, bound: 0.08 },
	foulRateFactor: { revert: 0.2, step: 0.03, bound: 0.2 },
	orbFactor: { revert: 0.2, step: 0.03, bound: 0.2 },
};

// What won: how much the best teams' style pulls the league (log step per unit of relative difference, and its cap)
const WINNERS_PULL = 0.5;
const WINNERS_PULL_MAX = 0.03;

// A rule-change vote: chance when a trigger fires, and never within this many seasons of the last one
const VOTE_PROB = 0.35;
const VOTE_GAP = 3;

// Flatter lottery odds, one step at a time
const LOTTERY_REFORM: Partial<Record<DraftType, DraftType>> = {
	nba1990: "nba1994",
	nba1994: "nba2019",
	nba2019: "nba2027",
};

const MAX_LUXURY_TAX = 3;

const readValues = (): EraValues => {
	const out = {} as EraValues;
	for (const key of ERA_KEYS) {
		out[key] = g.get(key);
	}
	return out;
};

const roundValue = (key: EraKey, value: number) =>
	key === "pace"
		? Math.round(value * 10) / 10
		: Math.round(value * 1000) / 1000;

export const getEraRecord = async (
	season: number,
): Promise<EraRecord | undefined> => {
	const awards = (await idb.merged.awards.get(season)) as any;
	return awards?.era;
};

// Era keys a scheduled event (a real-player league's history) still sets: the drift leaves them alone until the real data runs out
const scheduledEraKeys = async () => {
	const keys = new Set<EraKey>();
	for (const event of await idb.merged.scheduledEvents.getAll()) {
		if (event.type === "gameAttributes") {
			for (const key of ERA_KEYS) {
				if (Object.hasOwn(event.info, key)) {
					keys.add(key);
				}
			}
		}
	}
	return keys;
};

type TeamRow = {
	tid: number;
	winp: number;
	tpShare: number;
	poss: number;
	champ: boolean;
	payroll: number;
};

const getTeamRows = async (season: number): Promise<TeamRow[]> => {
	const numRounds = g.get("numGamesPlayoffSeries", season).length;
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	const stats = (
		await idb.cache.teamStats.indexGetAll("teamStatsByPlayoffsTid", [
			[false],
			[false, "Z"],
		])
	).filter((row) => row.season === season);
	const rows: TeamRow[] = [];
	for (const ts of teamSeasons) {
		const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
		const st = stats.find((row) => row.tid === ts.tid);
		if (gp === 0 || !st || st.gp === 0) {
			continue;
		}
		const fga = st.fga ?? 0;
		rows.push({
			tid: ts.tid,
			winp: (ts.won + 0.5 * (ts.tied ?? 0)) / gp,
			tpShare: fga > 0 ? (st.tpa ?? 0) / fga : 0,
			poss:
				(fga - (st.orb ?? 0) + (st.tov ?? 0) + 0.44 * (st.fta ?? 0)) / st.gp,
			champ: numRounds > 0 && ts.playoffRoundsWon >= numRounds,
			payroll: await team.getPayroll(ts.tid),
		});
	}
	return rows;
};

const mean = (xs: number[]) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

// Relative difference between the top quarter of the league (by win%) and the whole league
const winnersEdge = (rows: TeamRow[], get: (row: TeamRow) => number) => {
	const leagueAvg = mean(rows.map(get));
	if (rows.length < 4 || leagueAvg <= 0) {
		return 0;
	}
	const top = [...rows]
		.sort((a, b) => b.winp - a.winp)
		.slice(0, Math.max(1, Math.round(rows.length / 4)));
	return mean(top.map(get)) / leagueAvg - 1;
};

type Proposal = {
	type: RuleProposalType;
	title: string;
	reason: string;
	// Chance an AI team votes yes, by team
	yesProb: (row: TeamRow) => number;
	apply: () => void | Promise<void>;
};

const getProposals = (
	season: number,
	rows: TeamRow[],
	tpShare: number,
	next: EraValues,
	baseline: EraValues,
): Proposal[] => {
	const out: Proposal[] = [];

	// Heavy tanking: flatter lottery odds, from next season's draft on
	const draftType = g.get("draftType");
	const reformed = LOTTERY_REFORM[draftType];
	const tankers = rows.filter((row) => row.winp < 0.3).length;
	if (reformed && tankers >= Math.max(3, Math.round(rows.length / 8))) {
		out.push({
			type: "lottery",
			title: "Draft lottery reform (flatter odds)",
			reason: `${tankers} teams won fewer than 30% of their games`,
			yesProb: (row) => (row.winp < 0.4 ? 0.3 : 0.85),
			apply: async () => {
				await idb.cache.scheduledEvents.add({
					type: "gameAttributes",
					season: season + 1,
					phase: PHASE.PRESEASON,
					info: { draftType: reformed },
				} as any);
			},
		});
	}

	// Superteam: the champion or a dominant team paying the tax
	const luxuryPayroll = g.get("luxuryPayroll");
	const luxuryTax = g.get("luxuryTax");
	const superteam = rows.find(
		(row) => row.payroll > luxuryPayroll && (row.champ || row.winp >= 0.75),
	);
	if (superteam && luxuryTax < MAX_LUXURY_TAX) {
		const newTax = Math.min(
			MAX_LUXURY_TAX,
			Math.round((luxuryTax + 0.25) * 100) / 100,
		);
		out.push({
			type: "tax",
			title: `Stricter luxury tax (rate ${luxuryTax} → ${newTax})`,
			reason: `the ${g.get("teamInfoCache")[superteam.tid]?.region ?? "top team"} ${superteam.champ ? "won the title" : "dominated"} while paying the luxury tax`,
			yesProb: (row) => (row.payroll > luxuryPayroll ? 0.15 : 0.8),
			apply: async () => {
				await league.setGameAttributes({ luxuryTax: newTax });
			},
		});
	}

	// Three-point share far from normal: move the line (the style's baseline moves with it, so the drift doesn't undo it)
	if (g.get("threePointers") && rows.length > 0) {
		const moveLine = (factor: number) => () => {
			next.threePointTendencyFactor = roundValue(
				"threePointTendencyFactor",
				next.threePointTendencyFactor * factor,
			);
			baseline.threePointTendencyFactor = roundValue(
				"threePointTendencyFactor",
				baseline.threePointTendencyFactor * factor,
			);
		};
		if (tpShare > 0.47) {
			out.push({
				type: "threesDown",
				title: "Move the three-point line back",
				reason: `${Math.round(tpShare * 100)}% of shots were threes`,
				yesProb: () => 0.7,
				apply: moveLine(0.92),
			});
		} else if (tpShare < 0.22) {
			out.push({
				type: "threesUp",
				title: "Move the three-point line in",
				reason: `only ${Math.round(tpShare * 100)}% of shots were threes`,
				yesProb: () => 0.7,
				apply: moveLine(1.08),
			});
		}
	}

	return out;
};

const runVote = async (
	rng: Rng,
	proposal: Proposal,
	rows: TeamRow[],
	conditions: Conditions,
): Promise<RuleVote> => {
	const userTids = g.get("spectator") ? [] : g.get("userTids");
	const userSetting = featureOption<string>("featureLeagueErasUserVote");
	let yes = 0;
	let userVote: boolean | undefined;
	for (const row of rows) {
		const p = proposal.yesProb(row);
		let vote;
		if (userTids.includes(row.tid)) {
			vote =
				userSetting === "yes" ? true : userSetting === "no" ? false : p >= 0.5;
			if (row.tid === g.get("userTid")) {
				userVote = vote;
			}
		} else {
			vote = rng.random() < p;
		}
		if (vote) {
			yes += 1;
		}
	}
	const needed = Math.ceil((rows.length * 2) / 3);
	const passed = yes >= needed;
	if (passed) {
		await proposal.apply();
	}
	const vote: RuleVote = {
		type: proposal.type,
		title: proposal.title,
		reason: proposal.reason,
		yes,
		no: rows.length - yes,
		needed,
		passed,
		userVote,
	};
	await logEvent(
		{
			type: "info",
			text: `<b>Rule-change vote:</b> after ${proposal.reason}, the league office proposed: ${proposal.title}. ${passed ? "Passed" : "Failed"}, ${yes}-${vote.no} (${needed} needed)${userVote === undefined ? "" : `; your team voted ${userVote ? "yes" : "no"}`}.${passed && proposal.type === "lottery" ? " The new odds apply from next season." : ""} <a href="${helpers.leagueUrl(["league_eras"])}">League Eras</a>`,
			showNotification: true,
			tids: rows.map((row) => row.tid),
			score: 20,
		},
		conditions,
	);
	return vote;
};

/**
 * Season over (newPhaseBeforeDraft): record the season's style and set next season's.
 */
export const advanceEra = async (conditions: Conditions) => {
	if (!featureOn("leagueEras")) {
		return;
	}
	const season = g.get("season");
	const awards = (await idb.cache.awards.get(season)) as any;
	if (!awards) {
		return;
	}

	const current = readValues();
	const scheduled = await scheduledEraKeys();
	const prev = await getEraRecord(season - 1);

	// The baseline follows the real history while it lasts, and is fixed from when the drift takes over
	const baseline: EraValues = {
		...(prev?.nextBaseline ?? prev?.baseline ?? current),
	};
	for (const key of ERA_KEYS) {
		if (scheduled.has(key) || prev?.scheduled) {
			baseline[key] = current[key];
		}
	}

	const rows = await getTeamRows(season);
	const leagueTpShare = mean(rows.map((row) => row.tpShare));
	const leaguePoss = mean(rows.map((row) => row.poss));

	const record: EraRecord = {
		values: current,
		baseline: { ...baseline },
		label: eraLabel(current, baseline),
		tpShare: Math.round(leagueTpShare * 1000) / 1000,
		poss: Math.round(leaguePoss * 10) / 10,
		scheduled: scheduled.size > 0 ? true : undefined,
	};

	const rng = new Rng(`leagueEras-${season}`);
	const pulls: Partial<Record<EraKey, number>> = {
		threePointTendencyFactor: helpers.bound(
			WINNERS_PULL * winnersEdge(rows, (row) => row.tpShare),
			-WINNERS_PULL_MAX,
			WINNERS_PULL_MAX,
		),
		pace: helpers.bound(
			WINNERS_PULL * winnersEdge(rows, (row) => row.poss),
			-WINNERS_PULL_MAX / 3,
			WINNERS_PULL_MAX / 3,
		),
	};

	const next: EraValues = { ...current };
	for (const key of ERA_KEYS) {
		// Draw for every key, so the stream doesn't depend on which keys are scheduled
		const z = rng.normal();
		if (scheduled.has(key) || baseline[key] <= 0) {
			continue;
		}
		const { revert, step, bound } = WALK[key];
		const x = Math.log(current[key] / baseline[key]);
		const x2 = helpers.bound(
			(1 - revert) * x + step * z + (pulls[key] ?? 0),
			-bound,
			bound,
		);
		next[key] = roundValue(key, baseline[key] * Math.exp(x2));
	}

	// Rule-change vote: at most one a season, rare
	if (
		featureOption<boolean>("featureLeagueErasVotes") &&
		!college.isCollege() &&
		rows.length >= 4
	) {
		let recentVote = false;
		for (let s = season - VOTE_GAP + 1; s < season; s++) {
			if ((await getEraRecord(s))?.vote) {
				recentVote = true;
			}
		}
		const proposals = getProposals(season, rows, leagueTpShare, next, baseline);
		const roll = rng.random();
		if (!recentVote && proposals.length > 0 && roll < VOTE_PROB) {
			const proposal = proposals[Math.floor(rng.random() * proposals.length)]!;
			record.vote = await runVote(rng, proposal, rows, conditions);
		}
	}

	// A passed three-point line move changed the baseline from next season on
	if (ERA_KEYS.some((key) => baseline[key] !== record.baseline[key])) {
		record.nextBaseline = { ...baseline };
	}
	awards.era = record;
	await idb.cache.awards.put(awards);

	// Next season's style
	const changed: Partial<EraValues> = {};
	for (const key of ERA_KEYS) {
		if (next[key] !== current[key]) {
			changed[key] = next[key];
		}
	}
	if (Object.keys(changed).length > 0) {
		await league.setGameAttributes(changed);
	}

	// News: a new era, or a big one-season swing
	const nextLabel = eraLabel(next, baseline);
	const tpJump = Math.log(
		next.threePointTendencyFactor / current.threePointTendencyFactor,
	);
	const paceJump = Math.log(next.pace / current.pace);
	let text: string | undefined;
	if (nextLabel !== record.label) {
		text = `League style: the ${record.label} gives way to the <b>${nextLabel}</b> next season.`;
	} else if (Math.abs(tpJump) >= 0.06) {
		text = `League style: teams will shoot ${tpJump > 0 ? "more" : "fewer"} threes next season (three-point tendency ${current.threePointTendencyFactor} → ${next.threePointTendencyFactor}).`;
	} else if (Math.abs(paceJump) >= 0.025) {
		text = `League style: the game ${paceJump > 0 ? "speeds up" : "slows down"} next season (pace ${current.pace} → ${next.pace}).`;
	}
	if (text) {
		await logEvent({
			type: "info",
			text: `${text} <a href="${helpers.leagueUrl(["league_eras"])}">League Eras</a>`,
			showNotification: false,
			tids: [],
			score: 10,
		});
	}
};
