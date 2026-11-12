// What is stored for scouting reports, and what is read back from it: compact grade snapshots on each player (the stock up/down
// changelog) and the department's take at the draft (the track record and each scout's accuracy). Pure.
import { PHASE } from "../constants.ts";
import { GRADE_LABELS } from "./categories.ts";
import { decodeGrades, encodeGrades, gradeLetter } from "./grades.ts";
import { draftTierName, outcomeName, tierForOvr } from "./text.ts";
import {
	GRADE_KEYS,
	type GradeKey,
	type RoleScale,
	type ScoutTake,
} from "./types.ts";

// One snapshot: season, phase, grades (GRADE_KEYS order, one character each), overall grade, scouting looks, and a few stats
// (x10, rounded): 3P%, FT%, turnovers per 36, points per 36, minutes played
export type ScoutSnap = {
	s: number;
	ph: number;
	g: string;
	o: number;
	l?: number;
	x?: number[];
};

// The department's take at the draft: season, consensus expected tier, scouts (lead first), each one's expected tier, overall grade
export type ScoutDraftRecord = {
	s: number;
	t: number;
	by: number[];
	v: number[];
	o: number;
};

export const MAX_SNAPS = 8;

export type SnapStats = {
	tpPct?: number;
	ftPct?: number;
	tov36?: number;
	pts36?: number;
	min?: number;
};

export const makeSnap = (
	season: number,
	phase: number,
	take: Pick<ScoutTake, "grades" | "overall">,
	looks: number | undefined,
	stats: SnapStats | undefined,
): ScoutSnap => {
	const byKey = new Map(take.grades.map((g) => [g.key, g.grade]));
	const snap: ScoutSnap = {
		s: season,
		ph: phase,
		g: encodeGrades(GRADE_KEYS.map((k) => byKey.get(k) ?? 0)),
		o: take.overall.grade,
	};
	if (looks !== undefined && looks > 0) {
		snap.l = looks;
	}
	if (stats && (stats.min ?? 0) > 0) {
		snap.x = [
			Math.round(10 * (stats.tpPct ?? 0)),
			Math.round(10 * (stats.ftPct ?? 0)),
			Math.round(10 * (stats.tov36 ?? 0)),
			Math.round(10 * (stats.pts36 ?? 0)),
			Math.round(stats.min ?? 0),
		];
	}
	return snap;
};

// Add a snapshot, replacing one for the same season and phase, keeping the newest MAX_SNAPS. Returns a new array, or undefined if
// nothing changed (same grades as the last snapshot of the same season and phase)
export const addSnap = (snaps: ScoutSnap[] | undefined, snap: ScoutSnap) => {
	const list = (snaps ?? []).filter(
		(x) => !(x.s === snap.s && x.ph === snap.ph),
	);
	const prev = (snaps ?? []).find((x) => x.s === snap.s && x.ph === snap.ph);
	if (prev && prev.g === snap.g && prev.o === snap.o && prev.l === snap.l) {
		return undefined;
	}
	list.push(snap);
	list.sort((a, b) => a.s - b.s || a.ph - b.ph);
	return list.slice(-MAX_SNAPS);
};

export const phaseLabel = (ph: number) =>
	ph === PHASE.PRESEASON
		? "Preseason"
		: ph === PHASE.REGULAR_SEASON
			? "Regular season"
			: ph === PHASE.AFTER_TRADE_DEADLINE
				? "Trade deadline"
				: ph === PHASE.PLAYOFFS
					? "End of regular season"
					: ph === PHASE.DRAFT_LOTTERY
						? "Before the draft"
						: ph === PHASE.DRAFT
							? "Draft"
							: "Offseason";

export type ChangeEntry = {
	season: number;
	label: string;
	changes: {
		key: GradeKey;
		label: string;
		from: string;
		to: string;
		up: boolean;
		text: string;
	}[];
	overall?: { from: string; to: string; up: boolean };
};

const REASON_KEYS: Partial<Record<GradeKey, number>> = {
	shoot: 0,
	cs: 0,
	ft: 1,
	bs: 2,
	fin: 3,
	od: 3,
};

// Why a grade moved, from what changed between the two snapshots
const reasonFor = (
	key: GradeKey,
	up: boolean,
	a: ScoutSnap,
	b: ScoutSnap,
	prospect: boolean,
) => {
	if ((b.l ?? 0) > (a.l ?? 0)) {
		return up
			? "after another in-person look"
			: "after a closer look exposed it";
	}
	const idx = REASON_KEYS[key];
	if (a.x && b.x && idx !== undefined && (b.x[4] ?? 0) >= 150) {
		const before = a.x[idx]! / 10;
		const after = b.x[idx]! / 10;
		if (idx === 0 && Math.abs(after - before) >= 2) {
			return after > before
				? `after shooting ${after.toFixed(1)}% from three`
				: `after a cold stretch from three (${after.toFixed(1)}%)`;
		}
		if (idx === 1 && Math.abs(after - before) >= 3) {
			return `with ${after.toFixed(1)}% at the line`;
		}
		if (idx === 2 && Math.abs(after - before) >= 0.5) {
			return after < before
				? "as the turnovers came down"
				: "as the turnovers piled up";
		}
		if (idx === 3 && Math.abs(after - before) >= 2) {
			return after > before
				? `after a hot ${prospect ? "conference season" : "stretch"} (${after.toFixed(1)} points per 36)`
				: `after a quiet stretch (${after.toFixed(1)} points per 36)`;
		}
	}
	if (b.ph === PHASE.PRESEASON && b.s > a.s) {
		return up
			? "after an offseason of work"
			: "after a summer that didn't move him forward";
	}
	if (!b.x && !a.x) {
		return up ? "as more tape came in" : "on second viewing";
	}
	return up
		? prospect
			? "after a strong conference season"
			: "on the season's tape"
		: prospect
			? "after a rough conference season"
			: "as the season wore on";
};

