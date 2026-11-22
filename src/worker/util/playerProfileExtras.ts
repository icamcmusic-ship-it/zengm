// Complete Profile Export (League Extras, profileExportFull): the parts of "Export profile" that come from the rest of his
// pages and from league pages with rows about him (Award Vote, Award Races, GOAT Lab, Hall of Fame, Coaches, Rivalries, College
// Recruiting). Each builder reads what the user can see there: scouted ratings, nothing rating-based under the no visible
// ratings challenge (but for retired players), recruit wants only as far as his staff scouted him, and nothing from a League
// Extra that is off. See worker/util/playerProfileExport.ts and docs/native-features.md#export-profile.
import {
	ADV_STAT_META,
	advStat,
	playTypeProfile,
} from "../../common/advStats.ts";
import type { AdvStatKey } from "../../common/advStats.ts";
import { archetypeById, TIER_NAMES } from "../../common/archetypes/classify.ts";
import { formatPlayerAwardName } from "../../common/awards.ts";
import { classYearName } from "../../common/college/constants.ts";
import { PHASE, PHASE_TEXT } from "../../common/constants.ts";
import type { ExportTable } from "../../common/playerExport.ts";
import type { ProfileFact } from "../../common/playerProfileExport.ts";
import { COACH_ROLE_NAMES } from "../../common/staff.ts";
import type { Coach, Player } from "../../common/types.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { getPlayerContractPanel } from "../core/contract/playerPanel.ts";
import { getAwardCandidates } from "../core/awards/getAwardCandidates.ts";
import { getProProjections } from "../core/draft/mockDraftData.ts";
import { player } from "../core/index.ts";
import { overrideFor } from "../core/player/archetypeFeedback.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";
import {
	coachSystemsEnabled,
	getCoachProfile,
	playerSystemFit,
} from "../core/staff/systems.ts";
import { idb } from "../db/index.ts";
import { getRoundsWonText } from "../views/frivolitiesTeamSeasons.ts";
import { withoutPreDraft } from "../views/most.ts";
import { staffViewEnabled } from "../views/staffShared.ts";
import { primeFace } from "./faceAging.ts";
import { formatEventText } from "./formatEventText.ts";
import goatFormula from "./goatFormula.ts";
import { getHofStories, hofWordsOn, plaqueWithPrime } from "./hofStory.ts";
import { g, helpers } from "./index.ts";
import { featureOn } from "./nativeFeatures.ts";
import { loadRivalries } from "./rivalries.ts";
import { pairGames, rivalryStoriesOn } from "./rivalryStories.ts";

export const fullProfileOn = () => featureOn("profileExportFull");

export const cell = (value: unknown): string | number => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
	}
	if (value == null) {
		return "";
	}
	return String(value);
};

export const money = (thousands: number) =>
	`$${(Math.round(thousands / 10) / 100).toFixed(2)}M`;

export const fact = (label: string, value: unknown): ProfileFact[] =>
	value === undefined || value === null || value === ""
		? []
		: [{ label, value: String(value) }];

const pct = (x: number | undefined) =>
	x === undefined ? "" : `${Math.round(100 * x)}%`;

const abbrevOf = (tid: number) =>
	g.get("teamInfoCache")[tid]?.abbrev ?? (tid >= 0 ? `Team ${tid}` : "");

const teamName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : abbrevOf(tid);
};

const ordinal = (n: number) => helpers.ordinal(n);

export type Built = {
	facts: ProfileFact[];
	lines: string[];
	tables: ExportTable[];
	data: Record<string, unknown>;
};

const empty = (): Built => ({ facts: [], lines: [], tables: [], data: {} });

const isEmpty = (b: Built) =>
	b.facts.length === 0 && b.lines.length === 0 && b.tables.length === 0;

// His (season, team) pairs as a pro (or in a college league, his college seasons), regular season, in order. A traded player has
// one per team.
const careerStints = (pRaw: Player) => {
	const seen = new Set<string>();
	const out: { season: number; tid: number }[] = [];
	for (const row of pRaw.stats) {
		if (row.playoffs || row.tid < 0) {
			continue;
		}
		const key = `${row.season}|${row.tid}`;
		if (!seen.has(key)) {
			seen.add(key);
			out.push({ season: row.season, tid: row.tid });
		}
	}
	return out;
};

// ---- Overview: archetype details, the user's archetype pick, pro projection ----

export const overviewExtras = async ({
	pRaw,
	p,
	showRatings,
	prospect,
}: {
	pRaw: Player;
	p: any;
	showRatings: boolean;
	prospect: boolean;
}): Promise<Built> => {
	const out = empty();
	const a = p.archetype;
	if (showRatings && a) {
		const override = overrideFor(pRaw.pid);
		out.facts.push(
			...fact(
				"Archetype tier",
				a.tier ? TIER_NAMES[a.tier as keyof typeof TIER_NAMES] : undefined,
			),
			...fact(
				"Archetype confidence",
				typeof a.conf === "number" ? `${a.conf}%` : undefined,
			),
			...fact(
				"Archetype set by",
				a.user || override ? "You (archetype feedback)" : undefined,
			),
		);
		if (a.desc) {
			out.lines.push(`${a.label}: ${a.desc}`);
		}
		if (a.whyText) {
			out.lines.push(`Why: ${a.whyText}`);
		}
		out.data.archetype = {
			id: a.id,
			name: a.name,
			label: a.label,
			desc: a.desc,
			group: a.group,
			tier: a.tier,
			conf: a.conf,
			season: a.season,
			live: a.live,
			whyText: a.whyText,
			// What drove the pick, without the numbers (the page's popover shows them as bars)
			why: (a.why ?? []).map((w: any) => ({ label: w.label, want: w.want })),
			userPick: override
				? { id: override, name: archetypeById(override)?.name ?? override }
				: undefined,
		};
	}

	// Mock Draft setting: his pro projection as a prospect (from scouted ratings; the peak is an ovr, hidden under the challenge)
	if (prospect && featureOn("mockDraft")) {
		const proj: any = (await getProProjections([pRaw.pid]))[pRaw.pid];
		if (proj) {
			const { peak, peakLow, peakHigh, ...rest } = proj;
			out.facts.push(
				...fact(
					"Pro projection",
					`${proj.verdict ?? ""}${proj.verdict ? ": " : ""}star ${pct(proj.starPct)}, starter ${pct(proj.starterPct)}, bust ${pct(proj.bustPct)}`,
				),
				...fact(
					"Projected peak",
					showRatings && peak !== undefined
						? `${peak} (${peakLow}-${peakHigh})`
						: undefined,
				),
			);
			out.data.proProjection = showRatings
				? { ...rest, peak, peakLow, peakHigh }
				: rest;
		}
	}
	return out;
};

