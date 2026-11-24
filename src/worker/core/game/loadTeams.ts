import { addSimFatigue, getSimFrontOffice } from "../frontOffice/index.ts";
import { getConditioningInjuryFactor } from "../staffDepth/coaching.ts";
import { getTalentShift, shiftRatingsForSim } from "./talentCenter.ts";
import { allStar, player, season, team } from "../index.ts";
import { careerFromStats } from "../../../common/pbpFlavor/career.ts";
import { isHoldingOut } from "../contract/unrest.ts";
import { isSuspended } from "../player/techDiscipline.ts";
import { gameTimeDecisionPlays } from "../player/injuryRecovery.ts";
import { idb } from "../../db/index.ts";
import { isCollege } from "../college/isCollege.ts";
import { isRedshirting } from "../college/redshirt.ts";
import { g, helpers } from "../../util/index.ts";
import { userRunsTeam } from "../../util/userRunsTeam.ts";
import type { Player, Conditions, TeamSeason } from "../../../common/types.ts";
import {
	COMPOSITE_WEIGHTS,
	DEFAULT_PLAY_THROUGH_INJURIES,
	PHASE,
} from "../../../common/constants.ts";
import playThroughInjuriesFactor from "../../../common/playThroughInjuriesFactor.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { last, assertDefined } from "../../../common/utils.ts";
import { applyInjuryDepth } from "./injuryDepthTeam.ts";
import {
	getRestrictionFactor,
	getSimDay,
	isBackToBack,
	isInjuryDepthEnabled,
} from "../player/injuryDepth.ts";
import { scheduleDaysSpread } from "../season/scheduleDayScale.ts";
import { isThreeInFour, LOAD } from "../GameSim.basketball/scheduleLoad.ts";
import {
	compositeWeightsFor,
	deriveExpandedRatings,
	expandedRatingsSeed,
	hasExpandedRatings,
} from "../../../common/expandedRatings.ts";
import { expandedRatingsOn } from "../player/expandedRatings.ts";
import {
	CREATION_WEIGHTS,
	CREATION_WEIGHTS_EXPANDED,
	spacingThreat,
} from "../GameSim.basketball/spacingCreation.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import { aiDefScheme, aiShotProfile } from "../../../common/shotProfiles.ts";
import { getShootingHand } from "../../../common/shootingHand.ts";
import {
	aiShotPlans,
	seasonDriftMults,
} from "../GameSim.basketball/shotShare.ts";
import {
	simFixCompositeWeights,
	simFixInjuryFactor,
} from "../GameSim.basketball/simSettings.ts";
import {
	atRimWeights,
	jumperGaps,
	subSimComposite,
	subSimLat,
	subSimPlayer,
	subSimTouches,
} from "../GameSim.basketball/subRatingsSim.ts";
import { subRatingsOn } from "../player/subRatings.ts";
import {
	ensureTieredBadges,
	shownTiersForSeason,
	simTiers,
	tieredBadgeSimOn,
} from "../player/tieredBadges.ts";
import { isValidSubArray, SUB_INDEX } from "../../../common/subRatings.ts";
import { careerAgingOn, oldAgeMinutesCap } from "../player/careerAging.ts";
import {
	PBP_BADGE_KEYS,
	PBP_EXPANDED_KEYS,
	PBP_TRAIT_KEYS,
} from "../../../common/pbpFlavor/story.ts";

const MAX_NUM_PLAYERS_PACE = 7;

export const SKIP_PLAYER_STATS = new Set(["minAvailable"]);

// Is this a game 6/7 (generalized to other playoff series lengths than 7)
export const isGame6EliminationGameOrGame7 = async (
	playoffs: boolean,
	tid: number,
) => {
	if (!playoffs) {
		return false;
	}

	const playoffSeries = await idb.cache.playoffSeries.get(g.get("season"));
	if (playoffSeries) {
		if (playoffSeries.currentRound === -1) {
			return true;
		}

		const roundSeries = playoffSeries.series[playoffSeries.currentRound];
		const numGames = g.get("numGamesPlayoffSeries", "current")[
			playoffSeries.currentRound
		];
		if (roundSeries !== undefined && numGames !== undefined) {
			for (const series of roundSeries) {
				if (
					series.away?.tid !== undefined &&
					(tid === series.home.tid || tid === series.away.tid)
				) {
					const numGamesSeries = series.away.won + series.home.won;

					// Game 7?
					if (numGamesSeries === numGames - 1) {
						return true;
					}

					// Elimination game 6?
					if (numGamesSeries === numGames - 2) {
						const eliminationGame =
							series.home.tid === tid
								? series.home.won < series.away.won
								: series.away.won < series.home.won;
						return eliminationGame;
					}
				}
			}
		}
	}

	return false;
};

