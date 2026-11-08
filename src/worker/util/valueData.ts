import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g } from "./index.ts";
import { PLAYER } from "../../common/constants.ts";
import type { EventBBGM, Player } from "../../common/types.ts";
import { toVPlayer, toVTrade } from "../../common/valueGrades/convert.ts";
import {
	gradeTrade,
	gradeTrades,
	makeCtx,
	type GradeTrade,
	type TradeGrades,
} from "../../common/valueGrades/tradeGrader.ts";
import {
	computeContractValue,
	type ContractValue,
} from "../../common/valueGrades/contractValue.ts";
import type {
	VLeague,
	VPlayer,
	VTeamSeason,
	VTrade,
} from "../../common/valueGrades/types.ts";
import { getPlayerFromPick } from "./formatEventText.ts";

// The league snapshot behind the Trade grader and Contract value pages (basketball only). Reading every player is slow in a big league, so converted players are kept between page loads and only players written to since (found through the change log, see db/changeLog.ts) are converted again. Retired players are read from IndexedDB once. Trade events of seasons that are no longer in the cache are read once too.

type PlayerEntry = { seq: number; vp: VPlayer };

type State = {
	lid: number;
	epoch: number;
	players: Map<number, PlayerEntry>;
	trades: Map<number, VTrade> | undefined;
	eventsSeq: number;
	pastTeamSeasons: { season: number; rows: VTeamSeason[] } | undefined;
	sig: string | undefined;
	built: Promise<Snapshot> | undefined;
	last: Snapshot | undefined;
	queue: Promise<unknown>;
	version: number;
};

export type Snapshot = {
	L: VLeague;
	version: number;
	sig: string;
	memo: Map<string, unknown>;
};

let state: State | undefined;

// Big leagues are a lot of memory, so the snapshot isn't kept for a league nobody has looked at in a while
const KEEP_MS = 10 * 60 * 1000;
let evictTimer: ReturnType<typeof setTimeout> | undefined;
const touch = () => {
	clearTimeout(evictTimer);
	evictTimer = setTimeout(() => {
		state = undefined;
	}, KEEP_MS);
	(evictTimer as { unref?: () => void }).unref?.();
};

const yieldToWorker = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

const signature = () =>
	[
		g.get("lid"),
		changeLog.epoch,
		g.get("season"),
		g.get("phase"),
		changeLog.store("players"),
		changeLog.store("events"),
		changeLog.store("teamSeasons"),
	].join("|");

const isTradeEvent = (e: EventBBGM) => e.type === "trade";

const loadTrades = async (s: State) => {
	if (!s.trades) {
		const events = await idb.merged.events.getAll(undefined, {
			filter: isTradeEvent,
		});
		s.trades = new Map();
		for (const e of events) {
			const t = toVTrade(e);
			if (t) {
				s.trades.set(t.eid, t);
			}
		}
		s.eventsSeq = changeLog.store("events");
	} else if (changeLog.store("events") !== s.eventsSeq) {
		// Only events in the cache (the latest seasons) can have changed
		s.eventsSeq = changeLog.store("events");
		const seasons = new Set<number>();
		const recent: VTrade[] = [];
		for (const e of await idb.cache.events.getAll()) {
			seasons.add(e.season);
			if (isTradeEvent(e)) {
				const t = toVTrade(e);
				if (t) {
					recent.push(t);
				}
			}
		}
		for (const [eid, t] of s.trades) {
			if (seasons.has(t.season)) {
				s.trades.delete(eid);
			}
		}
		for (const t of recent) {
			s.trades.set(t.eid, t);
		}
	}
	return [...s.trades.values()].sort((a, b) => a.eid - b.eid);
};

const toVTeamSeason = (ts: {
	tid: number;
	season: number;
	won: number;
	lost: number;
}): VTeamSeason => ({
	tid: ts.tid,
	season: ts.season,
	won: ts.won,
	lost: ts.lost,
});

