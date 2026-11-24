// Draft Lottery Night & Combine setting (basketball), worker side: the draft combine of a class (held at the start of the draft
// lottery phase), its news, the AI draft nudge and the lottery night news. The combine itself is a pure function of each prospect
// (common/draftCombine.ts, its own seeded RNG), so nothing here draws from the game's random numbers. When the combine is held, each
// invited prospect's results are stored on him (p.combine), so later development doesn't rewrite them. Regenerate Ratings redoes
// the stored combine of the prospects it rebuilds (redoStoredCombine).
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	buildCombineHistory,
	combineNudges,
	combineRanks,
	effortStory,
	historyPercentiles,
	listedMeasurements,
	measurementStories,
	type CombineHistory,
	generateDraftCombine,
	generateMedical,
	medicalGradeOf,
	medicalNoiseSd,
	medicalReason,
	medicalRisk,
	numCombineInvites,
	COMBINE_COLUMN_BY_KEY,
	MEDICAL_DRAFT_PENALTY,
	type CombineKey,
	type CombineMedical,
	type DraftCombineInput,
	type DraftCombineResult,
} from "../../../common/draftCombine.ts";
import { careerInjuries } from "../../../common/collegeStats/injuries.ts";
import { levelToEffect } from "../../../common/budgetLevels.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";
import { getPlayerTraitScores, traitsEnabled } from "../player/traits.ts";
import {
	getLotteryNightRows,
	lotteryRecap,
} from "../../../common/lotteryNight.ts";
import type {
	Conditions,
	DraftLotteryResult,
	Player,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { expandedRatingsApply } from "../player/expandedRatings.ts";
import { earlyCombineRead } from "../frontOffice/index.ts";
import { subRatingsOn } from "../player/subRatings.ts";
import { applyFuzz } from "../player/fuzzRating.ts";
import { isValidSubArray, SUB_INDEX } from "../../../common/subRatings.ts";

type PlayerRatings = Player["ratings"][number] & Record<string, any>;

export const lotteryNightOn = () =>
	__SPORT === "basketball" && featureOn("lotteryNight");

// No draft at all (draft type "No draft, rookies are free agents", or zero draft rounds): no combine either
export const noDraft = () =>
	g.get("draftType") === "freeAgents" || g.get("numDraftRounds") <= 0;

// The combine of a class is held at the start of its draft lottery phase (not in a league without a draft: a past class's
// combine, from before the setting changed, still counts)
export const combineHeld = (draftYear: number) => {
	const season = g.get("season");
	if (draftYear < season) {
		return true;
	}
	return (
		draftYear === season && g.get("phase") >= PHASE.DRAFT_LOTTERY && !noDraft()
	);
};

// His ratings at the combine: the last row of his draft year (or before it)
export const combineRatingsRow = (p: Player): PlayerRatings | undefined => {
	let out: PlayerRatings | undefined;
	for (const r of p.ratings) {
		if (r.season <= p.draft.year) {
			out = r;
		}
	}
	return out ?? p.ratings[0];
};

// Projected draft stock from his combine-time ratings as scouted (his row's fuzz, also in God Mode so the order never changes with
// it), for the invite list when the scouts' consensus board isn't there (inConsensusOrder) and the class's order otherwise: who is
// invited is public, so it never gives away true ratings
const stock = (p: Player, r: PlayerRatings) =>
	applyFuzz(r.pot, r.fuzz ?? 0) +
	0.5 * applyFuzz(r.ovr, r.fuzz ?? 0) -
	1.5 * (p.draft.year - p.born.year - 19);

type Row = { p: Player; r: PlayerRatings };

const byStock = (a: Row, b: Row) =>
	stock(b.p, b.r) - stock(a.p, a.r) || a.p.pid - b.p.pid;

/**
 * The class in the order invitations go out when the combine is held: the scouts' consensus board (Scout Consensus & Flags: each
 * prospect's consensus value, or his value as scouted when no scout has seen him), so who is invited follows the consensus and the
 * drills are something to scout. Falls back to the projected stock (rows as given) when the scouts' room is off. Deterministic: the
 * room is seeded and draws nothing from the game's random numbers.
 */
const inConsensusOrder = async (rows: Row[]): Promise<Row[]> => {
	// (dynamic: the scouting reports read the combine)
	const { getProspectRooms, scoutRoomOn } =
		await import("../scoutingReports/room.ts");
	if (!scoutRoomOn()) {
		return rows;
	}
	const rooms = await getProspectRooms(rows.map((x) => x.p));
	if (![...rooms.values()].some((x) => x.room)) {
		return rows;
	}
	const key = (p: Player) => {
		const consensus = rooms.get(p.pid)?.room?.consensus;
		if (consensus !== undefined) {
			return consensus;
		}
		return Number.isFinite(p.valueFuzz) ? p.valueFuzz : -Infinity;
	};
	return rows
		.map((x) => ({ ...x, key: key(x.p) }))
		.sort((a, b) => b.key - a.key || byStock(a, b))
		.map(({ p, r }) => ({ p, r }));
};

// Rows with the invite order stored when the combine was held first (in that order), then everyone else as given
const inStoredInviteOrder = (rows: Row[], draftYear: number): Row[] => {
	const rank = (x: Row) =>
		x.p.combine?.season === draftYear
			? (x.p.combine.inviteRank ?? Infinity)
			: Infinity;
	if (!rows.some((x) => rank(x) < Infinity)) {
		return rows;
	}
	return rows
		.map((x, i) => ({ x, i, rank: rank(x) }))
		.sort((a, b) => a.rank - b.rank || a.i - b.i)
		.map(({ x }) => x);
};

// Sub-ratings (setting on): the subs the drills measure
const combineSubs = (r: PlayerRatings) => {
	if (!subRatingsOn() || !isValidSubArray(r.sub)) {
		return {};
	}
	const x = (k: string) => r.sub[SUB_INDEX[k]!] as number;
	return { stj: x("stj"), mxv: x("mxv"), lat: x("lat"), sls: x("sls") };
};

// Hurt at the time of the combine
const injuredAtCombine = (p: Player) =>
	p.tid === PLAYER.UNDRAFTED
		? p.injury.gamesRemaining > 0
		: (p.injuries ?? []).some(
				(inj) => inj.season === p.draft.year && inj.games > 0,
			);

export const medicalsOn = () =>
	__SPORT === "basketball" && featureOn("preDraftMedicals");

// The noise on the user's medical read, from his team's scouting and medical (health) budget (3-season levels). League average
// without the budget setting
export const getMedicalNoiseSd = async () => {
	const tid = g.get("userTid");
	if (!g.get("budget") || !(await idb.cache.teams.get(tid))) {
		return medicalNoiseSd(0, 0);
	}
	const scouting = await getLevelLastThree("scouting", { tid });
	const health = await getLevelLastThree("health", { tid });
	return medicalNoiseSd(levelToEffect(scouting), levelToEffect(health));
};

// His medical at the combine (Pre-Draft Injuries & Combine Medicals): from his pre-draft injuries, an injury now and his durability
export const getMedical = (p: Player, noiseSd: number): CombineMedical => {
	const season = p.draft.year;
	const risk = medicalRisk({
		season,
		injuries: careerInjuries(p.preDraftCareer),
		durability: traitsEnabled()
			? getPlayerTraitScores(p, season).durability
			: undefined,
		injuredNow: injuredAtCombine(p),
	});
	return generateMedical({ pid: p.pid, season, risk, noiseSd });
};

// A plain line on his medical grade, for the views
export const getMedicalReason = (p: Player) =>
	medicalReason(careerInjuries(p.preDraftCareer), injuredAtCombine(p));

// His stored medical grade (as the user's staff read it) with a line on why, for lists (Draft Scouting, Draft Board). undefined
// before his combine, when he wasn't invited, for a combine held before medicals existed, or when off
export const storedMedicalView = (p: Player) => {
	const medical =
		p.combine?.season === p.draft.year ? p.combine.medical : undefined;
	if (!medical || !medicalsOn()) {
		return undefined;
	}
	return { grade: medical.grade, reason: getMedicalReason(p) };
};

const toInput = (
	p: Player,
	r: PlayerRatings,
	rank: number,
): DraftCombineInput => {
	const x = r;
	const expanded = expandedRatingsApply(r);
	const injured = injuredAtCombine(p);
	return {
		pid: p.pid,
		season: p.draft.year,
		heightInches: p.hgt,
		weight: p.weight,
		rank,
		injured,
		ratings: {
			hgt: r.hgt,
			stre: r.stre,
			spd: r.spd,
			jmp: r.jmp,
			endu: r.endu,
			tp: r.tp,
			ft: r.ft,
			fg: r.fg,
			wng: expanded ? x.wng : undefined,
			csh: expanded ? x.csh : undefined,
			dsh: expanded ? x.dsh : undefined,
			...combineSubs(r),
		},
	};
};

export type ClassCombine = {
	draftYear: number;
	held: boolean;
	// Every prospect of the class, best stock first
	players: Player[];
	invited: Set<number>;
	results: Map<number, DraftCombineResult>;
	ranks: ReturnType<typeof combineRanks>;
};

const classPlayersOf = async (draftYear: number) => {
	// The whole class, drafted or not: once the draft is over its picks are on teams (only reading the undrafted left the Combine page
	// with the invitees who went undrafted, as few as ten)
	const players =
		draftYear >= g.get("season")
			? (
					await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
						[draftYear],
						[draftYear, Infinity],
					])
				).filter((p) => p.draft.year === draftYear)
			: (await idb.merged.players.getAll({ draftYear })).filter(
					(p) => p.draft.year === draftYear,
				);
	return players.filter((p) => p.ratings.length > 0);
};

