// Every place the UI shows a player's skills also passes the extended skill badges (shown when that League Extra is
// on), except the few that show players from outside the league's database
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { assert, test } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;

// Players that aren't in this league (other leagues, files), stock box scores of other sports, and the ratings
// regenerator's before/after preview
const ALLOWED = new Set([
	"components/BoxScore.baseball.tsx",
	"components/BoxScoreRow.football.tsx",
	"components/RegenerateRatings/RegenerateRatingsModal.tsx",
	"components/SkillsBlock.tsx",
	"components/PlayerNameLabels.tsx",
	"views/CustomizePlayer/RegenerateBuild.tsx",
	"views/EightyTwoZeroDraft.tsx",
	"views/Exhibition.tsx",
	"views/ImportPlayers.tsx",
	"views/ScheduledEvents/index.tsx",
]);

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((name: string) => {
		const path = `${dir}/${name}`;
		return statSync(path).isDirectory()
			? files(path)
			: path.endsWith(".tsx")
				? [path]
				: [];
	});

test("skills are shown with their badges", () => {
	const missing: string[] = [];
	const all = files(`${ROOT}components`).concat(files(`${ROOT}views`));
	assert.isAbove(all.length, 100);
	let numChecked = 0;
	for (const path of all) {
		const rel = path.slice(ROOT.length);
		if (ALLOWED.has(rel)) {
			continue;
		}
		const lines = readFileSync(path, "utf8").split("\n");
		lines.forEach((line: string, i: number) => {
			// A skills prop or a skills key passed to wrappedPlayerNameLabels / wrappedSkillsBlock
			if (!/^\s*skills(={|: )/.test(line)) {
				return;
			}
			numChecked += 1;
			const near = lines.slice(i, i + 3).join("\n");
			if (!/badges/.test(near)) {
				missing.push(`${rel}:${i + 1}`);
			}
		});
	}
	assert.deepEqual(missing, []);
	assert.isAbove(numChecked, 30);
});
