// @ts-nocheck
/* eslint-disable no-undef */
// Pre-draft routes of generated classes: route shares, the top 10's route mix, where international prospects play, and a hash
// of every prospect's ratings, ovr and position (which the routes must never change). RUN_ROUTES=1 (ROUTES_OUT=file).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import { generateCollegeStats } from "./generateCollegeStats.ts";
import { getPreDraftSchool } from "../../../common/preDraft.ts";
import { getRegion } from "../../../common/collegeStats/colleges.helpers.ts";
import {
	COLLEGES,
	NON_NCAA,
	PATHWAY_TEAM,
} from "../../../common/collegeStats/colleges.ts";
import { isOverseasLeague } from "../../../common/collegeStats/overseas.ts";
import { Rng, hashString } from "../../../common/collegeStats/rng.ts";

const NUM_CLASSES = Number(process.env.ROUTES_CLASSES ?? 12);

// Basketball country frequencies (worker/data/defaultCountries.ts, which the test build replaces) and BBGM's colleges
const countriesSource = readFileSync(
	new URL("../../data/defaultCountries.ts", import.meta.url),
	"utf8",
);
const basketballBlock = countriesSource
	.slice(countriesSource.indexOf("basketball: {"))
	.slice(0, countriesSource.slice(countriesSource.indexOf("basketball: {")).indexOf("},"));
const COUNTRY_FREQ = [
	...basketballBlock.matchAll(/(?:"([^"]+)"|([A-Za-zçé]+)): (\d+)/g),
].map((m) => [m[1] ?? m[2], Number(m[3])]);
const COUNTRY_NAMES = COUNTRY_FREQ.map((x) => x[0]);
const COUNTRY_WEIGHTS = COUNTRY_FREQ.map((x) => x[1]);
const collegesSource = readFileSync(
	new URL("../../data/defaultColleges.ts", import.meta.url),
	"utf8",
);
const COLLEGE_FREQ = [
	...collegesSource.matchAll(/^\t\t(?:"([^"]+)"|([A-Za-z]+)): ([\d.]+),$/gm),
].map((m) => [m[1] ?? m[2], Number(m[3])]);
const COLLEGE_NAMES = COLLEGE_FREQ.map((x) => x[0]);
const COLLEGE_WEIGHTS = COLLEGE_FREQ.map((x) => x[1]);

export const routeOf = (p) => {
	const career = p.preDraftCareer;
	const final = getPreDraftSchool(p);
	const years = career?.years ?? [];
	if (career?.route) {
		return career.route;
	}
	if (final === PATHWAY_TEAM) {
		return "pathway";
	}
	if (COLLEGES[final]) {
		const levels = new Set(years.map((y) => y.level));
		if (levels.has("juco")) {
			return "juco>D-I";
		}
		if (years.some((y) => y.level === "ncaa" && y.move)) {
			return "D-I transfer";
		}
		if (years.some((y) => y.status === "redshirt")) {
			return "D-I redshirt";
		}
		return "D-I";
	}
	if (final === "NBA G League") {
		return "G League";
	}
	if (isOverseasLeague(final)) {
		return "overseas";
	}
	return final || "none";
};

test.skipIf(!process.env.RUN_ROUTES)(
	"pre-draft routes",
	async () => {
		const routes = new Map();
		const top10 = new Map();
		const intlLeagues = new Map();
		const usAbroad = new Map();
		const finals = new Map();
		let total = 0;
		let ratingsHash = "";
		for (let c = 0; c < NUM_CLASSES; c++) {
			// The game's random numbers, seeded, so before and after get the same prospects
			const rng = new Rng(`routes${c}`);
			const orig = Math.random;
			Math.random = () => rng.random();
			resetG();
			g.setWithoutSavingToDB("season", 2026);
			g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
			g.setWithoutSavingToDB("generateCollegeStats", false);
			for (const key of ["featurePreDraftPaths", "featurePreDraftMedicals", "featureCollegeSeason"]) {
				g.setWithoutSavingToDB(key, true);
			}
			const draftYear = 2026;
			let players;
			try {
				players = await genPlayersWithoutSaving(draftYear, DEFAULT_LEVEL, []);
			} finally {
				Math.random = orig;
			}
			// The test build's names data is four dummy countries: birthplaces and colleges like the real game's (basketball country
			// frequencies, Americans and Canadians nearly always with a college, everyone else nearly never)
			const bioRng = new Rng(`bio${c}`);
			players = players.map((p, i) => {
				const country = bioRng.weighted(COUNTRY_NAMES, COUNTRY_WEIGHTS);
				const withCollege =
					bioRng.random() <
					(country === "USA" || country === "Canada" ? 0.98 : 0.02);
				const college = withCollege
					? bioRng.weighted(COLLEGE_NAMES, COLLEGE_WEIGHTS)
					: "";
				return {
					...p,
					pid: i,
					college,
					born: {
						...p.born,
						loc: country === "USA" ? "Chicago, IL" : `City, ${country}`,
					},
				};
			});
			await resetCache({ players });
			for (const p of players) {
				await player.updateValues(p);
			}
			await generateCollegeStats({ draftYear, seed: `s${c}` });
			const all = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).sort((a, b) => a.pid - b.pid);
			ratingsHash += hashString(
				JSON.stringify(
					all.map((p) => [
						p.ratings.at(-1),
						p.born,
						p.value,
						p.ratings.at(-1).pos,
					]),
				),
			);
			const byValue = [...all].sort((a, b) => b.value - a.value);
			const top = new Set(byValue.slice(0, 10).map((p) => p.pid));
			for (const p of all) {
				total += 1;
				const route = routeOf(p);
				routes.set(route, (routes.get(route) ?? 0) + 1);
				if (top.has(p.pid)) {
					top10.set(route, (top10.get(route) ?? 0) + 1);
				}
				const region = getRegion(p.born.loc);
				const final = getPreDraftSchool(p);
				finals.set(final, (finals.get(final) ?? 0) + 1);
				if (region !== "usa" && region !== "canada") {
					const key = `${COLLEGES[final] ? "NCAA" : final}`;
					intlLeagues.set(key, (intlLeagues.get(key) ?? 0) + 1);
				} else if (!COLLEGES[final]) {
					usAbroad.set(final, (usAbroad.get(final) ?? 0) + 1);
				}
				for (const y of p.preDraftCareer?.years ?? []) {
					const k = `year:${y.level}`;
					routes.set(k, (routes.get(k) ?? 0) + 1);
				}
			}
		}
		const sorted = (m) =>
			Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
		const out = {
			classes: NUM_CLASSES,
			total,
			ratingsHash: String(hashString(ratingsHash)),
			routes: sorted(routes),
			top10: sorted(top10),
			intlLeagues: sorted(intlLeagues),
			northAmericansNotAtD1: sorted(usAbroad),
			numDistinctFinalSchools: finals.size,
			nonNcaaDestinations: Object.keys(NON_NCAA).length,
			countries: COUNTRY_FREQ.length, colleges: COLLEGE_FREQ.length,
		};
		const text = JSON.stringify(out, null, 1);
		if (process.env.ROUTES_OUT) {
			writeFileSync(process.env.ROUTES_OUT, text);
		}
		console.log(text);
	},
	600000,
);
