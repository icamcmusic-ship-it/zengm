// Scout Consensus & Flags, worker side: gathers what the user's scouts can see of each prospect (value and ratings with the user's
// scouting fuzz, the remaining uncertainty, the region plan, trait readings, the pre-draft record) for the pure room and flags in
// common/scoutingReports. Derived on view; nothing stored, no random numbers drawn from the game's stream.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { TRAIT_DEFINITIONS } from "../../../common/playerTraits/index.ts";
import {
	quickFlags,
	ratingsNormsOf,
	type FlagRatings,
	type RatingsNorms,
	type FlagTrait,
	type QuickFlag,
} from "../../../common/scoutingReports/quickFlags.ts";
import {
	buildRoom,
	type Room,
	type RoomScout,
} from "../../../common/scoutingReports/room.ts";
import { SPECIALTY_TITLES } from "../../../common/scoutingReports/scouts.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getPlayerTraitsForUI } from "../player/traits.ts";
import {
	careerOf,
	currentDraftYear,
	getScoutingContext,
	regionOf,
	scoutingDepthOn,
} from "../staffDepth/scouting.ts";
import {
	getReportCtx,
	preDraftProductionFor,
	prospectUncertainty,
	scoutedRatingsOf,
	scoutingReportsOn,
} from "./input.ts";

export const scoutRoomOn = () => scoutingReportsOn() && featureOn("scoutRoom");

export type ProspectRoom = {
	room?: Room;
	flags: QuickFlag[];
};

// For tables: the short form
export type ProspectRoomSummary = {
	n: number;
	label: Room["label"] | undefined;
	consensusSlot: number | undefined;
	consensusText: string | undefined;
	slotRange: [number, number] | undefined;
	summary: string | undefined;
	outliers: string[];
	spread: number;
	flags: { text: string; tone: "red" | "green"; hint?: true; why: string }[];
};

export const summarizeRoom = (x: ProspectRoom): ProspectRoomSummary => ({
	n: x.room?.n ?? 0,
	label: x.room?.label,
	consensusSlot: x.room?.consensusSlot,
	consensusText: x.room?.consensusText,
	slotRange: x.room?.slotRange,
	summary: x.room?.summary,
	outliers: x.room?.outliers ?? [],
	spread: x.room?.spread ?? 0,
	flags: x.flags.map(({ text, tone, hint, why }) => ({
		text,
		tone,
		hint,
		why,
	})),
});

const flagRatingsOf = (p: Player): FlagRatings | undefined => {
	if (g.get("challengeNoRatings")) {
		return undefined;
	}
	const r = scoutedRatingsOf(p.ratings.at(-1) as any, p);
	return r
		? {
				hgt: r.hgt,
				spd: r.spd,
				jmp: r.jmp,
				endu: r.endu,
				ft: r.ft,
				fg: r.fg,
				tp: r.tp,
				oiq: r.oiq,
				diq: r.diq,
				drb: r.drb,
				pss: r.pss,
				ovr: r.ovr,
				pot: r.pot,
			}
		: undefined;
};

/**
 * The scouts' room and flags for these prospects (the user's view). Undefined entries for players who aren't draft prospects. Empty while
 * the setting is off, in a fantasy draft or a college league.
 */
