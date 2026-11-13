// AI general managers (featureGmPersonalities, basketball only): generation, the weights AI decisions read, season expectations, firing
// after sustained failure and the GM carousel. GMs live on the team objects (t.gm, and t.formerGms for those who left the team), so
// they're exported/imported with the teams and need no database store. The user's team has no GM unless the AI runs it (spectator mode
// or auto play). With the setting off, getGmWeights returns undefined and every caller keeps its old behavior exactly.

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
import { gauss, randInt } from "../../../common/random.ts";
import type { Gm, GmSeason, Team } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, local, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { generateFace } from "../../util/face.ts";
import name from "../player/name.ts";
import { team } from "../index.ts";
import { gmAnalyticsShift } from "../frontOffice/index.ts";
import { getSeasonOdds } from "../seasonOdds/index.ts";
import { winProb } from "../seasonOdds/simSeason.ts";

export const gmEnabled = () =>
	__SPORT === "basketball" && featureOn("gmPersonalities");

export const userControlsTeam = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

// Keyed by the traits object, which is never edited in place
const weightsCache = new WeakMap<Gm["traits"], GmWeights>();
// Front Office Budget: a GM whose team spends on analytics leans analytics (shift 0 when off), keyed by traits and shift
const shiftedCache = new WeakMap<
	Gm["traits"],
	{ shift: number; w: GmWeights }
