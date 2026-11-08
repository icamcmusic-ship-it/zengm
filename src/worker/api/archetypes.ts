// Worker API for archetypes: a team's roster composition and the league landscape. Everything uses the STORED archetype
// of each player (set at the start of each preseason), with a live reading for prospects and players without one yet.
import { featureOn } from "../util/nativeFeatures.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	archetypeById,
	compositionOf,
	landscapeOf,
	viewOf,
	type ArchetypeGroup,
	type Composition,
	type Landscape,
	type Rated,
} from "../../common/archetypes/index.ts";
import { last } from "../../common/utils.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { archetypeFor, getLeagueNorms } from "../core/player/archetype.ts";

export type ArchetypeRosterPlayer = {
	pid: number;
	name: string;
	pos: string;
	ovr: number;
	label: string;
	group: ArchetypeGroup;
	secondary?: string;
	live: boolean;
};

export type ArchetypeRoster = {
	enabled: boolean;
	composition: Composition;
	players: ArchetypeRosterPlayer[];
};

const EMPTY_COMPOSITION: Composition = {
	counts: [],
	byGroup: { guard: 0, wing: 0, forward: 0, big: 0 },
	byFamily: {},
	warnings: [],
	known: 0,
};

export const archetypeRoster = async ({
	tid,
}: {
	tid: number;
}): Promise<ArchetypeRoster> => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return { enabled: false, composition: EMPTY_COMPOSITION, players: [] };
	}
	const norms = await getLeagueNorms();
	const raw = await idb.cache.players.indexGetAll("playersByTid", tid);
	const players: ArchetypeRosterPlayer[] = [];
	const rated: Rated[] = [];
	for (const p of raw) {
		const found = archetypeFor(p, norms);
		const row = last(p.ratings) as any;
		if (!found) {
			continue;
		}
		players.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: row.pos,
			ovr: row.ovr,
			label: found.view.label,
			group: found.view.group,
			secondary: found.view.secondaryName,
			live: !found.stored,
		});
		rated.push({
			pid: p.pid,
			ovr: row.ovr,
			archetypeId: found.view.id,
			secondaryId: found.view.secondaryId,
		});
	}
	players.sort((a, b) => b.ovr - a.ovr || a.pid - b.pid);
	return { enabled: true, composition: compositionOf(rated), players };
};

export type ArchetypeTopPlayer = {
	pid: number;
	name: string;
	ovr: number;
	abbrev: string;
};

export type ArchetypeLandscape = {
	enabled: boolean;
	season: number;
	total: number;
	byGroup: Landscape["byGroup"];
	rows: {
		id: string;
		name: string;
		group: ArchetypeGroup;
		desc: string;
		count: number;
		share: number;
		top: ArchetypeTopPlayer[];
	}[];
	// Per preseason: how many players had each group's archetypes, and the three most common archetypes
	trend: {
		season: number;
		total: number;
		groups: Record<ArchetypeGroup, number>;
		top: { name: string; count: number }[];
	}[];
};

export const archetypeLandscape = async (): Promise<ArchetypeLandscape> => {
	const season = g.get("season");
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return {
			enabled: false,
			season,
			total: 0,
			byGroup: { guard: 0, wing: 0, forward: 0, big: 0 },
			rows: [],
			trend: [],
		};
	}
	const norms = await getLeagueNorms();
	const raw = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const abbrevs = new Map<number, string>();
	for (const t of await idb.cache.teams.getAll()) {
		abbrevs.set(t.tid, t.abbrev);
	}
	const rated: (Rated & { name: string; tid: number })[] = [];
	for (const p of raw) {
		const found = archetypeFor(p, norms);
		if (!found) {
			continue;
		}
		rated.push({
			pid: p.pid,
			ovr: (last(p.ratings) as any).ovr,
			archetypeId: found.view.id,
			name: `${p.firstName} ${p.lastName}`,
			tid: p.tid,
		});
	}
	const landscape = landscapeOf(rated, 3);
	const byPid = new Map(rated.map((r) => [r.pid, r]));

	// Trend from every stored entry (retired players included, as far as the cache holds them)
	const all = await idb.cache.players.getAll();
	const bySeason = new Map<
		number,
		{
			groups: Record<ArchetypeGroup, number>;
			ids: Map<string, number>;
			total: number;
		}
	>();
	for (const p of all) {
		for (const e of p.archetypes ?? []) {
			const v = viewOf(e);
			if (!v) {
				continue;
			}
			let s = bySeason.get(e.season);
			if (!s) {
				s = {
					groups: { guard: 0, wing: 0, forward: 0, big: 0 },
					ids: new Map(),
					total: 0,
				};
				bySeason.set(e.season, s);
			}
			s.groups[v.group]++;
			s.total++;
			s.ids.set(v.id, (s.ids.get(v.id) ?? 0) + 1);
		}
	}
	const trend = [...bySeason.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([s, v]) => ({
			season: s,
			total: v.total,
			groups: v.groups,
			top: [...v.ids.entries()]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
				.slice(0, 3)
				.map(([id, count]) => ({ name: archetypeById(id)!.name, count })),
		}));

	return {
		enabled: true,
		season,
		total: landscape.total,
		byGroup: landscape.byGroup,
		rows: landscape.byArchetype.map((r) => ({
			id: r.id,
			name: r.name,
			group: r.group,
			desc: archetypeById(r.id)!.desc,
			count: r.count,
			share: r.share,
			top: r.top.map((t) => {
				const x = byPid.get(t.pid)!;
				return {
					pid: t.pid,
					name: x.name,
					ovr: t.ovr,
					abbrev: x.tid >= 0 ? (abbrevs.get(x.tid) ?? "") : "FA",
				};
			}),
		})),
		trend,
	};
};

export default { landscape: archetypeLandscape, roster: archetypeRoster };
