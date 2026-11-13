// Newspaper engine: turns NewsFacts into a laid-out Paper. Pure and deterministic: the same facts always give the same paper.

import { leadChampion } from "./champ.ts";
import { Ctx, finishArticle } from "./ctx.ts";
import {
	breakoutFeature,
	bestRecordFeature,
	featFeature,
	mvpFeature,
	topPickFeature,
	tradeFeature,
} from "./features.ts";
import { leadMidseason, leadPlayoffs, leadPreseason } from "./front.ts";
import { PAGES, type PageDef, type SectionId } from "./kit.ts";
import "./pages-rank.ts";
import "./pages-league.ts";
import "./pages-players.ts";
import "./pages-history.ts";
import "./pages-money.ts";
import "./pages-playoffs.ts";
import "./pages-colour.ts";
import "./pages-deals.ts";
import "./pages-coaching.ts";
import { playInSidebar } from "./pages-league.ts";
import { draftPreviewPage } from "./pages-scouting.ts";
import { varyPaper } from "./vary.ts";
import {
	allLeagueBlock,
	awardRace,
	awardStory,
	bestGamesStory,
	bracketSidebar,
	breakoutStory,
	closeGamesStory,
	declineStory,
	draftStory,
	finalsMvpStory,
	injuryStory,
	leaderTables,
	leadersSidebar,
	numbersSidebar,
	opinionColumn,
	retireStories,
	rookieStory,
	rumorSidebar,
	seriesRecaps,
	signingsStory,
	standingsSidebar,
	surpriseStory,
	teamStatsTable,
	tradeStories,
} from "./sections.ts";
import {
	teamBackIssues,
	teamFranchise,
	teamGames,
	teamInjuries,
	teamLead,
	teamLetter,
	teamPlayerFeatures,
	teamPlayoffPath,
	teamRanks,
	teamRecordBook,
	teamRookies,
	teamRoster,
} from "./team.ts";
import { Rng, hashString, segsText } from "./text.ts";
import type {
	Article,
	EditionId,
	NewsFacts,
	Paper,
	Section,
	Seg,
	Sidebar,
} from "./types.ts";

export type * from "./types.ts";

const PAPER_NOUNS = [
	"Journal",
	"Post",
	"Times",
	"Beacon",
	"Mirror",
	"Sun",
	"Inquirer",
	"Gazette",
	"Herald",
	"Courier",
	"Ledger",
	"Tribune",
	"Sentinel",
	"Dispatch",
	"Chronicle",
	"Clarion",
	"Register",
	"Examiner",
	"Observer",
	"Telegraph",
];
const MOTTOS = [
	"All the box scores fit to print",
	"Covering the league since tip-off",
	"Ink, hardwood and the truth",
	"The paper of record for every possession",
	"Late edition, final score",
	"No timeouts, no retractions",
	"Box scores before breakfast",
	"We cover the bench, too",
	"From the cheap seats to the front office",
];

export const paperIdentity = (facts: NewsFacts, tid?: number) => {
	const r = new Rng(`${facts.seedKey}|masthead|${tid ?? ""}`);
	const a = r.pick(PAPER_NOUNS);
	const lg = facts.leagueName || "League";
	if (tid !== undefined) {
		const t = facts.teams.find((x) => x.tid === tid);
		const city = t?.region ?? lg;
		return {
			name: r.pick([
				`The ${city} ${a}`,
				`${city} Daily ${a}`,
				`The ${city} Evening ${a}`,
			]),
			motto: `Home of the ${t?.name ?? "team"} · ${r.pick(MOTTOS)}`,
		};
	}
	return {
		name: r.pick([
			`The ${lg} ${a}`,
			`The Daily ${a}`,
			`The Hardwood ${a}`,
			`The Morning ${a}`,
			`The Courtside ${a}`,
			`The Baseline ${a}`,
		]),
		motto: r.pick(MOTTOS),
	};
};

const MONTHS = [
	"November",
	"December",
	"January",
	"February",
	"March",
	"April",
];

export const editionInfo = (
	facts: NewsFacts,
): { label: string; dateline: string } => {
	const ed: EditionId = facts.edition;
	const s = facts.season;
	if (ed === "final") {
		return { label: "Final edition", dateline: `June ${s}` };
	}
	if (ed === "playoffs") {
		return { label: "Playoff edition", dateline: `May ${s}` };
	}
	if (ed === "preseason") {
		return { label: "Season preview", dateline: `October ${s - 1}` };
	}
	const f = Math.min(0.999, facts.gp / Math.max(1, facts.numGames));
	return {
		label:
			f < 0.4
				? "Early-season edition"
				: f < 0.7
					? "Midseason edition"
					: "Stretch-run edition",
		dateline: `${MONTHS[Math.floor(f * MONTHS.length)]} ${f < 0.3 ? s - 1 : s}`,
	};
};

const compact = <T>(xs: (T | undefined)[]): T[] =>
	xs.filter((x): x is T => x !== undefined);

