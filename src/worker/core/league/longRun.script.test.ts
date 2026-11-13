// Not a real test: a long headless spectator league that logs, after every season, league averages, ratings levels, position
// and archetype shares, rookie quality, player counts, salaries, sim time and database size (one JSON line per season), and checks
// every box score of the season (points, minutes, team totals, plus/minus, fouls, negative stats) and that season totals match
// the box scores. Skipped unless LONG_RUN is set:
//
//   LONG_RUN=1 LONG_RUN_CONFIG=defaults|all|off|random LONG_RUN_SEASONS=20 LONG_RUN_SEED=1 LONG_RUN_OUT=/tmp/run.jsonl \
//     node_modules/.bin/vitest run --project basketball src/worker/core/league/longRun.script.test.ts
//
// LONG_RUN_SETTINGS='{"elam":true}' adds settings on top of the config.
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import {
	getCurrentContract,
	getNearestContractAmount,
} from "../../../common/contracts.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import archetypesApi from "../../api/archetypes.ts";
import { getRecordsBook } from "../../util/recordsBookData.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";

const env = (globalThis as any).process.env;
const ENABLED = !!env.LONG_RUN;
const SEASONS = Number(env.LONG_RUN_SEASONS ?? 3);
const SEED = Number(env.LONG_RUN_SEED ?? 1);
const CONFIG = env.LONG_RUN_CONFIG ?? "defaults";

const out = (line: string) => {
	console.log(line);
	if (env.LONG_RUN_OUT) {
		appendFileSync(env.LONG_RUN_OUT, `${line}\n`);
	}
};
let problemCount = 0;
const problemSeen = new Map<string, number>();
const problem = (kind: string, text: string) => {
	problemCount += 1;
	const n = (problemSeen.get(kind) ?? 0) + 1;
	problemSeen.set(kind, n);
	// The first few of each kind
	if (n <= 5) {
		out(`PROBLEM ${kind} (season ${g.get("season")}): ${text}`);
	}
};

const cpuMs = () => {
	const u = (globalThis as any).process.cpuUsage();
	return (u.user + u.system) / 1000;
};

// A fixed amount of work, to tell a slower sim from a busier machine
const calibrate = () => {
	const c0 = cpuMs();
	let x = 0;
	const arr: number[] = [];
	for (let i = 0; i < 2e6; i++) {
		arr.push((i * 7919) % 10007);
		x += Math.sqrt(i);
	}
	arr.sort((a, b) => a - b);
	return { ms: cpuMs() - c0, x: x + arr[0]! };
};

const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs: number[]) =>
	xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

const STAT_KEYS = [
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"ba",
	"pf",
	"pts",
] as const;

