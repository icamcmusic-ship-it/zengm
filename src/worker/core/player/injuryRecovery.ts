// Injury records and recovery: games actually missed per injury record, surgery vs rehab for major injuries, setbacks and early returns
// during a recovery, and the expected return day from the schedule. See docs/native-features.md, Injury depth (injury outlook).
//
// The new mechanics (treatment choice, setbacks/early returns) only act on injuries that carry an outlook (`p.injury.spread`, set in
// game/writePlayerStats.ts with Injury Depth on). Every roll is seeded per player and injury (never Math.random), so the game's random
// stream is unchanged.

import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { last } from "../../../common/utils.ts";
import { PHASE } from "../../../common/constants.ts";
import {
	GAME_TIME_PLAY_PROB,
	gameTimeStatus,
} from "../../../common/injuryOutlook.ts";
import type {
	InjuryTreatment,
	Player,
	PlayerInjuryRecord,
} from "../../../common/types.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { getDayScale, getNumTicks } from "../season/scheduleDayScale.ts";
import { injuryAthleticLoss, majorInjurySeverity } from "./careerAging.ts";
import { syncLatestSubs, tiltRowSubKeys } from "./subRatings.ts";
import addRatingsRow from "./addRatingsRow.ts";
import develop from "./develop.ts";
import limitRating from "./limitRating.ts";
import { refreshTieredBadgesFor } from "./tieredBadges.ts";

const seed = () => g.get("playerTraitsSeed") ?? 0;

// --- Records ---

// The p.injuries record of his current injury: the last one, if it's the same type
export const currentInjuryRecord = (
	p: Pick<Player, "injury" | "injuries">,
): PlayerInjuryRecord | undefined => {
	const rec = p.injuries?.at(-1);
	return rec !== undefined && rec.type === p.injury.type ? rec : undefined;
};

// Store the team games he missed with his current injury on its record, when it's over (healed, replaced or cleared). Only from the
// counter (injuries from before it have no reliable count)
export const finishInjuryRecord = (p: Pick<Player, "injury" | "injuries">) => {
	if (p.injury.type === "Healthy" || p.injury.gamesMissed === undefined) {
		return;
	}
	const rec = currentInjuryRecord(p);
	if (rec) {
		rec.missed = p.injury.gamesMissed;
	}
};

// Games missed with an injury on record: the stored count once it's over, otherwise its recorded length
export const injuryRecordGames = (rec: { games: number; missed?: number }) =>
	rec.missed ?? rec.games;

// --- Surgery vs rehab ---

// Major injuries of at least this many games get the choice
export const TREATMENT_MIN_GAMES = 15;

// Surgery: longer out, less athleticism lost and a shorter re-injury window. Rehab: back sooner, more lost, the usual window
export const TREATMENT = {
	surgery: { duration: 1.15, loss: 0.8, returnWindow: 0.6 },
	rehab: { duration: 0.85, loss: 1.25, returnWindow: 1 },
} as const;

export const isTreatmentInjury = (type: string, games: number) =>
	games >= TREATMENT_MIN_GAMES &&
	majorInjurySeverity(type, games) !== undefined;

// AI teams: a contender wants him back for the stretch run, everyone else protects the long term
export const aiTreatment = (
	strategy: "contending" | "rebuilding" | undefined,
): InjuryTreatment => (strategy === "contending" ? "rehab" : "surgery");

// The user decides for his own team, unless the game is deciding for him (spectator, auto play)
export const userDecidesTreatment = (tid: number, autoPlay: boolean) =>
	g.get("userTids").includes(tid) && !g.get("spectator") && !autoPlay;

// The user's choice stays open until he has missed this many games, then the default (surgery) stands
export const TREATMENT_CHOICE_GAMES = 3;

export const scaleForTreatment = (
	games: number,
	from: InjuryTreatment | undefined,
	to: InjuryTreatment,
) =>
	Math.max(
		1,
		Math.round(
			(games * TREATMENT[to].duration) /
				(from === undefined ? 1 : TREATMENT[from].duration),
		),
	);

