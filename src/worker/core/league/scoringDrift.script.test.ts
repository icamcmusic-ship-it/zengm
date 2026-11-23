// @ts-nocheck (diagnostic script)
// Scoring drift: a new league with the new-league defaults, the 2026 Game Simulation preset and League Eras off (no style drift), played
// for SCORING_DRIFT_SEASONS full seasons (82 games, playoffs, offseasons; spectator). Writes one JSON line per season: the regular season's
// league averages (points, pace, ORtg, FG%, 3P%, 3PA rate, FTA rate, TOV, ORB), the rostered players' ratings at the start of the season
// (mean ovr, share at 60+, every rating's mean, the top 8 of each team's mean), 2K badge tiers, coach ratings, zone tendencies, trait
// seeds and the talent cycle. At the probe seasons it also plays a fixed set of preview games (no DB writes) with parts of the league
// put back where they were in the first season (zone tendencies off, badges off, coaches and player ratings shifted back by the
// league's mean drift), to tell which part moved the scoring.
//
//   SCORING_DRIFT=1 SCORING_DRIFT_SEASONS=30 SCORING_DRIFT_SEED=1 SCORING_DRIFT_OUT=/tmp/drift.jsonl \
//     npx vitest run --project basketball src/worker/core/league/scoringDrift.script.test.ts
//
// SCORING_DRIFT_PROBES=1,10,20,30 (seasons, 1 = the first), SCORING_DRIFT_PROBE_GAMES=240, SCORING_DRIFT_GAMES=82 (games per team),
// SCORING_DRIFT_SETTINGS='{"tieredBadgesSim":false}' (on top of the defaults and the preset).
import "fake-indexeddb/auto";
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { talentCycle } from "../../../common/prospectVariety.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import { loadMatchups, runPreviewGames } from "../game/previewGameSim.ts";
import { tiersForSeason } from "../player/tieredBadges.ts";

const env = (globalThis as any).process.env;
const SEASONS = Number(env.SCORING_DRIFT_SEASONS ?? 30);
const SEED = Number(env.SCORING_DRIFT_SEED ?? 1);
const PROBES = new Set(
	(env.SCORING_DRIFT_PROBES ?? "1,10,20,30").split(",").map(Number),
);
const PROBE_GAMES = Number(env.SCORING_DRIFT_PROBE_GAMES ?? 240);
const NUM_GAMES = Number(env.SCORING_DRIFT_GAMES ?? 82);
// Teams (fewer than 30: one conference and division, the top 8 in the playoffs; less memory and time)
const NUM_TEAMS = Number(env.SCORING_DRIFT_TEAMS ?? 30);

const out = (obj: unknown) => {
	const line = JSON.stringify(obj);
	console.log(line);
	if (env.SCORING_DRIFT_OUT) {
		appendFileSync(env.SCORING_DRIFT_OUT, `${line}\n`);
	}
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const mean = (xs: number[]) =>
	xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

const RATING_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

const rostered = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])).filter(
		(p) => p.tid >= 0,
	);

// Numeric keys of a ratings row, nested sub-rating objects flattened (sub.x)
const flatRatings = (r: Record<string, any>) => {
	const outR: Record<string, number> = {};
	for (const [k, v] of Object.entries(r)) {
		if (typeof v === "number" && k !== "season" && k !== "pos") {
			outR[k] = v;
		} else if (v && typeof v === "object" && !Array.isArray(v)) {
			for (const [k2, v2] of Object.entries(v)) {
				if (typeof v2 === "number") {
					outR[`${k}.${k2}`] = v2;
				}
			}
		}
	}
	return outR;
};

