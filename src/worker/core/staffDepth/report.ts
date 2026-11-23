// The Staff Report page and the Pro Scouting tab: what the staff sees and recommends, one action per area, accepted with one click.
import { offEmphasisRecommendation } from "../offEmphasis/index.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	DEFENSE_NAMES,
	OFFENSE_NAMES,
	bestSystems,
	fitLabel,
	fitToScore,
} from "../../../common/coachSystems.ts";
import {
	COACH_ROLE_NAMES,
	coachOvr,
	coachSalaryDemand,
} from "../../../common/staff.ts";
import { DEPTH_EFFECT_TEXT } from "../../../common/staffDepth/coaching.ts";
import {
	FOCUSES,
	FOCUS_KEYS,
	groupOfPos,
} from "../../../common/staffDepth/devPlans.ts";
import {
	BLIND_SPOT,
	PRIORITY_SHORT,
	REGION_NAMES,
	SCOUT_REGIONS,
	confidenceFromFactor,
	coverageLabel,
	scoutExperience,
	secondSpecialty,
} from "../../../common/staffDepth/regions.ts";
import {
	SPECIALTY_NAMES,
	qualityLabel,
} from "../../../common/scoutingReports/scouts.ts";
import type {
	DelegationArea,
	DevReportRow,
	FocusKey,
	ScoutRegion,
	StaffSuggestion,
	SuggestionAction,
} from "../../../common/staffDepth/types.ts";
import type { Player } from "../../../common/types.ts";
import { SUB_INDEX, isValidSubArray } from "../../../common/subRatings.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import fuzzRating from "../player/fuzzRating.ts";
import genContract from "../player/genContract.ts";
import {
	getContractExp,
	getCurrentContract,
	getNearestContractAmount,
} from "../../../common/contracts.ts";
import { getTeamNeeds } from "../draft/draftNeeds.ts";
import {
	coachSystemsEnabled,
	getCoachProfile,
	getRosterFit,
	playerSystemFit,
} from "../staff/systems.ts";
import {
	coachingDepthOn,
	getDepthTeams,
	nextDevSeason,
	planFor,
	staffFocusFor,
	stateOf,
	userControls,
} from "./coaching.ts";
import {
	careerOf,
	currentDraftYear,
	focusScoutsFor,
	getScoutingContext,
	type ScoutingContext,
	reputationLabel,
	scoutAccuracyById,
	scoutingDepthOn,
} from "./scouting.ts";
import { getScoutingBlurbs } from "../scoutingReports/index.ts";
import { scoutFocusOn } from "../scoutingReports/input.ts";
import {
	SCOUT_FOCUS_KIND,
	SCOUT_FOCUS_NAMES,
	scoutFocusOf,
} from "../../../common/staffDepth/scoutFocus.ts";

type Recommendation = {
	id: string;
	title: string;
	text: string;
	action?: SuggestionAction;
	// Dismissed for this season (the page shows it collapsed, with a way to bring it back)
	dismissed?: boolean;
};

// Marks the recommendations the user dismissed this season
const markDismissed = <T extends { rec: Recommendation } | undefined>(
	section: T,
	dismissed: Set<string>,
): T => {
	if (section && section.rec.id !== "none" && dismissed.has(section.rec.id)) {
		return { ...section, rec: { ...section.rec, dismissed: true } };
	}
	return section;
};

const POS_NEED: Record<string, "G" | "F" | "C"> = {
	PG: "G",
	SG: "G",
	G: "G",
	GF: "F",
	SF: "F",
	F: "F",
	PF: "F",
	FC: "C",
	C: "C",
};