// ---- Tracking profile (Advanced Tracking Stats) ----

const TRACKING_GROUPS: { title: string; stats: AdvStatKey[] }[] = [
	{
		title: "Shooting",
		stats: ["cs3a", "cs3p", "pu3a", "pu3p", "astpRim", "astpLong", "astp3"],
	},
	{
		title: "Defense",
		stats: ["dfga", "dfgp", "dfgp3", "con2", "con3", "rimDfgp", "rimDeter"],
	},
	{
		title: "On/Off",
		stats: ["onOrtg", "onDrtg", "onNet", "offNet", "onOffNet"],
	},
	{
		title: "Clutch",
		stats: ["clGp", "clMin", "clPts", "clFgp", "clPm", "clUsgp"],
	},
];

export const trackingSection = (
	advSeasons: { season: number | "career"; adv: number[] }[],
	// His season-by-season tracking was folded into the career total when he retired (Keep Career Tracking for Retired Players)
	advCareerFolded?: boolean,
): Built | undefined => {
	if (advSeasons.length === 0) {
		return undefined;
	}
	const out = empty();
	if (advCareerFolded) {
		out.lines.push(
			"Season-by-season tracking isn't kept after retirement: the career rows have all of his tracking.",
		);
	}
	const seasons = advSeasons.map((row) => {
		const profile = playTypeProfile(row.adv);
		const groups = Object.fromEntries(
			TRACKING_GROUPS.map((group) => [
				group.title,
				Object.fromEntries(
					group.stats.map((stat) => [stat, advStat(row.adv, stat)]),
				),
			]),
		);
		return {
			season: row.season,
			playTypes: profile
				? {
						poss: profile.poss,
						types: profile.types
							.filter((t) => t.poss > 0)
							.map((t) => ({
								key: t.key,
								name: t.name,
								poss: t.poss,
								freq: t.freq,
								ppp: t.ppp,
								fgp: t.fgp,
								tovp: t.tovp,
							})),
					}
				: undefined,
			groups,
		};
	});
	for (const row of seasons) {
		if (row.playTypes && row.playTypes.types.length > 0) {
			out.tables.push({
				section: "Tracking",
				title: `Play types, ${row.season === "career" ? "career" : row.season}`,
				cols: ["Play type", "Poss", "Freq", "PPP", "FG%", "TOV%"],
				rows: row.playTypes.types.map((t) => [
					t.name,
					t.poss,
					t.freq === undefined ? "" : `${cell(t.freq)}%`,
					t.ppp === undefined ? "" : (Math.round(t.ppp * 100) / 100).toFixed(2),
					cell(t.fgp),
					cell(t.tovp),
				]),
			});
		}
	}
	for (const group of TRACKING_GROUPS) {
		out.tables.push({
			section: "Tracking",
			title: group.title,
			cols: ["Year", ...group.stats.map((stat) => ADV_STAT_META[stat].title)],
			rows: seasons.map((row) => [
				row.season === "career" ? "Career" : row.season,
				...group.stats.map((stat) =>
					cell((row.groups[group.title] as any)[stat]),
				),
			]),
		});
	}
	out.data = advCareerFolded
		? { seasons, foldedAtRetirement: true }
		: { seasons };
	return out;
};

// ---- Recruiting ----