const loadTeamSeasons = async (s: State) => {
	const season = g.get("season");
	if (!s.pastTeamSeasons || s.pastTeamSeasons.season !== season) {
		const rows = await idb.merged.teamSeasons.getAll(undefined, {
			filter: (ts) => ts.season < season,
		});
		s.pastTeamSeasons = { season, rows: rows.map(toVTeamSeason) };
	}
	const current = await idb.merged.teamSeasons.getAll({ season });
	return [...s.pastTeamSeasons.rows, ...current.map(toVTeamSeason)];
};

const inLeague = (p: { tid: number }) =>
	p.tid === PLAYER.RETIRED || p.tid >= PLAYER.FREE_AGENT;

const loadPlayers = async (s: State) => {
	const seq0 = changeLog.seq;
	const cacheByKey = (await idb.cache.players.getAllByKey()) as Record<
		number,
		Player
	>;
	const dbRetired = await idb.league
		.transaction("players")
		.store.index("tid")
		.getAllKeys(PLAYER.RETIRED);

	const order: number[] = [];
	const seen = new Set<number>();
	for (const pid of dbRetired) {
		if (seen.has(pid) || idb.cache.players.hasPendingDelete(pid)) {
			continue;
		}
		seen.add(pid);
		const cp = cacheByKey[pid];
		if (cp && !inLeague(cp)) {
			continue;
		}
		order.push(pid);
	}
	for (const cp of Object.values(cacheByKey)) {
		if (!seen.has(cp.pid) && inLeague(cp)) {
			seen.add(cp.pid);
			order.push(cp.pid);
		}
	}

	const current = new Map<number, PlayerEntry>();
	const toRead: number[] = [];
	let sinceYield = 0;
	for (const pid of order) {
		const prev = s.players.get(pid);
		const cp = cacheByKey[pid];
		if (prev && changeLog.player(pid) <= prev.seq) {
			current.set(pid, prev);
			continue;
		}
		if (cp) {
			current.set(pid, { seq: seq0, vp: toVPlayer(cp) });
			sinceYield += 1;
			if (sinceYield >= 500) {
				sinceYield = 0;
				await yieldToWorker();
			}
		} else {
			toRead.push(pid);
		}
	}

	if (toRead.length > 0) {
		if (toRead.length > dbRetired.length * 0.2) {
			// Most of them: one pass over the retired players
			const needed = new Set(toRead);
			for await (const { value } of idb.league
				.transaction("players")
				.store.index("tid")
				.iterate(PLAYER.RETIRED)) {
				if (needed.has(value.pid)) {
					current.set(value.pid, { seq: seq0, vp: toVPlayer(value) });
				}
			}
		} else {
			const BATCH = 300;
			for (let i = 0; i < toRead.length; i += BATCH) {
				const vps = await idb.merged.players.getAll(
					{ pids: toRead.slice(i, i + BATCH) },
					{ map: toVPlayer },
				);
				for (const vp of vps) {
					current.set(vp.pid, { seq: seq0, vp });
				}
				await yieldToWorker();
			}
		}
	}
	s.players = current;

	const out: VPlayer[] = [];
	for (const pid of order) {
		const e = current.get(pid);
		if (e) {
			out.push(e.vp);
		}
	}
	return out;
};

const build = async (s: State, sig: string): Promise<Snapshot> => {
	const players = await loadPlayers(s);
	const trades = await loadTrades(s);
	const teamSeasons = await loadTeamSeasons(s);
	s.version += 1;
	return {
		L: {
			season: g.get("season"),
			phase: g.get("phase"),
			players,
			trades,
			teamSeasons,
		},
		version: s.version,
		sig,
		memo: new Map(),
	};
};

const getState = () => {
	const lid = g.get("lid");
	if (!state || state.lid !== lid || state.epoch !== changeLog.epoch) {
		state = {
			lid,
			epoch: changeLog.epoch,
			players: new Map(),
			trades: undefined,
			eventsSeq: 0,
			pastTeamSeasons: undefined,
			sig: undefined,
			built: undefined,
			last: undefined,
			queue: Promise.resolve(),
			version: 0,
		};
	}
	return state;
};

