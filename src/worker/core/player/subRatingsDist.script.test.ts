// Not a real test: distributions of generated sub-ratings over many draft classes (builds drawn vs the builds' real-draft weights,
// specialists, generational shapes per class, growth profiles, backgrounds, offsets per sub, sanity limits). Skipped unless SUB_DIST is set:
//
//   SUB_DIST=1 SUB_DIST_CLASSES=30 node_modules/.bin/vitest run --project basketball src/worker/core/player/subRatingsDist.script.test.ts
import { describe, test } from "vitest";
import { draft } from "../index.ts";
import "fake-indexeddb/auto";
import { g, helpers } from "../../util/index.ts";
import { league } from "../index.ts";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { last } from "../../../common/utils.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	NUM_SUBS,
	SUB_DEFS,
	SUB_INDEX,
	subOffsets,
} from "../../../common/subRatings.ts";
import {
	GENERATIONAL_OFFSET,
	GROWTH_PROFILES,
	maxOffset,
} from "../../../common/subRatingsGen.ts";
import { ARCHETYPES } from "../../../common/ratingsBuilds/archetypes.data.ts";
import { assignClassSubs, backgroundOf } from "./subRatings.ts";

const env = (globalThis as any).process.env;
const CLASSES = Number(env.SUB_DIST_CLASSES ?? 30);
const r1 = (x: number) => Math.round(x * 10) / 10;

