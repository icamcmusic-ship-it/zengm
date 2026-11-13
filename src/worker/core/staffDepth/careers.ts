// Coaching Staff Depth: coaching careers. New coaches enter as assistants (or former players start out as assistants); head coaching jobs go
// to former head coaches and experienced assistants, free or employed (internal promotions, and good assistants hired away after good
// seasons); the head coach he worked under is his mentor, which makes coaching trees. Head coaches are only made as head coaches at league
// creation. Seeded streams only for the new parts.
import {
	COACH_FREE_AGENT,
	COACH_ROLE_NAMES,
	coachOvr,
	coachSalaryDemand,
} from "../../../common/staff.ts";
import { PHASE } from "../../../common/constants.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import type {
	Coach,
	CoachRole,
	CoachWithoutKey,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, logEvent } from "../../util/index.ts";
import { profileForNewCoach } from "../staff/systems.ts";
import {
	activeCoachRoles,
	ensureDepthRatings,
	stateOf,
	userControls,
} from "./coaching.ts";
import { addSuggestion } from "./suggestions.ts";

const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	if (!info) {
		return "a team";
	}
	return `the <a href="/l/${g.get("lid")}/staff/${info.abbrev}_${tid}">${info.region} ${info.name}</a>`;
};

const coachLink = (c: CoachWithoutKey) =>
	`<a href="/l/${g.get("lid")}/coach/${c.cid}">${c.firstName} ${c.lastName}</a>`;

const contractStartSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

const seasonsAsAssistant = (c: CoachWithoutKey) =>
	c.stats.filter((r) => r.role !== "head").length;

const hasBeenHead = (c: CoachWithoutKey) =>
	c.role === "head" || c.stats.some((r) => r.role === "head");

/**
 * Can he be hired as a head coach? Former head coaches, and assistants with experience: a season on a staff for one who has a job, three
 * for one out of work (the league's first coaches count as experienced).
 */
export const isHeadEligible = (c: Coach) => {
	if (hasBeenHead(c)) {
		return true;
	}
	if (g.get("season") - c.born.year > 66) {
		return false;
	}
	const n = c.stats.length;
	if (c.tid >= 0) {
		return n >= 1 || !!c.tree?.initial;
	}
	return n >= 3 || (!!c.tree?.initial && n >= 1);
};

let successCache: { key: string; byTid: Map<number, number> } | undefined;

// How good last season was for each team: win% above .500 and playoff rounds
const teamSuccess = async () => {
	const season =
		g.get("phase") > PHASE.PLAYOFFS ? g.get("season") : g.get("season") - 1;
	const key = `${g.get("lid")}|${season}`;
	if (successCache?.key === key) {
		return successCache.byTid;
	}
	const byTid = new Map<number, number>();
	const rows = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	for (const ts of rows) {
		const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
		const pct = gp > 0 ? (ts.won + 0.5 * (ts.tied ?? 0)) / gp : 0.5;
		byTid.set(
			ts.tid,
			Math.min(6, 8 * (pct - 0.5) + 1.2 * Math.max(0, ts.playoffRoundsWon)),
		);
	}
	successCache = { key, byTid };
	return byTid;
};

/**
 * Score bonus for a head coaching candidate (on top of his head coach ovr): an assistant's team's success last season (up to +6, so good
 * assistants are hired away after good seasons) and his years on staffs (up to +3); an internal candidate knows the roster (+1).
 */
export const headCandidateBonus = async (c: Coach, tid: number) => {
	if (hasBeenHead(c) && c.role === "head") {
		return 0;
	}
	const success = await teamSuccess();
	let bonus = 0.4 * Math.min(7.5, seasonsAsAssistant(c));
	if (c.tid >= 0) {
		bonus += success.get(c.tid) ?? 0;
		if (c.tid === tid) {
			bonus += 1;
		}
	}
	return bonus;
};

/**
 * Right before a coach is hired (still at his old job): a promotion to head coach records his mentor (the head coach he last worked under)
 * and the promotion, and leaves his old team (a "left" transaction). Returns the news text for the hire.
 */