// A team's areas (rating averages of its top 8 players by value) against the league's, for the weakest-area logic
const AREAS: { key: string; name: string; bases: string[]; subs: string[] }[] =
	[
		{ key: "shooting", name: "Shooting", bases: ["tp"], subs: ["tcs", "rng"] },
		{
			key: "playmaking",
			name: "Playmaking",
			bases: ["pss", "drb"],
			subs: ["vis", "hnd"],
		},
		{
			key: "perimD",
			name: "Perimeter defense",
			bases: ["diq", "spd"],
			subs: ["pdf", "lat"],
		},
		{
			key: "rimD",
			name: "Rim protection",
			bases: ["diq", "hgt"],
			subs: ["blk", "idf"],
		},
		{ key: "glass", name: "Rebounding", bases: ["reb"], subs: ["orb", "drd"] },
	];

const areaValue = (r: any, area: (typeof AREAS)[number]) =>
	area.bases.reduce((a, k) => a + (r[k] ?? 0), 0) / area.bases.length;

// An area as the scouts see it (fuzzed ratings, like every other page; height isn't fuzzed)
const fuzzedAreaValue = (r: any, area: (typeof AREAS)[number]) =>
	area.bases.reduce(
		(a, k) => a + (k === "hgt" ? (r.hgt ?? 0) : fuzzRating(r[k] ?? 0, r.fuzz)),
		0,
	) / area.bases.length;

// The gap as words, for the No Visible Ratings challenge (no number)
export const gapBand = (gap: number) =>
	gap <= -5
		? "well below the league"
		: gap <= -1.5
			? "below the league"
			: "about even with the league";

// The user's weakest area against the league: the average of each team's top 8 players (by scouted value), in scouted ratings
const weakestArea = async (tid: number) => {
	const all = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = new Map<number, Player[]>();
	for (const p of all) {
		let list = byTid.get(p.tid);
		if (!list) {
			list = [];
			byTid.set(p.tid, list);
		}
		list.push(p);
	}
	const tops = new Map<number, any[]>();
	for (const [t, players] of byTid) {
		tops.set(
			t,
			[...players]
				.sort((a, b) => b.valueFuzz - a.valueFuzz || a.pid - b.pid)
				.slice(0, 8)
				.map((p) => p.ratings.at(-1)),
		);
	}
	const avg = (list: any[], area: (typeof AREAS)[number]) =>
		list.length > 0
			? list.reduce((a, r) => a + fuzzedAreaValue(r, area), 0) / list.length
			: 0;
	let worst = AREAS[0]!;
	let worstGap = Infinity;
	for (const area of AREAS) {
		let league = 0;
		for (const list of tops.values()) {
			league += avg(list, area);
		}
		league /= Math.max(1, tops.size);
		const gap = avg(tops.get(tid) ?? [], area) - league;
		if (gap < worstGap) {
			worstGap = gap;
			worst = area;
		}
	}
	return { area: worst, gap: Math.round(10 * worstGap) / 10 };
};

// ---- Pro Scouting ----

