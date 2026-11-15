// Rivalry Stories (League extras, basketball): the per-game rivalry log (rivalryGames store) and what reads it. Written
// once per day of games (one transaction), read by pair or by season through the store's indexes, so a rivalry page reads
// only its own pair's games however long the league is.
import { ADV } from "../../common/advStats.ts";
import { rivalryGameFromBox } from "../../common/rivalryStories/record.ts";
import {
	buildRivalryStory,
	type Crossing,
	type RivalryStory,
	type TeamSeasonLite,
} from "../../common/rivalryStories/aggregate.ts";
import { pairOf, type RivalryGame } from "../../common/rivalryStories/types.ts";
import type { RivalInput } from "../../common/rivalries/index.ts";
import type { Game, GameResults } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { PHASE } from "../../common/constants.ts";
import type { NPRivalryStory } from "../../common/newspaper/types.ts";
import {
	rivalryPreview,
	rivalryRecaps,
	type RivalryArticleText,
} from "../../common/rivalryStories/text.ts";
import { loadRivalries } from "./rivalries.ts";
import g from "./g.ts";
import { featureOn } from "./nativeFeatures.ts";

export const rivalryStoriesOn = () =>
	__SPORT === "basketball" &&
	featureOn("rivalries") &&
	featureOn("rivalryStories");

const advOf = (results: GameResults) => {
	const map = new Map<number, [number, number, number]>();
	for (const t of results.team ?? []) {
		for (const p of t.player ?? []) {
			const adv = p.adv as number[] | undefined;
			if (!adv) {
				continue;
			}
			map.set(p.id, [
				(adv[ADV.dfga2] ?? 0) + (adv[ADV.dfga3] ?? 0),
				(adv[ADV.dfgm2] ?? 0) + (adv[ADV.dfgm3] ?? 0),
				(adv[ADV.ptsFor] ?? 0) - (adv[ADV.ptsAgainst] ?? 0),
			]);
		}
	}
	return map;
};

const pbpCounts = (results: GameResults) => {
	let techs = 0;
	let ejections = 0;
	if (Array.isArray(results.playByPlay)) {
		for (const e of results.playByPlay) {
			if (e?.type === "techFoul") {
				techs += 1;
			} else if (e?.type === "ejection") {
				ejections += 1;
			}
		}
	}
	return { techs, ejections };
};

const headCoaches = async (tids: number[]) => {
	if (!g.get("coachingStaff")) {
		return undefined;
	}
	const out: (string | null)[] = [];
	for (const tid of tids) {
		const list = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
		const head = list.find((c) => c.role === "head");
		out.push(head ? `${head.firstName} ${head.lastName}` : null);
	}
	return out as [string | null, string | null];
};

// After a day of games (game/play.ts): one record per game, from its box score (already in the cache) and the sim
// results (tracking stats, technicals)
export const recordRivalryGames = async (resultsList: GameResults[]) => {
	if (!rivalryStoriesOn() || resultsList.length === 0) {
		return;
	}
	const playoffSeries = await idb.cache.playoffSeries.get(g.get("season"));
	const round =
		playoffSeries && playoffSeries.currentRound >= 0
			? playoffSeries.currentRound
			: undefined;
	const records: RivalryGame[] = [];
	for (const results of resultsList) {
		const game = await idb.cache.games.get(results.gid);
		if (!game) {
			continue;
		}
		const rec = rivalryGameFromBox(game, {
			round,
			adv: advOf(results),
			...pbpCounts(results),
			coaches: await headCoaches([game.teams[0].tid, game.teams[1].tid]),
		});
		if (rec) {
			records.push(rec);
		}
	}
	if (records.length === 0) {
		return;
	}
	const tx = idb.league.transaction("rivalryGames", "readwrite");
	for (const rec of records) {
		void tx.store.put(rec);
	}
	await tx.done;
	clearPairMemo();
};