export const onCoachHired = async (c: Coach, tid: number, role: CoachRole) => {
	const season = g.get("season");
	const tree = c.tree ?? {
		start: c.stats[0]?.role ?? c.role,
		startSeason: c.stats[0]?.season ?? season,
	};
	c.tree = tree;
	const prevTid = c.tid;
	const prevRole = c.role;
	if (prevTid >= 0 && prevTid !== tid) {
		c.transactions.push({
			season,
			phase: g.get("phase"),
			tid: prevTid,
			role: prevRole,
			type: "left",
		});
	}
	if (role !== "head" || hasBeenHead(c)) {
		return undefined;
	}
	// First head coaching job: his mentor and the promotion
	const asAssistant = c.stats.findLast((r) => r.role !== "head");
	if (asAssistant && !tree.mentor) {
		const all = await idb.cache.coaches.getAll();
		const mentor = all.find(
			(m) =>
				m.cid !== c.cid &&
				m.stats.some(
					(r) =>
						r.season === asAssistant.season &&
						r.tid === asAssistant.tid &&
						r.role === "head",
				),
		);
		if (mentor) {
			tree.mentor = {
				cid: mentor.cid,
				name: `${mentor.firstName} ${mentor.lastName}`,
			};
		}
	}
	tree.promotions = [
		...(tree.promotions ?? []),
		{ season: contractStartSeason(), tid, from: prevRole, to: "head" },
	];
	const job = COACH_ROLE_NAMES[prevRole].toLowerCase();
	const mentorText = tree.mentor
		? ` (from the ${tree.mentor.name} coaching tree)`
		: "";
	let text;
	if (prevTid === tid) {
		text = `${teamLink(tid)} promoted ${job} ${coachLink(c)} to head coach${mentorText}.`;
	} else if (prevTid >= 0) {
		text = `${teamLink(tid)} hired ${coachLink(c)} away from ${teamLink(prevTid)}, where he was the ${job}, as head coach${mentorText}.`;
		if (userControls(prevTid)) {
			await logEvent({
				type: "info",
				text: `Your ${job} ${coachLink(c)} was hired away by ${teamLink(tid)} as their head coach.`,
				showNotification: true,
				tids: [prevTid],
				saveToDb: true,
				score: 0,
			});
		}
	} else {
		text = `${teamLink(tid)} hired former ${job} ${coachLink(c)} as head coach${mentorText}, his first head coaching job.`;
	}
	return { text };
};

export const userHiringDelegation = async () => {
	const tid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	return t && userControls(tid) ? stateOf(t).delegation.hiring : "auto";
};

// After the offseason market: with hiring on Suggest, the staff proposes a candidate for each of the user's vacancies
export const afterCoachingMarket = async () => {
	const tid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	if (!t || !userControls(tid)) {
		return;
	}
	const state = stateOf(t);
	if (state.delegation.hiring !== "suggest") {
		return;
	}
	const coaches = await idb.cache.coaches.getAll();
	const salaryCap = g.get("salaryCap");
	for (const role of activeCoachRoles()) {
		if (coaches.some((c) => c.tid === tid && c.role === role)) {
			continue;
		}
		const best = coaches
			.filter(
				(c) =>
					c.tid === COACH_FREE_AGENT &&
					(role !== "head" || isHeadEligible(c)) &&
					coachSalaryDemand(c.ratings, role, salaryCap) <=
						1.3 *
							coachSalaryDemand(
								{
									dev: 60,
									off: 60,
									def: 60,
									mot: 60,
									sht: 60,
									cnd: 60,
									vid: 60,
								},
								role,
								salaryCap,
							),
			)
			.sort((a, b) => coachOvr(b.ratings, role) - coachOvr(a.ratings, role))[0];
		if (best) {
			await addSuggestion(tid, {
				id: `hire-${role}-${g.get("season")}`,
				area: "hiring",
				season: g.get("season"),
				title: `Hire ${best.firstName} ${best.lastName} as ${COACH_ROLE_NAMES[role]}`,
				text: `Your ${COACH_ROLE_NAMES[role]} job is open. The staff recommends ${best.firstName} ${best.lastName} (${coachOvr(best.ratings, role)} for the job, asking $${(coachSalaryDemand(best.ratings, role, salaryCap) / 1000).toFixed(1)}M a season).`,
				action: { type: "hire", cid: best.cid, role },
				pending: true,
			});
		}
	}
};

/**
 * Former players who start coaching: last season's retirees with at least six pro seasons, 30-40 years old, about one in twelve (more for
 * high basketball IQ), at most three a season, as assistants (offense or defense by which IQ is higher). Seeded by league and season.
 */