/**
 * The combine of a draft class. Before it is held (held false) the results are empty.
 */
export const getClassCombine = async (
	draftYear: number,
	playersInput?: Player[],
	// The phase change holding it (g's phase is updated after the hooks run)
	holdingNow?: boolean,
): Promise<ClassCombine> => {
	const held = holdingNow || combineHeld(draftYear);
	let players = (playersInput ?? (await classPlayersOf(draftYear)))
		.map((p) => ({ p, r: combineRatingsRow(p)! }))
		.filter((x) => x.r)
		.sort(byStock);
	const numInvites = numCombineInvites(
		g.get("numActiveTeams") * Math.max(1, g.get("numDraftRounds")),
	);
	const invited = new Set<number>();
	const results = new Map<number, DraftCombineResult>();
	// Results stored when the combine was held win; a class without any (held before they were stored) is computed live
	const stored =
		held && !holdingNow
			? players.filter(({ p }) => p.combine?.season === draftYear)
			: [];
	if (stored.length > 0) {
		for (const { p } of stored) {
			invited.add(p.pid);
			results.set(p.pid, { pid: p.pid, ...p.combine! });
		}
		players = inStoredInviteOrder(players, draftYear);
	} else if (held && !noDraft()) {
		// (in a league without a draft, only a combine stored before the setting changed is shown)
		// Held now: invited from the scouts' consensus board (else the projected stock)
		if (holdingNow) {
			players = await inConsensusOrder(players);
		}
		const noiseSd = medicalsOn() ? await getMedicalNoiseSd() : undefined;
		for (const [i, { p, r }] of players.entries()) {
			if (i >= numInvites) {
				break;
			}
			invited.add(p.pid);
			const res = generateDraftCombine(toInput(p, r, i + 1));
			if (noiseSd !== undefined) {
				res.medical = getMedical(p, noiseSd);
			}
			if (holdingNow) {
				res.inviteRank = i + 1;
			}
			results.set(p.pid, res);
		}
	}
	return {
		draftYear,
		held,
		players: players.map((x) => x.p),
		invited,
		results,
		ranks: combineRanks([...results.values()]),
	};
};

