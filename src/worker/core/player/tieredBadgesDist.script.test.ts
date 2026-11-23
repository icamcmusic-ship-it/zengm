// 2K Badges: the distribution of tiers in new random leagues, and the correlation of every pair of badge scores among rotation
// players (near-duplicates: above BADGE_CORR_MAX), with the player traits as stored and with them left out (their rating stand-ins).
//   BADGE_DIST=1 [BADGE_DIST_SEEDS=1,2,3] [BADGE_DIST_ROWS=/tmp/rows.json] npx vitest run --project basketball --silent=false <this file>
// BADGE_DIST_ROWS: the rotation players' rows are saved there, and when the file exists they are read from it instead of making new
// leagues (only the correlations are printed then: quick, for tuning the score formulas).
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { helpers } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import {
	TIERED_BADGES,
	TRAIT_PREFIX,
	entryForSeason,
	tieredBadgeScore,
} from "../../../common/tieredBadges/index.ts";
import { badgeRowOf } from "./tieredBadges.ts";

const env = (globalThis as any).process.env;
const CORR_MAX = Number(env.BADGE_CORR_MAX ?? 0.85);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs: number[], ys: number[]) => {
	const mx = mean(xs);
	const my = mean(ys);
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < xs.length; i++) {
		sxy += (xs[i]! - mx) * (ys[i]! - my);
		sxx += (xs[i]! - mx) ** 2;
		syy += (ys[i]! - my) ** 2;
	}
	return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
};

const withoutTraits = (r: Record<string, any>) =>
	Object.fromEntries(
		Object.entries(r).filter(([k]) => !k.startsWith(TRAIT_PREFIX)),
	);

test.skipIf(!env.BADGE_DIST)(
	"2K badge distribution and correlations",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		const seeds = String(env.BADGE_DIST_SEEDS ?? "1")
			.split(",")
			.map(Number);
		const rowsOn: Record<string, any>[] = [];
		const rowsOff: Record<string, any>[] = [];
		const lines: string[] = [];
		const total = { players: 0, holders: 0, tiers: [0, 0, 0, 0, 0, 0] };
		const perBadge: Record<string, number[]> = {};
		const perPlayer: number[] = [0, 0, 0, 0, 0, 0, 0];
		let maxLegends = 0;
		const rowsFile = env.BADGE_DIST_ROWS;
		const cached = rowsFile && existsSync(rowsFile);
		if (cached) {
			rowsOn.push(...JSON.parse(readFileSync(rowsFile, "utf8")));
			rowsOff.push(...rowsOn.map(withoutTraits));
		}
		for (const seed of cached ? [] : seeds) {
			Math.random = makeSeededRandom(seed);
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
					name: `badgeDist${seed}`,
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						...(gameSimPresets as any)[2026],
						spectator: true,
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			const players = await idb.cache.players.getAll();
			const byTid = new Map<number, typeof players>();
			const legends: Record<string, number> = {};
			for (const p of players) {
				if (p.tid < 0) {
					continue;
				}
				const list = byTid.get(p.tid) ?? [];
				list.push(p);
				byTid.set(p.tid, list);
				const t = entryForSeason(p.badges2k, 2025)?.t ?? {};
				const n = Object.keys(t).length;
				total.players++;
				perPlayer[n] = (perPlayer[n] ?? 0) + 1;
				if (n > 0) {
					total.holders++;
				}
				for (const [k, tier] of Object.entries(t)) {
					total.tiers[tier!]!++;
					perBadge[k] ??= [0, 0, 0, 0, 0, 0];
					perBadge[k][tier!]!++;
					if (tier === 5) {
						legends[k] = (legends[k] ?? 0) + 1;
					}
				}
			}
			maxLegends = Math.max(maxLegends, ...Object.values(legends), 0);
			for (const list of byTid.values()) {
				list.sort((a, b) => last(b.ratings).ovr - last(a.ratings).ovr);
				for (const p of list.slice(0, 10)) {
					const r = badgeRowOf(p);
					rowsOn.push(r);
					rowsOff.push(withoutTraits(r));
				}
			}
		}
		if (rowsFile && !cached) {
			writeFileSync(rowsFile, JSON.stringify(rowsOn));
		}
		lines.push(
			`BADGES ${TIERED_BADGES.length}; leagues ${seeds.length}; players on teams ${total.players}, with 1+ badge ${total.holders} (${((100 * total.holders) / total.players).toFixed(1)}%); tiers B/S/G/HOF/L ${total.tiers.slice(1).join("/")}; badges per player 0..6 ${perPlayer.join("/")}; max Legends of one badge in a league ${maxLegends}`,
		);
		for (const def of TIERED_BADGES) {
			lines.push(
				`  ${def.category} ${def.key} ${(perBadge[def.key] ?? [0, 0, 0, 0, 0, 0]).slice(1).join("/")}`,
			);
		}
		for (const [label, rows] of [
			["traits on", rowsOn],
			["traits off (stand-ins)", rowsOff],
		] as const) {
			const scores = TIERED_BADGES.map((def) =>
				rows.map((r) => tieredBadgeScore(r, def)),
			);
			const pairs: [number, string, string][] = [];
			for (let i = 0; i < TIERED_BADGES.length; i++) {
				for (let j = i + 1; j < TIERED_BADGES.length; j++) {
					pairs.push([
						corr(scores[i]!, scores[j]!),
						TIERED_BADGES[i]!.key,
						TIERED_BADGES[j]!.key,
					]);
				}
			}
			pairs.sort((a, b) => b[0] - a[0]);
			lines.push(
				`CORR ${label} (n ${rows.length}): max ${pairs[0]![0].toFixed(3)}; above ${CORR_MAX}: ${pairs.filter((p) => p[0] > CORR_MAX).length}`,
			);
			for (const [c, a, b] of pairs.slice(0, 20)) {
				lines.push(`  ${c.toFixed(3)} ${a} ${b}`);
			}
		}
		console.log(lines.join("\n"));
	},
);