const ratingsSnapshot = async () => {
	const players = await rostered();
	const sums: Record<string, number[]> = {};
	const top8: Record<string, number[]> = {};
	const byTid = new Map<number, any[]>();
	for (const p of players) {
		const r = last(p.ratings);
		for (const [k, v] of Object.entries(flatRatings(r))) {
			(sums[k] ??= []).push(v);
		}
		const list = byTid.get(p.tid) ?? [];
		list.push(r);
		byTid.set(p.tid, list);
	}
	for (const list of byTid.values()) {
		list.sort((a, b) => b.ovr - a.ovr);
		for (const r of list.slice(0, 8)) {
			for (const k of [...RATING_KEYS, "ovr"]) {
				(top8[k] ??= []).push(r[k]);
			}
		}
	}
	const ovrs = players.map((p) => last(p.ratings).ovr);
	return {
		n: players.length,
		ovr: r3(mean(ovrs)),
		share60: r3(ovrs.filter((x) => x >= 60).length / ovrs.length),
		mean: Object.fromEntries(
			Object.entries(sums).map(([k, v]) => [k, r3(mean(v))]),
		),
		top8: Object.fromEntries(
			Object.entries(top8).map(([k, v]) => [k, r3(mean(v))]),
		),
	};
};

const badgeSnapshot = async () => {
	const players = await rostered();
	const tiers = [0, 0, 0, 0, 0, 0];
	for (const p of players) {
		const t = tiersForSeason(p, g.get("season"));
		for (const tier of Object.values(t ?? {})) {
			tiers[tier as number]++;
		}
	}
	return tiers.slice(1);
};

const coachSnapshot = async () => {
	const coaches = (await idb.cache.coaches.getAll()).filter(
		(c) => c.tid >= 0,
	);
	const byRole: Record<string, Record<string, number[]>> = {};
	for (const c of coaches) {
		const role = (byRole[c.role] ??= {});
		for (const [k, v] of Object.entries(c.ratings)) {
			if (typeof v === "number") {
				(role[k] ??= []).push(v);
			}
		}
	}
	return Object.fromEntries(
		Object.entries(byRole).map(([role, ks]) => [
			role,
			Object.fromEntries(
				Object.entries(ks).map(([k, v]) => [k, r3(mean(v))]),
			),
		]),
	);
};

const otherSnapshot = async () => {
	const players = await rostered();
	const zt: number[][] = [[], [], [], []];
	const traits: Record<string, number[]> = {};
	for (const p of players) {
		const r = last(p.ratings) as any;
		if (r.zt) {
			r.zt.forEach((x: number, i: number) => zt[i]!.push(x));
		} else {
			for (const z of zt) {
				z.push(1);
			}
		}
		for (const [k, v] of Object.entries(p.traits ?? {})) {
			if (typeof v === "number") {
				(traits[k] ??= []).push(v);
			}
		}
	}
	return {
		zt: zt.map((z) => r3(mean(z))),
		traits: Object.fromEntries(
			Object.entries(traits).map(([k, v]) => [k, r3(mean(v))]),
		),
	};
};

// Regular season league averages from the team stats
const seasonStats = async (s: number) => {
	const rows = (await idb.cache.teamStats.getAll()).filter(
		(ts) => ts.season === s && !ts.playoffs,
	);
	const t: Record<string, number> = {};
	for (const row of rows) {
		for (const k of [
			"gp",
			"min",
			"pts",
			"fg",
			"fga",
			"tp",
			"tpa",
			"ft",
			"fta",
			"tov",
			"orb",
			"drb",
			"oppDrb",
			"fgAtRim",
			"fgaAtRim",
			"fgaMidRange",
			"fgaLowPost",
		]) {
			t[k] = (t[k] ?? 0) + (row[k] ?? 0);
		}
	}
	const poss = t.fga - t.orb + t.tov + 0.44 * t.fta;
	return {
		pts: r3(t.pts / t.gp),
		pace: r3((poss / t.min) * 48 * 5),
		ortg: r3((100 * t.pts) / poss),
		fgPct: r3(t.fg / t.fga),
		tpPct: r3(t.tp / t.tpa),
		ftPct: r3(t.ft / t.fta),
		tpaRate: r3(t.tpa / t.fga),
		ftRate: r3(t.fta / t.fga),
		tov: r3(t.tov / t.gp),
		orb: r3(t.orb / t.gp),
		orbPct: r3(t.orb / (t.orb + t.oppDrb)),
		rimShare: r3(t.fgaAtRim / t.fga),
		midShare: r3(t.fgaMidRange / t.fga),
		postShare: r3(t.fgaLowPost / t.fga),
	};
};

