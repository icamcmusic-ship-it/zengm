// @ts-nocheck
/* eslint-disable no-undef */
// Under-the-radar prospects, measured: several leagues of four upcoming draft classes (generated like the game's, with real-looking
// colleges and birthplaces), college stats made class by class as a new league does, then counts of prospects with weak or no
// pre-draft production AND a low or no high school recruiting rank, by path and by draft range (stock: value rank in the class; and
// the outlets' final consensus), and how many of them have a stated reason. RUN_UNDER_RADAR=1 (UNDER_RADAR_LEAGUES=n,
// UNDER_RADAR_OUT=file for a JSON dump, UNDER_RADAR_SAMPLES=n stories printed).
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
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { getPreDraftLabel } from "../../../common/collegeStats/overseas.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import {
	FINAL_EDITION,
	consensusBoard,
	outletBoards,
} from "../../../common/draftOutlets.ts";
import { productionSignalFor } from "../draftOutlets/index.ts";
import { getProspectRadar } from "./radar.ts";

const NUM_LEAGUES = Number(process.env.UNDER_RADAR_LEAGUES ?? 6);
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

// Weak production: no pre-draft stats, a draft year season he did not play (or under 8 games), or a draft year line under 14 minutes
// or 6 points a game, and no earlier season (8+ games) at 22+ minutes and 10+ points either
const productionOf = (p) => {
	const rows = getPreDraftStats(p).filter((r) => !r.playoffs);
	if (rows.length === 0) {
		return { kind: "none", weak: true };
	}
	const bySeason = new Map();
	for (const r of rows) {
		const x = bySeason.get(r.season) ?? {
			gp: 0,
			min: 0,
			pts: 0,
			team: r.teamName,
		};
		x.gp += r.gp;
		x.min += r.min;
		x.pts += r.pts;
		bySeason.set(r.season, x);
	}
	const last = bySeason.get(Math.max(...bySeason.keys()));
	const line = (x) =>
		x.gp > 0 ? { mpg: x.min / x.gp, ppg: x.pts / x.gp, gp: x.gp } : undefined;
	const l = line(last);
	const goodEarlier = [...bySeason.values()].some((x) => {
		const y = line(x);
		return y && y.gp >= 8 && y.mpg >= 22 && y.ppg >= 10;
	});
	const weakLast = !l || l.gp < 8 || l.mpg < 14 || l.ppg < 6;
	return {
		kind: !l ? "dnp" : weakLast ? "weak" : "ok",
		weak: weakLast && !goodEarlier,
		mpg: l?.mpg,
		ppg: l?.ppg,
		gp: l?.gp,
		team: last.team,
	};
};

const pathOf = (p) => {
	const rows = getPreDraftStats(p).filter((r) => !r.playoffs && r.gp > 0);
	const lastYear = p.preDraftCareer?.years.at(-1);
	if (lastYear) {
		if (lastYear.level === "juco") {
			return "JUCO";
		}
		const label = getPreDraftLabel(lastYear.school);
		return label;
	}
	if (rows.length === 0) {
		return "no stats";
	}
	return getPreDraftLabel(rows.at(-1).teamName);
};

const rangeOf = (rank) =>
	rank <= 14 ? "1-14" : rank <= 30 ? "15-30" : rank <= 60 ? "31-60" : "61+";