export const recruitingSection = ({
	pRaw,
	p,
	info,
}: {
	pRaw: Player;
	p: any;
	info: any;
}): Built | undefined => {
	const out = empty();
	const college = isCollege();
	const teamInfo = g.get("teamInfoCache");

	// College leagues: his recruitment by the league's schools
	const recruit = pRaw.recruit;
	if (college && recruit) {
		const userTid = g.get("userTid");
		const scout = recruit.scout ?? 0;
		const schools = [...(recruit.schools ?? [])].sort((a, b) => b.i - a.i);
		const committed = recruit.committed ?? recruit.commit;
		out.facts.push(
			...fact("Recruit", `${recruit.stars}-star`),
			...fact(
				"National rank",
				recruit.walkOn ? "Walk-on" : `No. ${recruit.rank}`,
			),
			...fact("Position rank", recruit.walkOn ? undefined : recruit.posRank),
			...fact("Home", recruit.state),
			...fact("Recruiting class", recruit.season),
			...fact(
				recruit.committed !== undefined ? "Signed with" : "Committed to",
				committed !== undefined ? teamName(committed) : undefined,
			),
			...fact(
				"Your target",
				recruit.userTarget !== undefined
					? `Priority ${recruit.userTarget}`
					: undefined,
			),
			...fact(
				"Class",
				p.classYear !== undefined ? classYearName(p.classYear) : undefined,
			),
		);
		const exit = pRaw.collegeExit;
		if (exit) {
			out.lines.push(
				exit.type === "pro"
					? `Left ${teamName(exit.tid)} for the pros in ${exit.season}${exit.pick !== undefined ? ` (pick ${exit.pick})` : ""}`
					: exit.type === "graduated"
						? `Graduated from ${teamName(exit.tid)} in ${exit.season}`
						: `Left school in ${exit.season}`,
			);
		}
		// What he wants: as far as the user's staff scouted him (the recruiting board's rule)
		const prefs = recruit.prefs;
		const ranked = prefs
			? (Object.keys(prefs) as (keyof typeof prefs)[]).sort(
					(a, b) => prefs[b] - prefs[a],
				)
			: [];
		const wants =
			scout >= 2
				? ranked.map((key) => ({ key, weight: prefs![key] }))
				: scout === 1
					? ranked.slice(0, 2).map((key) => ({ key }))
					: [];
		if (wants.length > 0) {
			out.lines.push(`What he wants: ${wants.map((w) => w.key).join(", ")}`);
		}
		if (schools.length > 0) {
			out.tables.push({
				section: "Recruiting",
				title: "Schools recruiting him",
				cols: ["School", "Interest", "Offer", "Visit", "Note"],
				rows: schools.map((s) => [
					teamInfo[s.tid] ? `${teamInfo[s.tid]!.region}` : abbrevOf(s.tid),
					Math.round(s.i),
					s.o ? "Yes" : "",
					s.v ? "Yes" : "",
					[
						s.tid === userTid ? "Your school" : "",
						s.tid === recruit.commit ? "Committed" : "",
						s.tid === recruit.committed ? "Signed" : "",
					]
						.filter(Boolean)
						.join(", "),
				]),
			});
		}
		out.data.college = {
			stars: recruit.stars,
			rank: recruit.rank,
			posRank: recruit.posRank,
			state: recruit.state,
			season: recruit.season,
			walkOn: recruit.walkOn,
			userTarget: recruit.userTarget,
			committed: recruit.committed,
			commit: recruit.commit,
			scouted: scout,
			wants,
			schools: schools.map((s) => ({
				tid: s.tid,
				school: teamInfo[s.tid]?.region,
				interest: Math.round(s.i),
				offered: !!s.o,
				visited: !!s.v,
				nil: s.tid === userTid ? s.nil : undefined,
			})),
			classYear: p.classYear,
			exit,
		};
	}

	// Pro leagues: his high school recruitment and his path (College/Overseas page)
	const r = info?.recruiting;
	if (r) {
		out.facts.push(
			...fact("High school class", r.classOf),
			...fact("Stars", r.stars !== undefined ? `${r.stars}-star` : undefined),
			...fact(
				"National rank",
				r.nationalRank !== undefined ? `No. ${r.nationalRank}` : "Not ranked",
			),
			...fact(
				"Position rank",
				r.posRank !== undefined
					? `No. ${r.posRank} ${r.pos ?? ""}`.trim()
					: undefined,
			),
			...fact(
				"Composite",
				typeof r.composite === "number" ? r.composite.toFixed(4) : undefined,
			),
			...fact("Offers", r.offerCount),
			...fact("Committed to", r.committed),
			...fact(
				"Signing",
				r.signing
					? r.signing === "early"
						? "Early period"
						: "Late period"
					: undefined,
			),
			...fact("Started at a junior college", r.jucoStart ? "Yes" : undefined),
			...fact("Reclassified from", r.reclassifiedFrom),
		);
		if (r.offers?.length) {
			out.lines.push(`Offers: ${r.offers.join(", ")}`);
		}
		if (r.finalists?.length) {
			out.lines.push(`Finalists: ${r.finalists.join(", ")}`);
		}
		if (r.allStar?.length) {
			out.lines.push(`High school honors: ${r.allStar.join(", ")}`);
		}
		out.data.highSchool = r;
	}
	const seasons: any[] = info?.seasons ?? [];
	const path = seasons.filter((s) => s.season !== undefined);
	if (path.length > 0) {
		out.tables.push({
			section: "Recruiting",
			title: "Path to the pros",
			cols: ["Year", "School or club", "Level", "Class", "GP", "Notes"],
			rows: path.map((s) => [
				s.season,
				s.club ? `${s.club} (${s.teamName})` : s.teamName,
				s.label === "Overseas"
					? `${s.league ?? "Overseas"}${s.tierName ? ` (${s.tierName.toLowerCase()})` : ""}`
					: s.label === "JUCO"
						? "Junior college"
						: s.label === "Prep" ||
							  s.label === "Academy" ||
							  s.label === "Small college"
							? (s.league ?? s.label)
							: (s.conference ?? s.label ?? ""),
				s.classYear ?? "",
				s.gp,
				(s.notes ?? []).join("; "),
			]),
		});
		const overseas = path.filter((s) => s.label === "Overseas");
		if (overseas.length > 0) {
			out.data.overseas = overseas.map((s) => ({
				season: s.season,
				club: s.club,
				league: s.league ?? s.teamName,
				leagueShort: s.leagueShort,
				tier: s.tier,
				gp: s.gp,
				leagueGames: s.leagueGames,
			}));
		}
		out.data.path = path.map((s) => ({
			season: s.season,
			teamName: s.teamName,
			club: s.club,
			label: s.label,
			conference: s.conference,
			league: s.league,
			classYear: s.classYear,
			status: s.status,
			notes: s.notes,
			gp: s.gp,
		}));
	}
	if (info?.story?.title || info?.story?.text) {
		out.lines.push(
			[info.story.title, info.story.text].filter(Boolean).join(": "),
		);
		out.data.story = info.story;
	}
	return isEmpty(out) ? undefined : out;
};

// ---- Playoffs and tournaments ----

