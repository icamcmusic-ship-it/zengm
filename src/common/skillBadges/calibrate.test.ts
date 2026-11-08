// Not a real test: prints badge counts per generated league. Unskip it and look at the output (use --reporter=verbose).
import { describe, test } from "vitest";
import { PLAYER } from "../constants.ts";
import { resetG } from "../../test/helpers.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { last, range } from "../utils.ts";
import { SKILL_BADGES, getDisplayBadges, getSkillBadges } from "./index.ts";

describe.skip("calibration", () => {
	test("print", async () => {
		resetG();
		const counts: Record<string, number> = {};
		const combos: Record<string, number> = {};
		let n = 0;
		const players = await createRandomPlayers({
			activeTids: range(30),
			onlyFreeAgents: false,
			scoutingLevel: DEFAULT_LEVEL,
			teams: range(30).map((tid) => ({ tid })),
		});
		for (const p of players.filter((p) => p.tid >= PLAYER.FREE_AGENT)) {
			n += 1;
			const r = last(p.ratings) as any;
			for (const b of getSkillBadges(r)) {
				counts[b] = (counts[b] ?? 0) + 1;
			}
			for (const t of getDisplayBadges(r, r.skills)) {
				if (!getSkillBadges(r).includes(t)) {
					combos[t] = (combos[t] ?? 0) + 1;
				}
			}
			for (const s of r.skills) {
				counts[s] = (counts[s] ?? 0) + 1;
			}
		}
		console.log(
			`BADGES N=${n} ` +
				SKILL_BADGES.map((d) => `${d.label}=${counts[d.label] ?? 0}`).join(
					" ",
				) +
				` ORIG ${JSON.stringify(counts)} COMBOS ${JSON.stringify(combos)}`,
		);
	}, 120000);
});