const checkBoxScores = async (s: number) => {
	const games = (await idb.cache.games.getAll()).filter(
		(gm) => gm.season === s,
	);
	const foulLimit = g.get("foulsNeededToFoulOut");
	const numPeriods = g.get("numPeriods");
	const quarterLength = g.get("quarterLength");
	const numOnCourt = g.get("numPlayersOnCourt");
	const sums = new Map<string, Record<string, any>>();
	let homeWon = 0;
	let homeGames = 0;
	let injuries = 0;
	let ot = 0;
	for (const gm of games) {
		const label = `gid ${gm.gid} day ${gm.day}${gm.playoffs ? " playoffs" : ""}`;
		const allStar = gm.teams[0].tid < 0;
		const otLength = gm.playoffs
			? (g.get("overtimeLengthPlayoffs") ?? g.get("overtimeLength"))
			: g.get("overtimeLength");
		if (gm.overtimes > 0) {
			ot += 1;
		}
		if (!gm.playoffs && !allStar && !gm.neutralSite) {
			homeGames += 1;
			if (gm.won.tid === gm.teams[0].tid) {
				homeWon += 1;
			}
		}
		const elamGame = g.get("elam") || (allStar && g.get("elamASG"));
		let pmTotal = 0;
		for (const t of gm.teams) {
			const ps = t.players as any[];
			const tt = t as any;
			// Without three pointers, threes are still recorded as tp, worth 2
			const tpPts = g.get("threePointers") ? 1 : 0;
			if (tt.pts !== tt.fg * 2 + tt.tp * tpPts + tt.ft) {
				problem(
					"team pts",
					`${label} tid ${t.tid} pts ${tt.pts} fg ${tt.fg} tp ${tt.tp} ft ${tt.ft}`,
				);
			}
			for (const key of STAT_KEYS) {
				const sum = ps.reduce((acc, p) => acc + (p[key] ?? 0), 0);
				if (key !== "ba" && tt[key] !== undefined && sum !== tt[key]) {
					problem(
						`team ${key} != sum of players`,
						`${label} tid ${t.tid} ${tt[key]} vs ${sum}`,
					);
				}
			}
			if (Array.isArray(tt.ptsQtrs)) {
				const q = tt.ptsQtrs.reduce((a: number, b: number) => a + b, 0);
				if (q !== tt.pts) {
					problem("ptsQtrs", `${label} tid ${t.tid} ${q} vs ${tt.pts}`);
				}
				if (tt.ptsQtrs.length !== numPeriods + gm.overtimes) {
					problem(
						"ptsQtrs length",
						`${label} ${tt.ptsQtrs.length} periods, ${gm.overtimes} OT`,
					);
				}
			}
			const minSum = ps.reduce((acc, p) => acc + p.min, 0);
			// Elam: the last period has no clock, so minutes can be anything
			if (!elamGame) {
				const expected =
					numOnCourt * (numPeriods * quarterLength + gm.overtimes * otLength);
				if (Math.abs(minSum - expected) > 0.1) {
					problem(
						"minutes",
						`${label} tid ${t.tid} ${r(minSum, 2)} vs ${expected} (OT ${gm.overtimes})`,
					);
				}
			}
			let teamPm = 0;
			for (const p of ps) {
				for (const key of [...STAT_KEYS, "min", "gs", "gp"]) {
					if (p[key] < 0 || Number.isNaN(p[key])) {
						problem("negative stat", `${label} pid ${p.pid} ${key} ${p[key]}`);
					}
				}
				if (p.pts !== p.fg * 2 + p.tp * tpPts + p.ft) {
					problem(
						"player pts",
						`${label} pid ${p.pid} pts ${p.pts} fg ${p.fg} tp ${p.tp} ft ${p.ft}`,
					);
				}
				if (p.fg > p.fga || p.tp > p.tpa || p.ft > p.fta || p.tp > p.fg) {
					problem("made > attempted", `${label} pid ${p.pid}`);
				}
				// With a low limit, fouled out players come back when a team runs out of players
				// (or when injuries leave too few players)
				const healthy = ps.filter(
					(x) =>
						x.pf < foulLimit &&
						!(x.injury?.gamesRemaining > 0 && !x.injury?.newThisGame),
				).length;
				if (p.pf > foulLimit && foulLimit >= 5 && healthy >= numOnCourt) {
					const out = ps.filter((x) => x.pf >= foulLimit).length;
					const played = ps.filter((x) => x.min > 0).length;
					problem(
						"fouls",
						`${label} pid ${p.pid} pf ${p.pf} limit ${foulLimit} min ${r(p.min)} OT ${gm.overtimes} team: ${out} fouled out, ${played} played, ${ps.length} players, injured at start ${ps.filter((x) => x.injury?.gamesRemaining > 0 && !x.injury?.newThisGame).length}, new injuries ${ps.filter((x) => x.injury?.newThisGame).length}`,
					);
				}
				if (p.min > 0 && !p.gp) {
					problem("min without gp", `${label} pid ${p.pid}`);
				}
				if (
					p.min === 0 &&
					p.gp &&
					p.pts + p.fga + p.fta + p.tov + p.pf + p.drb + p.orb > 0
				) {
					// Fine (seconds rounded), just checking for impossible combos below
				}
				if (
					p.min === 0 &&
					!p.gp &&
					p.pts +
						p.fga +
						p.fta +
						p.tov +
						p.pf +
						p.drb +
						p.orb +
						p.ast +
						p.stl +
						p.blk >
						0
				) {
					problem("stats without gp", `${label} pid ${p.pid}`);
				}
				if (p.injury?.newThisGame) {
					injuries += 1;
				}
				teamPm += p.pm ?? 0;
				if (p.min > 0 && !allStar) {
					const key = `${p.pid}|${gm.playoffs ? 1 : 0}`;
					const sum = sums.get(key) ?? {};
					for (const k of [...STAT_KEYS, "min", "gp", "gs", "pm"]) {
						sum[k] = (sum[k] ?? 0) + (p[k] ?? 0);
					}
					sums.set(key, sum);
				} else if (p.gp && !allStar) {
					const key = `${p.pid}|${gm.playoffs ? 1 : 0}`;
					const sum = sums.get(key) ?? {};
					for (const k of [...STAT_KEYS, "min", "gp", "gs", "pm"]) {
						sum[k] = (sum[k] ?? 0) + (p[k] ?? 0);
					}
					sums.set(key, sum);
				}
			}
			const starters = ps.filter((p) => p.gs).length;
			if (starters !== numOnCourt) {
				problem("starters", `${label} tid ${t.tid} ${starters}`);
			}
			const margin = tt.pts - (gm.teams.find((t2) => t2 !== t) as any).pts;
			if (teamPm !== numOnCourt * margin) {
				problem(
					"team +/-",
					`${label} tid ${t.tid} pm ${teamPm} margin ${margin}`,
				);
			}
			pmTotal += teamPm;
			if (tt.pts === undefined || tt.pts < 0) {
				problem("team pts missing", label);
			}
		}
		if (pmTotal !== 0) {
			problem("+/- sum", `${label} ${pmTotal}`);
		}
		if (
			gm.teams[0].pts === gm.teams[1].pts &&
			!gm.forceWin &&
			(gm.playoffs
				? g.get("maxOvertimesPlayoffs")
				: g.get("maxOvertimes", "current")) === null
		) {
			problem("tie", label);
		}
		const winnerPts = Math.max(gm.teams[0].pts, gm.teams[1].pts);
		if (gm.won.pts !== winnerPts) {
			problem("won.pts", label);
		}
	}

	const asg = games.find((gm) => gm.teams[0].tid === -1);
	if (asg) {
		const allStars = await idb.merged.allStars.get(s);
		if (!allStars?.mvp) {
			problem("all-star mvp", `gid ${asg.gid}`);
		} else if (
			!asg.teams.some((t) =>
				t.players.some((p: any) => p.pid === allStars.mvp!.pid),
			)
		) {
			problem("all-star mvp not in the game", `pid ${allStars.mvp.pid}`);
		}
	}

	// Season totals vs box scores
	const statsRows = (await idb.cache.players.getAll()).flatMap((p) =>
		p.stats
			.filter((ps) => ps.season === s && ps.tid >= 0)
			.map((ps) => ({ ...ps, pid: p.pid })),
	);
	const totals = new Map<string, Record<string, any>>();
	for (const row of statsRows) {
		const key = `${row.pid}|${row.playoffs ? 1 : 0}`;
		const sum = totals.get(key) ?? {};
		for (const k of [...STAT_KEYS, "min", "gp", "gs", "pm"]) {
			sum[k] = (sum[k] ?? 0) + ((row as any)[k] ?? 0);
		}
		totals.set(key, sum);
		for (const k of [
			"per",
			"ws",
			"ows",
			"dws",
			"obpm",
			"dbpm",
			"vorp",
			"ewa",
			"ortg",
			"drtg",
			"usgp",
		]) {
			const v = (row as any)[k];
			if (typeof v === "number" && !Number.isFinite(v)) {
				problem(`adv ${k} not finite`, `pid ${row.pid} ${v}`);
			}
		}
		const r0 = row as any;
		if (r0.min > 500) {
			if (r0.per < -10 || r0.per > 45) {
				problem("PER range", `pid ${row.pid} per ${r0.per} min ${r0.min}`);
			}
			if (r0.obpm + r0.dbpm < -15 || r0.obpm + r0.dbpm > 20) {
				problem(
					"BPM range",
					`pid ${row.pid} bpm ${r0.obpm + r0.dbpm} min ${r0.min}`,
				);
			}
			if (r0.ows + r0.dws < -5 || r0.ows + r0.dws > 25) {
				problem("WS range", `pid ${row.pid} ws ${r0.ows + r0.dws}`);
			}
		}
	}
	// The best season by win shares, per game
	const best = statsRows
		.filter((row: any) => !row.playoffs && row.gp > 0)
		.sort((a: any, b: any) => b.ows + b.dws - (a.ows + a.dws))[0] as any;
	if (best) {
		const pg = (k: string) => r(best[k] / best.gp, 1);
		const p = await idb.cache.players.get(best.pid);
		out(
			`BEST ${s} pid ${best.pid} tid ${best.tid} age ${p ? s - p.born.year : "?"} ovr ${p ? last(p.ratings).ovr : "?"} gp ${best.gp} min ${pg("min")} pts ${pg("pts")} trb ${r((best.orb + best.drb) / best.gp, 1)} ast ${pg("ast")} stl ${pg("stl")} blk ${pg("blk")} tov ${pg("tov")} fg ${best.fg}/${best.fga} tp ${best.tp}/${best.tpa} ft ${best.ft}/${best.fta} per ${r(best.per)} ws ${r(best.ows + best.dws)} bpm ${r(best.obpm + best.dbpm)} vorp ${r(best.vorp)}`,
		);
	}
	for (const [key, sum] of sums) {
		const tot = totals.get(key);
		if (!tot) {
			problem("no stats row", key);
			continue;
		}
		for (const k of Object.keys(sum)) {
			if (Math.abs(sum[k] - (tot[k] ?? 0)) > (k === "min" ? 0.05 : 0)) {
				problem(
					`season ${k} != box scores`,
					`${key} box ${r(sum[k], 2)} row ${r(tot[k] ?? 0, 2)}`,
				);
			}
		}
	}
	for (const [key, tot] of totals) {
		if (!sums.has(key) && tot.gp > 0) {
			problem("stats row without box scores", `${key} gp ${tot.gp}`);
		}
	}

	return {
		games: games.length,
		homeWinPct: r(homeWon / homeGames, 3),
		injPerTeamGame: r(injuries / (2 * games.length), 3),
		otPct: r(ot / games.length, 3),
	};
};

