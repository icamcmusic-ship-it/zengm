// Download season data and Export team season in a headless spectator league after one short season with playoffs: every part of
// the season pack (games, playoff rounds, team game logs, standings after each day that end where the standings do), every section
// of the team export, the CSV files and data dictionaries, and no leaks: scouted ratings, nothing rating-derived under the no
// visible ratings challenge, GM leanings only as words outside God Mode, nothing the pages hide.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	SEASON_PACK_CHUNK,
	SEASON_PACK_FORMAT,
	buildSeasonPack,
	seasonPackCSVFiles,
	seasonPackToJSON,
	type SeasonPack,
} from "../../../common/seasonExport.ts";
import {
	TEAM_EXPORT_FORMAT,
	TEAM_SECTION_KEYS,
	mergeTeamExports,
	teamExportCSVFiles,
	teamExportToJSON,
	type TeamSeasonExport,
} from "../../../common/teamExport.ts";
import { last } from "../../../common/utils.ts";
import { makeZip } from "../../../ui/util/zip.ts";
import { game, league, phase } from "../../core/index.ts";
import fuzzRating from "../../core/player/fuzzRating.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../index.ts";
import {
	getTeamSeasonExport,
	getTeamSeasonExportSections,
} from "../teamExport/index.ts";
import { getSeasonPackGames, getSeasonPackInfo } from "./index.ts";

const SEASON = 2025;

const makePack = async (season: number): Promise<SeasonPack> => {
	const info = await getSeasonPackInfo({ season });
	const chunks = [];
	for (let i = 0; i < info.gids.length; i += SEASON_PACK_CHUNK) {
		chunks.push(
			await getSeasonPackGames({
				season,
				gids: info.gids.slice(i, i + SEASON_PACK_CHUNK),
			}),
		);
	}
	// Round trip through JSON, like the file
	return JSON.parse(seasonPackToJSON(buildSeasonPack(info, chunks)));
};

