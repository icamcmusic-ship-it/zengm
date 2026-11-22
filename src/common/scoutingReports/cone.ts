// Projection cones (scouting reports, prospects): the projected peak as a floor / median / ceiling range instead of a single
// potential. The range comes from what the scouts can't know yet (the report's uncertainty u: scouting points, looks, budget, years to
// his draft, and the scout's own error), his age (younger = a wider cone, more upside) and trajectory signals that are public or the
// scouts' own (his pre-draft production from one season to the next, and how his overall grade moved in our reports). Never from true
// ratings or his own development curve. Under the no visible ratings challenge the cone is shown as role tiers only, no numbers.
// Pure.
import { roleName, tierForOvr } from "./text.ts";
import type { PeerGroup, RoleScale } from "./types.ts";

export type Trajectory = {
	// -1 (trending down) ... 1 (trending up)
	score: number;
	notes: string[];
};

export type PreDraftSeasonLine = {
	season: number;
	// Totals over the season
	min: number;
	pts: number;
	trb: number;
	ast: number;
};

const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;

// Points + rebounds + assists per 36 minutes
const pra36 = (s: PreDraftSeasonLine) => (36 * (s.pts + s.trb + s.ast)) / s.min;

/**
 * Trajectory from his last two pre-draft seasons with real minutes (production per 36) and from our scouts' stored overall grades of
 * him (oldest and latest snapshot, 0-12 grade steps). Undefined when there is nothing to read.
 */
export const trajectoryOf = ({
	seasons,
	grades,
}: {
	seasons: PreDraftSeasonLine[];
	// Overall grades of our snapshots of him, oldest first
	grades: number[];
}): Trajectory | undefined => {
	const notes: string[] = [];
	let sum = 0;
	let w = 0;
	const real = seasons
		.filter((s) => s.min >= 150)
		.sort((a, b) => a.season - b.season);
	if (real.length >= 2) {
		const prev = real.at(-2)!;
		const last = real.at(-1)!;
		const a = pra36(prev);
		const b = pra36(last);
		const x = clamp((b - a) / 6, -1, 1);
		sum += 0.6 * x;
		w += 0.6;
		if (Math.abs(b - a) >= 2.5) {
			notes.push(
				`Production per 36 (points, rebounds, assists) ${b > a ? "up" : "down"} from ${a.toFixed(1)} to ${b.toFixed(1)} (${prev.season} to ${last.season})`,
			);
		}
	}
	if (grades.length >= 2) {
		const d = grades.at(-1)! - grades[0]!;
		const x = clamp(d / 3, -1, 1);
		sum += 0.4 * x;
		w += 0.4;
		if (Math.abs(d) >= 2) {
			notes.push(
				d > 0
					? "His overall grade has risen in our reports"
					: "His overall grade has slipped in our reports",
			);
		}
	}
	if (w === 0) {
		return undefined;
	}
	// Scaled by how much evidence there is: one signal moves the cone less than two that agree
	return { score: Math.round(100 * sum) / 100, notes };
};

export type ConeNumbers = { floor: number; median: number; ceiling: number };

/**
 * A prospect's cone in visible ovr points: the median is the expected peak, the ceiling and floor spread out with the uncertainty and
 * his age, and the whole cone leans with his trajectory.
 */
export const coneNumbers = ({
	ovr,
	pot,
	age,
	u,
	optimism,
	trajectory,
}: {
	ovr: number;
	pot: number;
	age: number;
	u: number;
	optimism: number;
	trajectory?: number;
}): ConeNumbers => {
	const t = trajectory ?? 0;
	// Years of development left, roughly: a 19-year-old's cone is much wider than a 23-year-old's
	const youth = clamp(21.5 - age, -1.5, 3);
	const median = pot - 1 + 0.6 * optimism + 1.5 * t;
	const ceiling =
		median + 4.5 + 1.2 * u + Math.max(0, youth) + 1.2 * Math.max(0, t);
	const floor = Math.max(
		ovr - 1,
		median - 6 - 1.1 * u - 0.6 * Math.max(0, youth) + 1 * Math.min(0, t),
	);
	return {
		floor: Math.round(Math.min(floor, median)),
		median: Math.round(median),
		ceiling: Math.round(Math.max(ceiling, median)),
	};
};

export type Cone = {
	// Visible ovr numbers, only when ratings are shown
	numbers?: ConeNumbers;
	floorRole: string;
	medianRole: string;
	ceilingRole: string;
	width: "Narrow" | "Moderate" | "Wide";
	notes: string[];
	trend?: "up" | "down";
};

export const coneWidth = (floor: number, ceiling: number): Cone["width"] =>
	ceiling - floor <= 10
		? "Narrow"
		: ceiling - floor <= 17
			? "Moderate"
			: "Wide";

export const buildCone = ({
	numbers,
	showNumbers,
	scale,
	group,
	age,
	u,
	trajectory,
}: {
	numbers: ConeNumbers;
	showNumbers: boolean;
	scale: RoleScale;
	group: PeerGroup;
	age: number;
	u: number;
	trajectory?: Trajectory;
}): Cone => {
	const role = (x: number) => roleName(tierForOvr(x, scale), group);
	const notes: string[] = [];
	if (u >= 5) {
		notes.push("Wide because our scouts haven't seen enough of him yet");
	} else if (u <= 2) {
		notes.push("Our scouts have seen plenty of him");
	}
	if (age <= 19) {
		notes.push("Young for the class: more room to grow");
	} else if (age >= 23) {
		notes.push("Old for the class: closer to what he'll be");
	}
	if (trajectory) {
		notes.push(...trajectory.notes);
	}
	return {
		numbers: showNumbers ? numbers : undefined,
		floorRole: role(numbers.floor),
		medianRole: role(numbers.median),
		ceilingRole: role(numbers.ceiling),
		width: coneWidth(numbers.floor, numbers.ceiling),
		notes,
		trend:
			trajectory && trajectory.score >= 0.25
				? "up"
				: trajectory && trajectory.score <= -0.25
					? "down"
					: undefined,
	};
};
