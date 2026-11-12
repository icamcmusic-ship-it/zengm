// Draft Lottery Night & Combine setting (basketball), worker side: the draft combine of a class (held at the start of the draft
// lottery phase), its news, the AI draft nudge and the lottery night news. The combine itself is a pure function of each prospect
// (common/draftCombine.ts, its own seeded RNG), so nothing here draws from the game's random numbers and nothing is stored.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	combineNudges,
	combineRanks,
	generateDraftCombine,
	numCombineInvites,
	COMBINE_COLUMN_BY_KEY,
	type CombineKey,
	type DraftCombineInput,
	type DraftCombineResult,
} from "../../../common/draftCombine.ts";
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

type PlayerRatings = Player["ratings"][number] & Record<string, any>;

export const lotteryNightOn = () =>
	__SPORT === "basketball" && featureOn("lotteryNight");

// The combine of a class is held at the start of its draft lottery phase
export const combineHeld = (draftYear: number) => {
	const season = g.get("season");
	return (
		draftYear < season ||
		(draftYear === season && g.get("phase") >= PHASE.DRAFT_LOTTERY)
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

// Projected draft stock from his combine-time ratings, for the invite list and who skips the drills
const stock = (p: Player, r: PlayerRatings) =>
	r.pot + 0.5 * r.ovr - 1.5 * (p.draft.year - p.born.year - 19);

const toInput = (
	p: Player,
	r: PlayerRatings,
	rank: number,
): DraftCombineInput => {
	const x = r;
	const expanded = expandedRatingsApply(r);
	const injured =
		p.tid === PLAYER.UNDRAFTED
			? p.injury.gamesRemaining > 0
			: (p.injuries ?? []).some(
					(inj) => inj.season === p.draft.year && inj.games > 0,
				);
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
	const players =
		draftYear >= g.get("season")
			? (
					await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
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
	const players = (playersInput ?? (await classPlayersOf(draftYear)))
		.map((p) => ({ p, r: combineRatingsRow(p)! }))
		.filter((x) => x.r)
		.sort((a, b) => stock(b.p, b.r) - stock(a.p, a.r) || a.p.pid - b.p.pid);
	const numInvites = numCombineInvites(
		g.get("numActiveTeams") * Math.max(1, g.get("numDraftRounds")),
	);
	const invited = new Set<number>();
	const results = new Map<number, DraftCombineResult>();
	if (held) {
		for (const [i, { p, r }] of players.entries()) {
			if (i >= numInvites) {
				break;
			}
			invited.add(p.pid);
			results.set(p.pid, generateDraftCombine(toInput(p, r, i + 1)));
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

// One prospect's combine, with his ranks in the class. undefined when off, not held yet or not invited
export const getPlayerCombine = async (p: Player) => {
	if (!lotteryNightOn() || !combineHeld(p.draft.year)) {
		return undefined;
	}
	const c = await getClassCombine(p.draft.year);
	const result = c.results.get(p.pid);
	if (!result) {
		return { invited: false as const, n: c.results.size };
	}
	return {
		invited: true as const,
		result,
		ranks: c.ranks.get(p.pid) ?? {},
		n: c.results.size,
	};
};

/**
 * AI draft nudge (value points) for each prospect of this season's draft, averaging zero over the class. Empty when off or when
 * the combine was not held (fantasy and expansion drafts).
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
	return combineNudges(
		classPlayers.map((p) => p.pid),
		c.results,
	);
};

const playerLink = (p: Player) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

// News when the combine is held (start of the draft lottery phase)
export const afterNewPhase = async (phase: number, conditions?: Conditions) => {
	if (phase !== PHASE.DRAFT_LOTTERY || !lotteryNightOn()) {
		return;
	}
	const season = g.get("season");
	const c = await getClassCombine(season, undefined, true);
	if (c.results.size === 0) {
		return;
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
