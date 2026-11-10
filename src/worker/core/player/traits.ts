import { finances } from "../index.ts";
import { g } from "../../util/index.ts";
import {
	completeTraitSeeds,
	driftTraitSeeds,
	generateTraitSeeds,
	scoutTrait,
	seedKey,
	seedForScore,
	traitEffects,
	traitScores,
	traitUncertainty,
	clampSeed,
	TRAIT_DEFINITIONS,
	proSeasonsPlayed,
	teamMentoring,
	mentorBonuses,
	MENTEE_MAX_AGE,
	TRAIT_KEYS,
	aiTraitContractFactorFromSum,
	aiTraitSumFromZs,
	aiTeamTraitContext,
	traitZ,
	aiTraitValueFactorFromSum,
	residualTraitZs,
	scoreOne,
	agingCurveDelta,
	agingCurveForPlayer,
	centerDevelopment,
	egoTradeRequestMoodShift,
	egoTradeRequestProbMult,
	lockerRoomMood,
	workEthicZ,
	AGING_CURVE_INFO,
	type AgingCurve,
	type TraitDevelopment,
	type PlayerTraits,
	type ScoutedTrait,
	type TraitEffects,
	type TraitKey,
	type TraitRatings,
	type TraitScores,
} from "../../../common/playerTraits/index.ts";
import { PLAYER } from "../../../common/constants.ts";
import type { NonEmptyArray } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";

type TraitPlayer = {
	pid?: number;
	traits?: PlayerTraits;
	born: { year: number };
	draft: { year: number; tid?: number };
	tid?: number;
	ratings: NonEmptyArray<{ season: number } & TraitRatings>;
	stats?: {
		season: number;
		tid?: number;
		playoffs?: boolean;
		gp?: number;
	}[];
};

export const traitsEnabled = () =>
	__SPORT === "basketball" && !!g.get("playerTraits");

export const getLeagueTraitSeed = () =>
	(__SPORT === "basketball" ? g.get("playerTraitsSeed") : 0) ?? 0;

// Years since the draft. Works for random-player leagues too, where players have no stats rows before the league starts. Draft prospects have 0.
export const getTraitExperience = (p: TraitPlayer, season = g.get("season")) =>
	p.tid === PLAYER.UNDRAFTED
		? 0
		: Math.max(0, season - (p.draft.year ?? season));

const getAge = (p: TraitPlayer, season: number) => season - p.born.year;

// Completed pro seasons played (veteran savvy). Prospects 0.
export const getTraitProSeasons = (p: TraitPlayer, season = g.get("season")) =>
	p.tid === PLAYER.UNDRAFTED
		? 0
		: proSeasonsPlayed({
				p,
				season,
				startingSeason: g.get("startingSeason"),
			});

const getContext = (p: TraitPlayer, season: number) => ({
	age: getAge(p, season),
	experience: getTraitExperience(p, season),
	proSeasons: getTraitProSeasons(p, season),
});

// Seeds for a player, without writing anything. Missing seeds are derived from the league seed and pid, so the answer is the same every time.
export const getTraitSeeds = (p: TraitPlayer) =>
	completeTraitSeeds(p.traits, getLeagueTraitSeed(), p.pid ?? 0);

// Create p.traits if it is missing or partial. Safe to call as often as you like. Returns true if p changed.
export const ensureTraits = (p: TraitPlayer & { pid: number }) => {
	// Nothing is stored while the Player Traits setting is off: missing seeds are derived from the league seed and pid when it's turned on
	if (__SPORT !== "basketball" || !traitsEnabled()) {
		return false;
	}
	// Also repairs junk from a hand-edited league file (non-numbers, out of range)
	const next = completeTraitSeeds(p.traits, getLeagueTraitSeed(), p.pid);
	const same = TRAIT_KEYS.every(
		(key) => p.traits?.[seedKey(key)] === next[seedKey(key)],
	);
	if (same) {
		return false;
	}
	p.traits = next;
	return true;
};

// New players (draft prospects, league creation): seeds from league seed + pid
export const initTraits = (p: TraitPlayer & { pid: number }) => {
	// Nothing is stored while the Player Traits setting is off: missing seeds are derived from the league seed and pid when it's turned on
	if (__SPORT !== "basketball" || !traitsEnabled()) {
		return;
	}
	p.traits = generateTraitSeeds(getLeagueTraitSeed(), p.pid);
};