>();
const weightsOf = (gm: Gm, t?: Team) => {
	const shift = t ? gmAnalyticsShift(t) : 0;
	if (shift !== 0) {
		const cached = shiftedCache.get(gm.traits);
		if (cached && cached.shift === shift) {
			return cached.w;
		}
		const w = gmWeightsFromTraits({
			...gm.traits,
			analytics: Math.max(-1, Math.min(1, gm.traits.analytics + shift)),
		});
		shiftedCache.set(gm.traits, { shift, w });
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

const nextGmid = (teams: Team[]) => {
	let max = -1;
	for (const gm of allGms(teams)) {
		max = Math.max(max, gm.gmid);
	}
	return max + 1;
};

export const generateGm = async (gmid: number): Promise<Gm> => {
	const { country, firstName, lastName, race } = await name();
	const age = randInt(36, 60);
	return {
		gmid,
		firstName,
		lastName,
		born: {
			year: g.get("season") - age,
			loc: country,
		},
		face: generateFace({ race, age }),
		traits: genGmTraits(() => gauss(0, 1)),
		seasons: [],
		tenures: [],
	};
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
	`<a href="/l/${g.get("lid")}/front_offices">${gm.firstName} ${gm.lastName}</a>`;

const logGmEvent = async (text: string, tids: number[], score = 0) => {
	await logEvent({
		type: "info",
		text,
		showNotification: false,
		tids,
		score,
	});
};

// Season a GM hired now starts counting in
const startSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

const hireGm = (
	t: Team,
	gm: Gm,
	initial?: boolean,
	start: number = startSeason(),
) => {
	gm.tenures.push(
		initial ? { tid: t.tid, start, initial: true } : { tid: t.tid, start },
	);
	gm.hotSeat = undefined;
	gm.expWon = undefined;
	gm.retiredYear = undefined;
	t.gm = gm;
};

// Give every AI team without a GM one (new leagues, turning the setting on, expansion teams, a team the user stopped running)
export const ensureGms = async () => {
	if (!gmEnabled()) {
		return false;
	}
	const teams = await idb.cache.teams.getAll();
	const firstTime = allGms(teams).length === 0;
	let gmid = nextGmid(teams);
	let changed = false;
	for (const t of teams) {
		if (t.disabled || t.gm || userControlsTeam(t.tid)) {
			continue;
		}
		const gm = await generateGm(gmid);
		gmid += 1;
		hireGm(t, gm, firstTime);
		await idb.cache.teams.put(t);
		changed = true;
		if (!firstTime) {
			await logGmEvent(
				`${teamLink(t.tid)} named ${gmLink(gm)} general manager.`,
				[t.tid],
			);
		}
	}
	return changed;
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
		if (!t.gm || t.disabled) {
			continue;
		}
		const expWon = exp.get(t.tid);
		t.gm.expWon =
			expWon !== undefined ? Math.round(expWon * 10) / 10 : undefined;
		await idb.cache.teams.put(t);
	}
};

const currentTenure = (gm: Gm) => gm.tenures.at(-1);

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
	const numFuture = g.get("numSeasonsFutureDraftPicks");
	const firsts = picks.filter(
		(dp) =>
			dp.round === 1 &&
			typeof dp.season === "number" &&
			dp.season > season &&
			dp.season <= season + numFuture,
	).length;
	const ownFirsts = Math.min(numFuture, 4);
	const payroll = await team.getPayroll(t.tid);
	const salaryCap = g.get("salaryCap");
	const scale = 82 / Math.max(1, numGames);
	const progress = gmProgressScore({
		youthChange: prev?.youth !== undefined ? youth - prev.youth : 0,
		extraFirsts:
			numFuture > 0
				? (firsts * Math.min(numFuture, 4)) / numFuture - ownFirsts
				: 0,
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

const age = (gm: Gm) => g.get("season") - gm.born.year;

// Leaves his team: fired, retired, or the user took over. He goes on the team's list of former GMs, where the carousel finds him
const leaveTeam = (
	t: Team,
	reason: "fired" | "retired" | "left",
	season: number,
) => {
	const gm = t.gm;
	if (!gm) {
		return;
	}
	const tenure = currentTenure(gm);
	if (tenure && tenure.end === undefined) {
		tenure.end = season;
		tenure.reason = reason;
	}
	gm.expWon = undefined;
	if (reason === "retired") {
		gm.retiredYear = season;
		gm.face = undefined;
	}
	t.formerGms = [...(t.formerGms ?? []), gm];
	t.gm = undefined;
};

// Former GMs still on the market
const MARKET_SEASONS = 4;
const MAX_HIRE_AGE = 66;

const getMarket = (teams: Team[], season: number) => {
	const market: { gm: Gm; from: Team }[] = [];
	for (const t of teams) {
		for (const gm of t.formerGms ?? []) {
			const last = gm.tenures.at(-1);
			if (
				gm.retiredYear === undefined &&
				last?.end !== undefined &&
				last.end >= season - MARKET_SEASONS &&
				age(gm) <= MAX_HIRE_AGE
			) {
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

const titles = (gm: Gm, tid?: number) =>
	gm.seasons.filter(
		(row) =>
			(tid === undefined || row.tid === tid) &&
			row.playoffRoundsWon >= 0 &&
			row.playoffRoundsWon >= g.get("numGamesPlayoffSeries", row.season).length,
	).length;

// After the playoffs: record the season, then GMs retire or get fired, and the carousel fills the jobs
export const runOffseason = async () => {
	if (!gmEnabled()) {
		return;
	}
	await ensureGms();

	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const vacancies: Team[] = [];
	const markets = marketFactors(teams);

	for (const t of teams) {
		const gm = t.gm;
		if (!gm || userControlsTeam(t.tid)) {
			continue;
		}

		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			t.tid,
		]);
		if (
			ts &&
			ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) > 0 &&
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
			const won = rows.reduce((sum, row) => sum + row.won, 0);
			const lost = rows.reduce((sum, row) => sum + row.lost, 0);
			leaveTeam(t, "fired", season);
			vacancies.push(t);
			await logGmEvent(
				`${teamLink(t.tid)} fired general manager ${gmLink(gm)} after ${rows.length} season${rows.length === 1 ? "" : "s"} (${won}-${lost}).`,
				[t.tid],
				10,
			);
		}
		await idb.cache.teams.put(t);
	}

	// Long unemployed GMs retire
	for (const t of teams) {
		for (const gm of t.formerGms ?? []) {
			const last = gm.tenures.at(-1);
			if (
				gm.retiredYear === undefined &&
				last?.end !== undefined &&
				(last.end < season - MARKET_SEASONS || age(gm) > MAX_HIRE_AGE + 4)
			) {
				gm.retiredYear = season;
				gm.face = undefined;
			}
		}
	}

	await fillVacancies(vacancies);

	for (const t of teams) {
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
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	let gmid = nextGmid(teams);
	const market = getMarket(teams, season);

	for (const t of vacancies) {
		let best: { gm?: Gm; from?: Team; score: number } = {
			score: -Infinity,
		};
		for (const row of market) {
			// Not the team that just let him go
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
			text = `${teamLink(t.tid)} hired ${gmLink(gm)} as general manager. He ran the ${teamName(prev.tid)} until ${prev.end}${numTitles > 0 ? ` and has won ${numTitles} title${numTitles > 1 ? "s" : ""}` : ""}.`;
			await idb.cache.teams.put(from);
		} else {
			gm = await generateGm(gmid);
			gmid += 1;
			text = `${teamLink(t.tid)} hired ${gmLink(gm)} as general manager, his first job running a team.`;
		}
		// Hired after the playoffs, so his first season is next season (the phase may not have moved past the playoffs yet)
		hireGm(t, gm, false, season + 1);
		await idb.cache.teams.put(t);
		await logGmEvent(text, [t.tid], 5);
	}
};