export const exPlayerCoaches = async (): Promise<CoachWithoutKey[]> => {
	const season = g.get("season");
	const retired = await idb.merged.players.getAll({ retiredYear: season - 1 });
	if (retired.length === 0) {
		return [];
	}
	const already = new Set(
		(await idb.cache.coaches.getAll())
			.map((c) => c.tree?.exPlayer)
			.filter((x) => x !== undefined),
	);
	const out: CoachWithoutKey[] = [];
	const salaryCap = g.get("salaryCap");
	for (const p of retired.sort((a, b) => a.pid - b.pid)) {
		if (out.length >= 3 || already.has(p.pid)) {
			continue;
		}
		const age = season - p.born.year;
		const proSeasons = new Set(
			p.stats.filter((s) => !s.playoffs && s.tid >= 0).map((s) => s.season),
		).size;
		if (age < 30 || age > 40 || proSeasons < 6) {
			continue;
		}
		const r = p.ratings.at(-1) as any;
		const iq = (r.oiq + r.diq) / 2;
		const rng = new Rng(`exPlayerCoach|${g.get("lid")}|${p.pid}|${season}`);
		const chance = Math.max(0.03, Math.min(0.2, 0.08 + 0.004 * (iq - 55)));
		if (rng.random() >= chance) {
			continue;
		}
		const b = (x: number) => Math.max(1, Math.min(100, Math.round(x)));
		const ratings = {
			dev: b(36 + rng.normal(0, 8)),
			off: b(22 + 0.4 * r.oiq + rng.normal(0, 6)),
			def: b(22 + 0.4 * r.diq + rng.normal(0, 6)),
			mot: b(44 + rng.normal(0, 8)),
		};
		const role: CoachRole = r.oiq >= r.diq ? "off" : "def";
		const c: CoachWithoutKey = {
			firstName: p.firstName,
			lastName: p.lastName,
			born: { year: p.born.year, loc: p.born.loc },
			face: p.face as any,
			tid: COACH_FREE_AGENT,
			role,
			ratings,
			style: {
				pace: Math.round(rng.normal(0, 0.45) * 100) / 100,
				threes: Math.round(rng.normal(0, 0.45) * 100) / 100,
				defense: Math.round(rng.normal(0, 0.45) * 100) / 100,
				rotation: Math.round(rng.normal(0, 0.45) * 100) / 100,
			},
			contract: {
				amount: coachSalaryDemand(ratings, role, salaryCap),
				exp: contractStartSeason() + 2,
			},
			stats: [],
			awards: [],
			transactions: [],
			tree: {
				start: role,
				startSeason: contractStartSeason(),
				exPlayer: p.pid,
			},
		};
		for (const key of ["pace", "threes", "defense", "rotation"] as const) {
			c.style[key] = Math.max(-1, Math.min(1, c.style[key]));
		}
		ensureDepthRatings(c);
		const profile = profileForNewCoach(c);
		if (profile) {
			c.profile = profile;
		}
		out.push(c);
	}
	return out;
};

// The coaching tree page of a coach (Coach page): his start, his mentors upward, every head coach he mentored (and theirs), and the
// assistants who worked under him
export const coachTreePage = async (c: Coach) => {
	const all = await idb.cache.coaches.getAll();
	const byCid = new Map(all.map((x) => [x.cid, x]));
	const mentorOf = (x: CoachWithoutKey) => x.tree?.mentor ?? x.profile?.mentor;
	const up: { cid: number; name: string }[] = [];
	const seen = new Set<number>([c.cid]);
	let cur: CoachWithoutKey | undefined = c;
	while (cur) {
		const m = mentorOf(cur);
		if (!m || seen.has(m.cid)) {
			break;
		}
		up.push(m);
		seen.add(m.cid);
		cur = byCid.get(m.cid);
	}
	const teamAbbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev;
	const describe = (x: Coach) => ({
		cid: x.cid,
		name: `${x.firstName} ${x.lastName}`,
		role:
			x.tid >= 0
				? COACH_ROLE_NAMES[x.role]
				: x.tid === COACH_FREE_AGENT
					? "Free agent"
					: "Retired",
		abbrev: x.tid >= 0 ? teamAbbrev(x.tid) : undefined,
		start: x.tree ? COACH_ROLE_NAMES[x.tree.start] : undefined,
	});
	const down = (
		cid: number,
		depth: number,
	): (ReturnType<typeof describe> & { depth: number })[] => {
		if (depth > 3) {
			return [];
		}
		return all
			.filter((x) => mentorOf(x)?.cid === cid)
			.flatMap((x) => [{ ...describe(x), depth }, ...down(x.cid, depth + 1)]);
	};
	const headSeasons = new Set(
		c.stats.filter((r) => r.role === "head").map((r) => `${r.season}|${r.tid}`),
	);
	const assistants = all
		.filter(
			(x) =>
				x.cid !== c.cid &&
				x.stats.some(
					(r) => r.role !== "head" && headSeasons.has(`${r.season}|${r.tid}`),
				),
		)
		.map((x) => {
			const rows = x.stats.filter(
				(r) => r.role !== "head" && headSeasons.has(`${r.season}|${r.tid}`),
			);
			return {
				...describe(x),
				job: COACH_ROLE_NAMES[rows.at(-1)!.role],
				seasons: rows.length,
				becameHead: x.stats.some((r) => r.role === "head") || x.role === "head",
			};
		})
		.sort(
			(a, b) =>
				Number(b.becameHead) - Number(a.becameHead) || b.seasons - a.seasons,
		)
		.slice(0, 30);
	return {
		start: c.tree ? COACH_ROLE_NAMES[c.tree.start] : undefined,
		startSeason: c.tree?.startSeason,
		initial: !!c.tree?.initial,
		exPlayer: c.tree?.exPlayer,
		promotions: (c.tree?.promotions ?? []).map((pr) => ({
			...pr,
			abbrev: teamAbbrev(pr.tid),
			fromName: COACH_ROLE_NAMES[pr.from],
			toName: COACH_ROLE_NAMES[pr.to],
		})),
		up,
		down: down(c.cid, 1),
		assistants,
	};
};