/**
 * Regenerate Ratings: redo the stored combine of prospects whose ratings were rebuilt after their class's combine was held, so his
 * measurements and drills follow his new ratings (the combine is a pure function of his ratings, see common/draftCombine.ts). His
 * invite, his place in the invite order and his medical stay as they were. Before the combine is held nothing is stored, and the
 * live combine already reads the new ratings.
 */
export const redoStoredCombine = async (draftYear: number, pids: number[]) => {
	if (pids.length === 0) {
		return 0;
	}
	const which = new Set(pids);
	const players = inStoredInviteOrder(
		(await classPlayersOf(draftYear))
			.map((p) => ({ p, r: combineRatingsRow(p)! }))
			.filter((x) => x.r)
			.sort(byStock),
		draftYear,
	);
	let redone = 0;
	for (const [i, { p, r }] of players.entries()) {
		if (!which.has(p.pid) || p.combine?.season !== draftYear) {
			continue;
		}
		const inviteRank = p.combine.inviteRank;
		const { pid, ...rest } = generateDraftCombine(
			toInput(p, r, inviteRank ?? i + 1),
		);
		const medical = p.combine.medical;
		p.combine = {
			...rest,
			performance: Math.round(rest.performance * 1000) / 1000,
		};
		if (medical) {
			p.combine.medical = medical;
		}
		if (inviteRank !== undefined) {
			p.combine.inviteRank = inviteRank;
		}
		await idb.cache.players.put(p);
		redone += 1;
	}
	return redone;
};

