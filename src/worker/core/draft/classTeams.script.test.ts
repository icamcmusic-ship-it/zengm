// @ts-nocheck
/* eslint-disable no-undef */
// Class-aware teams, measured: several leagues of four upcoming draft classes (generated like the game's, with real-looking colleges
// and birthplaces), college stats made class by class as a new league does, then: minutes and usage, team usage sums, teammates from
// other classes, breakout and slump seasons, team games, and how well raw and age-adjusted production predict pro value after three
// seasons of development. RUN_CLASS_TEAMS=1 (CLASS_TEAMS_OUT=file, CLASS_TEAMS_LEAGUES=n).
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
import { getCollegeSeason } from "./collegeSeason.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { getSchool } from "../../../common/collegeStats/colleges.helpers.ts";
import {
	COLLEGES,
	LOWER_LEVEL_INFO,
	getLowerLevel,
} from "../../../common/collegeStats/colleges.ts";
import { isJuco } from "../../../common/collegeStats/juco.ts";
import { estimateRecord } from "../../../common/collegeStats/profile.ts";
import { Rng, hashString } from "../../../common/collegeStats/rng.ts";
import { trajectoryLatenessOf } from "../player/trajectory.ts";

const NUM_LEAGUES = Number(process.env.CLASS_TEAMS_LEAGUES ?? 4);
const YEARS = [2027, 2028, 2029, 2030];

const countriesSource = readFileSync(
	new URL("../../data/defaultCountries.ts", import.meta.url),
	"utf8",
);
const block = countriesSource.slice(countriesSource.indexOf("basketball: {"));
const basketballBlock = block.slice(0, block.indexOf("},"));
const COUNTRY_FREQ = [
	...basketballBlock.matchAll(/(?:"([^"]+)"|([A-Za-zçé]+)): (\d+)/g),
].map((m) => [m[1] ?? m[2], Number(m[3])]);
const collegesSource = readFileSync(
	new URL("../../data/defaultColleges.ts", import.meta.url),
	"utf8",
);
const COLLEGE_FREQ = [
	...collegesSource.matchAll(/^\t\t(?:"([^"]+)"|([A-Za-z]+)): ([\d.]+),$/gm),
].map((m) => [m[1] ?? m[2], Number(m[3])]);

// A team (one roster a season), not a league of clubs
const isTeamSchool = (name) =>
	!!COLLEGES[name] || isJuco(name) || getLowerLevel(name) !== undefined;
const strengthOf = (name) => {
	if (isJuco(name)) {
		return 40;
	}
	const lower = getLowerLevel(name);
	if (lower) {
		return LOWER_LEVEL_INFO[lower].strength;
	}
	return getSchool(name)?.strength ?? 60;
};
const gameScore = (s) =>
	s.pts +
	0.4 * s.fg -
	0.7 * s.fga -
	0.4 * (s.fta - s.ft) +
	0.7 * s.orb +
	0.3 * s.drb +
	s.stl +
	0.7 * s.ast +
	0.7 * s.blk -
	0.4 * s.pf -
	s.tov;
// Age-adjusted production as the script measures it (independent of the game's own metric, so before and after compare): game score per
// 40 minutes, schedule-adjusted, of his last two seasons (minutes weighted), plus `slope` per year he is younger than 20.5
const production = (p, slope, sos = true) => {
	const rows = getPreDraftStats(p).filter((r) => r.gp > 0 && r.min > 0);
	const lastTwo = rows.slice(-2);
	if (lastTwo.length === 0) {
		return undefined;
	}
	let num = 0;
	let den = 0;
	let age = 0;
	for (const [i, r] of lastTwo.entries()) {
		const w = r.min * (i === lastTwo.length - 1 ? 1.5 : 1);
		const adj = sos ? 1 + 0.005 * (strengthOf(r.teamName) - 75) : 1;
		num += w * ((gameScore(r) / r.min) * 40 * adj);
		age += w * (r.season - p.born.year);
		den += w;
	}
	return num / den + slope * (20.5 - age / den);
};
const corr = (a, b) => {
	const ma = a.reduce((x, y) => x + y, 0) / a.length;
	const mb = b.reduce((x, y) => x + y, 0) / b.length;
	let c = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < a.length; i++) {
		c += (a[i] - ma) * (b[i] - mb);
		va += (a[i] - ma) ** 2;
		vb += (b[i] - mb) ** 2;
	}
	return c / Math.sqrt(va * vb);
};
const q = (xs, f) => {
	const s = [...xs].sort((a, b) => a - b);
	return (
		Math.round(100 * s[Math.min(s.length - 1, Math.floor(f * s.length))]) / 100
	);
};
const quantiles = (xs) => ({
	n: xs.length,
	p10: q(xs, 0.1),
	p25: q(xs, 0.25),
	p50: q(xs, 0.5),
	p75: q(xs, 0.75),
	p90: q(xs, 0.9),
});
const r3 = (x) => Math.round(1000 * x) / 1000;

