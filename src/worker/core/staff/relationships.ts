// Player–coach relationships (featurePlayerCoachRel, basketball, needs Coaching Staff). Pure parts in common/playerCoachRel.ts.
//
// After each season (staff.runOffseason, before coaches change jobs) every rostered player's bond with his head coach moves with the season:
// minutes against his place in the rotation, development against his age, the coach's personality against his ego, winning, loyalty and a
// little seeded noise. The bond feeds a mood component (only for the team whose head coach it is, so it also counts for a free agent
// choosing a team whose coach he knows), and the size of his development plan. Off: nothing runs and nothing is stored. No Math.random.
import { salted } from "../../../common/leagueSalt.ts";
import {
	expectedMinutes,
	MAX_COACH_RELS,
	relDevBoost,
	relLabel,
	relMood,
	relSeasonDelta,
	typicalOvrChange,
	type PlayerCoachRel,
} from "../../../common/playerCoachRel.ts";
import { hashString } from "../../../common/coachSystems.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { getEgoScore, getMoodTraits, traitsEnabled } from "../player/traits.ts";
import { getCoachProfile } from "./systems.ts";

export const coachRelEnabled = () =>
	__SPORT === "basketball" &&
	!!g.get("coachingStaff") &&
	nativeFeatureEnabled("playerCoachRel", (key) => g.get(key as any));

export const findRel = (p: Pick<Player, "coachRels">, cid: number) =>
	p.coachRels?.find((r) => r.cid === cid);

// Head coach cid of every team (for the development plans, read synchronously)
export const headCoachByTid = async () => {
	const out = new Map<number, number>();
	if (!coachRelEnabled()) {
		return out;
	}
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.tid >= 0 && c.role === "head") {
			out.set(c.tid, c.cid);
		}
	}
	return out;
};

// Development plan: extra development coach rating points from his bond with his head coach (0 when off or no bond)
export const relDevRatingBoost = (
	p: Pick<Player, "coachRels" | "tid">,
	heads: Map<number, number>,
) => {
	const cid = heads.get(p.tid);
	if (cid === undefined) {
		return 0;
	}
	const rel = findRel(p, cid);
	return rel ? relDevBoost(rel.v) : 0;
};

// Mood component for player p and team tid: his bond with that team's head coach
export const coachRelMood = async (
	p: Pick<Player, "coachRels">,
	tid: number,
) => {
	if (!coachRelEnabled() || tid < 0 || !p.coachRels) {
		return 0;
	}
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	const head = coaches.find((c) => c.role === "head");
	if (!head) {
		return 0;
	}
	const rel = findRel(p, head.cid);
	return rel ? relMood(rel.v) : 0;
};

// For the player page: his bond with his current head coach, and his closest and worst other bonds
export const coachRelSummary = async (p: Pick<Player, "coachRels" | "tid">) => {
	if (!coachRelEnabled() || !p.coachRels || p.coachRels.length === 0) {
		return undefined;
	}
	const rows = [];
	for (const r of p.coachRels.toSorted((a, b) => b.s - a.s)) {
		const c = await idb.cache.coaches.get(r.cid);
		rows.push({
			cid: r.cid,
			name: c ? `${c.firstName} ${c.lastName}` : "A former coach",
			current: !!c && c.tid === p.tid && c.role === "head" && p.tid >= 0,
			abbrev: g.get("teamInfoCache")[r.tid]?.abbrev,
			label: relLabel(r.v),
			v: r.v,
			seasons: r.n,
			last: r.s,
		});
	}
	return rows;
};

const ovrOf = (row: any) =>
	typeof row?.ovr === "number" ? row.ovr : undefined;

/**
 * After the season (before the coaching market): every rostered player's bond with his head coach moves with the season. Deterministic
 * (seeded per player, coach and season).
 */
export const updateRelationships = async () => {
	if (!coachRelEnabled()) {
		return;
	}
	const season = g.get("season");
	const heads = new Map<number, { cid: number; personality: number }>();
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.tid >= 0 && c.role === "head") {
			heads.set(c.tid, {
				cid: c.cid,
				personality: getCoachProfile(c).personality,
			});
		}
	}
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as Player[];
	const byTid = new Map<number, Player[]>();
	for (const p of players) {
		const list = byTid.get(p.tid) ?? [];
		list.push(p);
		byTid.set(p.tid, list);
	}
	const useTraits = traitsEnabled();
	const moodTraits = !!g.get("playerMoodTraits");
	for (const [tid, list] of byTid) {
		const head = heads.get(tid);
		if (!head) {
			continue;
		}
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			tid,
		]);
		const gpTeam = ts ? ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) : 0;
		const winp = gpTeam > 0 ? (ts!.won + 0.5 * (ts!.tied ?? 0)) / gpTeam : 0.5;
		const ranked = list.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
		for (const [rank, p] of ranked.entries()) {
			const row = p.stats.findLast(
				(r) => r.season === season && !r.playoffs && r.tid === tid,
			);
			const gp = row?.gp ?? 0;
			// Barely with the team this season (late signing, a long injury): too little to go on
			if (gp < 10) {
				continue;
			}
			const mpg = (row?.min ?? 0) / gp;
			const minutes = (mpg - expectedMinutes(rank)) / 8;
			const now = p.ratings.findLast((r) => r.season === season);
			const before = p.ratings.findLast((r) => r.season === season - 1);
			const ovrNow = ovrOf(now);
			const ovrBefore = ovrOf(before);
			const dev =
				ovrNow !== undefined && ovrBefore !== undefined
					? (ovrNow - ovrBefore - typicalOvrChange(season - p.born.year)) / 4
					: 0;
			const random = makeSeededRandom(
				hashString(salted(`coachRel|${p.pid}|${head.cid}|${season}`)),
			);
			const rels = p.coachRels ?? [];
			let rel: PlayerCoachRel | undefined = rels.find(
				(r) => r.cid === head.cid,
			);
			if (rel?.s === season) {
				continue;
			}
			if (!rel) {
				rel = { cid: head.cid, tid, v: 0, n: 0, s: season };
				rels.push(rel);
			}
			rel.v = relSeasonDelta({
				v: rel.v,
				minutes,
				dev,
				personality: head.personality,
				ego: useTraits ? getEgoScore(p as any) : undefined,
				traits: moodTraits ? getMoodTraits(p as any) : [],
				winp,
				noise: 2 * random() - 1,
			});
			rel.n += 1;
			rel.s = season;
			rel.tid = tid;
			p.coachRels = rels.toSorted((a, b) => b.s - a.s).slice(0, MAX_COACH_RELS);
			await idb.cache.players.put(p);
		}
	}
};

// Coach page: the players he has a bond with (current roster first), from the players in the cache
export const coachRelationshipsFor = async (cid: number) => {
	if (!coachRelEnabled()) {
		return undefined;
	}
	const c = await idb.cache.coaches.get(cid);
	const players = (await idb.cache.players.getAll()) as Player[];
	const out = [];
	for (const p of players) {
		const rel = findRel(p, cid);
		if (!rel) {
			continue;
		}
		out.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			current: !!c && c.tid >= 0 && p.tid === c.tid,
			abbrev: g.get("teamInfoCache")[p.tid]?.abbrev,
			label: relLabel(rel.v),
			v: rel.v,
			seasons: rel.n,
			last: rel.s,
		});
	}
	return out
		.sort((a, b) => Number(b.current) - Number(a.current) || b.v - a.v)
		.slice(0, 40);
};