const leagueAverages = async (s: number) => {
	const rows = (await idb.cache.teamSeasons.getAll()).filter(
		(ts) => ts.season === s,
	);
	const tstats = (await idb.cache.teamStats.getAll()).filter(
		(ts) => ts.season === s && !ts.playoffs,
	);
	const sum: Record<string, any> = {};
	for (const ts of tstats) {
		for (const k of [
			"gp",
			"min",
			"fg",
			"fga",
			"tp",
			"tpa",
			"ft",
			"fta",
			"orb",
			"drb",
			"ast",
			"tov",
			"stl",
			"blk",
			"pf",
			"pts",
		]) {
			sum[k] = (sum[k] ?? 0) + ((ts as any)[k] ?? 0);
		}
	}
	const gp = sum.gp;
	const poss = sum.fga + 0.44 * sum.fta - sum.orb + sum.tov;
	return {
		teams: rows.length,
		pts: r(sum.pts / gp),
		pace: r((poss / gp) * (240 / (sum.min / gp))),
		fgPct: r((100 * sum.fg) / sum.fga),
		tpPct: r((100 * sum.tp) / sum.tpa),
		tpaRate: r((100 * sum.tpa) / sum.fga),
		ftPct: r((100 * sum.ft) / sum.fta),
		tov: r(sum.tov / gp),
		stl: r(sum.stl / gp),
		blk: r(sum.blk / gp),
		fta: r(sum.fta / gp),
		ast: r(sum.ast / gp),
		orb: r(sum.orb / gp),
		trb: r((sum.orb + sum.drb) / gp),
		pf: r(sum.pf / gp),
	};
};

