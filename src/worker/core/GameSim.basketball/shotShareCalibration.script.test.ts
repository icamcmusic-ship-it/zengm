// @ts-nocheck (calibration script)
// Shot Share Model calibration (docs/native-features.md, Shot Share Model): plays whole seasons of a new random league (the new-league
// defaults, every core feature on) and checks the shape of the shot shares against NBA-like targets:
//   - each team's top usage player takes ~28-33% of his team's FGA while he is on the court (and the same in usage rate),
//   - ~8-15 players league-wide average 20+ FGA per game,
//   - the 5th starter (the starter with the smallest share) takes ~14-17%,
//   - nobody is above ~37% usage over a season,
// plus the league totals that must not move (points, FG%, 3PA rate, turnovers, free throw attempts per team game).
// Skipped unless SHOT_SHARE_CAL is set (about 25 s per season):
//
//   SHOT_SHARE_CAL=1 [SHOT_SHARE_SEED=1] [SHOT_SHARE_SEASONS=3] [SHOT_SHARE_OUT=/tmp/x.jsonl] [SHOT_SHARE_SETTINGS='{"shotShareModel":false}']
//     node_modules/.bin/vitest run --project basketball --dir src src/worker/core/GameSim.basketball/shotShareCalibration.script.test.ts
//
// SHOT_SHARE_CAL=measure only prints the numbers (no assertions).
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { shotDiet, sumAdv } from "../../../common/advStats.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last, range } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { SHOT_SHARE } from "./shotShare.ts";

const env = (globalThis as any).process.env;
// SHOT_SHARE_CONST='{"power":1.7}' changes the constants in shotShare.ts (for tuning)
if (env.SHOT_SHARE_CONST) {
	Object.assign(SHOT_SHARE, JSON.parse(env.SHOT_SHARE_CONST));
}

// The targets (NBA-like), with the tolerance the assertions allow around them
export const SHOT_SHARE_TARGETS = {
	// Mean over teams of the top usage player's on-court FGA share
	topShare: [0.27, 0.34],
	// Players averaging 20+ FGA per game (at least 40 games), per season
	fga20: [4, 16],
	// Mean over teams of the 5th starter's on-court FGA share
	fifthStarter: [0.135, 0.175],
	// Highest usage rate in the league (1000+ minutes)
	maxUsage: 37.5,
	// League totals per team game
	pts: [104, 118],
	fgp: [0.445, 0.49],
	tpaRate: [0.3, 0.42],
	tov: [12.5, 16],
	fta: [19, 25.5],
};

const mean = (xs: number[]) =>
	xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

// One regular season's shot share shape, from the stored player and team stats
export const seasonShotShares = (
	rows: {
		tid: number;
		gp: number;
		gs: number;
		min: number;
		fga: number;
		fta: number;
		tov: number;
	}[],
) => {
	const byTid = new Map<number, typeof rows>();
	for (const row of rows) {
		let list = byTid.get(row.tid);
		if (!list) {
			list = [];
			byTid.set(row.tid, list);
		}
		list.push(row);
	}
	const tops: number[] = [];
	const topUsg: number[] = [];
	const fifths: number[] = [];
	const firstStarters: number[] = [];
	let maxUsg = 0;
	let maxShare = 0;
	let fga20 = 0;
	const allUsg: number[] = [];
	// FGA per game, minutes per game and on-court share of the top FGA per game (40+ games)
	const leaders: number[][] = [];
	for (const list of byTid.values()) {
		let tMin = 0;
		let tFga = 0;
		let tFta = 0;
		let tTov = 0;
		for (const r of list) {
			tMin += r.min;
			tFga += r.fga;
			tFta += r.fta;
			tTov += r.tov;
		}
		if (tMin <= 0 || tFga <= 0) {
			continue;
		}
		// On-court share of the team's FGA, and usage rate (Basketball Reference's formula)
		const share = (r: (typeof rows)[number]) =>
			r.min > 0 ? (r.fga / r.min) * (tMin / 5 / tFga) : 0;
		const usg = (r: (typeof rows)[number]) =>
			r.min > 0
				? (100 * (r.fga + 0.44 * r.fta + r.tov) * (tMin / 5)) /
					(r.min * (tFga + 0.44 * tFta + tTov))
				: 0;
		const regulars = list.filter((r) => r.min >= 1000);
		if (regulars.length > 0) {
			const sorted = regulars.toSorted((a, b) => share(b) - share(a));
			tops.push(share(sorted[0]));
			topUsg.push(Math.max(...regulars.map(usg)));
			for (const r of regulars) {
				const u = usg(r);
				allUsg.push(u);
				maxUsg = Math.max(maxUsg, u);
				maxShare = Math.max(maxShare, share(r));
			}
		}
		const starters = list
			.filter((r) => r.gp > 0)
			.toSorted((a, b) => b.gs - a.gs || b.min - a.min)
			.slice(0, 5);
		if (starters.length === 5) {
			const s = starters.map(share).toSorted((a, b) => a - b);
			fifths.push(s[0]);
			firstStarters.push(s[4]);
		}
		for (const r of list) {
			if (r.gp >= 40 && r.fga / r.gp >= 20) {
				fga20 += 1;
			}
			if (r.gp >= 40) {
				leaders.push([
					Number((r.fga / r.gp).toFixed(1)),
					Number((r.min / r.gp).toFixed(1)),
					Number(share(r).toFixed(3)),
				]);
			}
		}
	}
	leaders.sort((a, b) => b[0] - a[0]);
	return {
		teams: tops.length,
		topShare: mean(tops),
		topShareMin: Math.min(...tops),
		topShareMax: Math.max(...tops),
		topUsg: mean(topUsg),
		fifthStarter: mean(fifths),
		firstStarter: mean(firstStarters),
		fga20,
		maxUsg,
		maxShare,
		over32: allUsg.filter((u) => u > 32).length,
		leaders: leaders.slice(0, 12),
	};
};