export const getPlayerTraitScores = (
	p: TraitPlayer,
	season = g.get("season"),
): TraitScores => {
	const ratings = last(p.ratings);
	return traitScores(ratings, getTraitSeeds(p), getContext(p, season));
};

// For the game sim: the effects for a player, or undefined when the Player Traits setting is off (the sim must then behave exactly as it did before traits existed). The sim should call this once per player per game, not per possession.
export const getSimTraitEffects = (
	p: TraitPlayer,
	season = g.get("season"),
): TraitEffects | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	return traitEffects(getPlayerTraitScores(p, season));
};

// For the injury code: multiply a player's injury rate by this. 1 when the Player Traits setting is off, so injuries are exactly as before. Mean 1 across a league, 0.7-1.3 for one player.
export const getTraitInjuryRateMultiplier = (
	p: TraitPlayer,
	season = g.get("season"),
) => getSimTraitEffects(p, season)?.injuryRateMultiplier ?? 1;

// Preseason development: traits drift a little each year (mean-reverting random walk, deterministic). Age and experience effects are already part of the scores themselves.
export const developTraits = (
	p: TraitPlayer & { pid: number },
	season = g.get("season"),
) => {
	if (__SPORT !== "basketball" || !traitsEnabled()) {
		return;
	}
	p.traits = driftTraitSeeds(
		p.traits ?? {},
		getLeagueTraitSeed(),
		p.pid,
		season,
	);
};

export type PlayerTraitsForUI = {
	enabled: true;
	// The aging curve is secret: only set for a retired player (revealed on retirement), never for anyone else
	agingCurve?: {
		curve: AgingCurve;
		name: string;
		description: string;
	};
	// What to show (estimates for prospects)
	traits: ScoutedTrait[];
	scores: Record<TraitKey, number>;
	isProspect: boolean;
	// For the God Mode editor: exact current scores
	exactScores?: Record<TraitKey, number>;
};

// Everything the UI needs about a player's traits. scoutingLevel is the user team's scouting budget level. Without God Mode, prospects get estimates with uncertainty and young pros' hidden traits are partly hidden.
export const getPlayerTraitsForUI = (
	p: TraitPlayer & { pid: number },
	{
		scoutingLevel,
		season = g.get("season"),
		godMode = !!g.get("godMode"),
		includeExact = false,
	}: {
		scoutingLevel?: number;
		season?: number;
		godMode?: boolean;
		includeExact?: boolean;
	} = {},
): PlayerTraitsForUI | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	const exact = getPlayerTraitScores(p, season);
	const isProspect = p.tid === PLAYER.UNDRAFTED;
	const experience = getTraitExperience(p, season);
	const traits: ScoutedTrait[] = TRAIT_KEYS.map((key) =>
		scoutTrait({
			key,
			trueScore: exact[key],
			sd: traitUncertainty({
				key,
				isProspect,
				experience,
				scoutingLevel,
				godMode,
			}),
			leagueSeed: getLeagueTraitSeed(),
			pid: p.pid,
		}),
	);
	const scores = {} as Record<TraitKey, number>;
	for (const t of traits) {
		scores[t.key] = t.estimate;
	}
	return {
		enabled: true,
		agingCurve: getRevealedAgingCurve(p),
		traits,
		scores,
		isProspect,
		exactScores: includeExact ? exact : undefined,
	};
};

// The aging curve, for the worker only (development). Never send this to the UI: use getRevealedAgingCurve
const getAgingCurve = (p: { pid?: number }) =>
	agingCurveForPlayer(getLeagueTraitSeed(), p.pid ?? 0);

// The aging curve as the user may see it: only once he has retired (otherwise undefined, also in God Mode)
export const getRevealedAgingCurve = (p: TraitPlayer & { pid: number }) => {
	if (!traitsEnabled() || p.tid !== PLAYER.RETIRED) {
		return undefined;
	}
	const curve = getAgingCurve(p);
	return { curve, ...AGING_CURVE_INFO[curve] };
};

/**
 * Work ethic and aging curve, for newPhasePreseason before players develop. players: every player developing this preseason, ratings still
 * last season's. newSeason: the season being started. Returns pid -> development plan to pass to player.develop, centered on these players so
 * the league as a whole develops exactly as much as without traits (no rating inflation). Empty when the setting is off.
 */
