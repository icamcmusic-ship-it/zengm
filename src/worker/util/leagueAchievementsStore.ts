import { openDB, type IDBPDatabase } from "@dumbmatter/idb";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import type { GameAttributesLeague } from "../../common/types.ts";

// What the League achievements remember per league: which tiers have already been announced (so an unlock is announced once), and a log of announcements for the "Recent achievements" card. Everything else (who unlocked a tier and when) is computed from the league itself, so losing this only means the next check rebuilds it quietly.
//
// It is kept in the league itself, as the "leagueAchievements" game attribute (the gameAttributes store is the league's key-value store: no new store or migration, and league export/import carries it, since non-standard game attributes are kept on import). It isn't synced to the UI.
//
// Older versions kept it in a small database of its own ("league-achievements", keyed by lid). That entry is read once, moved into the league and deleted.

export type SavedState = NonNullable<
	GameAttributesLeague["leagueAchievements"]
>;
export type UnlockLogEntry = SavedState["log"][number];

const KEY = "leagueAchievements";
const LOG_MAX = 300;

// ---- the old separate database, read once per league ----
const LEGACY_DB_NAME = "league-achievements";
let legacyDbPromise: Promise<IDBPDatabase<unknown> | undefined> | undefined;
const getLegacyDb = () => {
	legacyDbPromise ??= (async () => {
		try {
			if (typeof indexedDB === "undefined") {
				return undefined;
			}
			return (await openDB(LEGACY_DB_NAME, 1, {
				upgrade(db) {
					if (!db.objectStoreNames.contains("leagues")) {
						db.createObjectStore("leagues");
					}
				},
			})) as unknown as IDBPDatabase<unknown>;
		} catch {
			return undefined;
		}
	})();
	return legacyDbPromise;
};

const legacyChecked = new Set<number>();

const readLegacy = async (lid: number): Promise<SavedState | undefined> => {
	if (legacyChecked.has(lid)) {
		return undefined;
	}
	legacyChecked.add(lid);
	try {
		const db = await getLegacyDb();
		const raw = db ? await db.get("leagues", lid) : undefined;
		if (typeof raw === "string") {
			const state = JSON.parse(raw) as SavedState;
			await db!.delete("leagues", lid);
			return state;
		}
	} catch {}
	return undefined;
};

const current = (): SavedState | undefined =>
	Object.hasOwn(g, KEY) ? (g.get(KEY) as SavedState | undefined) : undefined;

const isValid = (
	state: SavedState | undefined,
	startingSeason: number,
): state is SavedState =>
	!!state && state.v === 1 && state.startingSeason === startingSeason;

export const loadState = async (
	lid: number,
	startingSeason: number,
): Promise<SavedState | undefined> => {
	if (g.get("lid") !== lid) {
		return undefined;
	}
	let state = current();
	if (!state) {
		const legacy = await readLegacy(lid);
		if (isValid(legacy, startingSeason) && g.get("lid") === lid) {
			await saveState(lid, legacy);
			state = legacy;
		}
	}
	return isValid(state, startingSeason) ? state : undefined;
};

export const saveState = async (lid: number, state: SavedState) => {
	if (g.get("lid") !== lid) {
		return;
	}
	if (state.log.length > LOG_MAX) {
		state.log = state.log.slice(-LOG_MAX);
	}
	// (a copy, so the cache never holds an object that is changed later)
	const value = structuredClone(state);
	g.setWithoutSavingToDB(KEY, value);
	await idb.cache.gameAttributes.put({ key: KEY, value });
};

// A deleted league: drop what the old database may still hold for it
export const forgetLeagueAchievements = async (lid: number) => {
	legacyChecked.delete(lid);
	try {
		const db = await getLegacyDb();
		await db?.delete("leagues", lid);
	} catch {}
};
