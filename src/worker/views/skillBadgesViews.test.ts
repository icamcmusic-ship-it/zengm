// Basketball players show only their 2K badges (the stock skill labels are never shown): every page that sends a player's skills
// also sends his badges, as 2K badge tokens, at most MAX_BADGES of them, whether or not the badges' sim effects (League Extra) are on.
// Plays a short season in a headless league, then loads the views that show players, and the Badges page.
import "fake-indexeddb/auto";
import { ensureTieredBadges } from "../core/player/tieredBadges.ts";
import {
	MAX_BADGES,
	TIERED_BADGES,
	parseBadgeToken,
} from "../../common/tieredBadges/index.ts";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { draft, game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { getDefaultSettings } from "./newLeague.ts";
import * as views from "./index.ts";

// [view, route params]
const VIEWS: [string, Record<string, string>][] = [
	["roster", {}],
	["playerRatings", {}],
	["playerStats", {}],
	["freeAgents", {}],
	["upcomingFreeAgents", {}],
	["tradingBlock", {}],
	["trade", {}],
	["tradeMarket", {}],
	["watchList", {}],
	["injuries", {}],
	["playerBios", {}],
	["leaders", {}],
	["leadersProgressive", {}],
	["awardRaces", {}],
	["teamFinances", {}],
	["leagueDashboard", {}],
	["draftHistory", {}],
	["draftTeamHistory", {}],
	["draftScouting", {}],
	["draftBoard", {}],
	["allStarTeams", {}],
];

const load = (id: string, params: Record<string, string>) => {
	const view = (views as any)[id];
	assert.isDefined(view, id);
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

// Every array of skills in a view's output that is shown, with whether its badges came along: the sibling badges, or
// for the "xSkills" keys the sibling "xBadges", or for p.draft.skills the player's draftBadges
const findSkills = (
	x: unknown,
	path: string,
	out: { path: string; hasBadges: boolean; badges: unknown }[],
	parent?: any,
) => {
	if (Array.isArray(x)) {
		x.forEach((y, i) => {
			findSkills(y, `${path}[${i}]`, out, parent);
		});
		return;
	}
	if (x === null || typeof x !== "object") {
		return;
	}
	const o = x as Record<string, unknown>;
	// The game log's list of games doesn't show players
	if (path.includes(".gamesList")) {
		return;
	}
	for (const [key, value] of Object.entries(o)) {
		if (/skills$/i.test(key) && Array.isArray(value)) {
			let badgesKey = key.replace(/skills$/i, (m) =>
				m[0] === "S" ? "Badges" : "badges",
			);
			let holder: any = o;
			if (key === "skills" && path.endsWith(".draft")) {
				// p.draft comes with many player lists, but its skills are only shown in the draft histories, next to the
				// current skills
				if (!parent || !Object.hasOwn(parent, "currentSkills")) {
					continue;
				}
				badgesKey = "draftBadges";
				holder = parent;
			}
			out.push({
				path: `${path}.${key}`,
				hasBadges: Object.hasOwn(holder, badgesKey),
				badges: holder[badgesKey],
			});
		} else if (typeof value === "object") {
			findSkills(value, `${path}.${key}`, out, o);
		}
	}
};

describe("skill badges in views", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(3);
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
					name: "badges",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						// (the badges' sim effects off: badges are shown all the same)
						featureTwoKBadges: false,
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
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			let guard = 0;
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await game.play(1, {});
				if (++guard > 200) {
					throw new Error("season did not finish");
				}
			}
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
		},
		10 * 60 * 1000,
	);

	const checkViews = async (withGameLog: boolean) => {
		const missing: string[] = [];
		let numWithBadges = 0;
		const gid = (await idb.cache.games.getAll()).at(-1)!.gid;
		for (const [id, params] of [
			...VIEWS,
			...(withGameLog
				? [["gameLog", { gid: String(gid), season: String(g.get("season")) }]]
				: []),
		] as [string, Record<string, string>][]) {
			const output = await load(id, params);
			const found: Parameters<typeof findSkills>[2] = [];
			findSkills(output, id, found);
			for (const f of found) {
				if (!f.hasBadges || !Array.isArray(f.badges)) {
					missing.push(f.path);
					continue;
				}
				const badges = f.badges as string[];
				assert.isAtMost(badges.length, MAX_BADGES, f.path);
				for (const token of badges) {
					assert.isDefined(parseBadgeToken(token), `${f.path} ${token}`);
				}
				if (badges.length > 0) {
					numWithBadges += 1;
				}
			}
		}
		assert.deepEqual(missing.slice(0, 20), []);
		assert.isAbove(numWithBadges, 50);
	};

	test(
		"badges (2K tokens) come with every list of skills, with the sim effects off",
		{ timeout: 300_000 },
		async () => {
			await checkViews(true);
		},
	);

	test("and with the sim effects on", { timeout: 300_000 }, async () => {
		await league.setGameAttributes({ featureTwoKBadges: true });
		await ensureTieredBadges();
		await checkViews(false);
		await league.setGameAttributes({ featureTwoKBadges: false });
	});

	test(
		"Badges page: every badge, holders by tier; No Visible Ratings sends no numbers and a neutral order",
		{ timeout: 300_000 },
		async () => {
			const out = await load("skillBadges", {});
			assert.strictEqual(out.tiered.badges.length, TIERED_BADGES.length);
			assert.isAbove(
				out.tiered.badges.filter((b: any) => b.numHolders > 0).length,
				TIERED_BADGES.length / 2,
			);
			for (const b of out.tiered.badges) {
				for (let i = 1; i < b.holders.length; i++) {
					assert.isAtMost(b.holders[i].tier, b.holders[i - 1].tier);
				}
			}
			await league.setGameAttributes({ challengeNoRatings: true });
			try {
				const hidden = await load("skillBadges", {});
				for (const b of hidden.tiered.badges) {
					assert.isUndefined(b.cutoffs);
					for (const h of b.holders) {
						assert.isUndefined(h.ovr);
						assert.notProperty(h, "score");
					}
					// Within a tier: team, then name
					for (let i = 1; i < b.holders.length; i++) {
						const x = b.holders[i - 1];
						const y = b.holders[i];
						if (x.tier === y.tier) {
							assert.isAtMost(
								x.abbrev.localeCompare(y.abbrev) ||
									x.name.localeCompare(y.name) ||
									x.pid - y.pid,
								0,
							);
						}
					}
				}
			} finally {
				await league.setGameAttributes({ challengeNoRatings: false });
			}
		},
	);
});
