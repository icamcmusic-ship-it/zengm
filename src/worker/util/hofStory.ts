// Gathers a player's career facts for the Hall of Fame words in common/hofStory.ts (plaque, induction speech).
import {
	inductionSpeech,
	plaqueText,
	type CareerFacts,
	type HofTeam,
} from "../../common/hofStory.ts";
import { archetypeById } from "../../common/archetypes/index.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { getTeamInfoBySeason } from "./getTeamInfoBySeason.ts";
import { getHeadCoachForSeason } from "../core/staff/data.ts";
import type { Player } from "../../common/types.ts";
import { getPreDraftSchool } from "../../common/preDraft.ts";

const teamNameCache = new Map<string, string>();
const teamName = async (tid: number, season: number) => {
	const key = `${g.get("lid")}:${tid}:${season}`;
	let name = teamNameCache.get(key);
	if (name === undefined) {
		const info = await getTeamInfoBySeason(tid, season);
		name = info ? `${info.region} ${info.name}` : "";
		teamNameCache.set(key, name);
	}
	return name || undefined;
};

const proRows = (p: Player) =>
	p.stats.filter(
		(row: any) => row.tid >= 0 && !row.playoffs && !row.preDraft && row.gp > 0,
	) as any[];

export type HofContext = {
	// Other Hall of Famers' team seasons, "tid:season" keys, for the teammate line
	hofSeasons?: Map<number, { name: string; seasons: Set<string> }>;
	feats?: Map<number, any[]>;
	full?: boolean;
};

const eliminators = new Map<string, Map<number, number>>();
const eliminatorOf = async (tid: number, season: number) => {
	const key = `${g.get("lid")}:${season}`;
	let m = eliminators.get(key);
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
		eliminators.set(key, m);
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
	const arch = p.archetypes?.at(-1);
	if (arch) {
		facts.archetype = archetypeById(arch.id)?.name;
	}

	if (!ctx.full) {
		return facts;
	}

	// Playoff rival: the team that ended his season most often
	const elim = new Map<number, number>();
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
			elim.set(by, (elim.get(by) ?? 0) + 1);
		}
	}
	let rival: [number, number] | undefined;
	for (const e of elim) {
		if (!rival || e[1] > rival[1]) {
			rival = e;
		}
	}
	if (rival) {
		const info = g.get("teamInfoCache")[rival[0]];
		if (info) {
			facts.rival = { name: `${info.region} ${info.name}`, times: rival[1] };
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

	// Fellow Hall of Famer with the most shared seasons
	if (ctx.hofSeasons) {
		const mine = new Set(rows.map((r) => `${r.tid}:${r.season}`));
		let best: { name: string; seasons: number } | undefined;
		for (const [pid, other] of ctx.hofSeasons) {
			if (pid === p.pid) {
				continue;
			}
			let n = 0;
			for (const k of other.seasons) {
				if (mine.has(k)) {
					n += 1;
				}
			}
			if (n >= 2 && (!best || n > best.seasons)) {
				best = { name: other.name, seasons: n };
			}
		}
		facts.teammate = best;
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
		const info = g.get("teamInfoCache")[bestFeat.oppTid];
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

export const hofSeasonsOf = (players: Player[]) => {
	const m = new Map<number, { name: string; seasons: Set<string> }>();
	for (const p of players) {
		m.set(p.pid, {
			name: `${p.firstName} ${p.lastName}`,
			seasons: new Set(proRows(p).map((r) => `${r.tid}:${r.season}`)),
		});
	}
	return m;
};
