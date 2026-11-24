// @ts-nocheck (diagnostic script)
// All-Star selection stress test: real leagues (new-league defaults, short seasons) played to the All-Star break under many
// settings, the All-Stars picked, then (in some) All-Stars injured, traded, released or retired before the game, and the game
// played. Checks the invariants in testHelpers.ts and prints the quality numbers per league. Opt-in:
// ASG_STRESS=1 [ASG_STRESS_CONFIGS=default,noVote,...] [ASG_STRESS_SEEDS=1,2] [ASG_STRESS_GAMES=24] [ASG_STRESS_OUT=/tmp/out.json]
//   node_modules/.bin/vitest run --maxWorkers=1 --project basketball src/worker/core/allStar/selection.script.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { writeFileSync } from "node:fs";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { allStar, game, league, phase, player } from "../index.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import create from "./create.ts";
import nextGameIsAllStar from "./nextGameIsAllStar.ts";
import {
	checkInvariants,
	playingEntries,
	qualityReport,
} from "./testHelpers.ts";

const env = (globalThis as any).process.env;

type Config = {
	settings?: Record<string, unknown>;
	numTeams?: number;
	numConfs?: number;
	// After the selection, before the game: injure, trade, release and retire All-Stars
	perturb?: boolean;
};

const CONFIGS: Record<string, Config> = {
	default: {},
	noVote: { settings: { allStarVote: false } },
	top: { settings: { allStarType: "top" } },
	topNoVote: { settings: { allStarType: "top", allStarVote: false } },
	draft: { settings: { allStarType: "draft" } },
	draftNoVote: { settings: { allStarType: "draft", allStarVote: false } },
	tournament: { settings: { allStarType: "tournament" } },
	tournamentNoVote: {
		settings: { allStarType: "tournament", allStarVote: false },
	},
	oneConf: { numConfs: 1 },
	threeConfs: { numConfs: 3 },
	threeConfsNoVote: { numConfs: 3, settings: { allStarVote: false } },
	small4: { numTeams: 4 },
	small4NoVote: { numTeams: 4, settings: { allStarVote: false } },
	small6Draft: { numTeams: 6, settings: { allStarType: "draft" } },
	small8Odd: { numTeams: 8, settings: { allStarNum: 7 } },
	odd: { settings: { allStarNum: 9 } },
	oddNoVote: { settings: { allStarNum: 9, allStarVote: false } },
	early: { settings: { allStarGame: 0.1 } },
	earlyNoVote: { settings: { allStarGame: 0.1, allStarVote: false } },
	injuries: { settings: { injuryRate: 0.025 } },
	injuriesNoVote: { settings: { injuryRate: 0.025, allStarVote: false } },
	perturb: { perturb: true },
	perturbNoVote: { perturb: true, settings: { allStarVote: false } },
	perturbTournament: { perturb: true, settings: { allStarType: "tournament" } },
	perturbDraft: { perturb: true, settings: { allStarType: "draft" } },
	spectator: { settings: { spectator: true } },
};

const makeTeams = (numTeams: number | undefined, numConfs: number) => {
	let teams = helpers.getTeamsDefault();
	if (numTeams !== undefined) {
		teams = teams.slice(0, numTeams);
	}
	if (numConfs === 2 && numTeams === undefined) {
		return {
			teams,
			confs: last(defaultGameAttributes.confs).value,
			divs: last(defaultGameAttributes.divs).value,
		};
	}
	const confs = Array.from({ length: numConfs }, (_, cid) => ({
		cid,
		name: `Conference ${cid + 1}`,
	}));
	const divs = confs.map((c) => ({
		did: c.cid,
		cid: c.cid,
		name: `Division ${c.cid + 1}`,
	}));
	teams = teams.map((t, tid) => ({
		...t,
		tid,
		cid: tid % numConfs,
		did: tid % numConfs,
	}));
	return { teams, confs, divs };
};