const ratingsInfo = async (s: number) => {
	const players = await idb.cache.players.getAll();
	const active = players.filter((p) => p.tid >= 0);
	const ovrs = active.map((p) => last(p.ratings).ovr).sort((a, b) => b - a);
	const ages: Record<string, number[]> = {};
	const pos: Record<string, number> = {};
	for (const p of active) {
		const age = s - p.born.year;
		const bucket =
			age <= 22
				? "<=22"
				: age <= 26
					? "23-26"
					: age <= 30
						? "27-30"
						: age <= 34
							? "31-34"
							: "35+";
		(ages[bucket] ??= []).push(last(p.ratings).ovr);
		const ps = last(p.ratings).pos;
		pos[ps] = (pos[ps] ?? 0) + 1;
	}
	const rookies = players
		.filter((p) => p.draft.year === s && p.tid >= 0 && p.draft.round >= 1)
		.sort(
			(a, b) => a.draft.round - b.draft.round || a.draft.pick - b.draft.pick,
		);
	const rosterSizes = new Map<number, number>();
	for (const p of active) {
		rosterSizes.set(p.tid, (rosterSizes.get(p.tid) ?? 0) + 1);
	}
	const sizes = [...rosterSizes.values()];
	for (const p of active) {
		if (!getCurrentContract(p)) {
			problem("active without contract", `pid ${p.pid} tid ${p.tid}`);
		}
	}
	const contracts = active.map((p) =>
		getCurrentContract(p)
			? getNearestContractAmount(getCurrentContract(p)!, s)
			: 0,
	);
	const payrolls = [...rosterSizes.keys()].map((tid) =>
		active
			.filter((p) => p.tid === tid)
			.reduce(
				(a, p) =>
					a +
					(getCurrentContract(p)
						? getNearestContractAmount(getCurrentContract(p)!, s)
						: 0),
				0,
			),
	);
	const counts: Record<string, number> = {};
	for (const p of players) {
		const k =
			p.tid >= 0
				? "active"
				: p.tid === PLAYER.FREE_AGENT
					? "fa"
					: p.tid === PLAYER.UNDRAFTED
						? "undrafted"
						: String(p.tid);
		counts[k] = (counts[k] ?? 0) + 1;
	}
	const avgAge = mean(active.map((p) => s - p.born.year));
	return {
		ovrMean: r(mean(ovrs)),
		ovrTop10: r(mean(ovrs.slice(0, 10))),
		ovrTop1: ovrs[0],
		n60: ovrs.filter((x) => x >= 60).length,
		potMean: r(mean(active.map((p) => last(p.ratings).pot))),
		avgAge: r(avgAge),
		ageCurve: Object.fromEntries(
			Object.entries(ages)
				.sort()
				.map(([k, v]) => [k, `${r(mean(v))}/${v.length}`]),
		),
		pos,
		rookiesTop5Ovr: r(
			mean(rookies.slice(0, 5).map((p) => last(p.ratings).ovr)),
		),
		rookiesR1Ovr: r(
			mean(
				rookies
					.filter((p) => p.draft.round === 1)
					.map((p) => last(p.ratings).ovr),
			),
		),
		rookiesR1Pot: r(
			mean(
				rookies
					.filter((p) => p.draft.round === 1)
					.map((p) => last(p.ratings).pot),
			),
		),
		counts,
		rosterMin: Math.min(...sizes),
		rosterMax: Math.max(...sizes),
		salaryMean: r(mean(contracts)),
		payrollMean: r(mean(payrolls)),
		salaryCap: g.get("salaryCap"),
		maxContracts: contracts.filter((c) => c >= g.get("maxContract")).length,
		minContracts: contracts.filter((c) => c <= g.get("minContract")).length,
	};
};

