import { assert, test } from "vitest";
import { CONSOLIDATED_PAGES } from "./consolidatedPages.ts";
import { routeInfos } from "./routeInfos.ts";

test("consolidated pages keep their routes, and their home pages exist", () => {
	const routes = new Set(Object.keys(routeInfos));
	for (const { path, home } of CONSOLIDATED_PAGES) {
		assert.isTrue(routes.has(`/l/:lid/${path}`), path);
		assert.isTrue(routes.has(`/l/:lid/${home}`), home);
	}
});
