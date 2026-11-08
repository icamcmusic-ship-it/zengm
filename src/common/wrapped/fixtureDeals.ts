// Adds the front-office side of a league to a test fixture: trades (players change teams from the next season on, sometimes with a draft pick that is later used), contracts for every career, releases, draft lotteries and future draft picks. Deterministic, with its own random stream, so the fixture it is applied to is otherwise unchanged.
import type {
	WContract,
	WLeague,
	WPlayer,
	WTrade,
	WTradeAsset,
} from "./types.ts";
import { seededRng } from "./util.ts";

export const addDeals = (
	L: WLeague,
	{ seed = "deals", perSeason = 3 }: { seed?: string; perSeason?: number } = {},
): WLeague => {
	const rng = seededRng(seed);
	const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
	const tids = [...new Set(L.teamSeasons.map((t) => t.tid))].sort(
		(a, b) => a - b,
	);
	const seasons = [...new Set(L.teamSeasons.map((t) => t.season))].sort(
		(a, b) => a - b,
	);
	const last = L.season;
	const trades: WTrade[] = [];
	let eid = 1;
	let dpid = 1;

	const rowIn = (p: WPlayer, s: number) =>
		p.stats.find((r) => r.season === s && r.gp > 0);
	// Every row of p after season s with team `from` moves to team `to`, until he leaves `from`
	const move = (p: WPlayer, s: number, from: number, to: number) => {
		for (const r of p.stats) {
			if (r.season > s && r.tid === from) {
				r.tid = to;
			}
		}
		for (const r of p.po) {
			if (r.season > s && r.tid === from) {
				r.tid = to;
			}
		}
		if (p.tid === from) {
			p.tid = to;
		}
		for (const x of p.paid ?? []) {
			if (x.season > s && x.tid === from) {
				x.tid = to;
			}
		}
	};

	// An in-season trade: the season's row is cut in two, the second part with the new team
	const split = (p: WPlayer, s: number, from: number, to: number) => {
		const r = p.stats.find((x) => x.season === s && x.tid === from && x.gp > 1);
		if (!r) {
			return;
		}
		const frac = Math.floor(r.gp / 2) / r.gp;
		const second = { ...r, tid: to };
		for (const k of Object.keys(r) as (keyof typeof r)[]) {
			const v = r[k];
			if (k !== "season" && k !== "tid" && typeof v === "number") {
				const a = k === "gp" || k === "gs" ? Math.floor(v * frac) : v * frac;
				(r as Record<string, number>)[k] = a;
				(second as Record<string, number>)[k] = v - a;
			}
		}
		p.stats.push(second);
		p.stats.sort((a, b) => a.season - b.season);
	};

	for (const s of seasons.slice(0, -1)) {
		const used = new Set<number>();
		for (let k = 0; k < perSeason; k++) {
			const a = tids[ri(0, tids.length - 1)]!;
			const b = tids[(tids.indexOf(a) + ri(1, tids.length - 1)) % tids.length]!;
			const cands = (tid: number) =>
				L.players.filter(
					(p) =>
						!used.has(p.pid) &&
						rowIn(p, s)?.tid === tid &&
						rowIn(p, s + 1)?.tid === tid,
				);
			const ca = cands(a);
			const cb = cands(b);
			if (ca.length === 0 || cb.length === 0) {
				continue;
			}
			const pa = ca[ri(0, ca.length - 1)]!;
			const pb = cb[ri(0, cb.length - 1)]!;
			used.add(pa.pid);
			used.add(pb.pid);
			const id = eid++;
			const asset = (p: WPlayer): WTradeAsset => ({
				pid: p.pid,
				name: p.name,
				amount: 1000 * ri(1, 30),
				exp: s + ri(1, 4),
			});
			const gotA: WTradeAsset[] = [asset(pb)];
			const gotB: WTradeAsset[] = [asset(pa)];
			// Sometimes a pick goes with it, used in the next draft
			if (k === 0 || k === 2) {
				const rookie = L.players.find(
					(p) =>
						p.draft.year === s + 1 &&
						p.draft.round === 1 &&
						p.draft.tid === b &&
						p.draftDpid === undefined,
				);
				if (rookie) {
					const d = dpid++;
					rookie.draftDpid = d;
					rookie.draftOriginalTid = a;
					gotB.push({ dpid: d, season: s + 1, round: 1, originalTid: a });
				}
			}
			// Every second one is made during the next season instead of after this one
			const during = k === 1;
			const at = during ? s + 1 : s;
			if (during) {
				split(pa, at, a, b);
				split(pb, at, b, a);
			}
			move(pa, at, a, b);
			move(pb, at, b, a);
			const phase = during ? 2 : k % 2 === 0 ? 7 : 5;
			pa.moves.push({ season: at, tid: b, type: "trade", fromTid: a, phase, eid: id });
			pb.moves.push({ season: at, tid: a, type: "trade", fromTid: b, phase, eid: id });
			trades.push({ eid: id, season: at, phase, tids: [a, b], got: [gotA, gotB] });
		}
	}

	// Contracts: the career cut into deals of one to five seasons, paid what the snapshot says he was paid
	for (const p of L.players) {
		const ss = [...new Set(p.stats.filter((r) => r.gp > 0).map((r) => r.season))].sort(
			(a, b) => a - b,
		);
		const contracts: WContract[] = [];
		let i = 0;
		while (i < ss.length) {
			const len = Math.min(ri(1, 5), ss.length - i);
			const start = ss[i]!;
			const tid = rowIn(p, start)!.tid;
			const amounts: number[] = [];
			for (let j = 0; j < len; j++) {
				const paid = p.paid?.find((x) => x.season === start + j)?.amount;
				amounts.push(paid ?? 750 + 1000 * ri(0, 25));
			}
			const prev = contracts.at(-1);
			const type =
				contracts.length === 0
					? p.draft.round > 0
						? "rookie"
						: "freeAgent"
					: prev?.tid === tid
						? "reSign"
						: "freeAgent";
			// An active player's last deal runs past this season
			if (i + len >= ss.length && p.retiredYear > last && start + len - 1 === last) {
				for (let j = ri(0, 3); j > 0; j--) {
					amounts.push(amounts.at(-1)! + 500);
				}
			}
			const c: WContract = { type, start, amounts, signed: start - 1, tid };
			// Now and then a player is let go before his deal runs out
			const nextTid = ss[i + len] !== undefined ? rowIn(p, ss[i + len]!)?.tid : undefined;
			if (len >= 2 && ri(0, 6) === 0) {
				const cut = start + ri(0, len - 2);
				c.ended = { season: cut, reason: "released", tid };
			} else if (nextTid !== undefined && nextTid !== tid && type !== "rookie" && ri(0, 2) === 0) {
				p.moves.push({ season: start + len - 1, tid: nextTid, type: "freeAgent", phase: 8 });
			}
			contracts.push(c);
			i += len;
		}
		p.contracts = contracts;
		if (p.draftOriginalTid === undefined && p.draft.round > 0) {
			p.draftOriginalTid = p.draft.tid;
		}
	}

	// Lotteries: the worst four teams of each season, shuffled a little
	const lottery: WLeague["lottery"] = [];
	for (const s of seasons) {
		const worst = L.teamSeasons
			.filter((t) => t.season === s)
			.sort((a, b) => a.won - b.won || a.tid - b.tid)
			.slice(0, 4);
		if (worst.length < 4) {
			continue;
		}
		const order = worst.map((t, j) => ({ t, key: j + ri(-3, 3) * 1.1 }));
		order.sort((a, b) => a.key - b.key);
		lottery.push({
			season: s,
			type: "nba2019",
			rows: worst.map((t, j) => ({
				tid: t.tid,
				originalTid: t.tid,
				chances: [140, 140, 140, 125][j]!,
				pick: order.findIndex((o) => o.t === t) + 1,
			})),
		});
	}

	// Picks for the next two drafts; a few belong to someone else
	const picks: WLeague["picks"] = [];
	for (const s of [last + 1, last + 2]) {
		for (const round of [1, 2]) {
			for (const tid of tids) {
				const owner = ri(0, 4) === 0 ? tids[(tids.indexOf(tid) + 1) % tids.length]! : tid;
				picks.push({ dpid: dpid++, tid: owner, originalTid: tid, round, season: s, pick: 0 });
			}
		}
	}

	L.trades = trades;
	L.lottery = lottery;
	L.picks = picks;
	return L;
};
