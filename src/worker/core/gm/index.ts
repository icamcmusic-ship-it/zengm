// AI general managers (featureGmPersonalities, basketball only): generation, the weights AI decisions read, season expectations, firing
// after sustained failure and the GM carousel. GMs live on the team objects (t.gm, and t.formerGms for those who left the team), so
// they're exported/imported with the teams and need no database store. The user's teams have no GM unless the AI runs them in
// spectator mode: when the user takes a team over its GM leaves ("left"), and when he gives one up (or turns spectator mode on) it gets
// a new GM at once. Auto play changes nothing (the user's teams keep no GM and the AI runs them neutrally), so a GM is never hired or
// fired on a team the user is about to take back. With the setting off, getGmWeights returns undefined and every caller keeps its old
// behavior exactly.

import { PHASE } from "../../../common/constants.ts";
import {
	genGmTraits,
	gmFireProb,
	gmHotSeat,
	gmPathExpWon,
	gmProgressScore,
	gmRebuildWeight,
	gmSeasonScore,
	gmWeightsFromTraits,
	type GmWeights,
} from "../../../common/gmPersonality.ts";
import {
	gauss,
	makeSeededRandom,
	randInt,
	withRandom,
} from "../../../common/random.ts";
import { saltedSeed } from "../../../common/leagueSalt.ts";
import type {
	Gm,
	GmSeason,
	GmTenure,
	Team,
	TeamSeason,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { actualPhase } from "../../util/actualPhase.ts";
import { loadNames } from "../../util/loadNames.ts";
import { isCollege } from "../college/isCollege.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { generateFace } from "../../util/face.ts";
import name from "../player/name.ts";
import { league, season as seasonCore, team } from "../index.ts";
import { InvalidPlayoffSettingsError } from "../season/genPlayoffSeries.ts";
import { gmAnalyticsShift } from "../frontOffice/index.ts";
import {
	GM_FINANCE_STYLES,
	genGmFinanceStyle,
	isGmFinanceStyle,
} from "../../../common/gmFinance.ts";
import {
	gmFinanceEnabled,
	gmFinanceStyleOf,
	gmTraitShifts,
} from "./finance.ts";
import { getSeasonOdds } from "../seasonOdds/index.ts";
import { winProb } from "../seasonOdds/simSeason.ts";

export const gmEnabled = () =>
	__SPORT === "basketball" && featureOn("gmPersonalities");

// The user makes this team's decisions right now
export const userControlsTeam = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

// The team is the user's, even while auto play runs it for him: it has no AI GM, and none is hired or fired there
export const userOwnsTeam = (tid: number) =>
	g.get("userTids").includes(tid) && !g.get("spectator");

// Keyed by the traits object, which is never edited in place
const weightsCache = new WeakMap<Gm["traits"], GmWeights>();
// Front Office Budget: a GM whose team spends on analytics leans analytics (shift 0 when off); AI GM finance styles: his finance style
// shifts his tax tolerance and free agency traits (0 when off). Keyed by traits and shifts
const shiftedCache = new WeakMap<Gm["traits"], { key: string; w: GmWeights }>();
const clampTrait = (x: number) => Math.max(-1, Math.min(1, x));
const weightsOf = (gm: Gm, t?: Team) => {
	const shift = t ? gmAnalyticsShift(t) : 0;
	const finance = t ? gmTraitShifts(t) : { taxTolerance: 0, faStars: 0 };
	if (shift !== 0 || finance.taxTolerance !== 0 || finance.faStars !== 0) {
		const key = `${shift}|${finance.taxTolerance}|${finance.faStars}`;
		const cached = shiftedCache.get(gm.traits);
		if (cached && cached.key === key) {
			return cached.w;
		}
		const w = gmWeightsFromTraits({
			...gm.traits,
			analytics: clampTrait(gm.traits.analytics + shift),
			taxTolerance: clampTrait(gm.traits.taxTolerance + finance.taxTolerance),
			faStars: clampTrait(gm.traits.faStars + finance.faStars),
		});
		shiftedCache.set(gm.traits, { key, w });
		return w;
	}
	let w = weightsCache.get(gm.traits);
	if (!w) {
		w = gmWeightsFromTraits(gm.traits);
		weightsCache.set(gm.traits, w);
	}
	return w;
};

// Weights for an AI team's decisions, undefined (neutral, old behavior) when the setting is off, the user runs the team or it has no GM
export const getGmWeights = async (
	tid: number | undefined,
): Promise<GmWeights | undefined> => {
	if (tid === undefined || tid < 0 || !gmEnabled() || userControlsTeam(tid)) {
		return;
	}
	const t = await idb.cache.teams.get(tid);
	return t?.gm ? weightsOf(t.gm, t) : undefined;
};

// All AI teams' weights at once, for loops over teams
export const getAllGmWeights = async (): Promise<Map<number, GmWeights>> => {
	const map = new Map<number, GmWeights>();
	if (!gmEnabled()) {
		return map;
	}
	for (const t of await idb.cache.teams.getAll()) {
		if (t.gm && !t.disabled && !userControlsTeam(t.tid)) {
			map.set(t.tid, weightsOf(t.gm, t));
		}
	}
	return map;
};

const allGms = (teams: Team[]) => {
	const gms: Gm[] = [];
	for (const t of teams) {
		if (t.gm) {
			gms.push(t.gm);
		}
		if (t.formerGms) {
			gms.push(...t.formerGms);
		}
	}
	return gms;
};

// Over every team, contracted ones included (their former GMs keep their ids)
const nextGmid = (teams: Team[]) => {
	let max = -1;
	for (const gm of allGms(teams)) {
		max = Math.max(max, gm.gmid);
	}
	return max + 1;
};

const genGmBase = (
	gmid: number,
	{ country, firstName, lastName, race }: Awaited<ReturnType<typeof name>>,
): Gm => {
	const age = randInt(36, 60);
	const traits = genGmTraits(() => gauss(0, 1));
	return {
		gmid,
		firstName,
		lastName,
		born: {
			year: g.get("season") - age,
			loc: country,
		},
		face: generateFace({ race, age, staff: true }),
		traits,
		seasons: [],
		tenures: [],
	};
};

/**
 * A new GM. seeded: drawn from a stream keyed on his id instead of the main one, for hires outside the offseason carousel (a team the
 * user gave up, an expansion team), so they don't move the league's random numbers
 */
export const generateGm = async (
	gmid: number,
	{ seeded }: { seeded?: boolean } = {},
): Promise<Gm> => {
	let gm: Gm;
	if (seeded) {
		// With the names loaded, name() runs without awaiting anything, so Math.random can be swapped around the call
		if (local.playerBioInfo === undefined) {
			local.playerBioInfo = await loadNames();
		}
		const rng = makeSeededRandom(
			saltedSeed((Math.imul(gmid + 1, 0x5bd1e995) ^ 0x1b873593) >>> 0),
		);
		// Warm up the stream (mulberry32's first value from nearby seeds is correlated)
		rng();
		const orig = Math.random;
		let namePromise;
		Math.random = rng;
		try {
			namePromise = name();
		} finally {
			Math.random = orig;
		}
		const info = await namePromise;
		gm = withRandom(rng, () => genGmBase(gmid, info));
	} else {
		gm = genGmBase(gmid, await name());
	}
	// AI GM finance styles: seeded by his id, no main stream draws
	if (gmFinanceEnabled()) {
		gm.financeStyle = genGmFinanceStyle(gm);
	}
	return gm;
};

// AI GM finance styles: give every GM without a style one (existing leagues, the feature just turned on), derived from his id. Returns
// whether anything changed
const ensureFinanceStyles = async (teams: Team[]) => {
	if (!gmFinanceEnabled()) {
		return false;
	}
	let changed = false;
	for (const t of teams) {
		let teamChanged = false;
		for (const gm of [...(t.gm ? [t.gm] : []), ...(t.formerGms ?? [])]) {
			if (!isGmFinanceStyle(gm.financeStyle)) {
				gm.financeStyle = genGmFinanceStyle(gm);
				teamChanged = true;
			}
		}
		if (teamChanged) {
			changed = true;
			await idb.cache.teams.put(t);
		}
	}
	return changed;
};

// " a frugal GM" style text for news, "" when off
const financeText = (gm: Gm) => {
	const style = gmFinanceStyleOf(gm);
	if (!style) {
		return "";
	}
	const adjective = GM_FINANCE_STYLES[style].adjective;
	return `, ${/^[aeiou]/i.test(adjective) ? "an" : "a"} ${adjective} GM,`;
};

const teamName = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return info ? `${info.region} ${info.name}` : "a team";
};

