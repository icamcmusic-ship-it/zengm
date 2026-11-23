// @ts-nocheck (diagnostic script)
// Breakout nights (role player variance): plays regular seasons of a new random league (new-league defaults plus the 2026 preset) and
// prints, from the box scores, per season: the 20+, 25+ and 30+ point games by non-starters (gs = 0), by players outside their team's
// top 3 in usage (season FGA + 0.44 FTA + TOV per game, players with 10+ games for the team) and outside its top 3 scorers (PPG); the
// game-to-game points SD (and SD / mean) of stars (top 3 in usage) and role players (the rest, 40+ games at 15+ MPG); league totals per
// team-game; the scoring leader and the 25+ PPG count (40+ games); and the minutes distribution (MPG by minutes rank in each team-game,
// 40+ minute games, the minutes of bench players' 20+ point games). BREAKOUT_OUT writes one JSON line per season (to pool several seeds).
//   BREAKOUT=1 [BREAKOUT_SEED=1] [BREAKOUT_SEASONS=2] [BREAKOUT_SETTINGS='{}'] [BREAKOUT_OUT=/tmp/x.jsonl]
//   npx vitest run --project basketball --silent=false <this file>
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import { FLOW_DIAG } from "./gameFlow.ts";

const env = (globalThis as any).process.env;

