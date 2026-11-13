// @ts-nocheck (node-only script, like run.script.test.ts)
/* eslint-disable no-undef */
// Economy audit: a long headless sim (new-league defaults) recording the economy and the AI front offices every season: payrolls
// against the cap/tax/aprons, roster sizes, free agency, contracts against value, AI-AI trade fairness (valued by both teams' own trade
// AI the moment each trade is made), draft pick conditions, cap exceptions, GM/coach turnover, profit and the owner's money mood,
// front office levels, rumors, plus invalid-state checks. Run with
// RUN_ECO_AUDIT=1 ECO_CONFIG=default npx vitest run --project basketball src/test/ratingInflation/economyAudit.script.test.ts
// Env: ECO_CONFIG (default, hard, none, repeater, small, large, expansion, noGms), ECO_SEED (default 1), ECO_SEASONS (default 15),
// ECO_OUT (jsonl, default /tmp/economyAudit.jsonl)
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import {
	FIRST_APRON_FACTOR,
	SECOND_APRON_FACTOR,
} from "../../common/capExceptions.ts";
import { getContractExp, getCurrentContract } from "../../common/contracts.ts";
import getTeamInfos from "../../common/getTeamInfos.ts";
import teamInfos from "../../common/teamInfos.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import {
	newDeptsAverageAmount,
	overspendMoodPenalty,
} from "../../common/frontOffice.ts";
import { mockIDBLeague, resetCache, resetG } from "../helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers, local } from "../../worker/util/index.ts";
import { draft, freeAgents, player, team } from "../../worker/core/index.ts";
import {
	addContract,
	createContract,
} from "../../worker/core/contract/index.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import addDraftProspects from "../../worker/core/league/create/addDraftProspects.ts";
import { ensureStaff } from "../../worker/core/staff/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import { ValueChangeCalculator } from "../../worker/core/team/ValueChangeCalculator.ts";
import {
	frontOfficeEnabled,
	getSeasonEnvelope,
	getSeasonSpend,
} from "../../worker/core/frontOffice/index.ts";
import { nativeFeatureNewLeagueDefaults } from "../../common/nativeFeatures.ts";
import { ALL_ON, OFF, mulberry32 } from "./harness.ts";
import { fitHardCapContractDemands } from "../../worker/core/league/createStream.ts";