let lid = 0;
const runLeague = async (name: string, config: Config, seed: number) => {
	Math.random = makeSeededRandom(seed);
	const { teams, confs, divs } = makeTeams(
		config.numTeams,
		config.numConfs ?? 2,
	);
	const small = teams.length < 16;
	await league.createStream(
		{},
		{
			confs,
			divs,
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
			lid: lid++,
			name: `stress-${name}-${seed}`,
			setLeagueCreationStatus: () => {},
			settings: {
				...getDefaultSettings(),
				numGames: Number(env.ASG_STRESS_GAMES ?? 24),
				...(small ? { numGamesPlayoffSeries: [1], numPlayoffByes: 0 } : {}),
				...config.settings,
			},
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(teams),
			tid: 0,
		},
	);
	await league.loadGameAttributes();
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	await lock.set("gameSim", false);

	let guard = 0;
	while (!(await nextGameIsAllStar()) && guard < 200) {
		await game.play(1, {});
		guard += 1;
	}
	assert.isTrue(await nextGameIsAllStar(), "reached the All-Star break");

	const season = g.get("season");
	const problems: string[] = [];

	// The same league picks the same All-Stars for the same seed (whole leagues differ run to run: the league salt is from
	// crypto). The awards of the trial picks are taken back
	const trial = async () => {
		Math.random = makeSeededRandom(1000 + seed);
		const picked = await create({});
		for (const p of await idb.cache.players.getAll()) {
			const n = p.awards.length;
			p.awards = p.awards.filter(
				(a) => a.type !== "All-Star" || a.season !== season,
			);
			if (p.awards.length !== n) {
				await idb.cache.players.put(p);
			}
		}
		return JSON.stringify([picked.teams, picked.remaining, picked.tournament]);
	};
	const first = await trial();
	const second = await trial();
	if (first !== second) {
		problems.push("selection: not deterministic for the seed");
	}

	const allStars = await allStar.getOrCreate(season);
	problems.push(
		...(await checkInvariants(allStars, "selection")).map(
			(p) => `selection: ${p}`,
		),
	);
	const quality = await qualityReport(allStars);
	const selected = playingEntries(allStars).map((p) => p.pid);

	if (config.perturb) {
		const playing = playingEntries(await idb.cache.allStars.get(season));
		const get = (i: number) => idb.cache.players.get(playing[i]!.pid);
		const injured = await get(0);
		injured.injury = { type: "Sprained Ankle", gamesRemaining: 5 };
		await idb.cache.players.put(injured);
		const traded = await get(1);
		traded.tid = (traded.tid + 1) % g.get("numActiveTeams");
		await idb.cache.players.put(traded);
		await player.release(await get(2), false);
		await player.retire(await get(3), {}, { logRetiredEvent: false });
		await idb.cache.players.put(await get(3));
	}

	let played = false;
	const ready = await allStar.prepareGame({});
	const after = await idb.cache.allStars.get(season);
	problems.push(
		...(await checkInvariants(after, "game")).map((p) => `game: ${p}`),
	);
	let numReplacements = after.teams.flat().filter((p) => p.replacement).length;
	guard = 0;
	while ((await nextGameIsAllStar()) && guard < 3) {
		await game.play(1, {});
		guard += 1;
	}
	const final = await idb.cache.allStars.get(season);
	played = final.gid !== undefined;
	if (ready !== played) {
		problems.push(`prepareGame said ${ready}, game played ${played}`);
	}
	problems.push(
		...(await checkInvariants(final, "final")).map((p) => `final: ${p}`),
	);
	numReplacements = final.teams.flat().filter((p) => p.replacement).length;

	return {
		name,
		seed,
		numTeams: teams.length,
		type: final.type,
		selectionType: allStars.type,
		played,
		numReplacements,
		problems,
		quality,
		selected,
	};
};

test.skipIf(!env.ASG_STRESS)(
	"All-Star selection under many settings",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		const names = env.ASG_STRESS_CONFIGS
			? env.ASG_STRESS_CONFIGS.split(",")
			: Object.keys(CONFIGS);
		const seeds = (env.ASG_STRESS_SEEDS ?? "1").split(",").map(Number);
		const results = [];
		for (const name of names) {
			for (const seed of seeds) {
				const result = await runLeague(name, CONFIGS[name], seed);
				results.push(result);
				console.log(JSON.stringify({ ...result, selected: undefined }));
			}
		}
		if (env.ASG_STRESS_OUT) {
			writeFileSync(env.ASG_STRESS_OUT, JSON.stringify(results, null, 1));
		}
		const failures = results.filter((r) => r.problems.length > 0);
		assert.deepEqual(
			failures.map((r) => `${r.name}/${r.seed}: ${r.problems.join("; ")}`),
			[],
		);
	},
);
