// Gathers a player's career facts for the Hall of Fame words in common/hofStory.ts (plaque, induction speech).
import {
	inductionSpeech,
	plaquePrimeLine,
	plaqueText,
	type CareerFacts,
	type HofTeam,
} from "../../common/hofStory.ts";
import { viewOf } from "../../common/archetypes/index.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { getTeamInfoBySeason } from "./getTeamInfoBySeason.ts";
import { getHeadCoachForSeason } from "../core/staff/data.ts";
import type { Player } from "../../common/types.ts";
import { getPreDraftSchool } from "../../common/preDraft.ts";

// Module caches of past seasons' team names and playoff eliminations, which never change. They belong to one league (cleared
// when another league is loaded) and are bounded. The current season is never cached: its team names can still change and its
// playoffs may not be played yet.
const MAX_CACHE_SIZE = 5000;
let cacheLid: number | undefined;
const teamInfoCache = new Map<
	string,
	{ region: string; name: string } | undefined
>();
const eliminators = new Map<number, Map<number, number>>();
const cacheable = (season: number) => {
	const lid = g.get("lid");
	if (cacheLid !== lid) {
		cacheLid = lid;
		teamInfoCache.clear();
		eliminators.clear();
	}
	return season < g.get("season");
};
const setBounded = <K, V>(map: Map<K, V>, key: K, value: V) => {
	if (map.size >= MAX_CACHE_SIZE) {
		map.clear();
	}
	map.set(key, value);
};

// The team's region and name in that season (after a relocation or rename, the old one)
const teamInfo = async (tid: number, season: number) => {
	const cache = cacheable(season);
	const key = `${tid}:${season}`;
	if (cache && teamInfoCache.has(key)) {
		return teamInfoCache.get(key);
	}
	const info = await getTeamInfoBySeason(tid, season);
	const out = info ? { region: info.region, name: info.name } : undefined;
	if (cache) {
		setBounded(teamInfoCache, key, out);
	}
	return out;
};

const teamName = async (tid: number, season: number) => {
	const info = await teamInfo(tid, season);
	return info ? `${info.region} ${info.name}` : undefined;
};

const proRows = (p: Player) =>
	p.stats.filter(
		(row: any) => row.tid >= 0 && !row.playoffs && !row.preDraft && row.gp > 0,
	) as any[];

// Hall of Famers' team seasons, for the teammate line: who played for each "tid:season", in the order of the players given
export type HofIndex = {
	names: Map<number, string>;
	order: Map<number, number>;
	byTeamSeason: Map<string, number[]>;
};

export type HofContext = {
	hofIndex?: HofIndex;
	feats?: Map<number, any[]>;
	full?: boolean;
};

const eliminatorOf = async (tid: number, season: number) => {
	const cache = cacheable(season);
	let m = cache ? eliminators.get(season) : undefined;
	if (!m) {
		m = new Map();
		const ps: any = await idb.merged.playoffSeries.get(season);
		for (const round of ps?.series ?? []) {
			for (const s of round) {
				if (!s.away) {
					continue;
				}
				const [w, l] =
					s.home.won > s.away.won ? [s.home, s.away] : [s.away, s.home];
				if (w.won > l.won) {
					m.set(l.tid, w.tid);
				}
			}
		}
		if (cache) {
			setBounded(eliminators, season, m);
		}
	}
	return m.get(tid);
};