export const getTraitDevelopment = (
	players: (TraitPlayer & { pid: number })[],
	newSeason: number,
): Map<number, TraitDevelopment> => {
	if (!traitsEnabled()) {
		return new Map();
	}
	const rows = players.map((p) => {
		const age = newSeason - p.born.year;
		const score = getPlayerTraitScores(p, newSeason - 1).workEthic;
		return {
			pid: p.pid,
			age,
			workEthicZ: workEthicZ(score),
			agingDelta: agingCurveDelta(getAgingCurve(p), age),
		};
	});
	return centerDevelopment(rows);
};

// Ego score from the seed alone (ego has no ratings or age part), cheap enough for mood, which runs often
export const getEgoScore = (p: TraitPlayer) =>
	scoreOne("ego", {}, getTraitSeeds(p).egoSeed);

// The "Locker room" mood component for a player on (or considering) team tid, from his would-be teammates' egos. 0 when traits are off.
export const getLockerRoomMood = (
	p: { pid: number },
	teammates: TraitPlayer[],
) => {
	if (!traitsEnabled()) {
		return 0;
	}
	return lockerRoomMood(
		teammates.filter((p2) => p2.pid !== p.pid).map((p2) => getEgoScore(p2)),
	);
};

// Trade requests: his ego moves the mood at which he asks and the chance he asks. Neutral when traits are off.
export const getEgoTradeRequestInfo = (p: TraitPlayer) => {
	if (!traitsEnabled()) {
		return { moodShift: 0, probMult: 1 };
	}
	const ego = getEgoScore(p);
	return {
		moodShift: egoTradeRequestMoodShift(ego),
		probMult: egoTradeRequestProbMult(ego),
	};
};

// God Mode edit: set traits from wanted 0-100 scores by moving the stored seeds. Scores not given are left alone.
export const setTraitScores = (
	p: TraitPlayer & { pid: number },
	wanted: Partial<Record<TraitKey, number>>,
	season = g.get("season"),
) => {
	const seeds = { ...getTraitSeeds(p) };
	const ratings = last(p.ratings);
	const context = getContext(p, season);
	for (const key of TRAIT_KEYS) {
		const score = wanted[key];
		if (score === undefined || !Number.isFinite(score)) {
			continue;
		}
		seeds[seedKey(key)] = clampSeed(
			seedForScore(key, ratings, Math.max(0, Math.min(100, score)), context),
		);
	}
	p.traits = seeds;
};

// The user team's scouting level, for trait-based skill badges in player.format (which is synchronous per player). Loaded
// by loadBadgeScoutingLevel before formatting, so badges use the same trait estimates as the trait ranges the user sees.
let badgeScoutingLevel: number | undefined;
export const loadBadgeScoutingLevel = async () => {
	badgeScoutingLevel = traitsEnabled()
		? await finances.getLevelLastThree("scouting", { tid: g.get("userTid") })
		: undefined;
};
export const getBadgeScoutingLevel = () => badgeScoutingLevel;

// For skill badges: the trait scores the user can see. Visible traits use the shown estimate; hidden traits only once they are known exactly (otherwise left out, so no badge can leak them). Undefined when traits are off.
export const getBadgeTraits = (
	p: TraitPlayer & { pid: number },
	season: number,
	scoutingLevel?: number,
): Partial<Record<TraitKey, number>> | undefined => {
	const info = getPlayerTraitsForUI(p, { season, scoutingLevel });
	if (!info) {
		return undefined;
	}
	const out: Partial<Record<TraitKey, number>> = {};
	for (const t of info.traits) {
		if (t.exact || TRAIT_DEFINITIONS[t.key].visibility === "visible") {
			out[t.key] = t.estimate;
		}
	}
	return out;
};

/**
 * Mentoring (veteran savvy), for newPhasePreseason before players develop. players: every non-retired player, ratings still last season's. newSeason: the season being
 * started. Returns pid -> progression bonus (ovr points in expectation, +-0.5) for young players (age <= 23 in newSeason) on a team; pass it to player.develop. Centered
 * so the league-wide average over those players is 0 (no rating inflation). Empty when the setting is off.
 */
