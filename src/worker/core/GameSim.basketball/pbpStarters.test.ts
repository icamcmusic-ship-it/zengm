// The play-by-play lists both teams' starting lineups with the opening tip, once per game
import { assert, test } from "vitest";
import { simulateLiveGame } from "./simLiveGameForTests.ts";

test("starting lineups at the opening tip", async () => {
	const { lines, boxScore } = await simulateLiveGame(11);
	const i = lines.findIndex((l) => l.text.startsWith("Starting lineups"));
	assert.isAtLeast(i, 0);
	// Before any other play, and only once
	assert.isTrue(lines.slice(0, i).every((l) => l.textOnly));
	assert.strictEqual(
		lines.filter((l) => l.text.startsWith("Starting lineups")).length,
		1,
	);
	const all = `${lines[i]!.text} ${lines[i]!.note}`;
	// Five named players per team, each with his position
	for (const t of boxScore.teams) {
		const named = t.players.filter((p: any) =>
			all.includes(`${p.name} (${p.pos})`),
		);
		assert.strictEqual(named.length, 5);
	}
	// The jump ball follows in the same entry
	assert.match(all, /jump|tip/i);
});
