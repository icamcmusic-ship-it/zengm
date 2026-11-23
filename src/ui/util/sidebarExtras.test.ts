import { afterEach, assert, beforeEach, test, vi } from "vitest";

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
	};
};

const stubWindow = (localStorage: unknown) => {
	vi.stubGlobal("window", { localStorage, navigator: { language: "en-US" } });
};

beforeEach(() => {
	stubWindow(memoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const load = () => import("./sidebarExtras.ts");

const counts = {
	news: { count: 3, latest: 50 },
	tradeOffers: { count: 1, keys: ["a", "b"] },
	newspaper: { count: 2, latest: 2025202 },
};

test("first visit sets the baseline, the page being read is marked seen, the others are not", async () => {
	const { nextSeen } = await load();
	assert.deepStrictEqual(nextSeen({}, counts, "roster"), {
		news: 50,
		tradeOffers: ["a", "b"],
		newspaper: 2025202,
	});

	const seen = { news: 40, tradeOffers: ["a"], newspaper: 2025200 };
	assert.deepStrictEqual(nextSeen(seen, counts, "roster"), seen);
	assert.deepStrictEqual(nextSeen(seen, counts, "news"), {
		...seen,
		news: 50,
	});
	assert.deepStrictEqual(nextSeen(seen, counts, "tradeOffers"), {
		...seen,
		tradeOffers: ["a", "b"],
	});
	assert.deepStrictEqual(nextSeen(seen, counts, "newspaper"), {
		...seen,
		newspaper: 2025202,
	});
});

test("badges: only counts above 0, never on the page being read", async () => {
	const { badgeCounts, formatBadgeCount } = await load();
	assert.deepStrictEqual(badgeCounts(counts, "roster"), {
		news: 3,
		tradeOffers: 1,
		newspaper: 2,
	});
	assert.deepStrictEqual(badgeCounts(counts, "news"), {
		tradeOffers: 1,
		newspaper: 2,
	});
	assert.deepStrictEqual(
		badgeCounts(
			{ news: { count: 0, latest: 1 }, tradeOffers: undefined },
			"roster",
		),
		{},
	);
	assert.strictEqual(formatBadgeCount(150), "99+");
	assert.strictEqual(formatBadgeCount(7), "7");
});

test("seen and recent pages are stored per league", async () => {
	const { readSeen, writeSeen, addRecent, readRecent, MAX_RECENT } =
		await load();
	writeSeen(1, { news: 5 });
	writeSeen(2, { news: 9 });
	assert.deepStrictEqual(readSeen(1), { news: 5 });
	assert.deepStrictEqual(readSeen(2), { news: 9 });
	assert.deepStrictEqual(readSeen(3), {});

	for (let i = 0; i < 10; i++) {
		addRecent(1, { path: `/l/1/page${i}`, label: `Page ${i}` });
	}
	// Visiting a page again moves it to the front
	addRecent(1, { path: "/l/1/page7", label: "Page 7" });
	const recent = readRecent(1);
	assert.strictEqual(recent.length, MAX_RECENT + 1);
	assert.strictEqual(recent[0]!.path, "/l/1/page7");
	assert.strictEqual(recent[1]!.path, "/l/1/page9");
	assert.strictEqual(new Set(recent.map((x) => x.path)).size, recent.length);
	assert.deepStrictEqual(readRecent(2), []);
});

test("broken or missing storage starts empty", async () => {
	stubWindow({
		getItem: () => "{not json",
		setItem: () => {
			throw new Error("blocked");
		},
	});
	const { readSeen, readRecent, addRecent } = await load();
	assert.deepStrictEqual(readSeen(1), {});
	assert.deepStrictEqual(readRecent(1), []);
	assert.strictEqual(addRecent(1, { path: "/x", label: "X" }).length, 1);

	stubWindow(undefined);
	assert.deepStrictEqual(readSeen(1), {});
});

test("collapsed groups from before the regrouping carry over to the groups they were split into", async () => {
	const storage = memoryStorage();
	stubWindow(storage);
	storage.setItem(
		"sidebarCollapsedGroups",
		JSON.stringify(["League", "Tools", "Stats", "Recently visited", 3]),
	);
	const { isGroupCollapsed, readGroupsCollapsed, writeGroupCollapsed } =
		await load();

	assert.deepStrictEqual(readGroupsCollapsed(), {
		League: true,
		Newsroom: true,
		History: true,
		Tools: true,
		Settings: true,
		Commissioner: true,
		Danger: true,
		Stats: true,
		"Recently visited": true,
	});
	// Migrated once
	assert.strictEqual(storage.getItem("sidebarCollapsedGroups"), null);
	assert.isTrue(isGroupCollapsed("Newsroom", false));
	assert.isFalse(isGroupCollapsed("Players", false));

	writeGroupCollapsed("League", false);
	assert.isFalse(isGroupCollapsed("League", false));
	assert.isTrue(isGroupCollapsed("History", false));
});

test("a group collapsed by default stays collapsed until expanded", async () => {
	const { isGroupCollapsed, writeGroupCollapsed } = await load();
	assert.isTrue(isGroupCollapsed("Commissioner", true));
	writeGroupCollapsed("Commissioner", false);
	assert.isFalse(isGroupCollapsed("Commissioner", true));
	assert.isTrue(isGroupCollapsed("Other", true));
});

test("favorites toggle in the order they were pinned, and survive bad storage", async () => {
	const storage = memoryStorage();
	stubWindow(storage);
	const { readFavorites, toggleFavorite } = await load();
	assert.deepStrictEqual(readFavorites(), []);
	assert.deepStrictEqual(toggleFavorite("l/standings"), ["l/standings"]);
	assert.deepStrictEqual(toggleFavorite("/settings"), [
		"l/standings",
		"/settings",
	]);
	assert.deepStrictEqual(toggleFavorite("l/standings"), ["/settings"]);
	assert.deepStrictEqual(readFavorites(), ["/settings"]);

	storage.setItem("sidebarFavorites", "{bad");
	assert.deepStrictEqual(readFavorites(), []);
	storage.setItem("sidebarFavorites", JSON.stringify(["a", 1, "a", "b"]));
	assert.deepStrictEqual(readFavorites(), ["a", "b"]);

	stubWindow(undefined);
	assert.deepStrictEqual(readFavorites(), []);
	assert.deepStrictEqual(toggleFavorite("x"), ["x"]);
});
