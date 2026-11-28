import { assert, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Each src/worker/core/*/index.ts builds its namespace object (`export default { ... }`) from its imports at module
// evaluation time. If the worker's import graph reaches one of them while one of its own imports is still mid-evaluation
// (an import cycle entered from the wrong side), the build throws "Cannot access 'x' before initialization" when the
// worker starts, no handler gets registered, and the UI hangs on its loading screen ("No handler registered to receive
// this message"). This walks the static imports in the order ES modules evaluate them and checks that never happens.

const root = path.resolve(import.meta.dirname, "..", "..");
const entry = path.join(root, "src/worker/index.ts");
const coreDir = path.join(root, "src/worker/core");

const depsCache = new Map<string, string[]>();
const getDeps = (file: string) => {
	let deps = depsCache.get(file);
	if (!deps) {
		deps = [];
		let source = "";
		try {
			source = fs.readFileSync(file, "utf8");
		} catch {}
		for (const match of source.matchAll(
			/^(?:import|export)\s+(?!type\b)(?:[^;"]*?from\s+)?"(\.[^"]+)"/gms,
		)) {
			deps.push(path.resolve(path.dirname(file), match[1]!));
		}
		depsCache.set(file, deps);
	}
	return deps;
};

const isCoreNamespace = (file: string) =>
	path.dirname(path.dirname(file)) === coreDir &&
	path.basename(file) === "index.ts";

// Cycles that already existed when this test was added and are harmless (the late import is only used inside functions,
// or not in the namespace object). Keyed "namespace -> import". Don't add to this without checking the built worker starts.
const KNOWN_OK = new Set([
	"src/worker/core/contract/index.ts -> src/worker/db/index.ts",
	"src/worker/core/contract/index.ts -> src/worker/util/index.ts",
	"src/worker/core/seasonOdds/index.ts -> src/worker/core/index.ts",
	"src/worker/core/seasonOdds/index.ts -> src/worker/core/game/loadTeams.ts",
	"src/worker/core/gm/index.ts -> src/worker/core/index.ts",
	"src/worker/core/scoutingReports/index.ts -> src/worker/core/scoutingReports/room.ts",
	"src/worker/core/scoutingReports/index.ts -> src/worker/core/staffDepth/scouting.ts",
	"src/worker/core/draftStash/index.ts -> src/worker/util/recomputeLocalUITeamOvrs.ts",
	"src/worker/core/staff/index.ts -> src/worker/core/staff/collegeCarousel.ts",
	"src/worker/core/college/index.ts -> src/worker/core/index.ts",
	"src/worker/core/ownerOffice/index.ts -> src/worker/core/commercial/index.ts",
	"src/worker/core/leagueEras/index.ts -> src/worker/core/index.ts",
]);

test("worker core namespaces evaluate after all their imports", () => {
	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];
	const problems: string[] = [];
	const visit = (file: string) => {
		if (state.has(file)) {
			return;
		}
		state.set(file, "visiting");
		stack.push(file);
		for (const dep of getDeps(file)) {
			visit(dep);
		}
		if (isCoreNamespace(file)) {
			for (const dep of getDeps(file)) {
				if (
					state.get(dep) === "visiting" &&
					!KNOWN_OK.has(
						`${path.relative(root, file)} -> ${path.relative(root, dep)}`,
					)
				) {
					problems.push(
						`${path.relative(root, file)} evaluates before its import ${path.relative(root, dep)} finished. Import chain:\n  ${stack.map((f) => path.relative(root, f)).join("\n  ")}`,
					);
				}
			}
		}
		state.set(file, "done");
		stack.pop();
	};
	visit(entry);
	assert.deepEqual(problems, []);
});
