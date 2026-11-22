// Big boards from media outlets (basketball, part of Scouting Reports): the worker side of common/draftOutlets.ts. It reads each class's
// inputs (value, age, upside, pre-draft production, athleticism), works out the edition from the phase and the regular season played,
// stores each outlet's final board on the prospects when the draft starts (p.outletRanks), and scores the outlets against the actual
// draft and, three seasons later, against how the class turned out. Nothing here draws from the game's random numbers.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	EDITION_LABELS,
	OUTLETS,
	OUTCOME_SEASONS,
	consensusBoard,
	draftAccuracy,
	editionOf,
	outcomeAccuracy,
	outcomeRanks,
	outletBoards,
	productionSignal,
	type BoardRanks,
	type Edition,
	type OutletProspect,
} from "../../../common/draftOutlets.ts";
import { athleticScore } from "../../../common/draftCombine.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { isCollege } from "../college/isCollege.ts";
import { combineHeld, getClassCombine } from "../draftCombine/index.ts";
import fuzzRating from "../player/fuzzRating.ts";
import {
	leagueSeed,
	preDraftProductionFor,
	scoutingReportsOn,
} from "../scoutingReports/input.ts";

export const draftOutletsOn = () =>
	__SPORT === "basketball" && scoutingReportsOn() && !isCollege();

// The class being scouted now: this season's until its draft starts, then next season's
const currentClass = () =>
	g.get("phase") >= PHASE.DRAFT ? g.get("season") + 1 : g.get("season");

const classDraftStarted = (draftYear: number) =>
	draftYear < g.get("season") ||
	(draftYear === g.get("season") && g.get("phase") >= PHASE.DRAFT);

const seasonFraction = async () => {
	const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		g.get("season"),
		g.get("userTid"),
	]);
	if (!ts) {
		return 0;
	}
	const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
	return gp / Math.max(1, g.get("numGames"));
};

export const editionFor = async (draftYear: number): Promise<Edition> => {
	if (classDraftStarted(draftYear)) {
		return editionOf("draft");
	}
	if (draftYear > currentClass()) {
		return editionOf("future");
	}
	const phase = g.get("phase");
	if (phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE) {
		return editionOf("regularSeason", await seasonFraction());
	}
	if (phase === PHASE.PLAYOFFS) {
		return editionOf("playoffs");
	}
	if (phase === PHASE.DRAFT_LOTTERY) {
		return editionOf("lottery");
	}
	return editionOf("preseason");
};

const ratingsRowOf = (p: Player) => {
	let out: any;
	for (const r of p.ratings) {
		if (r.season <= p.draft.year) {
			out = r;
		}
	}
	return out ?? p.ratings[0];
};

const classMembers = async (draftYear: number) => {
	const players =
		draftYear >= g.get("season")
			? await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
					[draftYear],
					[draftYear, Infinity],
				])
			: await idb.merged.players.getAll({ draftYear });
	return players.filter(
		(p) =>
			p.draft.year === draftYear &&
			p.tid !== PLAYER.UNDRAFTED_FANTASY_TEMP &&
			p.ratings.length > 0,
	);
};

// The production outlet's age-adjusted read of his last pre-draft season (productionSignal), undefined without enough minutes. Also
// what AI teams read of his production when they draft (draft/draftDecision.ts)
export const productionSignalFor = (p: Player, age: number) => {
	const prod = preDraftProductionFor(p);
	return prod
		? productionSignal(
				{
					gp: prod.gp,
					min: prod.min * prod.gp,
					pts: prod.pts * prod.gp,
					trb: prod.trb * prod.gp,
					ast: prod.ast * prod.gp,
					stl: prod.stl * prod.gp,
					blk: prod.blk * prod.gp,
					tov: prod.tov * prod.gp,
					fga: prod.fga * prod.gp,
					fta: prod.fta * prod.gp,
					level: prod.level,
				},
				age,
			)
		: undefined;
};