const checkAwards = async (s: number) => {
	const awards = await idb.merged.awards.get(s);
	if (!awards) {
		problem("awards missing", String(s));
		return;
	}
	const players = await idb.merged.players.getAll({ activeSeason: s });
	const byPid = new Map(players.map((p) => [p.pid, p]));
	// A rookie: no pro games before this season (players can sit out seasons after the draft)
	const isRookie = (p: (typeof players)[number]) =>
		p.stats.every((row) => row.tid < 0 || row.season >= s || !row.gp) &&
		p.draft.year < s;
	const names: string[] = [];
	for (const award of awards.awards as any[]) {
		const gkey = `${award.shortName}|${JSON.stringify(award.group ?? null)}`;
		if (names.includes(gkey)) {
			problem("award twice", gkey);
		}
		names.push(gkey);
		if (award.numTeams === undefined) {
			const w = award.winner[0];
			// No most improved player in a new league's first season
			if (award.mip && s === g.get("startingSeason")) {
				continue;
			}
			if (!w || w.pid === undefined) {
				problem("award no winner", gkey);
				continue;
			}
			const pids = award.winner
				.map((x: any) => x.pid)
				.filter((x: any) => x !== undefined);
			if (new Set(pids).size !== pids.length) {
				problem("award candidates duplicate", gkey);
			}
			const p = byPid.get(w.pid);
			if (!p) {
				problem("award winner not active", `${gkey} pid ${w.pid}`);
				continue;
			}
			if (award.rookie && !isRookie(p)) {
				problem(
					"rookie award not a rookie",
					`${gkey} pid ${p.pid} draft ${p.draft.year}`,
				);
			}
			const statsRow = p.stats.filter(
				(r0) => r0.season === s && !r0.playoffs && r0.tid >= 0,
			);
			const gp = statsRow.reduce((acc, r0) => acc + (r0.gp ?? 0), 0);
			if (
				typeof award.statRange !== "number" &&
				gp < Math.min(20, g.get("numGames") / 2) &&
				award.statRange !== "playoffs"
			) {
				problem("award winner few games", `${gkey} pid ${p.pid} gp ${gp}`);
			}
		} else {
			const pids = award.winner
				.flat()
				.map((x: any) => x.pid)
				.filter((x: any) => x !== undefined);
			if (new Set(pids).size !== pids.length) {
				problem("team award duplicate", `${gkey} ${pids.length}`);
			}
			if (award.rookie) {
				for (const pid of pids) {
					const p = byPid.get(pid);
					if (p && !isRookie(p)) {
						problem(
							"rookie team not a rookie",
							`${gkey} pid ${pid} draft ${p.draft.year}`,
						);
					}
				}
			}
		}
	}
	// Players' own award lists: no duplicate award in a season
	for (const p of players) {
		const seen = new Set<string>();
		for (const aw of p.awards as any[]) {
			if (aw.season !== s) {
				continue;
			}
			const key =
				aw.type ??
				`${aw.shortName}|${aw.rank}|${JSON.stringify(aw.group ?? null)}`;
			if (seen.has(key)) {
				problem("player award duplicate", `pid ${p.pid} ${key}`);
			}
			seen.add(key);
		}
	}
};