const exportOf = async (tid: number, season = SEASON) => {
	const x = await getTeamSeasonExport({ tid, season });
	assert.isDefined(x);
	return JSON.parse(teamExportToJSON(x!)) as TeamSeasonExport;
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

// A simple CSV reader for the checks (quoted fields with commas, doubled quotes)
const parseCSV = (text: string) =>
	text.split("\n").map((line) => {
		const out: string[] = [];
		let cur = "";
		let quoted = false;
		for (let i = 0; i < line.length; i++) {
			const c = line[i]!;
			if (quoted) {
				if (c === '"' && line[i + 1] === '"') {
					cur += '"';
					i += 1;
				} else if (c === '"') {
					quoted = false;
				} else {
					cur += c;
				}
			} else if (c === '"') {
				quoted = true;
			} else if (c === ",") {
				out.push(cur);
				cur = "";
			} else {
				cur += c;
			}
		}
		out.push(cur);
		return out;
	});

let playoffTid = -1;

describe(
	"Season data pack and team season export",
	{ timeout: 240_000 },
	() => {
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
						name: "season export",
						setLeagueCreationStatus: () => {},
						settings: {
							...getDefaultSettings(),
							// (AI-run user team, so game.play never stops for a short roster)
							spectator: true,
							numGames: 12,
							numGamesPlayoffSeries: [1, 1],
						} as any,
						shuffleRosters: false,
						startingSeasonFromInput: String(SEASON),
						teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
						tid: 0,
					},
				);
				await league.loadGameAttributes();
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				// (a guard: game.play refuses to sim, and this would spin forever, if a roster is short)
				for (let i = 0; g.get("phase") <= PHASE.PLAYOFFS; i++) {
					if (i > 300) {
						throw new Error("season did not finish");
					}
					await game.play(1, {});
				}
				const ps = await idb.merged.playoffSeries.get(SEASON);
				playoffTid = ps!.series[0]![0]!.home.tid;
			},
			10 * 60 * 1000,
		);

		test("season pack: games, playoff rounds, team game logs", async () => {
			const pack = await makePack(SEASON);
			assert.strictEqual(pack.format, SEASON_PACK_FORMAT);
			assert.strictEqual(pack.schemaVersion, 1);
			assert.strictEqual(pack.league.season, SEASON);
			assert.strictEqual(pack.teams.length, g.get("numActiveTeams"));
			const regular = pack.games.filter((gm) => gm.type === "regularSeason");
			assert.strictEqual(regular.length, (pack.teams.length * 12) / 2);
			assert.strictEqual(pack.counts.games, pack.games.length);
			assert.strictEqual(pack.teamLogs.length, 2 * pack.games.length);

			// Sorted by day; every game has a day, attendance and a winner or a tie
			for (const [i, gm] of pack.games.entries()) {
				assert.isNumber(gm.day);
				if (i > 0) {
					assert.isAtLeast(gm.day!, pack.games[i - 1]!.day!);
				}
				assert.isAbove(gm.att, 0);
				assert.isTrue(
					gm.tie || gm.winnerTid === gm.homeTid || gm.winnerTid === gm.awayTid,
				);
			}

			// Playoffs: rounds named, game numbers in the series
			const playoffs = pack.games.filter((gm) => gm.type === "playoffs");
			assert.isAbove(playoffs.length, 0);
			for (const gm of playoffs) {
				assert.isNumber(gm.round);
				assert.isString(gm.roundName);
				assert.strictEqual(gm.gameInSeries, 1);
			}
			assert.isTrue(playoffs.some((gm) => gm.roundName === "Finals"));
			for (const gm of pack.games.filter((x) => x.type === "playIn")) {
				assert.strictEqual(gm.round, -1);
			}

			// Team logs: both teams, box score totals, never the team rating stored with the game
			const log = pack.teamLogs[0]!;
			assert.isAbove(Object.keys(log.stats).length, 10);
			for (const key of [
				"fg",
				"fga",
				"tp",
				"tpa",
				"ft",
				"fta",
				"orb",
				"drb",
				"ast",
			]) {
				assert.property(log.stats, key);
			}
			assert.isFalse(allKeys(pack).has("ovr"));
			assert.isFalse(allKeys(pack).has("forceWin"));
			assert.match(log.ptsByPeriod, /^\d+(-\d+)+$/);
		});

		test("season pack: standings after each day end where the standings do", async () => {
			const pack = await makePack(SEASON);
			const days = [...new Set(pack.standingsHistory.map((row) => row.day))];
			assert.strictEqual(days.length, pack.counts.days);
			assert.strictEqual(
				days.length,
				new Set(
					pack.games
						.filter((gm) => gm.type === "regularSeason")
						.map((gm) => gm.day),
				).size,
			);
			const lastDay = days.at(-1)!;
			const final = pack.standingsHistory.filter((row) => row.day === lastDay);
			assert.strictEqual(final.length, pack.teams.length);
			const teamSeasons = await idb.merged.teamSeasons.getAll({
				season: SEASON,
			});
			for (const row of final) {
				const ts = teamSeasons.find((x) => x.tid === row.tid)!;
				assert.strictEqual(row.won, ts.won, `${row.abbrev} won`);
				assert.strictEqual(row.lost, ts.lost, `${row.abbrev} lost`);
				assert.strictEqual(row.gp, 12);
			}
			// Ranks and games back: the leader is 0 back, ranks 1..n
			assert.strictEqual(
				final.find((row) => row.leagueRank === 1)!.gbLeague,
				0,
			);
			assert.deepEqual(
				final.map((row) => row.leagueRank).sort((a, b) => a - b),
				final.map((_, i) => i + 1),
			);
			// Day 1: everyone 0 or 1 games
			const first = pack.standingsHistory.filter((row) => row.day === days[0]);
			assert.isTrue(first.every((row) => row.gp <= 1));
		});

		test("season pack: CSV files and the data dictionary", async () => {
			const pack = await makePack(SEASON);
			const files = seasonPackCSVFiles(pack);
			assert.deepEqual(
				files.map((f) => f.name),
				[
					"teams.csv",
					"games.csv",
					"team_game_logs.csv",
					"standings_history.csv",
					"data_dictionary.csv",
				],
			);
			const dictFile = parseCSV(files.at(-1)!.text);
			const described = new Set(
				dictFile.slice(1).map((row) => `${row[0]}.${row[1]}`),
			);
			const dictName: Record<string, string> = {
				"teams.csv": "teams",
				"games.csv": "games",
				"team_game_logs.csv": "teamLogs",
				"standings_history.csv": "standingsHistory",
			};
			for (const f of files.slice(0, -1)) {
				const rows = parseCSV(f.text);
				const header = rows[0]!;
				for (const row of rows) {
					assert.strictEqual(row.length, header.length, f.name);
				}
				for (const col of header) {
					assert.isTrue(
						described.has(`${dictName[f.name]}.${col}`),
						`${f.name} ${col}`,
					);
				}
			}
			for (const row of dictFile.slice(1)) {
				assert.isAbove(row[2]!.length, 0);
			}
			assert.strictEqual(
				parseCSV(files[1]!.text).length,
				pack.games.length + 1,
			);
			// The zip (stored entries) is a valid archive with every file
			const zip = makeZip(
				files.map((f) => ({
					name: f.name,
					bytes: new TextEncoder().encode(f.text),
				})),
			);
			assert.strictEqual(new TextDecoder().decode(zip.slice(0, 2)), "PK");
		});

		test("season pack: a season without box scores says so", async () => {
			const pack = await makePack(SEASON - 1);
			assert.strictEqual(pack.games.length, 0);
			assert.strictEqual(pack.standingsHistory.length, 0);
			assert.isTrue(pack.notes.some((n) => n.includes("No box scores")));
		});

		test("team export: every section", async () => {
			const x = await exportOf(playoffTid);
			assert.strictEqual(x.format, TEAM_EXPORT_FORMAT);
			assert.strictEqual(x.schemaVersion, 1);
			assert.strictEqual(x.team.tid, playoffTid);
			assert.strictEqual(x.team.season, SEASON);
			assert.deepEqual(x.skipped, []);
			for (const key of TEAM_SECTION_KEYS) {
				assert.isDefined(x.sections[key], key);
			}

			const ts = (await idb.merged.teamSeasons.getByTidSeason(
				playoffTid,
				SEASON,
			))!;
			const overview = x.sections.overview!;
			const factValue = (s: typeof overview, label: string) =>
				s.facts.find((f) => f.label === label)?.value;
			assert.strictEqual(factValue(overview, "Record"), `${ts.won}-${ts.lost}`);
			assert.isDefined(factValue(overview, "Team rating"));

			// Roster: every player, positions, contracts, scouted ratings, at most 6 badges
			const roster = x.sections.roster!;
			const players = (roster.data as any).players as any[];
			const onTeam = await idb.cache.players.indexGetAll(
				"playersByTid",
				playoffTid,
			);
			assert.strictEqual(players.length, onTeam.length);
			const table = roster.tables[0]!;
			for (const col of [
				"Name",
				"Pos",
				"Contract ($K/yr)",
				"Ovr",
				"Pot",
				"Archetype",
				"Badges",
			]) {
				assert.include(table.cols, col);
			}
			for (const p of players) {
				assert.isString(p.pos);
				assert.isAbove(p.contract.amount, 0);
				assert.isAtMost(p.badges.length, 6);
				const raw = onTeam.find((q) => q.pid === p.pid)!;
				const r = raw.ratings.findLast((row) => row.season === SEASON)! as any;
				for (const key of ["spd", "tp", "oiq", "diq"]) {
					assert.strictEqual(p.ratings[key], fuzzRating(r[key], r.fuzz), key);
				}
			}
			assert.isDefined(
				roster.tables.find((t) => t.title === "Ratings (as scouted)"),
			);

			// Lineups and on/off (Advanced Tracking Stats is on in new leagues)
			const lineups = x.sections.lineups!;
			assert.isTrue(
				lineups.tables.some((t) => t.title.startsWith("Most-used lineups")),
				lineups.notes.join(" "),
			);
			const lu = lineups.tables.find((t) =>
				t.title.startsWith("Most-used lineups (regular"),
			)!;
			assert.isAtMost(lu.rows.length, 10);
			assert.strictEqual(String(lu.rows[0]![0]).split(", ").length, 5);
			assert.isTrue(lineups.tables.some((t) => t.title.startsWith("On/off")));

			// Shot profile: locations and zones, the defensive scheme note (not the user's team, or it is)
			const shot = x.sections.shotProfile!;
			const locs = shot.tables.find((t) => t.title === "Shot locations")!;
			assert.strictEqual(locs.rows.length, 4);
			const share = locs.rows.reduce((sum, row) => sum + Number(row[4]), 0);
			assert.closeTo(share, 100, 0.5);
			assert.isDefined(shot.facts.find((f) => f.label === "eFG%"));

			// Splits: home + road = overall, opponents add up
			const splits = (x.sections.splits!.data as any).splits as any[];
			const overall = splits.find((s) => s.group === "Overall")!;
			assert.strictEqual(overall.gp, 12);
			assert.strictEqual(overall.won, ts.won);
			const sum = (group: string) =>
				splits.filter((s) => s.group === group).reduce((a, s) => a + s.gp, 0);
			assert.strictEqual(sum("Site"), 12);
			assert.strictEqual(sum("Opponent"), 12);
			assert.strictEqual(sum("Month"), 12);
			assert.isTrue(splits.some((s) => s.group === "Rest"));
			assert.isTrue(splits.some((s) => s.group === "Playoffs"));

			// Staff and front office: coach, GM (words), finances
			const staff = x.sections.staff!;
			assert.isDefined(
				staff.facts.find((f) => f.label === "Head coach"),
				staff.notes.join(" "),
			);
			assert.isDefined(staff.tables.find((t) => t.title === "Finances"));
			const gm = staff.tables.find((t) => t.title === "GM leanings");
			if (gm) {
				assert.deepEqual(gm.cols, ["Trait", "Leaning"]);
				assert.isUndefined((staff.data as any).gm.traits);
			}

			// Results: the playoff series, notable games
			const results = x.sections.results!;
			assert.isDefined(
				results.tables.find((t) => t.title === "Playoff series"),
			);
			assert.isDefined(results.tables.find((t) => t.title === "Notable games"));

			// Data dictionary: every table column described
			for (const [key, s] of Object.entries(x.sections)) {
				for (const t of s.tables) {
					for (const col of t.cols) {
						assert.isAbove(
							x.dataDictionary[key as keyof typeof x.dataDictionary]![col]!
								.length,
							0,
							`${key} ${col}`,
						);
					}
				}
			}
		});

		test("team export: the user's team has its owner mood, scheme and shot profiles; others don't", async () => {
			const userTid = g.get("userTid");
			const own = await exportOf(userTid);
			assert.strictEqual(own.visibility.userTeam, true);
			assert.isTrue(
				own.sections.shotProfile!.facts.some(
					(f) => f.label === "Defensive scheme",
				) ||
					own.sections.shotProfile!.notes.some((n) => n.includes("turned off")),
			);
			const other = await exportOf(userTid === 1 ? 2 : 1);
			assert.isFalse(
				other.sections.shotProfile!.facts.some(
					(f) => f.label === "Defensive scheme",
				),
			);
			assert.isTrue(
				other.sections.staff!.notes.some((n) =>
					n.includes("Owner mood is only shown"),
				),
			);
			assert.isUndefined((other.sections.staff!.data as any).ownerMood);
		});

		test("team export: CSV files", async () => {
			const x = await exportOf(playoffTid);
			const files = teamExportCSVFiles(x);
			assert.include(
				files.map((f) => f.name),
				"data_dictionary.csv",
			);
			assert.include(
				files.map((f) => f.name),
				"02_roster_players.csv",
			);
			for (const f of files) {
				const rows = parseCSV(f.text);
				for (const row of rows) {
					assert.strictEqual(row.length, rows[0]!.length, f.name);
				}
			}
		});

		test("team export: one section per request, merged, is the whole export", async () => {
			const whole = await exportOf(playoffTid);
			const parts = [];
			for (const key of TEAM_SECTION_KEYS) {
				parts.push(
					(await getTeamSeasonExport({
						tid: playoffTid,
						season: SEASON,
						sections: [key],
					}))!,
				);
			}
			const merged = JSON.parse(
				teamExportToJSON(mergeTeamExports(parts)!),
			) as TeamSeasonExport;
			assert.deepEqual(
				Object.keys(merged.sections),
				Object.keys(whole.sections),
			);
			assert.deepEqual(merged.sections, whole.sections);
			assert.deepEqual(merged.dataDictionary, whole.dataDictionary);
		});

		test("team export: only the chosen sections; the dialog's list", async () => {
			const x = await getTeamSeasonExport({
				tid: 1,
				season: SEASON,
				sections: ["splits", "results"],
			});
			assert.deepEqual(Object.keys(x!.sections).sort(), ["results", "splits"]);
			const infos = await getTeamSeasonExportSections({
				tid: 1,
				season: SEASON,
			});
			assert.isTrue(infos.every((s) => s.reason === undefined));
			const none = await getTeamSeasonExportSections({
				tid: 1,
				season: SEASON + 5,
			});
			assert.isTrue(none.every((s) => s.reason !== undefined));
		});

		test("no visible ratings challenge: nothing rating-derived", async () => {
			await league.setGameAttributes({ challengeNoRatings: true });
			try {
				const x = await exportOf(playoffTid);
				assert.isFalse(x.visibility.ratingsShown);
				const keys = allKeys(x.sections);
				for (const key of [
					"ovr",
					"pot",
					"ratings",
					"badges",
					"skills",
					"archetype",
					"fuzz",
					"fit",
					"schemeFit",
				]) {
					assert.isFalse(keys.has(key), key);
				}
				const roster = x.sections.roster!;
				for (const col of ["Ovr", "Pot", "Archetype", "Badges"]) {
					assert.notInclude(roster.tables[0]!.cols, col);
				}
				assert.strictEqual(roster.tables.length, 1);
				assert.isUndefined(
					x.sections.overview!.facts.find((f) => f.label === "Team rating"),
				);
				assert.isFalse(
					x.sections.staff!.facts.some((f) => f.label === "Head coach ovr"),
				);
				for (const t of x.sections.staff!.tables) {
					assert.notInclude(t.cols, "Coach ovr");
				}
				assert.isFalse(
					teamExportCSVFiles(x).some((f) =>
						/\bOvr\b/.test(f.text.split("\n")[0]!),
					),
				);
			} finally {
				await league.setGameAttributes({ challengeNoRatings: false });
			}
		});

		test("GM leanings: words, numbers only in God Mode", async () => {
			const tid = g.get("userTid") === 3 ? 4 : 3;
			const x = await exportOf(tid);
			const gmTable = x.sections.staff!.tables.find(
				(t) => t.title === "GM leanings",
			);
			if (!gmTable) {
				// AI GM personalities off: said so
				assert.isTrue(
					x.sections.staff!.notes.some(
						(n) => n.includes("general manager") || n.includes("GM"),
					),
				);
				return;
			}
			for (const row of gmTable.rows) {
				assert.isString(row[1]);
				assert.isNaN(Number(row[1]));
			}
			await league.setGameAttributes({ godMode: true });
			try {
				const y = await exportOf(tid);
				const t = y.sections.staff!.tables.find(
					(t) => t.title === "GM leanings",
				)!;
				assert.deepEqual(t.cols, ["Trait", "Leaning", "Value"]);
				assert.isDefined((y.sections.staff!.data as any).gm.traits);
			} finally {
				await league.setGameAttributes({ godMode: false });
			}
		});
	},
);
