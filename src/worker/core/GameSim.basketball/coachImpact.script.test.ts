// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Head coach impact: the same rosters with an elite head coach (top 5% of the league's head coaches in offense, defense, motivation and
// game management) and with a poor one (bottom 5%), the same systems, dials, roster fit and seeds otherwise, against the same opponent.
// Prints the win difference over 82 games, and the spread of team net ratings with coaching systems off and on.
// Run with COACH_IMPACT=1 npx vitest --run --project basketball <this file> (COACH_IMPACT_LEAGUES, COACH_IMPACT_GAMES)
import { test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { genLeague, simLeague, teamRates } from "./coachSystemsMetrics.ts";
import {
	NEUTRAL_COACH_SIM,
	coachSimEffects,
	normalizeCoachSims,
} from "../../../common/coachSystems.ts";
import { range } from "../../../common/utils.ts";
import { team } from "../index.ts";
import {
	coachMind,
	deriveDecisionTraits,
	leagueRead,
	perceiveTeam,
	planCoachDecisions,
	readTeam,
} from "../../../common/coachDecisions.ts";
import { applyPlan, decisionPlayer } from "../staff/coachDecisions.ts";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const SETTINGS = {
	realisticPossessions: true,
	simFixes: true,
	positionalComposites: true,
	realisticRotations: true,
	expandedRatings: true,
	playerTraits: true,
};

// The average ratings of the league's top and bottom 5% of head coaches by ovr (coachDrift.script.test.ts, 4 seeds x 30 seasons): offense,
// defense, motivation and game management (profile.mgmt)
const ELITE = { off: 65, def: 63, mot: 62, mgmt: 63 };
const POOR = { off: 46, def: 44, mot: 44, mgmt: 53 };

const simWith = (league, idx, head) => {
	const sims = league.map((t, i) => {
		const profile = i === idx ? { ...t.profile, mgmt: head.mgmt } : t.profile;
		const ratings =
			i === idx
				? { ...t.head, off: head.off, def: head.def, mot: head.mot }
				: t.head;
		return coachSimEffects({
			profile,
			head: ratings,
			install: 1,
			offFit: t.offFit,
			defFit: t.defFit,
			style: { pace: 0, threes: 0, defense: 0, rotation: 0 },
		});
	});
	return normalizeCoachSims(sims);
};

test.skipIf(!process.env.COACH_IMPACT)(
	"elite vs poor head coach on the same roster",
	async () => {
		const numLeagues = Number(process.env.COACH_IMPACT_LEAGUES ?? 2);
		const games = Number(process.env.COACH_IMPACT_GAMES ?? 40);
		const diffs = [];
		let gamesPlayed = 0;
		const spreads = { off: [], on: [] };
		for (const L of range(numLeagues)) {
			const league = await genLeague({
				numPairs: 15,
				seed: 300 + L,
				settings: SETTINGS,
			});
			// Spread of team net ratings, systems off and on (the whole league's coaches)
			const offRows = await simLeague({
				league,
				seed: 400 + L,
				gamesPerPair: 20,
				coaches: false,
				settings: SETTINGS,
			});
			const onRows = await simLeague({
				league,
				seed: 400 + L,
				gamesPerPair: 20,
				coaches: true,
				settings: SETTINGS,
			});
			spreads.off.push(...teamRates(offRows, league.length).map((r) => r.net));
			spreads.on.push(...teamRates(onRows, league.length).map((r) => r.net));

			for (let pair = 0; pair * 2 < league.length; pair++) {
				for (const side of [0, 1]) {
					const idx = pair * 2 + side;
					const won = {};
					for (const [name, head] of [
						["elite", ELITE],
						["poor", POOR],
					]) {
						const sims = simWith(league, idx, head);
						won[name] = 0;
						await withSeededRandom(
							(L * 1000 + pair) * 7919 + side * 104729,
							async () => {
								await genTeams();
								for (const p of await idb.cache.players.getAll()) {
									await idb.cache.players.delete(p.pid);
								}
								for (const tid of [0, 1]) {
									for (const p of league[pair * 2 + tid].players) {
										await idb.cache.players.put(structuredClone(p));
									}
								}
								g.setWithoutSavingToDB("storePlayByPlay", false);
								for (const [key, value] of Object.entries(SETTINGS)) {
									g.setWithoutSavingToDB(key, value);
								}
								for (const i of range(games)) {
									const teams = await loadTeams([0, 1], {});
									for (const tid of [0, 1]) {
										teams[tid].coachSim = { ...sims[pair * 2 + tid] };
									}
									const home = i % 2;
									const result = new GameSim({
										gid: i,
										teams: [teams[home], teams[1 - home]],
										baseInjuryRate: 0,
										doPlayByPlay: false,
										homeCourtFactor: 1,
										allStarGame: false,
										neutralSite: false,
									}).run();
									const mine = result.team.find((t) => t.id === side);
									const theirs = result.team.find((t) => t.id !== side);
									if (mine.stat.pts > theirs.stat.pts) {
										won[name] += 1;
									}
								}
							},
						);
					}
					gamesPlayed += games;
					diffs.push((won.elite - won.poor) / games);
				}
			}
		}
		const m = mean(diffs);
		const se = sd(diffs) / Math.sqrt(diffs.length);
		console.log(
			`elite - poor head coach: ${(82 * m).toFixed(2)} wins per 82 (SE ${(82 * se).toFixed(2)}), ${diffs.length} rosters, ${gamesPlayed} games each`,
		);
		console.log(
			`team net rating SD: systems off ${sd(spreads.off).toFixed(2)}, on ${sd(spreads.on).toFixed(2)}`,
		);
	},
	3_600_000,
);

// Does coaching narrow or widen the gap between good and bad teams? Rosters of different talent against each other (team k against team
// k + 7 of the league), the same seeds with coaching systems off and on: the slope of net rating on the team ovr difference, and the
// spread of the matchups' mean net ratings.
test.skipIf(!process.env.COACH_SPREAD)(
	"talent slope with and without coaching systems",
	async () => {
		const numLeagues = Number(process.env.COACH_IMPACT_LEAGUES ?? 2);
		const games = Number(process.env.COACH_IMPACT_GAMES ?? 60);
		const rows = [];
		for (const L of range(numLeagues)) {
			const league = await genLeague({
				numPairs: 15,
				seed: 500 + L,
				settings: SETTINGS,
			});
			// COACH_NEUTRAL=key,key: these effects neutral (where a change in the slope comes from)
			if (process.env.COACH_NEUTRAL) {
				for (const t of league) {
					for (const key of process.env.COACH_NEUTRAL.split(",")) {
						t.sim[key] = NEUTRAL_COACH_SIM[key];
					}
				}
			}
			const ovrOf = (players) =>
				team.ovr(
					players.map((p) => ({
						ratings: { ovr: p.ratings.at(-1).ovr, pos: p.ratings.at(-1).pos },
					})),
					{},
				);
			for (const a of range(league.length)) {
				const b = (a + 7) % league.length;
				const net = {};
				for (const coaches of [false, true]) {
					let pts = 0;
					let poss = 0;
					await withSeededRandom((L * 1000 + a) * 7919 + 13, async () => {
						await genTeams();
						for (const p of await idb.cache.players.getAll()) {
							await idb.cache.players.delete(p.pid);
						}
						for (const [tid, idx] of [a, b].entries()) {
							for (const [i, p0] of league[idx].players.entries()) {
								const p = structuredClone(p0);
								p.pid = tid * 100 + i;
								p.tid = tid;
								await idb.cache.players.put(p);
							}
						}
						g.setWithoutSavingToDB("storePlayByPlay", false);
						for (const [key, value] of Object.entries(SETTINGS)) {
							g.setWithoutSavingToDB(key, value);
						}
						for (const i of range(games)) {
							const teams = await loadTeams([0, 1], {});
							if (coaches) {
								teams[0].coachSim = { ...league[a].sim };
								teams[1].coachSim = { ...league[b].sim };
							}
							const home = i % 2;
							const result = new GameSim({
								gid: i,
								teams: [teams[home], teams[1 - home]],
								baseInjuryRate: 0,
								doPlayByPlay: false,
								homeCourtFactor: 1,
								allStarGame: false,
								neutralSite: false,
							}).run();
							const mine = result.team.find((t) => t.id === 0).stat;
							const theirs = result.team.find((t) => t.id === 1).stat;
							pts += mine.pts - theirs.pts;
							poss += mine.fga + 0.44 * mine.fta - mine.orb + mine.tov;
						}
					});
					net[coaches ? "on" : "off"] = (100 * pts) / poss;
				}
				rows.push({
					d: ovrOf(league[a].players) - ovrOf(league[b].players),
					...net,
				});
			}
		}
		const slope = (key) => {
			const mx = mean(rows.map((r) => r.d));
			const my = mean(rows.map((r) => r[key]));
			let num = 0;
			let den = 0;
			for (const r of rows) {
				num += (r.d - mx) * (r[key] - my);
				den += (r.d - mx) ** 2;
			}
			return num / den;
		};
		console.log(
			`${rows.length} matchups x ${games} games, team ovr difference SD ${sd(rows.map((r) => r.d)).toFixed(2)}: net per ovr point off ${slope("off").toFixed(3)} on ${slope("on").toFixed(3)}; matchup net SD off ${sd(rows.map((r) => r.off)).toFixed(2)} on ${sd(rows.map((r) => r.on)).toFixed(2)}`,
		);
	},
	3_600_000,
);

// Coach Decisions: the same rosters and seeds with an elite and a poor head coach in game prep and player management (top and bottom 5% of
// the league's head coaches, CD_CAL's percentiles), the coach's game-day calls on (starters, matchups, the stopper, attacking weaknesses,
// minutes, closers, hot hand, halftime; not the season-long ones that need a record of games: form, promises, rest nights). With
// COACH_DECISIONS_ALL=1 the elite and poor coaches also differ in offense, defense, motivation and game management (ELITE / POOR), for the
// whole head coach impact with decisions. COACH_DECISIONS_IMPACT=1 npx vitest --run --project basketball <this file>
const ELITE_DECISIONS = { prp: 74, plm: 72 };
const POOR_DECISIONS = { prp: 45, plm: 31 };

test.skipIf(!process.env.COACH_DECISIONS_IMPACT)(
	"elite vs poor game prep and player management on the same roster",
	async () => {
		const numLeagues = Number(process.env.COACH_IMPACT_LEAGUES ?? 2);
		const games = Number(process.env.COACH_IMPACT_GAMES ?? 40);
		const all = !!process.env.COACH_DECISIONS_ALL;
		const diffs = [];
		let gamesPlayed = 0;
		const ALL_DELEGATED = {
			starters: true,
			rotation: true,
			minutes: true,
			matchups: true,
		};
		const putPair = async (league, pair) => {
			await genTeams();
			for (const p of await idb.cache.players.getAll()) {
				await idb.cache.players.delete(p.pid);
			}
			for (const tid of [0, 1]) {
				for (const p of league[pair * 2 + tid].players) {
					await idb.cache.players.put(structuredClone(p));
				}
			}
			g.setWithoutSavingToDB("storePlayByPlay", false);
			for (const [key, value] of Object.entries(SETTINGS)) {
				g.setWithoutSavingToDB(key, value);
			}
		};
		for (const L of range(numLeagues)) {
			const league = await genLeague({
				numPairs: 15,
				seed: 300 + L,
				settings: SETTINGS,
			});
			// How every team looks to an opposing coach (for what counts as a weak defense or a fast team)
			const reads = [];
			for (let pair = 0; pair * 2 < league.length; pair++) {
				await withSeededRandom(L * 31 + pair, async () => {
					await putPair(league, pair);
					const teams = await loadTeams([0, 1], {});
					for (const tid of [0, 1]) {
						reads[pair * 2 + tid] = readTeam(
							teams[tid].player.map((p2) =>
								decisionPlayer(p2, undefined, tid, 2025, undefined),
							),
							teams[tid].pace,
							5,
						);
					}
				});
			}
			const lgRead = leagueRead(reads);
			const mindOfTeam = (t, ratings) =>
				coachMind(
					{ ...t.head, prp: 50, plm: 50, ...ratings },
					t.profile,
					deriveDecisionTraits({
						firstName: "C",
						lastName: String(t.head.off),
						born: { year: 1970 },
						profile: t.profile,
					}),
				);
			for (let pair = 0; pair * 2 < league.length; pair++) {
				for (const side of [0, 1]) {
					const idx = pair * 2 + side;
					const won = {};
					for (const [name, ratings, head] of [
						["elite", ELITE_DECISIONS, ELITE],
						["poor", POOR_DECISIONS, POOR],
					]) {
						const sims = all
							? simWith(league, idx, head)
							: league.map((t) => t.sim);
						const minds = [0, 1].map((tid) =>
							pair * 2 + tid === idx
								? mindOfTeam(league[idx], {
										...ratings,
										...(all
											? { off: head.off, def: head.def, mot: head.mot }
											: {}),
									})
								: mindOfTeam(league[pair * 2 + tid], {}),
						);
						if (all) {
							minds[side] = { ...minds[side], mgmt: head.mgmt };
						}
						won[name] = 0;
						await withSeededRandom(
							(L * 1000 + pair) * 7919 + side * 104729,
							async () => {
								await putPair(league, pair);
								for (const i of range(games)) {
									const teams = await loadTeams([0, 1], {});
									for (const tid of [0, 1]) {
										const t = teams[tid];
										t.coachSim = { ...sims[pair * 2 + tid] };
										const plan = planCoachDecisions(
											t.player.map((p2) =>
												decisionPlayer(p2, undefined, tid, 2025, undefined),
											),
											{
												mind: minds[tid],
												numPlayersOnCourt: 5,
												playoffs: false,
												rebuilding: false,
												marquee: false,
												rivalry: false,
												opp: perceiveTeam(
													reads[pair * 2 + 1 - tid],
													minds[tid].prep,
													`${L}|${pair}|${side}|${i}|${tid}`,
												),
												league: lgRead,
												delegate: ALL_DELEGATED,
											},
										);
										applyPlan(t, plan, ALL_DELEGATED, minds[tid], false, false);
									}
									const home = i % 2;
									const result = new GameSim({
										gid: i,
										teams: [teams[home], teams[1 - home]],
										baseInjuryRate: 0,
										doPlayByPlay: false,
										homeCourtFactor: 1,
										allStarGame: false,
										neutralSite: false,
									}).run();
									const mine = result.team.find((t) => t.id === side);
									const theirs = result.team.find((t) => t.id !== side);
									if (mine.stat.pts > theirs.stat.pts) {
										won[name] += 1;
									}
								}
							},
						);
					}
					gamesPlayed += games;
					diffs.push((won.elite - won.poor) / games);
				}
			}
		}
		const m = mean(diffs);
		const se = sd(diffs) / Math.sqrt(diffs.length);
		console.log(
			`elite - poor ${all ? "head coach (all ratings, with decisions)" : "game prep and player management"}: ${(82 * m).toFixed(2)} wins per 82 (SE ${(82 * se).toFixed(2)}), ${diffs.length} rosters, ${gamesPlayed} games each`,
		);
	},
	3_600_000,
);