// The snapshot, rebuilt only if something it reads changed (and then only the changed players are converted again)
export const getValueSnapshot = (): Promise<Snapshot> => {
	touch();
	const s = getState();
	const sig = signature();
	if (s.built && s.sig === sig) {
		return s.built;
	}
	s.sig = sig;
	const prev = s.queue;
	const built = (async () => {
		await prev;
		return build(s, sig);
	})();
	s.queue = built.catch(() => {});
	s.built = built;
	built.then(
		(b) => {
			if (s.built === built) {
				s.last = b;
			}
		},
		() => {
			if (s.built === built) {
				s.built = undefined;
				s.sig = undefined;
			}
		},
	);
	return built;
};

const memo = <T>(snap: Snapshot, key: string, f: () => T): T => {
	if (!snap.memo.has(key)) {
		snap.memo.set(key, f());
	}
	return snap.memo.get(key) as T;
};

export const tradeGradesOf = (snap: Snapshot) =>
	memo(snap, "grades", () => {
		const G = gradeTrades(snap.L);
		return {
			...G,
			byEid: new Map(G.trades.map((t) => [t.eid, t])),
		};
	});

export const contractValueOf = (snap: Snapshot) =>
	memo(snap, "contracts", () => computeContractValue(snap.L));

export const getTradeGrades = async (): Promise<
	TradeGrades & { byEid: Map<number, GradeTrade> }
> => tradeGradesOf(await getValueSnapshot());

export const getContractValue = async (): Promise<ContractValue> =>
	contractValueOf(await getValueSnapshot());

// What was last built for this league, without waiting or building anything. For pages that show grades or value only when they are cheap to get (transactions, the player page). Can be a little out of date.
export const peekValueSnapshot = () => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const s = state;
	if (!s || s.lid !== g.get("lid") || s.epoch !== changeLog.epoch) {
		return undefined;
	}
	return s.last;
};

// The snapshot if it's ready within ms (building it if needed), else the last one built, else undefined. For pages that only add grades or value when they are cheap to get (transactions, the player page), so they never wait long. The first build of a big league takes longer, and those pages pick it up the next time they load.
export const valueSnapshotWithin = async (ms: number) => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const built = getValueSnapshot().catch(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), ms);
	});
	const snap = await Promise.race([built, timeout]);
	clearTimeout(timer);
	return snap ?? peekValueSnapshot();
};

// A player's value index by completed season
export const playerValueIndex = async (pid: number) => {
	const snap = await valueSnapshotWithin(1000);
	if (!snap) {
		return undefined;
	}
	const cv = contractValueOf(snap);
	const out: Record<number, number> = {};
	for (const r of cv.rows) {
		if (r.pid === pid && r.index !== null) {
			out[r.season] = r.index;
		}
	}
	return out;
};

// Grade one trade straight from the database, reading only the players and picks in it. For the trade summary page, so it doesn't need the whole snapshot.
export const gradeOneTrade = async (
	event: EventBBGM,
): Promise<GradeTrade | undefined> => {
	const t = toVTrade(event);
	if (!t) {
		return undefined;
	}
	const snap = peekValueSnapshot();
	if (snap && snap.sig === signature()) {
		return tradeGradesOf(snap).byEid.get(t.eid);
	}

	const pids = new Set<number>();
	const trades = new Map<number, VTrade>([[t.eid, t]]);
	const drafted: Player[] = [];
	for (const assets of t.assets) {
		for (const a of assets) {
			if ("pid" in a) {
				pids.add(a.pid);
			} else {
				const p = await getPlayerFromPick(a as any);
				if (p) {
					drafted.push(p);
				}
				// Later trades of the pick, to know if it was traded on
				for (const e of await idb.merged.events.getAll({ dpid: a.dpid })) {
					const t2 = toVTrade(e);
					if (t2) {
						trades.set(t2.eid, t2);
					}
				}
			}
		}
	}
	const players = await idb.merged.players.getAll(
		{ pids: [...pids] },
		{ map: toVPlayer },
	);
	for (const p of drafted) {
		if (!pids.has(p.pid)) {
			players.push(toVPlayer(p));
		}
	}
	const L: VLeague = {
		season: g.get("season"),
		phase: g.get("phase"),
		players,
		trades: [...trades.values()],
		teamSeasons: [],
	};
	return gradeTrade(makeCtx(L), t);
};