const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	if (!info) {
		return "a team";
	}
	return `the <a href="/l/${g.get("lid")}/roster/${info.abbrev}_${tid}">${info.region} ${info.name}</a>`;
};

const gmLink = (gm: Gm) =>
	`<a href="/l/${g.get("lid")}/gm/${gm.gmid}">${gm.firstName} ${gm.lastName}</a>`;

// College mode has no Executive of the Year and no "general managers" (athletic directors don't get fired in the news), so no news there
const logGmEvent = async (text: string, tids: number[], score = 0) => {
	if (isCollege()) {
		return;
	}
	await logEvent({
		type: "info",
		text,
		showNotification: false,
		tids,
		score,
	});
};

// Season a GM hired now starts counting in: once the playoffs have started (or in an expansion/fantasy draft after them), next season
const startSeason = () =>
	actualPhase() >= PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

// The AI runs one of the user's teams because spectator mode is on
const spectatorRunsTeam = (tid: number) =>
	g.get("spectator") && g.get("userTids").includes(tid);

const hireGm = (
	t: Team,
	gm: Gm,
	initial?: boolean,
	start: number = startSeason(),
) => {
	const tenure: GmTenure = initial
		? { tid: t.tid, start, initial: true }
		: { tid: t.tid, start };
	// Hired while the regular season is being played (a team the user gave up, an expansion team), not in an offseason
	const phase = actualPhase();
	if (
		!initial &&
		start === g.get("season") &&
		(phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE)
	) {
		tenure.midSeason = true;
	}
	gm.tenures.push(tenure);
	gm.hotSeat = undefined;
	gm.expWon = undefined;
	gm.retiredYear = undefined;
	gm.spectatorFor = spectatorRunsTeam(t.tid) ? t.tid : undefined;
	t.gm = gm;
};