const section = (
	id: string,
	label: string,
	articles: (Article | undefined)[],
	sidebars: (Sidebar | undefined)[] = [],
): Section | undefined => {
	const list = compact(articles).map(finishArticle);
	if (list.length === 0) {
		return undefined;
	}
	return { id, label, articles: list, sidebars: compact(sidebars) };
};

const leadFor = (c: Ctx) => {
	switch (c.f.edition) {
		case "final":
			return leadChampion(c) ?? leadMidseason(c);
		case "playoffs":
			return leadPlayoffs(c) ?? leadMidseason(c);
		case "midseason":
			return leadMidseason(c);
		default:
			return leadPreseason(c);
	}
};

// Pages of one section that fit the edition, in a stable order that is different for every league. The window of pages that runs starts a few places further on each season, so neighbouring seasons show different pages and every page comes round.
const pagesFor = (c: Ctx, section: SectionId, quota: number): Article[] => {
	const eds = (p: PageDef) => p.eds ?? ["midseason", "playoffs", "final"];
	const candidates = PAGES.filter(
		(p) =>
			p.section === section &&
			eds(p).includes(c.f.edition) &&
			!(p.ratings && c.noRatings),
	).toSorted(
		(a, b) =>
			hashString(`${c.f.seedKey}|${section}|${c.tid ?? ""}|${a.id}`) -
			hashString(`${c.f.seedKey}|${section}|${c.tid ?? ""}|${b.id}`),
	);
	const n = candidates.length;
	if (n === 0) {
		return [];
	}
	const start =
		(hashString(`${c.f.seedKey}|${section}|${c.tid ?? ""}|start`) +
			(c.season - c.f.firstSeason) * quota) %
		n;
	const out: Article[] = [];
	for (let k = 0; k < n && out.length < quota; k++) {
		const page = candidates[(start + k) % n]!;
		const a = page.build(c);
		if (a) {
			out.push(a);
		}
	}
	return out;
};

// The features that can run, in a seeded rotation: the first two go on the front page, the rest to Features
const featureStories = (c: Ctx): Article[] => {
	const makers = [
		mvpFeature,
		bestRecordFeature,
		featFeature,
		breakoutFeature,
		(cc: Ctx) => tradeFeature(cc),
		topPickFeature,
	];
	const start =
		hashString(`${c.f.seedKey}|features`) + (c.season - c.f.firstSeason);
	const out: Article[] = [];
	for (let k = 0; k < makers.length; k++) {
		const a = makers[(start + k) % makers.length]!(c);
		if (a) {
			out.push(a);
		}
	}
	return out;
};

const leaguePaper = (c: Ctx): Section[] => {
	const lead = leadFor(c);
	const feats = featureStories(c);
	const mvp = feats.find((a) => a.id === "feature-mvp");
	const frontFeats = [
		mvp ?? (c.done ? awardStory(c, "MVP") : awardRace(c)),
		...feats.filter((a) => a !== mvp),
	].slice(0, 2);
	const restFeats = feats.filter((a) => !frontFeats.includes(a));
	const front = section(
		"front",
		"Front page",
		[lead, ...frontFeats, c.done ? finalsMvpStory(c) : bestGamesStory(c)],
		[numbersSidebar(c), standingsSidebar(c), leadersSidebar(c)],
	);
	const playoffs =
		c.f.series.length > 0
			? section(
					"playoffs",
					"Playoffs",
					[...seriesRecaps(c), ...pagesFor(c, "playoffs", 3)],
					[bracketSidebar(c), playInSidebar(c)],
				)
			: undefined;
	const awardPages = pagesFor(c, "awards", c.done ? 3 : 2);
	const awards = c.done
		? section("awards", "Awards", [
				awardStory(c, "DPOY"),
				awardStory(c, "ROY"),
				awardStory(c, "SMOY"),
				awardStory(c, "MIP"),
				allLeagueBlock(c),
				...awardPages,
			])
		: section("awards", "Awards", awardPages);
	// The preview has no games to report, so it has room for more of these
	const teams = section("teams", "Teams", pagesFor(c, "teams", c.pre ? 8 : 6));
	const players = section(
		"players",
		"Players",
		pagesFor(c, "players", c.pre ? 8 : 6),
	);
	const features = section("features", "Features", [
		...restFeats,
		surpriseStory(c),
		breakoutStory(c),
		declineStory(c),
		rookieStory(c),
		injuryStory(c),
		c.done ? bestGamesStory(c) : undefined,
		closeGamesStory(c),
		...pagesFor(c, "features", 3),
	]);
	const moves = section(
		"moves",
		"Transactions",
		[
			...tradeStories(c).slice(1),
			signingsStory(c),
			...pagesFor(c, "money", c.pre ? 5 : 4),
		],
		[rumorSidebar(c)],
	);
	const draft = section("draft", "Draft", [
		draftStory(c),
		draftPreviewPage.build(c),
		...pagesFor(c, "draft", 2),
	]);
	const numbers = section("numbers", "By the numbers", [
		teamStatsTable(c),
		leaderTables(c),
		...pagesFor(c, "numbers", 3),
	]);
	const history = section("history", "History", pagesFor(c, "history", 6));
	const obits = section("obits", "Retirements", retireStories(c));
	const opinion = section("opinion", "Opinion", [opinionColumn(c)]);
	const colour = section(
		"colour",
		"Colour & letters",
		pagesFor(c, "colour", 4),
	);
	return compact([
		front,
		playoffs,
		awards,
		teams,
		players,
		features,
		moves,
		draft,
		numbers,
		history,
		obits,
		opinion,
		colour,
	]);
};