// After an injury's ratings loss: pot goes down by what ovr lost, not by a new (noisy) estimate, so it can't go up and stays the same
// when ovr didn't drop
type PotRatings = {
	ovr: number;
	pot: number;
	ovrs?: Record<string, number>;
	pots?: Record<string, number>;
};
export const setPotAfterInjury = (
	prevRatings: PotRatings,
	newRatings: PotRatings,
) => {
	newRatings.pot =
		prevRatings.pot - Math.max(0, prevRatings.ovr - newRatings.ovr);
	if (newRatings.pots && prevRatings.pots) {
		for (const pos of Object.keys(newRatings.pots)) {
			const prevPot = prevRatings.pots[pos];
			if (prevPot !== undefined) {
				newRatings.pots[pos] =
					prevPot -
					Math.max(
						0,
						(prevRatings.ovrs?.[pos] ?? 0) - (newRatings.ovrs?.[pos] ?? 0),
					);
			}
		}
	}
};

/**
 * Career Aging's athleticism loss for the injury record at index, scaled by the treatment (1 without one: exactly the loss as before).
 * Returns whether ratings changed.
 */
export const applyCareerInjuryLoss = async (
	p: Player,
	index: number,
	scale: number,
) => {
	const rec = p.injuries[index];
	if (!rec || last(p.ratings).locked) {
		return false;
	}
	const careerLoss = injuryAthleticLoss({
		pid: p.pid,
		type: rec.type,
		games: rec.games,
		age: rec.season - p.born.year,
		season: rec.season,
		n: index + 1,
		seed: seed(),
	});
	if (!careerLoss) {
		return false;
	}

	addRatingsRow(p, undefined, index);
	const newRatings = last(p.ratings);
	for (const [rating, loss] of Object.entries(careerLoss.loss)) {
		const scaled = scale === 1 ? loss : Math.round(loss * scale);
		(newRatings as any)[rating] = limitRating(
			(newRatings as any)[rating] - scaled,
		);
	}
	// Matching subs: the bases' subs follow (in develop below), and max vertical goes more than standing reach
	const jmpTilt =
		scale === 1 ? careerLoss.jmpTilt : Math.round(careerLoss.jmpTilt * scale);
	if (jmpTilt > 0) {
		syncLatestSubs(p as any);
		tiltRowSubKeys(p as any, newRatings, ["stj"], jmpTilt);
	}

	// Update ovr and pot
	await develop(p, 0);

	const prevRatings = p.ratings.at(-2)!;
	setPotAfterInjury(prevRatings, newRatings);
	rec.ovrDrop = prevRatings.ovr - newRatings.ovr;
	rec.potDrop = prevRatings.pot - newRatings.pot;
	return true;
};

/**
 * Settle the treatment of his current injury (the user's choice, or the default when the choice runs out): the length changes if it's
 * not the one he was put down for, and the deferred athleticism loss is taken. Returns false if there was nothing to settle.
 */
export const settleTreatment = async (
	p: Player,
	treatment: InjuryTreatment,
	careerAging: boolean,
) => {
	if (!p.injury.treatmentOpen) {
		return false;
	}
	const rec = currentInjuryRecord(p);
	if (treatment !== p.injury.treatment && p.injury.gamesRemaining > 0) {
		const before = p.injury.gamesRemaining;
		p.injury.gamesRemaining = scaleForTreatment(
			before,
			p.injury.treatment,
			treatment,
		);
		if (rec) {
			rec.games = Math.max(1, rec.games + p.injury.gamesRemaining - before);
		}
	}
	p.injury.treatment = treatment;
	delete p.injury.treatmentOpen;
	if (rec) {
		rec.treatment = treatment;
		if (careerAging) {
			const lost = await applyCareerInjuryLoss(
				p,
				p.injuries.indexOf(rec),
				TREATMENT[treatment].loss,
			);
			if (lost) {
				// 2K Badges: his tiers from the new ratings, as when the loss is taken at the injury (game/writePlayerStats.ts)
				await refreshTieredBadgesFor(p as any, { noRaise: true });
			}
		}
	}
	return true;
};

// Shorter re-injury window after surgery (call after Injury Depth's onHealed started it)
export const applyTreatmentReturnWindow = (
	p: Pick<Player, "health">,
	treatment: InjuryTreatment | undefined,
) => {
	if (treatment && p.health && p.health.returnGames > 0) {
		p.health.returnGames = Math.max(
			1,
			Math.round(p.health.returnGames * TREATMENT[treatment].returnWindow),
		);
	}
};

// --- Setbacks and early returns ---