test.skipIf(!process.env.RUN_UNDER_RADAR)(
	"under the radar",
	async () => {
		const rows = [];
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
				const rng = new Rng(`underRadar${league}|${draftYear}`);
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
			for (const draftYear of YEARS) {
				await generateCollegeStats({
					draftYear,
					seed: `${league}-${draftYear}-auto`,
				});
			}
			const players = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			);
			for (const draftYear of YEARS) {
				const cls = players
					.filter((p) => p.draft.year === draftYear)
					.sort((a, b) => b.value - a.value || a.pid - b.pid);
				const inputs = cls.map((p) => {
					const r = p.ratings.at(-1);
					const age = draftYear - p.born.year;
					return {
						pid: p.pid,
						value: p.value,
						age,
						upside: r.pot - r.ovr + 2 * (21 - age),
						production: productionSignalFor(p, age),
						athletic: Math.max(
							0,
							Math.min(100, 50 + 2.2 * ((r.spd + r.jmp) / 2 - 52)),
						),
						// The draft outlets' off the radar read (UNDER_RADAR_NO_OUTLET=1: as before it)
						offRadar:
							!process.env.UNDER_RADAR_NO_OUTLET &&
							getProspectRadar(p)?.kind === "unknown",
					};
				});
				const consensus = consensusBoard(
					outletBoards({
						prospects: inputs,
						seed: `league${league}`,
						draftYear,
						edition: FINAL_EDITION,
					}),
				);
				for (const [i, p] of cls.entries()) {
					const prod = productionOf(p);
					const recruit = p.preDraftCareer?.recruit;
					const hs = p.preDraftCareer?.hsClass !== undefined;
					const rank = recruit?.rank ?? undefined;
					const pedigree = !hs
						? "n/a"
						: rank === undefined
							? "unranked"
							: rank > 300
								? "low"
								: rank > 150
									? "mid"
									: "high";
					const found = getProspectRadar(p);
					const reason = found?.kind === "unknown" ? undefined : found;
					rows.push({
						league,
						draftYear,
						pid: p.pid,
						stockRank: i + 1,
						consensusRank: consensus.get(p.pid)?.rank ?? 999,
						path: pathOf(p),
						story: p.preDraftCareer?.story,
						route: p.preDraftCareer?.route,
						rank,
						pedigree,
						prod,
						reason: reason?.kind,
						reasonText: reason?.text,
						offRadar: found?.kind === "unknown",
						age: draftYear - p.born.year,
						ovr: p.ratings.at(-1).ovr,
						pot: p.ratings.at(-1).pot,
						years: p.preDraftCareer?.years.map(
							(y) =>
								`${y.season} ${y.school} (${y.level}${y.cls ? ` ${y.cls}` : ""}${y.status ? ` ${y.status}` : ""}${y.move ? ` ${y.move}` : ""}${y.role ? ` ${y.role}` : ""})`,
						),
						lines: getPreDraftStats(p)
							.filter((r) => !r.playoffs)
							.map(
								(r) =>
									`${r.season} ${r.teamName}: ${r.gp} gp, ${(r.min / Math.max(1, r.gp)).toFixed(1)} mpg, ${(r.pts / Math.max(1, r.gp)).toFixed(1)} ppg`,
							),
					});
				}
			}
		}

		const flagged = (r) =>
			r.prod.weak && (r.pedigree === "unranked" || r.pedigree === "low");
		const flaggedNoHs = (r) => r.prod.weak && r.pedigree === "n/a";
		const summary = {};
		for (const [label, key] of [
			["stock", "stockRank"],
			["consensus", "consensusRank"],
		]) {
			const byRange = {};
			for (const r of rows) {
				const range = rangeOf(r[key]);
				byRange[range] ??= {
					n: 0,
					weakProd: 0,
					lowPedigree: 0,
					both: 0,
					bothNoReason: 0,
					weakNoHs: 0,
				};
				const b = byRange[range];
				b.n += 1;
				b.weakProd += r.prod.weak ? 1 : 0;
				b.lowPedigree +=
					r.pedigree === "unranked" || r.pedigree === "low" ? 1 : 0;
				b.both += flagged(r) ? 1 : 0;
				b.bothNoReason += flagged(r) && !r.reason ? 1 : 0;
				b.weakNoHs += flaggedNoHs(r) ? 1 : 0;
			}
			summary[label] = byRange;
		}
		const byPath = {};
		for (const r of rows) {
			const b = (byPath[r.path] ??= {
				n: 0,
				top60: 0,
				bothTop60: 0,
				bothAll: 0,
				weakTop60: 0,
			});
			b.n += 1;
			const top60 = r.stockRank <= 60;
			b.top60 += top60 ? 1 : 0;
			b.bothTop60 += top60 && flagged(r) ? 1 : 0;
			b.bothAll += flagged(r) ? 1 : 0;
			b.weakTop60 += top60 && r.prod.weak ? 1 : 0;
		}
		const reasons = {};
		for (const r of rows) {
			if (r.reason) {
				const b = (reasons[r.reason] ??= { all: 0, top60: 0 });
				b.all += 1;
				b.top60 += r.stockRank <= 60 ? 1 : 0;
			}
		}
		// Pedigree by stock range
		const pedigreeByRange = {};
		for (const r of rows) {
			const range = rangeOf(r.stockRank);
			pedigreeByRange[range] ??= {};
			pedigreeByRange[range][r.pedigree] =
				(pedigreeByRange[range][r.pedigree] ?? 0) + 1;
		}
		console.log(
			JSON.stringify(
				{
					classes: NUM_LEAGUES * YEARS.length,
					prospects: rows.length,
					summary,
					byPath,
					reasons,
					pedigreeByRange,
				},
				null,
				1,
			),
		);
		const samples = Number(process.env.UNDER_RADAR_SAMPLES ?? 0);
		if (samples > 0) {
			const pick = rows
				.filter((r) => r.stockRank <= 60 && (flagged(r) || r.reason))
				.slice(0, samples);
			for (const r of pick) {
				console.log(JSON.stringify(r, null, 1));
			}
		}
		if (process.env.UNDER_RADAR_OUT) {
			writeFileSync(process.env.UNDER_RADAR_OUT, JSON.stringify(rows));
		}
	},
	1000 * 60 * 60,
);