// One prospect's combine, with his ranks in the class. undefined when off, not held yet or not invited
// (for the user's views and scouting reports: Front Office Budget's early read, see frontOffice/index.ts earlyCombineRead)
export const getPlayerCombine = async (p: Player) => {
	if (!lotteryNightOn()) {
		return undefined;
	}
	const early =
		!combineHeld(p.draft.year) && (await earlyCombineRead(p.draft.year));
	if (!early && !combineHeld(p.draft.year)) {
		return undefined;
	}
	const c = await getClassCombine(p.draft.year, undefined, early);
	const result = c.results.get(p.pid);
	if (!result) {
		return {
			invited: false as const,
			n: c.results.size,
			...(early ? { early: true as const } : {}),
		};
	}
	const listed = listedFor(p);
	return {
		invited: true as const,
		result,
		ranks: c.ranks.get(p.pid) ?? {},
		hist: historyPercentiles(result, await getCombineHistory(p.draft.year)),
		listed,
		stories: measurementStories(listed, result.measurements).map((x) => x.text),
		effortStory: result.drills ? effortStory(result.effort) : undefined,
		n: c.results.size,
		...(early ? { early: true as const } : {}),
	};
};

/**
 * AI draft nudge (value points) for each prospect of this season's draft: the combine performance part averages zero over the class,
 * then medical concerns take a little off (Pre-Draft Injuries & Combine Medicals). Empty when off or when the combine was not held
 * (fantasy and expansion drafts).
 */
export const getDraftCombineNudges = async (
	players: Player[],
	// The mock draft passes its class's year: any phase, as long as that class's combine was held
	mockSeason?: number,
): Promise<Map<number, number>> => {
	const season = mockSeason ?? g.get("season");
	if (
		!lotteryNightOn() ||
		(mockSeason === undefined && g.get("phase") !== PHASE.DRAFT) ||
		!combineHeld(season)
	) {
		return new Map();
	}
	const classPlayers = players.filter((p) => p.draft.year === season);
	const c = await getClassCombine(season, classPlayers);
	const nudges = combineNudges(
		classPlayers.map((p) => p.pid),
		c.results,
	);
	// Pre-Draft Injuries & Combine Medicals: a little off for medical concerns (the actual risk, not the user's read)
	if (medicalsOn()) {
		for (const [pid, res] of c.results) {
			if (res.medical && nudges.has(pid)) {
				nudges.set(
					pid,
					nudges.get(pid)! -
						MEDICAL_DRAFT_PENALTY[medicalGradeOf(res.medical.risk)],
				);
			}
		}
	}
	return nudges;
};

// His school's or club's listing before the combine (derived, nothing stored)
export const listedFor = (p: Player) =>
	listedMeasurements({
		pid: p.pid,
		season: p.draft.year,
		heightInches: p.hgt,
		weight: p.weight,
	});