// light: only what the Staff Report's best-target recommendation needs (no scouting blurbs, no formatted list of 30 targets)
export const getProScouting = async ({ light }: { light?: boolean } = {}) => {
	const tid = g.get("userTid");
	const noRatings = !!g.get("challengeNoRatings");
	const season = g.get("season");
	const salaryCap = g.get("salaryCap");
	const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
	const needs = getTeamNeeds(roster as any);
	const { area, gap } = await weakestArea(tid);
	const systems = coachSystemsEnabled() && !noRatings;
	// The head coach's systems, read once (not once per candidate)
	const head = systems
		? (await idb.cache.coaches.indexGetAll("coachesByTid", tid)).find(
				(c) => c.role === "head",
			)
		: undefined;
	const profile = head ? getCoachProfile(head) : undefined;
	const subsArea = AREAS.find((a) => a.key === area.key)!;
	const candidates = (
		await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		])
	).filter((p) => p.tid !== tid);
	const ctx = await getScoutingContext(tid);
	const proScout =
		ctx?.scouts
			.filter(
				(s) => s.specialty === "pro" || secondSpecialty(s, season) === "pro",
			)
			.sort((a, b) => b.quality - a.quality)[0] ?? ctx?.scouts[0];
	const rows: {
		p: Player;
		score: number;
		value: number;
		age: number;
		pos: string;
		ovr: number | undefined;
		amount: number;
		exp: number;
		market: number;
		fit: string | undefined;
		shapeText: string | undefined;
	}[] = [];
	for (const p of candidates) {
		const r = p.ratings.at(-1) as any;
		const fz = (x: number) => fuzzRating(x, r.fuzz);
		const age = season - p.born.year;
		let value = p.valueFuzz;
		if (noRatings) {
			const st = p.stats.findLast((s) => !s.playoffs) as any;
			value = st && st.gp > 0 ? 40 + 1.1 * (st.per ?? 10) : 35;
		}
		const current = getCurrentContract(p);
		// Free agents: what he asks for
		const amount = current
			? getNearestContractAmount(current, season)
			: genContract({ ...p, value } as any, false).amount;
		const exp = current ? getContractExp(current) : season;
		const market = genContract({ ...p, value } as any, false).amount;
		const surplus = Math.max(
			-3,
			Math.min(3, ((market - amount) / salaryCap) * 10),
		);
		const need = needs[POS_NEED[r.pos] ?? "F"] ?? 0;
		let shape = 0;
		let shapeText: string | undefined;
		if (!noRatings) {
			const lvl = areaValue(
				{
					...r,
					...Object.fromEntries(
						subsArea.bases.map((k) => [k, k === "hgt" ? r.hgt : fz(r[k])]),
					),
				},
				subsArea,
			);
			shape = 0.12 * (lvl - 50);
			if (isValidSubArray(r.sub) && featureOn("subRatings" as any)) {
				const subs = subsArea.subs.map((k) => fz(r.sub[SUB_INDEX[k]!]));
				const avgSub = subs.reduce((a, b) => a + b, 0) / subs.length;
				const off = Math.round(avgSub - lvl);
				shape += 0.1 * off;
				if (Math.abs(off) >= 3) {
					shapeText = `${area.name}: ${subsArea.subs.map((k, i) => `${k.toUpperCase()} ${subs[i]}`).join(", ")} (${off > 0 ? "+" : ""}${off} vs his ratings)`;
				}
			}
		}
		const fit = profile ? playerSystemFit(p, profile).fit : 0;
		const score =
			value +
			6 * need +
			shape +
			1.2 * surplus +
			1.5 * fit -
			(age >= 32 ? 2 : 0);
		rows.push({
			p,
			score,
			value,
			age,
			pos: r.pos as string,
			ovr: noRatings ? undefined : fz(r.ovr),
			amount,
			exp,
			market,
			fit: systems ? fitLabel(fitToScore(fit)) : undefined,
			shapeText,
		});
	}
	rows.sort((a, b) => b.score - a.score);
	const top = rows.slice(0, 30);
	const listsOn =
		featureOn("scoutingReports") && !!g.get("scoutingListSummaries" as any);
	const blurbs =
		listsOn && !light
			? await getScoutingBlurbs(top.slice(0, 20).map((x) => x.p.pid))
			: {};
	const teams = g.get("teamInfoCache");
	const fmt = (x: (typeof rows)[number]) => ({
		pid: x.p.pid,
		name: `${x.p.firstName} ${x.p.lastName}`,
		tid: x.p.tid,
		abbrev: x.p.tid >= 0 ? teams[x.p.tid]?.abbrev : "FA",
		pos: x.pos,
		age: x.age,
		ovr: x.ovr,
		score: Math.round(10 * x.score) / 10,
		contract: { amount: x.amount, exp: x.exp },
		valueText:
			x.market - x.amount > 0.03 * salaryCap
				? "Underpaid"
				: x.amount - x.market > 0.05 * salaryCap
					? "Overpaid"
					: "Fair deal",
		fit: x.fit,
		shapeText: x.shapeText,
		blurb: blurbs[x.p.pid],
	});
	const trade = rows
		.filter((x) => x.p.tid >= 0 && x.amount <= 0.3 * salaryCap)
		.slice(0, 3)
		.map(fmt);
	const fa = rows
		.filter((x) => x.p.tid === PLAYER.FREE_AGENT)
		.slice(0, 3)
		.map(fmt);
	return {
		noRatings,
		listsOn,
		// No Visible Ratings challenge: a band, not the number
		weakest: {
			name: area.name,
			gap: noRatings ? undefined : gap,
			band: gapBand(gap),
		},
		needs: (["G", "F", "C"] as const)
			.filter((k) => needs[k] > 0.05)
			.map((k) => ({ G: "Guard", F: "Wing/forward", C: "Big" })[k]),
		filedBy: proScout
			? `${proScout.name} (${SPECIALTY_NAMES[proScout.specialty].toLowerCase()})`
			: undefined,
		targets: light ? [] : top.map(fmt),
		trade,
		fa,
		systems,
	};
};