// Single-game highs over every season played, regular season, from the box scores
const gameHighs: Record<string, number> = {};
const checkRecordsBook = async (s: number) => {
	if (!g.get("featureRecordsBook")) {
		return;
	}
	const games = (await idb.cache.games.getAll()).filter(
		(gm) => gm.season === s && gm.teams[0].tid >= 0,
	);
	for (const gm of games) {
		for (const t of gm.teams) {
			for (const p of t.players as any[]) {
				for (const k of ["pts", "ast", "stl", "blk", "tp"]) {
					const key = `${k}|${gm.playoffs ? 1 : 0}`;
					gameHighs[key] = Math.max(gameHighs[key] ?? 0, p[k] ?? 0);
				}
				const key = `trb|${gm.playoffs ? 1 : 0}`;
				gameHighs[key] = Math.max(
					gameHighs[key] ?? 0,
					(p.orb ?? 0) + (p.drb ?? 0),
				);
			}
		}
	}
	const book = await getRecordsBook({});
	const list = (id: string) =>
		book.flatMap((sec) => sec.lists).find((l) => l.id === id);
	for (const [key, v] of Object.entries(gameHighs)) {
		const [k, po] = key.split("|");
		const l = list(`game${po === "1" ? "po" : ""}:${k}`);
		if (!l) {
			continue;
		}
		const top = l.rows[0]?.v ?? 0;
		if (top !== v) {
			problem("records book game high", `${key} book ${top} box scores ${v}`);
		}
	}
	// Career and single season points from every player's stats rows
	const players = await idb.merged.players.getAll();
	let career = 0;
	let seasonMax = 0;
	for (const p of players) {
		let c = 0;
		const bySeason = new Map<number, number>();
		for (const row of p.stats) {
			if (row.playoffs || row.tid < 0) {
				continue;
			}
			c += row.pts ?? 0;
			bySeason.set(
				row.season,
				(bySeason.get(row.season) ?? 0) + (row.pts ?? 0),
			);
		}
		career = Math.max(career, c);
		seasonMax = Math.max(seasonMax, ...bySeason.values());
	}
	const topCareer = list("career:pts")?.rows[0]?.v;
	const topSeason = list("season:pts")?.rows[0]?.v;
	if (topCareer !== career) {
		problem("records book career pts", `book ${topCareer} stats ${career}`);
	}
	if (topSeason !== seasonMax) {
		problem("records book season pts", `book ${topSeason} stats ${seasonMax}`);
	}
};

const checkPlayoffs = async (s: number) => {
	const ps = await idb.merged.playoffSeries.get(s);
	if (!ps) {
		problem("no playoffSeries", String(s));
		return;
	}
	const games = (await idb.cache.games.getAll()).filter(
		(gm) => gm.season === s && gm.playoffs && gm.teams[0].tid >= 0,
	);
	const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
	const gamesByPair = new Map<string, number>();
	for (const gm of games) {
		const key = pairKey(gm.teams[0].tid, gm.teams[1].tid);
		gamesByPair.set(key, (gamesByPair.get(key) ?? 0) + 1);
	}
	let seriesGames = 0;
	const numRounds = ps.series.length;
	if (ps.currentRound !== numRounds - 1) {
		problem(
			"playoffs not finished",
			`currentRound ${ps.currentRound} rounds ${numRounds}`,
		);
	}
	for (const [round, seriesList] of ps.series.entries()) {
		const need = helpers.numGamesToWinRound(round, s);
		for (const series of seriesList) {
			if (!series.away) {
				continue;
			}
			const n = series.home.won + series.away.won;
			seriesGames += n;
			if (Math.max(series.home.won, series.away.won) !== need) {
				problem(
					"series not won",
					`round ${round} ${series.home.won}-${series.away.won} need ${need}`,
				);
			}
			if (Math.min(series.home.won, series.away.won) >= need) {
				problem("series both won", `round ${round}`);
			}
			const key = pairKey(series.home.tid, series.away.tid);
			if ((gamesByPair.get(key) ?? 0) < n) {
				problem(
					"series box scores",
					`round ${round} ${key} ${gamesByPair.get(key)} vs ${n}`,
				);
			}
		}
	}
	let playInGames = 0;
	for (const playIn of ps.playIns ?? []) {
		for (const m of playIn) {
			if ((m as any).home && (m as any).away) {
				playInGames += 1;
			}
		}
	}
	if (games.length !== seriesGames + playInGames) {
		problem(
			"playoff games count",
			`${games.length} box scores, ${seriesGames} series games, ${playInGames} play-in`,
		);
	}
	// Champion: playoffRoundsWon
	const teamSeasons = (await idb.cache.teamSeasons.getAll()).filter(
		(ts) => ts.season === s,
	);
	const champs = teamSeasons.filter((ts) => ts.playoffRoundsWon === numRounds);
	if (champs.length !== 1) {
		problem("champions", `${champs.length}`);
	}
};

