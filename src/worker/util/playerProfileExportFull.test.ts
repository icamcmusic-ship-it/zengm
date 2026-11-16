// Complete Profile Export (League Extras, profileExportFull): a player two seasons into a league, drafted out of college with a
// recruiting record and a college tournament, with pro playoffs, coaches, awards, an injury and transactions, gets every
// section in the JSON; nothing the pages hide gets out (scouting fuzz, the no visible ratings challenge, the secret aging
// curve, the combine's comparison with his true ratings), and League Extras that are off leave their parts out.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import {
	FULL_PROFILE_SECTIONS,
	PROFILE_SECTION_KEYS,
	PROFILE_SECTION_VERSION,
	profileToJSON,
	type PlayerProfileExport,
} from "../../common/playerProfileExport.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { profileToPdfFiles } from "../../ui/util/profilePdf.ts";
import { parseTrueType } from "../../ui/util/ttf.ts";
import { getContractDemand } from "../core/contract/index.ts";
import {
	draft,
	freeAgents,
	game,
	league,
	phase,
	player,
} from "../core/index.ts";
import { idb } from "../db/index.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import { g, helpers } from "./index.ts";
import {
	getPlayerProfileExport,
	getPlayerProfileExportSections,
} from "./playerProfileExport.ts";

let pid = -1;

const exportOf = async (
	sections?: Parameters<typeof getPlayerProfileExport>[0]["sections"],
) => {
	const profile = await getPlayerProfileExport({ pid, sections });
	assert.isDefined(profile);
	return JSON.parse(profileToJSON(profile!)) as PlayerProfileExport;
};

const allKeys = (x: unknown, out = new Set<string>()) => {
	if (Array.isArray(x)) {
		for (const y of x) {
			allKeys(y, out);
		}
	} else if (x && typeof x === "object") {
		for (const [key, value] of Object.entries(x)) {
			out.add(key);
			allKeys(value, out);
		}
	}
	return out;
};

const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = [
		...(await idb.cache.players.indexGetAll("playersByTid", tid)),
	];
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		const p = players.shift()!;
		if (p.pid === pid) {
			players.push(p);
			continue;
		}
		await player.release(p, false);
	}
	const fas = [
		...(await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)),
	];
	fas.sort((a, b) => b.value - a.value);
	while (players.length < g.get("minRosterSize")) {
		const p = fas.shift()!;
		await player.sign(p, tid, getContractDemand(p), g.get("phase"));
		await idb.cache.players.put(p);
		players.push(p);
	}
};

const playSeason = async () => {
	await fixUserRoster();
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	while (g.get("phase") <= PHASE.PLAYOFFS) {
		await fixUserRoster();
		await game.play(1, {});
	}
};