// ---- Staff Report ----

const scoutingSection = async (tid: number) => {
	const ctx = await getScoutingContext(tid);
	if (!ctx) {
		return undefined;
	}
	const draftYear = currentDraftYear();
	const cls = ctx.rows.filter((r) => r.p.draft.year === draftYear);
	const boardTop = cls
		.filter((r) => r.p.draftBoard?.rank !== undefined)
		.sort((a, b) => a.p.draftBoard!.rank! - b.p.draftBoard!.rank!)
		.slice(0, 6);
	const tops = (boardTop.length > 0 ? boardTop : cls.slice(0, 6)).map((r) => ({
		pid: r.p.pid,
		name: `${r.p.firstName} ${r.p.lastName}`,
		pos: r.p.ratings.at(-1)!.pos,
		region: REGION_NAMES[r.region],
		rank: r.p.draftBoard?.rank ?? r.rank,
		confidence: confidenceFromFactor(r.p.scoutLooks?.a ?? 1),
		looks: Math.round(r.p.scoutLooks?.n ?? 0),
	}));
	const regions = SCOUT_REGIONS.map((reg) => ({
		region: reg,
		name: REGION_NAMES[reg],
		coverage: ctx.plan.coverage[reg],
		label: coverageLabel(ctx.plan.coverage[reg]),
		importance: Math.round(100 * (ctx.plan.importance[reg] ?? 0)),
		prospects: cls.filter((r) => r.region === reg).length,
		scouts: ctx.scouts
			.filter((s) => ctx.plan.assignments[s.id] === reg)
			.map((s) => s.name),
	}));
	const blind = regions.filter(
		(r) => r.coverage < BLIND_SPOT && r.importance >= 8,
	);
	let rec: Recommendation;
	if (blind.length > 0) {
		// Move the scout who adds least where he is to the biggest blind spot: never one already there (Accept would do nothing), and
		// never the last scout of another region that matters (that would open a new blind spot, and the next report would move him back)
		const target = [...blind].sort(
			(a, b) => b.importance - a.importance || a.region.localeCompare(b.region),
		)[0]!;
		const scoutsIn = (reg: ScoutRegion) =>
			ctx.scouts.filter((x) => ctx.plan.assignments[x.id] === reg).length;
		const importanceOf = (reg: ScoutRegion) =>
			Math.round(100 * (ctx.plan.importance[reg] ?? 0));
		const s = ctx.scouts
			.filter((x) => {
				const reg = ctx.plan.assignments[x.id] as ScoutRegion | undefined;
				if (reg === target.region) {
					return false;
				}
				return !reg || scoutsIn(reg) > 1 || importanceOf(reg) < 8;
			})
			.sort((a, b) => a.quality - b.quality || a.id - b.id)[0];
		const auto = ctx.state.delegation.scouting === "auto";
		if (s) {
			rec = {
				id: `rec-scout-${ctx.season}-${s.id}-${target.region}`,
				title: `Send ${s.name} to the ${target.name}`,
				text: `${target.name} is a blind spot (${target.prospects} prospects of the class, ${target.importance}% of its top talent): prospects there stay uncertain.${auto ? " Scouting delegation goes from Auto to Suggest, so the Director keeps him there and proposes changes for you to approve." : ""}`,
				action: {
					type: "assignRegions",
					// Only this move: the other assignments are read again when you accept
					assignments: { [s.id]: target.region },
				},
			};
		} else {
			rec = {
				id: `rec-scout-hire-${ctx.season}`,
				title: "Add a scout",
				text:
					ctx.scouts.length === 0
						? `You have no scouts, so ${target.name} and every other region go unseen. Raise the scouting budget (Finances) to add scouts.`
						: `${target.name} is a blind spot (${target.importance}% of the class's top talent) and moving a scout there would open another one. Raise the scouting budget (Finances) to add a scout.`,
			};
		}
	} else if (ctx.state.priority === "auto") {
		rec = {
			id: `rec-priority-${ctx.season}`,
			title: `Keep the priority on ${PRIORITY_SHORT[ctx.priority]}`,
			text: "Every region that matters is covered. The Director works with this priority now; set it to keep it fixed.",
			action: { type: "setPriority", priority: ctx.priority },
		};
	} else {
		rec = {
			id: "none",
			title: "No change needed",
			text: "Every region that matters is covered.",
		};
	}
	return {
		director: {
			name: ctx.director.name,
			quality: qualityLabel(ctx.director.quality),
			age: ctx.director.age,
		},
		priority: ctx.state.priority,
		effectivePriority: ctx.priority,
		tops,
		regions,
		blindSpots: blind.map((b) => b.name),
		boardLog: ctx.state.boardLog?.slice(-3).reverse() ?? [],
		rec,
	};
};