const playSeason = async () => {
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	await lock.set("gameSim", false);
	let guard = 0;
	while (
		g.get("phase") === PHASE.REGULAR_SEASON ||
		g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
		g.get("phase") === PHASE.PLAYOFFS
	) {
		await game.play(
			g.get("phase") === PHASE.PLAYOFFS
				? 100
				: await season.getDaysLeftSchedule(),
			{},
		);
		if (++guard > 100) {
			throw new Error("stuck in season");
		}
	}
};

const offseason = async () => {
	await phase.newPhase(PHASE.DRAFT, {});
	await draft.runPicks({ type: "untilEnd" }, {});
	await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
	await phase.newPhase(PHASE.FREE_AGENCY, {});
	let guard = 0;
	while (g.get("phase") === PHASE.FREE_AGENCY) {
		await freeAgents.play(30, {});
		if (++guard > 10) {
			throw new Error("stuck in free agency");
		}
	}
	// To the preseason (development, badges, zone tendencies), so the snapshot is of next season's league
	await phase.newPhase(PHASE.PRESEASON, {});
};

// Balanced round robin pairs (as eraPresetCalibration)
const makePairs = (tids: number[], n: number, s: number) => {
	const rnd = makeSeededRandom(s);
	const order = [...tids];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	const k = order.length;
	const pairs: [number, number][] = [];
	for (let round = 0; pairs.length < n; round++) {
		const rest = order.slice(1);
		const shift = round % (k - 1);
		const arr = [order[0], ...rest.slice(shift), ...rest.slice(0, shift)];
		for (let i = 0; i < k / 2; i++) {
			pairs.push(
				round % 2 === 0
					? [arr[i]!, arr[k - 1 - i]!]
					: [arr[k - 1 - i]!, arr[i]!],
			);
		}
	}
	return pairs.slice(0, n);
};

