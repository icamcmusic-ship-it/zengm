// Not a real test: prints badge counts per generated league. Run with BADGE_CALIBRATE=1 and look at the output (use --reporter=verbose).
import { describe, test } from "vitest";
import { PLAYER } from "../constants.ts";
import { resetG } from "../../test/helpers.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { last, range } from "../utils.ts";
import { SKILL_BADGES, getSkillBadges } from "./index.ts";

describe.skipIf(!process.env.BADGE_CALIBRATE)("calibration", () => {
	test("print", async () => {
		resetG();
		const counts: Record<string, number> = {};
		let n = 0;
		const players = await createRandomPlayers({
			activeTids: range(30),
			onlyFreeAgents: false,
			scoutingLevel: DEFAULT_LEVEL,
			teams: range(30).map((tid) => ({ tid })),
		});
		for (const p of players.filter((p) => p.tid >= PLAYER.FREE_AGENT)) {
			n += 1;
			for (const b of getSkillBadges(last(p.ratings) as any)) {
				counts[b] = (counts[b] ?? 0) + 1;
			}
		}
		console.log(
			`BADGES N=${n} ` +
				SKILL_BADGES.map((d) => `${d.label}=${counts[d.label] ?? 0}`).join(" "),
		);
	}, 120000);
});
