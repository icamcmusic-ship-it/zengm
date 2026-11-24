// Fog of war guard: everything the user sees about an undrafted prospect is what his scouts see (valueFuzz, ratings with the
// scouting fuzz), never his true value, ovr or pot. A static scan of the prospect-facing worker code: every read of `.value`,
// `.ovr` or `.pot` must be on this allow-list with the reason it is safe (fuzzed a line or two up, a drafted or past player, a
// rating being written, the AI's own decision, ...), so a new read of a true rating on these pages fails here until someone has
// looked at it. Reads on a line that applies the fuzz (fuzzRating, applyFuzz, ...) are fine as they are.
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { existsSync, readFileSync } from "node:fs";
import { assert, test } from "vitest";

// src/
const ROOT = new URL("../../../", import.meta.url).pathname;

// Views and APIs that show prospects, and the core code that builds what they show
const FILES = [
	"worker/views/draftScouting.ts",
	"worker/views/draftBoard.ts",
	"worker/views/mockDraft.ts",
	"worker/views/bigBoards.ts",
	"worker/views/playerPreDraft.ts",
	"worker/views/draftCombine.ts",
	"worker/views/collegeOverseas.ts",
	"worker/views/draft.ts",
	"worker/api/archetypes.ts",
	"worker/api/regenerateRatings.ts",
	"worker/core/draft/classShape.ts",
	"worker/core/draft/draftDay.ts",
	"worker/core/draft/mockDraft.ts",
	"worker/core/draft/mockDraftData.ts",
	"worker/core/draft/proProjection.ts",
	"worker/core/draft/preDraftRanks.ts",
	"worker/core/draft/radar.ts",
	"worker/core/draft/regenerateRatings.ts",
	"worker/core/draftCombine/index.ts",
	"worker/core/draftOutlets/index.ts",
	"worker/core/scoutingReports/index.ts",
	"worker/core/scoutingReports/input.ts",
	"worker/core/scoutingReports/room.ts",
	"worker/core/scoutingReports/skillSignals.ts",
];

type Allow = { file: string; line: string; why: string };