const dbSize = async () => {
	const out: Record<string, number> = {};
	let total = 0;
	const db = idb.league as any;
	for (const store of db.objectStoreNames as any as string[]) {
		const all = await db.getAll(store);
		const mb = JSON.stringify(all).length / 1e6;
		out[store] = r(mb, 2);
		total += mb;
	}
	return { total: r(total, 1), stores: out };
};

const settingsFor = (config: string) => {
	const settings: any = getDefaultSettings();
	settings.spectator = true;
	const rand = makeSeededRandom(SEED * 7919 + 13);
	const enabledKeys: string[] = [];
	for (const f of NATIVE_FEATURES as readonly any[]) {
		if (f.sports && !f.sports.includes("basketball")) {
			continue;
		}
		// College features need college mode
		if (f.key.startsWith("college")) {
			continue;
		}
		if (config === "all") {
			settings[f.key] = true;
			for (const o of f.options ?? []) {
				if (typeof o.default === "boolean") {
					settings[o.key] = true;
				}
			}
		} else if (config === "off") {
			// Mostly off: the sim extras off, a few non-sim ones on
			settings[f.key] = [
				"realisticTurnovers",
				"coachingStaff",
				"featureNewspaper",
			].includes(f.key);
		} else if (config === "random") {
			settings[f.key] = rand() < 0.5;
		}
		if (settings[f.key] === true) {
			enabledKeys.push(f.key);
		}
	}
	// LONG_RUN_RANDOM_GAME=1: random game rules too (short season)
	if (env.LONG_RUN_RANDOM_GAME) {
		const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
		const extra: Record<string, unknown> = {
			numGames: pick([20, 30, 40]),
			quarterLength: pick([12, 12, 10, 8, 15, 5]),
			numPeriods: pick([4, 4, 4, 2, 3, 1]),
			overtimeLength: pick([5, 5, 3, 10]),
			elam: rand() < 0.25,
			elamASG: rand() < 0.5,
			elamMinutes: pick([4, 2, 6]),
			elamPoints: pick([8, 5, 12]),
			elamOvertime: rand() < 0.3,
			foulsNeededToFoulOut: pick([6, 6, 5, 4, 2]),
			threePointers: rand() < 0.85,
			numGamesPlayoffSeries: pick([
				[7, 7, 7, 7],
				[5, 5, 7, 7],
				[1, 1, 1, 1],
				[3, 5, 7, 7],
			]),
			playIn: rand() < 0.6,
			allStarGame: pick([0.7, 0.5, -1, null]),
			maxOvertimes: pick([null, null, 1, 0]),
			shootoutRounds: pick([0, 0, 3]),
			customShotClock: rand() < 0.3,
			shotClockLength: pick([24, 14, 30, 35, 20]),
			oneAndOne: rand() < 0.2,
			threePointTendencyFactor: pick([1, 1, 0.5, 2]),
			numPlayersOnCourt: pick([5, 5, 5, 5, 4, 3]),
		};
		Object.assign(settings, extra);
		out(`RANDOM GAME ${JSON.stringify(extra)}`);
	}
	if (env.LONG_RUN_SETTINGS) {
		Object.assign(settings, JSON.parse(env.LONG_RUN_SETTINGS));
	}
	return { settings, enabledKeys };
};

