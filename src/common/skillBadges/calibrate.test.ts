// Not a real test: prints badge and combo counts, and badges shown per player before/after combining, for a generated league. Unskip it and look at the output (use --reporter=verbose).
import { describe, test } from "vitest";
import { PLAYER } from "../constants.ts";
import { resetG } from "../../test/helpers.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { last, range } from "../utils.ts";
import {
	SKILL_BADGES,
	SKILL_COMBOS,
	getDisplayBadges,
	getSkillBadges,
	orderDisplayItems,
} from "./index.ts";

describe.skip("calibration", () => {
	test("print", async () => {
		resetG();
		const counts: Record<string, number> = {};
		const players = await createRandomPlayers({
			activeTids: range(30),
			onlyFreeAgents: false,
			scoutingLevel: DEFAULT_LEVEL,
			teams: range(30).map((tid) => ({ tid })),
		});
		const rows = players
			.filter((p) => p.tid >= PLAYER.FREE_AGENT)
			.map((p) => last(p.ratings) as any)
			.sort((a, b) => b.ovr - a.ovr);
		const groups: Record<
			string,
			{ n: number; before: number; after: number; over7: number }
		> = {};
		for (const [i, r] of rows.entries()) {
			const raw = getSkillBadges(r);
			const display = getDisplayBadges(r, r.skills);
			for (const b of raw) {
				counts[b] = (counts[b] ?? 0) + 1;
			}
			for (const b of display) {
				if (!raw.includes(b)) {
					counts[b] = (counts[b] ?? 0) + 1;
				}
			}
			if (i < 12) {
				console.log(
					"STAR",
					orderDisplayItems(r.skills, display)
						.map((x) => x.token)
						.join(" "),
				);
			}
			const group = i < 30 ? "stars" : i < 150 ? "starters" : "bench";
			const before = r.skills.length + raw.length;
			const after = orderDisplayItems(r.skills, display).length;
			const g = (groups[group] ??= { n: 0, before: 0, after: 0, over7: 0 });
			g.n += 1;
			g.before += before;
			g.after += after;
			g.over7 += after > 7 ? 1 : 0;
		}
		console.log(
			`N=${rows.length} BADGES ` +
				SKILL_BADGES.map((d) => `${d.label}=${counts[d.label] ?? 0}`).join(
					" ",
				) +
				"\nCOMBOS " +
				SKILL_COMBOS.map((d) => `${d.label}=${counts[d.label] ?? 0}`).join(
					" ",
				) +
				"\nSHOWN " +
				Object.entries(groups)
					.map(
						([k, g]) =>
							`${k}(n=${g.n}): before ${(g.before / g.n).toFixed(2)} after ${(g.after / g.n).toFixed(2)} >7: ${g.over7}`,
					)
					.join("; "),
		);
	}, 120000);
});