// What the outlets read of each prospect (the media's view: the value the league drafts by, the pre-draft stats, the combine)
const outletInputs = async (players: Player[], draftYear: number) => {
	const combine =
		combineHeld(draftYear) && players.length > 0
			? await getClassCombine(draftYear, players)
			: undefined;
	return players.map((p): OutletProspect => {
		const r = ratingsRowOf(p);
		const age = draftYear - p.born.year;
		const tested = combine?.results.get(p.pid)?.drills
			? athleticScore(combine.ranks.get(p.pid))
			: undefined;
		return {
			pid: p.pid,
			value: p.value,
			age,
			upside: (r?.pot ?? 0) - (r?.ovr ?? 0) + 2 * (21 - age),
			production: productionSignalFor(p, age),
			// The tape before the combine (or when he skipped the drills), on about the same scale as the combine's athletic score
			athletic:
				tested ??
				Math.max(0, Math.min(100, 50 + 2.2 * ((r?.spd + r?.jmp) / 2 - 52))),
		};
	});
};

export type ClassBoards = {
	draftYear: number;
	edition: Edition;
	// Outlet id -> pid -> rank (1 = top)
	boards: Map<number, BoardRanks>;
	prevEdition?: Edition;
	prevBoards?: Map<number, BoardRanks>;
	consensus: ReturnType<typeof consensusBoard>;
	// Your board when the draft started (stored classes), pid -> rank
	your?: BoardRanks;
	stored: boolean;
	players: Player[];
};

let memo: { key: string; value: ClassBoards } | undefined;

const storedBoards = (players: Player[], draftYear: number) => {
	const withRanks = players.filter((p) => p.outletRanks?.s === draftYear);
	if (withRanks.length === 0) {
		return undefined;
	}
	const boards = new Map<number, BoardRanks>();
	for (const outlet of OUTLETS) {
		const b = new Map<number, number>();
		for (const p of withRanks) {
			const r = p.outletRanks!.r[outlet.id];
			if (r) {
				b.set(p.pid, r);
			}
		}
		boards.set(outlet.id, b);
	}
	const your = new Map<number, number>();
	for (const p of withRanks) {
		if (p.outletRanks!.y !== undefined) {
			your.set(p.pid, p.outletRanks!.y);
		}
	}
	return { boards, your };
};

/**
 * Every outlet's board of a class: stored when its draft started, else computed for the current edition (with the previous edition for
 * the movement arrows).
 */