const currentTenure = (gm: Gm) => gm.tenures.at(-1);

const isTitle = (row: GmSeason) =>
	row.playoffRoundsWon >= 0 &&
	row.playoffRoundsWon >= g.get("numGamesPlayoffSeries", row.season).length;

// A retired GM's season rows become his career totals (tenures and awards are kept, for the history pages and Executive of the Year)
const pruneRetired = (gm: Gm) => {
	if (gm.retiredYear === undefined || gm.seasons.length === 0) {
		return false;
	}
	const career = gm.career ?? {
		seasons: 0,
		won: 0,
		lost: 0,
		tied: 0,
		otl: 0,
		playoffs: 0,
		titles: 0,
	};
	for (const row of gm.seasons) {
		career.seasons += 1;
		career.won += row.won;
		career.lost += row.lost;
		career.tied += row.tied;
		career.otl += row.otl;
		if (row.playoffRoundsWon >= 0) {
			career.playoffs += 1;
		}
		if (isTitle(row)) {
			career.titles += 1;
		}
	}
	gm.career = career;
	// Each job's record too, for his profile's tenures
	for (const tenure of gm.tenures) {
		const rows = gm.seasons.filter(
			(row) =>
				row.tid === tenure.tid &&
				row.season >= tenure.start &&
				row.season <= (tenure.end ?? Infinity),
		);
		if (rows.length === 0) {
			continue;
		}
		const record = tenure.record ?? {
			won: 0,
			lost: 0,
			tied: 0,
			otl: 0,
			playoffs: 0,
			titles: 0,
		};
		for (const row of rows) {
			record.won += row.won;
			record.lost += row.lost;
			record.tied += row.tied;
			record.otl += row.otl;
			if (row.playoffRoundsWon >= 0) {
				record.playoffs += 1;
			}
			if (isTitle(row)) {
				record.titles += 1;
			}
		}
		tenure.record = record;
	}
	gm.seasons = [];
	return true;
};

const retire = (gm: Gm, season: number) => {
	gm.retiredYear = season;
	gm.face = undefined;
	pruneRetired(gm);
};

/**
 * Leaves his team: fired or retired after the playoffs, or "left" (the user took the team over, or it was contracted). He goes on the
 * team's list of former GMs, where the carousel finds him. season is his last season, by default (for "left") the last one he ran: this
 * one once the playoffs have started, else the one before (never before his first)
 */
export const leaveTeam = (
	t: Team,
	reason: "fired" | "retired" | "left",
	season: number = startSeason() - 1,
) => {
	const gm = t.gm;
	if (!gm) {
		return;
	}
	const tenure = currentTenure(gm);
	if (tenure && tenure.end === undefined) {
		tenure.end = Math.max(season, tenure.start - 1);
		tenure.reason = reason;
	}
	gm.expWon = undefined;
	gm.spectatorFor = undefined;
	if (reason === "retired") {
		retire(gm, season);
	}
	t.formerGms = [...(t.formerGms ?? []), gm];
	t.gm = undefined;
};

// The GM who ran one of the user's teams in spectator mode and stepped aside when the user took it back, if he's still there to
// step in again (not hired elsewhere, not retired)
const parkedSpectatorGm = (t: Team) =>
	t.formerGms?.find(
		(gm) => gm.spectatorFor === t.tid && gm.retiredYear === undefined,
	);

/**
 * Give every AI team without a GM one (new leagues, turning the setting on, expansion teams, a team the user gave up), and take the GM
 * away from a team the user took over or one that was contracted ("left"). Called at the moment the user's teams change (league
 * setGameAttributes), when a team is added or contracted, and at the phases the GMs matter
 */