test.skipIf(!env.SCORING_DRIFT)(
	"scoring drift",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		Math.random = makeSeededRandom(SEED);
		const extra = env.SCORING_DRIFT_SETTINGS
			? JSON.parse(env.SCORING_DRIFT_SETTINGS)
			: {};
		await league.createStream(
			{},
			{
				confs:
					NUM_TEAMS < 30
						? [{ cid: 0, name: "League" }]
						: last(defaultGameAttributes.confs).value,
				divs:
					NUM_TEAMS < 30
						? [{ did: 0, cid: 0, name: "Division" }]
						: last(defaultGameAttributes.divs).value,
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: SEED,
				name: `drift${SEED}`,
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					spectator: true,
					featureLeagueEras: false,
					...gameSimPresets[2026],
					numGames: NUM_GAMES,
					saveOldBoxScores: { pastSeasons: 0, pastSeasonsType: "all", note: "all" },
					...(NUM_TEAMS < 30
						? {
								numGamesPlayoffSeries: [7, 7, 7],
								numPlayoffByes: 0,
								playIn: false,
							}
						: {}),
					...extra,
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(
					NUM_TEAMS < 30
						? helpers
								.getTeamsDefault()
								.slice(0, NUM_TEAMS)
								.map((t) => ({ ...t, cid: 0, did: 0 }))
						: helpers.getTeamsDefault(),
				),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		const tids = (await idb.cache.teams.getAll())
			.filter((t) => !t.disabled)
			.map((t) => t.tid);
		const probePairs = makePairs(tids, PROBE_GAMES, 1000 + SEED);

		let base: any;
		for (let i = 1; i <= SEASONS; i++) {
			const t0 = performance.now();
			const s = g.get("season");
			const ratings = await ratingsSnapshot();
			const coaches = await coachSnapshot();
			const row: any = {
				i,
				season: s,
				ratings,
				badges: await badgeSnapshot(),
				coaches,
				...(await otherSnapshot()),
				cycle: r3(talentCycle(String(g.get("lid")), s)),
			};
			if (i === 1) {
				base = { ratings, coaches };
			}
			if (PROBES.has(i)) {
				row.probe = await probe(probePairs, base, i);
			}
			await playSeason();
			row.stats = await seasonStats(s);
			// (memory: box scores aren't needed once the season's stats are in)
			await idb.cache.games.clear();
			row.ms = Math.round(performance.now() - t0);
			if (i < SEASONS) {
				await offseason();
			}
			out(row);
		}
	},
);

// Preview games at the start of a season, with parts of the league put back where the first season had them
const probe = async (pairs: [number, number][], base: any, i: number) => {
	const seed = 5000 + SEED;
	const players = await rostered();
	const coaches = (await idb.cache.coaches.getAll()).filter(
		(c) => c.tid >= 0,
	);
	const nowRatings = (await ratingsSnapshot()).mean;
	const nowCoaches = await coachSnapshot();

	const run = async (opts: {
		zt?: boolean;
		badges?: boolean;
		coaches?: boolean;
		ratings?: boolean;
	}) => {
		const savedRatings = new Map<number, any>();
		const savedCoaches = new Map<number, any>();
		if (opts.ratings) {
			for (const p of players) {
				const r = last(p.ratings) as any;
				savedRatings.set(p.pid, structuredClone(r));
				for (const k of RATING_KEYS) {
					if (k === "hgt") {
						continue;
					}
					const d = nowRatings[k] - base.ratings.mean[k];
					r[k] = helpers.bound(Math.round(r[k] - d), 0, 100);
				}
				if (r.sub) {
					for (const k2 of Object.keys(r.sub)) {
						const key = `sub.${k2}`;
						if (base.ratings.mean[key] !== undefined) {
							const d = nowRatings[key] - base.ratings.mean[key];
							r.sub[k2] = helpers.bound(Math.round(r.sub[k2] - d), 0, 100);
						}
					}
				}
			}
		}
		if (opts.coaches) {
			for (const c of coaches) {
				savedCoaches.set(c.cid, structuredClone(c.ratings));
				const now = nowCoaches[c.role];
				const then = base.coaches[c.role];
				if (!now || !then) {
					continue;
				}
				for (const k of Object.keys(c.ratings)) {
					if (now[k] !== undefined && then[k] !== undefined) {
						c.ratings[k] = helpers.bound(
							Math.round(c.ratings[k] - (now[k] - then[k])),
							0,
							100,
						);
					}
				}
			}
		}
		let matchups;
		try {
			matchups = await loadMatchups(pairs, {});
		} finally {
			for (const p of players) {
				if (savedRatings.has(p.pid)) {
					p.ratings[p.ratings.length - 1] = savedRatings.get(p.pid);
				}
			}
			for (const c of coaches) {
				if (savedCoaches.has(c.cid)) {
					c.ratings = savedCoaches.get(c.cid);
				}
			}
		}
		for (const m of matchups) {
			for (const t of m) {
				for (const p of t.player) {
					if (opts.zt) {
						delete p.zt;
					}
					if (opts.badges) {
						delete p.bt;
					}
				}
			}
		}
		const st = runPreviewGames(matchups, {}, seed);
		return {
			pts: r3(st.pts),
			pace: r3(st.pace),
			ortg: r3(st.ortg),
			fgPct: r3(st.fgPct),
			tpPct: r3(st.tpPct),
			tpaRate: r3(st.tpaRate),
			ftRate: r3(st.ftRate),
		};
	};
	const res: any = {};
	res.base = await run({});
	if (i > 1) {
		res.noZt = await run({ zt: true });
		res.noBadges = await run({ badges: true });
		res.coaches = await run({ coaches: true });
		res.ratings = await run({ ratings: true });
		res.all = await run({
			zt: true,
			badges: true,
			coaches: true,
			ratings: true,
		});
	} else {
		res.noZt = await run({ zt: true });
		res.noBadges = await run({ badges: true });
	}
	return res;
};