/**
 * Stock up/down: what changed between consecutive snapshots (and, if given, between the last one and now), newest first. A sub-grade
 * moving with its parent is folded into the parent.
 */
export const buildChangelog = (
	snaps: ScoutSnap[],
	current: ScoutSnap | undefined,
	prospect: boolean,
	maxPerEntry = 4,
) => {
	const list = [...snaps];
	if (current) {
		const last = list.at(-1);
		if (!last || last.g !== current.g || last.o !== current.o) {
			list.push({ ...current });
		}
	}
	const out: ChangeEntry[] = [];
	for (let i = 1; i < list.length; i++) {
		const a = list[i - 1]!;
		const b = list[i]!;
		if (a.g.length !== b.g.length) {
			continue;
		}
		const ga = decodeGrades(a.g);
		const gb = decodeGrades(b.g);
		const changes: ChangeEntry["changes"] = [];
		GRADE_KEYS.forEach((key, k) => {
			const from = ga[k]!;
			const to = gb[k]!;
			if (from === to) {
				return;
			}
			const up = to > from;
			const label = GRADE_LABELS[key];
			changes.push({
				key,
				label,
				from: gradeLetter(from),
				to: gradeLetter(to),
				up,
				text: `${up ? "Raised" : "Lowered"}: ${label} ${gradeLetter(from)} → ${gradeLetter(to)} ${reasonFor(key, up, a, b, prospect)}`,
			});
		});
		if (changes.length === 0 && a.o === b.o) {
			continue;
		}
		changes.sort(
			(x, y) =>
				Math.abs(
					gb[GRADE_KEYS.indexOf(y.key)]! - ga[GRADE_KEYS.indexOf(y.key)]!,
				) -
				Math.abs(
					gb[GRADE_KEYS.indexOf(x.key)]! - ga[GRADE_KEYS.indexOf(x.key)]!,
				),
		);
		out.push({
			season: b.s,
			label: b === current ? "Now" : phaseLabel(b.ph),
			changes: changes.slice(0, maxPerEntry),
			overall:
				a.o !== b.o
					? { from: gradeLetter(a.o), to: gradeLetter(b.o), up: b.o > a.o }
					: undefined,
		});
	}
	return out.reverse();
};

// What a career became, as a role tier (same scale as projections)
export const outcomeTier = ({
	peakOvr,
	awards,
	proSeasons,
	scale,
}: {
	peakOvr: number;
	awards: { allStar: number; allLeague: number; mvp: number };
	proSeasons: number;
	scale: RoleScale;
}) => {
	if (awards.mvp > 0 || awards.allLeague >= 3 || peakOvr >= scale.franchise) {
		return 7;
	}
	if (awards.allStar > 0 || awards.allLeague > 0 || peakOvr >= scale.allStar) {
		return 6;
	}
	if (proSeasons <= 1) {
		return Math.min(1, tierForOvr(peakOvr, scale));
	}
	return Math.min(5, tierForOvr(peakOvr, scale));
};

// A draft take can be judged once the career has had time: 4 seasons after the draft, or retired
export const judgeable = (
	draftSeason: number,
	season: number,
	retired: boolean,
) => retired || season - draftSeason >= 4;

export const trackLine = (said: number, became: number) =>
	`Our scouts said: ${draftTierName(said)} → ${outcomeName(became)}`;

export type ScoutCall = {
	scoutId: number;
	pid: number;
	name: string;
	season: number;
	said: number;
	became: number;
};

// A scout's accuracy over his judged calls: hit = within one tier
export const scoutAccuracy = (calls: ScoutCall[]) => {
	if (calls.length === 0) {
		return undefined;
	}
	let hits = 0;
	let err = 0;
	let best: ScoutCall | undefined;
	let worst: ScoutCall | undefined;
	for (const c of calls) {
		const d = c.became - c.said;
		err += Math.abs(d);
		if (Math.abs(d) <= 1) {
			hits += 1;
		}
		// Best call: a correct call on a player who became good (or a correct fade); worst: the biggest miss
		if (Math.abs(d) <= 1 && (!best || c.became > best.became)) {
			best = c;
		}
		if (!worst || Math.abs(d) > Math.abs(worst.became - worst.said)) {
			worst = c;
		}
	}
	return {
		calls: calls.length,
		hits,
		hitRate: hits / calls.length,
		avgError: err / calls.length,
		best,
		worst:
			worst && Math.abs(worst.became - worst.said) >= 2 ? worst : undefined,
	};
};
