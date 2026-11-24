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
	centerDevelopment,
	egoTradeRequestMoodShift,
	egoTradeRequestProbMult,
	lockerRoomMoodFromSums,
	lockerRoomWeight,
	personalityTradeRequestProbMult,
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
import { agingCurveOf, ensureTrajectorySeed } from "./trajectory.ts";

type TraitPlayer = {
	pid?: number;
	traits?: PlayerTraits;
	trajectorySeed?: number;
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

// The league seed for personality trait seeds only (generated and drifted p.traits): playerTraitsSeed with the league's personality salt,
// when it has one (see GameAttributesLeague.personalityTraitsSalt). Exactly playerTraitsSeed without a salt, so nothing moves in leagues
// without one. Trajectories, aging, scouting noise and mentoring keep reading getLeagueTraitSeed.
export const getPersonalityTraitSeed = (): number | string => {
	const seed = getLeagueTraitSeed();
	const salt =
		__SPORT === "basketball" && Object.hasOwn(g, "personalityTraitsSalt")
			? (g.get("personalityTraitsSalt") ?? 0)
			: 0;
	return typeof salt === "number" && salt !== 0 ? `${seed}|ps${salt}` : seed;
};

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
	completeTraitSeeds(p.traits, getPersonalityTraitSeed(), p.pid ?? 0);

// Create p.traits if it is missing or partial. Safe to call as often as you like. Returns true if p changed.
export const ensureTraits = (p: TraitPlayer & { pid: number }) => {
	// Nothing is stored while the Player Traits setting is off: missing seeds are derived from the league seed and pid when it's turned on
	if (__SPORT !== "basketball" || !traitsEnabled()) {
		return false;
	}
	// Also repairs junk from a hand-edited league file (non-numbers, out of range)
	const next = completeTraitSeeds(p.traits, getPersonalityTraitSeed(), p.pid);
	const same = TRAIT_KEYS.every(
		(key) => p.traits?.[seedKey(key)] === next[seedKey(key)],
	);
	const trajectoryChanged = ensureTrajectorySeed(p);
	if (same) {
		return trajectoryChanged;
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
	p.traits = generateTraitSeeds(getPersonalityTraitSeed(), p.pid);
	ensureTrajectorySeed(p);
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

// perf3: the game sim's effects, worked out once a week of games (`week`, from game/loadTeams) and again when he changes teams or
// his ratings row or trait seeds are replaced (God Mode). Within a season his scores move only with those, so this mostly saves
// the work; a change in something else (his pro seasons, when he plays his first game) waits for the next week
let weeklyEffects: {
	week: string;
	byPid: Map<
		number,
		{ tid: number; row: unknown; seeds: unknown; e: TraitEffects | undefined }
	>;
} = { week: "", byPid: new Map() };
// (off: every game, as before; for the sim benchmark's comparison)
let weeklyEffectsOn = true;
export const setWeeklyTraitEffects = (on: boolean) => {
	weeklyEffectsOn = on;
	weeklyEffects = { week: "", byPid: new Map() };
};
export const getSimTraitEffectsWeekly = (
	p: TraitPlayer & { pid: number; tid: number },
	week: string | undefined,
): TraitEffects | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	if (week === undefined || !weeklyEffectsOn) {
		return getSimTraitEffects(p);
	}
	if (weeklyEffects.week !== week) {
		weeklyEffects = { week, byPid: new Map() };
	}
	const row = last(p.ratings);
	const hit = weeklyEffects.byPid.get(p.pid);
	if (hit && hit.tid === p.tid && hit.row === row && hit.seeds === p.traits) {
		return hit.e;
	}
	const e = getSimTraitEffects(p);
	weeklyEffects.byPid.set(p.pid, { tid: p.tid, row, seeds: p.traits, e });
	return e;
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
		getPersonalityTraitSeed(),
		p.pid,
		season,
	);
	// (players from before it was stored get it here, the value they already had)
	ensureTrajectorySeed(p);
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

// The aging curve, for the worker only (development). Never send this to the UI: use getRevealedAgingCurve. From his stored trajectory
// seed, so it follows him to another league; without one, from the league seed and his pid as always (the same value)
const getAgingCurve = (p: { pid?: number; trajectorySeed?: number }) =>
	agingCurveOf({ pid: p.pid ?? 0, trajectorySeed: p.trajectorySeed });

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

type LockerRoomPlayer = TraitPlayer & {
	pid: number;
	value?: number;
	valueNoPot?: number;
};

// His weight in the locker room: his current value (lockerRoomWeight)
const lockerRoomValue = (p: LockerRoomPlayer) => p.valueNoPot ?? p.value ?? 0;

type LockerRoomTeam = {
	key: string;
	// The roster it was worked out for: player objects, their stored ego seeds and values (compared by identity/value)
	players: LockerRoomPlayer[];
	egoSeeds: (number | undefined)[];
	values: number[];
	// Weight and ego z of each, and their sums
	w: number[];
	z: number[];
	sumW: number;
	sumWZ: number;
};

// perf: moodInfo runs for every player and team many times over (free agency: every free agent with every team, every day), and the
// locker room is the same for all of them. Remembered per team, checked against the roster each time (same player objects in the same
// order, as the cache hands them back until one is replaced or the roster changes, with the same stored ego seed and value) and the league,
// season, phase and personality seed (which derive the seeds not stored yet), so it is never stale.
let lockerRoomCache = new Map<number, LockerRoomTeam>();
// (off: worked out every time, for the benchmark's comparison)
let lockerRoomCacheOn = true;
export const setLockerRoomCache = (on: boolean) => {
	lockerRoomCacheOn = on;
	lockerRoomCache = new Map();
};

const lockerRoomKey = () =>
	`${Object.hasOwn(g, "lid") ? g.get("lid") : ""}|${g.get("season")}|${g.get("phase")}|${getPersonalityTraitSeed()}`;

const buildLockerRoomTeam = (
	key: string,
	teammates: LockerRoomPlayer[],
): LockerRoomTeam => {
	const team: LockerRoomTeam = {
		key,
		players: teammates.slice(),
		egoSeeds: teammates.map((p) => p.traits?.egoSeed),
		values: teammates.map(lockerRoomValue),
		w: [],
		z: [],
		sumW: 0,
		sumWZ: 0,
	};
	for (const [i, p] of teammates.entries()) {
		const w = lockerRoomWeight(team.values[i]!);
		const z = traitZ(getEgoScore(p));
		team.w.push(w);
		team.z.push(z);
		team.sumW += w;
		team.sumWZ += w * z;
	}
	return team;
};

const getLockerRoomTeam = (
	teammates: LockerRoomPlayer[],
	tid: number | undefined,
) => {
	const key = lockerRoomKey();
	if (tid === undefined || !lockerRoomCacheOn) {
		return buildLockerRoomTeam(key, teammates);
	}
	const hit = lockerRoomCache.get(tid);
	if (
		hit &&
		hit.key === key &&
		hit.players.length === teammates.length &&
		teammates.every(
			(p, i) =>
				hit.players[i] === p &&
				hit.egoSeeds[i] === p.traits?.egoSeed &&
				hit.values[i] === lockerRoomValue(p),
		)
	) {
		return hit;
	}
	const team = buildLockerRoomTeam(key, teammates);
	lockerRoomCache.set(tid, team);
	return team;
};

/**
 * The "Locker room" mood component for a player on (or considering) team tid, from his would-be teammates' egos, each weighted by his
 * value share (lockerRoomWeight in common/playerTraits/ego.ts). teammates: the team's roster (he is left out if he is on it). Pass tid to
 * use the per-team cache. 0 when traits are off.
 */
export const getLockerRoomMood = (
	p: { pid: number },
	teammates: LockerRoomPlayer[],
	tid?: number,
) => {
	if (!traitsEnabled()) {
		return 0;
	}
	const team = getLockerRoomTeam(teammates, tid);
	let n = team.players.length;
	let sumW = team.sumW;
	let sumWZ = team.sumWZ;
	for (const [i, p2] of team.players.entries()) {
		if (p2.pid === p.pid) {
			n -= 1;
			sumW -= team.w[i]!;
			sumWZ -= team.w[i]! * team.z[i]!;
		}
	}
	return lockerRoomMoodFromSums(n, sumW, sumWZ);
};

/**
 * The teammates (not p himself) who pull his "Locker room" mood down the most, worst first, at most max of them: divas (ego below 50),
 * by weight x ego z. Only those isVisible allows (the UI passes the user's trait visibility, so a hidden ego is never given away).
 */
export const getLockerRoomWorstEgos = <T extends LockerRoomPlayer>(
	p: { pid: number },
	teammates: T[],
	tid: number | undefined,
	isVisible: (p2: T) => boolean,
	max = 2,
): T[] => {
	if (!traitsEnabled()) {
		return [];
	}
	const team = getLockerRoomTeam(teammates, tid);
	const candidates = team.players
		.map((p2, i) => ({ p2: p2 as T, c: team.w[i]! * team.z[i]! }))
		.filter(({ p2, c }) => c < 0 && p2.pid !== p.pid)
		.sort((a, b) => a.c - b.c);
	const output: T[] = [];
	for (const { p2 } of candidates) {
		if (output.length >= max) {
			break;
		}
		if (isVisible(p2)) {
			output.push(p2);
		}
	}
	return output;
};

// Can the user see this player's ego exactly (God Mode, or a hidden trait known after three seasons)? For naming divas in the mood panel.
export const isEgoKnownToUser = (
	p: TraitPlayer & { pid: number },
	scoutingLevel?: number,
) =>
	getPlayerTraitsForUI(p, { scoutingLevel })?.traits.find(
		(t) => t.key === "ego",
	)?.exact ?? false;

// Loyalty, role acceptance and money vs winning, from the seed and age alone (no ratings part), cheap enough for mood, which runs often
export const getPersonalityScores = (
	p: TraitPlayer,
	season = g.get("season"),
) => {
	const seeds = getTraitSeeds(p);
	const context = { age: getAge(p, season) };
	return {
		loyalty: scoreOne("loyalty", {}, seeds.loyaltySeed, context),
		roleAcceptance: scoreOne(
			"roleAcceptance",
			{},
			seeds.roleAcceptanceSeed,
			context,
		),
		moneyVsWinning: scoreOne(
			"moneyVsWinning",
			{},
			seeds.moneyVsWinningSeed,
			context,
		),
	};
};

// Trade requests: his ego moves the mood at which he asks and the chance he asks; loyalty and (when unhappy with his minutes) role
// acceptance move the chance too. Neutral when traits are off.
export const getEgoTradeRequestInfo = (
	p: TraitPlayer,
	{ playingTimeUnhappy = false }: { playingTimeUnhappy?: boolean } = {},
) => {
	if (!traitsEnabled()) {
		return { moodShift: 0, probMult: 1 };
	}
	const ego = getEgoScore(p);
	const personality = getPersonalityScores(p);
	return {
		moodShift: egoTradeRequestMoodShift(ego),
		probMult:
			egoTradeRequestProbMult(ego) *
			personalityTradeRequestProbMult(
				personality.loyalty,
				personality.roleAcceptance,
				playingTimeUnhappy,
			),
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
// Tagged with the league and user team it was read for, so a level from another league (or before switching teams) is never used;
// reset when the league closes and when the budget changes (resetBadgeScoutingLevel).
let badgeScoutingLevel: { key: string; level: number | undefined } | undefined;
const badgeScoutingKey = () => {
	try {
		return `${g.get("lid")}:${g.get("userTid")}`;
	} catch {
		return undefined;
	}
};
export const loadBadgeScoutingLevel = async () => {
	const key = badgeScoutingKey();
	const level = traitsEnabled()
		? await finances.getLevelLastThree("scouting", { tid: g.get("userTid") })
		: undefined;
	badgeScoutingLevel = key === undefined ? undefined : { key, level };
};
export const getBadgeScoutingLevel = () =>
	badgeScoutingLevel !== undefined &&
	badgeScoutingLevel.key === badgeScoutingKey()
		? badgeScoutingLevel.level
		: undefined;
export const resetBadgeScoutingLevel = () => {
	badgeScoutingLevel = undefined;
};

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