// When the setting is turned on in a league that already has history (or after an import): log the stored box scores that
// are not in the log yet, once per league per session
const backfilled = new Set<string>();
export const ensureBackfill = async () => {
	const key = `${g.get("lid")}`;
	if (backfilled.has(key)) {
		return;
	}
	backfilled.add(key);
	const have = new Set(
		await idb.league.transaction("rivalryGames").store.getAllKeys(),
	);
	const records = new Map<number, RivalryGame>();
	const add = (game: Game) => {
		if (records.has(game.gid) || have.has(game.gid)) {
			return;
		}
		const rec = rivalryGameFromBox(game);
		if (rec) {
			records.set(game.gid, rec);
		}
	};
	for await (const { value } of idb.league
		.transaction("games")
		.store.iterate()) {
		add(value);
	}
	for (const game of await idb.cache.games.getAll()) {
		add(game);
	}
	if (records.size === 0) {
		return;
	}
	const tx = idb.league.transaction("rivalryGames", "readwrite");
	for (const rec of records.values()) {
		void tx.store.put(rec);
	}
	await tx.done;
	clearPairMemo();
};

// Small memo of pair reads, cleared whenever games are logged
const pairMemo = new Map<string, Promise<RivalryGame[]>>();
const clearPairMemo = () => {
	pairMemo.clear();
};

export const pairGames = async (a: number, b: number) => {
	await ensureBackfill();
	const key = `${g.get("lid")}|${pairOf(a, b)}`;
	let p = pairMemo.get(key);
	if (!p) {
		p = idb.league
			.transaction("rivalryGames")
			.store.index("pair")
			.getAll(pairOf(a, b));
		pairMemo.set(key, p);
		if (pairMemo.size > 50) {
			pairMemo.delete(pairMemo.keys().next().value!);
		}
	}
	return p;
};

export const seasonGames = async (season: number) => {
	await ensureBackfill();
	return idb.league
		.transaction("rivalryGames")
		.store.index("season")
		.getAll(season);
};

// Players who played for both teams in the log, oldest move first, with how they moved when an event says so
const crossingsOf = async (
	games: RivalryGame[],
	a: number,
	b: number,
): Promise<Crossing[]> => {
	const sorted = [...games].sort(
		(x, y) =>
			x.season - y.season || (x.day ?? 0) - (y.day ?? 0) || x.gid - y.gid,
	);
	const last = new Map<number, { tid: number; name: string }>();
	const out: Crossing[] = [];
	for (const gm of sorted) {
		for (const p of gm.players) {
			const prev = last.get(p.pid);
			if (prev && prev.tid !== p.tid) {
				out.push({
					pid: p.pid,
					name: p.name,
					season: gm.season,
					from: prev.tid,
					to: p.tid,
					how: "moved",
				});
			}
			last.set(p.pid, { tid: p.tid, name: p.name });
		}
	}
	// Players on one roster now who last faced off for the other side
	const roster = [
		...(await idb.cache.players.indexGetAll("playersByTid", a)),
		...(await idb.cache.players.indexGetAll("playersByTid", b)),
	];
	for (const p of roster) {
		const prev = last.get(p.pid);
		if (prev && prev.tid !== p.tid && (p.tid === a || p.tid === b)) {
			out.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				season: g.get("season"),
				from: prev.tid,
				to: p.tid,
				how: "moved",
			});
		}
	}
	for (const c of out.slice(-12)) {
		const events = await idb.merged.events.getAll({ pid: c.pid });
		const ev = events.find(
			(e) =>
				(e.season === c.season || e.season === c.season - 1) &&
				((e.type === "trade" &&
					e.tids.includes(c.from) &&
					e.tids.includes(c.to)) ||
					(e.type === "freeAgent" && e.tids[0] === c.to)),
		);
		if (ev) {
			c.how = ev.type === "trade" ? "trade" : "signing";
		}
	}
	return out.slice(-12);
};

