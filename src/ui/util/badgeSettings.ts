import { useSyncExternalStore } from "react";
import type { BadgeMode } from "../../common/skillBadges/index.ts";

// "Extended skill badges" display setting. Per-browser convenience, so it lives in localStorage. Default: compact (on).
const KEY = "extendedSkillBadges";
const listeners = new Set<() => void>();
let current: BadgeMode | undefined;

const read = (): BadgeMode => {
	if (current !== undefined) {
		return current;
	}
	let value: BadgeMode = "compact";
	try {
		const stored = localStorage.getItem(KEY);
		if (stored === "off" || stored === "compact" || stored === "full") {
			value = stored;
		}
	} catch {
		// localStorage can be unavailable
	}
	current = value;
	return value;
};

export const setBadgeMode = (mode: BadgeMode) => {
	current = mode;
	try {
		localStorage.setItem(KEY, mode);
	} catch {
		// ignore
	}
	for (const fn of listeners) {
		fn();
	}
};

const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
};

export const useBadgeMode = (): BadgeMode =>
	useSyncExternalStore(subscribe, read, () => "compact");
