// Export profile in a headless league: every section is there for each kind of player (or skipped with a reason), and nothing
// the player pages hide gets out: ratings are the scouted ones (none under the no visible ratings challenge), unknown traits
// have no score, the aging curve stays secret until retirement. Also a smoke test of the PDF set and the zip.
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
	PROFILE_EXPORT_FORMAT,
	PROFILE_EXPORT_SCHEMA_VERSION,
	PROFILE_SECTION_KEYS,
	profileToJSON,
	type PlayerProfileExport,
} from "../../common/playerProfileExport.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { profileToPdfFiles } from "../../ui/util/profilePdf.ts";
import { parseTrueType } from "../../ui/util/ttf.ts";
import { makeZip } from "../../ui/util/zip.ts";
import { game, league, phase, player } from "../core/index.ts";
import fuzzRating from "../core/player/fuzzRating.ts";
import { idb } from "../db/index.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import { g, helpers } from "./index.ts";
import {
	getPlayerProfileExport,
	getPlayerProfileExportSections,
} from "./playerProfileExport.ts";

const pids = { active: -1, prospect: -1, freeAgent: -1, retired: -1 };

const exportOf = async (pid: number) => {
	const profile = await getPlayerProfileExport({ pid });
	assert.isDefined(profile);
	// What the JSON file has, round tripped
	return JSON.parse(profileToJSON(profile!)) as PlayerProfileExport;
};

// Every key anywhere in the JSON
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