// Every stored combine of earlier classes, per test (for percentiles against the league's history). Memoized per league, season and
// phase: stored results only change when a combine is held
let historyMemo: { key: string; history: CombineHistory } | undefined;
export const getCombineHistory = async (beforeSeason: number) => {
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${beforeSeason}`;
	if (historyMemo?.key === key) {
		return historyMemo.history;
	}
	const players = await idb.merged.players.getAll({ activeAndRetired: true });
	const history = buildCombineHistory(
		players
			.filter(
				(p) =>
					p.combine &&
					p.combine.season === p.draft.year &&
					p.combine.season < beforeSeason,
			)
			.map((p) => p.combine!),
	);
	historyMemo = { key, history };
	return history;
};

const playerLink = (p: Player) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

// Red flags in the combine news: the top of the class by projected stock
const TOP_PROSPECTS_FOR_NEWS = 20;

// News when the combine is held (start of the draft lottery phase)
export const afterNewPhase = async (phase: number, conditions?: Conditions) => {
	if (phase !== PHASE.DRAFT_LOTTERY || !lotteryNightOn() || noDraft()) {
		return;
	}
	const season = g.get("season");
	const c = await getClassCombine(season, undefined, true);
	if (c.results.size === 0) {
		return;
	}
	// Store the results on the invited prospects (and clear stale ones of the uninvited, e.g. from an undone phase)
	for (const p of c.players) {
		const res = c.results.get(p.pid);
		if (res) {
			const { pid, ...rest } = res;
			p.combine = {
				...rest,
				performance: Math.round(rest.performance * 1000) / 1000,
			};
		} else if (p.combine?.season === season) {
			delete p.combine;
		} else {
			continue;
		}
		await idb.cache.players.put(p);
	}
	const byPid = new Map(c.players.map((p) => [p.pid, p]));
	const best = (key: CombineKey) => {
		let out: { p: Player; rank: number } | undefined;
		for (const [pid, ranks] of c.ranks) {
			const r = ranks[key];
			if (r && (!out || r.rank < out.rank)) {
				out = { p: byPid.get(pid)!, rank: r.rank };
			}
		}
		return out?.p;
	};
	const lines: string[] = [];
	const pids: number[] = [];
	for (const key of ["maxVert", "laneAgility", "wingspan"] as const) {
		const p = best(key);
		const res = p ? c.results.get(p.pid) : undefined;
		if (!p || !res) {
			continue;
		}
		const col = COMBINE_COLUMN_BY_KEY[key];
		const v =
			key === "wingspan" ? res.measurements.wingspan : res.drills?.[key];
		if (v === undefined) {
			continue;
		}
		lines.push(
			`${playerLink(p)} (${col.name.toLowerCase()}, ${col.format(v)})`,
		);
		pids.push(p.pid);
	}
	const skipped = [...c.results.values()].filter((r) => !r.drills).length;
	logEvent(
		{
			type: "draft",
			text: `The <a href="${helpers.leagueUrl(["draft_combine", season])}">${season} draft combine</a> measured and tested ${c.results.size} prospects${skipped > 0 ? ` (${skipped} skipped the drills)` : ""}. Best marks: ${lines.join(", ")}.`,
			showNotification: false,
			pids,
			tids: [],
			score: 10,
		},
		conditions,
	);

	// Listed vs measured: the biggest surprises among the top of the class
	const stories: string[] = [];
	const storyPids: number[] = [];
	for (const p of c.players.slice(0, 40)) {
		const res = c.results.get(p.pid);
		if (!res) {
			continue;
		}
		const story = measurementStories(listedFor(p), res.measurements).find(
			(x) => x.kind === "shorter" || x.kind === "taller",
		);
		if (story) {
			stories.push(
				`${playerLink(p)}: ${story.text.charAt(0).toLowerCase()}${story.text.slice(1)}`,
			);
			storyPids.push(p.pid);
		}
		if (stories.length >= 3) {
			break;
		}
	}
	if (stories.length > 0) {
		logEvent(
			{
				type: "draft",
				text: `Tape measure surprises at the <a href="${helpers.leagueUrl(["draft_combine", season])}">${season} draft combine</a>: ${stories.join("; ")}.`,
				showNotification: false,
				pids: storyPids,
				tids: [],
				score: 0,
			},
			conditions,
		);
	}

	// Pre-Draft Injuries & Combine Medicals: red flags among the top prospects (as your medical staff reads them)
	if (medicalsOn()) {
		const flagged = c.players
			.slice(0, TOP_PROSPECTS_FOR_NEWS)
			.filter((p) => c.results.get(p.pid)?.medical?.grade === "redFlag");
		if (flagged.length > 0) {
			logEvent(
				{
					type: "draft",
					text: `Medical red ${flagged.length === 1 ? "flag" : "flags"} at the <a href="${helpers.leagueUrl(["draft_combine", season])}">${season} draft combine</a>: ${flagged
						.map((p) => `${playerLink(p)} (${getMedicalReason(p)})`)
						.join(", ")}.`,
					showNotification: false,
					pids: flagged.map((p) => p.pid),
					tids: [],
					score: 10,
				},
				conditions,
			);
		}
	}
};

// News after the lottery: winners and losers
export const logLotteryNightNews = (
	draftLotteryResult: DraftLotteryResult<boolean>,
	conditions?: Conditions,
) => {
	if (!lotteryNightOn()) {
		return;
	}
	const rows = getLotteryNightRows(draftLotteryResult.result);
	if (rows.length === 0) {
		return;
	}
	const teamInfoCache = g.get("teamInfoCache");
	const teamName = (tid: number) => {
		const t = teamInfoCache[tid];
		return t
			? `<a href="${helpers.leagueUrl(["roster", `${t.abbrev}_${tid}`, g.get("season")])}">${t.region} ${t.name}</a>`
			: "?";
	};
	const recap = lotteryRecap(rows, teamName);
	const tids = [
		...new Set(
			[rows.find((r) => r.pick === 1), recap.winners[0], recap.losers[0]]
				.filter((r) => r !== undefined)
				.map((r) => r.tid),
		),
	];
	logEvent(
		{
			type: "draftLottery",
			text: `<a href="${helpers.leagueUrl(["draft_lottery", g.get("season")])}">Lottery winners and losers:</a> ${recap.summary}`,
			// Don't spoil the reveal
			showNotification: false,
			pids: [],
			tids,
			score: 20,
		},
		conditions,
	);
};