// `line` is a piece of the trimmed source line. Keep `why` honest: it is the review
const ALLOW: Allow[] = [
	// Draft Scouting
	{
		file: "worker/views/draftScouting.ts",
		line: "getPlayerProduction(playersByPid.get(pa.pid)!)?.value",
		why: "age-adjusted production (box score), not player value",
	},
	{
		file: "worker/views/draftScouting.ts",
		line: "ovr: ratings.ovr,",
		why: "formatAll with fuzz: true",
	},
	{
		file: "worker/views/draftScouting.ts",
		line: "pot: ratings.pot,",
		why: "formatAll with fuzz: true",
	},
	// Draft Board
	{
		file: "worker/views/draftBoard.ts",
		line: "ovr: ratings.ovr as number",
		why: "formatAll with fuzz: true",
	},
	{
		file: "worker/views/draftBoard.ts",
		line: "pot: ratings.pot as number",
		why: "formatAll with fuzz: true",
	},
	// Prospect player page
	{
		file: "worker/views/playerPreDraft.ts",
		line: ".map((x) => x.value)",
		why: "production values of the class",
	},
	{
		file: "worker/views/playerPreDraft.ts",
		line: "production.value",
		why: "production, not player value",
	},
	{
		file: "worker/views/playerPreDraft.ts",
		line: "ovr: r.ovr,",
		why: "getComps: past players of the league at their draft (drafted, no fog)",
	},
	{
		file: "worker/views/playerPreDraft.ts",
		line: "peakOvr = Math.max(peakOvr, row.ovr)",
		why: "getComps: a past player's pro career",
	},
	{
		file: "worker/views/playerPreDraft.ts",
		line: "ovrAtDraft: r.ovr",
		why: "getComps: a past player's draft year ratings",
	},
	{
		file: "worker/views/playerPreDraft.ts",
		line: "potAtDraft: r.pot",
		why: "getComps: a past player's draft year ratings",
	},
	// College/Overseas page
	{
		file: "worker/views/collegeOverseas.ts",
		line: "p.tid === PLAYER.UNDRAFTED ? p.valueFuzz : p.value",
		why: "true value only once he is drafted",
	},
	// Archetypes
	{
		file: "worker/api/archetypes.ts",
		line: "ovr: row.ovr,",
		why: "archetypeRoster: a team's roster (pros)",
	},
	{
		file: "worker/api/archetypes.ts",
		line: "players.sort((a, b) => b.ovr - a.ovr || a.pid - b.pid)",
		why: "archetypeRoster: a team's roster (pros)",
	},
	{
		file: "worker/api/archetypes.ts",
		line: "ovr: (last(p.ratings) as any).ovr",
		why: "archetypeLandscape: players on teams and free agents only",
	},
	{
		file: "worker/api/archetypes.ts",
		line: "ovr: t.ovr,",
		why: "archetypeLandscape: players on teams and free agents only",
	},
	{
		file: "worker/api/archetypes.ts",
		line: "ovr: r.row.ovr,",
		why: "archetype feedback: the classifier's input saved for tuning, never shown",
	},
	{
		file: "worker/api/archetypes.ts",
		line: ": (row.ovr ?? 0),",
		why: "feedback queue: pros only, prospects are fuzzed on the line above",
	},
	{
		file: "worker/api/archetypes.ts",
		line: "b.ovr - a.ovr || a.pid - b.pid",
		why: "feedback queue order: the ovr set above (fuzzed for prospects)",
	},
	// Classes: shape and story
	{
		file: "worker/core/draft/classShape.ts",
		line: "(a, b) => b.value - a.value || a.pid - b.pid",
		why: "applyPendingShape: generating the class (nothing shown)",
	},
	{
		file: "worker/core/draft/classShape.ts",
		line: "ovr: ratings.ovr,",
		why: "applyPendingShape: generating the class / getClassHistory: past drafted classes",
	},
	{
		file: "worker/core/draft/classShape.ts",
		line: "c.ovr",
		why: "applyPendingShape: the plan's ovr change",
	},
	{
		file: "worker/core/draft/classShape.ts",
		line: "value: undrafted ? p.valueFuzz : p.value",
		why: "toStoryProspect: true value only once drafted",
	},
	{
		file: "worker/core/draft/classShape.ts",
		line: "pot: ratings.pot,",
		why: "getClassHistory: past drafted classes",
	},
	{
		file: "worker/core/draft/classShape.ts",
		line: "(ratings.ovr + ratings.pot) / 2 - 500",
		why: "getClassHistory: past classes' undrafted, never shown individually",
	},
	// Draft-day boards
	{
		file: "worker/core/draft/draftDay.ts",
		line: "seen.value +",
		why: "perceivedProspect: value as scouted",
	},
	{
		file: "worker/core/draft/draftDay.ts",
		line: "b.ratings.ovr - a.ratings.ovr",
		why: "trade assets: rostered players, formatAll with fuzz: true",
	},
	{
		file: "worker/core/draft/draftDay.ts",
		line: "ovr: p.ratings.ovr,",
		why: "trade assets: rostered players, formatAll with fuzz: true",
	},
	{
		file: "worker/core/draft/draftDay.ts",
		line: "pot: p.ratings.pot,",
		why: "trade assets: rostered players, formatAll with fuzz: true",
	},
	// Mock draft
	{
		file: "worker/core/draft/mockDraft.ts",
		line: "value: p.value,",
		why: "pure: the caller passes perceivedProspect (valueFuzz)",
	},
	{
		file: "worker/core/draft/mockDraft.ts",
		line: "ovr: r.ovr,",
		why: "pure: the caller passes perceivedProspect (fuzzed ratings)",
	},
	{
		file: "worker/core/draft/mockDraft.ts",
		line: "pot: r.pot,",
		why: "pure: the caller passes perceivedProspect (fuzzed ratings)",
	},
	{
		file: "worker/core/draft/mockDraft.ts",
		line: "getDraftTraitAdjustment(p.value",
		why: "pure: the caller passes perceivedProspect (valueFuzz)",
	},
	{
		file: "worker/core/draft/mockDraft.ts",
		line: "(a, b) => b.value - a.value",
		why: "pure: the caller passes perceivedProspect (valueFuzz)",
	},
	{
		file: "worker/core/draft/mockDraftData.ts",
		line: "value: p.value,",
		why: "p is perceivedProspect (valueFuzz)",
	},
	{
		file: "worker/core/draft/mockDraftData.ts",
		line: "ovr: ratings.ovr as number",
		why: "formatAll with fuzz: true",
	},
	{
		file: "worker/core/draft/mockDraftData.ts",
		line: "pot: ratings.pot as number",
		why: "formatAll with fuzz: true",
	},
	{
		file: "worker/core/draft/proProjection.ts",
		line: "s.ovr",
		why: "simulated careers from the scouted ratings",
	},
	// Regenerate ratings: the preview shows ratings through display() (fuzzed); the rest is the engine's input and the apply/undo
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "pot: row.pot,",
		why: "engine input / unchanged-check, shown through display()",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "resolved.pot",
		why: "engine input",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "ovrUnchanged: after.ovr === currentOvr",
		why: "whether the rebuild changed him, not a rating",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "potUnchanged: after.pot === row.pot",
		why: "whether the rebuild changed him, not a rating",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "after.ovr,",
		why: "fuzzedArchetypeLabel's input (fuzzed inside)",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "pot: after.pot,",
		why: "fuzzedArchetypeLabel's input (fuzzed inside)",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "value: p.value,",
		why: "undo snapshot",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "row.ovr = r.after.ovr",
		why: "apply: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "row.pot = r.after.pot",
		why: "apply: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "row.pot = Math.max(",
		why: "apply / restore: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "p.draft.ovr = row.ovr",
		why: "apply: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "p.draft.pot = row.pot",
		why: "apply: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "p.value = e.value",
		why: "undo: writing",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "params.pot",
		why: "Customize Player: the form's own ratings (the user typed them)",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "r.after.ovr]",
		why: "Customize Player: the form's own ratings",
	},
	{
		file: "worker/core/draft/regenerateRatings.ts",
		line: "r.after.pot",
		why: "Customize Player: the form's own ratings / fuzzedArchetypeLabel input",
	},
	// Scouting reports, consensus and media
	{
		file: "worker/core/scoutingReports/index.ts",
		line: "${c.value} (${c.pct}th pct)",
		why: "a stat line in the report, not player value",
	},
	{
		file: "worker/core/scoutingReports/input.ts",
		line: "if (!best || ovr > best.ovr)",
		why: "best.ovr was fuzzed when it was set",
	},
	{
		file: "worker/core/scoutingReports/input.ts",
		line: "peakOvr: peak?.ovr ?? 0",
		why: "comp index: past players' careers",
	},
	{
		file: "worker/core/scoutingReports/input.ts",
		line: "ovr: ratings.ovr }",
		why: "ScoutRatings: already scouted (scoutedRatingsOf)",
	},
	{
		file: "worker/core/scoutingReports/input.ts",
		line: "ratings?.ovr",
		why: "team fit: the user's own roster through lightOf (scouted)",
	},
	{
		file: "worker/core/scoutingReports/room.ts",
		line: "ovr: r.ovr,",
		why: "scoutedRatingsOf (fuzzed)",
	},
	{
		file: "worker/core/scoutingReports/room.ts",
		line: "pot: r.pot,",
		why: "scoutedRatingsOf (fuzzed)",
	},
	{
		file: "worker/core/scoutingReports/skillSignals.ts",
		line: "adj?.value",
		why: "age-adjusted production",
	},
	{
		file: "worker/core/draftOutlets/index.ts",
		line: "value: p.value,",
		why: "media outlets: true value blurred by shared public-perception noise that averaging can't remove (by design, docs: Big boards from outlets)",
	},
	{
		file: "worker/core/draftOutlets/index.ts",
		line: "upside: (r?.pot ?? 0) - (r?.ovr ?? 0)",
		why: "media outlets' upside lean, blurred like their value read",
	},
	{
		file: "worker/core/draftOutlets/index.ts",
		line: "return memo.value",
		why: "a memo, not player value",
	},
];

