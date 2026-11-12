// @ts-nocheck (node-only script, like run.script.test.ts)
/* eslint-disable no-undef */
// AI GM audit: headless multi-season sim with every League extra on, recording what the AI teams do each season (trades, trade
// quality, free agency, cap health, roster sizes, unrest, parity, contract levels). Run with
// RUN_AI_AUDIT=1 npx vitest run --project basketball src/test/ratingInflation/aiAudit.script.test.ts
// Env: AI_SEEDS (comma list, default 1), AI_SEASONS (default 4), AI_OUT (jsonl file), AI_GMS (0 turns AI GM personalities off, for
// before/after comparisons; with them on, also records GM firings/hires and per-team trade counts by GM style)
import { appendFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { getTradePickConditions } from "../../common/draftPickConditions.ts";
import { idb } from "../../worker/db/index.ts";
import { g, local } from "../../worker/util/index.ts";
import { team } from "../../worker/core/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import {
	getContractSummary,
	getOwedContracts,
	getPayrollAmount,
} from "../../worker/core/contract/index.ts";
import { buildAiOffer } from "../../worker/core/trade/aiOffers.ts";
import { ValueChangeCalculator } from "../../worker/core/team/ValueChangeCalculator.ts";
import { getTradeGrades } from "../../worker/util/valueData.ts";
import { ALL_ON, createLeague, mulberry32 } from "./harness.ts";

const mean = (xs: number[]) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const r2 = (x: number) => Math.round(x * 100) / 100;

const inSeason = async (season: number) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const salaryCap = g.get("salaryCap");
	const tax = g.get("luxuryPayroll");
	const payrolls: number[] = [];
	let dead = 0;
	for (const t of teams) {
		payrolls.push(await team.getPayroll(t.tid));
		for (const { contract } of await getOwedContracts(t.tid)) {
			dead += getPayrollAmount(contract);
		}
	}
	const rosters = [];
	for (const t of teams) {
		rosters.push(
			(await idb.cache.players.indexGetAll("playersByTid", t.tid)).length,
		);
	}
	const ts = await idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
		[season],
		[season, "Z"],
	]);
	const winp = ts.map(
		(t) => t.won / Math.max(1, t.won + t.lost + (t.tied ?? 0)),
	);
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const amounts = players.map((p) => getContractSummary(p)?.amount ?? 0);
	const ovrs = teams.map((t) => {
		const sorted = players
			.filter((p) => p.tid === t.tid)
			.map((p) => ({
				ratings: { ovr: p.ratings.at(-1).ovr, pos: p.ratings.at(-1).pos },
			}))
			.sort((a, b) => b.ratings.ovr - a.ratings.ovr);
		return team.ovr(sorted);
	});
	return {
		overTax: payrolls.filter((p) => p > tax).length,
		overCap: payrolls.filter((p) => p > salaryCap).length,
		maxPayrollCap: r2(Math.max(...payrolls) / salaryCap),
		deadMoneyPerTeamCap: r2(dead / teams.length / salaryCap),
		rosterMin: Math.min(...rosters),
		rosterMax: Math.max(...rosters),
		winpSd: r2(sd(winp)),
		teamOvrSd: r2(sd(ovrs)),
		meanContractCap: r2((mean(amounts) / salaryCap) * 100),
		meanOvr: r2(mean(players.map((p) => p.ratings.at(-1).ovr))),
		activeTradeRequests: players.filter((p) => p.tradeRequest).length,
	};
};

