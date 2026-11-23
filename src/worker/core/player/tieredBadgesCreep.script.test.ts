// @ts-nocheck (diagnostic script)
// 2K Badges tier creep: a headless league (30 teams of generated players, no games) through seasons of real development (addRatingsRow +
// develop, as the preseason does), retirements and new rookies, with updateTieredBadges each season. Prints the tier counts (the sim's
// tiers of players on teams), the counts without last season's tiers (fresh: the league's percentiles alone), how many players are over
// their badge-point cap or hold more than MAX_BADGES, and the share of badge slots with a sim effect.
//   BADGE_CREEP=1 [BADGE_CREEP_SEASONS=10] [BADGE_CREEP_SEEDS=1,2] npx vitest run --project basketball --silent=false <this file>
import { test } from "vitest";
import { draft, player, team } from "../index.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PLAYER } from "../../../common/constants.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { idb } from "../../db/index.ts";
import { badgeRowOf, updateTieredBadges } from "./tieredBadges.ts";
import {
	MAX_BADGES,
	assignTiers,
	badgePointCap,
	badgePoints,
	entryForSeason,
} from "../../../common/tieredBadges/index.ts";
import { BADGE_EFFECTS } from "../../../common/tieredBadges/effects.ts";

const env = (globalThis as any).process.env;
const NUM_TEAMS = 30;
const START = 2025;

test.skipIf(!env.BADGE_CREEP)(
	"2K badge tier counts over seasons",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		const numSeasons = Number(env.BADGE_CREEP_SEASONS ?? 10);
		const seeds = String(env.BADGE_CREEP_SEEDS ?? "1")
			.split(",")
			.map(Number);
		const all = range(numSeasons).map(() => ({
			t: [0, 0, 0, 0, 0, 0],
			fresh: [0, 0, 0, 0, 0, 0],
			overCap: 0,
			over6: 0,
			players: 0,
			slots: 0,
			simSlots: 0,
		}));
		for (const seed of seeds) {
			const original = Math.random;
			Math.random = makeSeededRandom(seed);
			resetG();
			g.setWithoutSavingToDB("season", START);
			g.setWithoutSavingToDB("numActiveTeams", NUM_TEAMS);
			// A new random league's players (createRandomPlayers, as a new league makes them)
			await resetCache({
				players: [],
				teams: helpers.getTeamsDefault().slice(0, NUM_TEAMS).map(team.generate),
			});
			const players = await createRandomPlayers({
				activeTids: range(NUM_TEAMS),
				onlyFreeAgents: false,
				scoutingLevel: DEFAULT_LEVEL,
				teams: range(NUM_TEAMS).map((tid) => ({ tid })),
			});
			for (const p of players) {
				await idb.cache.players.add(p);
			}
			for (const i of range(numSeasons)) {
				const season = START + i;
				if (i > 0) {
					g.setWithoutSavingToDB("season", season);
					for (const p of await idb.cache.players.getAll()) {
						if (p.tid < 0) {
							continue;
						}
						const age = season - p.born.year;
						if (age >= 38 || (age >= 33 && Math.random() < 0.25)) {
							p.tid = PLAYER.RETIRED;
							await idb.cache.players.put(p);
							continue;
						}
						player.addRatingsRow(p, DEFAULT_LEVEL);
						await player.develop(p, 1, false, DEFAULT_LEVEL);
						await idb.cache.players.put(p);
					}
					// Rookies: this season's draft class, best first, onto the teams with open roster spots (13)
					const rookies = (
						await draft.genPlayersWithoutSaving(season - 1, DEFAULT_LEVEL, [])
					).sort((a, b) => b.ratings[0].ovr - a.ratings[0].ovr);
					for (const tid of range(NUM_TEAMS)) {
						const roster = await idb.cache.players.indexGetAll(
							"playersByTid",
							tid,
						);
						for (let n = roster.length; n < 13 && rookies.length > 0; n++) {
							const p = rookies.shift();
							p.tid = tid;
							player.addRatingsRow(p, DEFAULT_LEVEL);
							await player.develop(p, 1, false, DEFAULT_LEVEL);
							await idb.cache.players.add(p);
						}
					}
				}
				await updateTieredBadges();
				const cutoffs = g.get("tieredBadgeCutoffs")[season];
				const row = all[i];
				for (const p of await idb.cache.players.getAll()) {
					if (p.tid < 0) {
						continue;
					}
					const e = entryForSeason(p.badges2k, season);
					if (!e) {
						continue;
					}
					const r = badgeRowOf(p);
					row.players++;
					for (const [key, tier] of Object.entries(e.t)) {
						row.t[tier]++;
						row.slots++;
						if (BADGE_EFFECTS[key]) {
							row.simSlots++;
						}
					}
					for (const tier of Object.values(
						assignTiers(r, r.ovr ?? 0, cutoffs).t,
					)) {
						row.fresh[tier]++;
					}
					if (badgePoints(e.t) > badgePointCap(r.ovr ?? 0)) {
						row.overCap++;
					}
					if (Object.keys(e.t).length > MAX_BADGES) {
						row.over6++;
					}
				}
			}
			Math.random = original;
		}
		console.log(
			"season | tiers B/S/G/HOF/L | fresh (percentiles alone) | over cap | over 6 | sim-effect share of badges",
		);
		for (const [i, row] of all.entries()) {
			console.log(
				`${START + i} | ${row.t.slice(1).join("/")} | ${row.fresh.slice(1).join("/")} | ${row.overCap} (${((100 * row.overCap) / row.players).toFixed(1)}%) | ${row.over6} | ${(row.simSlots / row.slots).toFixed(3)}`,
			);
		}
	},
);