// Decrease rating by up to 40%
export const getNumConsecutiveGamesGFactor = (
	numConsecutiveGamesG: number,
	playoffs: boolean,
	game6EliminationGameOrGame7: boolean | undefined,
) => {
	const playoffsFactor = playoffs ? (game6EliminationGameOrGame7 ? 4 : 2) : 1;
	return helpers.bound(
		1 - (numConsecutiveGamesG / playoffsFactor) * 0.045,
		0.6,
		1,
	);
};

let playerStats: Record<string, number | number[]>;
let teamStats: Record<string, number | number[]>;

export const getActualPlayThroughInjuries = (
	t: { tid: number; playThroughInjuries: [number, number] } | "default",
) => {
	if (t === "default") {
		return DEFAULT_PLAY_THROUGH_INJURIES;
	}

	// The AI's setting when it runs the team (spectator mode, auto play)
	if (userRunsTeam(t.tid)) {
		return t.playThroughInjuries;
	}

	return DEFAULT_PLAY_THROUGH_INJURIES;
};

const SEASON_STATS_KEYS = bySport({
	baseball: [
		"pa",
		"bb",
		"hbp",
		"sf",
		"h",
		"2b",
		"3b",
		"hr",
		"er",
		"outs",
		"w",
		"l",
		"sv",
		"bs",
		"hld",
		"sb",
	],
	basketball: undefined,
	football: [
		"pssTD",
		"rusTD",
		"recTD",
		"defSk",
		"fmb",
		"defInt",
		"pssInt",
		"krTD",
		"prTD",
		"defFmbFrc",
	],
	hockey: ["shG", "evG", "ppG", "shA", "evA", "ppA"],
} as const);