const mean = (xs: number[]) =>
	xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (xs: number[], q: number) => {
	const s = xs.toSorted((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// One season's regular season games → its summary
const summarize = (games, season) => {
	// Per team, per player: his games
	const byTeamPlayer = new Map();
	const tot = {
		g: 0,
		pts: 0,
		fga: 0,
		fg: 0,
		tpa: 0,
		tp: 0,
		ast: 0,
		tov: 0,
	};
	const minRank = new Array(13).fill(0);
	let teamGames = 0;
	let min40 = 0;
	for (const gm of games) {
		for (const t of gm.teams) {
			teamGames += 1;
			tot.g += 1;
			const mins = [];
			for (const p of t.players) {
				if (p.min <= 0) {
					continue;
				}
				mins.push(p.min);
				tot.pts += p.pts;
				tot.fga += p.fga;
				tot.fg += p.fg;
				tot.tpa += p.tpa;
				tot.tp += p.tp;
				tot.ast += p.ast;
				tot.tov += p.tov;
				if (p.min >= 40) {
					min40 += 1;
				}
				const key = `${t.tid}:${p.pid}`;
				let row = byTeamPlayer.get(key);
				if (!row) {
					row = { tid: t.tid, pid: p.pid, games: [] };
					byTeamPlayer.set(key, row);
				}
				row.games.push({
					pts: p.pts,
					min: p.min,
					gs: p.gs,
					use: p.fga + 0.44 * p.fta + p.tov,
				});
			}
			mins.sort((a, b) => b - a);
			for (let i = 0; i < minRank.length; i++) {
				minRank[i] += mins[i] ?? 0;
			}
		}
	}
	// Ranks on each team (10+ games)
	const teams = new Map();
	for (const row of byTeamPlayer.values()) {
		row.gp = row.games.length;
		row.ppg = mean(row.games.map((x) => x.pts));
		row.upg = mean(row.games.map((x) => x.use));
		row.mpg = mean(row.games.map((x) => x.min));
		if (!teams.has(row.tid)) {
			teams.set(row.tid, []);
		}
		teams.get(row.tid).push(row);
	}
	for (const rows of teams.values()) {
		const elig = rows.filter((r) => r.gp >= 10);
		const byUse = elig.toSorted((a, b) => b.upg - a.upg);
		const byPts = elig.toSorted((a, b) => b.ppg - a.ppg);
		for (const r of rows) {
			const iu = byUse.indexOf(r);
			const ip = byPts.indexOf(r);
			r.top3Use = iu >= 0 && iu < 3;
			r.top3Pts = ip >= 0 && ip < 3;
		}
	}
	const counts = { bench: [0, 0, 0], role: [0, 0, 0], nonTop3Pts: [0, 0, 0] };
	const benchBigMin = [];
	const th = [20, 25, 30];
	for (const row of byTeamPlayer.values()) {
		for (const x of row.games) {
			for (let i = 0; i < 3; i++) {
				if (x.pts >= th[i]) {
					if (!x.gs) {
						counts.bench[i] += 1;
					}
					if (!row.top3Use) {
						counts.role[i] += 1;
					}
					if (!row.top3Pts) {
						counts.nonTop3Pts[i] += 1;
					}
				}
			}
			if (!x.gs && x.pts >= 20) {
				benchBigMin.push(x.min);
			}
		}
	}
	const regs = [...byTeamPlayer.values()].filter(
		(r) => r.gp >= 40 && r.mpg >= 15,
	);
	const sdOf = (r) => sd(r.games.map((x) => x.pts));
	const stars = regs.filter((r) => r.top3Use);
	const role = regs.filter((r) => !r.top3Use);
	const sdSummary = (rs) => {
		const sds = rs.map(sdOf);
		const cvs = rs.map((r) => sdOf(r) / Math.max(1, r.ppg));
		return {
			n: rs.length,
			ppg: mean(rs.map((r) => r.ppg)),
			sd: mean(sds),
			sdP10: pct(sds, 0.1),
			sdP50: pct(sds, 0.5),
			sdP90: pct(sds, 0.9),
			cv: mean(cvs),
			max: mean(rs.map((r) => Math.max(...r.games.map((x) => x.pts)))),
		};
	};
	// Per player season (all teams together) for the scoring leaders
	const byPid = new Map();
	for (const row of byTeamPlayer.values()) {
		const cur = byPid.get(row.pid) ?? { pts: 0, gp: 0 };
		cur.pts += row.games.reduce((a, x) => a + x.pts, 0);
		cur.gp += row.gp;
		byPid.set(row.pid, cur);
	}
	const ppgs = [...byPid.values()]
		.filter((x) => x.gp >= 40)
		.map((x) => x.pts / x.gp)
		.toSorted((a, b) => b - a);
	return {
		season,
		games: games.length,
		counts,
		sdStars: sdSummary(stars),
		sdRole: sdSummary(role),
		league: {
			pts: tot.pts / tot.g,
			fgp: tot.fg / tot.fga,
			tpp: tot.tp / tot.tpa,
			ast: tot.ast / tot.g,
			tov: tot.tov / tot.g,
		},
		leaderPpg: ppgs[0],
		ppg25: ppgs.filter((x) => x >= 25).length,
		minRank: minRank.map((m) => m / teamGames),
		min40PerTeamGame: min40 / teamGames,
		benchBigMin: mean(benchBigMin),
	};
};

const f = (x, d = 2) => (typeof x === "number" ? x.toFixed(d) : String(x));

const fmt = (s) =>
	[
		`SEASON ${s.season} (${s.games} games)`,
		`  20/25/30+ pts games: non-starters ${s.counts.bench.join("/")} | outside top 3 usage ${s.counts.role.join("/")} | outside top 3 scorers ${s.counts.nonTop3Pts.join("/")}`,
		`  pts SD stars n ${s.sdStars.n} ppg ${f(s.sdStars.ppg)} SD ${f(s.sdStars.sd)} (p10/50/90 ${f(s.sdStars.sdP10)}/${f(s.sdStars.sdP50)}/${f(s.sdStars.sdP90)}) CV ${f(s.sdStars.cv, 3)} max ${f(s.sdStars.max, 1)}`,
		`  pts SD role  n ${s.sdRole.n} ppg ${f(s.sdRole.ppg)} SD ${f(s.sdRole.sd)} (p10/50/90 ${f(s.sdRole.sdP10)}/${f(s.sdRole.sdP50)}/${f(s.sdRole.sdP90)}) CV ${f(s.sdRole.cv, 3)} max ${f(s.sdRole.max, 1)}`,
		`  league pts ${f(s.league.pts)} FG% ${f(s.league.fgp, 3)} 3P% ${f(s.league.tpp, 3)} AST ${f(s.league.ast)} TOV ${f(s.league.tov)}`,
		`  scoring leader ${f(s.leaderPpg, 1)} PPG, 25+ PPG ${s.ppg25}`,
		`  MPG by minutes rank ${s.minRank.map((m) => f(m, 1)).join("/")} | 40+ min per team-game ${f(s.min40PerTeamGame, 3)} | bench 20+ pt games avg min ${f(s.benchBigMin, 1)}`,
	].join("\n");

test.skipIf(!env.BREAKOUT)(
	"breakout nights",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.BREAKOUT_SEED ?? 1);
		const numSeasons = Number(env.BREAKOUT_SEASONS ?? 2);
		const extra = JSON.parse(env.BREAKOUT_SETTINGS ?? "{}");
		const out = env.BREAKOUT_OUT;
		Math.random = makeSeededRandom(seed);
		FLOW_DIAG.on = true;
		const settings: any = {
			...getDefaultSettings(),
			...gameSimPresets[2026],
			spectator: true,
			...extra,
		};
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
				name: `breakout${seed}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		const seen = new Set();
		for (let i = 0; i < numSeasons; i++) {
			const s = g.get("season");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
			let guard = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE
			) {
				await game.play(await season.getDaysLeftSchedule(), {});
				if (++guard > 50) {
					throw new Error("stuck");
				}
			}
			const games = [];
			for (const gm of await idb.cache.games.getAll()) {
				if (seen.has(gm.gid) || gm.playoffs || gm.season !== s) {
					continue;
				}
				seen.add(gm.gid);
				games.push(gm);
			}
			const summary = summarize(games, s);
			console.log(fmt(summary));
			if (out) {
				appendFileSync(out, `${JSON.stringify({ seed, ...summary })}\n`);
			}
			if (i === numSeasons - 1) {
				break;
			}
			guard = 0;
			while (g.get("phase") === PHASE.PLAYOFFS) {
				await game.play(100, {});
				if (++guard > 50) {
					throw new Error("stuck in playoffs");
				}
			}
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			guard = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await freeAgents.play(30, {});
				if (++guard > 10) {
					throw new Error("stuck in free agency");
				}
			}
		}
		const flow = Object.fromEntries(
			Object.entries(FLOW_DIAG.counts).filter(([k]) =>
				/^(adjHot|adjCold|brk)/.test(k),
			),
		);
		const means = Object.fromEntries(
			Object.entries(FLOW_DIAG.sums)
				.filter(([k]) => k.startsWith("brk"))
				.map(([k, v]) => [
					k,
					Number((v / FLOW_DIAG.counts[`n:${k}`]).toFixed(4)),
				]),
		);
		console.log(`FLOW ${JSON.stringify(flow)} means ${JSON.stringify(means)}`);
	},
);