const mean = (xs) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs, p) => {
	if (xs.length === 0) {
		return 0;
	}
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r2 = (x) => Math.round(x * 100) / 100;

const CONFIGS = {
	default: {},
	hard: { salaryCapType: "hard" },
	none: { salaryCapType: "none" },
	repeater: { capExceptionsRepeaterTax: true, capExceptionsStretch: true },
	small: { numTeamsOverride: 16 },
	large: { numTeamsOverride: 40 },
	expansion: { expandAt: 4 },
	noGms: { featureGmPersonalities: false },
};

const makeTeams = (numTeams) => {
	let basics = helpers.getTeamsDefault();
	if (numTeams < basics.length) {
		// Keep every division, a few teams each
		const byDiv = Map.groupBy(basics, (t) => t.did);
		const perDiv = Math.ceil(numTeams / byDiv.size);
		basics = [...byDiv.values()].flatMap((ts) => ts.slice(0, perDiv));
		basics = basics.slice(0, numTeams);
	} else if (numTeams > basics.length) {
		const used = new Set(basics.map((t) => t.abbrev));
		const extra = Object.keys(teamInfos)
			.filter((abbrev) => !used.has(abbrev))
			.slice(0, numTeams - basics.length);
		const divs = g.get("divs");
		basics = [
			...basics,
			...getTeamInfos(
				extra.map((abbrev, i) => ({
					tid: 0,
					cid: divs[i % divs.length].cid,
					did: divs[i % divs.length].did,
					abbrev,
				})),
			),
		];
	}
	return basics.map((t, i) =>
		team.generate({ ...t, tid: i, popRank: t.popRank ?? i + 1 }),
	);
};

const createLeague = async (settings, numTeams) => {
	resetG();
	idb.league = mockIDBLeague();
	Object.assign(g, OFF, settings, {
		lid: 0,
		phase: PHASE.PRESEASON,
		userTid: 0,
		userTids: [0],
		spectator: true,
		saveOldBoxScores: { pastSeasons: 0, pastSeasonsType: "all", note: "none" },
		storePlayByPlay: false,
		pbpStore: "none",
		playerTraitsSeed: 12345,
	});
	const teams = makeTeams(numTeams);
	Object.assign(g, {
		numTeams: teams.length,
		numActiveTeams: teams.length,
		teamInfoCache: teams.map((t) => ({
			abbrev: t.abbrev,
			disabled: false,
			imgURL: t.imgURL,
			imgURLSmall: t.imgURLSmall,
			name: t.name,
			region: t.region,
		})),
	});
	if (teams.length < 20) {
		g.numGamesPlayoffSeries = [7, 7, 7];
	}
	await resetCache({ teams });
	for (const t of teams) {
		await idb.cache.teamSeasons.add(team.genSeasonRow(t));
		await idb.cache.teamStats.add(team.genStatsRow(t.tid));
	}
	const activeTids = teams.map((t) => t.tid);
	const players = await createRandomPlayers({
		activeTids,
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams,
	});
	await addDraftProspects({ players, scoutingLevel: DEFAULT_LEVEL });
	await idb.cache.players.addAll(players);
	const all = await idb.cache.players.getAll();
	for (const p of all) {
		player.ensureTraits(p);
		await player.updateValues(p);
	}
	const finalizeContract = (p) => {
		if (p.contractDemand) {
			delete p.contractDemand.temp;
		}
		if (p.tid >= 0 && p.contractDemand) {
			addContract(
				p,
				createContract({
					contract: p.contractDemand,
					type: p.contractDemand.rookie ? "rookie" : "unknown",
				}),
			);
		}
	};
	for (const p of all) {
		if (!p.contractDemand?.temp) {
			finalizeContract(p);
		}
	}
	await freeAgents.normalizeContractDemands({
		type: "newLeague",
		pids: all.filter((p) => p.contractDemand?.temp).map((p) => p.pid),
	});
	// Hard cap: like a new league, contract demands are lowered until every team fits under the cap
	await fitHardCapContractDemands(await idb.cache.players.getAll());
	for (const p of await idb.cache.players.getAll()) {
		if (!getCurrentContract(p) && p.tid >= 0) {
			finalizeContract(p);
		} else if (p.contractDemand?.temp) {
			delete p.contractDemand.temp;
		}
		await idb.cache.players.put(p);
	}
	for (const tid of activeTids) {
		await team.rosterAutoSort(tid);
	}
	await draft.genPicks({});
	await draft.processNewDraftClasses();
	await ensureStaff();
};

// Every AI-AI trade, valued right after it's made by each team's own trade AI (undoing it: -dv is what the trade was worth to it)
const tradeLog = [];
const hookTrades = () => {
	const events = idb.cache.events;
	const origAdd = events.add.bind(events);
	events.add = async (e) => {
		const result = await origAdd(e);
		if (e.type === "trade" && e.teams?.length === 2 && e.tids?.length === 2) {
			try {
				const vcc = new ValueChangeCalculator();
				const sides = [];
				for (const j of [0, 1]) {
					const k = 1 - j;
					// teams[j].assets: what team j received
					const recv = e.teams[j].assets;
					const gave = e.teams[k].assets;
					const dv = await vcc.evaluate({
						tid: e.tids[j],
						pidsAdd: gave.filter((a) => a.pid !== undefined).map((a) => a.pid),
						pidsRemove: recv
							.filter((a) => a.pid !== undefined)
							.map((a) => a.pid),
						dpidsAdd: gave
							.filter((a) => a.dpid !== undefined && !a.swap)
							.map((a) => a.dpid),
						dpidsRemove: recv
							.filter((a) => a.dpid !== undefined && !a.swap)
							.map((a) => a.dpid),
						tradingPartnerTid: e.tids[k],
					});
					sides.push(-dv);
				}
				if (process.env.ECO_TRADE_DUMP && Math.min(...sides) < -3) {
					const desc = [];
					for (const j of [0, 1]) {
						const items = [];
						for (const a of e.teams[j].assets) {
							if (a.pid !== undefined) {
								const p = await idb.cache.players.get(a.pid);
								const c = getCurrentContract(p);
								items.push(
									`p${a.pid} v${Math.round(p.value)} age${g.get("season") - p.born.year} amounts ${c?.amounts.join("/")} inj${p.injury.gamesRemaining}${p.tradeRequest ? " REQ" : ""}`,
								);
							} else {
								items.push(
									`dp${a.dpid} ${a.season} r${a.round} ${a.condition ?? ""}${a.swap ? " swap" : ""}`,
								);
							}
						}
						const t = await idb.cache.teams.get(e.tids[j]);
						const payroll = Math.round(
							(await team.getPayroll(e.tids[j])) / 1000,
						);
						desc.push(
							`t${e.tids[j]}(${t.strategy}, payroll ${payroll}) gets [${items.join("; ")}] dv=${sides[j].toFixed(2)}`,
						);
					}
					appendFileSync(
						process.env.ECO_TRADE_DUMP,
						`${g.get("season")} phase ${g.get("phase")} ${e.note ?? ""}\n  ${desc.join("\n  ")}\n`,
					);
				}
				tradeLog.push({
					season: g.get("season"),
					phase: g.get("phase"),
					tids: e.tids,
					dv: sides,
					user: e.tids.includes(g.get("userTid")),
					numAssets: e.teams[0].assets.length + e.teams[1].assets.length,
					cond: e.teams.some((t) => t.assets.some((a) => a.condition)),
					// Undoing the trade values a player who asked out at full value, but the team that traded him got less for him
					// (TRADE_REQUEST_VALUE_FACTOR), so these read as lopsided when they weren't
					req: (
						await Promise.all(
							(e.pids ?? []).map(
								async (pid) =>
									(await idb.cache.players.get(pid))?.tradeRequest !==
									undefined,
							),
						)
					).some(Boolean),
					note: e.note,
				});
			} catch (error) {
				tradeLog.push({ season: g.get("season"), error: String(error) });
			}
		}
		return result;
	};
};

const getPayrolls = async (teams) => {
	const out = [];
	for (const t of teams) {
		out.push(await team.getPayroll(t.tid));
	}
	return out;
};

const invalidChecks = async (when) => {
	const season = g.get("season");
	const phase = g.get("phase");
	const problems = [];
	const teams = await idb.cache.teams.getAll();
	const activeTids = new Set(
		teams.filter((t) => !t.disabled).map((t) => t.tid),
	);
	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) {
		const c = getCurrentContract(p);
		if (!c) {
			problems.push(`p${p.pid} on t${p.tid} no contract`);
			continue;
		}
		const exp = getContractExp(c);
		const minSeason = phase > PHASE.PLAYOFFS ? season : season;
		if (exp < minSeason) {
			problems.push(`p${p.pid} on t${p.tid} contract exp ${exp} < ${season}`);
		}
		if (!activeTids.has(p.tid)) {
			problems.push(`p${p.pid} on disabled t${p.tid}`);
		}
		for (const amount of c.amounts) {
			if (
				(amount < g.get("minContract") - 1 && !c.stretched && !c.guaranteed) ||
				amount > g.get("maxContract") * 1.0001
			) {
				problems.push(`p${p.pid} amount ${amount}`);
				break;
			}
		}
	}
	const dps = await idb.cache.draftPicks.getAll();
	const keys = new Set();
	for (const dp of dps) {
		const key = `${dp.originalTid}-${dp.season}-${dp.round}`;
		if (keys.has(key)) {
			problems.push(`dup pick ${key}`);
		}
		keys.add(key);
		if (typeof dp.season === "number" && dp.season < season) {
			problems.push(`stale pick ${key} held by ${dp.tid}`);
		}
		if (
			typeof dp.season === "number" &&
			dp.season === season &&
			phase > PHASE.DRAFT
		) {
			problems.push(`undrafted pick ${key} after draft`);
		}
		if (!activeTids.has(dp.tid)) {
			problems.push(`pick ${key} held by inactive t${dp.tid}`);
		}
		if (dp.protection && !activeTids.has(dp.protection.tid)) {
			problems.push(`pick ${key} protection to inactive`);
		}
		if (dp.swap && !activeTids.has(dp.swap.tid)) {
			problems.push(`pick ${key} swap to inactive`);
		}
		// (dp.swap.tid === dp.tid is fine: the holder of a swap right acquired the pick, and keeps the right if he trades it on)
	}
	if (g.get("salaryCapType") === "hard" && when === "regular") {
		const payrolls = await getPayrolls(teams.filter((t) => !t.disabled));
		const over = payrolls
			.filter((x) => x > g.get("salaryCap") + 1)
			.map((x) => Math.round((x - g.get("salaryCap")) / 100) / 10);
		if (over.length > 0) {
			problems.push(`over hard cap by ${over.join(",")}M`);
		}
	}
	return problems;
};