export const ensureGms = async () => {
	if (!gmEnabled()) {
		return false;
	}
	const teams = await idb.cache.teams.getAll();
	const firstTime = allGms(teams).length === 0;
	let changed = await ensureFinanceStyles(teams);

	for (const t of teams) {
		const gm = t.gm;
		if (gm && (t.disabled || userOwnsTeam(t.tid))) {
			// Spectator mode turned off: the GM who ran the team for it steps aside, to step in again the next time it's turned on. A
			// stint that covered no season of his own leaves no tenure and no news, so toggling spectator mode doesn't churn GMs
			const caretaker = !t.disabled && gm.spectatorFor === t.tid;
			const tenure = currentTenure(gm);
			if (
				caretaker &&
				tenure &&
				tenure.end === undefined &&
				tenure.start > startSeason() - 1
			) {
				gm.tenures.pop();
				gm.expWon = undefined;
				gm.hotSeat = undefined;
				t.formerGms = [...(t.formerGms ?? []), gm];
				t.gm = undefined;
				await idb.cache.teams.put(t);
				changed = true;
				continue;
			}
			// A contracted team's GM left after its last season (older leagues kept him on the team, maybe for years)
			const lastRow = t.disabled
				? gm.seasons.findLast((row) => row.tid === t.tid)?.season
				: undefined;
			leaveTeam(t, "left", Math.min(startSeason() - 1, lastRow ?? Infinity));
			if (caretaker) {
				gm.spectatorFor = t.tid;
			}
			await idb.cache.teams.put(t);
			changed = true;
			if (!t.disabled) {
				await logGmEvent(
					`General manager ${gmLink(gm)} left ${teamLink(t.tid)}.`,
					[t.tid],
				);
			}
		}
	}

	let gmid = nextGmid(teams);
	const successor = getGmSuccessor();
	for (const t of teams) {
		if (t.disabled || t.gm || userOwnsTeam(t.tid)) {
			continue;
		}
		// The successor the user picked when he was fired, if he is still on the market
		const picked =
			successor?.tid === t.tid
				? takeFromMarket(teams, successor.gmid, t.tid)
				: undefined;
		// Else the GM who ran it in spectator mode before, back again
		const parked = picked ? undefined : parkedSpectatorGm(t);
		if (parked) {
			t.formerGms = t.formerGms!.filter((x) => x !== parked);
		}
		const gm =
			picked ?? parked ?? (await generateGm(gmid, { seeded: !firstTime }));
		if (!picked && !parked) {
			gmid += 1;
		}
		hireGm(t, gm, firstTime);
		await idb.cache.teams.put(t);
		changed = true;
		if (parked) {
			// Spectator mode turned on again: the same GM, no news
			if (!spectatorRunsTeam(t.tid)) {
				await logGmEvent(
					`${teamLink(t.tid)} named ${gmLink(gm)}${financeText(gm)} general manager.`,
					[t.tid],
				);
			}
		} else if (picked) {
			await logGmEvent(
				`${teamLink(t.tid)} named ${gmLink(gm)}${financeText(gm)} general manager, the successor picked by the general manager they fired.`,
				[t.tid],
				5,
			);
		} else if (!firstTime) {
			await logGmEvent(
				`${teamLink(t.tid)} named ${gmLink(gm)}${financeText(gm)} general manager.`,
				[t.tid],
			);
		}
	}
	if (successor && !userOwnsTeam(successor.tid)) {
		await league.setGameAttributes({ gmSuccessor: undefined });
	}
	return changed;
};

// ---- Picking your successor when fired --------------------------------------

export const getGmSuccessor = () => {
	try {
		return g.get("gmSuccessor");
	} catch {
		return undefined;
	}
};

// Takes a GM off the market (out of his old team's former GMs) to hire him, undefined if he's not on the market or ran this team before
const takeFromMarket = (teams: Team[], gmid: number, tid: number) => {
	for (const from of teams) {
		const gm = from.formerGms?.find((x) => x.gmid === gmid);
		if (gm) {
			if (!onGmMarket(gm) || gm.tenures.some((x) => x.tid === tid)) {
				return undefined;
			}
			from.formerGms = from.formerGms!.filter((x) => x !== gm);
			void idb.cache.teams.put(from);
			return gm;
		}
	}
	return undefined;
};

// The GMs the user can pick from when fired: the market, minus anyone who ran his team before
export const successorCandidates = async (tid: number) => {
	const teams = await idb.cache.teams.getAll();
	const out: Gm[] = [];
	for (const t of teams) {
		for (const gm of t.formerGms ?? []) {
			if (onGmMarket(gm) && !gm.tenures.some((x) => x.tid === tid)) {
				out.push(gm);
			}
		}
	}
	return out;
};

export const setGmSuccessor = async (gmid: number | undefined) => {
	const tid = g.get("userTid");
	if (!g.get("gameOver")) {
		throw new Error("You can only pick a successor after being fired.");
	}
	if (gmid === undefined) {
		await league.setGameAttributes({ gmSuccessor: undefined });
		return;
	}
	const candidates = await successorCandidates(tid);
	if (!candidates.some((gm) => gm.gmid === gmid)) {
		throw new Error("That general manager is not available.");
	}
	await league.setGameAttributes({ gmSuccessor: { tid, gmid } });
};

// The user's teams changed (taking a team over, giving one up, multi team mode, spectator mode), or a team was added or contracted:
// GMs leave or are hired at once. Only once the league has GMs (not while a league is being created)
export const syncGms = async () => {
	if (!gmEnabled()) {
		return;
	}
	if (allGms(await idb.cache.teams.getAll()).length === 0) {
		return;
	}
	await ensureGms();
};

// Expected wins for each team this season: the Season Odds projection when that's on, else the roster rating against the league average
const getExpectedWins = async () => {
	const numGames = g.get("numGames");
	const exp = new Map<number, number>();
	const odds = await getSeasonOdds();
	if (odds) {
		for (const row of odds.teams) {
			exp.set(row.tid, row.projWon);
		}
		return exp;
	}

	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = Map.groupBy(players, (p) => p.tid);
	const ratings = new Map<number, number>();
	for (const t of teams) {
		const ovr = team.ovr(
			(byTid.get(t.tid) ?? []).map((p) => {
				const r = p.ratings.at(-1)!;
				return {
					pid: p.pid,
					value: p.value,
					injury: p.injury,
					ratings: { ovr: r.ovr, ovrs: r.ovrs, pos: r.pos },
				};
			}),
		);
		ratings.set(t.tid, ((ovr - 50) * 15) / 50);
	}
	const mean =
		[...ratings.values()].reduce((a, b) => a + b, 0) /
		Math.max(1, ratings.size);
	for (const [tid, rating] of ratings) {
		exp.set(tid, winProb(rating - mean) * numGames);
	}
	return exp;
};

