// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Offensive Emphasis calibration (common/offEmphasis.ts). Run with OE_CAL=1 npx vitest --run <this file>; OE_LEAGUES (8), OE_GAMES (games
// per pair and condition, 24). Prints: the roster strength norms (OE_NORMS=1 only), league totals with no emphasis vs every team on auto,
// the play-type mix of each preset (every team on it), and the net rating of a good vs a bad fit against auto opponents.
import { test } from "vitest";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	autoEmphasis,
	EMPHASIS_KEYS,
	emphasisFit,
	emphasisSim,
	NEUTRAL_EMPHASIS,
	OFFENSE_SYSTEM_EMPHASIS,
	PRESET_KEYS,
	PRESETS,
	leagueNorms,
	rawStrengths,
	rosterStrengths,
} from "../../../common/offEmphasis.ts";
import { playTypeProfile, sumAdv } from "../../../common/advStats.ts";
import { range } from "../../../common/utils.ts";

import { appendFileSync } from "node:fs";

const env = process.env;
const out = (...xs) => {
	const line = xs.join(" ");
	console.log(line);
	if (env.OE_OUT) {
		appendFileSync(env.OE_OUT, `${line}\n`);
	}
};
const LEAGUES = Number(env.OE_LEAGUES ?? 8);
const GAMES = Number(env.OE_GAMES ?? 24);
const PAIRS = 15;