test.skipIf(!process.env.RUN_CLASS_TEAMS)(
	"class-aware teams",
	async () => {
		const mpgDraft = [];
		const usgDraft = [];
		const mpgFresh = [];
		const usgFresh = [];
		const teamUsageSums = [];
		const teamMinuteSums = [];
		let prospects = 0;
		let withTeammate = 0;
		let withOtherClassTeammate = 0;
		let teamSeasonsMulti = 0;
		let transitions = 0;
		let breakouts = 0;
		let slumps = 0;
		const byLateness = { early: [0, 0, 0], mid: [0, 0, 0], late: [0, 0, 0] };
		let gpOverTeamGames = 0;
		let teamRows = 0;
		const prodRaw = [];
		const prodAdj = {};
		const slopes = [0, 0.6, 1.2, 1.8, 2.4, 3];
		for (const s of slopes) {
			prodAdj[s] = [];
		}
		const future = [];
		// Usage against the best teammate: residual of usage on his own ovr, with and without a better prospect teammate
		const usgResid = { star: [], none: [] };
		let ratingsHash = "";
		const t0 = Date.now();
		let genMs = 0;

		for (let league = 0; league < NUM_LEAGUES; league++) {
			resetG();
			g.setWithoutSavingToDB("season", 2026);
			g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
			g.setWithoutSavingToDB("generateCollegeStats", false);
			for (const key of [
				"featurePreDraftPaths",
				"featurePreDraftMedicals",
				"featureCollegeSeason",
			]) {
				g.setWithoutSavingToDB(key, true);
			}
			let all = [];
			for (const draftYear of YEARS) {
				const rng = new Rng(`classTeams${league}|${draftYear}`);
				const orig = Math.random;
				Math.random = () => rng.random();
				let players;
				try {
					players = await genPlayersWithoutSaving(draftYear, DEFAULT_LEVEL, []);
				} finally {
					Math.random = orig;
				}
				const bioRng = new Rng(`bio${league}|${draftYear}`);
				players = players.map((p, i) => {
					const country = bioRng.weighted(
						COUNTRY_FREQ.map((x) => x[0]),
						COUNTRY_FREQ.map((x) => x[1]),
					);
					const withCollege =
						bioRng.random() <
						(country === "USA" || country === "Canada" ? 0.98 : 0.02);
					return {
						...p,
						pid: all.length + i,
						college: withCollege
							? bioRng.weighted(
									COLLEGE_FREQ.map((x) => x[0]),
									COLLEGE_FREQ.map((x) => x[1]),
								)
							: "",
						born: {
							...p.born,
							loc: country === "USA" ? "Chicago, IL" : `City, ${country}`,
						},
					};
				});
				all = all.concat(players);
			}
			await resetCache({ players: all });
			for (const p of all) {
				await player.updateValues(p);
			}
			const tg = Date.now();
			for (const draftYear of YEARS) {
				await generateCollegeStats({
					draftYear,
					seed: `${league}-${draftYear}-auto`,
				});
			}
			genMs += Date.now() - tg;
			const players = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).sort((a, b) => a.pid - b.pid);
			ratingsHash += hashString(
				JSON.stringify(
					players.map((p) => [
						p.ratings.at(-1).ovr,
						p.ratings.at(-1).pot,
						p.ratings.at(-1).pos,
						p.ratings.at(-1).hgt,
					]),
				),
			);

			const ncaaSeasons = new Map();
			for (const season of YEARS) {
				ncaaSeasons.set(
					season,
					// (code from before class-aware teams reads the database, which a test has none of: the estimate then)
					(
						await getCollegeSeason(
							season,
							players.filter((p) => p.draft.year === season),
						).catch(() => undefined)
					)?.season,
				);
			}
			// Rosters: team and season -> prospects (with their row)
			const rosters = new Map();
			for (const p of players) {
				for (const r of getPreDraftStats(p)) {
					if (r.gp > 0 && isTeamSchool(r.teamName)) {
						const key = `${r.teamName}|${r.season}`;
						if (!rosters.has(key)) {
							rosters.set(key, []);
						}
						rosters.get(key).push({ p, r });
					}
				}
			}
			for (const [key, roster] of rosters) {
				const [team, season] = key.split("|");
				// The team's record as the College/Overseas page shows it: the college season's, in a season one was played, otherwise the
				// estimate (whose games are a floor of his games played)
				const ncaa = COLLEGES[team]
					? ncaaSeasons.get(Number(season))
					: undefined;
				const t = ncaa?.teams.find((x) => x.school === team);
				const est = estimateRecord({
					team,
					season: Number(season),
					strength: strengthOf(team),
					gp: 0,
					conference: undefined,
				});
				const games = t ? t.w + t.l : est.w + est.l;
				for (const { r } of roster) {
					teamRows += 1;
					if (r.gp > games) {
						gpOverTeamGames += 1;
					}
				}
				if (roster.length >= 2) {
					teamSeasonsMulti += 1;
					let usage = 0;
					let minutes = 0;
					for (const { r } of roster) {
						usage += ((r.usgp ?? 0) / 100) * (r.min / r.gp / 40);
						minutes += r.min / r.gp;
					}
					teamUsageSums.push(usage);
					teamMinuteSums.push(minutes);
				}
			}

			// Usage residual on ovr (draft-year ovr, back a little for earlier seasons is ignored: same for both groups)
			const resRows = [];
			for (const roster of rosters.values()) {
				for (const { p, r } of roster) {
					if (r.gp >= 10) {
						const better = roster.some(
							(x) => x.p !== p && x.p.value >= p.value + 3 && x.p.value >= 50,
						);
						resRows.push({
							ovr: p.ratings.at(-1).ovr,
							usg: r.usgp ?? 0,
							better,
						});
					}
				}
			}
			const mo = resRows.reduce((a, x) => a + x.ovr, 0) / resRows.length;
			const mu = resRows.reduce((a, x) => a + x.usg, 0) / resRows.length;
			let cov = 0;
			let vo = 0;
			for (const x of resRows) {
				cov += (x.ovr - mo) * (x.usg - mu);
				vo += (x.ovr - mo) ** 2;
			}
			const beta = cov / vo;
			for (const x of resRows) {
				(x.better ? usgResid.star : usgResid.none).push(
					x.usg - mu - beta * (x.ovr - mo),
				);
			}

			for (const p of players) {
				prospects += 1;
				const rows = getPreDraftStats(p).filter((r) => r.gp > 0);
				const last = rows.at(-1);
				if (last && last.season === p.draft.year && last.gp >= 10) {
					mpgDraft.push(last.min / last.gp);
					usgDraft.push(last.usgp ?? 0);
				}
				for (const r of rows) {
					if (
						r.season - p.born.year <= 19 &&
						COLLEGES[r.teamName] &&
						r.gp >= 10
					) {
						mpgFresh.push(r.min / r.gp);
						usgFresh.push(r.usgp ?? 0);
					}
				}
				let mate = false;
				let otherClass = false;
				for (const r of rows) {
					const roster = rosters.get(`${r.teamName}|${r.season}`);
					for (const x of roster ?? []) {
						if (x.p !== p) {
							mate = true;
							if (x.p.draft.year !== p.draft.year) {
								otherClass = true;
							}
						}
					}
				}
				withTeammate += mate ? 1 : 0;
				withOtherClassTeammate += otherClass ? 1 : 0;

				const lateness = trajectoryLatenessOf(p) ?? 0;
				const bucket =
					lateness <= -0.33 ? "early" : lateness >= 0.33 ? "late" : "mid";
				for (let i = 1; i < rows.length; i++) {
					const a = rows[i - 1];
					const b = rows[i];
					if (
						b.season !== a.season + 1 ||
						a.gp < 10 ||
						b.gp < 10 ||
						!isTeamSchool(a.teamName) ||
						!isTeamSchool(b.teamName)
					) {
						continue;
					}
					const d = b.pts / b.gp - a.pts / a.gp;
					transitions += 1;
					byLateness[bucket][0] += 1;
					if (d >= 6) {
						breakouts += 1;
						byLateness[bucket][1] += 1;
					} else if (d <= -3) {
						slumps += 1;
						byLateness[bucket][2] += 1;
					}
				}

				const raw = production(p, 0, false);
				if (raw !== undefined && rows.reduce((a, r) => a + r.min, 0) >= 300) {
					prodRaw.push(raw);
					for (const s of slopes) {
						prodAdj[s].push(production(p, s));
					}
					// Three pro seasons of development, the game's own random numbers seeded per player
					const copy = structuredClone(p);
					const devRng = new Rng(`dev${league}|${p.pid}`);
					const orig = Math.random;
					Math.random = () => devRng.random();
					try {
						for (let y = 1; y <= 3; y++) {
							copy.ratings.push({
								...copy.ratings.at(-1),
								season: p.draft.year + y,
							});
							await player.develop(copy, 1, false, DEFAULT_LEVEL);
						}
					} finally {
						Math.random = orig;
					}
					future.push(copy.ratings.at(-1).ovr);
				}
			}
		}

		const out = {
			leagues: NUM_LEAGUES,
			classes: YEARS.length,
			prospects,
			genMsPerClass: Math.round(genMs / (NUM_LEAGUES * YEARS.length)),
			ratingsHash: String(hashString(ratingsHash)),
			draftYearMpg: quantiles(mpgDraft),
			draftYearUsg: quantiles(usgDraft),
			freshmanMpg: quantiles(mpgFresh),
			freshmanUsg: quantiles(usgFresh),
			teamSeasonsWith2Plus: teamSeasonsMulti,
			teamProspectUsageSum: quantiles(teamUsageSums),
			teamProspectMinutesSum: quantiles(teamMinuteSums),
			usageResidualWithBetterTeammate: r3(
				usgResid.star.reduce((a, b) => a + b, 0) / usgResid.star.length,
			),
			usageResidualWithout: r3(
				usgResid.none.reduce((a, b) => a + b, 0) / usgResid.none.length,
			),
			nWithBetterTeammate: usgResid.star.length,
			shareWithProspectTeammate: r3(withTeammate / prospects),
			shareWithOtherClassTeammate: r3(withOtherClassTeammate / prospects),
			transitions,
			breakoutRate: r3(breakouts / transitions),
			slumpRate: r3(slumps / transitions),
			byLateness: Object.fromEntries(
				Object.entries(byLateness).map(([k, [n, b, s]]) => [
					k,
					{ n, breakout: r3(b / n), slump: r3(s / n) },
				]),
			),
			rowsOverTeamGames: `${gpOverTeamGames}/${teamRows}`,
			nProduction: prodRaw.length,
			corrRawWithOvrIn3: r3(corr(prodRaw, future)),
			corrAgeAdjWithOvrIn3: Object.fromEntries(
				slopes.map((s) => [s, r3(corr(prodAdj[s], future))]),
			),
			totalSeconds: Math.round((Date.now() - t0) / 1000),
		};
		const text = JSON.stringify(out, null, 1);
		if (process.env.CLASS_TEAMS_OUT) {
			writeFileSync(process.env.CLASS_TEAMS_OUT, text);
		}
		console.log(text);
	},
	1200000,
);