test.skipIf(!env.SHOT_SHARE_CAL)(
	"shot share calibration",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.SHOT_SHARE_SEED ?? 1);
		const numSeasons = Number(env.SHOT_SHARE_SEASONS ?? 3);
		const extra = JSON.parse(env.SHOT_SHARE_SETTINGS ?? "{}");
		const measureOnly = env.SHOT_SHARE_CAL === "measure";
		Math.random = makeSeededRandom(seed);
		const settings: any = {
			...getDefaultSettings(),
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
				name: `shotShare${seed}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		if (env.SHOT_SHARE_DUMP) {
			const { default: loadTeams } = await import("../game/loadTeams.ts");
			const teams = await loadTeams(range(g.get("numActiveTeams")), {});
			const q = (key: string) => {
				const rows = [];
				for (const t of Object.values(teams)) {
					const sorted = t.player
						.filter((p) => !p.injured)
						.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
						.slice(0, 8);
					rows.push(sorted.map((p) => p.compositeRating[key]));
				}
				// by roster rank: mean, min, max
				return range(8).map((i) => {
					const xs = rows.map((r) => r[i]).filter((x) => x !== undefined);
					return [mean(xs), Math.min(...xs), Math.max(...xs)].map((x) =>
						Number(x.toFixed(3)),
					);
				});
			};
			for (const key of [
				"usage",
				"creation",
				"spacingThreat",
				"defensePerimeter",
				"defenseInterior",
			]) {
				(globalThis as any).process.stdout.write(
					`\nDUMP ${key} ${JSON.stringify(q(key))}`,
				);
			}
			const all = [];
			for (const t of Object.values(teams)) {
				for (const p of t.player
					.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
					.slice(0, 10)) {
					all.push(p.compositeRating.usage);
				}
			}
			all.sort((a, b) => a - b);
			console.log(
				`DUMP usageQuantiles ${JSON.stringify([0.05, 0.25, 0.5, 0.75, 0.9, 0.97, 1].map((f) => all[Math.min(all.length - 1, Math.floor(f * all.length))].toFixed(3)))}`,
			);
			return;
		}

		const results = [];
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

			const rows = [];
			for (const p of await idb.cache.players.getAll()) {
				for (const row of p.stats) {
					if (row.season === s && !row.playoffs && row.tid >= 0) {
						rows.push(row);
					}
				}
			}
			const shares = seasonShotShares(rows);
			// The league's shot diet: each source's share of the shots, and the modifiers' average effects
			const diet = shotDiet(sumAdv(rows));
			const dietOut = diet
				? Object.fromEntries([
						...diet.sources.map((x) => [x.key, Number(x.pct.toFixed(4))]),
						...diet.modifiers.map((x) => [x.key, Number(x.mult.toFixed(4))]),
					])
				: {};
			const teamStats = (await idb.cache.teamStats.getAll()).filter(
				(ts) => ts.season === s && !ts.playoffs,
			);
			let gp = 0;
			const sum = { pts: 0, fga: 0, fg: 0, tpa: 0, tov: 0, fta: 0 };
			for (const ts of teamStats) {
				gp += ts.gp;
				for (const key of Object.keys(sum)) {
					sum[key] += ts[key];
				}
			}
			const totals = {
				pts: sum.pts / gp,
				fgp: sum.fg / sum.fga,
				tpaRate: sum.tpa / sum.fga,
				tov: sum.tov / gp,
				fta: sum.fta / gp,
			};
			const result = { seed, season: s, ...shares, ...totals, diet: dietOut };
			results.push(result);
			console.log(`SHOT_SHARE ${JSON.stringify(result)}`);
			if (env.SHOT_SHARE_OUT) {
				appendFileSync(env.SHOT_SHARE_OUT, `${JSON.stringify(result)}\n`);
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

		if (measureOnly) {
			return;
		}
		const T = SHOT_SHARE_TARGETS;
		const avg = (key: string) => mean(results.map((r) => r[key]));
		const inRange = (key: string, [lo, hi]: number[]) => {
			const v = avg(key);
			assert.isAtLeast(v, lo, `${key} ${v}`);
			assert.isAtMost(v, hi, `${key} ${v}`);
		};
		inRange("topShare", T.topShare);
		inRange("fga20", T.fga20);
		inRange("fifthStarter", T.fifthStarter);
		for (const r of results) {
			assert.isAtMost(r.maxUsg, T.maxUsage, `maxUsg ${r.season}`);
		}
		inRange("pts", T.pts);
		inRange("fgp", T.fgp);
		inRange("tpaRate", T.tpaRate);
		inRange("tov", T.tov);
		inRange("fta", T.fta);
	},
);
