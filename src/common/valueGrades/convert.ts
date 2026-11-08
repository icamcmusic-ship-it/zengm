import { getProStats } from "../preDraft.ts";
import type { EventBBGM, Player } from "../types.ts";
import type { VAsset, VPlayer, VTrade } from "./types.ts";

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : null;

// A database player as the Trade grader and Contract value engines see him. Pre-draft (college) rows are left out (see common/preDraft.ts), the rest keep their index in p.stats, which trade events refer to.
export const toVPlayer = (p: Player): VPlayer => {
	const stats = p.stats ?? [];
	const pro = getProStats({ draft: p.draft, stats });
	const proSet = pro === stats ? undefined : new Set(pro);
	const rows: VPlayer["rows"] = [];
	for (const [i, r] of stats.entries()) {
		if (proSet && !proSet.has(r)) {
			continue;
		}
		const ows = num(r.ows);
		const dws = num(r.dws);
		rows.push({
			i,
			season: r.season,
			tid: r.tid,
			playoffs: !!r.playoffs,
			gp: num(r.gp),
			min: num(r.min) ?? 0,
			ws: ows === null && dws === null ? null : (ows ?? 0) + (dws ?? 0),
		});
	}
	return {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`.trim(),
		tid: p.tid,
		retiredYear: p.retiredYear,
		bornYear: p.born?.year ?? 0,
		draft: {
			year: p.draft?.year ?? 0,
			round: p.draft?.round ?? 0,
			pick: p.draft?.pick ?? 0,
			tid: p.draft?.tid ?? -1,
			originalTid: p.draft?.originalTid ?? -1,
			dpid: p.draft?.dpid,
		},
		rows,
		transactions: (p.transactions ?? []).map((t) => ({
			type: t.type,
			tid: t.tid,
			season: t.season,
			phase: t.phase,
			eid: "eid" in t ? t.eid : undefined,
		})),
		contracts: (p.contracts ?? []).map((c) => ({
			type: c.type,
			eid: c.eid,
			start: c.start,
			amounts: c.amounts,
			payments: c.payments,
			endedEarly: c.endedEarly
				? {
						season: c.endedEarly.season,
						phase: c.endedEarly.phase,
						reason: c.endedEarly.reason,
						tid: c.endedEarly.tid,
					}
				: undefined,
		})),
	};
};

// A logged two-team trade, or undefined for legacy events without the assets
export const toVTrade = (e: EventBBGM): VTrade | undefined => {
	if (
		e.type !== "trade" ||
		!e.teams ||
		e.phase === undefined ||
		e.tids.length !== 2
	) {
		return undefined;
	}
	const side = (i: 0 | 1): VAsset[] =>
		e.teams![i].assets.map((a) =>
			"pid" in a
				? { pid: a.pid, name: a.name, statsIndex: a.statsIndex }
				: {
						dpid: a.dpid,
						season: a.season,
						round: a.round,
						originalTid: a.originalTid,
					},
		);
	return {
		eid: e.eid,
		season: e.season,
		phase: e.phase,
		tids: [e.tids[0], e.tids[1]],
		assets: [side(0), side(1)],
	};
};