export const getClassBoards = async (
	draftYear: number,
): Promise<ClassBoards | undefined> => {
	if (!draftOutletsOn()) {
		return undefined;
	}
	const edition = await editionFor(draftYear);
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${draftYear}|${edition.index}`;
	if (memo?.key === key) {
		return memo.value;
	}
	const players = await classMembers(draftYear);
	if (players.length === 0) {
		return undefined;
	}
	let value: ClassBoards;
	const stored = classDraftStarted(draftYear)
		? storedBoards(players, draftYear)
		: undefined;
	if (classDraftStarted(draftYear) && !stored) {
		// A class drafted before the outlets kept their boards (or a fantasy draft): values have moved on since, so no boards
		return undefined;
	}
	if (stored) {
		value = {
			draftYear,
			edition,
			boards: stored.boards,
			consensus: consensusBoard(stored.boards),
			your: stored.your,
			stored: true,
			players,
		};
	} else {
		const inputs = await outletInputs(players, draftYear);
		const seed = leagueSeed();
		const boards = outletBoards({
			prospects: inputs,
			seed,
			draftYear,
			edition: edition.index,
		});
		const prevIndex = edition.index - 1;
		const prevBoards =
			prevIndex >= 0
				? outletBoards({
						prospects: inputs,
						seed,
						draftYear,
						edition: prevIndex,
					})
				: undefined;
		value = {
			draftYear,
			edition,
			boards,
			prevEdition:
				prevIndex >= 0
					? { index: prevIndex, label: EDITION_LABELS[prevIndex]! }
					: undefined,
			prevBoards,
			consensus: consensusBoard(boards),
			stored: false,
			players,
		};
	}
	memo = { key, value };
	return value;
};

// Your board: your Draft Board's ranks first, then your scouts' list (value as scouted)
const yourBoard = (players: Player[]) => {
	const sorted = [...players].sort(
		(a, b) =>
			(a.draftBoard?.rank ?? Infinity) - (b.draftBoard?.rank ?? Infinity) ||
			b.valueFuzz - a.valueFuzz ||
			a.pid - b.pid,
	);
	return new Map(sorted.map((p, i) => [p.pid, i + 1]));
};

export const yourBoardFor = (c: ClassBoards) =>
	c.your ??
	yourBoard(c.players.filter((p) => p.tid === PLAYER.UNDRAFTED || c.stored));

// newPhase hook: store every outlet's final board when the draft starts, and the scorecards after the draft
export const afterNewPhase = async (phase: number) => {
	if (!draftOutletsOn()) {
		return;
	}
	try {
		const season = g.get("season");
		if (phase === PHASE.DRAFT) {
			memo = undefined;
			const players = (await classMembers(season)).filter(
				(p) => p.tid === PLAYER.UNDRAFTED,
			);
			if (players.length === 0) {
				return;
			}
			const inputs = await outletInputs(players, season);
			const boards = outletBoards({
				prospects: inputs,
				seed: leagueSeed(),
				draftYear: season,
				edition: editionOf("draft").index,
			});
			const consensus = consensusBoard(boards);
			const your = yourBoard(players);
			for (const p of players) {
				p.outletRanks = {
					s: season,
					r: OUTLETS.map((o) => boards.get(o.id)?.get(p.pid) ?? 0),
					c: consensus.get(p.pid)?.rank ?? 0,
					y: your.get(p.pid),
				};
				await idb.cache.players.put(p);
			}
		} else if (phase === PHASE.AFTER_DRAFT) {
			memo = undefined;
			await logScorecards(season);
		}
	} catch (error) {
		// Never let the outlets break a phase change
		console.error("Draft outlets failed", error);
	}
};

const overallPick = (p: Player) =>
	p.draft.round > 0 && p.draft.pick > 0
		? (p.draft.round - 1) * g.get("numActiveTeams") + p.draft.pick
		: undefined;

// Seasons of his first OUTCOME_SEASONS pro seasons that are complete now
const outcomeJudged = (draftYear: number) => {
	const done =
		g.get("season") - draftYear - (g.get("phase") < PHASE.PLAYOFFS ? 1 : 0);
	return done >= OUTCOME_SEASONS;
};

const outcomeOf = (players: Player[], draftYear: number) =>
	outcomeRanks(
		players.map((p) => {
			const rows = (p.ratings as any[]).filter(
				(r) => r.season > draftYear && r.season <= draftYear + OUTCOME_SEASONS,
			);
			const peak = Math.max(
				0,
				...rows.map((r) => fuzzRating(r.ovr, r.fuzz ?? 0)),
			);
			const min = (p.stats as any[])
				.filter(
					(s) =>
						!s.playoffs &&
						s.season > draftYear &&
						s.season <= draftYear + OUTCOME_SEASONS &&
						s.tid >= 0,
				)
				.reduce((a, s) => a + (s.min ?? 0), 0);
			return { pid: p.pid, peak: p.tid === PLAYER.UNDRAFTED ? 0 : peak, min };
		}),
	);

export type BoardKey = `o${number}` | "cons" | "you" | "draft";

export type ScoreLine = { mae: number; hits: number; n: number };

export type ClassScorecard = {
	season: number;
	draft: Partial<Record<BoardKey, ScoreLine>>;
	outcome?: Partial<Record<BoardKey, ScoreLine>>;
};

const scorecardFor = (
	players: Player[],
	draftYear: number,
): ClassScorecard | undefined => {
	const stored = storedBoards(players, draftYear);
	if (!stored) {
		return undefined;
	}
	const numTeams = g.get("numActiveTeams");
	const picks = new Map<number, number>();
	for (const p of players) {
		const pick = overallPick(p);
		if (pick !== undefined && p.draft.year === draftYear) {
			picks.set(p.pid, pick);
		}
	}
	const consensus = new Map(
		players
			.filter((p) => p.outletRanks?.s === draftYear && p.outletRanks.c > 0)
			.map((p) => [p.pid, p.outletRanks!.c]),
	);
	const all = new Map<BoardKey, BoardRanks>();
	for (const outlet of OUTLETS) {
		all.set(`o${outlet.id}`, stored.boards.get(outlet.id)!);
	}
	all.set("cons", consensus);
	if (stored.your.size > 0) {
		all.set("you", stored.your);
	}
	const draft: ClassScorecard["draft"] = {};
	for (const [key, board] of all) {
		const acc = draftAccuracy(board, picks, numTeams);
		if (acc) {
			draft[key] = acc;
		}
	}
	let outcome: ClassScorecard["outcome"];
	if (outcomeJudged(draftYear)) {
		const ranks = outcomeOf(players, draftYear);
		all.set("draft", picks);
		outcome = {};
		for (const [key, board] of all) {
			const acc = outcomeAccuracy(board, ranks, numTeams);
			if (acc) {
				outcome[key] = acc;
			}
		}
	}
	return { season: draftYear, draft, outcome };
};

/**
 * The outlets' track record: a scorecard for every class with stored boards, newest first. The draft scorecard is how close each board
 * was to the actual first round; the outcome scorecard (OUTCOME_SEASONS after the draft) how close it was to where the class finished.
 */
export const getOutletHistory = async (
	// The class whose draft just ended (the AFTER_DRAFT hook runs before g's phase changes)
	justDrafted?: number,
) => {
	if (!draftOutletsOn()) {
		return [];
	}
	const players = (await everyPlayer()).filter((p) => p.outletRanks);
	const byYear = new Map<number, Player[]>();
	for (const p of players) {
		const list = byYear.get(p.outletRanks!.s) ?? [];
		list.push(p);
		byYear.set(p.outletRanks!.s, list);
	}
	const out: ClassScorecard[] = [];
	for (const [year, list] of byYear) {
		const inProgress =
			year === g.get("season") && g.get("phase") === PHASE.DRAFT;
		if (year !== justDrafted && (!classDraftStarted(year) || inProgress)) {
			continue;
		}
		const card = scorecardFor(list, year);
		if (card) {
			out.push(card);
		}
	}
	return out.sort((a, b) => b.season - a.season);
};

// Every player, retired and stashed ones included, plus the prospects still undrafted (in the cache only; right after the draft,
// before they turn free agents, the scorecard still needs the ones the outlets ranked)
export const everyPlayer = async () => [
	...(await idb.merged.players.getAll({ activeAndRetired: true })),
	...(await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)),
];

export const boardKeyName = (key: BoardKey) =>
	key === "cons"
		? "Consensus"
		: key === "you"
			? "Your board"
			: key === "draft"
				? "Actual draft"
				: OUTLETS[Number(key.slice(1))]!.name;

const bestOf = (scores: Partial<Record<BoardKey, ScoreLine>>) => {
	let best: { key: BoardKey; line: ScoreLine } | undefined;
	for (const outlet of OUTLETS) {
		const key: BoardKey = `o${outlet.id}`;
		const line = scores[key];
		if (line && (!best || line.mae < best.line.mae)) {
			best = { key, line };
		}
	}
	return best;
};

// After the draft: who called this draft best, and who called the class of OUTCOME_SEASONS ago best
const logScorecards = async (season: number) => {
	const history = await getOutletHistory(season);
	const url = (year: number) => helpers.leagueUrl(["big_boards", year]);
	const now = history.find((x) => x.season === season);
	if (now) {
		const best = bestOf(now.draft);
		if (best) {
			logEvent({
				type: "draft",
				text: `Mock draft scorecard: <a href="${url(season)}">${boardKeyName(best.key)}</a> had ${best.line.hits} of the ${best.line.n} first-round picks in its top ${g.get("numActiveTeams")}, best of the draft outlets (off by ${best.line.mae} spots on average).`,
				showNotification: false,
				pids: [],
				tids: [],
				score: 0,
			});
		}
	}
	const old = history.find((x) => x.season === season - OUTCOME_SEASONS);
	if (old?.outcome) {
		const best = bestOf(old.outcome);
		if (best) {
			const you = old.outcome.you;
			logEvent({
				type: "draft",
				text: `Three years on, <a href="${url(old.season)}">${boardKeyName(best.key)}'s ${old.season} big board</a> aged best of the outlets (its top ${g.get("numActiveTeams")} off by ${best.line.mae} spots from where the class finished${you ? `; your board: ${you.mae}` : ""}).`,
				showNotification: false,
				pids: [],
				tids: [],
				score: 0,
			});
		}
	}
};

// One prospect's place on each outlet's board (his pre-draft page)
export const getPlayerOutletRanks = async (p: Player) => {
	if (!draftOutletsOn()) {
		return undefined;
	}
	const c = await getClassBoards(p.draft.year);
	const cons = c?.consensus.get(p.pid);
	if (!c || !cons) {
		return undefined;
	}
	return {
		draftYear: c.draftYear,
		edition: c.edition.label,
		consensus: cons,
		outlets: OUTLETS.map((o) => ({
			name: o.name,
			short: o.short,
			lean: o.lean,
			rank: c.boards.get(o.id)?.get(p.pid),
			prev: c.prevBoards?.get(o.id)?.get(p.pid),
		})),
	};
};
