import { PLAYER } from "../../../common/constants.ts";
import { MAX_LEVEL } from "../../../common/budgetLevels.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { last } from "../../../common/utils.ts";
import type { Player, ScoutingEntry } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { finances, player } from "../index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

/**
 * The scouting system: every season the user's scouting budget gives a number of scouting points to spend on individual prospects. A scout assignment or a workout shrinks that prospect's rating fuzz (what the user sees, AI teams always see true ratings), and the scout report gives confidence ranges that narrow with each one. Prospects nobody scouted keep the global fuzz from the scouting budget.
 */

export const SCOUTING_ACTIONS = {
	scout: { points: 1, factor: 0.6 },
	workout: { points: 3, factor: 0.3 },
} as const;

// Expected |fuzz| of a fresh prospect at an average scouting budget, the scale for confidence ranges
const BASE_UNCERTAINTY = 4;

export const getScoutingPointsForLevel = (level: number) =>
	Math.round(6 + (14 * helpers.bound(level, 0, MAX_LEVEL)) / MAX_LEVEL);

export const getScoutingPoints = async () => {
	const level = await finances.getLevelLastThree("scouting", {
		tid: g.get("userTid"),
	});
	return getScoutingPointsForLevel(level);
};

const getProspects = () =>
	idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED);

export const getScoutingPointsUsed = async (season = g.get("season")) => {
	let used = 0;
	for (const p of await getProspects()) {
		for (const entry of p.scouting ?? []) {
			if (entry.season === season) {
				used += entry.points;
			}
		}
	}
	return used;
};

export const getScoutingStatus = async () => {
	const total = await getScoutingPoints();
	const used = await getScoutingPointsUsed();
	return { total, used, remaining: Math.max(0, total - used) };
};

// How unsure the user's staff still is about this prospect, in rating points. Each scouting action multiplies it down
export const getUncertainty = (scouting: ScoutingEntry[] | undefined) => {
	let u = BASE_UNCERTAINTY;
	for (const entry of scouting ?? []) {
		u *= SCOUTING_ACTIONS[entry.type].factor;
	}
	return u;
};

export const scoutProspect = async (
	pid: number,
	type: keyof typeof SCOUTING_ACTIONS,
): Promise<{ error?: string }> => {
	if (!featureOn("scoutingSystem")) {
		return { error: "The scouting system is disabled in League Settings." };
	}
	const p = await idb.cache.players.get(pid);
	if (!p || p.tid !== PLAYER.UNDRAFTED) {
		return { error: "Only draft prospects can be scouted." };
	}
	const action = SCOUTING_ACTIONS[type];
	const { remaining } = await getScoutingStatus();
	if (remaining < action.points) {
		return {
			error: `Not enough scouting points left this season (${remaining} left, ${action.points} needed).`,
		};
	}

	applyScouting(p, type, g.get("season"));
	await player.updateValues(p);
	await idb.cache.players.put(p);
	return {};
};

// Pure part, exported for tests
export const applyScouting = (
	p: Pick<Player, "ratings" | "scouting">,
	type: keyof typeof SCOUTING_ACTIONS,
	season: number,
) => {
	const action = SCOUTING_ACTIONS[type];
	const ratings = last(p.ratings);
	const fuzzBefore = Math.abs(ratings.fuzz);
	ratings.fuzz *= action.factor;
	if (!p.scouting) {
		p.scouting = [];
	}
	p.scouting.push({ season, type, points: action.points, fuzzBefore });
};

export type ScoutReport = {
	scouted: boolean;
	numScouts: number;
	numWorkouts: number;
	confidence: "Low" | "Medium" | "High" | "Very high";
	ovr: [number, number];
	pot: [number, number];
	notes: string[];
};

const NOTES_STRENGTH: Record<string, string> = {
	"3": "Knockdown shooter from deep",
	A: "Explosive athlete",
	B: "Gifted ball handler",
	Di: "Interior defender who changes shots",
	Dp: "Pesky perimeter defender",
	Po: "Polished in the post",
	Ps: "Sees the floor, a willing passer",
	R: "Relentless on the glass",
	V: "Can create his own shot at volume",
};

/**
 * What the user's scouts say about a prospect: the displayed (fuzzed) ovr/pot with a confidence range around it, and a few notes. The ranges come from the remaining uncertainty, never from the true ratings, so the report can't leak more than the scouting paid for.
 */
export const getScoutReport = (p: Player): ScoutReport => {
	const ratings = last(p.ratings);
	const ovr = player.fuzzRating(ratings.ovr, ratings.fuzz);
	const pot = player.fuzzRating(ratings.pot, ratings.fuzz);
	const scouting = p.scouting ?? [];
	const u = getUncertainty(scouting);
	const yearsOut = Math.max(0, p.draft.year - g.get("season"));
	const ovrHalf = Math.max(1, Math.round(1.5 * u));
	const potHalf = Math.max(2, Math.round(2.5 * u + yearsOut));
	const confidence =
		u >= 3.5 ? "Low" : u >= 2 ? "Medium" : u >= 1 ? "High" : "Very high";

	const notes: string[] = [];
	const skills: string[] = ratings.skills ?? [];
	if (__SPORT === "basketball") {
		for (const skill of skills) {
			const note = NOTES_STRENGTH[skill];
			if (note) {
				notes.push(note);
			}
		}
	} else if (skills.length > 0) {
		notes.push(`Skills: ${skills.join(", ")}`);
	}
	const gap = pot - ovr;
	if (gap >= 18) {
		notes.push("Raw, with a high ceiling: a multi-year project");
	} else if (gap <= 8) {
		notes.push("Close to a finished product, can help right away");
	}
	if (p.ratingsBuild?.name) {
		notes.push(`Projects as a ${p.ratingsBuild.name}`);
	}
	if (__SPORT === "basketball") {
		const rows = getPreDraftStats(p);
		const lastRow = rows.at(-1) as any;
		if (lastRow && lastRow.gp > 0) {
			const pts = (lastRow.pts / lastRow.gp).toFixed(1);
			const trb = ((lastRow.orb + lastRow.drb) / lastRow.gp).toFixed(1);
			notes.push(
				`${lastRow.season}: ${pts} pts, ${trb} reb per game${lastRow.teamName ? ` at ${lastRow.teamName}` : ""}`,
			);
		}
	}
	if (scouting.length === 0) {
		notes.push("Not scouted yet: based on general reports only");
	} else if (scouting.some((entry) => entry.type === "workout")) {
		notes.push("Seen in a private workout");
	}

	return {
		scouted: scouting.length > 0,
		numScouts: scouting.filter((entry) => entry.type === "scout").length,
		numWorkouts: scouting.filter((entry) => entry.type === "workout").length,
		confidence,
		ovr: [Math.max(0, ovr - ovrHalf), Math.min(100, ovr + ovrHalf)],
		pot: [Math.max(0, pot - potHalf), Math.min(100, pot + potHalf)],
		notes,
	};
};