// Offers AI teams would send the user (team 0) right now, valued from the user's side
const offerQuality = async () => {
	const vcc = new ValueChangeCalculator();
	const userTid = g.get("userTid");
	const dvs: number[] = [];
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled || t.tid === userTid) {
			continue;
		}
		const built = await buildAiOffer(t.tid, vcc);
		if (!built) {
			continue;
		}
		const [u, ai] = built.teams;
		dvs.push(
			await vcc.evaluate({
				tid: userTid,
				pidsAdd: ai.pids,
				pidsRemove: u.pids,
				dpidsAdd: ai.dpids,
				dpidsRemove: u.dpids,
				tradingPartnerTid: ai.tid,
				pickConditions: getTradePickConditions(built.teams),
			}),
		);
	}
	dvs.sort((a, b) => a - b);
	return {
		offers: dvs.length,
		offerUserDvP10: r2(dvs[Math.floor(dvs.length / 10)] ?? 0),
		offerUserDvP25: r2(dvs[Math.floor(dvs.length / 4)] ?? 0),
		offerUserDvMedian: r2(dvs[Math.floor(dvs.length / 2)] ?? 0),
		offerUserDvBadPct: r2(
			(100 * dvs.filter((x) => x < -2).length) / Math.max(1, dvs.length),
		),
	};
};

const eventCounts = async (season: number) => {
	const events = (await idb.cache.events.getAll()).filter(
		(e) => e.season === season,
	);
	const by = (type) => events.filter((e) => e.type === type);
	const trades = by("trade");
	const tradedPids = new Set(trades.flatMap((e) => e.pids ?? []));
	const reqPids = new Set(by("tradeRequest").flatMap((e) => e.pids ?? []));
	let reqTraded = 0;
	for (const pid of reqPids) {
		if (tradedPids.has(pid)) {
			reqTraded += 1;
		}
	}
	return {
		trades: trades.length,
		trades3: trades.filter((e) =>
			/three-team/i.test(`${e.note ?? ""} ${e.text ?? ""}`),
		).length,
		tradesWithPickCond: trades.filter((e) =>
			e.teams?.some((t) => t.assets.some((a) => a.condition)),
		).length,
		tradesForRequests: trades.filter((e) => /asked out/i.test(e.note ?? ""))
			.length,
		faSignings: by("freeAgent").length,
		releases: by("release").length,
		reSigned: by("reSigned").length,
		extensions: by("extension").length,
		tradeRequests: reqPids.size,
		tradeRequestsTraded: reqTraded,
		holdouts: by("holdout").length,
	};
};

