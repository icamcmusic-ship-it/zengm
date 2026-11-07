// Newspaper engine: turns NewsFacts into a laid-out Paper. Pure and deterministic: the same facts always give the same paper.

import { Ctx, finishArticle } from "./ctx.ts";
import {
	leadFinal,
	leadMidseason,
	leadPlayoffs,
	leadPreseason,
} from "./front.ts";
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
	seriesRecaps,
	signingsStory,
	standingsSidebar,
	surpriseStory,
	teamStatsTable,
	tradeStories,
} from "./sections.ts";
import { teamGames, teamLead, teamPlayerFeatures } from "./team.ts";
import { Rng, segsText } from "./text.ts";
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
			return leadFinal(c) ?? leadMidseason(c);
		case "playoffs":
			return leadPlayoffs(c) ?? leadMidseason(c);
		case "midseason":
			return leadMidseason(c);
		default:
			return leadPreseason(c);
	}
};

const leaguePaper = (c: Ctx): Section[] => {
	const lead = leadFor(c);
	const mvp = c.done ? awardStory(c, "MVP") : awardRace(c);
	const front = section(
		"front",
		"Front page",
		[
			lead,
			mvp,
			c.done ? finalsMvpStory(c) : bestGamesStory(c),
			tradeStories(c)[0],
		],
		[numbersSidebar(c), standingsSidebar(c), leadersSidebar(c)],
	);
	const playoffs =
		c.f.series.length > 0
			? section("playoffs", "Playoffs", seriesRecaps(c), [bracketSidebar(c)])
			: undefined;
	const awards = c.done
		? section("awards", "Awards", [
				awardStory(c, "DPOY"),
				awardStory(c, "ROY"),
				awardStory(c, "SMOY"),
				awardStory(c, "MIP"),
				allLeagueBlock(c),
			])
		: undefined;
	const features = section("features", "Features", [
		surpriseStory(c),
		breakoutStory(c),
		declineStory(c),
		rookieStory(c),
		injuryStory(c),
		c.done ? bestGamesStory(c) : undefined,
		closeGamesStory(c),
	]);
	const moves = section("moves", "Transactions", [
		...tradeStories(c).slice(1),
		signingsStory(c),
	]);
	const draft = section("draft", "Draft", [draftStory(c)]);
	const numbers = section("numbers", "By the numbers", [
		teamStatsTable(c),
		leaderTables(c),
	]);
	const obits = section("obits", "Retirements", retireStories(c));
	const opinion = section("opinion", "Opinion", [opinionColumn(c)]);
	return compact([
		front,
		playoffs,
		awards,
		features,
		moves,
		draft,
		numbers,
		obits,
		opinion,
	]);
};

const teamPaper = (c: Ctx, tid: number): Section[] => {
	const feats = teamPlayerFeatures(c, tid);
	const front = section(
		"front",
		"Front page",
		[teamLead(c, tid), feats[0], teamGames(c, tid)],
		[standingsSidebar(c, tid), numbersSidebar(c)],
	);
	const players = section("players", "Players", feats.slice(1));
	const moves = section("moves", "Transactions", [
		...tradeStories(c, tid),
		signingsStory(c, tid),
		draftStory(c, tid),
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
	const league = section("league", "Around the league", [briefs]);
	return compact([front, players, moves, league]);
};

export const buildPaper = (facts: NewsFacts, tid?: number): Paper => {
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
	return {
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
};

// All the text of a paper, for tests
export const paperText = (paper: Paper) => {
	const out: string[] = [paper.name, paper.motto];
	for (const s of paper.sections) {
		for (const a of [...s.articles, ...s.sidebars]) {
			if ("head" in a) {
				out.push(a.head, a.kicker ?? "", a.deck ? segsText(a.deck) : "");
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
				} else {
					out.push(b.text);
				}
			}
		}
	}
	return out.join("\n");
};