describe("Export profile", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(7);
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
					name: "profile export",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						featureScoutingReports: true,
						playerTraits: true,
						numGames: 4,
						numGamesPlayoffSeries: [1],
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
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await game.play(2, {});

			const players = await idb.cache.players.indexGetAll("playersByTid", [
				0,
				Infinity,
			]);
			players.sort((a, b) => b.valueNoPot - a.valueNoPot);
			pids.active = players[0]!.pid;
			const prospects = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			);
			// A prospect whose scouted ratings differ from the true ones
			const prospect = prospects.find(
				(p) => Math.abs(p.ratings.at(-1)!.fuzz) >= 2,
			)!;
			pids.prospect = prospect.pid;
			const freeAgents = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.FREE_AGENT,
			);
			pids.freeAgent = freeAgents[0]!.pid;
			const toRetire = players[5]!;
			await player.retire(toRetire, {}, { logRetiredEvent: false });
			await idb.cache.players.put(toRetire);
			pids.retired = toRetire.pid;
		},
		10 * 60 * 1000,
	);

	test("format, league context and every section for an active player", async () => {
		const profile = await exportOf(pids.active);
		assert.strictEqual(profile.format, PROFILE_EXPORT_FORMAT);
		assert.strictEqual(profile.schemaVersion, PROFILE_EXPORT_SCHEMA_VERSION);
		assert.strictEqual(profile.league.season, g.get("season"));
		assert.strictEqual(profile.league.phase, PHASE.REGULAR_SEASON);
		assert.isFalse(profile.league.college);
		assert.strictEqual(profile.league.userTeam?.tid, g.get("userTid"));
		assert.strictEqual(profile.player.pid, pids.active);
		assert.strictEqual(profile.player.status, "active");
		assert.isUndefined((profile as any).card);
		assert.isUndefined((profile as any).scoutingPage);
		for (const key of PROFILE_SECTION_KEYS) {
			if (key === "preDraft" && !profile.sections.preDraft) {
				// Only with college/overseas stats
				assert.isTrue(profile.skipped.some((s) => s.key === "preDraft"));
				continue;
			}
			assert.isDefined(profile.sections[key], key);
		}
		assert.isAbove(profile.sections.stats!.tables.length, 0);
		assert.isAbove(profile.sections.gameLog!.tables[0]!.rows.length, 0);
		assert.isAbove(profile.sections.ratings!.tables[0]!.rows.length, 0);
		assert.isDefined(profile.sections.contract!.data);
		const scouting = profile.sections.scouting!.data as any;
		assert.strictEqual(scouting.report.pid, pids.active);
		assert.isUndefined(scouting.report.take);
		// The aging curve is secret until he retires
		assert.isUndefined((profile.sections.traits!.data as any).agingCurve);
	});

	test("prospect: scouted ratings, unknown traits without scores, no game log or contract", async () => {
		const profile = await exportOf(pids.prospect);
		assert.strictEqual(profile.player.status, "prospect");
		assert.deepEqual(
			profile.skipped.map((s) => s.key).sort(),
			["contract", "gameLog"]
				.concat(profile.sections.preDraft ? [] : ["preDraft"])
				.sort(),
		);
		const p = (await idb.merged.players.get(pids.prospect))!;
		const r = p.ratings.at(-1)! as any;
		const current = (profile.sections.ratings!.data as any).current;
		let differs = 0;
		for (const key of ["ovr", "pot", "spd", "tp", "oiq", "diq"] as const) {
			assert.strictEqual(current[key], fuzzRating(r[key], r.fuzz), key);
			if (current[key] !== r[key]) {
				differs += 1;
			}
		}
		assert.isAbove(differs, 0);
		const readings = (profile.sections.traits!.data as any).readings;
		assert.isAbove(readings.length, 0);
		for (const t of readings) {
			if (!t.exact) {
				assert.notProperty(t, "score");
				assert.match(t.reading, /^\d+-\d+\?$/);
			}
		}
		assert.notInclude(JSON.stringify(profile), '"agingCurve":{');
	});

	test("free agent and retired player", async () => {
		const fa = await exportOf(pids.freeAgent);
		assert.strictEqual(fa.player.status, "freeAgent");
		assert.isDefined(fa.sections.contract);
		const retired = await exportOf(pids.retired);
		assert.strictEqual(retired.player.status, "retired");
		assert.isUndefined(retired.sections.contract);
		assert.isTrue(retired.skipped.some((s) => s.key === "contract"));
		assert.isDefined((retired.sections.traits!.data as any).agingCurve);
		const sections = await getPlayerProfileExportSections(pids.retired);
		assert.isDefined(sections!.find((s) => s.key === "contract")!.reason);
	});

	test("only the chosen sections", async () => {
		const profile = await getPlayerProfileExport({
			pid: pids.active,
			sections: ["overview", "traits"],
		});
		assert.deepEqual(Object.keys(profile!.sections).sort(), [
			"overview",
			"traits",
		]);
	});

	test("no visible ratings challenge: no ratings anywhere, except for retired players", async () => {
		await league.setGameAttributes({ challengeNoRatings: true });
		try {
			for (const pid of [pids.active, pids.prospect, pids.freeAgent]) {
				const profile = await exportOf(pid);
				assert.isFalse(profile.visibility.ratingsShown);
				const { ratings: ratingsSection, ...otherSections } = profile.sections;
				const keys = allKeys({ ...profile, sections: otherSections });
				keys.delete("ratings");
				for (const key of [
					"ovr",
					"pot",
					"skills",
					"badges",
					"fuzz",
					"archetype",
				]) {
					assert.isFalse(keys.has(key), `${pid} ${key}`);
				}
				assert.isFalse(allKeys(otherSections).has("ratings"), `${pid} ratings`);
				assert.isUndefined(ratingsSection!.data);
				assert.strictEqual(profile.sections.ratings!.tables.length, 0);
			}
			const retired = await exportOf(pids.retired);
			assert.isTrue(retired.visibility.ratingsShown);
			assert.isAbove(retired.sections.ratings!.tables.length, 0);
		} finally {
			await league.setGameAttributes({ challengeNoRatings: false });
		}
	});

	test("college league: no contract, pro draft or scouting reports", async () => {
		const before = g.get("leagueType");
		g.setWithoutSavingToDB("leagueType", "college");
		try {
			const profile = await exportOf(pids.active);
			assert.isTrue(profile.league.college);
			assert.isUndefined(profile.sections.contract);
			assert.isUndefined(profile.sections.scouting);
			const skipped = profile.skipped.map((s) => s.key);
			assert.include(skipped, "contract");
			assert.include(skipped, "scouting");
			assert.strictEqual(profile.player.draft.year, 0);
			assert.isFalse(
				profile.sections.overview!.facts.some((f) => f.label === "Contract"),
			);
		} finally {
			g.setWithoutSavingToDB("leagueType", before);
		}
	});

	test("PDF set: one valid PDF per section, zipped", async () => {
		const fonts = {
			regular: parseTrueType(readFileSync("public/fonts/DejaVuSans-latin.ttf")),
			bold: parseTrueType(
				readFileSync("public/fonts/DejaVuSans-Bold-latin.ttf"),
			),
		};
		for (const pid of [pids.active, pids.prospect, pids.retired]) {
			const profile = (await getPlayerProfileExport({ pid }))!;
			const files = await profileToPdfFiles(profile, undefined, fonts);
			assert.strictEqual(files.length, Object.keys(profile.sections).length);
			assert.strictEqual(files[0]!.name, "01_overview.pdf");
			for (const file of files) {
				const text = new TextDecoder("latin1").decode(file.bytes);
				assert.isTrue(text.startsWith("%PDF-"), file.name);
				assert.isTrue(text.trimEnd().endsWith("%%EOF"), file.name);
				assert.match(text, /\/Type \/Page\b/, file.name);
				assert.isAbove(file.bytes.length, 2000, file.name);
			}
			if (profile.sections.scouting) {
				assert.isTrue(files.some((f) => f.name === "07_scouting.pdf"));
			}
			const zip = makeZip(files);
			assert.strictEqual(zip[0], 0x50);
			assert.strictEqual(zip[1], 0x4b);
		}
	});
});
