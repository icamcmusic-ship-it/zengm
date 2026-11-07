import type { Store } from "./Cache.ts";
import { PLAYER } from "../../common/constants.ts";
import g from "../util/g.ts";
import {
	forgetGames,
	forgetLeague,
	forgetPlayers,
	forgetTeams,
} from "../util/wrappedPersist.ts";

// A record of what has been written through the cache since a league was loaded, so that things derived from the database (like the Wrapped and Storylines snapshot) know what has to be recomputed. Every write to the cache (add, put, delete, clear) goes through note*, and loading a league (Cache.fill) resets the log. It only stores numbers: a sequence number per player, per (store, season) and per store.

let seq = 0;
let epoch = 0;
let keepOnNextFill = false;
const playerSeq = new Map<number, number>();
const seasonSeq = new Map<string, number>();
const storeSeq = new Map<Store, number>();

// Writes happen while a league is being created, before every game attribute is set
const gNumber = (key: "lid" | "season") => {
	try {
		return g.get(key);
	} catch {
		return undefined;
	}
};

// Retired players written to, to be dropped from the persisted Wrapped snapshot (see util/wrappedPersist.ts)
const forgetPids = new Set<number>();
const forgetPlayerSoon = (pid: number) => {
	if (forgetPids.size === 0) {
		queueMicrotask(() => {
			const pids = [...forgetPids];
			forgetPids.clear();
			const lid = gNumber("lid");
			if (lid !== undefined) {
				void forgetPlayers(lid, pids);
			}
		});
	}
	forgetPids.add(pid);
};

const forgetLeagueSoon = () => {
	const lid = gNumber("lid");
	if (lid !== undefined) {
		void forgetLeague(lid);
	}
};
const forgetTeamsSoon = () => {
	const lid = gNumber("lid");
	if (lid !== undefined) {
		void forgetTeams(lid);
	}
};

const SEASON_STORES = new Set<Store>([
	"games",
	"teamSeasons",
	"teamStats",
	"playoffSeries",
]);

export const changeLog = {
	// Bumped whenever the cache is (re)filled, so everything derived before is dropped
	get epoch() {
		return epoch;
	},

	// Increases with every write
	get seq() {
		return seq;
	},

	// The next fill reloads exactly what was just saved, so nothing derived from the database is out of date. Used for the fill in every preseason.
	keepOnNextFill() {
		keepOnNextFill = true;
	},

	// Called when the cache is filled from the database. wasFull means it was already full, so this is a refill, which happens after something may have changed the database behind the cache's back.
	onFill(wasFull: boolean) {
		if (keepOnNextFill) {
			keepOnNextFill = false;
			return;
		}
		if (wasFull) {
			forgetLeagueSoon();
		}
		changeLog.reset();
	},

	reset() {
		epoch += 1;
		seq += 1;
		playerSeq.clear();
		seasonSeq.clear();
		storeSeq.clear();
	},

	noteWrite(store: Store, row: any) {
		seq += 1;
		storeSeq.set(store, seq);
		if (store === "players") {
			playerSeq.set(row.pid, seq);
			// Only retired players are persisted, and a player who is no longer retired isn't read from the persisted copy
			if (row.tid === PLAYER.RETIRED) {
				forgetPlayerSoon(row.pid);
			}
		} else if (SEASON_STORES.has(store)) {
			if (typeof row?.season === "number") {
				const lid = gNumber("lid");
				const current = gNumber("season");
				if (
					lid !== undefined &&
					current !== undefined &&
					row.season < current
				) {
					if (store === "games") {
						void forgetGames(lid, row.season);
					} else if (store === "teamSeasons" || store === "teamStats") {
						void forgetTeams(lid, row.season);
					}
				}
				seasonSeq.set(`${store}|${row.season}`, seq);
			} else {
				// Unknown season, treat like a clear
				seasonSeq.set(`${store}|*`, seq);
			}
		}
	},

	// Only the key of a deleted row is known
	noteDelete(store: Store, id: number | string) {
		seq += 1;
		storeSeq.set(store, seq);
		if (store === "players") {
			const pid = typeof id === "number" ? id : Number(id);
			playerSeq.set(pid, seq);
			forgetPlayerSoon(pid);
		} else if (SEASON_STORES.has(store)) {
			seasonSeq.set(`${store}|*`, seq);
			if (store === "teamSeasons" || store === "teamStats") {
				forgetTeamsSoon();
			}
		}
	},

	noteClear(store: Store) {
		seq += 1;
		storeSeq.set(store, seq);
		if (store === "players") {
			// Every player is gone
			playerSeq.set(-1, seq);
			forgetLeagueSoon();
		} else if (SEASON_STORES.has(store)) {
			seasonSeq.set(`${store}|*`, seq);
			if (store === "teamSeasons" || store === "teamStats") {
				forgetTeamsSoon();
			}
		}
	},

	// Sequence number of the last write to a player, or 0 if none since the league was loaded
	player(pid: number) {
		return Math.max(playerSeq.get(pid) ?? 0, playerSeq.get(-1) ?? 0);
	},

	// Last write to a store of any kind
	store(store: Store) {
		return storeSeq.get(store) ?? 0;
	},

	// Last write to a season of a store that is keyed by season, including writes whose season is not known
	season(store: Store, season: number) {
		return Math.max(
			seasonSeq.get(`${store}|${season}`) ?? 0,
			seasonSeq.get(`${store}|*`) ?? 0,
		);
	},
};