test.skipIf(!process.env.RUN_ECO_AUDIT)(
	"economy audit",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const configName = process.env.ECO_CONFIG ?? "default";
		const config = { ...CONFIGS[configName] };
		const seed = Number(process.env.ECO_SEED ?? 1);
		const seasons = Number(process.env.ECO_SEASONS ?? 15);
		const out = process.env.ECO_OUT ?? "/tmp/economyAudit.jsonl";
		const log = (row) => {
			appendFileSync(out, JSON.stringify(row) + "\n");
			console.log(JSON.stringify(row));
		};
		const numTeams = config.numTeamsOverride ?? 30;
		const expandAt = config.expandAt;
		delete config.numTeamsOverride;
		delete config.expandAt;
		const origRandom = Math.random;
		Math.random = mulberry32(seed);
		try {
			// ECO_BASE=defaults: only the new-league defaults, without the opt-in extras of ALL_ON (faster)
			const base =
				process.env.ECO_BASE === "defaults"
					? nativeFeatureNewLeagueDefaults()
					: ALL_ON;
			await createLeague({ ...base, ...config }, numTeams);
			hookTrades();
			const ownerMoney = new Map();
			const gmTenure = new Map();
			let prevGms = new Map();
			let prevHcs = new Map();
			for (let i = 0; i < seasons; i++) {
				const season = g.get("season");
				if (expandAt !== undefined && i === expandAt) {
					g.autoExpandProb = 1;
					g.autoExpandNumTeams = 2;
					g.autoExpandMaxNumTeams = numTeams + 2;
				} else {
					g.autoExpandProb = 0;
				}
				await startAutoPlay(season, PHASE.REGULAR_SEASON, {});
				const teams = (await idb.cache.teams.getAll()).filter(
					(t) => !t.disabled,
				);
				const cap = g.get("salaryCap");
				const tax = g.get("luxuryPayroll");
				const base = Math.max(tax, cap);
				const payrolls = await getPayrolls(teams);
				const rosters = [];
				for (const t of teams) {
					rosters.push(
						(await idb.cache.players.indexGetAll("playersByTid", t.tid)).length,
					);
				}
				const players = await idb.cache.players.indexGetAll("playersByTid", [
					0,
					Infinity,
				]);
				const fas = await idb.cache.players.indexGetAll(
					"playersByTid",
					PLAYER_FA,
				);
				// Contracts against a value-based reference (the stock contract formula without noise), veterans only
				const logRatios = [];
				let maxContracts = 0;
				for (const p of players) {
					const c = getCurrentContract(p);
					const amount = c.amounts[season - c.start] ?? c.amounts.at(-1);
					if (amount >= g.get("maxContract") * 0.98) {
						maxContracts += 1;
					}
					if (c.type === "rookie") {
						continue;
					}
					const ref = player.genContract(p, false).amount;
					logRatios.push(Math.log(amount / ref));
				}
				const leagueValues = players.map((p) => p.value).sort((a, b) => b - a);
				const top150 = leagueValues[Math.min(149, leagueValues.length - 1)];
				const goodFas = fas.filter((p) => p.value >= top150);
				const regular = {
					payrollP10: r2(pct(payrolls, 0.1) / cap),
					payrollMed: r2(pct(payrolls, 0.5) / cap),
					payrollMax: r2(Math.max(...payrolls) / cap),
					payrollMin: r2(Math.min(...payrolls) / cap),
					overCap: payrolls.filter((x) => x > cap).length,
					overTax: payrolls.filter((x) => x > tax).length,
					overApron1: payrolls.filter((x) => x > FIRST_APRON_FACTOR * base)
						.length,
					overApron2: payrolls.filter((x) => x > SECOND_APRON_FACTOR * base)
						.length,
					underMinPayroll: payrolls.filter((x) => x < g.get("minPayroll"))
						.length,
					rosterMin: Math.min(...rosters),
					rosterMax: Math.max(...rosters),
					rostersBad: rosters.filter(
						(n) => n < g.get("minRosterSize") || n > g.get("maxRosterSize"),
					).length,
					maxContracts,
					contractLogRatioMean: r2(mean(logRatios)),
					contractOverpay50: logRatios.filter((x) => x > Math.log(1.5)).length,
					contractUnderpay50: logRatios.filter((x) => x < Math.log(1 / 1.5))
						.length,
					goodFasUnsigned: goodFas.length,
					goodFaBestValue: r2(Math.max(0, ...goodFas.map((p) => p.value))),
					numTeams: teams.length,
				};
				const problems1 = await invalidChecks("regular");

				await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
				const rostersEnd = [];
				for (const t of teams) {
					rostersEnd.push(
						(await idb.cache.players.indexGetAll("playersByTid", t.tid)).length,
					);
				}
				const ts = await idb.cache.teamSeasons.indexGetAll(
					"teamSeasonsBySeasonTid",
					[[season], [season, "Z"]],
				);
				const scf = cap / 90000;
				let expectedProfit = 15 * scf;
				if (frontOfficeEnabled()) {
					expectedProfit -= newDeptsAverageAmount(cap) / 1000;
				}
				const profits = [];
				const moneyDeltas = [];
				const spendRatios = [];
				for (const row of ts) {
					const rev = Object.values(row.revenues).reduce((a, b) => a + b, 0);
					const exp = Object.values(row.expenses).reduce((a, b) => a + b, 0);
					const fo = row.frontOffice
						? Object.values(row.frontOffice.expenses ?? {}).reduce(
								(a, b) => a + b,
								0,
							)
						: 0;
					const profit = (rev - exp - fo) / 1000;
					profits.push(profit);
					let penalty = 0;
					if (frontOfficeEnabled()) {
						const spend = getSeasonSpend(row);
						const env = await getSeasonEnvelope(row);
						spendRatios.push(spend / Math.max(1, env));
						penalty = overspendMoodPenalty(spend, env);
					}
					const delta = (profit - expectedProfit) / (100 * scf) - penalty;
					moneyDeltas.push(delta);
					ownerMoney.set(
						row.tid,
						Math.min(1, (ownerMoney.get(row.tid) ?? 0) + delta),
					);
				}
				const cash = (await idb.cache.teams.getAll())
					.filter((t) => !t.disabled)
					.map((t) => (ts.find((x) => x.tid === t.tid)?.cash ?? 0) / 1000);
				// The poorest team: its payroll (x cap), luxury tax and revenue this season, and its population rank
				const poorest = ts.reduce((a, b) => (b.cash < a.cash ? b : a));
				const poorestInfo = {
					tid: poorest.tid,
					payrollCap: r2(poorest.payrollEndOfSeason / cap),
					taxM: r2(poorest.expenses.luxuryTax / 1000),
					revenueM: r2(
						Object.values(poorest.revenues).reduce((a, b) => a + b, 0) / 1000,
					),
					salaryM: r2(poorest.expenses.salary / 1000),
					pop: r2(poorest.pop),
				};
				const owners = [...ownerMoney.values()];
				const budgetLevels = teams.map((t) =>
					mean(
						["coaching", "facilities", "health", "scouting"].map(
							(k) => t.budget[k],
						),
					),
				);
				const rumors = g.get("rumors");
				const rumorItems = (rumors?.items ?? []).filter(
					(r) => r.status !== "open" && r.season === season,
				);
				const endSeason = {
					rosterEndMin: Math.min(...rostersEnd),
					rosterEndMax: Math.max(...rostersEnd),
					profitMin: r2(Math.min(...profits)),
					profitMed: r2(pct(profits, 0.5)),
					profitMax: r2(Math.max(...profits)),
					cashMin: r2(Math.min(...cash)),
					cashMed: r2(pct(cash, 0.5)),
					cashMax: r2(Math.max(...cash)),
					poorest: poorestInfo,
					moneyDeltaMed: r2(pct(moneyDeltas, 0.5)),
					moneyDeltaP10: r2(pct(moneyDeltas, 0.1)),
					ownerMoneyMin: r2(Math.min(...owners)),
					ownerMoneyMed: r2(pct(owners, 0.5)),
					spendEnvMed: r2(pct(spendRatios, 0.5)),
					spendEnvMax: r2(Math.max(0, ...spendRatios)),
					budgetLvlMin: r2(Math.min(...budgetLevels)),
					budgetLvlMed: r2(pct(budgetLevels, 0.5)),
					budgetLvlMax: r2(Math.max(...budgetLevels)),
					ticketPriceMed: r2(
						pct(
							teams.map((t) => t.budget.ticketPrice),
							0.5,
						),
					),
					rumorsResolved: rumorItems.length,
					rumorsClaimed: r2(mean(rumorItems.map((r) => r.confidence))),
					rumorsObserved: r2(
						mean(rumorItems.map((r) => (r.status === "confirmed" ? 1 : 0))),
					),
				};

				await startAutoPlay(season + 1, PHASE.PRESEASON, {});
				const events = (await idb.cache.events.getAll()).filter(
					(e) => e.season === season,
				);
				const by = (type) => events.filter((e) => e.type === type);
				const fa = by("freeAgent");
				const trades = tradeLog.filter((t) => t.season === season && !t.error);
				// Trades with pick conditions are left out too: undoing them values the picks without their protections and swap rights
				const aiTrades = trades.filter((t) => !t.user && !t.req && !t.cond);
				const minDv = aiTrades.map((t) => Math.min(...t.dv));
				const teamsAfter = (await idb.cache.teams.getAll()).filter(
					(t) => !t.disabled,
				);
				const gms = new Map(teamsAfter.map((t) => [t.tid, t.gm?.gmid]));
				const hcs = new Map();
				for (const c of await idb.cache.coaches.getAll()) {
					if (c.tid >= 0 && c.role === "head") {
						hcs.set(c.tid, c.cid);
					}
				}
				let gmChanges = 0;
				let hcChanges = 0;
				for (const t of teamsAfter) {
					if (prevGms.has(t.tid) && prevGms.get(t.tid) !== gms.get(t.tid)) {
						gmChanges += 1;
					}
					if (prevHcs.has(t.tid) && prevHcs.get(t.tid) !== hcs.get(t.tid)) {
						hcChanges += 1;
					}
					if (t.gm) {
						gmTenure.set(t.gm.gmid, (gmTenure.get(t.gm.gmid) ?? 0) + 1);
					}
				}
				prevGms = gms;
				prevHcs = hcs;
				const offseason = {
					trades: trades.length,
					tradesErr: tradeLog.filter((t) => t.season === season && t.error)
						.length,
					aiTradeMinDvMed: r2(pct(minDv, 0.5)),
					aiTradeMinDvP10: r2(pct(minDv, 0.1)),
					aiTradesLosing: minDv.filter((x) => x < -1).length,
					tradesWithCond: trades.filter((t) => t.cond).length,
					faSignings: fa.length,
					faMeanCapPct: r2(
						(100 * mean(fa.map((e) => e.contract?.amount ?? 0))) / cap,
					),
					faMeanYears: r2(
						mean(
							fa.map((e) =>
								e.contract
									? e.contract.exp -
										season +
										(g.get("phase") > PHASE.PLAYOFFS ? 0 : 1)
									: 0,
							),
						),
					),
					faMaxDeals: fa.filter(
						(e) => (e.contract?.amount ?? 0) >= g.get("maxContract") * 0.98,
					).length,
					exceptions: fa.filter((e) => e.exception).length,
					stretched: by("release").filter((e) =>
						/stretch provision/.test(e.text),
					).length,
					releases: by("release").length,
					reSigned: by("reSigned").length,
					extensions: by("extension").length,
					gmChanges,
					hcChanges,
				};
				const problems2 = await invalidChecks("preseason");
				const problems = [...new Set([...problems1, ...problems2])];
				log({
					config: configName,
					seed,
					season,
					...regular,
					...endSeason,
					...offseason,
					problems: problems.length,
					problemSample: problems.slice(0, 5),
				});
			}
			const tenures = [...gmTenure.values()];
			log({
				config: configName,
				summary: true,
				gmTenureMean: r2(mean(tenures)),
				tradeErrors: tradeLog.filter((t) => t.error).slice(0, 3),
			});
		} finally {
			Math.random = origRandom;
			local.autoPlayUntil = undefined;
		}
	},
	24 * 3600 * 1000,
);

const PLAYER_FA = -1;