const SETTINGS = {
	realisticPossessions: true,
	simFixes: true,
	positionalComposites: true,
	realisticRotations: true,
	expandedRatings: true,
	playerTraits: true,
	spacingCreation: true,
	matchupDefense: true,
	realisticTurnovers: true,
	realisticPlayTypes: true,
	advStats: true,
	featureOffEmphasis: true,
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const ratingsOf = (p) => p.ratings.at(-1);
const SYSTEMS = Object.keys(OFFENSE_SYSTEM_EMPHASIS);

// The emphasis that fits a roster best / worst (the strengths' signs, scaled)
const bestFor = (z) =>
	Object.fromEntries(
		EMPHASIS_KEYS.map((k) => [k, Math.max(-1, Math.min(1, z[k]))]),
	);
const worstFor = (z) =>
	Object.fromEntries(
		EMPHASIS_KEYS.map((k) => [k, Math.max(-1, Math.min(1, -z[k]))]),
	);

const pairRosters = async (seed, pair) => {
	let out;
	await withSeededRandom(seed * 1009 + pair * 97, async () => {
		await genTeams();
		out = [0, 1].map(async (tid) =>
			(await idb.cache.players.indexGetAll("playersByTid", tid))
				.sort((a, b) => b.valueNoPot - a.valueNoPot)
				.map((p) => structuredClone(p)),
		);
		out = await Promise.all(out);
	});
	return out;
};

// Play a pair's games; emph(tid) gives each side's dials (undefined: none)
// Strength norms of the league being played (like the worker: relative to the league's rosters)
let curNorms;
const playPair = async (rosters, seed, pair, emph) => {
	const rows = [];
	await withSeededRandom(seed * 7919 + pair * 104729, async () => {
		await genTeams();
		for (const p of await idb.cache.players.getAll()) {
			await idb.cache.players.delete(p.pid);
		}
		for (const tid of [0, 1]) {
			for (const p of rosters[tid]) {
				await idb.cache.players.put(structuredClone(p));
			}
		}
		g.setWithoutSavingToDB("storePlayByPlay", false);
		for (const [key, value] of Object.entries(SETTINGS)) {
			g.setWithoutSavingToDB(key, value);
		}
		for (const i of range(GAMES)) {
			const teams = await loadTeams([0, 1], {});
			for (const tid of [0, 1]) {
				const e = emph(tid);
				if (e) {
					const z = rosterStrengths(rosters[tid].map(ratingsOf), curNorms);
					teams[tid].offEmphasis = emphasisSim(e, emphasisFit(e, z));
				}
			}
			const home = i % 2;
			const sim = new GameSim({
				gid: pair * 1000 + i,
				teams: [teams[home], teams[1 - home]],
				baseInjuryRate: 0,
				doPlayByPlay: false,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			const result = sim.run();
			for (const side of [0, 1]) {
				const tid = side === 0 ? home : 1 - home;
				rows.push({
					tid,
					t: result.team[side].stat,
					o: result.team[1 - side].stat,
					adv: sumAdv(result.team[side].player),
				});
			}
		}
	});
	return rows;
};

const totals = (rows) => {
	const s = (k) => mean(rows.map((r) => r.t[k]));
	const poss = mean(
		rows.map((r) => r.t.fga + 0.44 * r.t.fta - r.t.orb + r.t.tov),
	);
	return {
		pts: s("pts").toFixed(1),
		poss: poss.toFixed(1),
		fgp: ((100 * s("fg")) / s("fga")).toFixed(1),
		tpar: ((100 * s("tpa")) / s("fga")).toFixed(1),
		ast: s("ast").toFixed(1),
		tov: s("tov").toFixed(1),
		fta: s("fta").toFixed(1),
		orb: s("orb").toFixed(1),
	};
};
const mix = (rows) => {
	const prof = playTypeProfile(sumAdv(rows));
	return Object.fromEntries(
		prof.types
			.filter((t) => t.key !== "misc")
			.map((t) => [t.key, `${t.freq.toFixed(1)}/${t.ppp.toFixed(2)}`]),
	);
};
const net = (rows) => {
	let pts = 0;
	let opp = 0;
	let poss = 0;
	for (const r of rows) {
		pts += r.t.pts;
		opp += r.o.pts;
		poss += r.t.fga + 0.44 * r.t.fta - r.t.orb + r.t.tov;
	}
	return (100 * (pts - opp)) / poss;
};

test.skipIf(!env.OE_NORMS)(
	"roster strength norms",
	async () => {
		const raws = [];
		for (const i of range(60)) {
			const rosters = await pairRosters(500 + Math.floor(i / 15), i % 15);
			for (const r of rosters) {
				raws.push(rawStrengths(r.map(ratingsOf)));
			}
		}
		for (const k of EMPHASIS_KEYS) {
			const xs = raws.map((r) => r[k]);
			out(`NORM ${k} [${mean(xs).toFixed(1)}, ${sd(xs).toFixed(1)}]`);
		}
	},
	3_600_000,
);

test.skipIf(!env.OE_CAL)(
	"offensive emphasis calibration",
	async () => {
		const all = { none: [], auto: [] };
		const presets = Object.fromEntries(PRESET_KEYS.map((k) => [k, []]));
		const goodDiff = [];
		const badDiff = [];
		const balDiff = [];
		const autoFits = [];
		const dialSums = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, []]));
		for (const L of range(LEAGUES)) {
			const leagueAuto = [];
			const leagueGood = [];
			const leagueBad = [];
			const leagueBal = [];
			const seed = 100 + L;
			const leagueRosters = [];
			for (const pair of range(PAIRS)) {
				leagueRosters.push(await pairRosters(seed, pair));
			}
			curNorms = leagueNorms(
				leagueRosters.flat().map((r) => rawStrengths(r.map(ratingsOf))),
			);
			for (const pair of range(PAIRS)) {
				const rosters = leagueRosters[pair];
				const z = rosters.map((r) =>
					rosterStrengths(r.map(ratingsOf), curNorms),
				);
				const sys = [0, 1].map(
					(tid) => SYSTEMS[(L * 31 + pair * 7 + tid * 3) % SYSTEMS.length],
				);
				const auto = [0, 1].map((tid) => autoEmphasis(z[tid], sys[tid]));
				for (const tid of [0, 1]) {
					autoFits.push(emphasisFit(auto[tid], z[tid]));
					for (const k of EMPHASIS_KEYS) {
						dialSums[k].push(auto[tid][k]);
					}
				}
				all.none.push(
					...(await playPair(rosters, seed, pair, () => undefined)),
				);
				const autoRows = await playPair(rosters, seed, pair, (t) => auto[t]);
				all.auto.push(...autoRows);
				leagueAuto.push(...autoRows.filter((r) => r.tid === 0));
				// Team 0 with a good or a bad fit, team 1 on auto
				const good = await playPair(rosters, seed, pair, (t) =>
					t === 0 ? bestFor(z[0]) : auto[1],
				);
				const bad = await playPair(rosters, seed, pair, (t) =>
					t === 0 ? worstFor(z[0]) : auto[1],
				);
				const bal = await playPair(rosters, seed, pair, (t) =>
					t === 0 ? PRESETS.balanced : auto[1],
				);
				leagueBal.push(...bal.filter((r) => r.tid === 0));
				leagueGood.push(...good.filter((r) => r.tid === 0));
				leagueBad.push(...bad.filter((r) => r.tid === 0));
				if (L < 2) {
					for (const key of PRESET_KEYS) {
						presets[key].push(
							...(await playPair(rosters, seed, pair, () => PRESETS[key])),
						);
					}
				}
			}
			const a = net(leagueAuto);
			goodDiff.push(net(leagueGood) - a);
			badDiff.push(net(leagueBad) - a);
			balDiff.push(net(leagueBal) - a);
			out(
				`LEAGUE ${L} good ${(net(leagueGood) - a).toFixed(2)} bad ${(net(leagueBad) - a).toFixed(2)} balanced ${(net(leagueBal) - a).toFixed(2)}`,
			);
		}
		out("TOTALS none", JSON.stringify(totals(all.none)));
		out("TOTALS auto", JSON.stringify(totals(all.auto)));
		out("MIX none", JSON.stringify(mix(all.none)));
		out("MIX auto", JSON.stringify(mix(all.auto)));
		for (const key of PRESET_KEYS) {
			out(
				`MIX ${key}`,
				JSON.stringify(mix(presets[key])),
				JSON.stringify(totals(presets[key])),
			);
		}
		out(
			`AUTO fit mean ${mean(autoFits).toFixed(3)} sd ${sd(autoFits).toFixed(3)}; dial means ${JSON.stringify(Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, mean(dialSums[k]).toFixed(2)])))}`,
		);
		out(
			`FIT good ${mean(goodDiff).toFixed(2)} ± ${(sd(goodDiff) / Math.sqrt(goodDiff.length)).toFixed(2)}, bad ${mean(badDiff).toFixed(2)} ± ${(sd(badDiff) / Math.sqrt(badDiff.length)).toFixed(2)} net rating vs auto, balanced ${mean(balDiff).toFixed(2)} ± ${(sd(balDiff) / Math.sqrt(balDiff.length)).toFixed(2)} (${LEAGUES} leagues)`,
		);
		void NEUTRAL_EMPHASIS;
	},
	7_200_000,
);
