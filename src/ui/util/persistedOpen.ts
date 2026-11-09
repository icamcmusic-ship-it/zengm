import { useState } from "react";

// Open/closed state of a collapsible panel, remembered in this browser. Storage can be missing or throw (private
// windows, blocked site data), in which case the panel just starts at its default every time.

const storage = (): Storage | undefined => {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage;
	} catch {
		return undefined;
	}
};

export const readOpen = (key: string, defaultOpen: boolean) => {
	try {
		const value = storage()?.getItem(key);
		if (value === "1") {
			return true;
		}
		if (value === "0") {
			return false;
		}
	} catch {}
	return defaultOpen;
};

export const writeOpen = (key: string, open: boolean) => {
	try {
		storage()?.setItem(key, open ? "1" : "0");
	} catch {}
};

export const usePersistedOpen = (key: string, defaultOpen: boolean) => {
	const [open, setOpen] = useState(() => readOpen(key, defaultOpen));
	const toggle = () => {
		setOpen((prev) => {
			writeOpen(key, !prev);
			return !prev;
		});
	};
	return [open, toggle] as const;
};
