// Frozen Pre-draft Ranks setting: each prospect's rank in his class is snapshot when the draft starts (newPhase hook at PHASE.DRAFT), and
// every page that shows a rank, a stock or a projected pick reads that snapshot once the draft has started, instead of counting among
// the players still undrafted (which made the best player left "#1"). Before the draft, ranks stay live. The AI never reads these: it
// drafts by value (runPicks), and the user's auto pick by the user's own board.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import type { Player } from "../../../common/types.ts";
import {
	rankByScoutGrade,
	rankClass,
	type PreDraftRankInfo,
} from "../../../common/preDraftRanks.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

export const frozenDraftRanksOn = () => featureOn("frozenDraftRanks");

// The draft of this class has started (or is over): from then on its ranks are frozen. Fantasy and expansion drafts have negative phases,
// so they never count.
export const classDraftStarted = (draftYear: number) =>
	draftYear < g.get("season") ||
	(draftYear === g.get("season") && g.get("phase") >= PHASE.DRAFT);

const inClass = (players: Player[], draftYear: number) =>
	players.filter(
		(p) =>
			p.draft.year === draftYear &&
			p.tid !== PLAYER.UNDRAFTED_FANTASY_TEMP &&
			p.ratings.length > 0,
	);

const classPlayers = async (draftYear: number) => {
	const players =
		draftYear === g.get("season")
			? await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
					[draftYear],
					[draftYear, Infinity],
				])
			: await idb.merged.players.getAll({ draftYear });
	return inClass(players, draftYear);
};

// Take the snapshot of a class: at the start of its draft (everyone still undrafted), or later for a class that has none (the setting was
// turned on during the draft: values don't change until the next season, so counting over the whole class, drafted players included,
// gives the same ranks)
export const snapshotPreDraftRanks = async (draftYear: number) => {
	const players = await classPlayers(draftYear);
	if (players.length === 0) {
		return;
	}
	const ranks = rankClass(players);
	for (const p of players) {
		const rank = ranks.get(p.pid)!;
		p.preDraftRank = { s: draftYear, ...rank };
		await idb.cache.players.put(p);
	}
};

const lastScoutGrade = (p: Player, draftYear: number) => {
	if (p.scoutDraft?.s === draftYear) {
		return p.scoutDraft.o;
	}
	return p.scoutSnaps?.findLast((snap) => snap.s === draftYear)?.o;
};

/**
 * The frozen ranks of a class whose draft has started, by pid. Undefined while the setting is off or before the draft (ranks are live
 * then). Fallbacks for classes with no snapshot: recounted over the whole class in the draft's own season, else the scouts' last stored
 * snapshot of the class.
 */
export const getPreDraftRanks = async (
	draftYear: number,
	players?: Player[],
): Promise<Map<number, PreDraftRankInfo> | undefined> => {
	if (!frozenDraftRanksOn() || !classDraftStarted(draftYear)) {
		return undefined;
	}
	const cls = players
		? inClass(players, draftYear)
		: await classPlayers(draftYear);
	const out = new Map<number, PreDraftRankInfo>();

	for (const p of cls) {
		if (p.preDraftRank?.s === draftYear) {
			out.set(p.pid, { ...p.preDraftRank, src: "frozen" });
		}
	}
	if (out.size > 0) {
		return out;
	}

	if (draftYear === g.get("season")) {
		for (const [pid, rank] of rankClass(cls)) {
			out.set(pid, { ...rank, src: "class" });
		}
		return out;
	}

	const graded = [];
	for (const p of cls) {
		const o = lastScoutGrade(p, draftYear);
		if (o !== undefined) {
			graded.push({ pid: p.pid, o });
		}
	}
	if (graded.length === 0) {
		return undefined;
	}
	for (const [pid, rank] of rankByScoutGrade(graded)) {
		out.set(pid, { r: rank, v: rank, n: graded.length, src: "scout" });
	}
	return out;
};

// One player (player pages): his stored snapshot, else his class's fallback
export const getPreDraftRank = async (p: Player) => {
	if (!frozenDraftRanksOn() || !classDraftStarted(p.draft.year)) {
		return undefined;
	}
	if (p.preDraftRank?.s === p.draft.year) {
		return { ...p.preDraftRank, src: "frozen" as const };
	}
	return (await getPreDraftRanks(p.draft.year))?.get(p.pid);
};

// newPhase hook: the snapshot when the draft starts, and a backfill when it ends for a class that had none (turned on mid-draft)
export const afterNewPhase = async (phase: number) => {
	if (!frozenDraftRanksOn() || g.get("leagueType") === "college") {
		return;
	}
	const season = g.get("season");
	if (phase === PHASE.DRAFT) {
		await snapshotPreDraftRanks(season);
	} else if (phase === PHASE.AFTER_DRAFT) {
		const cls = await classPlayers(season);
		if (!cls.some((p) => p.preDraftRank?.s === season)) {
			await snapshotPreDraftRanks(season);
		}
	}
};