export const careerFacts = async (
	p: Player,
	ctx: HofContext = {},
): Promise<CareerFacts> => {
	const rows = proRows(p);
	const byTid = new Map<number, Set<number>>();
	const totals = { gp: 0, pts: 0, trb: 0, ast: 0, stl: 0, blk: 0, tp: 0 };
	for (const row of rows) {
		if (!byTid.has(row.tid)) {
			byTid.set(row.tid, new Set());
		}
		byTid.get(row.tid)!.add(row.season);
		totals.gp += row.gp ?? 0;
		totals.pts += row.pts ?? 0;
		totals.trb += (row.orb ?? 0) + (row.drb ?? 0) || (row.trb ?? 0);
		totals.ast += row.ast ?? 0;
		totals.stl += row.stl ?? 0;
		totals.blk += row.blk ?? 0;
		totals.tp += row.tp ?? 0;
	}
	const teams: HofTeam[] = [];
	for (const [tid, seasons] of byTid) {
		const sorted = [...seasons].sort((a, b) => a - b);
		teams.push({
			tid,
			name: (await teamName(tid, sorted.at(-1)!)) ?? "",
			seasons: sorted.length,
			first: sorted[0]!,
			last: sorted.at(-1)!,
		});
	}
	teams.sort((a, b) => b.seasons - a.seasons || a.first - b.first);
	const allSeasons = new Set(rows.map((r) => r.season));
	const tidIn = (season: number) =>
		rows.filter((r) => r.season === season).at(-1)?.tid as number | undefined;

	const count = (type: string) =>
		p.awards.filter((a) => a.type === type).length;
	const titles = [];
	for (const a of p.awards.filter((a) => a.type === "Won Championship")) {
		const tid = tidIn(a.season);
		titles.push({
			season: a.season,
			team: tid !== undefined ? await teamName(tid, a.season) : undefined,
		});
	}

	const facts: CareerFacts = {
		pid: p.pid,
		firstName: p.firstName,
		lastName: p.lastName,
		teams,
		titles,
		mvps: count("Most Valuable Player"),
		finalsMvps: count("Finals MVP"),
		allStars: count("All-Star"),
		dpoys: count("Defensive Player of the Year"),
		roy: count("Rookie of the Year") > 0,
		college: getPreDraftSchool(p) || undefined,
		hometown: p.born?.loc || undefined,
		hgt: p.hgt,
		career: {
			gp: totals.gp,
			pts: Math.round(totals.pts),
			trb: Math.round(totals.trb),
			ast: Math.round(totals.ast),
			seasons: allSeasons.size,
		},
		perGame:
			totals.gp > 0
				? {
						pts: totals.pts / totals.gp,
						trb: totals.trb / totals.gp,
						ast: totals.ast / totals.gp,
						stl: totals.stl / totals.gp,
						blk: totals.blk / totals.gp,
						tpm: totals.tp / totals.gp,
					}
				: undefined,
		retiredYear: p.retiredYear,
	};

	if (p.draft && p.draft.year !== undefined) {
		const dtid = p.draft.originalTid ?? p.draft.tid;
		facts.draft = {
			year: p.draft.year,
			round: p.draft.round,
			pick: p.draft.pick,
			team: dtid >= 0 ? await teamName(dtid, p.draft.year) : undefined,
		};
	}

	// Archetype label of his best stored season
	// (his highest-ovr season with a stored label, the later on a tie; named as the player page names it: a merged build
	// as the build it was merged into, at his position that season)
	let arch:
		| {
				e: NonNullable<Player["archetypes"]>[number];
				ovr: number;
				pos?: string;
		  }
		| undefined;
	for (const e of p.archetypes ?? []) {
		const row = (p.ratings as any[]).find((r) => r.season === e.season);
		const ovr = typeof row?.ovr === "number" ? row.ovr : -Infinity;
		if (!arch || ovr >= arch.ovr) {
			arch = { e, ovr, pos: row?.pos };
		}
	}
	if (arch) {
		facts.archetype = (viewOf(arch.e, arch.pos) ?? viewOf(arch.e))?.name;
	}

	if (!ctx.full) {
		return facts;
	}

	// Playoff rival: the team that ended his season most often
	// Rival tid -> [times, last season]
	const elim = new Map<number, [number, number]>();
	const playoffSeasons = new Set(
		(p.stats as any[])
			.filter((r) => r.playoffs && r.tid >= 0)
			.map((r) => r.season),
	);
	for (const season of playoffSeasons) {
		const tid = tidIn(season);
		if (tid === undefined) {
			continue;
		}
		const by = await eliminatorOf(tid, season);
		if (by !== undefined && by !== tid) {
			const prev = elim.get(by);
			elim.set(by, [
				(prev?.[0] ?? 0) + 1,
				Math.max(prev?.[1] ?? season, season),
			]);
		}
	}
	let rival: [number, [number, number]] | undefined;
	for (const e of elim) {
		if (!rival || e[1][0] > rival[1][0]) {
			rival = e;
		}
	}
	if (rival) {
		// Named as it was the last time they knocked him out
		const name = await teamName(rival[0], rival[1][1]);
		if (name) {
			facts.rival = { name, times: rival[1][0] };
		}
	}

	// First head coach
	const first = rows[0];
	if (first) {
		const coach = await getHeadCoachForSeason(first.tid, first.season);
		if (coach) {
			facts.coach = {
				name: `${coach.firstName} ${coach.lastName}`,
				team: (await teamName(first.tid, first.season)) ?? "",
			};
		}
	}

	// Fellow Hall of Famer with the most shared seasons. Looked up by his own team seasons, not by scanning every Hall of Famer
	if (ctx.hofIndex) {
		const { byTeamSeason, names, order } = ctx.hofIndex;
		const shared = new Map<number, number>();
		for (const key of new Set(rows.map((r) => `${r.tid}:${r.season}`))) {
			for (const pid of byTeamSeason.get(key) ?? []) {
				if (pid !== p.pid) {
					shared.set(pid, (shared.get(pid) ?? 0) + 1);
				}
			}
		}
		let best: { pid: number; seasons: number } | undefined;
		for (const [pid, n] of shared) {
			if (
				n >= 2 &&
				(!best ||
					n > best.seasons ||
					(n === best.seasons && order.get(pid)! < order.get(best.pid)!))
			) {
				best = { pid, seasons: n };
			}
		}
		facts.teammate = best
			? { name: names.get(best.pid)!, seasons: best.seasons }
			: undefined;
	}

	// Signature game, from his stat feats
	const feats = ctx.feats?.get(p.pid) ?? [];
	let bestFeat: any;
	let bestScore = -1;
	for (const f of feats) {
		const s = f.stats ?? {};
		const score =
			(s.pts ?? 0) + (s.trb ?? 0) + (s.ast ?? 0) + (f.playoffs ? 8 : 0);
		if (score > bestScore) {
			bestScore = score;
			bestFeat = f;
		}
	}
	if (bestFeat) {
		const s = bestFeat.stats ?? {};
		// The opponent as it was named that season
		const info =
			typeof bestFeat.oppTid === "number"
				? await teamInfo(bestFeat.oppTid, bestFeat.season)
				: undefined;
		facts.bestGame = {
			season: bestFeat.season,
			pts: s.pts ?? 0,
			trb: s.trb ?? 0,
			ast: s.ast ?? 0,
			opp: info ? info.name : "opponent",
			playoffs: !!bestFeat.playoffs,
			won: bestFeat.result === "W",
		};
	}
	return facts;
};