// Start of the regular season: write down what's expected of every GM
export const onRegularSeason = async () => {
	if (!gmEnabled()) {
		return;
	}
	await ensureGms();
	const exp = await getExpectedWins();
	for (const t of await idb.cache.teams.getAll()) {
		// ensureGms took the GM away from the user's teams, this is in case
		if (!t.gm || t.disabled || userOwnsTeam(t.tid)) {
			continue;
		}
		const expWon = exp.get(t.tid);
		t.gm.expWon =
			expWon !== undefined ? Math.round(expWon * 10) / 10 : undefined;
		await idb.cache.teams.put(t);
	}
};

// His seasons with his current team
export const seasonsWithTeam = (gm: Gm, tid: number) => {
	const tenure = currentTenure(gm);
	if (!tenure || tenure.tid !== tid || tenure.end !== undefined) {
		return [];
	}
	return gm.seasons.filter(
		(row) => row.tid === tid && row.season >= tenure.start,
	);
};

// The seasons he's judged on: his own full seasons with his current team (none from before he was hired, nor one he took over midway)
export const judgedSeasons = (gm: Gm, tid: number) =>
	seasonsWithTeam(gm, tid).filter((row) => !row.partial);

export const seasonScore = (row: GmSeason) =>
	gmSeasonScore({
		won: row.won,
		lost: row.lost,
		tied: row.tied,
		otl: row.otl,
		expWon: row.expWon,
		numGames: row.numGames,
		playoffRoundsWon: row.playoffRoundsWon,
		pathExpWon: row.pathExpWon,
		progress: row.progress,
		rebuildWeight: row.rebuildWeight,
	});

// Value of a team's best young players (25 and under), the core a rebuild is judged by
const youthValue = async (tid: number) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const season = g.get("season");
	const values = players
		.filter((p) => season - p.born.year <= 25)
		.map((p) => p.value)
		.sort((a, b) => b - a)
		.slice(0, 3);
	return values.length === 0
		? 0
		: values.reduce((a, b) => a + b, 0) / values.length;
};

/**
 * First round picks a team holds beyond its own, over the seasons that have picks right now (at most 4 of them counted, scaled): this
 * season's pick until the draft uses it, and then the seasons after it, up to the ones genPicks has made (numFuture seasons, moving on
 * a year after the draft). A team holding exactly its own picks is at 0 whatever the phase
 */
export const extraFirstRoundPicks = (
	picks: { round: number; season: number | string }[],
	{
		season,
		phase,
		numFuture,
	}: { season: number; phase: number; numFuture: number },
) => {
	if (numFuture <= 0) {
		return 0;
	}
	const from = phase >= PHASE.DRAFT ? season + 1 : season;
	const to = season + numFuture - 1 + (phase > PHASE.DRAFT ? 1 : 0);
	const numSeasons = to - from + 1;
	if (numSeasons <= 0) {
		return 0;
	}
	const firsts = picks.filter(
		(dp) =>
			dp.round === 1 &&
			typeof dp.season === "number" &&
			dp.season >= from &&
			dp.season <= to,
	).length;
	const counted = Math.min(numSeasons, 4);
	return (firsts * counted) / numSeasons - counted;
};

// Progress signals for the season just finished
const progressSignals = async (
	t: Team,
	prev: GmSeason | undefined,
	won: number,
	numGames: number,
) => {
	const youth = await youthValue(t.tid);
	const picks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		t.tid,
	);
	const season = g.get("season");
	// Cap room once this season's expiring contracts come off: the payroll he has committed for next season
	const payroll = await team.getPayroll(t.tid, season + 1);
	const salaryCap = g.get("salaryCap");
	const scale = 82 / Math.max(1, numGames);
	const progress = gmProgressScore({
		youthChange: prev?.youth !== undefined ? youth - prev.youth : 0,
		extraFirsts: extraFirstRoundPicks(picks, {
			season,
			phase: actualPhase(),
			numFuture:
				g.get("draftType") === "freeAgents"
					? 0
					: g.get("numSeasonsFutureDraftPicks"),
		}),
		capRoom: (salaryCap - payroll) / Math.max(1, salaryCap),
		winTrend: prev ? (won - prev.won) * scale : 0,
	});
	return { youth: Math.round(youth * 10) / 10, progress };
};

// Owner patience by market size: -1 (smallest market) to 1 (biggest)
const marketFactors = (teams: Team[]) => {
	const pops = teams.map((t) => t.pop ?? 1);
	const sorted = [...pops].sort((a, b) => a - b);
	const map = new Map<number, number>();
	for (const t of teams) {
		const rank = sorted.indexOf(t.pop ?? 1);
		map.set(
			t.tid,
			sorted.length > 1 ? (2 * rank) / (sorted.length - 1) - 1 : 0,
		);
	}
	return map;
};