export const getMentorBonuses = (
	players: (TraitPlayer & { pid: number; tid: number })[],
	newSeason: number,
) => {
	const output = new Map<number, number>();
	if (!traitsEnabled()) {
		return output;
	}
	const scoresByTid = new Map<number, number[]>();
	const menteesByTid = new Map<number, number>();
	for (const p of players) {
		if (p.tid < 0) {
			continue;
		}
		if (newSeason - p.born.year <= MENTEE_MAX_AGE) {
			menteesByTid.set(p.tid, (menteesByTid.get(p.tid) ?? 0) + 1);
		} else {
			const score = getPlayerTraitScores(p, newSeason - 1).veteranSavvy;
			const list = scoresByTid.get(p.tid) ?? [];
			list.push(score);
			scoresByTid.set(p.tid, list);
		}
	}
	const raw = new Map<number, number>();
	for (const [tid, scores] of scoresByTid) {
		raw.set(tid, teamMentoring(scores));
	}
	const byTid = mentorBonuses(raw, menteesByTid);
	for (const p of players) {
		if (p.tid >= 0 && newSeason - p.born.year <= MENTEE_MAX_AGE) {
			output.set(p.pid, byTid.get(p.tid) ?? 0);
		}
	}
	return output;
};

const HIDDEN_TRAIT_KEYS: ReadonlySet<TraitKey> = new Set(
	TRAIT_KEYS.filter((key) => TRAIT_DEFINITIONS[key].visibility === "hidden"),
);

// A team's roster as the AI trait valuation sees it: who is young enough to mentor, and the ego and temper of everyone in the locker room
export type AiTraitTeamContext = {
	numYoung: number;
	lockerRoom: { pid: number; egoZ: number; temperZ: number }[];
};

type AiTraitValueOptions = {
	strategy?: "contending" | "rebuilding";
	numYoung?: number;
	// The team valuing him, from getAiTraitTeamContext (sets numYoung too): its locker room changes how much ego and temper matter
	team?: AiTraitTeamContext;
	// Contract demands: damped, no team context
	contract?: boolean;
	season?: number;
};

// The part of getAiTraitValueFactor that only depends on the player (not on the team valuing him)
const prepareAiTraitValue = (
	p: TraitPlayer & { pid: number },
	season: number,
) => {
	const isProspect = p.tid === PLAYER.UNDRAFTED;
	let scores = getPlayerTraitScores(p, season);
	if (isProspect) {
		const experience = getTraitExperience(p, season);
		const scouted = {} as TraitScores;
		for (const key of TRAIT_KEYS) {
			scouted[key] = scoutTrait({
				key,
				trueScore: scores[key],
				sd: traitUncertainty({ key, isProspect, experience }),
				leagueSeed: getLeagueTraitSeed(),
				pid: p.pid,
			}).estimate;
		}
		scores = scouted;
	}
	return {
		scores,
		zs: residualTraitZs(scores, last(p.ratings)),
		age: getAge(p, season),
		isProspect,
		pid: p.pid,
	};
};

const aiTraitValueFromPrepared = (
	prepared: ReturnType<typeof prepareAiTraitValue>,
	{ strategy, numYoung, team, contract = false }: AiTraitValueOptions,
) => {
	const sum = aiTraitSumFromZs(prepared.zs, prepared.scores, {
		age: prepared.age,
		strategy,
		numYoung: team?.numYoung ?? numYoung,
		// His teammates only: if he is on this team, he does not count against (or for) himself, so the team values him the same
		// whether he is coming or going
		...(team
			? aiTeamTraitContext(
					team.lockerRoom,
					team.lockerRoom.findIndex((t) => t.pid === prepared.pid),
				)
			: undefined),
		isProspect: prepared.isProspect,
		hiddenKeys: HIDDEN_TRAIT_KEYS,
	});
	return contract
		? aiTraitContractFactorFromSum(sum)
		: aiTraitValueFactorFromSum(sum);
};

/**
 * AI valuation: multiply a player's (positive) value by this. Exactly 1 when the Player Traits setting is off. AI teams know pros' true traits (they have
 * scouts and medical staff), but a draft prospect is only known through the same fixed scouting error the default-budget user sees, with hidden traits
 * counting half. Bounded to +-AI_TRAIT_MAX_ADJ and centered at 1 (see common/playerTraits/aiValue.ts).
 */
