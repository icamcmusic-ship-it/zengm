import { afterEach, assert, test, vi } from "vitest";
import { readOpen, writeOpen } from "./persistedOpen.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
	};
};

test("defaults until toggled, then remembers", () => {
	vi.stubGlobal("localStorage", memoryStorage());
	assert.isFalse(readOpen("panel", false));
	assert.isTrue(readOpen("panel", true));
	writeOpen("panel", true);
	assert.isTrue(readOpen("panel", false));
	writeOpen("panel", false);
	assert.isFalse(readOpen("panel", true));
});

test("storage that throws or is missing falls back to the default", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("SecurityError");
		},
		setItem: () => {
			throw new Error("QuotaExceededError");
		},
	});
	writeOpen("panel", true);
	assert.isFalse(readOpen("panel", false));

	vi.stubGlobal("localStorage", undefined);
	writeOpen("panel", true);
	assert.isTrue(readOpen("panel", true));
});