// A read of .value / .ovr / .pot (not a call like F.ovr(...), not the left side of an assignment)
const READ = /\.(value|ovr|pot)\b(?!\s*\()(?!\s*=[^=])/;
// A line that fuzzes what it reads
const FUZZED =
	/\b(fuzzRating|applyFuzz|fuzzed|display|fuzzedArchetypeLabel|perceivedProspect)\(/;

const scan = () => {
	const hits: { file: string; line: string; n: number }[] = [];
	for (const file of FILES) {
		const lines = readFileSync(`${ROOT}${file}`, "utf8").split("\n");
		for (const [i, raw] of lines.entries()) {
			const line = raw.trim();
			if (
				line.startsWith("//") ||
				line.startsWith("*") ||
				line.startsWith("/*")
			) {
				continue;
			}
			if (READ.test(line) && !FUZZED.test(line)) {
				hits.push({ file, line, n: i + 1 });
			}
		}
	}
	return hits;
};

test("every read of a true value/ovr/pot in prospect-facing code is reviewed", () => {
	const unreviewed = scan().filter(
		(h) => !ALLOW.some((a) => a.file === h.file && h.line.includes(a.line)),
	);
	assert.deepEqual(
		unreviewed.map((h) => `src/${h.file}:${h.n}: ${h.line}`),
		[],
		"New reads of .value/.ovr/.pot in prospect-facing code. If it is about an undrafted prospect and shown to the user, use valueFuzz or fuzz the rating; otherwise add it to ALLOW with the reason",
	);
});

test("the allow-list has no stale entries", () => {
	const hits = scan();
	const stale = ALLOW.filter(
		(a) => !hits.some((h) => h.file === a.file && h.line.includes(a.line)),
	);
	assert.deepEqual(stale, []);
	for (const file of FILES) {
		assert.isTrue(existsSync(`${ROOT}${file}`), file);
	}
});