const developmentSection = async (tid: number) => {
	const t = (await idb.cache.teams.get(tid))!;
	const state = stateOf(t);
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const report = state.devReport;
	// No Visible Ratings challenge: no rating numbers (sub-ratings included), and no staff focus either (the staff picks it from his
	// weakest skill, so the label would give the hidden ratings away). A focus you or your team priority chose is shown.
	const hideRatings = !!g.get("challengeNoRatings");
	const rawRows = report?.rows ?? [];
	const rows: {
		pid: number;
		name: string;
		pos: string;
		age: number;
		focus: FocusKey | undefined;
		src: DevReportRow["src"];
		subs?: DevReportRow["subs"];
		focusBefore: number | null;
		focusAfter: number | null;
		ovrBefore: number | null;
		ovrAfter: number | null;
	}[] = rawRows.map((r) =>
		hideRatings
			? {
					pid: r.pid,
					name: r.name,
					pos: r.pos,
					age: r.age,
					focus: r.src === "staff" ? undefined : r.focus,
					src: r.src,
					focusBefore: null,
					focusAfter: null,
					ovrBefore: null,
					ovrAfter: null,
				}
			: r,
	);
	const avgFocus =
		!hideRatings && rawRows.length > 0
			? Math.round(
					(10 * rawRows.reduce((a, r) => a + r.focusAfter - r.focusBefore, 0)) /
						rawRows.length,
				) / 10
			: undefined;
	// The plans that will run at the next development, at the start of next season's preseason (this season's already ran when its
	// preseason started). Ages are at that development too, like the staff's choice of focus.
	const planSeason = nextDevSeason();
	const staffFocuses = new Map<number, FocusKey>();
	const plans = players
		// Scouted value, so the order doesn't leak hidden ratings
		.sort((a, b) => b.valueFuzz - a.valueFuzz || a.pid - b.pid)
		.map((p) => {
			const plan = planFor(p, planSeason, state);
			staffFocuses.set(p.pid, staffFocusFor(p, planSeason, state.devPriority));
			return {
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: p.ratings.at(-1)!.pos,
				age: planSeason - p.born.year,
				focus: hideRatings && plan?.src === "staff" ? undefined : plan?.f,
				src: plan?.src,
				override: state.devOverrides?.[p.pid],
			};
		});
	// Recommendation: the most common staff focus among the top 8, as a team priority (not under No Visible Ratings: it comes from
	// the hidden ratings)
	const counts = new Map<FocusKey, number>();
	for (const p of plans.slice(0, 8)) {
		const f = staffFocuses.get(p.pid)!;
		counts.set(f, (counts.get(f) ?? 0) + 1);
	}
	const common = [...counts].sort((a, b) => b[1] - a[1])[0];
	const rec: Recommendation =
		!hideRatings && common && common[1] >= 3 && state.devPriority !== common[0]
			? {
					id: `rec-dev-${g.get("season")}`,
					title: `Team priority: ${FOCUSES[common[0]].name}`,
					text: `${common[1]} of your top 8 players need it most (${FOCUSES[common[0]].what}).`,
					action: { type: "teamDevPriority", focus: common[0] },
				}
			: {
					id: "none",
					title: "Plans look right",
					text: "The staff's plans fit each player's biggest weakness.",
				};
	return {
		season: report?.season,
		rows,
		avgFocus,
		hideRatings,
		plans,
		planSeason,
		devPriority: state.devPriority,
		focuses: FOCUS_KEYS.map((k) => ({
			key: k,
			name: FOCUSES[k].name,
			what: FOCUSES[k].what,
		})),
		rec,
		groupOf: Object.fromEntries(plans.map((p) => [p.pid, groupOfPos(p.pos)])),
	};
};