export const postseasonSection = async ({
	pRaw,
	p,
	info,
}: {
	pRaw: Player;
	p: any;
	info: any;
}): Promise<Built | undefined> => {
	const out = empty();
	const college = isCollege();

	// Pro playoffs (or a college league's national tournament): his team each season, seed and how far it went
	const stints = careerStints(pRaw);
	const lastTeamOfSeason = new Map<number, number>();
	for (const s of stints) {
		lastTeamOfSeason.set(s.season, s.tid);
	}
	// He played in the playoffs for the team of his playoff row
	for (const row of pRaw.stats) {
		if (row.playoffs && row.tid >= 0) {
			lastTeamOfSeason.set(row.season, row.tid);
		}
	}
	const playoffRows: any[] = (p.stats ?? []).filter((row: any) => row.playoffs);
	const seasonsOut = [];
	let finals = 0;
	let titles = 0;
	for (const [season, tid] of [...lastTeamOfSeason.entries()].sort(
		(a, b) => a[0] - b[0],
	)) {
		const ts = (await idb.merged.teamSeasons.getAll({ tid, season }))[0];
		if (!ts) {
			continue;
		}
		const numRounds = g.get("numGamesPlayoffSeries", season).length;
		if (numRounds === 0) {
			continue;
		}
		// The current season before the playoffs are decided: nothing to say yet
		if (
			season === g.get("season") &&
			g.get("phase") < PHASE.PLAYOFFS &&
			ts.playoffRoundsWon < 0
		) {
			continue;
		}
		const series = await idb.merged.playoffSeries.get(season);
		let seed: number | undefined;
		for (const round of series?.series ?? []) {
			for (const m of round) {
				if (m.home?.tid === tid) {
					seed = m.home.seed;
				} else if (m.away?.tid === tid) {
					seed = m.away.seed;
				}
			}
			if (seed !== undefined) {
				break;
			}
		}
		const result = getRoundsWonText(ts, await getPlayoffsByConf(season));
		const inFinals = ts.playoffRoundsWon >= numRounds - 1;
		const won = ts.playoffRoundsWon >= numRounds;
		if (inFinals) {
			finals += 1;
		}
		if (won) {
			titles += 1;
		}
		const row = playoffRows.find(
			(r: any) => r.season === season && (r.tid === tid || r.tid === undefined),
		);
		seasonsOut.push({
			season,
			tid,
			abbrev: abbrevOf(tid),
			record: `${ts.won}-${ts.lost}${ts.tied ? `-${ts.tied}` : ""}${ts.otl ? `-${ts.otl}` : ""}`,
			seed,
			playoffRoundsWon: ts.playoffRoundsWon,
			numRounds,
			result: result ? helpers.upperCaseFirstLetter(result) : "Missed playoffs",
			finals: inFinals,
			champion: won,
			stats: row
				? { gp: row.gp, min: row.min, pts: row.pts, trb: row.trb, ast: row.ast }
				: undefined,
		});
	}
	if (seasonsOut.length > 0) {
		out.facts.push(
			...fact(
				college ? "Tournament appearances" : "Playoff appearances",
				seasonsOut.filter((s) => s.playoffRoundsWon >= 0).length,
			),
			...fact(college ? "Title games" : "Finals", finals || undefined),
			...fact("Titles", titles || undefined),
		);
		out.tables.push({
			section: "Postseason",
			title: college ? "Postseason by season" : "Playoffs by season",
			cols: [
				"Year",
				"Team",
				"Record",
				"Seed",
				"GP",
				"PTS",
				"TRB",
				"AST",
				"Result",
			],
			rows: seasonsOut.map((s) => [
				s.season,
				s.abbrev,
				s.record,
				s.seed ?? "",
				cell(s.stats?.gp),
				cell(s.stats?.pts),
				cell(s.stats?.trb),
				cell(s.stats?.ast),
				s.result,
			]),
		});
		out.data.playoffs = seasonsOut;
	}

	// College leagues: NIT games
	if (college && (pRaw.nitStats?.length ?? 0) > 0) {
		const nit = pRaw.nitStats!.filter((row) => (row.gp ?? 0) > 0);
		if (nit.length > 0) {
			out.tables.push({
				section: "Postseason",
				title: "NIT",
				cols: ["Year", "Team", "GP", "MIN", "PTS", "TRB", "AST"],
				rows: nit.map((row: any) => [
					row.season,
					abbrevOf(row.tid),
					row.gp,
					cell(row.min),
					cell(row.pts),
					cell((row.orb ?? 0) + (row.drb ?? 0)),
					cell(row.ast),
				]),
			});
			out.data.nit = nit.map((row: any) => ({
				season: row.season,
				tid: row.tid,
				gp: row.gp,
				min: row.min,
				pts: row.pts,
				trb: (row.orb ?? 0) + (row.drb ?? 0),
				ast: row.ast,
			}));
		}
	}

	// Pro leagues: his college tournaments (College Season setting), from the College/Overseas page
	const preSeasons: any[] = (info?.seasons ?? []).filter((s: any) => s.ncaa);
	const summary = info?.summary;
	if (preSeasons.length > 0 || summary) {
		const rows = preSeasons.map((s: any) => ({
			season: s.season,
			school: s.teamName,
			conference: s.conference,
			record: s.record ? `${s.record.w}-${s.record.l}` : "",
			apRank: s.apRank,
			result: s.ncaa,
			...(summary && summary.season === s.season
				? {
						confTourney: summary.confTourney,
						ncaaSeed: summary.ncaaSeed,
						region: summary.region,
						ncaa: summary.ncaa,
						nitSeed: summary.nitSeed,
						nit: summary.nit,
					}
				: {}),
		}));
		if (summary && !rows.some((r) => r.season === summary.season)) {
			rows.push({
				season: summary.season,
				school: summary.school,
				conference: summary.conf,
				record: `${summary.w}-${summary.l}`,
				apRank: summary.apRank,
				result: summary.ncaa ?? summary.nit ?? "",
				confTourney: summary.confTourney,
				ncaaSeed: summary.ncaaSeed,
				region: summary.region,
				ncaa: summary.ncaa,
				nitSeed: summary.nitSeed,
				nit: summary.nit,
			});
		}
		rows.sort((a, b) => a.season - b.season);
		out.tables.push({
			section: "Postseason",
			title: "College tournaments",
			cols: [
				"Year",
				"School",
				"Record",
				"AP",
				"Conf. tournament",
				"Region",
				"Result",
			],
			rows: rows.map((r) => [
				r.season,
				r.school,
				r.record,
				r.apRank ?? "",
				r.confTourney ?? "",
				r.region ?? "",
				r.result ?? "",
			]),
		});
		out.data.collegeTournaments = rows;
		if (summary?.games?.length > 0) {
			out.tables.push({
				section: "Postseason",
				title: `${summary.season} postseason games`,
				cols: [
					"Event",
					"Round",
					"Opponent",
					"Score",
					"MIN",
					"PTS",
					"TRB",
					"AST",
					"FG",
					"3P",
					"FT",
				],
				rows: summary.games.map((gm: any) => [
					gm.event === "ncaa"
						? "NCAA"
						: gm.event === "nit"
							? "NIT"
							: "Conference",
					gm.round,
					`${gm.oppSeed !== undefined ? `(${gm.oppSeed}) ` : ""}${gm.opp}`,
					`${gm.won ? "W" : "L"} ${gm.tm}-${gm.oppScore}${gm.ot ? ` (${gm.ot}OT)` : ""}`,
					gm.min,
					gm.pts,
					gm.trb,
					gm.ast,
					`${gm.fg}-${gm.fga}`,
					`${gm.tp}-${gm.tpa}`,
					`${gm.ft}-${gm.fta}`,
				]),
			});
			out.data.collegePostseasonGames = summary.games;
		}
		const splits: any[] = info?.splits ?? [];
		if (splits.length > 0) {
			const per = (line: any, key: string) =>
				line.gp > 0 ? Math.round((10 * line[key]) / line.gp) / 10 : "";
			out.tables.push({
				section: "Postseason",
				title: `${summary?.season ?? ""} splits`.trim(),
				cols: [
					"Split",
					"Record",
					"GP",
					"MIN",
					"PTS",
					"TRB",
					"AST",
					"FG%",
					"3P%",
				],
				rows: splits.map((s) => [
					`${s.name}${s.estimated ? " (est.)" : ""}`,
					s.record ? `${s.record[0]}-${s.record[1]}` : "",
					s.line.gp,
					per(s.line, "min"),
					per(s.line, "pts"),
					s.line.gp > 0
						? Math.round((10 * (s.line.orb + s.line.drb)) / s.line.gp) / 10
						: "",
					per(s.line, "ast"),
					s.line.fga > 0 ? cell((100 * s.line.fg) / s.line.fga) : "",
					s.line.tpa > 0 ? cell((100 * s.line.tp) / s.line.tpa) : "",
				]),
			});
			out.data.splits = splits;
		}
	}
	return isEmpty(out) ? undefined : out;
};

// ---- Coaches ----