describe("Complete Profile Export", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
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
					name: "complete profile export",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						featureScoutingReports: true,
						playerTraits: true,
						numGames: 6,
						numGamesPlayoffSeries: [1, 1],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await league.setGameAttributes({
				featureScoutingReports: true,
				playerTraits: true,
			} as any);
			assert.isTrue(g.get("featureProfileExportFull" as any), "new leagues");

			// Season one, then the draft
			await playSeason();

			// The best prospect who played in a college tournament and has a recruiting record
			const prospects = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			);
			const season = g.get("season");
			const candidates = prospects
				.filter(
					(p) =>
						p.draft.year === season &&
						p.collegeSeason?.summary?.ncaa !== undefined &&
						p.preDraftCareer?.hsClass !== undefined,
				)
				.sort((a, b) => b.value - a.value);
			assert.isAbove(candidates.length, 0, "a prospect from the tournament");
			pid = candidates[0]!.pid;

			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			// He plays for the user's team (so he gets minutes and a game log)
			const p = (await idb.cache.players.get(pid))!;
			assert.isAtLeast(p.tid, 0, "drafted");
			p.tid = g.get("userTid");
			await idb.cache.players.put(p);

			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await freeAgents.play(1, {});
			}
			// Season two
			await playSeason();

			// An injury and an award he can be exported with
			const p2 = (await idb.cache.players.get(pid))!;
			p2.injuries.push({
				season: g.get("season"),
				type: "Sprained Ankle",
				games: 3,
			} as any);
			p2.awards.push({ season: g.get("season"), type: "All-Star" } as any);
			await idb.cache.players.put(p2);
		},
		15 * 60 * 1000,
	);

	test(
		"every section, with college, recruiting, tournaments, playoffs, coaches, awards, injuries and transactions",
		{ timeout: 300_000 },
		async () => {
			const profile = await exportOf();
			assert.isTrue(profile.complete);
			assert.deepEqual(profile.skipped, []);
			for (const key of PROFILE_SECTION_KEYS) {
				const s = profile.sections[key];
				assert.isDefined(s, key);
				assert.strictEqual(s!.version, PROFILE_SECTION_VERSION, key);
			}
			const sec = profile.sections;
			const titles = (key: keyof typeof sec) =>
				sec[key]!.tables.map((t) => t.title);

			// College/Overseas: season by season with coaches and the tournament, the draft stock
			assert.include(titles("preDraft"), "Season by season");
			assert.include(titles("preDraft"), "Draft stock");

			// Recruiting: his high school class, stars and rank, offers, where he committed, his path
			const recruiting = sec.recruiting!.data as any;
			assert.isDefined(recruiting.highSchool.classOf);
			assert.isAbove(recruiting.highSchool.offers.length, 0);
			assert.isString(recruiting.highSchool.committed);
			assert.isTrue(sec.recruiting!.facts.some((f) => f.label === "Stars"));
			assert.include(titles("recruiting"), "Path to the pros");

			// Tournaments: his college tournament (seed, result, games) and the pro playoffs by season
			const post = sec.postseason!.data as any;
			const ncaa = post.collegeTournaments.find(
				(t: any) => t.ncaa !== undefined,
			);
			assert.isDefined(ncaa, "NCAA tournament");
			assert.isNumber(ncaa.ncaaSeed);
			assert.include(titles("postseason"), "College tournaments");
			assert.include(titles("postseason"), "Playoffs by season");
			assert.isAbove(post.playoffs.length, 0);
			assert.isString(post.playoffs[0].result);

			// Coaches: his head and development coaches each pro season, his college coaches
			const coaches = sec.coaches!.data as any;
			assert.isAbove(coaches.bySeason.length, 0);
			assert.isAbove(coaches.bySeason.at(-1).head.length, 0);
			assert.isAbove(coaches.preDraft.length, 0);
			assert.include(titles("coaches"), "Coaches by season");

			// Awards, injuries, transactions and news
			const awards = sec.awards!.data as any;
			assert.isTrue(awards.byType.some((a: any) => a.type === "All-Star"));
			assert.isTrue(
				sec.injuries!.tables[0]!.rows.some(
					(row) => row[1] === "Sprained Ankle",
				),
			);
			const events = (sec.transactions!.data as any).events as {
				text: string;
			}[];
			assert.isTrue(
				events.some((e) => /draft/i.test(e.text)),
				"draft event",
			);
			assert.include(titles("transactions"), "All news");

			// Tracking profile, contract details and mood history, legacy (GOAT Lab, face history)
			assert.include(titles("tracking"), "Shooting");
			assert.include(titles("contract"), "Contract by season");
			const legacy = sec.legacy!.data as any;
			assert.isNumber(legacy.goat.rank);
			assert.isAbove(legacy.faceHistory.length, 0);
		},
	);

	test("hidden information does not leak", { timeout: 300_000 }, async () => {
		const pRaw = (await idb.cache.players.get(pid))!;
		const profile = await exportOf();
		const json = JSON.stringify(profile);

		// The combine's over/under-performance is measured against his true ratings
		assert.notInclude(json, '"performance"');
		// The secret aging curve stays hidden while he plays
		assert.notInclude(json, '"agingCurve":{');
		// His hidden trait scores and seeds never leave the worker
		const keysAll = allKeys(profile);
		for (const key of [
			"subP",
			"draftClassShape",
			"draftClassShapeInjury",
			"valueFuzz",
			"preDraftCareer",
		]) {
			assert.isFalse(keysAll.has(key), key);
		}
		// Ratings are the scouted ones: no true value where it differs from the fuzzed one
		const r = pRaw.ratings.at(-1)! as any;
		const current = (profile.sections.ratings!.data as any).current;
		assert.strictEqual(current.ovr, player.fuzzRating(r.ovr, r.fuzz));

		// No visible ratings challenge: nothing rating-based in any section but the (hidden) ratings section
		await league.setGameAttributes({ challengeNoRatings: true });
		try {
			const hidden = await exportOf();
			assert.isFalse(hidden.visibility.ratingsShown);
			const { ratings: _ratings, ...others } = hidden.sections;
			const keys = allKeys(others);
			for (const key of [
				"ovr",
				"pot",
				"skills",
				"badges",
				"fuzz",
				"archetype",
				"ratings",
				"peak",
				"systemFit",
				"ovrAtDraft",
				"peakOvr",
			]) {
				assert.isFalse(keys.has(key), key);
			}
			const factLabels = Object.values(hidden.sections).flatMap((s) =>
				s!.facts.map((f) => f.label),
			);
			for (const label of [
				"Ovr / Pot",
				"Archetype",
				"Projected peak",
				"Fit with his systems",
				"Scouted ovr range",
			]) {
				assert.notInclude(factLabels, label);
			}
			for (const t of Object.values(hidden.sections).flatMap(
				(s) => s!.tables,
			)) {
				assert.notInclude(t.cols, "Ovr at draft", t.title);
				assert.notInclude(t.cols, "Peak ovr", t.title);
			}
		} finally {
			await league.setGameAttributes({ challengeNoRatings: false });
		}
	});

	test(
		"League Extras that are off leave their parts out",
		{ timeout: 300_000 },
		async () => {
			const before = {
				featureProfileExportFull: g.get("featureProfileExportFull" as any),
				advStats: g.get("advStats" as any),
				featureFaceAging: g.get("featureFaceAging" as any),
				featureRivalryStories: g.get("featureRivalryStories" as any),
				featureAwardVote: g.get("featureAwardVote" as any),
				coachingStaff: g.get("coachingStaff" as any),
				showPlayerNicknames: g.get("showPlayerNicknames" as any),
			};
			try {
				await league.setGameAttributes({
					advStats: false,
					featureFaceAging: false,
					featureRivalryStories: false,
					featureAwardVote: false,
					coachingStaff: false,
					showPlayerNicknames: false,
				} as any);
				const some = await exportOf();
				assert.isTrue(some.skipped.some((s) => s.key === "tracking"));
				const legacy = some.sections.legacy?.data as any;
				assert.isUndefined(legacy?.faceHistory);
				assert.isUndefined(legacy?.rivalries);
				assert.isUndefined((some.sections.awards!.data as any).votes);
				// Coaching Staff off: only his college coaches
				assert.isUndefined((some.sections.coaches!.data as any).bySeason);
				assert.isUndefined((some.sections.overview!.data as any).nickname);
				assert.isFalse(
					some.sections.overview!.facts.some((f) => f.label === "Nickname"),
				);

				await league.setGameAttributes({
					featureProfileExportFull: false,
				} as any);
				const short = await exportOf();
				assert.isFalse(short.complete);
				for (const key of FULL_PROFILE_SECTIONS) {
					assert.isUndefined(short.sections[key], key);
					assert.isTrue(
						short.skipped.some((s) => s.key === key),
						key,
					);
				}
				assert.strictEqual(short.sections.overview!.version, 1);
				assert.isUndefined((short.sections.awards!.data as any).byType);
				const dialog = await getPlayerProfileExportSections(pid);
				for (const key of FULL_PROFILE_SECTIONS) {
					assert.isDefined(dialog!.find((s) => s.key === key)!.reason, key);
				}
			} finally {
				await league.setGameAttributes(before as any);
			}
		},
	);

	test(
		"PDF: one per section with something in it, the new sections included",
		{ timeout: 300_000 },
		async () => {
			const fonts = {
				regular: parseTrueType(
					readFileSync("public/fonts/DejaVuSans-latin.ttf"),
				),
				bold: parseTrueType(
					readFileSync("public/fonts/DejaVuSans-Bold-latin.ttf"),
				),
			};
			const profile = (await getPlayerProfileExport({ pid }))!;
			const files = await profileToPdfFiles(profile, undefined, fonts);
			const names = files.map((f) => f.name);
			for (const name of [
				"12_tracking.pdf",
				"13_recruiting.pdf",
				"14_playoffs_tournaments.pdf",
				"15_coaches.pdf",
				"16_legacy.pdf",
			]) {
				assert.include(names, name);
			}
			for (const file of files) {
				const text = new TextDecoder("latin1").decode(file.bytes);
				assert.isTrue(text.startsWith("%PDF-"), file.name);
				assert.isTrue(text.trimEnd().endsWith("%%EOF"), file.name);
			}
		},
	);
});
