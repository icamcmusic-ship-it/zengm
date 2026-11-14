// Not a real test: perf3's preseason relabel (only players whose label inputs moved, archetype.ts RELABEL_TOL) against relabeling
// everyone. Plays a new league (every extra on) for some seasons and, at each preseason, reads every player who kept his label
// afresh (from the same previous label) to count the labels that would have been different, and times the update. Skipped unless
// ARCH_RELABEL is set:
//
//   ARCH_RELABEL=1 ARCH_RELABEL_SEASONS=3 ARCH_RELABEL_SEED=1 [ARCH_RELABEL_ALL=1] node_modules/.bin/vitest run --project basketball \
//     src/worker/core/player/archetypeRelabel.script.test.ts
//
// ARCH_RELABEL_ALL=1 relabels everyone (as before perf3), for the time. Appends "ARCH_RELABEL {...}" lines to ARCH_RELABEL_OUT.
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
import { currentEntry } from "../../../common/archetypes/index.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import {
	getLeagueNorms,
	preseasonRelabelStats,
	setPreseasonRelabelAll,
	setRelabelTolerance,
	storeArchetype,
} from "./archetype.ts";

const env = (globalThis as any).process.env;

describe.skipIf(!env.ARCH_RELABEL)("preseason relabel", () => {
	test("labels and time", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(Number(env.ARCH_RELABEL_SEED ?? 1));
		const all = !!env.ARCH_RELABEL_ALL;
		setPreseasonRelabelAll(all);
		// ARCH_RELABEL_TOL='{"rMean":2}': other tolerances (archetype.ts RELABEL_TOL)
		if (env.ARCH_RELABEL_TOL) {
			setRelabelTolerance(JSON.parse(env.ARCH_RELABEL_TOL));
		}
		const settings: any = getDefaultSettings();
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
		}
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
				name: "relabel",
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		const play = async (numDays: number) => {
			await lock.set("gameSim", false);
			await game.play(numDays, {});
		};
		const seasons = Number(env.ARCH_RELABEL_SEASONS ?? 3);
		for (let i = 0; i < seasons; i++) {
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await play(await season.getDaysLeftSchedule());
			await play(100);
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			preseasonRelabelStats.players = 0;
			preseasonRelabelStats.read = 0;
			preseasonRelabelStats.ms = 0;
			// (the free agency days run into the preseason)
			await freeAgents.play(g.get("daysLeft"), {});
			await phase.newPhase(PHASE.PRESEASON, {});
			const stats = {
				...preseasonRelabelStats,
				why: { ...preseasonRelabelStats.why },
			};
			const keptPids = new Set(preseasonRelabelStats.kept);
			// Everyone who kept his label, read afresh from the same previous label
			const newSeason = g.get("season");
			const norms = await getLeagueNorms();
			const players = (await idb.cache.players.getAll()).filter(
				(p) => p.tid !== PLAYER.RETIRED && p.tid !== PLAYER.UNDRAFTED,
			);
			let kept = 0;
			let differ = 0;
			let differFamily = 0;
			const examples: string[] = [];
			for (const p of players) {
				const e = currentEntry(p.archetypes);
				if (!e || e.season !== newSeason) {
					continue;
				}
				const before = p.archetypes!.filter((x) => x.season < newSeason);
				const prev = currentEntry(before);
				if (!prev || !keptPids.has(p.pid)) {
					continue;
				}
				kept += 1;
				const copy = structuredClone(p);
				copy.archetypes = structuredClone(before);
				storeArchetype(copy, norms, false);
				const full = currentEntry(copy.archetypes)!;
				if (full.id !== e.id) {
					differ += 1;
					if (examples.length < 8) {
						examples.push(`${p.pid} ${e.id} -> ${full.id}`);
					}
				}
				if (full.tier !== e.tier) {
					differFamily += 1;
				}
			}
			appendFileSync(
				env.ARCH_RELABEL_OUT ?? "/tmp/archRelabel.jsonl",
				`ARCH_RELABEL ${JSON.stringify({
					all,
					tol: env.ARCH_RELABEL_TOL,
					season: newSeason,
					players: stats.players,
					read: stats.read,
					why: stats.why,
					kept,
					differ,
					tierDiffer: differFamily,
					ms: Math.round(stats.ms),
					examples,
				})}\n`,
			);
		}
	});
});