test.skipIf(!process.env.RUN_AI_AUDIT)(
	"AI GM audit",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const seeds = (process.env.AI_SEEDS ?? "1").split(",").map(Number);
		const seasons = Number(process.env.AI_SEASONS ?? 4);
		const out = process.env.AI_OUT ?? "/tmp/aiAudit.jsonl";
		for (const seed of seeds) {
			const origRandom = Math.random;
			Math.random = mulberry32(seed);
			try {
				const gmsOn = process.env.AI_GMS !== "0";
				await createLeague({
					...ALL_ON,
					expandedRatings: true,
					featureGmPersonalities: gmsOn,
				});
				// AI_GM_DUMP: every GM's career and every team season's record, for job security analysis
				const dumpGms = async () => {
					if (!process.env.AI_GM_DUMP || !gmsOn) {
						return;
					}
					const teams = (await idb.cache.teams.getAll()).filter(
						(t) => !t.disabled,
					);
					const allTs = await idb.cache.teamSeasons.getAll();
					writeFileSync(
						process.env.AI_GM_DUMP,
						JSON.stringify({
							seed,
							lastSeason: g.get("season") - 1,
							teamSeasons: allTs.map((ts) => [
								ts.tid,
								ts.season,
								ts.won,
								ts.lost,
								ts.playoffRoundsWon,
							]),
							gms: teams.flatMap((t) =>
								[...(t.formerGms ?? []), ...(t.gm ? [t.gm] : [])].map((gm) => ({
									gmid: gm.gmid,
									name: `${gm.firstName} ${gm.lastName}`,
									patience: gm.traits.patience,
									tenures: gm.tenures,
									seasons: gm.seasons,
								})),
							),
						}) + "\n",
					);
				};
				const tradesByTid = new Map();
				const strategySwitches = [];
				for (let i = 0; i < seasons; i++) {
					const season = g.get("season");
					const strategiesBefore = new Map(
						(await idb.cache.teams.getAll()).map((t) => [t.tid, t.strategy]),
					);
					await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
					const mid = await inSeason(season);
					const oq = await offerQuality();
					await startAutoPlay(season + 1, PHASE.PRESEASON, {});
					const ev = await eventCounts(season);
					let switches = 0;
					for (const t of await idb.cache.teams.getAll()) {
						if (strategiesBefore.get(t.tid) !== t.strategy) {
							switches += 1;
						}
					}
					strategySwitches.push(switches);
					for (const e of (await idb.cache.events.getAll()).filter(
						(e) => e.season === season && e.type === "trade",
					)) {
						for (const tid of e.tids ?? []) {
							tradesByTid.set(tid, (tradesByTid.get(tid) ?? 0) + 1);
						}
					}
					const gmEvents = (await idb.cache.events.getAll()).filter(
						(e) =>
							e.season === season &&
							e.type === "info" &&
							/general manager/i.test(e.text ?? ""),
					);
					const row = {
						seed,
						season,
						gms: gmsOn,
						...ev,
						...mid,
						...oq,
						strategySwitches: switches,
						gmFired: gmEvents.filter((e) =>
							/fired general manager/.test(e.text),
						).length,
						gmHired: gmEvents.filter((e) => / hired /.test(e.text)).length,
						gmRetired: gmEvents.filter((e) => /retired\.$/.test(e.text)).length,
					};
					appendFileSync(out, JSON.stringify(row) + "\n");
					console.log(JSON.stringify(row));
					await dumpGms();
				}
				// Per-team trade counts over the whole run, and how they line up with each GM's trade frequency leaning
				const teams = (await idb.cache.teams.getAll()).filter(
					(t) => !t.disabled,
				);
				const counts = teams.map((t) => tradesByTid.get(t.tid) ?? 0);
				const freqs = teams.map((t) => t.gm?.traits.tradeFreq ?? 0);
				const corr = (() => {
					const mx = mean(counts);
					const my = mean(freqs);
					const sx = sd(counts);
					const sy = sd(freqs);
					if (sx === 0 || sy === 0) {
						return 0;
					}
					return (
						mean(counts.map((x, i) => (x - mx) * (freqs[i] - my))) / (sx * sy)
					);
				})();
				const tenures = [];
				for (const t of teams) {
					for (const gm of [...(t.formerGms ?? []), ...(t.gm ? [t.gm] : [])]) {
						for (const tenure of gm.tenures) {
							tenures.push(
								(tenure.end ?? g.get("season") - 1) - tenure.start + 1,
							);
						}
					}
				}
				const summary = {
					seed,
					gms: gmsOn,
					tradesPerTeamMean: r2(mean(counts)),
					tradesPerTeamSd: r2(sd(counts)),
					tradesPerTeamMin: Math.min(...counts),
					tradesPerTeamMax: Math.max(...counts),
					tradesVsTradeFreqCorr: r2(corr),
					strategySwitchesPerSeason: r2(mean(strategySwitches)),
					gmTenureMean: r2(mean(tenures)),
				};
				appendFileSync(out, JSON.stringify(summary) + "\n");
				console.log(JSON.stringify(summary));
				// Trade quality, graded by what each side got afterwards (Trade Grader). Needs a real IndexedDB, so it's skipped
				// when the in-memory test database can't do it
				try {
					const grades = await getTradeGrades();
					const shares = [...grades.byEid.values()]
						.map((t) => t.sides[0].grade?.share)
						.filter((x) => x !== undefined);
					const lopsided = shares.filter((s) => s < 0.2 || s > 0.8).length;
					const row = {
						seed,
						graded: shares.length,
						lopsidedPct: r2((100 * lopsided) / Math.max(1, shares.length)),
					};
					appendFileSync(out, JSON.stringify(row) + "\n");
					console.log(JSON.stringify(row));
				} catch {}
			} finally {
				Math.random = origRandom;
				local.autoPlayUntil = undefined;
			}
		}
	},
	24 * 3600 * 1000,
);