export const processTeam = async (
	teamInput: {
		tid: number;
		playThroughInjuries: [number, number];
		depth?: unknown;
		loadManagement?: boolean;
	},
	teamSeason: {
		lastGameDay?: number;
		prevGameDay?: number;
		lastGameSite?: string;
		hype?: number;
		won: number;
		lost: number;
		tied: number;
		otl: number;
		cid: number;
		did: number;
		// Injury Depth's late-season rest
		clinchedPlayoffs?: TeamSeason["clinchedPlayoffs"];
	},
	players: Player[],
	// Whether this team's game has a play-by-play someone will read (stored with the box score or watched live, game/play.ts). When
	// false, what only the text reads (former teams, career context) is skipped. The sim never reads it
	pbpText: boolean = true,
) => {
	if (!playerStats) {
		playerStats = Object.fromEntries([
			...player.stats.raw
				.filter((key) => !SKIP_PLAYER_STATS.has(key) && !key.startsWith("opp"))
				.map((key) => [key, 0]),

			// Starters will play at least 3 minutes before being subbed out, after that the default here doesn't matter
			["courtTime", -3],
			["benchTime", 0],
			["energy", 1],

			// Placeholders, replaced with a new array for each player below. Including them here avoids adding new properties to the object, which is slow
			...(player.stats.byPos ?? []).map((key) => [key, []]),
		]);
	}

	if (!teamStats) {
		// Same idea as playerStats above
		teamStats = Object.fromEntries([
			...team.stats.raw
				.filter((key) => !key.startsWith("opp"))
				.map((key) => [key, 0]),

			// ba is still recorded as a player stat for some reason, but not a team stat, so we need to add it here so it gets tracked for the box score correctly
			...(__SPORT === "basketball" ? [["ba", 0]] : []),
			// Same for technical and flagrant fouls: box score totals only (writeTeamStats.ts skips them)
			...(__SPORT === "basketball"
				? [
						["tf", 0],
						["ff", 0],
					]
				: []),

			["pts", 0],
			["ptsQtrs", []],
			...(team.stats.byPos ?? [])
				.filter((key) => !key.startsWith("opp"))
				.map((key) => [key, []]),
		]);
	}

	const allStarGame = teamInput.tid === -1 || teamInput.tid === -2;

	if (!allStarGame) {
		players.sort((a, b) => a.rosterOrder - b.rosterOrder);
	}

	// Initialize team composite rating object
	const compositeRating: any = {};

	if (__SPORT === "basketball") {
		for (const rating of Object.keys(COMPOSITE_WEIGHTS)) {
			compositeRating[rating] = 0;
		}
	}

	const playoffs = g.get("phase") === PHASE.PLAYOFFS;

	const actualPlayThroughInjuries = getActualPlayThroughInjuries(teamInput);

	// Injury-adjusted ovr
	const playersCurrent = players.map((p) => {
		const ratings = last(p.ratings);
		return {
			pid: p.pid,
			injury: p.injury,
			value: p.value,
			ratings: {
				ovr: player.fuzzRating(ratings.ovr, ratings.fuzz),
				ovrs: player.fuzzOvrs(ratings.ovrs, ratings.fuzz),
				pos: ratings.pos,
			},
		};
	});
	const ovr = team.ovr(playersCurrent, {
		accountForInjuredPlayers: {
			numDaysInFuture: 0,
			playThroughInjuries: actualPlayThroughInjuries,
		},
		playoffs,
	});

	const t: any = {
		id: teamInput.tid,
		pace: 0,
		won: teamSeason.won,
		lost: teamSeason.lost,
		tied: season.hasTies("current") ? teamSeason.tied : undefined,
		otl: g.get("otl", "current") ? teamSeason.otl : undefined,
		cid: teamSeason.cid,
		did: teamSeason.did,
		ovr,
		stat: {},
		player: [],
		synergy: {
			off: 0,
			def: 0,
			reb: 0,
		},
		compositeRating,
		depth: teamInput.depth,
	};

	const playThroughInjuries = actualPlayThroughInjuries[playoffs ? 1 : 0];

	let game6EliminationGameOrGame7: boolean | undefined;
	// Expanded ratings (basketball): the defense, rebounding and finishing composites read wingspan and perimeter/interior defense
	const expandedRatings = __SPORT === "basketball" && expandedRatingsOn();
	// Game Sim Fixes (basketball): usage, make-probability and (expanded) fouling composites, see GameSim.basketball/simSettings.ts
	const simFixes =
		__SPORT === "basketball" &&
		nativeFeatureEnabled("simFixes", (key) => g.get(key as any));
	const positionalComposites =
		__SPORT === "basketball" &&
		nativeFeatureEnabled("positionalComposites", (key) => g.get(key as any));
	// Spacing & Shot Creation (basketball): creation and spacing composites, see GameSim.basketball/spacingCreation.ts
	const spacingCreation =
		__SPORT === "basketball" &&
		nativeFeatureEnabled("spacingCreation", (key) => g.get(key as any));
	// Matchup Defense (basketball): height and speed for size and speed mismatches, see GameSim.basketball/matchupDefense.ts
	const matchupDefense =
		__SPORT === "basketball" &&
		nativeFeatureEnabled("matchupDefense", (key) => g.get(key as any));
	const compositeWeightsObj =
		__SPORT === "basketball"
			? simFixes
				? simFixCompositeWeights(
						compositeWeightsFor(COMPOSITE_WEIGHTS, expandedRatings),
						expandedRatings,
					)
				: compositeWeightsFor(COMPOSITE_WEIGHTS, expandedRatings)
			: COMPOSITE_WEIGHTS;
	const compositeWeights = Object.entries(compositeWeightsObj);
	// Game Sim Fixes (basketball): the league's talent center this season (undefined when off or without a record)
	const talentShift = simFixes ? getTalentShift() : undefined;
	// Sub-Ratings in Sim (basketball, needs Sub-Ratings): the subs folded into the composites, see GameSim.basketball/subRatingsSim.ts
	const subSim =
		__SPORT === "basketball" &&
		subRatingsOn() &&
		nativeFeatureEnabled("subRatingsSim", (key) => g.get(key as any));

	let seasonStatsByPid;
	if (SEASON_STATS_KEYS !== undefined) {
		// Only look at regular season stats for All-Star Game, in case All-Star Game is in playoffs
		const regularSeason = allStarGame || g.get("phase") < PHASE.PLAYOFFS;
		const rows = await player.formatAll(players, {
			attrs: ["pid"],
			stats: SEASON_STATS_KEYS,
			season: g.get("season"),
			seasonType: regularSeason ? "regularSeason" : "playoffs",
			mergeStats: "totOnly",
		});
		seasonStatsByPid = new Map(rows.map((p) => [p.pid, p.stats]));
	}

	// 2K Badges (basketball): each player's tiers this season, for the sim's badge effects (GameSim.basketball/tieredBadgesSim.ts)
	const badgeSim = tieredBadgeSimOn();
	if (badgeSim) {
		await ensureTieredBadges();
	}

	for (const p of players) {
		const injuryFactor = playThroughInjuriesFactor(p.injury.gamesRemaining);

		// p.jerseyNumber fallback is for exhibition game players for the current season with no stats
		const proStats = getProStats(p);
		const jerseyNumber =
			proStats.length > 0 ? proStats.at(-1)!.jerseyNumber : p.jerseyNumber;

		let rating = last(p.ratings);
		if (expandedRatings && !hasExpandedRatings(rating)) {
			// Not filled in yet (turned on in an old league, imported player): derive, deterministically, without saving
			// (rows filled before the second step keep their wng/pdef/idef)
			rating = {
				...deriveExpandedRatings(rating, expandedRatingsSeed(p)),
				...rating,
			};
		}
		const playerCompositeRatings: any = {};
		const p2 = {
			id: p.pid,
			pid: p.pid, // for getDepthPlayers, eventually do it all this way
			name: `${p.firstName} ${p.lastName}`,
			age: g.get("season") - p.born.year,
			pos: rating.pos,
			valueNoPot: p.valueNoPot * injuryFactor,
			stat: {} as any,
			compositeRating: playerCompositeRatings,
			skills: rating.skills,
			injury: {
				...p.injury,
				playingThrough:
					p.injury.gamesRemaining > 0 &&
					p.injury.gamesRemaining <= playThroughInjuries,
			},
			// Holding out counts as injured, so he doesn't play
			injured:
				p.injury.gamesRemaining > playThroughInjuries ||
				isHoldingOut(p) ||
				isSuspended(p),
			jerseyNumber,
			ptModifier: p.ptModifier,
			ovrs: rating.ovrs,
		};

		// Injury outlook: a questionable or doubtful player's game-time decision. When he plays, it's like playing through an injury
		// (valueNoPot and the composites already have its playing-through factor)
		if (
			p2.injured &&
			!allStarGame &&
			isInjuryDepthEnabled() &&
			!isHoldingOut(p) &&
			!isSuspended(p)
		) {
			const gtd = gameTimeDecisionPlays(
				p,
				teamSeason.won + teamSeason.lost + teamSeason.tied + teamSeason.otl,
				g.get("season"),
				playoffs,
			);
			if (gtd) {
				p2.injured = false;
				p2.injury.playingThrough = true;
				p2.injury.gtd = gtd;
			}
		}

		if (__SPORT === "basketball") {
			// His true ovr, not the fuzzed one (Game Sim Fixes: the team strength gap, SIM_FIX_STRENGTH_GAP). Removed from the sim's result
			(p2 as any).ovr = rating.ovr;
			// Raw ratings, only used to word the basketball play-by-play (which kind of finish or pass is plausible for him). The sim itself never reads them.
			const r = rating as Record<string, any>;
			(p2 as any).pbpRatings = {
				hgt: r["hgt"],
				stre: r["stre"],
				spd: r["spd"],
				jmp: r["jmp"],
				ins: r["ins"],
				dnk: r["dnk"],
				ft: r["ft"],
				fg: r["fg"],
				tp: r["tp"],
				oiq: r["oiq"],
				diq: r["diq"],
				drb: r["drb"],
				pss: r["pss"],
				reb: r["reb"],
			};
			// His shooting hand, for the calls that name it ("a lefty slam")
			(p2 as any).pbpRatings.lft = getShootingHand(p) === "left" ? 1 : 0;
			// Shot Zones: the floater/touch sub-rating, when he has sub-ratings (the sub-zone of his short shots)
			if (isValidSubArray(r["sub"])) {
				(p2 as any).pbpRatings.flt = r["sub"][SUB_INDEX["flt"]!];
			}
			// Expanded ratings, when the setting is on (catch-and-shoot or pull-up jumpers, ball security, the offensive glass, length,
			// perimeter and interior defense), for the same wording only (pbpFlavor/story.ts)
			if (expandedRatings) {
				for (const key of PBP_EXPANDED_KEYS) {
					if (typeof r[key] === "number") {
						(p2 as any).pbpRatings[key] = r[key];
					}
				}
			}
			// The other teams he has played for (regular season), for "facing his former team" (worker/util/pbpGameContext.ts)
			if (!allStarGame && pbpText) {
				const tids = new Set<number>();
				for (const row of p.stats ?? []) {
					if (
						row &&
						!row.playoffs &&
						typeof row.tid === "number" &&
						row.tid >= 0 &&
						row.tid !== t.id &&
						(row.gp ?? 0) > 0
					) {
						tids.add(row.tid);
					}
				}
				if (tids.size > 0) {
					(p2 as any).pbpTids = [...tids];
				}
			}
			// 2K badges as the user sees them (scouted, never the sim's own tiers when those differ), for the wording only (pbpFlavor/story.ts)
			if (pbpText && !allStarGame) {
				const shown = shownTiersForSeason(p, g.get("season"));
				if (shown) {
					for (const [badge, key] of Object.entries(PBP_BADGE_KEYS)) {
						const tier = (shown as Record<string, number | undefined>)[badge];
						if (tier) {
							(p2 as any).pbpRatings[key] = tier;
						}
					}
				}
			}
			if (badgeSim) {
				const bt = simTiers(p);
				if (bt) {
					(p2 as any).bt = bt;
				}
			}
		}

		// What he had done before this game (games, career and season highs, career totals), only used to word the basketball play-by-play
		// ("that's a new career high"): see common/pbpFlavor/career.ts. The sim itself never reads it. Not for the All-Star Game, whose stats
		// don't count
		if (__SPORT === "basketball" && !allStarGame && pbpText) {
			(p2 as any).pbpCareer = careerFromStats(p.stats, {
				season: g.get("season"),
				draftYear: p.draft?.year,
				age: p2.age,
			});
			// League discipline (technicalFouls setting): his technicals this regular season, for "his 9th technical of the season"
			if (g.get("technicalFouls") && g.get("phase") === PHASE.REGULAR_SEASON) {
				(p2 as any).pbpRatings.stf =
					p.discipline?.season === g.get("season") ? p.discipline.tf : 0;
			}
		}

		// Player traits (the playerTraits setting): his effects on the game, computed once per game. Undefined with the setting off, and then the
		// sim uses its old formulas and draws no extra random numbers
		if (__SPORT === "basketball") {
			// (perf3: once a week of games, and when he changes teams)
			const day = getSimDay();
			const simWeek =
				day === undefined
					? undefined
					: `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${Math.floor(day / 7)}`;
			const traitEffects = player.getSimTraitEffectsWeekly(p, simWeek);
			if (traitEffects) {
				(p2 as any).traitEffects = traitEffects;
				// Temper, for the trash talk in the play-by-play text only (pbpFlavor/trashTalk.ts)
				(p2 as any).pbpRatings.temper = traitEffects.scores.temper;
				// and a few more for the wording of the play-by-play (pbpFlavor/story.ts)
				for (const key of PBP_TRAIT_KEYS) {
					const v = (traitEffects.scores as Record<string, number>)[key];
					if (typeof v === "number") {
						(p2 as any).pbpRatings[key] = v;
					}
				}
				// Defensive versatility (size mismatches)
				(p2 as any).traitHgt = (rating as any).hgt;
			}
		}

		// Reset ptModifier for AI teams (and the user's while the AI runs it: spectator mode, auto play). For AI teams this should not be necessary since it should always be 1, but let's be safe.
		if (!userRunsTeam(t.id)) {
			p2.ptModifier = 1;
		}
		const seasonStats: Record<string, number> = {};

		// Game Sim Fixes: the composites read his ratings shifted by the league's talent center (talentCenter.ts), so the league as a whole
		// plays at its first season's level. The same row without one
		const simRating = shiftRatingsForSim(rating, talentShift);

		// Sub-Ratings in Sim: undefined with the setting off (or a row without subs), and then every composite is the stock one
		const sp = subSim ? subSimPlayer(simRating) : undefined;

		// These use the same formulas as the skill definitions in player.skills!
		for (const [k, weightInfo] of compositeWeights) {
			p2.compositeRating[k] =
				(sp && subSimTouches(k)
					? subSimComposite(sp, k, weightInfo.ratings, weightInfo.weights)
					: player.compositeRating(
							simRating,
							weightInfo.ratings,
							weightInfo.weights,
							false,
						)) * injuryFactor;

			if (__SPORT === "hockey" && k === "goalkeeping") {
				const numConsecutiveGamesG = p.numConsecutiveGamesG ?? 0;

				if (p.numConsecutiveGamesG !== undefined) {
					(p2 as any).numConsecutiveGamesG = p.numConsecutiveGamesG;
				}

				if (numConsecutiveGamesG > 0) {
					if (playoffs && game6EliminationGameOrGame7 === undefined) {
						game6EliminationGameOrGame7 = await isGame6EliminationGameOrGame7(
							playoffs,
							teamInput.tid,
						);
					}

					p2.compositeRating[k] *= await getNumConsecutiveGamesGFactor(
						numConsecutiveGamesG,
						playoffs,
						game6EliminationGameOrGame7,
					);
				}
			}
		}

		if (__SPORT === "basketball") {
			p2.compositeRating.usage = p2.compositeRating.usage ** 1.9;
			if (sp) {
				// Sub-Ratings in Sim: the make of a drive, putbacks, and the jumper style gaps by shot type
				const cr = p2.compositeRating;
				const atRim = atRimWeights(compositeWeightsObj);
				cr.shootingAtRimMake =
					subSimComposite(
						sp,
						"shootingAtRimMake",
						atRim.ratings,
						atRim.weights,
					) * injuryFactor;
				cr.shootingPutBack =
					subSimComposite(sp, "shootingPutBack", atRim.ratings, atRim.weights) *
					injuryFactor;
				const gaps = jumperGaps(
					sp,
					cr.catchShoot !== undefined ? cr.catchShoot - cr.offDribble : 0,
				);
				cr.jumperGap3 = gaps.three;
				cr.jumperGapMid = gaps.mid;
			}
			if (positionalComposites) {
				// Position-aware team composites: who plays big (GameSim.basketball/positionalComposites.ts)
				(p2 as any).simHgt = (rating as any).hgt;
			}
			if (spacingCreation) {
				const w = expandedRatings
					? CREATION_WEIGHTS_EXPANDED
					: CREATION_WEIGHTS;
				p2.compositeRating.creation =
					(sp
						? subSimComposite(sp, "creation", w.ratings, w.weights)
						: player.compositeRating(simRating, w.ratings, w.weights, false)) *
					injuryFactor;
				p2.compositeRating.spacingThreat = spacingThreat(
					p2.compositeRating,
					g.get("threePointers"),
				);
			}
			if (matchupDefense) {
				(p2 as any).simHgt = (rating as any).hgt;
				(p2 as any).simSpd = (rating as any).spd;
				if (sp) {
					// Sub-Ratings in Sim: a defender's side of a drive mismatch is his lateral quickness
					(p2 as any).simLat = subSimLat(sp);
				}
			}
			if (simFixes) {
				// Game Sim Fixes: strong, durable players get hurt a little less
				(p2 as any).simInjuryFactor = simFixInjuryFactor(
					(rating as any).stre,
					(rating as any).endu,
				);
				// ...and lefties get a small edge at the rim (computed once per player here, not per shot)
				(p2 as any).lefty = getShootingHand(p) === "left";
				// ...and his shot zone tendencies, learned from his makes (player/zoneTendencies.ts)
				if ((rating as any).zt) {
					(p2 as any).zt = (rating as any).zt;
				}
			}
		}
		if (SEASON_STATS_KEYS !== undefined) {
			const pSeasonStats = seasonStatsByPid!.get(p.pid);
			for (const key of SEASON_STATS_KEYS) {
				seasonStats[key] = pSeasonStats?.[key] ?? 0;
			}
			(p2 as any).seasonStats = seasonStats;
		}
		if (__SPORT === "baseball") {
			(p2 as any).pFatigue = p.pFatigue ?? 0;
		}

		// playerStats is created with Object.fromEntries and contains all properties, so that this spread is fast and produces an object with fast properties. Otherwise, with a lot of stats (like in ZGMB), it's slow to create and the object is slow to use in GameSim
		p2.stat = { ...playerStats };

		if (player.stats.byPos) {
			for (const key of player.stats.byPos) {
				p2.stat[key] = [];
			}
		}

		t.player.push(p2);
	}

	if (__SPORT === "basketball") {
		// Front Office Budget: Medical's injury rate, and Travel & Sports Science's share of the fatigue penalties (travel, 3 in 4 nights,
		// back-to-backs) or, with neither Load, Fatigue & Venue nor Injury Depth on, a small endurance effect. Undefined when off
		const frontOffice = allStarGame ? undefined : await getSimFrontOffice(t.id);
		if (frontOffice) {
			const fatigueFeatures =
				isInjuryDepthEnabled() ||
				nativeFeatureEnabled("scheduleLoad", (key) => g.get(key as any));
			if (fatigueFeatures) {
				t.foTravelScale = frontOffice.travelScale;
			}
			for (const p2 of t.player) {
				p2.medicalInjuryFactor = frontOffice.injuryRateFactor;
				if (!fatigueFeatures && p2.compositeRating.endurance !== undefined) {
					p2.compositeRating.endurance *= frontOffice.enduranceFallback;
				}
			}
		}

		// Coaching Staff Depth: strength & conditioning's in-game injury rate (1 when off, so nothing changes)
		if (!allStarGame) {
			const sc = await getConditioningInjuryFactor(t.id);
			if (sc !== 1) {
				for (const p2 of t.player) {
					p2.medicalInjuryFactor = (p2.medicalInjuryFactor ?? 1) * sc;
				}
			}
		}

		applyInjuryDepth(t, teamInput, teamSeason, players);

		// Shot Share Model (GameSim.basketball/shotShare.ts): each player's game plan (the user's own, or the AI coach's by role) and the
		// season drift correction from his stats with this team this season
		if (
			!allStarGame &&
			nativeFeatureEnabled("shotShareModel", (key) => g.get(key as any))
		) {
			const userTeam = userRunsTeam(t.id);
			const playersByPid = new Map(players.map((p) => [p.pid, p]));
			const season = g.get("season");
			const rows = t.player.map((p2: any) => {
				const row = playersByPid
					.get(p2.id)
					?.stats?.findLast(
						(r: any) => r.season === season && !r.playoffs && r.tid === t.id,
					);
				return {
					id: p2.id,
					valueNoPot: p2.valueNoPot,
					usage: p2.compositeRating.usage,
					injured: p2.injured,
					fga: row?.fga ?? 0,
					min: row?.min ?? 0,
				};
			});
			const aiPlans = userTeam ? undefined : aiShotPlans(rows);
			const drift = seasonDriftMults(rows);
			for (const p2 of t.player) {
				const plan = userTeam
					? (playersByPid.get(p2.id)?.shotPlan ?? 0)
					: (aiPlans!.get(p2.id) ?? 0);
				// (set on every player, so the sim's player objects keep one shape)
				p2.shotPlan = plan;
				p2.shotDrift = drift.get(p2.id) ?? 1;
			}
		}

		// Shot Profiles & Defensive Schemes (common/shotProfiles.ts): each player's shot profile (the user's own, else the coach's from his
		// ratings) and the team's defensive scheme (the user's own, else the coach's from the roster)
		if (
			!allStarGame &&
			nativeFeatureEnabled("shotProfiles", (key) => g.get(key as any))
		) {
			const userTeam = userRunsTeam(t.id);
			const playersByPid = new Map(players.map((p) => [p.pid, p]));
			for (const p2 of t.player) {
				const c = p2.compositeRating;
				p2.shotProfile =
					(userTeam ? playersByPid.get(p2.id)?.shotProfile : undefined) ??
					aiShotProfile({
						three: c.shootingThreePointer,
						mid: c.shootingMidRange,
						rim: c.shootingAtRim,
						post: c.shootingLowPost,
					});
			}
			const userScheme = userTeam
				? (await idb.cache.teams.get(t.id))?.defScheme
				: undefined;
			t.defScheme =
				userScheme ??
				aiDefScheme(
					t.player
						.filter((p2: any) => !p2.injured)
						.toSorted((a: any, b: any) => b.valueNoPot - a.valueNoPot)
						.map((p2: any) => playersByPid.get(p2.id)?.ratings.at(-1))
						.filter((r: any) => r !== undefined),
				);
		}

		// Load, Fatigue & Venue (basketball): the crowd (hype), where the team is from (travel) and 3 games in 4 nights, see
		// GameSim.basketball/scheduleLoad.ts
		const scheduleLoad =
			!allStarGame &&
			nativeFeatureEnabled("scheduleLoad", (key) => g.get(key as any));
		let threeInFour = false;
		if (scheduleLoad) {
			t.crowdHype = teamSeason.hype ?? 0.5;
			t.region = (teamInput as { region?: string }).region;
			// (travel from the previous game's city, and the days since it)
			t.lastSite = teamSeason.lastGameSite;
			const simDay = getSimDay();
			t.restDays =
				teamSeason.lastGameDay === undefined || simDay === undefined
					? undefined
					: simDay - teamSeason.lastGameDay;
			// (only with the realistic schedule length: in the old compact schedule, and in college mode, teams play nearly every day, so
			// almost every game would be one)
			const realisticDays = scheduleDaysSpread();
			threeInFour =
				realisticDays &&
				!playoffs &&
				isThreeInFour(
					getSimDay(),
					teamSeason.lastGameDay,
					teamSeason.prevGameDay,
				);
			t.threeInFour = threeInFour;
			const injuryNorm = realisticDays
				? LOAD.injuryNorm *
					(isInjuryDepthEnabled() ? LOAD.injuryDepthRealisticSchedule : 1)
				: 1;
			for (const p2 of t.player) {
				p2.loadInjuryFactor =
					injuryNorm * (threeInFour ? LOAD.threeInFourInjury : 1);
				if (threeInFour && p2.compositeRating.endurance !== undefined) {
					p2.compositeRating.endurance *=
						t.foTravelScale === undefined
							? LOAD.threeInFourEndurance
							: 1 - (1 - LOAD.threeInFourEndurance) * t.foTravelScale;
				}
			}
			if (threeInFour && t.foTravelScale !== undefined) {
				addSimFatigue(t, LOAD.threeInFourEndurance, t.foTravelScale);
			}
		}

		// Realistic Rotations: the second night of a back-to-back plays a little more of the bench (GameSim.basketball/rotationPlanner.ts).
		// A later batch can also set t.rotationStyle (the coach's rotation style, -1 tight ... 1 deep)
		if (
			!allStarGame &&
			nativeFeatureEnabled("realisticRotations", (key) => g.get(key as any))
		) {
			// (Load, Fatigue & Venue: so is the third game in four nights)
			t.backToBack = isBackToBack(teamSeason.lastGameDay) || threeInFour;
			// The user's own team: the plan follows his roster order (his starters get a minutes floor) and playing time buttons. Not with
			// the AI running it (spectator, auto play)
			if (userRunsTeam(t.id)) {
				t.userRotation = true;
			}
			// No Visible Ratings challenge: the user's own minutes plan ranks his players by the fuzzed value he sees (the one auto sort
			// uses), so the box score's minutes order doesn't give away the true value order. Only the plan's order: the substitutions
			// themselves still use the true value
			if (g.get("challengeNoRatings") && userRunsTeam(t.id)) {
				const playersByPid = new Map(players.map((p) => [p.pid, p]));
				for (const p2 of t.player) {
					const p = playersByPid.get(p2.id);
					if (p && Number.isFinite(p.valueNoPotFuzz) && p.valueNoPot > 0) {
						// (with the same playing-through-injury factor as valueNoPot)
						p2.planValue = (p.valueNoPotFuzz * p2.valueNoPot) / p.valueNoPot;
					}
				}
			}
			// Injury Depth minutes restrictions (already in ptModifier; the planner applies them once to the plan, see rotationPlanner.ts)
			if (isInjuryDepthEnabled()) {
				const playersByPid = new Map(players.map((p) => [p.pid, p]));
				for (const p2 of t.player) {
					const restriction = getRestrictionFactor(
						playersByPid.get(p2.id)?.health,
					);
					if (restriction > 0 && restriction < 1) {
						p2.injuryRestriction = restriction;
					}
				}
			}
		}

		// Career Aging: AI coaches cap the minutes of their 39+ year olds (by his rank on the team), through the Realistic Rotations plan when
		// it's on, otherwise by playing him a little less in the substitution order. Never on a team the user runs (his own, unless spectator mode or auto play)
		if (!allStarGame && careerAgingOn() && !userRunsTeam(t.id)) {
			const ranked = t.player
				.filter((p2: any) => !p2.injured)
				.toSorted((a: any, b: any) => b.valueNoPot - a.valueNoPot);
			for (const [rank, p2] of ranked.entries()) {
				const cap = oldAgeMinutesCap(p2.age, rank);
				if (cap === undefined) {
					continue;
				}
				if (
					nativeFeatureEnabled("realisticRotations", (key) => g.get(key as any))
				) {
					p2.minutesRestriction = Math.min(
						p2.minutesRestriction ?? 1,
						cap / 36,
					);
				} else {
					p2.ptModifier = Math.min(p2.ptModifier, 0.75);
				}
			}
		}

		t.pace = 0;

		let numPlayers = 0;
		for (const p of t.player) {
			if (p.injury.gamesRemaining === 0 || p.injury.playingThrough) {
				numPlayers += 1;
				t.pace += p.compositeRating.pace;

				if (numPlayers >= MAX_NUM_PLAYERS_PACE) {
					break;
				}
			}
		}

		if (numPlayers > 0) {
			t.pace /= numPlayers;
		}
		t.pace = t.pace * 15 + 100; // Scale between 100 and 115

		if (allStarGame) {
			t.pace *= 1.15;
		}
	}

	t.stat = { ...teamStats };
	t.stat.ptsQtrs = __SPORT === "baseball" ? [] : [0];

	if (team.stats.byPos) {
		for (const key of team.stats.byPos) {
			if (!key.startsWith("opp")) {
				t.stat[key] = [];
			}
		}
	}

	return t;
};