// The row of a season he ran (the expectations, his improvement path and rebuild credit), from its record
const makeSeasonRow = async (
	t: Team,
	gm: Gm,
	record: Pick<
		GmSeason,
		"season" | "won" | "lost" | "tied" | "otl" | "playoffRoundsWon"
	>,
) => {
	const numGames = g.get("numGames");
	const prevRows = judgedSeasons(gm, t.tid);
	const prev = prevRows.at(-1);
	const rebuilding = t.strategy === "rebuilding";
	const first = prevRows.find((row) => row.expWon !== undefined);
	const row: GmSeason = {
		season: record.season,
		tid: t.tid,
		won: record.won,
		lost: record.lost,
		tied: record.tied,
		otl: record.otl,
		expWon: gm.expWon,
		numGames,
		playoffRoundsWon: record.playoffRoundsWon,
	};
	// Not GM when the season started (expectations are set then)
	if (gm.expWon === undefined) {
		row.partial = true;
	}
	if (first?.expWon !== undefined) {
		row.pathExpWon =
			Math.round(
				gmPathExpWon({
					baseExpWon: (first.expWon * numGames) / first.numGames,
					numGames,
					seasonIndex: prevRows.length,
					rebuilding,
				}) * 10,
			) / 10;
	}
	const signals = await progressSignals(t, prev, record.won, numGames);
	row.youth = signals.youth;
	const rebuildWeight = gmRebuildWeight({
		patience: gm.traits.patience,
		rebuilding,
	});
	if (rebuildWeight > 0 && prev) {
		row.progress = signals.progress;
		row.rebuildWeight = rebuildWeight;
	}
	return row;
};

// The owner's chance to fire him after the playoffs, given the seasons he's judged on (gm.hotSeat is set from the same rows)
const fireProbOf = (
	t: Team,
	gm: Gm,
	rows: GmSeason[],
	marketFactor: number,
) => {
	let drought = 0;
	for (const row of rows.toReversed()) {
		if (row.playoffRoundsWon >= 0) {
			break;
		}
		drought += 1;
	}
	const firstExp = rows.find((row) => row.expWon !== undefined);
	return gmFireProb({
		hotSeat: rows.length > 0 ? gmHotSeat(rows.map(seasonScore)) : 0,
		tenure: rows.length,
		rebuilding: t.strategy === "rebuilding",
		droughtSeasons: drought,
		patience: gm.traits.patience,
		contender:
			firstExp?.expWon !== undefined &&
			firstExp.expWon / firstExp.numGames >= 0.55,
		marketFactor,
	});
};

/**
 * What the owner would decide if the season ended now, for the rumor mill: the season so far projected to a full one, judged like
 * runOffseason judges it, and the chance he's fired. Read only, no random numbers
 */
export const projectedFireProb = async (
	t: Team,
	teams: Team[],
	record: Pick<
		GmSeason,
		"season" | "won" | "lost" | "tied" | "otl" | "playoffRoundsWon"
	>,
) => {
	const gm = t.gm;
	if (!gm) {
		return 0;
	}
	const row = await makeSeasonRow(t, gm, record);
	const rows = [...judgedSeasons(gm, t.tid), ...(row.partial ? [] : [row])];
	return fireProbOf(t, gm, rows, marketFactors(teams).get(t.tid) ?? 0);
};

// Games a team must have played before its season is projected for hot seat news and rumors: 10 of 82, scaled to the season length
export const hotSeatMinGp = () =>
	Math.max(1, Math.min(10, Math.ceil((g.get("numGames") * 10) / 82)));

// The teams in a playoff spot if the regular season ended now (the standings with their tiebreakers, which draw no random numbers)
export const currentPlayoffTids = async () => {
	try {
		return new Set((await seasonCore.genPlayoffSeries()).tidPlayoffs);
	} catch (error) {
		if (error instanceof InvalidPlayoffSettingsError) {
			return new Set<number>();
		}
		throw error;
	}
};

/**
 * The season so far projected to a full one, judged the way the owner will judge it (hot seat news and the rumor mill): during the
 * playoffs his real playoff result, before them making the playoffs (0 rounds won) if his team is in a playoff spot now.
 * playoffTids: currentPlayoffTids, looked up once by the caller
 */
export const projectedSeasonFireProb = async (
	t: Team,
	teams: Team[],
	ts: Pick<
		TeamSeason,
		"season" | "won" | "lost" | "tied" | "otl" | "playoffRoundsWon"
	>,
	playoffTids: () => Promise<Set<number>>,
) => {
	const gp = helpers.getTeamSeasonGp(ts);
	if (gp <= 0) {
		return 0;
	}
	const scale = g.get("numGames") / gp;
	const playoffRoundsWon =
		g.get("phase") === PHASE.PLAYOFFS
			? ts.playoffRoundsWon
			: (await playoffTids()).has(t.tid)
				? 0
				: -1;
	return projectedFireProb(t, teams, {
		season: ts.season,
		won: ts.won * scale,
		lost: ts.lost * scale,
		tied: (ts.tied ?? 0) * scale,
		otl: (ts.otl ?? 0) * scale,
		playoffRoundsWon,
	});
};

// Looks the playoff spots up the first time they're needed
export const lazyPlayoffTids = () => {
	let promise: Promise<Set<number>> | undefined;
	return () => {
		promise ??= currentPlayoffTids();
		return promise;
	};
};