describe.skipIf(!env.SUB_DIST)("sub-ratings distributions", () => {
	test("generated classes", { timeout: 60 * 60 * 1000 }, async () => {
		// A real new league first (names, countries and colleges as in the game), then classes generated in it
		Math.random = makeSeededRandom(5);
		await league.createStream({} as any, {
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
			name: "subdist",
			setLeagueCreationStatus: () => {},
			settings: {
				...getDefaultSettings(),
				subRatings: true,
				expandedRatings: env.SUB_DIST_EXPANDED !== "0",
			} as any,
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		});
		await league.loadGameAttributes();
		const all: any[] = [];
		const top: any[] = [];
		const genPerClass: number[] = [];
		const specPerClass: number[] = [];
		for (let c = 0; c < CLASSES; c++) {
			const players = await draft.genPlayersWithoutSaving(
				g.get("season") + 1,
				DEFAULT_LEVEL,
				[],
			);
			// The test environment's name data has only a few countries: origins and colleges as in a real class (about 80% from the US,
			// most of them from college), then the class's shapes again (as the game does when a class shape changes origins)
			for (const p of players) {
				const u = Math.random();
				if (u < 0.8) {
					p.born.loc = "Ohio, USA";
					if (p.college === "" && Math.random() < 0.9) {
						p.college = "Ohio State";
					}
				} else if (u < 0.82) {
					p.born.loc = "Ohio, USA";
					p.college = "";
				}
			}
			assignClassSubs(players);
			players.sort((a, b) => b.ratings[0].pot - a.ratings[0].pot);
			all.push(...players);
			top.push(...players.slice(0, 60));
			genPerClass.push(players.filter((p) => p.subP?.gen).length);
			specPerClass.push(players.filter((p) => p.subP?.sp).length);
		}
		const share = (xs: any[], f: (p: any) => boolean) =>
			r1((100 * xs.filter(f).length) / xs.length);

		// Builds: the tags of the drawn build, top 60 of each class, vs the builds' weights within the height gates of the same players
		const tagsOf = (name: string) =>
			ARCHETYPES.find((a) => a.name === name)?.tags ?? [];
		const expectedTag = (tag: string) => {
			let sum = 0;
			for (const p of top) {
				const hgt = p.ratings[0].hgt;
				const pool = ARCHETYPES.filter(
					(a) =>
						a.w > 0 && a.name !== "Balanced" && hgt >= a.min && hgt <= a.max,
				);
				const tot = pool.reduce((s, a) => s + a.w * a.cal, 0);
				sum +=
					pool
						.filter((a) => a.tags.includes(tag))
						.reduce((s, a) => s + a.w * a.cal, 0) / tot;
			}
			return r1((100 * sum) / top.length);
		};
		const tagRows = [
			"guard",
			"wing",
			"big",
			"shooting",
			"scoring",
			"playmaking",
			"defense",
			"rebounding",
			"athletic",
			"raw",
		].map((tag) => ({
			tag,
			drawn: share(top, (p) => tagsOf(p.subP.b).includes(tag)),
			weights: expectedTag(tag),
		}));
		console.table(tagRows);
		console.log(
			"mean prospect ratings:",
			JSON.stringify(
				Object.fromEntries(
					[
						"stre",
						"spd",
						"jmp",
						"endu",
						"ins",
						"dnk",
						"ft",
						"fg",
						"tp",
						"oiq",
						"diq",
						"drb",
						"pss",
						"reb",
					].map((k) => [
						k,
						r1(all.reduce((s2, p) => s2 + p.ratings[0][k], 0) / all.length),
					]),
				),
			),
		);

		const builds = new Map<string, number>();
		for (const p of top) {
			builds.set(p.subP.b, (builds.get(p.subP.b) ?? 0) + 1);
		}
		console.log(
			"top builds (top 60):",
			[...builds]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 15)
				.map(([b, n]) => `${b} ${r1((100 * n) / top.length)}%`)
				.join(", "),
		);

		console.log(
			"specialists",
			share(all, (p) => p.subP.sp === 1),
			"% of prospects; per class",
			r1(specPerClass.reduce((a, b) => a + b, 0) / CLASSES),
			"; generational shapes per class: mean",
			r1(genPerClass.reduce((a, b) => a + b, 0) / CLASSES),
			"max",
			Math.max(...genPerClass),
			`(cap 2, offset >= ${GENERATIONAL_OFFSET})`,
			"; generational in all:",
			all.filter(
				(p) => maxOffset(p.ratings[0].sub, p.ratings[0]) >= GENERATIONAL_OFFSET,
			).length,
		);
		console.log(
			"growth profiles:",
			GROWTH_PROFILES.map(
				(name, i) => `${name} ${share(all, (p) => p.subP.g === i)}%`,
			).join(", "),
		);
		console.log(
			"sample bios:",
			JSON.stringify(
				all
					.slice(0, 6)
					.map((p) => [p.born.loc, p.college, p.draft.year - p.born.year]),
			),
		);
		console.log(
			"backgrounds:",
			["oneAndDone", "college", "senior", "intl", "pro"]
				.map((b) => `${b} ${share(all, (p) => backgroundOf(p) === b)}%`)
				.join(", "),
		);

		// Offsets from the base, per sub (sd and the 1st/99th percentiles)
		const rows = [];
		for (let i = 0; i < NUM_SUBS; i++) {
			const offs = all
				.map((p) => subOffsets(p.ratings[0].sub, p.ratings[0])[i]!)
				.sort((a, b) => a - b);
			const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
			const sd = Math.sqrt(
				offs.reduce((a, b) => a + (b - mean) ** 2, 0) / offs.length,
			);
			rows.push({
				sub: SUB_DEFS[i]!.key,
				mean: r1(mean),
				sd: r1(sd),
				p1: offs[Math.floor(0.01 * offs.length)],
				p99: offs[Math.floor(0.99 * offs.length)],
			});
		}
		console.table(rows);

		// Signature skill (an offset of 8+) and clear weakness (-8 or lower)
		console.log(
			"with a signature sub (+8 over its base):",
			share(all, (p) =>
				subOffsets(p.ratings[0].sub, p.ratings[0]).some((o) => o >= 8),
			),
			"%; with a clear weakness (-8):",
			share(all, (p) =>
				subOffsets(p.ratings[0].sub, p.ratings[0]).some((o) => o <= -8),
			),
			"%",
		);

		// Sanity: blocks of small players, lateral quickness of the tallest, by size
		const small = all.filter((p) => p.ratings[0].hgt <= 30);
		const tall = all.filter((p) => p.ratings[0].hgt >= 75);
		const maxOf = (xs: any[], i: number) =>
			Math.max(...xs.map((p) => p.ratings[0].sub[i]));
		const blkOff = (xs: any[]) =>
			r1(
				xs.reduce(
					(s, p) => s + p.ratings[0].sub[SUB_INDEX.blk!] - p.ratings[0].diq,
					0,
				) / xs.length,
			);
		console.log(
			`6'2" and shorter (${small.length}): max blocks ${maxOf(small, SUB_INDEX.blk!)}, mean blocks - diq ${blkOff(small)}; 7'2"+ (${tall.length}): max lateral ${tall.length ? maxOf(tall, SUB_INDEX.lat!) : "-"}, mean blocks - diq ${tall.length ? blkOff(tall) : "-"}`,
		);
		// Correlated "hands": steals vs ball security offsets
		const corr = (i: number, j: number) => {
			const xs = all.map((p) => subOffsets(p.ratings[0].sub, p.ratings[0]));
			const a = xs.map((x) => x[i]!);
			const b = xs.map((x) => x[j]!);
			const ma = a.reduce((s, v) => s + v, 0) / a.length;
			const mb = b.reduce((s, v) => s + v, 0) / b.length;
			let num = 0;
			let da = 0;
			let db = 0;
			for (let k = 0; k < a.length; k++) {
				num += (a[k]! - ma) * (b[k]! - mb);
				da += (a[k]! - ma) ** 2;
				db += (b[k]! - mb) ** 2;
			}
			return Math.round((100 * num) / Math.sqrt(da * db)) / 100;
		};
		console.log(
			"correlations of offsets: steals/ball security",
			corr(SUB_INDEX.stl!, SUB_INDEX.sec!),
			"floater/finesse",
			corr(SUB_INDEX.flt!, SUB_INDEX.fns!),
			"blocks/off reb",
			corr(SUB_INDEX.blk!, SUB_INDEX.orb!),
		);
	});
});