const fitSection = async (tid: number) => {
	const pro = await getProScouting({ light: true });
	const noRatings = !!g.get("challengeNoRatings");
	let systems;
	// No Visible Ratings challenge: no system fit (it comes from the ratings), like Pro Scouting
	if (coachSystemsEnabled() && !noRatings) {
		const fit = await getRosterFit(tid);
		const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
		const head = coaches.find((c) => c.role === "head");
		const best = bestSystems(fit);
		if (head?.profile) {
			systems = {
				off: OFFENSE_NAMES[head.profile.off],
				def: DEFENSE_NAMES[head.profile.def],
				offFit: fitLabel(fitToScore(fit.off[head.profile.off])),
				defFit: fitLabel(fitToScore(fit.def[head.profile.def])),
				bestOff: OFFENSE_NAMES[best.off[0]!],
				bestDef: DEFENSE_NAMES[best.def[0]!],
			};
		}
	}
	const target = pro.trade[0] ?? pro.fa[0];
	const rec: Recommendation = target
		? {
				id: `rec-fit-${target.pid}`,
				title: `Watch ${target.name} (${target.abbrev})`,
				text: `Pro scouting's best ${target.tid >= 0 ? "trade" : "free agent"} target for your weakest area (${pro.weakest.name})${target.fit ? `, ${target.fit.toLowerCase()} in your systems` : ""}: ${target.valueText.toLowerCase()} at $${(target.contract.amount / 1000).toFixed(1)}M.`,
				action: { type: "watch", pid: target.pid },
			}
		: { id: "none", title: "No target", text: "" };
	return { systems, weakest: pro.weakest, needs: pro.needs, rec };
};