export const getAiTraitValueFactor = (
	p: TraitPlayer & { pid: number },
	options: AiTraitValueOptions = {},
) => {
	if (!traitsEnabled()) {
		return 1;
	}
	return aiTraitValueFromPrepared(
		prepareAiTraitValue(p, options.season ?? g.get("season")),
		options,
	);
};

// getAiTraitValueFactor with the per-player part remembered (per player object). Only for a short scope in which
// nobody's ratings or traits change (one AI trade pass, one free agency pass, one view request): AI trades and free
// agency value the same players many times over, for many teams.
export const makeAiTraitValueFactorCache = () => {
	const cache = new WeakMap<
		object,
		Map<string, ReturnType<typeof prepareAiTraitValue>>
	>();
	const getPrepared = (p: TraitPlayer & { pid: number }, season: number) => {
		const key = `${season}|${p.tid === PLAYER.UNDRAFTED ? 1 : 0}`;
		let byKey = cache.get(p);
		if (!byKey) {
			byKey = new Map();
			cache.set(p, byKey);
		}
		let prepared = byKey.get(key);
		if (!prepared) {
			prepared = prepareAiTraitValue(p, season);
			byKey.set(key, prepared);
		}
		return prepared;
	};
	const getFactor = (
		p: TraitPlayer & { pid: number },
		options: AiTraitValueOptions = {},
	) => {
		if (!traitsEnabled()) {
			return 1;
		}
		return aiTraitValueFromPrepared(
			getPrepared(p, options.season ?? g.get("season")),
			options,
		);
	};
	// getAiTraitTeamContext, sharing the per-player work
	getFactor.teamContext = (
		players: (TraitPlayer & { pid: number })[],
		season: number = g.get("season"),
	) =>
		teamContextFromPrepared(
			players,
			season,
			players.map((p) => getPrepared(p, season).scores),
		);
	return getFactor;
};

const teamContextFromPrepared = (
	players: (TraitPlayer & { pid: number })[],
	season: number,
	scores: TraitScores[],
): AiTraitTeamContext => ({
	numYoung: countMentees(players, season),
	lockerRoom: players.map((p, i) => ({
		pid: p.pid,
		egoZ: traitZ(scores[i]!.ego),
		temperZ: traitZ(scores[i]!.temper),
	})),
});

/**
 * A team's roster, for the `team` option of getAiTraitValueFactor: AI teams value ego and temper by who is already in the locker room (see
 * AI_TEAM_TRAIT_CONTEXT). AI teams know their own players' true traits. undefined when the Player Traits setting is off.
 */
export const getAiTraitTeamContext = (
	players: (TraitPlayer & { pid: number })[],
	season: number = g.get("season"),
): AiTraitTeamContext | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	return teamContextFromPrepared(
		players,
		season,
		players.map((p) => getPlayerTraitScores(p, season)),
	);
};

// Number of a team's players young enough to be mentored, for getAiTraitValueFactor
export const countMentees = (
	players: { born: { year: number } }[],
	season = g.get("season"),
) => players.filter((p) => season - p.born.year <= MENTEE_MAX_AGE).length;

/**
 * Trait scores by season, for the Traits page: his current personality (seeds) with the ratings, age and experience of each season, so it
 * shows how his ratings and age moved the traits. Only for the keys given (the ones the user can see exactly right now, so nothing leaks).
 * Seeds themselves are not stored per season.
 */
export const getTraitHistory = (
	p: TraitPlayer & { pid: number },
	keys: TraitKey[],
) => {
	if (!traitsEnabled() || keys.length === 0) {
		return [];
	}
	const seeds = getTraitSeeds(p);
	const bySeason = new Map<number, TraitRatings & { season: number }>();
	for (const row of p.ratings) {
		if (row.season >= p.draft.year) {
			bySeason.set(row.season, row);
		}
	}
	const output: {
		season: number;
		age: number;
		scores: Partial<TraitScores>;
	}[] = [];
	for (const [season, ratings] of bySeason) {
		const all = traitScores(ratings, seeds, getContext(p, season));
		const scores: Partial<TraitScores> = {};
		for (const key of keys) {
			scores[key] = all[key];
		}
		output.push({ season, age: getAge(p, season), scores });
	}
	return output.sort((a, b) => a.season - b.season);
};