// Hot seat news: at the trade deadline (mid-season in a league without one), the AI GMs most likely to be fired if the season ended
// now are reported to be in danger. At least HOT_SEAT_NEWS_MIN_PROB, each reported with that probability from a stream seeded by the
// season and his id (never the main stream), at most HOT_SEAT_NEWS_MAX a season, worst first
export const HOT_SEAT_NEWS_MIN_PROB = 0.3;
export const HOT_SEAT_NEWS_MAX = 3;

export const hotSeatNews = async () => {
	if (!gmEnabled() || isCollege()) {
		return;
	}
	const phase = g.get("phase");
	if (phase !== PHASE.REGULAR_SEASON && phase !== PHASE.AFTER_TRADE_DEADLINE) {
		return;
	}
	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const minGp = hotSeatMinGp();
	const playoffTids = lazyPlayoffTids();

	const candidates: { t: Team; gm: Gm; prob: number; record: string }[] = [];
	for (const t of teams) {
		const gm = t.gm;
		if (!gm || userOwnsTeam(t.tid) || gm.hotSeatNews === season) {
			continue;
		}
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			t.tid,
		]);
		const gp = ts ? helpers.getTeamSeasonGp(ts) : 0;
		if (!ts || gp < minGp) {
			continue;
		}
		const prob = await projectedSeasonFireProb(t, teams, ts, playoffTids);
		if (prob < HOT_SEAT_NEWS_MIN_PROB) {
			continue;
		}
		const random = makeSeededRandom(
			saltedSeed((season * 100003 + gm.gmid * 7919 + 17) >>> 0),
		);
		if (random() >= prob) {
			continue;
		}
		candidates.push({ t, gm, prob, record: helpers.formatRecord(ts) });
	}

	candidates.sort((a, b) => b.prob - a.prob || a.t.tid - b.t.tid);
	for (const { t, gm, prob, record } of candidates.slice(
		0,
		HOT_SEAT_NEWS_MAX,
	)) {
		gm.hotSeatNews = season;
		await idb.cache.teams.put(t);
		const strength = prob >= 0.6 ? "seriously " : "";
		await logEvent({
			type: "info",
			category: "staff",
			text: `Sources say general manager ${gmLink(gm)}'s job with ${teamLink(t.tid)} (${record}) is reportedly ${strength}in danger.`,
			showNotification: true,
			tids: [t.tid],
			score: prob >= 0.6 ? 10 : 0,
		});
	}
};

// Mid-season, for a league without a trade deadline: once every team has played half its games, until they've all played 2 more
// (the per-GM marker keeps it to one item each)
export const hotSeatNewsMidSeason = async () => {
	if (!gmEnabled() || g.get("tradeDeadline") < 1) {
		return;
	}
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	);
	const active = teamSeasons.filter(
		(ts) => !g.get("teamInfoCache")[ts.tid]?.disabled,
	);
	if (active.length === 0) {
		return;
	}
	const minGp = Math.min(...active.map((ts) => helpers.getTeamSeasonGp(ts)));
	const half = Math.ceil(g.get("numGames") / 2);
	if (minGp >= half && minGp < half + 2) {
		await hotSeatNews();
	}
};

const age = (gm: Gm) => g.get("season") - gm.born.year;

// Former GMs still on the market: out of a job for at most MARKET_SEASONS seasons and at most MAX_HIRE_AGE at the carousel. Anyone else
// on a team's list of former GMs retires at the next carousel
const MARKET_SEASONS = 4;
const MAX_HIRE_AGE = 66;

// Season of the next GM carousel (runOffseason runs while the phase is still the playoffs)
export const nextCarouselSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

// A former GM who can be hired at the carousel of this season
export const onGmMarket = (gm: Gm, season: number = nextCarouselSeason()) => {
	const last = gm.tenures.at(-1);
	return (
		gm.retiredYear === undefined &&
		last?.end !== undefined &&
		last.end >= season - MARKET_SEASONS &&
		season - gm.born.year <= MAX_HIRE_AGE
	);
};

// Every team, contracted ones included (a contracted team's GM is on the market)
const getMarket = (teams: Team[], season: number) => {
	const market: { gm: Gm; from: Team }[] = [];
	for (const t of teams) {
		for (const gm of t.formerGms ?? []) {
			if (onGmMarket(gm, season)) {
				market.push({ gm, from: t });
			}
		}
	}
	return market;
};

const careerScore = (gm: Gm) => {
	if (gm.seasons.length === 0) {
		return 0;
	}
	const mean =
		gm.seasons.reduce((sum, row) => sum + seasonScore(row), 0) /
		gm.seasons.length;
	return Math.max(-10, Math.min(10, mean));
};

const titles = (gm: Gm) =>
	gm.seasons.filter(isTitle).length + (gm.career?.titles ?? 0);