// Per day, for injuries this long or longer: equal chances of a setback and of being ahead of schedule, the same size either way (10-30%
// of the games left), so the expected length doesn't change
export const COURSE_MIN_GAMES = 5;
export const COURSE_PROB = 0.015;

export const injuryCourseRoll = (
	p: Pick<Player, "pid" | "injury" | "injuries">,
	season: number,
): number => {
	const injury = p.injury;
	if (
		injury.spread === undefined ||
		injury.gamesRemaining < COURSE_MIN_GAMES ||
		injury.type === "Healthy"
	) {
		return 0;
	}
	const rng = new Rng(
		`injuryCourse|${seed()}|${p.pid}|${season}|${p.injuries?.length ?? 0}|${injury.gamesMissed ?? 0}|${injury.gamesRemaining}`,
	);
	const u = rng.random();
	const size = Math.max(
		1,
		Math.round(injury.gamesRemaining * rng.uniform(0.1, 0.3)),
	);
	if (u < COURSE_PROB) {
		return size;
	}
	if (u < 2 * COURSE_PROB) {
		return -size;
	}
	return 0;
};

// Apply the day's roll to his injury (and its record). Returns the change in games (positive: a setback)
export const applyInjuryCourse = (
	p: Pick<Player, "pid" | "injury" | "injuries">,
	season: number,
) => {
	const delta = injuryCourseRoll(p, season);
	if (delta === 0) {
		return 0;
	}
	p.injury.gamesRemaining = Math.max(1, p.injury.gamesRemaining + delta);
	const rec = currentInjuryRecord(p);
	if (rec) {
		rec.games = Math.max(1, rec.games + delta);
		if (delta > 0) {
			rec.setbacks = (rec.setbacks ?? 0) + 1;
		}
	}
	return delta;
};

// --- Game-time decisions ---

/**
 * Whether a questionable (50%) or doubtful (25%) player plays today. Seeded by player, his team's games so far and his injury's
 * countdown, so a game preview and the game itself agree, and each game is a new roll.
 */
export const gameTimeDecisionPlays = (
	p: Pick<Player, "pid" | "injury">,
	teamGames: number,
	season: number,
	playoffs: boolean,
) => {
	const status = gameTimeStatus(p.injury);
	if (status === undefined || GAME_TIME_PLAY_PROB[status] <= 0) {
		return undefined;
	}
	const rng = new Rng(
		`gameTime|${seed()}|${p.pid}|${season}|${playoffs ? 1 : 0}|${teamGames}|${p.injury.gamesMissed ?? 0}|${p.injury.gamesRemaining}`,
	);
	return rng.random() < GAME_TIME_PLAY_PROB[status]
		? (status as "Q" | "D")
		: undefined;
};

// --- Expected return ---

type ScheduleGame = { day: number; homeTid: number; awayTid: number };

/**
 * The first day of his team's games he's expected to play, from the schedule: the injury countdown runs at the end of every day (only on
 * some days with realistic schedule length, see season/scheduleDayScale.ts), and he plays once it's at 0. Undefined if that's past the
 * games on the schedule.
 */
export const expectedReturnDay = (
	schedule: readonly ScheduleGame[],
	tid: number,
	gamesRemaining: number,
	scale: number,
): number | undefined => {
	const days = [...new Set(schedule.map((game) => game.day))].sort(
		(a, b) => a - b,
	);
	const teamDays = new Set(
		schedule
			.filter((game) => game.homeTid === tid || game.awayTid === tid)
			.map((game) => game.day),
	);
	let left = gamesRemaining;
	for (const [i, day] of days.entries()) {
		if (left <= 0 && teamDays.has(day)) {
			return day;
		}
		left -= getNumTicks(days.length - 1 - i, scale);
	}
	return undefined;
};

// For views and news: loads the schedule once
export const getExpectedReturnDayFinder = async () => {
	const phase = g.get("phase");
	if (phase < PHASE.REGULAR_SEASON || phase > PHASE.PLAYOFFS) {
		return () => undefined;
	}
	const schedule = await idb.cache.schedule.getAll();
	const scale = getDayScale();
	return (tid: number, gamesRemaining: number) =>
		tid < 0 || gamesRemaining <= 0
			? undefined
			: expectedReturnDay(schedule, tid, gamesRemaining, scale);
};

export const returnDayText = (day: number | undefined) =>
	day === undefined ? undefined : `Day ${helpers.numberWithCommas(day)}`;
