// Coach Decisions (the coachDecisions setting, basketball; docs/native-features.md "Coach decisions"): the league side. Each game day,
// after applyCoachSystems, every team's head coach makes his calls for the game (common/coachDecisions.ts planCoachDecisions): rest
// nights, starters, the rotation order, minutes, the matchup and the stopper, and the note that explains them. After each game his
// players' form (earned and lost roles) and promised roles are updated (recordCoachDecisionGame, from writePlayerStats).
//
// Off (or without Coaching Systems / Realistic Rotations): nothing here runs and nothing is stored.

import {
	coachGameSettings,
	coachMind,
	decisionRatingsFor,
	delegationFor,
	deriveDecisionTraits,
	leagueRead,
	perceiveTeam,
	planCoachDecisions,
	readTeam,
	restNightChance,
	unitHash,
	updateForm,
	type CoachDelegation,
	type CoachMind,
	type DecisionContext,
	type DecisionPlan,
	type DecisionPlayer,
	type LineupPreset,
	type TeamRead,
} from "../../../common/coachDecisions.ts";
import { PHASE } from "../../../common/constants.ts";
import { coachAgeOffset } from "../../../common/staff.ts";
import type {
	CoachProfile,
	CoachWithoutKey,
	Player,
	Team,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { getEgoScore, traitsEnabled } from "../player/traits.ts";
import { getVideoBoost } from "../staffDepth/coaching.ts";
import { coachDecisionsOn, isUserRun } from "./rolePromise.ts";
import {
	getCoachProfile,
	getLeagueCoachSystems,
	playerSystemFit,
} from "./systems.ts";

export { coachDecisionsOn, isUserRun };

// ---- ratings and traits ----

/** Game prep and player management for a coach who has none (stable, no random draws). Returns true if it changed him. */
export const ensureDecisionRatings = (c: CoachWithoutKey) => {
	if (c.ratings.prp !== undefined && c.ratings.plm !== undefined) {
		return false;
	}
	const d = decisionRatingsFor({
		...c,
		ageOffset: coachAgeOffset(g.get("season") - c.born.year),
	});
	c.ratings.prp = d.prp;
	c.ratings.plm = d.plm;
	return true;
};

/** Every coach of the league gets the two ratings (an existing league, the first time the setting is on). */
export const ensureAllDecisionRatings = async () => {
	if (!coachDecisionsOn()) {
		return;
	}
	for (const c of await idb.cache.coaches.getAll()) {
		if (ensureDecisionRatings(c)) {
			await idb.cache.coaches.put(c);
		}
	}
};

/** His loyalty, foul-trouble and injury-plan dials (stored ones, else derived). */
export const decisionTraitsOf = (c: CoachWithoutKey, profile: CoachProfile) => {
	const derived = deriveDecisionTraits({ ...c, profile });
	return {
		loyalty: profile.loyalty ?? derived.loyalty,
		foulRide: profile.foulRide ?? derived.foulRide,
		injuryNext: profile.injuryNext ?? derived.injuryNext,
	};
};

export const mindOf = async (c: CoachWithoutKey, profile?: CoachProfile) => {
	const prof = profile ?? getCoachProfile(c);
	const ratings = { ...c.ratings, ...decisionRatingsFor({ ...c }) };
	// Coaching Staff Depth: the video coordinator helps him prepare (the same boost his game management gets)
	const video = c.tid >= 0 ? await getVideoBoost(c.tid) : undefined;
	return coachMind(ratings, prof, decisionTraitsOf(c, prof), video?.mgmt ?? 0);
};

// ---- the user's team ----

const ALL_COACH: CoachDelegation = {
	starters: true,
	rotation: true,
	minutes: true,
	matchups: true,
};

// ---- diagnostics (calibration scripts) ----

export const CD_DIAG = {
	on: false,
	counts: {} as Record<string, number>,
};
const diag = (key: string, by: number = 1) => {
	if (CD_DIAG.on) {
		CD_DIAG.counts[key] = (CD_DIAG.counts[key] ?? 0) + by;
	}
};

// ---- the game day ----

export const decisionPlayer = (
	p2: any,
	p: Player | undefined,
	tid: number,
	season: number,
	fitOf: ((p: Player) => number) | undefined,
): DecisionPlayer => {
	const c = p2.compositeRating ?? {};
	const form = p?.coachForm?.s === season ? p.coachForm : undefined;
	const promise =
		p?.rolePromise &&
		p.rolePromise.tid === tid &&
		p.rolePromise.exp >= season &&
		g.get("phase") <= PHASE.PLAYOFFS
			? p.rolePromise.role
			: undefined;
	return {
		id: p2.id,
		name: p2.name,
		pos: p2.pos,
		age: p2.age,
		value: p2.planValue ?? p2.valueNoPot,
		injured: !!p2.injured,
		rested: !!p2.rested,
		hgt: p2.pbpRatings?.hgt ?? 50,
		spd: p2.pbpRatings?.spd ?? 50,
		usage: c.usage ?? 0.5,
		three: c.shootingThreePointer ?? 0.5,
		post: c.shootingLowPost ?? 0.5,
		perimD: c.defensePerimeter ?? 0.5,
		interiorD: c.defenseInterior ?? 0.5,
		fit: p && fitOf ? fitOf(p) : undefined,
		rb: form?.rb,
		ego: p && traitsEnabled() ? getEgoScore(p) : undefined,
		promise,
		lastStarter: form?.st === 1,
	};
};

// Who lost the last playoff game between two teams (the playoffs only; undefined if they haven't played)
const lastPlayoffLoser = async (tidA: number, tidB: number) => {
	let best: { gid: number; lost: number } | undefined;
	for (const game of await idb.cache.games.getAll()) {
		if (
			game.playoffs &&
			game.season === g.get("season") &&
			((game.teams[0].tid === tidA && game.teams[1].tid === tidB) ||
				(game.teams[0].tid === tidB && game.teams[1].tid === tidA)) &&
			(!best || game.gid > best.gid)
		) {
			best = { gid: game.gid, lost: game.lost.tid };
		}
	}
	return best?.lost;
};

/**
 * Each team's head coach makes his calls for today's games (AI teams: everything; the user's team: the areas he delegated, his lineup
 * preset). Call after loadTeams and applyCoachSystems. Changes the loaded teams only (and the user's team record: preset used,
 * pushback). Does nothing with the setting off.
 */
export const applyCoachDecisions = async (
	schedule: readonly {
		homeTid: number;
		awayTid: number;
		day?: number;
		marquee?: unknown;
		rivalry?: unknown;
	}[],
	teams: Record<number, any>,
) => {
	if (!coachDecisionsOn() || schedule.length === 0) {
		return;
	}
	const season = g.get("season");
	const phase = g.get("phase");
	if (phase !== PHASE.REGULAR_SEASON && phase !== PHASE.PLAYOFFS) {
		return;
	}
	const playoffs = phase === PHASE.PLAYOFFS;
	const day = schedule[0]?.day ?? 0;
	const league = await getLeagueCoachSystems(schedule[0]?.day);
	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	const series = playoffs
		? await idb.cache.playoffSeries.get(season)
		: undefined;

	// 1. Each team's coach, who he answers to (the user's delegation and preset) and his rest nights
	type Side = {
		tid: number;
		oppTid: number;
		matchup: (typeof schedule)[number];
		t: any;
		row: NonNullable<ReturnType<typeof league.get>>;
		head: CoachWithoutKey;
		teamRecord: Team;
		mind: CoachMind;
		user: boolean;
		delegate: CoachDelegation;
		preset: LineupPreset | undefined;
		ps: Map<number, Player>;
	};
	const sides: Side[] = [];
	for (const matchup of schedule) {
		if (matchup.homeTid < 0 || matchup.awayTid < 0) {
			continue;
		}
		const pair = [matchup.homeTid, matchup.awayTid] as const;
		for (const [i, tid] of pair.entries()) {
			const t = teams[tid];
			const row = league.get(tid);
			if (!t || !row) {
				continue;
			}
			const head = await idb.cache.coaches.get(row.cid);
			const teamRecord = await idb.cache.teams.get(tid);
			if (!head || !teamRecord) {
				continue;
			}
			const mind = await mindOf(head, row.profile);
			const user = isUserRun(tid);
			const delegate = user ? delegationFor(teamRecord) : ALL_COACH;
			const preset = user ? teamRecord.lineupPreset : undefined;
			const ps = new Map<number, Player>();
			for (const p of await idb.cache.players.indexGetAll(
				"playersByTid",
				tid,
			)) {
				ps.set(p.pid, p);
			}
			// Rest nights for older stars (the minutes are his to plan)
			if (delegate.minutes || preset === "rest") {
				restNights(t, ps, {
					mind,
					season,
					day,
					tid,
					marquee: matchup.marquee !== undefined || !!matchup.rivalry,
					preset: preset === "rest",
				});
			}
			sides.push({
				tid,
				oppTid: pair[1 - i]!,
				matchup,
				t,
				row,
				head,
				teamRecord,
				mind,
				user,
				delegate,
				preset,
				ps,
			});
		}
	}

	// 2. How every team playing today looks (the truth; each coach reads his opponent with his own scouting noise)
	const reads = new Map<number, TeamRead>();
	for (const { tid, t } of sides) {
		reads.set(
			tid,
			readTeam(
				t.player.map((p2: any) =>
					decisionPlayer(p2, undefined, tid, season, undefined),
				),
				t.pace ?? 100,
				numPlayersOnCourt,
			),
		);
	}
	const leagueReads = leagueRead([...reads.values()]);

	// 3. The plans
	for (const side of sides) {
		const { tid, oppTid, matchup, t, row, head, teamRecord, mind, user } = side;
		const { delegate, preset, ps } = side;
		const fitOf =
			mind.style === "system"
				? (p: Player) => playerSystemFit(p, row.profile).fit
				: undefined;
		const dPlayers: DecisionPlayer[] = t.player.map((p2: any) =>
			decisionPlayer(p2, ps.get(p2.id), tid, season, fitOf),
		);

		// Playoffs: games played in the series, and whether his team lost the last one
		let seriesGames: number | undefined;
		let afterLoss: boolean | undefined;
		if (series) {
			const s = series.series[series.currentRound]?.find(
				(s) =>
					(s.home.tid === tid && s.away?.tid === oppTid) ||
					(s.away?.tid === tid && s.home.tid === oppTid),
			);
			if (s && s.away) {
				seriesGames = (s.home.won ?? 0) + (s.away.won ?? 0);
				if (seriesGames > 0) {
					afterLoss = (await lastPlayoffLoser(tid, oppTid)) === tid;
				}
			}
		}

		const oppTruth = reads.get(oppTid);
		const ctx: DecisionContext = {
			mind,
			numPlayersOnCourt,
			playoffs,
			rebuilding: teamRecord.strategy === "rebuilding",
			marquee: matchup.marquee !== undefined,
			rivalry: !!matchup.rivalry,
			opp: oppTruth
				? perceiveTeam(oppTruth, mind.prep, `${season}|${day}|${tid}`)
				: undefined,
			league: leagueReads,
			delegate,
			preset,
			seriesGames,
			afterLoss,
			afterLossRoll: unitHash(`loss|${season}|${day}|${tid}`),
		};
		const plan = planCoachDecisions(dPlayers, ctx);
		applyPlan(t, plan, delegate, mind, !!preset, user);

		if (user) {
			await userBookkeeping(teamRecord, dPlayers, plan, ctx, head);
		}

		diag("teamGames");
		if (plan.diag.styleStarter) {
			diag("styleStarter");
		}
		if (plan.diag.matchupChange) {
			diag("matchupChange");
		}
		if (plan.swap) {
			diag(`swap_${plan.swap.kind}`);
		}
		if (plan.stopper) {
			diag("stopper");
		}
		if (plan.diag.injuryBench) {
			diag("injuryBench");
		}
		if (plan.diag.lossChange) {
			diag("lossChange");
		}
		if (plan.diag.promiseHonored > 0) {
			diag("promiseStarts", plan.diag.promiseHonored);
		}
		if (plan.rotationShift !== 0) {
			diag("rotationShiftAbs", Math.abs(plan.rotationShift));
		}
		let keyChanged = 0;
		for (const x of plan.keyMult.values()) {
			keyChanged += x !== 1 ? 1 : 0;
		}
		diag("keyMultPlayers", keyChanged);
		// Places in the top 9 of the rotation order that differ from the value order (earned and lost roles, swaps, promises)
		if (CD_DIAG.on) {
			const healthy = dPlayers.filter((p) => !p.injured);
			const byValue = healthy.toSorted((a, b) => b.value - a.value);
			const byKey = healthy.toSorted(
				(a, b) =>
					b.value * (plan.keyMult.get(b.id) ?? 1) -
					a.value * (plan.keyMult.get(a.id) ?? 1),
			);
			let moved = 0;
			for (let i = 0; i < Math.min(9, byValue.length); i++) {
				moved += byValue[i] !== byKey[i] ? 1 : 0;
			}
			diag("orderMoves", moved);
			if (moved > 0) {
				diag("orderChangedGames");
			}
		}
	}
};

const restNights = (
	t: any,
	ps: Map<number, Player>,
	{
		mind,
		season,
		day,
		tid,
		marquee,
		preset,
	}: {
		mind: CoachMind;
		season: number;
		day: number;
		tid: number;
		marquee: boolean;
		preset: boolean;
	},
) => {
	if (g.get("phase") !== PHASE.REGULAR_SEASON || t.backToBack) {
		return;
	}
	const healthy = t.player.filter((p2: any) => !p2.injured);
	if (healthy.length < 10) {
		return;
	}
	const ranked = healthy.toSorted(
		(a: any, b: any) =>
			(b.planValue ?? b.valueNoPot) - (a.planValue ?? a.valueNoPot),
	);
	for (const [rank, p2] of ranked.entries()) {
		if (rank >= 5) {
			break;
		}
		const p = ps.get(p2.id);
		if (!p) {
			continue;
		}
		const age = season - p.born.year;
		let rest: boolean;
		if (preset) {
			// The user's rest night: the oldest of his 3 best players sits, if he's 28 or older
			const oldest = ranked
				.slice(0, 3)
				.reduce((a: any, b: any) => (b.age > a.age ? b : a));
			rest = p2 === oldest && age >= 28;
		} else {
			const chance = marquee
				? 0
				: restNightChance({ age, rank, rest: mind.rest, pm: mind.pm });
			rest =
				chance > 0 &&
				unitHash(`rest|${season}|${day}|${tid}|${p2.id}`) < chance;
		}
		if (rest) {
			p2.injured = true;
			p2.rested = true;
			p2.coachRest = true;
			diag("restNights");
			diag(`restNightsAge${Math.min(36, age)}`);
			return;
		}
	}
};

export const applyPlan = (
	t: any,
	plan: DecisionPlan,
	delegate: CoachDelegation,
	mind: CoachMind,
	preset: boolean,
	user: boolean,
) => {
	if (delegate.starters || preset) {
		// The sim starts the first ones in the order
		const starters = plan.starters
			.map((id) => t.player.find((p2: any) => p2.id === id))
			.filter((p2: any) => p2 !== undefined);
		const set = new Set(starters);
		t.player = [...starters, ...t.player.filter((p2: any) => !set.has(p2))];
	}
	for (const p2 of t.player) {
		if (delegate.rotation) {
			const k = plan.keyMult.get(p2.id);
			if (k !== undefined && k !== 1) {
				p2.coachKeyMult = k;
			}
			const floor = plan.floors.get(p2.id);
			if (floor !== undefined) {
				p2.coachFloor = floor;
			}
		}
		const m = plan.minutesMult.get(p2.id);
		if (m !== undefined && m !== 1) {
			p2.coachMinutesMult = (p2.coachMinutesMult ?? 1) * m;
		}
	}
	if (plan.rotationShift !== 0) {
		t.rotationStyle = helpers.bound(
			(t.rotationStyle ?? 0) + plan.rotationShift,
			-1,
			1,
		);
	}
	if (user && delegate.rotation) {
		// The coach runs the rotation: the plan ranks like an AI team's. His starters (the user's when he picks them) keep a floor
		t.userRotation = false;
		if (!delegate.starters && !preset) {
			const starters = t.player
				.filter((p2: any) => !p2.injured && p2.ptModifier > 0)
				.slice(0, g.get("numPlayersOnCourt"));
			for (const p2 of starters) {
				p2.coachFloor = Math.max(p2.coachFloor ?? 0, 24);
			}
		}
	}
	t.coachDecisions = coachGameSettings(mind, plan, delegate);
	// No Visible Ratings: only the notes that don't come from hidden ratings (ages, form, heights, promises, rest)
	const notes = g.get("challengeNoRatings")
		? plan.notes.filter((note) => !plan.ratingNotes.has(note))
		: plan.notes;
	if (notes.length > 0) {
		t.coachNote = notes;
	}
};

// The user's team: the preset is used up, and pushback when he keeps overriding his coach
export const PUSHBACK = {
	minGames: 20,
	share: 0.5,
};

const userBookkeeping = async (
	teamRecord: Team,
	dPlayers: DecisionPlayer[],
	plan: DecisionPlan,
	ctx: Parameters<typeof planCoachDecisions>[1],
	head: CoachWithoutKey,
) => {
	let changed = false;
	if (teamRecord.lineupPreset) {
		delete teamRecord.lineupPreset;
		changed = true;
	}
	// What the coach would have done with everything his to decide
	const ideal = planCoachDecisions(dPlayers, {
		...ctx,
		delegate: ALL_COACH,
		preset: undefined,
	});
	const idealSet = new Set(ideal.starters);
	const differing = plan.starters.filter((id) => !idealSet.has(id)).length;
	const season = g.get("season");
	const pb =
		teamRecord.coachPushback?.season === season
			? { ...teamRecord.coachPushback }
			: { season, games: 0, overrides: 0 };
	pb.games += 1;
	if (differing >= 2) {
		pb.overrides += 1;
	}
	teamRecord.coachPushback = pb;
	changed = true;
	if (
		!pb.noted &&
		pb.games >= PUSHBACK.minGames &&
		pb.overrides / pb.games >= PUSHBACK.share
	) {
		pb.noted = true;
		await logEvent({
			type: "info",
			category: "staff",
			text: `Head coach <a href="${helpers.leagueUrl(["coach", head.cid!])}">${head.firstName} ${head.lastName}</a> is frustrated: his lineup has been overruled in ${pb.overrides} of ${pb.games} games. He would like more say (Roster page, "Let coach decide"), and will ask for more to extend his contract.`,
			showNotification: true,
			tids: [teamRecord.tid],
			score: 0,
		});
	}
	if (changed) {
		await idb.cache.teams.put(teamRecord);
	}
};

/** How frustrated the user's head coach is with being overruled this season (0 ... 1), for his job satisfaction. */
export const coachFrustration = (t: Pick<Team, "coachPushback">) => {
	const pb = t.coachPushback;
	if (!pb || pb.season !== g.get("season") || pb.games < 10) {
		return 0;
	}
	return helpers.bound((pb.overrides / pb.games - 0.25) / 0.5, 0, 1);
};

// ---- after a game ----

/**
 * After a game, a player's form (earned and lost roles) and his promised role. p is the sim's player (stats of the game), p2 the
 * player record (mutated), resp the coach's responsiveness (t.coachDecisions.resp).
 */
export const recordCoachDecisionGame = (
	p2: Player,
	p: any,
	tid: number,
	resp: number,
	playoffs: boolean,
) => {
	const season = g.get("season");
	const s = p.stat;
	if (!p.injured) {
		const { form, rbChanged } = updateForm(
			p2.coachForm,
			{
				season,
				min: s.min,
				gameScore: helpers.gameScore(s),
				pm: s.pm ?? 0,
				started: s.gs > 0,
			},
			resp,
		);
		p2.coachForm = form;
		if (rbChanged) {
			diag("roleChanges");
		}
	}
	const promise = p2.rolePromise;
	if (promise && promise.tid === tid && !playoffs && !p.injured) {
		if (promise.season !== season) {
			promise.season = season;
			promise.g = 0;
			promise.ok = 0;
		}
		promise.g += 1;
		if (promise.role === "starter" ? s.gs > 0 : s.min >= 15) {
			promise.ok += 1;
		}
	}
};