const conditioningSection = async (tid: number) => {
	const season = g.get("season");
	const depth = coachingDepthOn()
		? (await getDepthTeams()).get(tid)
		: undefined;
	const coaches = await idb.cache.coaches.getAll();
	const sc = coaches.find((c) => c.tid === tid && c.role === "sc");
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const injured = players.filter((p) => p.injury.gamesRemaining > 0);
	const old = players.filter((p) => season - p.born.year >= 30).length;
	let rec: Recommendation = {
		id: "none",
		title: "No change needed",
		text: depth
			? "Your conditioning staff is about league average or better."
			: "",
	};
	if (depth && depth.scZ < -0.2) {
		// Below average: a hire if someone better is affordable, else say so (not "no change needed")
		rec = {
			id: `rec-sc-none-${season}`,
			title: "No affordable upgrade",
			text: `Your conditioning staff is below the league average, but no available ${COACH_ROLE_NAMES.sc.toLowerCase()} is clearly better at a reasonable salary. Check the coaching market again later.`,
		};
		const salaryCap = g.get("salaryCap");
		const fa = coaches
			.filter((c) => c.tid === -1 && (c.ratings.cnd ?? 0) > depth.sc + 6)
			.filter(
				(c) =>
					coachSalaryDemand(c.ratings, "sc", salaryCap) <=
					2 *
						coachSalaryDemand(
							{ dev: 60, off: 60, def: 60, mot: 60, cnd: 60 },
							"sc",
							salaryCap,
						),
			)
			.sort((a, b) => (b.ratings.cnd ?? 0) - (a.ratings.cnd ?? 0))[0];
		if (fa) {
			rec = {
				id: `rec-sc-${fa.cid}`,
				title: `Hire ${fa.firstName} ${fa.lastName} as ${COACH_ROLE_NAMES.sc}`,
				text: `Conditioning ${fa.ratings.cnd} vs your ${depth.sc}${sc ? ` (${sc.firstName} ${sc.lastName} would be let go, buyout applies)` : ""}. With ${old} players 30 or older, slower athletic decline and fewer injuries matter.`,
				action: { type: "hire", cid: fa.cid, role: "sc" },
			};
		}
	}
	return {
		coach: sc
			? {
					cid: sc.cid,
					name: `${sc.firstName} ${sc.lastName}`,
					rating: sc.ratings.cnd,
					ovr: coachOvr(sc.ratings, "sc"),
				}
			: undefined,
		z: depth ? Math.round(100 * depth.scZ) / 100 : undefined,
		injuryFactor: depth
			? Math.round(1000 * (1 - 0.04 * depth.scZ)) / 1000
			: undefined,
		injured: injured.map((p) => ({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			type: p.injury.type,
			games: p.injury.gamesRemaining,
		})),
		old,
		numPlayers: players.length,
		effect: DEPTH_EFFECT_TEXT.sc,
		rec,
	};
};

export const getStaffReport = async () => {
	const tid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return undefined;
	}
	const state = stateOf(t);
	const scoutingOn = scoutingDepthOn();
	const coachingOn = coachingDepthOn();
	const noRatings = !!g.get("challengeNoRatings");
	const dismissed = new Set(
		state.dismissedRecs?.season === g.get("season")
			? state.dismissedRecs.ids
			: [],
	);
	return {
		season: g.get("season"),
		phase: g.get("phase"),
		scoutingOn,
		coachingOn,
		// Spectator mode and auto play: the page is read only (the actions refuse too)
		controls: userControls(tid),
		delegation: state.delegation,
		suggestions: (state.suggestions ?? [])
			.filter((s) => s.pending)
			// No Visible Ratings challenge: the proposed plans (staff focuses) stay in the worker; approving uses the stored proposal
			.map((s) =>
				noRatings && s.action.type === "devPlans"
					? { ...s, action: { ...s.action, plans: {} } }
					: s,
			),
		scouting: markDismissed(
			scoutingOn ? await scoutingSection(tid) : undefined,
			dismissed,
		),
		development: markDismissed(
			coachingOn ? await developmentSection(tid) : undefined,
			dismissed,
		),
		fit: markDismissed(await fitSection(tid), dismissed),
		conditioning: markDismissed(await conditioningSection(tid), dismissed),
		offense: await offEmphasisRecommendation(tid),
	};
};

// ---- Scouting department extras (Scouting Department page) ----

const ASSIGNMENT_PROSPECTS = 6;