// Hall of Fame words (plaque text, induction speeches) are about basketball careers: points, rebounds and assists,
// shooting on a hoop. Other sports get the stock Hall of Fame page (no "0 points, 0 rebounds, 0 assists" plaque)
export const hofWordsOn = () => __SPORT === "basketball";

export const hofWords = (
	facts: CareerFacts,
	prime?: { season: number; tid?: number; team?: string },
) => {
	const f = prime ? { ...facts, prime } : facts;
	return {
		plaque: plaqueText(f),
		speech: inductionSpeech(f),
	};
};

// Stat feats of these players, one pass over the store
export const featsByPid = async (pids: Set<number>) => {
	const out = new Map<number, any[]>();
	const feats = await idb.merged.playerFeats.getAll(undefined, {
		filter: (f: any) => pids.has(f.pid),
	} as any);
	for (const f of feats as any[]) {
		if (!out.has(f.pid)) {
			out.set(f.pid, []);
		}
		out.get(f.pid)!.push(f);
	}
	return out;
};

export const hofIndexOf = (players: Player[]): HofIndex => {
	const index: HofIndex = {
		names: new Map(),
		order: new Map(),
		byTeamSeason: new Map(),
	};
	for (const p of players) {
		if (index.order.has(p.pid)) {
			continue;
		}
		index.order.set(p.pid, index.order.size);
		index.names.set(p.pid, `${p.firstName} ${p.lastName}`);
		for (const key of new Set(proRows(p).map((r) => `${r.tid}:${r.season}`))) {
			let pids = index.byTeamSeason.get(key);
			if (!pids) {
				pids = [];
				index.byTeamSeason.set(key, pids);
			}
			pids.push(p.pid);
		}
	}
	return index;
};