export const loadRivalryStory = async (
	input: RivalInput,
	name: (tid: number) => string,
): Promise<RivalryStory> => {
	const { a, b } = input;
	const games = await pairGames(a, b);
	const [tsA, tsB] = await Promise.all([
		idb.merged.teamSeasons.getAll({ tid: a }),
		idb.merged.teamSeasons.getAll({ tid: b }),
	]);
	const teamSeasons: TeamSeasonLite[] = [...tsA, ...tsB].map((ts) => ({
		tid: ts.tid,
		season: ts.season,
		won: ts.won,
		lost: ts.lost,
		playoffRoundsWon: ts.playoffRoundsWon,
	}));
	const crossings = await crossingsOf(games, a, b);
	return buildRivalryStory({ input, games, teamSeasons, crossings, name });
};

const fullName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : `Team ${tid}`;
};

// A regular season game gets a preview when it is a marquee or scheduled rivalry game of a Heated pair, or any game of a
// Bitter one
const previewWorthy = (score: number, tagged: boolean) =>
	(tagged && score >= 22) || score >= 40;

// Newspaper (Rivalry Stories setting): previews of the next marquee rivalry games (current season) and recaps of the
// season's big rivalry games
export const getRivalryNewsFacts = async (
	season: number,
): Promise<{ previews: NPRivalryStory[]; recaps: NPRivalryStory[] }> => {
	const pairs = await loadRivalries(season, { storedGames: false });
	const byKey = new Map(pairs.map((e) => [e.key, e]));
	const isRival = (pair: string, tagged?: boolean) =>
		!!tagged || (byKey.get(pair)?.score.score ?? 0) >= 10;

	const games = await seasonGames(season);
	const rivalGames = games.filter((gm) => isRival(gm.pair, gm.rivalry));
	const history: RivalryGame[] = [];
	for (const pair of new Set(rivalGames.map((gm) => gm.pair))) {
		const [a, b] = pair.split("-").map(Number) as [number, number];
		history.push(...(await pairGames(a, b)));
	}
	const recaps = rivalryRecaps({
		games: rivalGames,
		history,
		name: fullName,
		isRival: () => true,
	}).slice(0, 6);

	const previews: RivalryArticleText[] = [];
	if (season === g.get("season")) {
		const schedule = await idb.cache.schedule.getAll();
		const playoffs = g.get("phase") === PHASE.PLAYOFFS;
		const upcoming = schedule
			.filter(
				(s) =>
					s.homeTid >= 0 &&
					s.awayTid >= 0 &&
					(playoffs
						? isRival(pairOf(s.homeTid, s.awayTid))
						: previewWorthy(
								byKey.get(pairOf(s.homeTid, s.awayTid))?.score.score ?? 0,
								s.marquee !== undefined || !!s.rivalry,
							)),
			)
			.sort((x, y) => x.day - y.day || x.gid - y.gid)
			.slice(0, 2);
		for (const s of upcoming) {
			const e = byKey.get(pairOf(s.homeTid, s.awayTid));
			const history = await pairGames(s.homeTid, s.awayTid);
			const rs = e?.input.rs ?? [];
			const aW = rs.reduce((t, r) => t + r.aW, 0);
			const bW = rs.reduce((t, r) => t + r.bW, 0);
			const homeIsA = e ? e.a === s.homeTid : true;
			previews.push(
				rivalryPreview({
					game: {
						gid: s.gid,
						season,
						home: s.homeTid,
						away: s.awayTid,
						playoffs,
						...(s.marquee !== undefined ? { marquee: s.marquee } : {}),
					},
					history,
					tier: e?.score.tier ?? "Mild",
					name: fullName,
					allTime: { home: homeIsA ? aW : bW, away: homeIsA ? bW : aW },
				}),
			);
		}
	}
	const strip = ({ score: _score, ...x }: RivalryArticleText): NPRivalryStory =>
		x;
	return { previews: previews.map(strip), recaps: recaps.map(strip) };
};
