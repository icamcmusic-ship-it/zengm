// Per-game download (Game Log, "Download game data", api exportGame): the box score and play-by-play as stored, plus the game's context
// before the tip (pregame), each team's (teamContext) and each player's (playerContext), and analytics from the box score and the
// play-by-play. Read only: nothing here writes to the league or draws Math.random (Season Odds uses a seeded generator, ./odds.ts).
// Hidden information follows the pages (scouted ratings, No Visible Ratings, God Mode numbers). Layout: common/gameExport.
import {
	PLAY_TYPES,
	SHOT_ZONES,
	CONTEST_LEVELS,
} from "../../../common/advStats.ts";
import {
	analyzePlayByPlay,
	boxAnalytics,
	GAME_DATA_DICTIONARY,
	GAME_EXPORT_FORMAT,
	GAME_EXPORT_SCHEMA_VERSION,
	type PbpAnalysis,
} from "../../../common/gameExport/index.ts";
import { decodePlayByPlay } from "../../../common/pbpFlavor/store.ts";
import type { Game, Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import g from "../g.ts";
import helpers from "../helpers.ts";
import { getTraitViewContext } from "../playerTraitsView.ts";
import {
	playerFatigue,
	playerProfile,
	playerRole,
	playerShots,
	seasonBaseline,
	teamAvailability,
	teamCoaching,
	teamFrontOffice,
	teamIdentity,
	teamLineups,
} from "./context.ts";
import { buildOdds } from "./odds.ts";
import {
	buildHeadToHead,
	buildScheduleLoad,
	buildSeries,
	buildStakes,
	buildVenue,
	loadSeasonContext,
	pregameStrength,
	type Unavailable,
} from "./pregame.ts";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

// Let other worker requests (and the page's updates) run between the slow parts
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const NO_PBP_REASON =
	"No play-by-play was stored for this game (the Save play-by-play setting, an older game, or another sport), so this can't be worked out.";

type ShotLogRow = {
	pid: number;
	defender: number | null;
	made: boolean;
	blocked: boolean;
	playType: string | null;
	subZone: string | null;
	xfg: number | null;
	contest: string | null;
};

const decodeShotLog = (
	rows: number[][] | undefined,
): ShotLogRow[] | undefined =>
	rows?.map((r) => ({
		pid: r[0]!,
		defender: r[1]! >= 0 ? r[1]! : null,
		made: r[2] === 1,
		blocked: r[3] === 1,
		playType: PLAY_TYPES[r[4]!]?.name ?? null,
		subZone: (r[5] ?? -1) >= 0 ? (SHOT_ZONES[r[5]!]?.name ?? null) : null,
		xfg: (r[5] ?? -1) >= 0 && (r[6] ?? 0) > 0 ? r3(r[6]! / 1000) : null,
		contest: (r[7] ?? -1) >= 0 ? (CONTEST_LEVELS[r[7]!]?.name ?? null) : null,
	}));

// The shot log (one row per field goal attempt the tracker saw) next to the play-by-play's shots, in order, by shooter
export const alignShotLog = (
	shots: PbpAnalysis["shots"],
	log: ShotLogRow[],
) => {
	const out = new Map<number, ShotLogRow>();
	let j = 0;
	for (const s of shots) {
		for (let k = j; k < Math.min(log.length, j + 4); k++) {
			const row = log[k]!;
			if (row.pid === s.pid && row.made === s.made) {
				out.set(s.n, row);
				j = k + 1;
				break;
			}
		}
	}
	return out;
};

// Who guarded whom: each field goal attempt's credited defender (Advanced Tracking Stats)
const buildMatchups = (
	log: ShotLogRow[],
	ptsOf: Map<ShotLogRow, number>,
	pid: number,
	names: Map<number, string>,
) => {
	const agg = (rows: ShotLogRow[], key: (r: ShotLogRow) => number | null) => {
		const m = new Map<number, { fga: number; fgm: number; pts: number }>();
		for (const r of rows) {
			const other = key(r);
			if (other === null) {
				continue;
			}
			const row = m.get(other) ?? { fga: 0, fgm: 0, pts: 0 };
			row.fga += 1;
			if (r.made) {
				row.fgm += 1;
				row.pts += ptsOf.get(r) ?? 0;
			}
			m.set(other, row);
		}
		return [...m.entries()]
			.map(([other, v]) => ({
				pid: other,
				name: names.get(other) ?? null,
				...v,
			}))
			.sort((a, b) => b.fga - a.fga);
	};
	return {
		// His shots, by the defender on them
		offense: agg(
			log.filter((r) => r.pid === pid),
			(r) => r.defender,
		),
		// Shots he was the defender on, by shooter
		defense: agg(
			log.filter((r) => r.defender === pid),
			(r) => r.pid,
		),
	};
};

export const buildGameExport = async (gid: number) => {
	const raw = await idb.merged.games.get(gid);
	if (!raw) {
		throw new Error("Game not found");
	}
	const {
		pbp,
		shotLog: shotLogRaw,
		...gameRest
	} = helpers.deepCopy(raw) as Game;
	const game = gameRest as Game;
	const unavailable: Unavailable = [];
	const skip = (path: string, reason: string) => {
		unavailable.push({ path, reason });
		return null;
	};
	const basketball = __SPORT === "basketball";

	// Play-by-play as stored (the players' ratings left out: they are the true ones, which the pages never show)
	let decoded: ReturnType<typeof decodePlayByPlay> | undefined;
	if (typeof pbp === "string") {
		try {
			decoded = decodePlayByPlay(pbp);
		} catch (error) {
			console.error(error);
		}
	}
	const playByPlay = decoded
		? {
				players: decoded.players.map((p) => ({
					pid: p.pid,
					t: p.t,
					...(p.career ? { career: p.career } : {}),
				})),
				events: decoded.events,
				rivalry: decoded.rivalry,
				...(decoded.game ? { context: decoded.game } : {}),
			}
		: undefined;

	const ctx = await loadSeasonContext(game);
	const strength = pregameStrength(ctx);

	// ---- pregame ----
	const stakes = buildStakes(ctx, strength);
	const odds = await buildOdds(ctx, strength.teams);
	const series = await buildSeries(ctx);
	const headToHead = await buildHeadToHead(ctx);
	const pregame = {
		stakes,
		odds: odds.value ?? skip("pregame.odds", odds.reason),
		series:
			series.value ??
			(game.playoffs ? skip("pregame.series", series.reason!) : null),
		scheduleLoad: ctx.allStar
			? skip("pregame.scheduleLoad", "All-Star Game.")
			: buildScheduleLoad(ctx),
		headToHead:
			headToHead.value ?? skip("pregame.headToHead", headToHead.reason!),
		venue: buildVenue(ctx),
	};
	await breathe();

	// ---- play-by-play analysis ----
	const teamOf = new Map<number, 0 | 1>();
	const names = new Map<number, string>();
	for (const i of [0, 1] as const) {
		for (const p of game.teams[i].players as any[]) {
			teamOf.set(p.pid, i);
			names.set(p.pid, p.name);
		}
	}
	let analysis: PbpAnalysis | undefined;
	if (basketball && decoded) {
		try {
			analysis = analyzePlayByPlay({
				events: decoded.events,
				numPeriods: game.numPeriods ?? g.get("numPeriods"),
				quarterLength: game.quarterLength ?? g.get("quarterLength"),
				spread: strength.spreadExact,
				foulsToFoulOut: g.get("foulsNeededToFoulOut") ?? 6,
				teamOf,
			});
		} catch (error) {
			console.error(error);
			skip("analytics", "The play-by-play could not be read.");
		}
	}
	const shotLog = basketball ? decodeShotLog(shotLogRaw) : undefined;
	const aligned =
		analysis && shotLog ? alignShotLog(analysis.shots, shotLog) : undefined;
	const ptsOf = new Map<ShotLogRow, number>();
	if (analysis && aligned) {
		for (const s of analysis.shots) {
			const row = aligned.get(s.n);
			if (row) {
				ptsOf.set(row, s.pts);
			}
		}
	}
	if (shotLog) {
		// (sub-zone gives the points even without the play-by-play)
		for (const row of shotLog) {
			if (!ptsOf.has(row) && row.subZone) {
				const z = SHOT_ZONES.find((x) => x.name === row.subZone);
				if (z) {
					ptsOf.set(row, z.pts);
				}
			}
		}
	}
	await breathe();

	// ---- players ----
	const pids = [...teamOf.keys()];
	const pRaws = new Map<number, Player>();
	for (const pid of pids) {
		const p = await idb.merged.players.get(pid);
		if (p) {
			pRaws.set(pid, p);
		}
	}
	let feats: { pid: number; notes?: string[]; fs?: number }[] = [];
	try {
		feats = await idb.merged.playerFeats.getAll(
			{ season: game.season },
			{ filter: (f) => f.gid === gid },
		);
	} catch (error) {
		console.error(error);
	}
	const traitContext = await getTraitViewContext();
	const profiles = new Map<number, any>();
	for (const pid of pids) {
		const pRaw = pRaws.get(pid);
		if (pRaw) {
			try {
				profiles.set(pid, await playerProfile(pRaw, game.season, traitContext));
			} catch (error) {
				console.error(error);
			}
		}
	}
	await breathe();
	const careerOf = new Map(
		(playByPlay?.players ?? []).map((p) => [p.pid, (p as any).career]),
	);

	// ---- teams ----
	const teamContext = [];
	for (const i of [0, 1] as const) {
		const tid = game.teams[i].tid;
		const players = game.teams[i].players as any[];
		const coaching =
			basketball && tid >= 0
				? await teamCoaching(ctx, i, players)
				: skip(
						`teamContext[${i}].coaching`,
						basketball
							? "All-Star team."
							: "Coaching staff and systems are only in Basketball GM.",
					);
		const identity = teamIdentity(ctx, i, strength.teams[i]!, profiles);
		const frontOffice =
			tid >= 0
				? await teamFrontOffice(ctx, i)
				: skip(`teamContext[${i}].frontOffice`, "All-Star team.");
		const lineups = basketball ? teamLineups(game, i, analysis) : null;
		if (!basketball) {
			skip(
				`teamContext[${i}].lineups`,
				"Lineups come from the basketball play-by-play.",
			);
		} else if (!analysis) {
			skip(`teamContext[${i}].lineups.closing, groups, onOff`, NO_PBP_REASON);
		}
		teamContext.push({
			tid,
			coaching,
			identity,
			frontOffice,
			availability: teamAvailability(game, i),
			lineups,
		});
	}
	await breathe();

	// ---- players ----
	const playerContext = [];
	let anyEnergy = false;
	for (const i of [0, 1] as const) {
		const players = game.teams[i].players as any[];
		const order = players
			.filter((p) => n(p.min) > 0)
			.toSorted(
				(a, b) =>
					n(b.ctx?.plan ?? b.min) - n(a.ctx?.plan ?? a.min) ||
					n(b.min) - n(a.min),
			)
			.map((p) => p.pid);
		for (const line of players) {
			const pid = line.pid as number;
			const pRaw = pRaws.get(pid);
			const baseline = seasonBaseline(
				ctx,
				pid,
				line,
				pRaw,
				careerOf.get(pid),
				feats.filter((f) => f.pid === pid),
			);
			const rank = order.indexOf(pid);
			const role = await playerRole(
				game,
				i,
				line,
				baseline.averagesBefore?.min ?? null,
				pRaw,
				rank >= 0 ? rank + 1 : null,
			);
			let fatigue: any = basketball ? playerFatigue(pid, analysis) : null;
			const energy: number[] | undefined = line.ctx?.en;
			if (energy) {
				anyEnergy = true;
			}
			if (fatigue) {
				fatigue = {
					...fatigue,
					energyCurve: energy
						? energy.map((e, k) => ({ period: k + 1, energy: e }))
						: null,
				};
			} else if (energy) {
				fatigue = {
					energyCurve: energy.map((e, k) => ({ period: k + 1, energy: e })),
				};
			}
			let shotChart: any[] | null = basketball
				? playerShots(pid, analysis)
				: null;
			if (shotChart && aligned) {
				shotChart = shotChart.map((s) => {
					const row = aligned.get(s.n);
					return row
						? {
								...s,
								playType: row.playType,
								subZone: row.subZone,
								xfg: row.xfg,
								contest: row.contest,
								defender: row.defender,
							}
						: s;
				});
			}
			playerContext.push({
				pid,
				name: line.name,
				tid: game.teams[i].tid,
				t: i,
				profile: profiles.get(pid) ?? null,
				seasonBaseline: baseline,
				role,
				fatigue,
				matchups:
					shotLog && n(line.min) > 0
						? buildMatchups(shotLog, ptsOf, pid, names)
						: null,
				shotChart,
			});
		}
		await breathe();
	}
	if (!basketball) {
		skip(
			"playerContext[].fatigue",
			"Stints and fatigue come from the basketball play-by-play.",
		);
		skip(
			"playerContext[].shotChart",
			"Shots come from the basketball play-by-play.",
		);
		skip(
			"playerContext[].matchups",
			"Matchups are recorded by Basketball GM's Advanced Tracking Stats.",
		);
	} else {
		if (!analysis) {
			skip("playerContext[].fatigue", NO_PBP_REASON);
			skip("playerContext[].shotChart", NO_PBP_REASON);
		}
		if (!game.teams.some((t) => (t.players as any[]).some((p) => p.ctx))) {
			skip(
				"teamContext[].availability.minutesRestrictions, teamContext[].lineups.minutes[].planned, teamContext[].coaching.adjustments, playerContext[].role.playingTimeSetting",
				"Recorded with each box score line for games played since this file's version 2; this game is older.",
			);
		}
		if (!anyEnergy) {
			skip(
				"playerContext[].fatigue.energyCurve",
				"Energy by period is recorded with games played since this file's version 2; this game has none.",
			);
		}
		if (!shotLog) {
			skip(
				"playerContext[].matchups",
				"Who guarded whom is recorded per shot only with Advanced Tracking Stats on and the play-by-play stored, for games played since this file's version 2.",
			);
			skip(
				"playerContext[].shotChart[].xfg, contest, playType, subZone, defender",
				"Recorded per shot only with Advanced Tracking Stats on and the play-by-play stored (games since this file's version 2).",
			);
		} else if (!shotLog.some((r) => r.xfg !== null)) {
			skip(
				"playerContext[].shotChart[].xfg, subZone",
				"Shot Zones is turned off.",
			);
		}
		skip(
			"playerContext[].shotChart[].x, y",
			"The sim has no court coordinates: shots have a zone (and a sub-zone with Shot Zones), not a spot.",
		);
		skip(
			"playerContext[].matchups (full-possession assignments)",
			"The sim credits a defender on each shot, not on every possession, so matchups are by shot.",
		);
	}

	// ---- analytics ----
	let analytics = null;
	if (basketball) {
		const box = boxAnalytics(
			[game.teams[0] as any, game.teams[1] as any],
			game.numPlayersOnCourt ?? 5,
		);
		if (analysis) {
			const wpaByPid = analysis.players
				.filter((p) => p.wpa !== 0)
				.toSorted((a, b) => Math.abs(b.wpa) - Math.abs(a.wpa));
			analytics = {
				box,
				winProbability: {
					start: analysis.wpStart,
					spread: strength.spread,
					timeline: analysis.timeline,
					swings: analysis.swings.map((s) => ({
						...s,
						name: s.pid !== undefined ? (names.get(s.pid) ?? null) : null,
					})),
					topPlayers: wpaByPid.slice(0, 10).map((p) => ({
						pid: p.pid,
						name: names.get(p.pid) ?? null,
						t: p.t,
						wpa: p.wpa,
					})),
				},
				flow: {
					largestLead: analysis.largestLead,
					runs: analysis.runs,
					leadChanges: analysis.leadChanges,
					ties: analysis.ties,
					garbageTime: analysis.garbage,
				},
				clutch: {
					...analysis.clutch,
					players: analysis.players
						.filter((p) => p.clutch)
						.map((p) => ({ pid: p.pid, t: p.t, ...p.clutch })),
				},
				splits: analysis.splits.map((s, i) => ({
					...s,
					bench: box.teams[i]!.benchPts,
				})),
				knocks: analysis.knocks,
			};
		} else {
			analytics = {
				box,
				winProbability: skip("analytics.winProbability", NO_PBP_REASON),
				flow: skip("analytics.flow", NO_PBP_REASON),
				clutch: skip("analytics.clutch", NO_PBP_REASON),
				splits: box.teams.map((t) => ({ bench: t.benchPts })),
			};
			skip("analytics.splits (all but bench)", NO_PBP_REASON);
		}
	} else {
		skip(
			"analytics",
			"The analytics are basketball's (Four Factors, possessions, the play-by-play).",
		);
	}

	return {
		format: GAME_EXPORT_FORMAT,
		schemaVersion: GAME_EXPORT_SCHEMA_VERSION,
		leagueName: "",
		game,
		playByPlay,
		pregame,
		teamContext,
		playerContext,
		analytics,
		unavailable,
		dataDictionary: GAME_DATA_DICTIONARY,
		// (players' current state where a field says asOf: "export")
		exportSeason: g.get("season"),
		exportPhase: g.get("phase"),
	};
};

export type GameExport = Awaited<ReturnType<typeof buildGameExport>>;