// After the playoffs: record the season, then GMs retire or get fired, and the carousel fills the jobs
export const runOffseason = async () => {
	if (!gmEnabled()) {
		return;
	}
	await ensureGms();

	const season = g.get("season");
	const allTeams = await idb.cache.teams.getAll();
	const teams = allTeams.filter((t) => !t.disabled);
	const vacancies: Team[] = [];
	const markets = marketFactors(teams);

	for (const t of teams) {
		const gm = t.gm;
		// The user's teams have no GM (ensureGms), even while auto play runs them
		if (!gm || userOwnsTeam(t.tid)) {
			continue;
		}

		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			t.tid,
		]);
		// Not for a season before his first (hired once the playoffs had started)
		if (
			ts &&
			ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) > 0 &&
			(currentTenure(gm)?.start ?? season) <= season &&
			!gm.seasons.some((row) => row.season === season && row.tid === t.tid)
		) {
			const row = await makeSeasonRow(t, gm, {
				season,
				won: ts.won,
				lost: ts.lost,
				tied: ts.tied ?? 0,
				otl: ts.otl ?? 0,
				playoffRoundsWon: ts.playoffRoundsWon,
			});
			gm.seasons.push(row);
		}
		gm.expWon = undefined;

		const rows = judgedSeasons(gm, t.tid);
		gm.hotSeat = rows.length > 0 ? gmHotSeat(rows.map(seasonScore)) : undefined;

		// Retirement
		const a = age(gm) + 1;
		const retireProb = (a >= 66 ? (a - 65) * 0.12 : 0) + (a > 74 ? 1 : 0);
		if (Math.random() < retireProb) {
			leaveTeam(t, "retired", season);
			vacancies.push(t);
			await logGmEvent(
				`General manager ${gmLink(gm)} of ${teamLink(t.tid)} retired.`,
				[t.tid],
			);
			await idb.cache.teams.put(t);
			continue;
		}

		const fireProb = fireProbOf(t, gm, rows, markets.get(t.tid) ?? 0);
		if (fireProb > 0 && Math.random() < fireProb) {
			const record = helpers.formatRecord({
				won: rows.reduce((sum, row) => sum + row.won, 0),
				lost: rows.reduce((sum, row) => sum + row.lost, 0),
				tied: rows.reduce((sum, row) => sum + row.tied, 0),
				otl: rows.reduce((sum, row) => sum + row.otl, 0),
			});
			leaveTeam(t, "fired", season);
			vacancies.push(t);
			await logGmEvent(
				`${teamLink(t.tid)} fired general manager ${gmLink(gm)} after ${rows.length} season${rows.length === 1 ? "" : "s"} (${record}).`,
				[t.tid],
				10,
			);
		}
		await idb.cache.teams.put(t);
	}

	// Former GMs who can't be hired any more (out of a job too long, or too old) retire, on every team's list (contracted teams too).
	// Retired GMs' season rows become career totals
	for (const t of allTeams) {
		for (const gm of t.formerGms ?? []) {
			// The GM waiting to run the user's team again in spectator mode stays, unless he's too old to be hired
			if (
				gm.retiredYear === undefined &&
				gm.spectatorFor === t.tid &&
				season + 1 - gm.born.year <= MAX_HIRE_AGE
			) {
				continue;
			}
			if (gm.retiredYear === undefined && !onGmMarket(gm, season)) {
				gm.spectatorFor = undefined;
				retire(gm, season);
			} else {
				pruneRetired(gm);
			}
		}
	}

	await fillVacancies(vacancies);

	for (const t of allTeams) {
		await idb.cache.teams.put(t);
	}
};

// The GM carousel: each open job goes to the best candidate, a former GM with a good track record or someone new (an assistant GM,
// a scout, a former player)
const fillVacancies = async (vacancies: Team[]) => {
	if (vacancies.length === 0) {
		return;
	}
	const season = g.get("season");
	// Every team, contracted ones included: their former GMs keep their ids and are on the market
	const teams = await idb.cache.teams.getAll();
	let gmid = nextGmid(teams);
	const market = getMarket(teams, season);

	for (const t of vacancies) {
		let best: { gm?: Gm; from?: Team; score: number } = {
			score: -Infinity,
		};
		for (const row of market) {
			// Never back to a team he ran
			if (row.gm.tenures.some((tenure) => tenure.tid === t.tid)) {
				continue;
			}
			const score = 1.5 + 0.6 * careerScore(row.gm) + gauss(0, 3);
			if (score > best.score) {
				best = { ...row, score };
			}
		}
		for (let i = 0; i < 3; i++) {
			const score = gauss(0, 3);
			if (score > best.score) {
				best = { score };
			}
		}

		let gm: Gm;
		let text: string;
		if (best.gm && best.from) {
			gm = best.gm;
			const from = best.from;
			from.formerGms = (from.formerGms ?? []).filter((x) => x !== gm);
			const index = market.findIndex((row) => row.gm === gm);
			market.splice(index, 1);
			const numTitles = titles(gm);
			const prev = gm.tenures.at(-1)!;
			text = `${teamLink(t.tid)} hired ${gmLink(gm)}${financeText(gm)} as general manager. He ran the ${teamName(prev.tid)} until ${prev.end}${numTitles > 0 ? ` and has won ${numTitles} title${numTitles > 1 ? "s" : ""}` : ""}.`;
			await idb.cache.teams.put(from);
		} else {
			gm = await generateGm(gmid);
			gmid += 1;
			text = `${teamLink(t.tid)} hired ${gmLink(gm)}${financeText(gm)} as general manager, his first job running a team.`;
		}
		// Hired after the playoffs, so his first season is next season
		hireGm(t, gm, false, season + 1);
		await idb.cache.teams.put(t);
		await logGmEvent(text, [t.tid], 5);
	}
};