const assignmentMap = (ctx: ScoutingContext) => {
	const draftYear = currentDraftYear();
	const current = ctx.rows
		.filter((r) => r.p.draft.year === draftYear)
		.sort((a, b) => a.rank - b.rank);
	return ctx.scouts.map((s) => {
		const region = ctx.plan.assignments[s.id] as ScoutRegion;
		const focus = scoutFocusOf(s);
		const prospects = current
			.filter((r) => r.region === region)
			.map((r) => ({
				pid: r.p.pid,
				name: `${r.p.firstName} ${r.p.lastName}`,
				pos: r.p.ratings.at(-1)!.pos,
				rank: r.rank,
				inFocus: focusScoutsFor(ctx, r.p, region).some((x) => x.id === s.id),
			}))
			.sort((a, b) => Number(b.inFocus) - Number(a.inFocus) || a.rank - b.rank)
			.slice(0, ASSIGNMENT_PROSPECTS);
		return {
			id: s.id,
			name: s.name,
			region,
			regionName: REGION_NAMES[region],
			focus: SCOUT_FOCUS_NAMES[focus],
			focusKind: SCOUT_FOCUS_KIND[focus],
			prospects,
			numInFocus: current.filter(
				(r) =>
					r.region === region &&
					focusScoutsFor(ctx, r.p, region).some((x) => x.id === s.id),
			).length,
			numInRegion: current.filter((r) => r.region === region).length,
		};
	});
};

export const getScoutingDepth = async (tid: number) => {
	if (!scoutingDepthOn()) {
		return undefined;
	}
	const ctx = await getScoutingContext(tid);
	if (!ctx) {
		return undefined;
	}
	const career = careerOf(ctx.t);
	const acc = await scoutAccuracyById();
	const season = ctx.season;
	const ourGuys = career.ourGuys.filter((x) => x.s >= season - 6);
	const focusOn = scoutFocusOn();
	return {
		isUser: tid === g.get("userTid"),
		director: {
			name: ctx.director.name,
			age: ctx.director.age,
			quality: qualityLabel(ctx.director.quality),
			since: ctx.director.since,
			how: career.dirs.findLast((d) => d.since <= season)?.how ?? "hired",
		},
		priority: ctx.state.priority,
		effectivePriority: ctx.priority,
		delegation: ctx.state.delegation.scouting,
		regions: SCOUT_REGIONS.map((r) => ({
			region: r,
			name: REGION_NAMES[r],
			coverage: ctx.plan.coverage[r],
			label: coverageLabel(ctx.plan.coverage[r]),
			importance: Math.round(100 * (ctx.plan.importance[r] ?? 0)),
		})),
		scouts: ctx.scouts.map((s) => {
			const a = acc.get(s.id);
			const fromHits = a
				? Math.max(
						-0.6,
						Math.min(0.6, (a.hitRate - 0.45) * 2 * Math.min(1, a.judged / 5)),
					)
				: 0;
			const rep =
				Math.round(
					100 *
						(fromHits +
							(career.rep[s.id] ?? 0) +
							0.015 * scoutExperience(s, season)),
				) / 100;
			const second = secondSpecialty(s, season);
			const focus = focusOn ? scoutFocusOf(s) : undefined;
			return {
				id: s.id,
				name: s.name,
				focus: focus ? SCOUT_FOCUS_NAMES[focus] : undefined,
				focusKind: focus ? SCOUT_FOCUS_KIND[focus] : undefined,
				region: ctx.plan.assignments[s.id] as ScoutRegion,
				autoRegion: ctx.auto.assignments[s.id] as ScoutRegion,
				experience: scoutExperience(s, season),
				second: second ? SPECIALTY_NAMES[second] : undefined,
				reputation: rep,
				reputationLabel: reputationLabel(rep),
				ourGuys: ourGuys
					.filter((x) => x.sid === s.id)
					.map((x) => ({
						pid: x.pid,
						name: x.name,
						season: x.s,
						judged: x.judged,
					})),
			};
		}),
		log: [...career.log].reverse().slice(0, 12),
		// Scout Specialties & Assignments: who covers which region, and the prospects there (in his focus first)
		assignments: focusOn ? assignmentMap(ctx) : undefined,
		formerOurGuys: ourGuys
			.filter((x) => x.judged === "star" || x.judged === "bust")
			.slice(-8),
	};
};

export type StaffReport = NonNullable<
	Awaited<ReturnType<typeof getStaffReport>>
>;
export type { DelegationArea, StaffSuggestion };