export const coachesSection = async ({
	pRaw,
	info,
	showRatings,
}: {
	pRaw: Player;
	info: any;
	showRatings: boolean;
}): Promise<Built | undefined> => {
	const out = empty();
	const staffOn = staffViewEnabled();
	const coaches: Coach[] = staffOn ? await idb.cache.coaches.getAll() : [];

	if (staffOn) {
		const bySeasonTid = new Map<string, { c: Coach; row: any }[]>();
		for (const c of coaches) {
			for (const row of c.stats ?? []) {
				const key = `${row.season}|${row.tid}`;
				const list = bySeasonTid.get(key) ?? [];
				list.push({ c, row });
				bySeasonTid.set(key, list);
			}
		}
		const name = (c: Coach) => `${c.firstName} ${c.lastName}`;
		const rows = careerStints(pRaw).map(({ season, tid }) => {
			const list = bySeasonTid.get(`${season}|${tid}`) ?? [];
			const heads = list.filter((x) => x.row.role === "head");
			const devs = list.filter((x) => x.row.role === "dev");
			return {
				season,
				tid,
				abbrev: abbrevOf(tid),
				head: heads.map((x) => ({
					cid: x.c.cid,
					name: name(x.c),
					won: x.row.won,
					lost: x.row.lost,
					off: x.row.off,
					def: x.row.def,
				})),
				dev: devs.map((x) => ({ cid: x.c.cid, name: name(x.c) })),
				staff: list
					.filter((x) => x.row.role !== "head" && x.row.role !== "dev")
					.map((x) => ({
						cid: x.c.cid,
						name: name(x.c),
						role: COACH_ROLE_NAMES[x.row.role as keyof typeof COACH_ROLE_NAMES],
					})),
			};
		});
		if (rows.some((r) => r.head.length > 0 || r.dev.length > 0)) {
			out.tables.push({
				section: "Coaches",
				title: "Coaches by season",
				cols: [
					"Year",
					"Team",
					"Head coach",
					"Development coach",
					"Other staff",
				],
				rows: rows.map((r) => [
					r.season,
					r.abbrev,
					r.head.map((h) => `${h.name} (${h.won}-${h.lost})`).join(", "),
					r.dev.map((d) => d.name).join(", "),
					r.staff.map((s) => `${s.name} (${s.role})`).join(", "),
				]),
			});
		}
		out.data.bySeason = rows;

		// Coaching Systems: how he fits his head coach's systems now, from his scouted ratings
		if (
			coachSystemsEnabled() &&
			showRatings &&
			pRaw.tid >= 0 &&
			pRaw.ratings.length > 0
		) {
			const head = coaches.find((c) => c.tid === pRaw.tid && c.role === "head");
			if (head) {
				const r = pRaw.ratings.at(-1)! as any;
				const fuzzed = { ...r };
				for (const key of Object.keys(r)) {
					if (
						typeof r[key] === "number" &&
						key !== "hgt" &&
						key !== "season" &&
						key !== "fuzz"
					) {
						fuzzed[key] = player.fuzzRating(r[key], r.fuzz ?? 0);
					}
				}
				const profile = getCoachProfile(head);
				const fit = playerSystemFit({ ratings: [fuzzed] } as any, profile);
				out.facts.push(
					...fact("Head coach now", `${head.firstName} ${head.lastName}`),
					...fact(
						"Fit with his systems",
						`${Math.round(fit.score)} (50 is typical)`,
					),
				);
				out.data.systemFit = {
					coach: `${head.firstName} ${head.lastName}`,
					offense: profile.off,
					defense: profile.def,
					score: Math.round(fit.score),
				};
			}
		}

		// He became a coach (Coaching Staff Depth: ex-player assistants)
		const self = coaches.find((c) => c.tree?.exPlayer === pRaw.pid);
		if (self) {
			const record = (self.stats ?? []).reduce(
				(acc, row) => ({ w: acc.w + row.won, l: acc.l + row.lost }),
				{ w: 0, l: 0 },
			);
			out.facts.push(
				...fact("Coaching career", COACH_ROLE_NAMES[self.role]),
				...fact(
					"Coaching now",
					self.tid >= 0
						? teamName(self.tid)
						: self.retiredYear
							? `Retired ${self.retiredYear}`
							: "Free agent",
				),
				...fact(
					"Coaching record",
					record.w + record.l > 0 ? `${record.w}-${record.l}` : undefined,
				),
			);
			if ((self.stats ?? []).length > 0) {
				out.tables.push({
					section: "Coaches",
					title: "His coaching record",
					cols: ["Year", "Team", "Role", "W", "L", "Playoff rounds won"],
					rows: self.stats.map((row) => [
						row.season,
						abbrevOf(row.tid),
						COACH_ROLE_NAMES[row.role],
						row.won,
						row.lost,
						row.playoffRoundsWon >= 0 ? row.playoffRoundsWon : "",
					]),
				});
			}
			if ((self.awards ?? []).length > 0) {
				out.lines.push(
					`Coaching awards: ${self.awards.map((a) => `${a.season} ${a.type}`).join(", ")}`,
				);
			}
			out.data.coachingCareer = {
				cid: self.cid,
				role: self.role,
				tid: self.tid,
				retiredYear: self.retiredYear,
				stats: self.stats,
				awards: self.awards,
				transactions: self.transactions,
			};
		}
	}

	// College or overseas coaches (College/Overseas page)
	const pre: any[] = (info?.seasons ?? []).filter((s: any) => s.coach);
	if (pre.length > 0) {
		out.tables.push({
			section: "Coaches",
			title: "College and overseas coaches",
			cols: ["Year", "School or club", "Head coach", "Since"],
			rows: pre.map((s) => [
				s.season,
				s.club ? `${s.club} (${s.teamName})` : s.teamName,
				s.coach.name,
				s.coach.since,
			]),
		});
		out.data.preDraft = pre.map((s) => ({
			season: s.season,
			school: s.teamName,
			club: s.club,
			coach: s.coach,
		}));
	}
	return isEmpty(out) ? undefined : out;
};

// ---- Awards: grouped counts, finishes, votes, this season's races ----