export const getProspectRooms = async (
	players: Player[],
): Promise<Map<number, ProspectRoom>> => {
	const out = new Map<number, ProspectRoom>();
	const wanted = players.filter((p) => p.tid === PLAYER.UNDRAFTED);
	if (
		!scoutRoomOn() ||
		wanted.length === 0 ||
		g.get("phase") === PHASE.FANTASY_DRAFT
	) {
		return out;
	}
	const ctx = await getReportCtx();
	const season = ctx.season;
	const depth = scoutingDepthOn() ? await getScoutingContext() : undefined;
	const scouts: RoomScout[] = ctx.dept.scouts.map((s) => ({
		id: s.id,
		name: s.name,
		title: SPECIALTY_TITLES[s.specialty],
		specialty: s.specialty,
		bias: s.bias,
		quality: s.quality,
		region: depth?.plan.assignments[s.id],
	}));
	if (depth) {
		const d = depth.director;
		scouts.push({
			id: d.id,
			name: d.name,
			title: "Director of Scouting",
			specialty: d.specialty,
			bias: d.bias,
			quality: d.quality,
			director: true,
		});
	}
	const ourGuys = depth ? careerOf(depth.t).ourGuys : [];

	// Every class of the prospects asked about, ranked by the user's scouts' value
	const all = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const years = new Set(wanted.map((p) => p.draft.year));
	const classes = new Map<number, Player[]>();
	for (const p of all) {
		if (years.has(p.draft.year)) {
			const list = classes.get(p.draft.year) ?? [];
			list.push(p);
			classes.set(p.draft.year, list);
		}
	}
	for (const list of classes.values()) {
		list.sort((a, b) => b.valueFuzz - a.valueFuzz || a.pid - b.pid);
	}
	const draftYear = currentDraftYear();
	// Each class's ratings profile as the user sees it
	const ratingsOf = new Map<number, FlagRatings | undefined>();
	const norms = new Map<number, RatingsNorms | undefined>();
	for (const [year, list] of classes) {
		const rows: FlagRatings[] = [];
		for (const p of list) {
			const r = flagRatingsOf(p);
			ratingsOf.set(p.pid, r);
			if (r) {
				rows.push(r);
			}
		}
		norms.set(year, ratingsNormsOf(rows));
	}

	// Trait readings (the scouts' view, never God Mode) of every prospect in those classes, and each class's average reading per trait
	const traitsOf = new Map<number, FlagTrait[]>();
	const centers = new Map<number, Record<string, number>>();
	if (g.get("playerTraits")) {
		for (const [year, list] of classes) {
			const sums: Record<string, number> = {};
			for (const p of list) {
				const ui = getPlayerTraitsForUI(p as any, {
					scoutingLevel: ctx.scoutingLevel,
					season,
					godMode: false,
				});
				if (!ui) {
					continue;
				}
				const traits = ui.traits.map((t) => ({
					key: t.key,
					estimate: t.estimate,
					sd: t.sd,
					low: t.low,
					high: t.high,
					hidden: TRAIT_DEFINITIONS[t.key].visibility === "hidden",
					exact: t.exact,
				}));
				traitsOf.set(p.pid, traits);
				for (const t of traits) {
					sums[t.key] = (sums[t.key] ?? 0) + t.estimate;
				}
			}
			centers.set(
				year,
				Object.fromEntries(
					Object.entries(sums).map(([k, v]) => [k, v / list.length]),
				),
			);
		}
	}

	for (const p of wanted) {
		const cls = classes.get(p.draft.year) ?? [p];
		const rank = cls.findIndex((x) => x.pid === p.pid) + 1 || cls.length + 1;
		const ratings = ratingsOf.has(p.pid)
			? ratingsOf.get(p.pid)
			: flagRatingsOf(p);
		const preDraft = preDraftProductionFor(p);
		const looks = p.scoutLooks?.s === season ? (p.scoutLooks.ev ?? []) : [];
		const events = new Set(looks);
		if ((p as any).combine?.season === season) {
			events.add("combine");
		}
		const age = p.draft.year - p.born.year;
		const room = buildRoom({
			scouts,
			prospect: {
				pid: p.pid,
				value: p.valueFuzz,
				uncertainty: prospectUncertainty(p, ctx.scoutingLevel, season),
				region: regionOf(p),
				rank,
				future: p.draft.year > draftYear,
				events: events.size,
				age,
				ratings,
				pts: preDraft && preDraft.gp > 0 ? preDraft.pts : undefined,
				ourGuyOf: ourGuys
					.filter((x) => x.pid === p.pid && x.s === p.draft.year)
					.map((x) => x.sid),
			},
			classValues: cls.filter((x) => x.pid !== p.pid).map((x) => x.valueFuzz),
			numTeams: ctx.numTeams,
			numPicks: ctx.numPicks,
			seed: ctx.seed,
			season,
		});
		const seenClosely =
			(room?.grades.some((x) => x.familiar) ?? false) ||
			(p.scouting ?? []).length > 0 ||
			(p.scoutLooks !== undefined && p.scoutLooks.a <= 0.75);
		const flags = quickFlags({
			age,
			pos: (p.ratings.at(-1) as any)?.pos ?? "F",
			ratings,
			preDraft,
			seenClosely,
			traits: traitsOf.get(p.pid),
			center: centers.get(p.draft.year),
			norms: norms.get(p.draft.year),
		});
		out.set(p.pid, { room, flags });
	}
	return out;
};