describe.skipIf(!ENABLED)("long run", () => {
	test("seasons", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(SEED);
		const { settings, enabledKeys } = settingsFor(CONFIG);
		out(`CONFIG ${CONFIG} seed ${SEED} on: ${enabledKeys.join(",")}`);
		await league.createStream(
			{},
			{
				confs: last(defaultGameAttributes.confs).value,
				divs: last(defaultGameAttributes.divs).value,
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
				lid: 0,
				name: `longrun${SEED}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		for (let i = 0; i < SEASONS; i++) {
			const calib = calibrate().ms;
			const ts = performance.now();
			const cs = cpuMs();
			const s = g.get("season");
			const preseason = await ratingsInfo(s);
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			// LONG_RUN_FORCEWIN=1: God Mode forced results (the away team) for the first 40 games of the season
			const forced = new Map<number, number>();
			if (env.LONG_RUN_FORCEWIN) {
				await league.setGameAttributes({ godMode: true });
				const sched = (await idb.cache.schedule.getAll())
					.filter((gm) => gm.homeTid >= 0)
					.slice(0, 40);
				for (const gm of sched) {
					gm.forceWin = gm.awayTid;
					forced.set(gm.gid, gm.awayTid);
					await idb.cache.schedule.put(gm);
				}
			}
			let guard = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
				g.get("phase") === PHASE.PLAYOFFS
			) {
				const numDays =
					g.get("phase") === PHASE.PLAYOFFS
						? 100
						: await season.getDaysLeftSchedule();
				await game.play(numDays, {});
				if (++guard > 50) {
					throw new Error("stuck in season");
				}
			}
			const simCpu = cpuMs() - cs;
			for (const [gid, tid] of forced) {
				const gm = await idb.cache.games.get(gid);
				if (!gm) {
					problem("forced game missing", String(gid));
				} else if (gm.won.tid !== tid) {
					problem(
						"forced game lost",
						`gid ${gid} won by ${gm.won.tid} not ${tid}`,
					);
				}
			}
			const steps: Record<string, number> = {};
			const timed = async <T>(name: string, f: () => Promise<T>) => {
				const c0 = cpuMs();
				try {
					return await f();
				} finally {
					steps[name] = r((steps[name] ?? 0) + (cpuMs() - c0) / 1000, 2);
				}
			};
			const box = await timed("checks", () => checkBoxScores(s));
			const avgs = await timed("checks", () => leagueAverages(s));
			await timed("checks", () => checkAwards(s));
			await timed("checks", () => checkRecordsBook(s));
			await timed("checks", () => checkPlayoffs(s));
			let archetypes: Record<string, number> | undefined;
			try {
				const land = await timed("checks", () => archetypesApi.landscape());
				if (land.enabled) {
					archetypes = Object.fromEntries(
						Object.entries(land.byGroup as any).map(([k, v]: any) => [
							k,
							typeof v === "number" ? v : v.count,
						]),
					);
				}
			} catch (error) {
				problem("archetypes landscape", (error as Error).message);
			}
			// LONG_RUN_PROF=prefix: CPU profile of the offseason of the last season
			let session: any;
			if (env.LONG_RUN_PROF && i === SEASONS - 1) {
				const { Session } = await import(
					/* @vite-ignore */ "node:inspector/promises" as string
				);
				session = new Session();
				session.connect();
				await session.post("Profiler.enable");
				await session.post("Profiler.setSamplingInterval", { interval: 500 });
				await session.post("Profiler.start");
			}
			await timed("draft", () => phase.newPhase(PHASE.DRAFT, {}));
			await timed("draft", () => draft.runPicks({ type: "untilEnd" }, {}));
			await timed("resign", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			await timed("freeAgency", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			let faDays = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await timed("freeAgencyDays+preseason", () => freeAgents.play(30, {}));
				if (++faDays > 10) {
					throw new Error("stuck in free agency");
				}
			}
			if (session) {
				const result = await session.post("Profiler.stop");
				const { writeFileSync } = await import(
					/* @vite-ignore */ "node:fs" as string
				);
				writeFileSync(
					`${env.LONG_RUN_PROF}.cpuprofile`,
					JSON.stringify(result.profile),
				);
				session.disconnect();
			}
			const offseasonCpu = cpuMs() - cs - simCpu;
			const afterDraft = await ratingsInfo(s);
			await idb.cache.flush();
			(globalThis as any).gc?.();
			const size = await dbSize();
			out(
				JSON.stringify({
					season: s,
					i: i + 1,
					simCpuS: r(simCpu / 1000),
					offseasonCpuS: r(offseasonCpu / 1000),
					steps,
					calibMs: Math.round(calib),
					simNorm: r(simCpu / calib, 0),
					totalS: r((performance.now() - ts) / 1000),
					heapMB: Math.round(
						(globalThis as any).process.memoryUsage().heapUsed / 1e6,
					),
					dbMB: size.total,
					cacheMB: Object.fromEntries(
						Object.entries((idb.cache as any)._data)
							.map(([store, rows]) => [
								store,
								r(
									JSON.stringify(Object.values(rows as object)).length / 1e6,
									1,
								),
							])
							.filter(([, mb]) => (mb as number) >= 0.5),
					),
					stores: size.stores,
					...box,
					...avgs,
					ratings: preseason,
					rookies: {
						top5: afterDraft.rookiesTop5Ovr,
						r1Ovr: afterDraft.rookiesR1Ovr,
						r1Pot: afterDraft.rookiesR1Pot,
					},
					archetypes,
				}),
			);
		}
		out(
			`DONE problems ${problemCount}: ${JSON.stringify(Object.fromEntries(problemSeen))}`,
		);
	});
});