export const awardsExtras = async (pRaw: Player): Promise<Built> => {
	const out = empty();
	const pid = pRaw.pid;

	// Grouped like the page's award summary (All-Star x5, ...)
	const groups = new Map<string, number[]>();
	for (const a of pRaw.awards ?? []) {
		const type = formatPlayerAwardName(a as any, {
			groupPrefix:
				(a as any).type === undefined ? (a as any).groupPrefix : undefined,
			includeIndividualRank: true,
		});
		const list = groups.get(type) ?? [];
		list.push(a.season);
		groups.set(type, list);
	}
	const grouped = [...groups.entries()]
		.map(([type, seasons]) => ({ type, count: seasons.length, seasons }))
		.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
	if (grouped.length > 0) {
		out.tables.push({
			section: "Awards",
			title: "Awards by type",
			cols: ["Times", "Seasons", "Award"],
			rows: grouped.map((x) => [x.count, x.seasons.join(", "), x.type]),
		});
	}
	out.data.byType = grouped;

	// Finishes in the stored awards (the top players of each individual award, every season he played)
	const seasons = new Set(
		pRaw.stats.filter((row) => !row.playoffs).map((row) => row.season),
	);
	const finishes: {
		season: number;
		award: string;
		place: number;
		team?: boolean;
	}[] = [];
	const votes = [];
	const voteOn = __SPORT === "basketball" && featureOn("awardVote");
	for (const season of [...seasons].sort((a, b) => a - b)) {
		const doc: any = await idb.merged.awards.get(season);
		if (!doc) {
			continue;
		}
		for (const award of doc.awards ?? []) {
			if (award.numTeams === undefined && Array.isArray(award.winner)) {
				const i = award.winner.findIndex((w: any) => w?.pid === pid);
				if (i >= 0) {
					finishes.push({ season, award: award.name, place: i + 1 });
				}
			} else if (Array.isArray(award.winner)) {
				award.winner.forEach((team: any[], i: number) => {
					if (Array.isArray(team) && team.some((w) => w?.pid === pid)) {
						finishes.push({
							season,
							award: award.name,
							place: i + 1,
							team: true,
						});
					}
				});
			}
		}
		if (voteOn) {
			for (const vote of doc.simVote ?? []) {
				const row = vote.rows?.find((r: any) => r.pid === pid);
				if (row) {
					votes.push({
						season,
						award: vote.name,
						rank: row.rank,
						pts: row.pts,
						first: row.first,
						share: row.share,
						votes: row.votes,
						tm: row.tm,
					});
				}
			}
		}
	}
	if (finishes.length > 0) {
		out.tables.push({
			section: "Awards",
			title: "Award finishes",
			cols: ["Year", "Award", "Finish"],
			rows: finishes.map((f) => [
				f.season,
				f.award,
				f.team ? `${ordinal(f.place)} team` : ordinal(f.place),
			]),
		});
	}
	out.data.finishes = finishes;
	if (votes.length > 0) {
		out.tables.push({
			section: "Awards",
			title: "Award votes",
			cols: ["Year", "Award", "Place", "Points", "1st-place votes", "Share"],
			rows: votes.map((v) => [
				v.season,
				v.award,
				v.tm ? `${ordinal(v.tm)} team` : ordinal(v.rank),
				v.pts,
				v.first,
				`${Math.round(1000 * v.share) / 10}%`,
			]),
		});
		out.data.votes = votes;
	}

	// This season's races (Award Races page), while the regular season is on
	const phase = g.get("phase");
	if (
		pRaw.tid >= 0 &&
		(phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE)
	) {
		try {
			const season = g.get("season");
			const { awardCandidates } = await getAwardCandidates(season);
			const races = [];
			for (const award of awardCandidates.flat()) {
				const i = award.players.findIndex((x: any) => x.pid === pid);
				if (i >= 0) {
					races.push({
						award:
							award.rank !== undefined
								? `${award.name}, ${ordinal(award.rank)} team`
								: award.name,
						place: award.rank !== undefined ? undefined : i + 1,
					});
				}
			}
			if (races.length > 0) {
				out.tables.push({
					section: "Awards",
					title: `${season} award races`,
					cols: ["Award", "Place now"],
					rows: races.map((r) => [
						r.award,
						r.place !== undefined ? ordinal(r.place) : "On the team",
					]),
				});
				out.data.racesNow = { season, races };
			}
		} catch (error) {
			// The races page can't be built in some leagues (no games yet): leave the races out
			console.warn(error);
		}
	}
	return out;
};

// ---- Contract panel and mood history ----

export const contractExtras = async (pid: number): Promise<Built> => {
	const out = empty();
	const panel = await getPlayerContractPanel(pid);
	if (!panel) {
		return out;
	}
	const c = panel.contract;
	if (c) {
		out.facts.push(
			...fact("Contract type", c.type),
			...fact(
				"Option",
				c.option ? `${c.option.type} option, ${c.option.season}` : undefined,
			),
			...fact(
				"Release cost",
				c.releaseCost !== undefined
					? `${money(c.releaseCost.owed)} owed`
					: undefined,
			),
		);
		out.tables.push({
			section: "Contract",
			title: "Contract by season",
			cols: ["Season", "Amount", "Guaranteed", "Option"],
			rows: c.seasons.map((s: any) => [
				s.season,
				money(s.amount),
				money(s.guaranteed),
				s.option ? `${s.option.type} option` : "",
			]),
		});
	}
	if (panel.extension) {
		out.facts.push(
			...fact(
				"Extension",
				panel.extension.reason ??
					(panel.extension.demand
						? `Asks ${money(panel.extension.demand.amount)}/yr thru ${panel.extension.demand.exp}`
						: undefined),
			),
		);
	}
	if (panel.tradeRequest) {
		out.facts.push(...fact("Trade request", "Active"));
	}
	if (panel.holdout) {
		out.facts.push(...fact("Holdout", "Holding out"));
	}
	if (panel.moodHistory.length > 0) {
		out.tables.push({
			section: "Contract",
			title: "Mood history",
			cols: ["Season", "Phase", "Team", "Mood", "Chance to re-sign"],
			rows: panel.moodHistory.map((m) => [
				m.season,
				helpers.upperCaseFirstLetter(
					(PHASE_TEXT as Record<number, string>)[m.phase] ?? String(m.phase),
				),
				abbrevOf(m.tid),
				m.sum,
				pct(m.probWilling),
			]),
		});
	}
	if (panel.scenarios.length > 0) {
		out.tables.push({
			section: "Contract",
			title: "What would change his mood",
			cols: ["Scenario", "Mood", "Chance he'd sign"],
			rows: panel.scenarios.map((s) => [s.label, s.sum, pct(s.probWilling)]),
		});
	}
	out.data.panel = {
		contract: panel.contract,
		extension: panel.extension,
		tradeRequest: panel.tradeRequest,
		holdout: panel.holdout,
		moodHistory: panel.moodHistory,
		scenarios: panel.scenarios,
		settings: panel.settings,
	};
	return out;
};

// ---- News: every event about him ----

export const newsTable = async (
	pRaw: Player,
): Promise<{ table?: ExportTable; data: unknown[] }> => {
	const events = (await idb.merged.events.getAll({ pid: pRaw.pid })).sort(
		(a, b) => (a.eid ?? 0) - (b.eid ?? 0),
	);
	const data = [];
	for (const event of events) {
		if (event.type === undefined) {
			continue;
		}
		const text = await formatEventText(event);
		data.push({
			season: event.season,
			type: event.type,
			text: String(text ?? "")
				.replaceAll(/<[^>]*>/g, "")
				.replaceAll("&amp;", "&")
				.replaceAll(/\s+/g, " ")
				.trim(),
		});
	}
	return {
		data,
		table:
			data.length > 0
				? {
						section: "News",
						title: "All news",
						cols: ["Year", "Type", "News"],
						rows: data.map((x) => [x.season, x.type, x.text]),
					}
				: undefined,
	};
};

// ---- Legacy: Hall of Fame, GOAT Lab, rivalry lines, face history ----