const teamPaper = (c: Ctx, tid: number): Section[] => {
	const feats = teamPlayerFeatures(c, tid);
	const front = section(
		"front",
		"Front page",
		[teamLead(c, tid), feats[0], teamPlayoffPath(c, tid), teamGames(c, tid)],
		[standingsSidebar(c, tid), numbersSidebar(c)],
	);
	const players = section("players", "Players", [
		...feats.slice(1),
		teamRoster(c, tid),
		teamRookies(c, tid),
		teamInjuries(c, tid),
	]);
	const numbers = section("numbers", "By the numbers", [
		teamRanks(c, tid),
		teamRecordBook(c, tid),
		...pagesFor(c, "teams", 1),
	]);
	const moves = section(
		"moves",
		"Transactions",
		[...tradeStories(c, tid), signingsStory(c, tid), draftStory(c, tid)],
		[rumorSidebar(c, tid)],
	);
	const history = section("history", "History", [
		teamFranchise(c, tid),
		...pagesFor(c, "history", 2),
	]);
	// League news in brief: the league paper's front page headlines
	const lc = new Ctx(c.f);
	const lead = leadFor(lc);
	const briefs: Article | undefined = lead
		? finishArticle({
				id: "league-briefs",
				size: "brief",
				kicker: "Around the league",
				head: "Elsewhere in the league",
				body: [
					{
						type: "list",
						items: compact([
							lead,
							c.done ? awardStory(lc, "MVP") : awardRace(lc),
						]).map((a) => [a.head]),
					},
				],
			})
		: undefined;
	const league = section("league", "Around the league", [
		briefs,
		teamBackIssues(c, tid),
		teamLetter(c, tid),
	]);
	return compact([front, players, numbers, moves, history, league]);
};

// vary: false leaves the leads as the pages wrote them (for tests of the variation pass)
export const buildPaper = (
	facts: NewsFacts,
	tid?: number,
	opts?: { vary?: boolean },
): Paper => {
	const c = new Ctx(facts, tid);
	const id = paperIdentity(facts, tid);
	const info = editionInfo(facts);
	const sections =
		tid !== undefined && c.team(tid) ? teamPaper(c, tid) : leaguePaper(c);
	const ticker: Seg[][] = [];
	for (const s of sections) {
		for (const a of s.articles.slice(0, 2)) {
			if (s.id !== "front" || a.size !== "lead") {
				ticker.push([a.head]);
			}
		}
	}
	const paper: Paper = {
		name: id.name,
		motto: id.motto,
		season: facts.season,
		edition: facts.edition,
		editionLabel: info.label,
		dateline: info.dateline,
		volume: facts.season - facts.firstSeason + 1,
		price: `${25 + 5 * Math.floor((facts.season - facts.firstSeason) / 10)}¢`,
		tid: tid !== undefined && c.team(tid) ? tid : undefined,
		ticker: ticker.slice(0, 6),
		sections,
	};
	return opts?.vary === false ? paper : varyPaper(paper, facts);
};

// All the text of a paper, for tests
export const paperText = (paper: Paper) => {
	const out: string[] = [paper.name, paper.motto];
	for (const s of paper.sections) {
		for (const a of [...s.articles, ...s.sidebars]) {
			if ("head" in a) {
				out.push(a.head, a.kicker ?? "", a.deck ? segsText(a.deck) : "");
				if (a.box) {
					out.push(
						a.box.title,
						...a.box.items.map((x) => `${x.value} ${x.label}`),
					);
				}
			} else {
				out.push(a.title);
			}
			for (const b of a.body) {
				if (b.type === "p") {
					out.push(segsText(b.segs));
				} else if (b.type === "list") {
					out.push(...b.items.map(segsText));
				} else if (b.type === "notebook") {
					out.push(...b.items.map((x) => `${x.lead} ${segsText(x.segs)}`));
				} else if (b.type === "table") {
					out.push(
						b.head.join(" "),
						...b.rows.map((row) => row.map(segsText).join(" ")),
					);
				} else if (b.type === "nums") {
					out.push(...b.items.map((x) => `${x.value} ${x.label}`));
				} else if (b.type === "timeline") {
					out.push(...b.items.map((x) => `${x.label} ${segsText(x.segs)}`));
				} else if (b.type === "tape") {
					out.push(
						`${b.a} ${b.b}`,
						...b.rows.map((x) => `${x.label} ${x.a} ${x.b}`),
					);
				} else if (b.type === "aside") {
					out.push(segsText(b.segs));
				} else if (b.type === "fold") {
					// Nothing to read
				} else if (b.type === "quote") {
					out.push(b.text, b.cite ?? "");
				} else {
					out.push(b.text);
				}
			}
		}
	}
	return out.join("\n");
};