/**
 * Load the teams specified by tids into an object of team objects.
 *
 * The team objects contain all the information needed to simulate games. It would be more efficient if it only loaded team data for teams that are actually playing, particularly in the playoffs.
 *
 * @memberOf core.game
 * @param {IDBTransaction} ot An IndexedDB transaction on players and teams.
 * @returns {Promise<Record<number, undefined | ReturnType<typeof processTeam>>>} Resolves to a record of team objects, ordered by tid.
 */
const loadTeams = async (
	tids: number[],
	conditions: Conditions,
	// Basketball: the teams whose game's play-by-play is stored or watched (see processTeam's pbpText). Undefined: all of them
	pbpTids?: ReadonlySet<number>,
) => {
	const teams: Record<
		number,
		undefined | Awaited<ReturnType<typeof processTeam>>
	> = {};
	if (tids.length === 2 && tids.includes(-1) && tids.includes(-2)) {
		// All-Star Game
		assertDefined(await allStar.getOrCreate(g.get("season")));
		// Finish the draft and name injury replacements (play.ts already did this, and skips the game if it can't be played)
		await allStar.prepareGame(conditions);
		await allStar.simContests(conditions);
		const allStars = await idb.cache.allStars.get(g.get("season"));
		assertDefined(allStars);

		for (const tid of tids) {
			const allStarsTeamInd = tid === -1 ? 0 : 1;
			const players = [];
			for (const { pid } of allStars.teams[allStarsTeamInd]) {
				const p = await idb.cache.players.get(pid);

				// Can happen if player was deleted before starting sim
				if (p) {
					players.push(p);
				}
			}

			const depth = await team.genDepth(players);

			teams[tid] = await processTeam(
				{
					tid,
					playThroughInjuries: [0, 0],
					depth,
				},
				{
					cid: -1,
					did: -1,
					won: 0,
					lost: 0,
					tied: 0,
					otl: 0,
				},
				players,
				pbpTids === undefined || pbpTids.has(tid),
			);

			// Tournament format: the final is played to a target score (play.ts passes it to GameSim)
			if (allStars.tournament) {
				(teams[tid] as any).targetScore = allStars.tournament.targetFinal;
			}
		}
	} else {
		for (const tid of tids) {
			let players = await idb.cache.players.indexGetAll("playersByTid", tid);
			// College mode: redshirted players do not play
			if (isCollege()) {
				players = players.filter((p) => !isRedshirting(p));
			}
			const t = await idb.cache.teams.get(tid);

			if (!t) {
				throw new Error("Invalid tid");
			}

			const teamSeason = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[tid, g.get("season")],
			);
			if (!teamSeason) {
				throw new Error("Team season not found");
			}

			teams[tid] = await processTeam(
				t,
				teamSeason,
				players,
				pbpTids === undefined || pbpTids.has(tid),
			);
		}
	}

	return teams;
};

export default loadTeams;