// Version of the stored Hall of Fame words (p.hofStory). Bump it when the words or the facts behind them change, and every
// stored story is written again the next time it is shown
export const HOF_STORY_VERSION = 1;

type HofStory = NonNullable<Player["hofStory"]>;

const hasCurrentStory = (p: Player) => p.hofStory?.v === HOF_STORY_VERSION;

const writeHofStory = async (
	p: Player,
	ctx: { hofIndex: HofIndex; feats: Map<number, any[]> },
): Promise<HofStory> => {
	const facts = await careerFacts(p, { full: true, ...ctx });
	const words = hofWords(facts);
	return { v: HOF_STORY_VERSION, plaque: words.plaque, speech: words.speech };
};

// Saves his story on the stored player (the object passed in may be a copy)
const saveHofStory = async (pid: number, story: HofStory) => {
	const p =
		(await idb.cache.players.get(pid)) ??
		(await idb.league.get("players", pid));
	if (p && p.hof) {
		p.hofStory = story;
		await idb.cache.players.put(p);
	}
};

/**
 * Hall of Fame words at his induction, stored on the player so pages never rebuild them. Called by player.retire with the
 * player object it is about to save. Never throws: a failure only means the words are written on the first view instead.
 */
export const storeHofStoryAtInduction = async (p: Player) => {
	if (!hofWordsOn()) {
		return;
	}
	try {
		const others = (await idb.merged.players.getAll({ hof: true })).filter(
			(p2) => p2.pid !== p.pid,
		);
		p.hofStory = await writeHofStory(p, {
			hofIndex: hofIndexOf([...others, p]),
			feats: await featsByPid(new Set([p.pid])),
		});
	} catch (error) {
		console.error(error);
	}
};

/**
 * Plaque text and speech of these Hall of Famers, from what is stored on them. Inductees from before stored words (or with an
 * older HOF_STORY_VERSION) get them written now, once, and saved. allHof is every Hall of Famer (for the teammate line), only
 * read when something is missing.
 */
export const getHofStories = async (
	players: Player[],
	allHof: Player[] | (() => Promise<Player[]>),
) => {
	const out = new Map<number, HofStory>();
	const missing = players.filter((p) => !hasCurrentStory(p));
	if (missing.length > 0) {
		const all = typeof allHof === "function" ? await allHof() : allHof;
		const hofIndex = hofIndexOf(all);
		const feats = await featsByPid(new Set(missing.map((p) => p.pid)));
		for (const p of missing) {
			const story = await writeHofStory(p, { hofIndex, feats });
			p.hofStory = story;
			await saveHofStory(p.pid, story);
		}
	}
	for (const p of players) {
		out.set(p.pid, p.hofStory!);
	}
	return out;
};

// The plaque as shown: the stored text, plus the season and team of his prime face when the plaque shows one
export const plaqueWithPrime = async (
	story: HofStory,
	prime: { season: number; tid?: number } | undefined,
) => {
	if (!prime) {
		return story.plaque;
	}
	const team =
		prime.tid !== undefined
			? await teamName(prime.tid, prime.season)
			: undefined;
	return `${story.plaque} ${plaquePrimeLine({ season: prime.season, team })}`;
};
