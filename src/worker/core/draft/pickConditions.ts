import type { DraftPick } from "../../../common/types.ts";
import { protectionText } from "../../../common/draftPickConditions.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";

export type PickConditionMessage = {
	text: string;
	tids: number[];
	dpids: number[];
};

const ordinalPick = (dp: DraftPick) =>
	`${dp.season} ${helpers.ordinal(dp.round)} round pick${dp.pick > 0 ? ` (#${dp.pick})` : ""}`;

// Resolve protections and swaps on this draft's picks, after their pick numbers are known. Mutates the picks.
// futurePicks are the picks of later drafts, where rollovers and conversions go. Returns the picks that changed and
// what happened, for the news feed. Pure, so it's easy to test.
export const resolvePickConditionsPure = ({
	draftPicks,
	futurePicks,
	teamName,
}: {
	draftPicks: DraftPick[];
	futurePicks: DraftPick[];
	teamName: (tid: number) => string;
}) => {
	const changed = new Set<DraftPick>();
	const messages: PickConditionMessage[] = [];

	// Swaps first. Each swap compares a pick with the swapping team's own pick in the same round
	for (const dp of draftPicks) {
		if (!dp.swap) {
			continue;
		}
		const swapTid = dp.swap.tid;
		delete dp.swap;
		changed.add(dp);

		const own = draftPicks.find(
			(x) =>
				x.originalTid === swapTid && x.round === dp.round && x.tid === swapTid,
		);
		if (dp.tid === swapTid) {
			// The swapping team already owns this pick (it was traded to them), so there's nothing to swap
			continue;
		}
		if (!own || dp.pick <= 0 || own.pick <= 0) {
			messages.push({
				text: `The right of the ${teamName(swapTid)} to swap ${dp.season} ${helpers.ordinal(dp.round)} round picks with the ${teamName(dp.tid)} lapsed, because the picks involved are no longer available.`,
				tids: [swapTid, dp.tid],
				dpids: [dp.dpid],
			});
			continue;
		}

		if (dp.pick < own.pick) {
			const otherTid = dp.tid;
			dp.tid = swapTid;
			own.tid = otherTid;
			changed.add(own);
			messages.push({
				text: `The ${teamName(swapTid)} exercised their right to swap picks with the ${teamName(otherTid)}: they get the #${dp.pick} pick and give up the #${own.pick} pick in the ${dp.season} ${helpers.ordinal(dp.round)} round.`,
				tids: [swapTid, otherTid],
				dpids: [dp.dpid, own.dpid],
			});
		} else {
			messages.push({
				text: `The ${teamName(swapTid)} kept their own #${own.pick} pick instead of swapping for the #${dp.pick} pick of the ${teamName(dp.tid)} in the ${dp.season} ${helpers.ordinal(dp.round)} round.`,
				tids: [swapTid, dp.tid],
				dpids: [dp.dpid, own.dpid],
			});
		}
	}

	for (const dp of draftPicks) {
		const prot = dp.protection;
		if (!prot) {
			continue;
		}
		delete dp.protection;
		changed.add(dp);
		const holderTid = dp.tid;
		if (holderTid === prot.tid || typeof dp.season !== "number") {
			continue;
		}

		const desc = `${protectionText(prot)} ${ordinalPick(dp)} of the ${teamName(dp.originalTid)}`;

		if (dp.pick <= 0 || dp.pick > prot.top) {
			messages.push({
				text: `The ${desc} conveyed to the ${teamName(holderTid)}.`,
				tids: [holderTid, prot.tid],
				dpids: [dp.dpid],
			});
			continue;
		}

		// Protected, so the original team keeps it
		dp.tid = prot.tid;
		let owed = "";
		const findFuture = (round: number) =>
			futurePicks.find(
				(x) =>
					x.season === (dp.season as number) + 1 &&
					x.originalTid === dp.originalTid &&
					x.round === round &&
					x.tid === prot.tid &&
					!x.protection &&
					!x.swap,
			);

		let next: DraftPick | undefined;
		if (prot.rollover.length > 0 || prot.then === "unprotected") {
			next = findFuture(dp.round);
			if (next) {
				next.tid = holderTid;
				if (prot.rollover.length > 0) {
					next.protection = {
						tid: prot.tid,
						top: prot.rollover[0]!,
						rollover: prot.rollover.slice(1),
						then: prot.then,
					};
					owed = ` The ${teamName(holderTid)} get the ${next.season} ${helpers.ordinal(next.round)} round pick instead, ${protectionText(next.protection)}.`;
				} else {
					owed = ` The ${teamName(holderTid)} get the ${next.season} ${helpers.ordinal(next.round)} round pick instead, unprotected.`;
				}
			}
		} else if (prot.then === "secondRound") {
			next = findFuture(2);
			if (next) {
				next.tid = holderTid;
				owed = ` The obligation converts to the ${next.season} 2nd round pick, which goes to the ${teamName(holderTid)}.`;
			}
		}
		if (next) {
			changed.add(next);
		} else if (prot.then === "extinguish" && prot.rollover.length === 0) {
			owed = " The obligation is extinguished.";
		} else {
			owed = ` The obligation is extinguished, because the ${teamName(dp.originalTid)} no longer own the pick it would roll over to.`;
		}

		messages.push({
			text: `The ${desc} landed at #${dp.pick}, so the ${teamName(prot.tid)} keep it.${owed}`,
			tids: [prot.tid, holderTid],
			dpids: next ? [dp.dpid, next.dpid] : [dp.dpid],
		});
	}

	return { changed: Array.from(changed), messages };
};

// Called from genOrder once the pick numbers of this draft are set
const resolvePickConditions = async (draftPicks: DraftPick[]) => {
	if (!draftPicks.some((dp) => dp.protection || dp.swap)) {
		return;
	}

	const season = g.get("season");
	const futurePicks = (await idb.cache.draftPicks.getAll()).filter(
		(dp) => typeof dp.season === "number" && dp.season > season,
	);

	const teamInfoCache = g.get("teamInfoCache");
	const userTids = g.get("userTids");
	const teamName = (tid: number) => {
		const t = teamInfoCache[tid];
		if (!t) {
			return "???";
		}
		return `<a href="${helpers.leagueUrl(["roster", `${t.abbrev}_${tid}`, season])}">${t.region} ${t.name}</a>`;
	};

	const { changed, messages } = resolvePickConditionsPure({
		draftPicks,
		futurePicks,
		teamName,
	});

	for (const dp of changed) {
		await idb.cache.draftPicks.put(dp);
	}

	for (const message of messages) {
		await logEvent({
			type: "draftPickCondition",
			text: message.text,
			tids: message.tids,
			dpids: message.dpids,
			score: 10,
			showNotification: message.tids.some((tid) => userTids.includes(tid)),
		});
	}
};

export default resolvePickConditions;
