// Player page rankings (League extras, basketball, a Records Book option, see common/playerRankings.ts): keeps the
// retired players' top lists in the "playerRankings" game attribute and builds the board the player page reads.
//
// - First use in a league: every retired player is read once (like the Records Book's first read), then the list is
//   only brought forward by the players who retired in the seasons since (the retiredYear index), so a player page
//   never scans every player.
// - Live players (the cache: active, free agents, prospects, and anyone retired this session) and this season's
//   retirees are laid over the kept lists. The built board is memoized until games are played or players move.
import { PLAYER } from "../../common/constants.ts";
import {
	PR_INFO,
	prAddRetired,
	prBuildBoard,
	prEmpty,
	prPlayerRankings,
	prRowsOf,
	type PRBoard,
	type PRLivePlayer,
	type PRRanking,
	type PRState,
	type PRStat,
} from "../../common/playerRankings.ts";
import type { Player } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import { featureOn, featureOption } from "./nativeFeatures.ts";

const KEY = "playerRankings";

export const playerRankingsOn = () =>
	__SPORT === "basketball" &&
	featureOn("recordsBook") &&
	featureOption<boolean>("featurePlayerRankings") !== false;

const getState = (): PRState | undefined => {
	const s = Object.hasOwn(g, KEY) ? (g.get(KEY as any) as PRState) : undefined;
	return s && s.v === 1 ? s : undefined;
};

const saveState = async (state: PRState | undefined) => {
	g.setWithoutSavingToDB(KEY as any, state);
	await idb.cache.gameAttributes.put({ key: KEY, value: state } as any);
};

// Pro stats rows of a player, as ranked
const rowsOf = (p: Pick<Player, "stats">) => prRowsOf(p.stats);

// The kept lists, built or brought forward to the players who retired before this season
let pending: Promise<PRState> | undefined;
const ensureState = () => {
	pending ??= (async () => {
		const lid = g.get("lid");
		const season = g.get("season");
		let state = getState();
		if (state && state.through >= season - 1) {
			return state;
		}
		if (!state) {
			// Everyone who retired before this season (those retired this season are read live)
			state = prEmpty(season - 1);
			const s = state;
			await idb.merged.players.getAll(
				{ activeAndRetired: true },
				{
					map: (p) => {
						if (
							p.tid === PLAYER.RETIRED &&
							!((p.retiredYear ?? -Infinity) >= season)
						) {
							prAddRetired(s, p.pid, rowsOf(p));
						}
						return undefined;
					},
				},
			);
		} else {
			for (let y = state.through + 1; y < season; y++) {
				const s = state;
				await idb.merged.players.getAll(
					{ retiredYear: y },
					{
						map: (p) => {
							if (p.tid === PLAYER.RETIRED) {
								prAddRetired(s, p.pid, rowsOf(p));
							}
							return undefined;
						},
					},
				);
			}
			state.through = season - 1;
		}
		if (g.get("lid") === lid) {
			await saveState(state);
		}
		return state;
	})().finally(() => {
		pending = undefined;
	});
	return pending;
};

type Live = PRLivePlayer & { name: string };

let memo: { key: string; board: PRBoard; live: Map<number, Live> } | undefined;

// What a built board depends on, besides the kept lists: games played (box scores of this season are in the cache)
// and the players in the cache
const boardKey = async (state: PRState) => {
	const [games, players] = await Promise.all([
		idb.cache.games.getAll(),
		idb.cache.players.getAll(),
	]);
	let gp = 0;
	for (const p of players) {
		gp += p.stats.length;
	}
	return [
		g.get("lid"),
		g.get("season"),
		g.get("phase"),
		state.through,
		state.n,
		games.length,
		games.at(-1)?.gid ?? -1,
		players.length,
		gp,
	].join("|");
};

export const getPlayerRankingsBoard = async () => {
	const state = await ensureState();
	const key = await boardKey(state);
	if (memo?.key === key) {
		return memo;
	}
	const season = g.get("season");
	const live = new Map<number, Live>();
	const addLive = (p: Player) => {
		live.set(p.pid, {
			pid: p.pid,
			rows: rowsOf(p),
			name: `${p.firstName} ${p.lastName}`.trim(),
		});
	};
	for (const p of await idb.cache.players.getAll()) {
		addLive(p);
	}
	// Retired this season (also the ones no longer in the cache)
	await idb.merged.players.getAll(
		{ retiredYear: season },
		{
			map: (p) => {
				addLive(p);
				return undefined;
			},
		},
	);
	const board = prBuildBoard(state, [...live.values()]);
	memo = { key, board, live };
	return memo;
};

// For the tests
export const resetPlayerRankingsMemo = () => {
	memo = undefined;
};

export type PlayerRankingRow = PRRanking & {
	label: string;
	unit: string;
	d: number;
	abbrev?: string;
	teamName?: string;
	aboveName?: string;
};

// The player page's rankings, most significant first (undefined when the option is off)
export const getPlayerRankings = async (
	p: Player,
): Promise<PlayerRankingRow[] | undefined> => {
	if (!playerRankingsOn()) {
		return undefined;
	}
	const rows = rowsOf(p);
	if (rows.length === 0) {
		return [];
	}
	const { board, live } = await getPlayerRankingsBoard();
	const numGames = g.get("numGames");
	const rankings = prPlayerRankings(board, p.pid, rows, g.get("season"), [
		Math.round(numGames / 2),
		Math.max(1, Math.round(numGames / 20)),
	]);
	const active = p.tid !== PLAYER.RETIRED;
	const teamInfoCache = g.get("teamInfoCache");
	const names = new Map<number, string | undefined>();
	const nameOf = async (pid: number) => {
		if (!names.has(pid)) {
			const l = live.get(pid);
			if (l) {
				names.set(pid, l.name);
			} else {
				const p2 = await idb.merged.players.get(pid);
				names.set(
					pid,
					p2 ? `${p2.firstName} ${p2.lastName}`.trim() : undefined,
				);
				if (!p2) {
					// A kept player was deleted (Delete Old Data): rebuild the lists next time
					await saveState(undefined);
					memo = undefined;
				}
			}
		}
		return names.get(pid);
	};
	const out: PlayerRankingRow[] = [];
	for (const r of rankings.slice(0, 40)) {
		const info = PR_INFO[r.stat as PRStat];
		const t = r.tid !== undefined ? teamInfoCache[r.tid] : undefined;
		const row: PlayerRankingRow = {
			...r,
			label: info.label,
			unit: info.unit,
			d: info.d,
			abbrev: t?.abbrev,
			teamName: t ? `${t.region} ${t.name}`.trim() : undefined,
		};
		// The chase is for active players' career totals
		if (!active || r.scope === "season" || !r.above) {
			delete row.above;
		} else {
			row.aboveName = await nameOf(r.above.pid);
			if (row.aboveName === undefined) {
				delete row.above;
			}
		}
		out.push(row);
	}
	return out;
};
