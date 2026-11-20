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
// SHOT_SHARE_DIAG=1 [SHOT_SHARE_DIAG_OUT=/tmp/d.jsonl] also writes the league's drift diagnostics every season: rating means of the
// rostered players (all and minutes weighted) and by age, the sim's composites of each team's top 8, age, rookies and retirees, injuries,
// the league's preseason development vs a new league's generator's, box totals (with the Settings preview's definitions), the style
// settings in effect and the winners' edges League Eras reads. SHOT_SHARE_PREVIEW=150 also plays that many preview games (the era
// calibration's games: full rosters, no injuries) at the start of each season. Leagues made by tests have league salt 0, so League Eras
// draws the same walk for every seed: pass {"featureLeagueEras":false} in SHOT_SHARE_SETTINGS to measure anything else.
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

// Star scoring: the PPG leader, players at 30/25/20+ PPG (58+ games... 40+ here), the top-10 scorers' MPG and FTA per game, and the mean
// over teams of the top scorer's share of his team's points
export const seasonStars = (
	rows: {
		tid: number;
		gp: number;
		min: number;
		pts: number;
		fta: number;
		fga: number;
	}[],
) => {
	const qual = rows.filter((r) => r.gp >= 40);
	const ppg = (r: (typeof rows)[number]) => r.pts / r.gp;
	const sorted = qual.toSorted((a, b) => ppg(b) - ppg(a));
	const top10 = sorted.slice(0, 10);
	const teamPts = new Map<number, number>();
	const teamTop = new Map<number, number>();
	for (const r of rows) {
		teamPts.set(r.tid, (teamPts.get(r.tid) ?? 0) + r.pts);
		teamTop.set(r.tid, Math.max(teamTop.get(r.tid) ?? 0, r.pts));
	}
	const topShares = [...teamPts.keys()].map(
		(tid) => teamTop.get(tid)! / teamPts.get(tid)!,
	);
	const r1 = (x: number) => Number(x.toFixed(1));
	const ts = (rs: typeof rows) => {
		let pts = 0;
		let tsa = 0;
		for (const r of rs) {
			pts += r.pts;
			tsa += 2 * (r.fga + 0.44 * r.fta);
		}
		return tsa > 0 ? pts / tsa : 0;
	};
	return {
		ppgLeader: r1(ppg(sorted[0])),
		ppg30: qual.filter((r) => ppg(r) >= 30).length,
		ppg25: qual.filter((r) => ppg(r) >= 25).length,
		ppg20: qual.filter((r) => ppg(r) >= 20).length,
		top10Ppg: r1(mean(top10.map(ppg))),
		top10Mpg: r1(mean(top10.map((r) => r.min / r.gp))),
		top10Fta: r1(mean(top10.map((r) => r.fta / r.gp))),
		top10Fga: r1(mean(top10.map((r) => r.fga / r.gp))),
		teamTopPtsShare: Number(mean(topShares).toFixed(3)),
		// True shooting of the top 10 scorers minus the league's
		top10TsGap: Number((ts(top10) - ts(rows)).toFixed(3)),
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
			// The sim's composite ratings (mean over each team's top 8 by value) at the start of the season, for SHOT_SHARE_DIAG
			let compositeSnapshot;
			// Ratings at the start of the regular season, for the in-season changes (injuries)
			const startRows = new Map();
			for (const p of await idb.cache.players.getAll()) {
				if (p.tid >= 0) {
					startRows.set(p.pid, { ...p.ratings.at(-1) });
				}
			}
			// Rostered players already injured when the regular season starts, and their games remaining
			const injuredAtStart = { players: 0, games: 0, ovr: 0 };
			for (const p of await idb.cache.players.getAll()) {
				if (p.tid >= 0 && p.injury.gamesRemaining > 0) {
					injuredAtStart.players += 1;
					injuredAtStart.games += p.injury.gamesRemaining;
					injuredAtStart.ovr += p.ratings.at(-1).ovr;
				}
			}
			if (injuredAtStart.players > 0) {
				injuredAtStart.ovr = Number(
					(injuredAtStart.ovr / injuredAtStart.players).toFixed(1),
				);
			}
			if (env.SHOT_SHARE_DIAG) {
				const { default: loadTeams } = await import("../game/loadTeams.ts");
				const teams = await loadTeams(range(g.get("numActiveTeams")), {});
				const acc = {};
				let n = 0;
				for (const t of Object.values(teams)) {
					for (const p of t.player
						.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
						.slice(0, 8)) {
						n += 1;
						for (const [k, v] of Object.entries(p.compositeRating)) {
							if (typeof v === "number") {
								acc[k] = (acc[k] ?? 0) + v;
							}
						}
					}
				}
				compositeSnapshot = Object.fromEntries(
					Object.entries(acc).map(([k, v]) => [k, Number((v / n).toFixed(4))]),
				);
			}
			// SHOT_SHARE_PREVIEW=n: also play n preview games (Settings preview / era calibration: full rosters, no injuries, no schedule)
			// at the start of the season, to compare with the season's own totals
			let previewStats;
			if (env.SHOT_SHARE_PREVIEW) {
				const { loadMatchups, runPreviewGames } =
					await import("../game/previewGameSim.ts");
				const tids = range(g.get("numActiveTeams"));
				const pairs = [];
				for (let k = 0; pairs.length < Number(env.SHOT_SHARE_PREVIEW); k++) {
					const a = tids[k % tids.length];
					const b =
						tids[(k * 7 + 1 + Math.floor(k / tids.length)) % tids.length];
					if (a !== b) {
						pairs.push(k % 2 === 0 ? [a, b] : [b, a]);
					}
				}
				previewStats = runPreviewGames(
					await loadMatchups(pairs, {}),
					{},
					5000 + seed,
				);
				console.log(`PREVIEW ${s} ${JSON.stringify(previewStats)}`);
			}
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
			const stars = seasonStars(rows);
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
			const result = {
				seed,
				season: s,
				...shares,
				...stars,
				...totals,
				diet: dietOut,
			};
			results.push(result);
			console.log(`SHOT_SHARE ${JSON.stringify(result)}`);
			if (env.SHOT_SHARE_OUT) {
				appendFileSync(env.SHOT_SHARE_OUT, `${JSON.stringify(result)}\n`);
			}

			if (env.SHOT_SHARE_DIAG) {
				// League drift diagnostics: rating means of rostered players (all, and minutes weighted), age, this season's rookies and
				// the players who retired after the previous season, the sim's composite ratings of each team's top 8 at the start of the
				// season, box totals, and the style settings in effect
				const players = await idb.cache.players.getAll();
				const minBy = new Map<number, number>();
				for (const p of players) {
					for (const row of p.stats) {
						if (row.season === s && !row.playoffs && row.tid >= 0) {
							minBy.set(p.pid, (minBy.get(p.pid) ?? 0) + row.min);
						}
					}
				}
				const r2 = (x: number) => Number(x.toFixed(2));
				const ratingRows = [];
				for (const p of players) {
					const r = p.ratings.findLast((row) => row.season === s);
					if (r && p.tid >= 0) {
						ratingRows.push({ p, r, min: minBy.get(p.pid) ?? 0 });
					}
				}
				const skip = new Set([
					"season",
					"fuzz",
					"dovr",
					"dpot",
					"injuryIndex",
					"tid",
				]);
				const keys = Object.keys(ratingRows[0].r).filter(
					(k) => typeof ratingRows[0].r[k] === "number" && !skip.has(k),
				);
				const wmean = (f) => {
					let num = 0;
					let den = 0;
					for (const x of ratingRows) {
						num += x.min * f(x);
						den += x.min;
					}
					return r2(num / den);
				};
				const ratingsAll = Object.fromEntries(
					keys.map((k) => [k, r2(mean(ratingRows.map((x) => x.r[k])))]),
				);
				const ratingsMin = Object.fromEntries(
					keys.map((k) => [k, wmean((x) => x.r[k])]),
				);
				const ovrs = ratingRows.map((x) => x.r.ovr).toSorted((a, b) => b - a);
				const rookies = players.filter(
					(p) => p.draft.year === s - 1 && p.tid >= 0,
				);
				const retirees = await idb.merged.players.getAll({
					retiredYear: s - 1,
				});
				const teamStats2 = (await idb.cache.teamStats.getAll()).filter(
					(ts) => ts.season === s && !ts.playoffs,
				);
				const tot = {};
				let gp2 = 0;
				for (const ts of teamStats2) {
					gp2 += ts.gp;
					for (const k of [
						"pts",
						"fg",
						"fga",
						"tp",
						"tpa",
						"ft",
						"fta",
						"orb",
						"drb",
						"tov",
						"ast",
						"stl",
						"blk",
						"pf",
						"min",
					]) {
						tot[k] = (tot[k] ?? 0) + ts[k];
					}
				}
				const poss = tot.fga - tot.orb + tot.tov + 0.44 * tot.fta;
				// League Eras' "what won" pull: the top quarter's (by win%) relative edge over the league in its own possession estimate
				// (what the era engine reads), in game tempo (own and opponent possessions averaged), in 3PA share and in FT rate
				const tss = (await idb.cache.teamSeasons.getAll()).filter(
					(t) => t.season === s,
				);
				const eraRows = teamStats2.map((ts) => {
					const t = tss.find((x) => x.tid === ts.tid);
					const own = (ts.fga - ts.orb + ts.tov + 0.44 * ts.fta) / ts.gp;
					const opp =
						(ts.oppFga - ts.oppOrb + ts.oppTov + 0.44 * ts.oppFta) / ts.gp;
					return {
						winp: t.won / Math.max(1, t.won + t.lost),
						own,
						tempo: (own + opp) / 2,
						tpShare: ts.tpa / ts.fga,
						ftRate: ts.fta / ts.fga,
					};
				});
				const edge = (key) => {
					const lg = mean(eraRows.map((x) => x[key]));
					const top = eraRows
						.toSorted((a, b) => b.winp - a.winp)
						.slice(0, Math.round(eraRows.length / 4));
					return Number((mean(top.map((x) => x[key])) / lg - 1).toFixed(4));
				};
				const winnersEdge = {
					own: edge("own"),
					tempo: edge("tempo"),
					tpShare: edge("tpShare"),
					ftRate: edge("ftRate"),
				};
				const r4 = (x: number) => Number(x.toFixed(4));
				const box = {
					pts: r2(tot.pts / gp2),
					poss: r2(poss / gp2),
					ortg: r2((100 * tot.pts) / poss),
					efg: r4((tot.fg + 0.5 * tot.tp) / tot.fga),
					fgp: r4(tot.fg / tot.fga),
					twop: r4((tot.fg - tot.tp) / (tot.fga - tot.tpa)),
					tpp: r4(tot.tp / tot.tpa),
					ftp: r4(tot.ft / tot.fta),
					fta: r2(tot.fta / gp2),
					tpaRate: r4(tot.tpa / tot.fga),
					tovPct: r4(tot.tov / poss),
					orbPct: r4(tot.orb / (tot.orb + tot.drb)),
					ast: r2(tot.ast / gp2),
					blk: r2(tot.blk / gp2),
					stl: r2(tot.stl / gp2),
					pf: r2(tot.pf / gp2),
					// The Settings preview's / era calibration's definitions (previewGameSim.ts), from league totals
					brPace: r2(
						((tot.fga +
							0.4 * tot.fta -
							1.07 * (tot.orb / (tot.orb + tot.drb)) * (tot.fga - tot.fg) +
							tot.tov) /
							tot.min) *
							5 *
							48,
					),
					brTovPct: r4(tot.tov / (tot.fga + 0.44 * tot.fta + tot.tov)),
					ftRate: r4(tot.fta / tot.fga),
				};
				const style = Object.fromEntries(
					[
						"pace",
						"threePointTendencyFactor",
						"foulRateFactor",
						"orbFactor",
						"twoPointAccuracyFactor",
						"threePointAccuracyFactor",
						"ftAccuracyFactor",
						"turnoverFactor",
					].map((k) => [k, g.get(k)]),
				);
				const diag = {
					seed,
					season: s,
					n: ratingRows.length,
					age: r2(mean(ratingRows.map((x) => s - x.p.born.year))),
					ageMin: wmean((x) => s - x.p.born.year),
					ovrMean: r2(mean(ovrs)),
					ovrRank: [10, 30, 60, 150, 300].map((k) => ovrs[k - 1]),
					rookies: rookies.length,
					rookieOvr: r2(
						mean(
							rookies.map(
								(p) => p.ratings.findLast((row) => row.season === s).ovr,
							),
						),
					),
					retirees: retirees.length,
					retireeOvr: r2(mean(retirees.map((p) => p.ratings.at(-1).ovr))),
					ratingsAll,
					ratingsMin,
					composites: compositeSnapshot,
					box,
					style,
					winnersEdge,
					preview: previewStats,
					injuredAtStart,
					// Development by age group, the league's vs a new league's generator's: "dev" is this season's ratings minus last
					// season's final ones (the preseason development, everything included), "gen" the expected change of the same rows
					// from the stock development a new league's players get (developSeason with the default coaching, no traits, career
					// aging, coaching staff, mentors), "inj" the change during this regular season (injuries) of rostered players
					devCompare: await (async () => {
						const { default: developSeasonBasketball } =
							await import("../player/developSeason.basketball.ts");
						const { default: ovrFn } = await import("../player/ovr.ts");
						const { DEFAULT_LEVEL } =
							await import("../../../common/budgetLevels.ts");
						const { withRandom } = await import("../../../common/random.ts");
						const KEYS = [
							"ovr",
							"spd",
							"jmp",
							"endu",
							"dnk",
							"ins",
							"fg",
							"tp",
							"ft",
							"oiq",
							"diq",
							"drb",
							"pss",
							"reb",
							"stre",
						];
						const groups = [
							[19, 22],
							[23, 25],
							[26, 28],
							[29, 31],
							[32, 34],
							[35, 45],
						];
						const acc = {};
						const rnd = makeSeededRandom(777 + s);
						for (const { p, r } of ratingRows) {
							const age = s - p.born.year;
							const gi = groups.findIndex(([lo, hi]) => age >= lo && age <= hi);
							if (gi < 0) {
								continue;
							}
							const key = `${groups[gi][0]}-${groups[gi][1]}`;
							acc[key] ??= { n: 0, nInj: 0, dev: {}, gen: {}, inj: {} };
							const a = acc[key];
							const start = startRows.get(p.pid);
							if (start && start.season === s) {
								a.nInj += 1;
								for (const k of KEYS) {
									a.inj[k] = (a.inj[k] ?? 0) + (r[k] - start[k]);
								}
							}
							const prevRow = p.ratings.findLast((row) => row.season === s - 1);
							if (!prevRow || !start || start.season !== s) {
								continue;
							}
							a.n += 1;
							for (const k of KEYS) {
								a.dev[k] = (a.dev[k] ?? 0) + (start[k] - prevRow[k]);
							}
							const K = 4;
							for (let i = 0; i < K; i++) {
								const copy = { ...prevRow };
								withRandom(rnd, () =>
									developSeasonBasketball(copy, age, DEFAULT_LEVEL),
								);
								copy.ovr = ovrFn(copy);
								for (const k of KEYS) {
									a.gen[k] = (a.gen[k] ?? 0) + (copy[k] - prevRow[k]) / K;
								}
							}
						}
						for (const a of Object.values(acc)) {
							for (const part of ["dev", "gen"]) {
								for (const k of KEYS) {
									a[part][k] = r2((a[part][k] ?? 0) / Math.max(1, a.n));
								}
							}
							for (const k of KEYS) {
								a.inj[k] = r2((a.inj[k] ?? 0) / Math.max(1, a.nInj));
							}
						}
						return acc;
					})(),
					// Mean ratings of rostered players by age group (the steady state vs the generated league)
					byAge: Object.fromEntries(
						[
							[19, 22],
							[23, 25],
							[26, 28],
							[29, 31],
							[32, 45],
						].map(([lo, hi]) => {
							const xs = ratingRows.filter((x) => {
								const age = s - x.p.born.year;
								return age >= lo && age <= hi;
							});
							return [
								`${lo}-${hi}`,
								{
									n: xs.length,
									...Object.fromEntries(
										[
											"ovr",
											"spd",
											"jmp",
											"endu",
											"dnk",
											"fg",
											"tp",
											"ins",
											"oiq",
											"diq",
										].map((k) => [k, r2(mean(xs.map((x) => x.r[k])))]),
									),
								},
							];
						}),
					),
					// Injuries suffered this season (by players in the cache) and the games they cost
					injuries: (() => {
						let n = 0;
						let games = 0;
						for (const p of players) {
							for (const inj of p.injuries ?? []) {
								if (inj.season === s) {
									n += 1;
									games += inj.games;
								}
							}
						}
						return { n, games };
					})(),
				};
				console.log(`DIAG ${JSON.stringify(diag)}`);
				if (env.SHOT_SHARE_DIAG_OUT) {
					appendFileSync(env.SHOT_SHARE_DIAG_OUT, `${JSON.stringify(diag)}\n`);
				}
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
