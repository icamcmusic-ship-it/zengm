import { openDB, type IDBPDatabase } from "@dumbmatter/idb";

// What the League achievements remember per league: which tiers have already been announced (so an unlock is announced once), and a log of announcements for the "Recent achievements" card. Everything else (who unlocked a tier and when) is computed from the league itself, so losing this only means the next check rebuilds it quietly.
//
// It lives in a small database of its own (like the Wrapped cache, see wrappedPersist.ts), keyed by lid, so the league's own database needs no new store or migration. league.remove forgets a deleted league's entry, and the stored startingSeason guards against an lid being reused.

export type UnlockLogEntry = {
	id: string;
	// When it was noticed in the game
	season: number;
	phase: number;
	// Who and when, as the engine credits it (text, so the dashboard needs no engine run)
	who?: string;
	pid?: number;
	tid?: number;
	at?: number;
	// From the first check of an existing league, which isn't announced
	quiet?: boolean;
};

export type SavedState = {
	v: 1;
	startingSeason: number;
	// Tier id -> [season, phase] it was first noticed in
	seen: Record<string, [number, number]>;
	// Newest last
	log: UnlockLogEntry[];
};

const DB_NAME = "league-achievements";
const LOG_MAX = 300;

let dbPromise: Promise<IDBPDatabase<unknown> | undefined> | undefined;
const getDb = () => {
	dbPromise ??= (async () => {
		try {
			return (await openDB(DB_NAME, 1, {
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
	return dbPromise;
};

// In memory too, so a check doesn't wait on the database and a write in flight is never read back stale
const memory = new Map<number, SavedState>();

export const loadState = async (
	lid: number,
	startingSeason: number,
): Promise<SavedState | undefined> => {
	let state = memory.get(lid);
	if (!state) {
		try {
			const db = await getDb();
			const raw = db ? await db.get("leagues", lid) : undefined;
			if (typeof raw === "string") {
				state = JSON.parse(raw) as SavedState;
			}
		} catch {}
	}
	if (!state || state.v !== 1 || state.startingSeason !== startingSeason) {
		return undefined;
	}
	memory.set(lid, state);
	return state;
};

export const saveState = async (lid: number, state: SavedState) => {
	if (state.log.length > LOG_MAX) {
		state.log = state.log.slice(-LOG_MAX);
	}
	memory.set(lid, state);
	try {
		const db = await getDb();
		await db?.put("leagues", JSON.stringify(state), lid);
	} catch {}
};

export const forgetLeagueAchievements = async (lid: number) => {
	memory.delete(lid);
	try {
		const db = await getDb();
		await db?.delete("leagues", lid);
	} catch {}
};