let goatCache:
	| { key: string; values: { pid: number; value: number }[] }
	| undefined;

const goatValues = async () => {
	const formula = g.get("goatFormula") ?? goatFormula.DEFAULT_FORMULA;
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${formula}`;
	if (goatCache?.key === key) {
		return goatCache.values;
	}
	const values: { pid: number; value: number }[] = [];
	for await (const { value: pRaw } of idb.league
		.transaction("players")
		.store.index("draft.year, retiredYear")
		.iterate(IDBKeyRange.bound([-Infinity], [g.get("season") - 1, Infinity]))) {
		try {
			values.push({
				pid: pRaw.pid,
				value: goatFormula.evaluate(withoutPreDraft(pRaw), undefined, {
					type: "career",
				}),
			});
		} catch {}
	}
	goatCache = { key, values };
	return values;
};

export const legacySection = async ({
	pRaw,
	faceHistory,
}: {
	pRaw: Player;
	faceHistory: { entries: any[]; prime?: any } | undefined;
}): Promise<Built | undefined> => {
	const out = empty();
	const pid = pRaw.pid;

	// Hall of Fame plaque and speech (the Hall of Fame pages)
	if (pRaw.hof && hofWordsOn()) {
		// Stored on him at induction (written once here for older inductees)
		const story = (
			await getHofStories([pRaw], () =>
				idb.merged.players.getAll({ hof: true }),
			)
		).get(pid)!;
		const prime = featureOn("faceAging") ? await primeFace(pRaw) : undefined;
		const words = {
			plaque: await plaqueWithPrime(
				story,
				prime
					? {
							season: prime.season,
							tid: (pRaw.stats as any[]).findLast(
								(row) => row.season === prime.season && row.tid >= 0,
							)?.tid,
						}
					: undefined,
			),
			speech: story.speech,
		};
		const inducted = pRaw.awards.find(
			(a) => a.type === "Inducted into the Hall of Fame",
		)?.season;
		out.facts.push(
			...fact("Hall of Fame", inducted ? `Inducted ${inducted}` : "Yes"),
		);
		out.lines.push(
			`Plaque: ${words.plaque}`,
			"Induction speech:",
			...words.speech,
		);
		out.data.hallOfFame = {
			inducted,
			plaque: words.plaque,
			speech: words.speech,
		};
	} else if (pRaw.hof) {
		out.facts.push(...fact("Hall of Fame", "Yes"));
		out.data.hallOfFame = { inducted: true };
	}

	// GOAT Lab: his career score with the league's formula and where it ranks among every player (stats and awards, no ratings)
	try {
		const mine = goatFormula.evaluate(withoutPreDraft(pRaw), undefined, {
			type: "career",
		});
		const others = (await goatValues()).filter((x) => x.pid !== pid);
		const rank = others.filter((x) => x.value > mine).length + 1;
		let bestSeason: { season: number; value: number } | undefined;
		for (const season of new Set(
			pRaw.stats.filter((row) => !row.playoffs).map((row) => row.season),
		)) {
			try {
				const value = goatFormula.evaluate(withoutPreDraft(pRaw), undefined, {
					type: "season",
					season,
				});
				if (!bestSeason || value > bestSeason.value) {
					bestSeason = { season, value };
				}
			} catch {}
		}
		if (mine !== 0 || bestSeason) {
			out.facts.push(
				...fact("GOAT Lab score", cell(mine)),
				...fact("GOAT Lab rank", `${ordinal(rank)} of ${others.length + 1}`),
				...fact(
					"Best GOAT season",
					bestSeason
						? `${bestSeason.season} (${cell(bestSeason.value)})`
						: undefined,
				),
			);
			out.data.goat = {
				score: mine,
				rank,
				of: others.length + 1,
				formula: g.get("goatFormula") ?? goatFormula.DEFAULT_FORMULA,
				bestSeason,
			};
		}
	} catch {}

	// Rivalry lines (Rivalries + Rivalry Stories): his games in his teams' rivalries
	if (featureOn("rivalries") && rivalryStoriesOn()) {
		const tids = new Set(careerStints(pRaw).map((s) => s.tid));
		if (tids.size > 0) {
			const pairs = (
				await loadRivalries(g.get("season"), { storedGames: false })
			).filter(
				(pair) =>
					(tids.has(pair.a) || tids.has(pair.b)) && pair.score.tier !== "None",
			);
			const lines = [];
			for (const pair of pairs) {
				const games = (await pairGames(pair.a, pair.b)).filter((gm) =>
					gm.players.some((x) => x.pid === pid),
				);
				if (games.length === 0) {
					continue;
				}
				let w = 0;
				let pts = 0;
				let trb = 0;
				let ast = 0;
				let best: { pts: number; season: number } | undefined;
				const forTeams = new Set<number>();
				for (const gm of games) {
					const me = gm.players.find((x) => x.pid === pid)!;
					forTeams.add(me.tid);
					const home = gm.home === me.tid;
					const mine = home ? gm.hPts : gm.aPts;
					const theirs = home ? gm.aPts : gm.hPts;
					if (mine > theirs) {
						w += 1;
					}
					pts += me.pts;
					trb += me.trb;
					ast += me.ast;
					if (!best || me.pts > best.pts) {
						best = { pts: me.pts, season: gm.season };
					}
				}
				const n = games.length;
				lines.push({
					pair: `${abbrevOf(pair.a)}-${abbrevOf(pair.b)}`,
					tier: pair.score.tier,
					for: [...forTeams].map(abbrevOf),
					games: n,
					won: w,
					lost: n - w,
					pts: Math.round((10 * pts) / n) / 10,
					trb: Math.round((10 * trb) / n) / 10,
					ast: Math.round((10 * ast) / n) / 10,
					playoffGames: games.filter((gm) => gm.playoffs).length,
					best,
				});
			}
			// Hottest rivalries first, then the ones he played most
			const HEAT = ["Bitter", "Heated", "Simmering", "Mild"];
			lines.sort(
				(x, y) =>
					HEAT.indexOf(x.tier) - HEAT.indexOf(y.tier) || y.games - x.games,
			);
			if (lines.length > 0) {
				out.tables.push({
					section: "Legacy",
					title: "Rivalry games",
					cols: [
						"Rivalry",
						"Heat",
						"For",
						"GP",
						"W-L",
						"PTS",
						"TRB",
						"AST",
						"Playoff GP",
						"Best game",
					],
					rows: lines.map((l) => [
						l.pair,
						l.tier,
						l.for.join(", "),
						l.games,
						`${l.won}-${l.lost}`,
						l.pts,
						l.trb,
						l.ast,
						l.playoffGames,
						l.best ? `${l.best.pts} pts (${l.best.season})` : "",
					]),
				});
				out.data.rivalries = lines;
			}
		}
	}

	// Face Aging: then and now (the faces are in the JSON; the PDF draws them)
	if (featureOn("faceAging") && faceHistory && faceHistory.entries.length > 0) {
		const entries = [
			...faceHistory.entries,
			...(faceHistory.prime ? [{ ...faceHistory.prime, label: "prime" }] : []),
		];
		out.tables.push({
			section: "Legacy",
			title: "Face history",
			cols: ["Season", "Age", "Note"],
			rows: entries.map((e) => [
				e.season,
				e.season - pRaw.born.year,
				e.label === "prime"
					? "His prime"
					: e.label
						? helpers.upperCaseFirstLetter(String(e.label))
						: "",
			]),
		});
		out.data.faceHistory = entries.map((e) => ({
			season: e.season,
			label: e.label,
			face: e.face,
			colors: e.colors,
			jersey: e.jersey,
		}));
	}
	return isEmpty(out) ? undefined : out;
};

// ---- College/Overseas page: what the section left to its data (seasons, stock, comparisons, story, report, combine) ----

const COMBINE_NAMES: Record<string, string> = {
	heightNoShoes: "Height (no shoes)",
	heightShoes: "Height (shoes)",
	wingspan: "Wingspan",
	standingReach: "Standing reach",
	weight: "Weight",
	bodyFat: "Body fat",
	handLength: "Hand length",
	handWidth: "Hand width",
	laneAgility: "Lane agility",
	shuttle: "Shuttle run",
	sprint: "Three-quarter sprint",
	standingVert: "Standing vertical",
	maxVert: "Max vertical",
	bench: "Bench press",
	spotUp: "Spot-up shooting",
	offDribble: "Off-the-dribble shooting",
	freeThrows: "Free throws",
};

export const preDraftExtras = (
	info: any,
	view: any,
	showRatings: boolean,
): Built => {
	const out = empty();
	const seasons: any[] = info.seasons ?? [];
	if (seasons.length > 0) {
		out.tables.push({
			section: "College/Overseas",
			title: "Season by season",
			cols: [
				"Year",
				"School or club",
				"Class",
				"Conf.",
				"Coach",
				"Record",
				"AP",
				"Conf. rank",
				"Postseason",
				"Notes",
			],
			rows: seasons.map((s) => [
				s.season,
				s.club ? `${s.club} (${s.teamName})` : s.teamName,
				s.classYear ?? "",
				s.conference ?? s.leagueShort ?? "",
				s.coach?.name ?? "",
				s.record
					? `${s.record.w}-${s.record.l}${s.record.estimated ? " (est.)" : ""}`
					: "",
				s.apRank ?? "",
				s.confRank ? `${s.confRank.rank} of ${s.confRank.size}` : "",
				s.ncaa ?? "",
				(s.notes ?? []).join("; "),
			]),
		});
	}
	const stock: any[] = info.stock ?? [];
	if (stock.length > 0) {
		out.tables.push({
			section: "College/Overseas",
			title: "Draft stock",
			cols: ["When", "Year", "Projected pick"],
			rows: stock.map((x) => [
				x.label,
				x.season,
				x.pick === undefined ? "Not projected" : x.pick,
			]),
		});
	}
	const comps: any[] = info.comps ?? [];
	if (comps.length > 0) {
		out.tables.push({
			section: "College/Overseas",
			title: "Similar prospects",
			cols: [
				"Name",
				"Draft",
				"Pick",
				"School",
				"Similarity",
				...(showRatings ? ["Ovr at draft", "Peak ovr"] : []),
				"Pro seasons",
				"Career PTS",
				"All-Star",
			],
			rows: comps.map((c) => [
				c.name,
				c.draftYear,
				c.pick ?? "Undrafted",
				c.school,
				`${c.similarity}%`,
				...(showRatings ? [c.ovrAtDraft ?? "", c.peakOvr ?? ""] : []),
				c.proSeasons,
				cell(c.career?.pts),
				c.allStar || "",
			]),
		});
	}
	const report = info.scoutingReport;
	if (report) {
		out.lines.push(`Scouting report: ${report.summary}`);
		if (report.strengths?.length) {
			out.lines.push(`Strengths: ${report.strengths.join("; ")}`);
		}
		if (report.weaknesses?.length) {
			out.lines.push(`Weaknesses: ${report.weaknesses.join("; ")}`);
		}
		if (report.projection) {
			out.lines.push(`Projection: ${report.projection}`);
		}
		if (report.basis) {
			out.lines.push(`Based on: ${report.basis}`);
		}
	}
	if (info.story?.title || info.story?.text) {
		out.lines.push(
			[info.story.title, info.story.text].filter(Boolean).join(": "),
		);
	}
	const notes = info.scoutNotes;
	if (notes) {
		out.facts.push(
			...fact("Scouting confidence", notes.confidence),
			...fact(
				"Scouted ovr range",
				showRatings && notes.ovr
					? `${notes.ovr[0]}-${notes.ovr[1]}`
					: undefined,
			),
			...fact(
				"Scouted pot range",
				showRatings && notes.pot
					? `${notes.pot[0]}-${notes.pot[1]}`
					: undefined,
			),
			...fact("Scouting looks", notes.numScouts),
		);
		for (const note of notes.notes ?? []) {
			out.lines.push(`Scout note: ${note}`);
		}
	}
	// Draft Lottery Night & Combine: his combine (measurements, drills, his rank in the class)
	const combine = view?.draftCombine;
	if (combine) {
		if (!combine.invited) {
			out.lines.push(`Not invited to the ${combine.season} combine.`);
		} else {
			const result = combine.result ?? {};
			const ranks = combine.ranks ?? {};
			const rows = [
				...Object.entries(result.measurements ?? {}),
				...Object.entries(result.drills ?? {}),
			].map(([key, value]) => [
				COMBINE_NAMES[key] ?? key,
				cell(value),
				ranks[key] !== undefined ? `${ranks[key]} of ${combine.n}` : "",
			]);
			if (result.skipped) {
				out.lines.push(`Combine drills skipped (${result.skipped}).`);
			}
			if (rows.length > 0) {
				out.tables.push({
					section: "College/Overseas",
					title: `${combine.season} draft combine`,
					cols: ["Test", "Result", "Rank in class"],
					rows,
				});
			}
		}
		// Without performance: it is measured against his true ratings
		out.data.draftCombine = combine.invited
			? {
					season: combine.season,
					invited: true,
					measurements: combine.result?.measurements,
					drills: combine.result?.drills,
					skipped: combine.result?.skipped,
					ranks: combine.ranks,
					n: combine.n,
				}
			: { season: combine.season, invited: false, n: combine.n };
	}
	return out;
};
