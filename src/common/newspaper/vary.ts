// The variation pass. Many pages open with the same plain sentence every season ("Seasons since each team last made the playoffs:"). This file lists those sentences with hand-written alternatives that say the same thing with the same facts; the pass swaps the first paragraph of an article for one of them (or leaves the original), chosen by the seeded RNG from the league, season and headline, so a given edition always reads the same. Only paragraphs that are plain text and match a rule exactly are touched: a lead that carries links or any other facts is never rewritten. Ported from the Explorer's season-vary.js.

import { Rng, segsText } from "./text.ts";
import type { Article, NewsFacts, Paper } from "./types.ts";

type M = any;
type Rule = { id: string; re: RegExp; alts: ((m: M) => string)[] };

const plural = (n: unknown, a: string, b?: string) => (Number(n) === 1 ? a : (b ?? `${a}s`));

const RULES: Rule[] = [
	{ id: "streak-runs", re: /^The longest active playoff streak and the longest active drought, side by side:$/, alts: [
		() => "Side by side: the longest active run of playoff trips and the longest active run of misses.",
		() => "Two streaks that are still going, one good and one bad:",
		() => "The league's longest playoff run and its longest playoff drought, both still alive:",
		() => "At one end a team that keeps making the playoffs, at the other one that keeps missing them:",
		() => "Compare the longest active streak of playoff seasons with the longest active drought:" ] },
	{ id: "whatif-chalk", re: /^The (\d+) playoffs had (\d+) series won by the lower seed\. Reverse them and:$/, alts: [
		(m: M) => "In the " + m[1] + " playoffs, " + m[2] + " series went to the lower seed. Flip each one and see what happens:",
		(m: M) => "The lower seed won " + m[2] + " series in " + m[1] + ". Give " + (+m[2] === 1 ? "it" : "them all") + " to the higher seed and:",
		(m: M) => "Suppose the favorites had held serve in the " + m[2] + " " + plural(m[2], "upset") + " of the " + m[1] + " playoffs:",
		(m: M) => "Take away the " + plural(m[2], "upset") + " of " + m[1] + " (" + m[2] + " in all) and the bracket reads like this:" ] },
	{ id: "where-now", re: /^The leading names of (\d+), and where they stand in (\d+):$/, alts: [
		(m: M) => "Ten years on, where the leading names of " + m[1] + " stand in " + m[2] + ":",
		(m: M) => "The stars of " + m[1] + ", and what became of them by " + m[2] + ":",
		(m: M) => "A look back at the top players of " + m[1] + " and where each one is in " + m[2] + ":",
		(m: M) => "Who led the way in " + m[1] + ", and what they are doing in " + m[2] + ":",
		(m: M) => "The best players of " + m[1] + ", checked again in " + m[2] + ":" ] },
	{ id: "ballot-note", re: /^Picked from the numbers alone: win shares weighted by team success for MVP, defensive win shares plus steals and blocks for defense, bench production for Sixth Man, rating and scoring gains for Most Improved\.$/, alts: [
		() => "The picks follow the numbers only: team-weighted win shares for MVP, defensive win shares with steals and blocks for defense, bench output for Sixth Man, and rating and scoring gains for Most Improved.",
		() => "No hunches here. MVP goes by win shares weighted for team success, defense by defensive win shares plus steals and blocks, Sixth Man by bench production and Most Improved by rating and scoring gains.",
		() => "The method, in one line: team-weighted win shares (MVP), defensive win shares plus steals and blocks (defense), bench production (Sixth Man), rating and scoring gains (Most Improved)." ] },
	{ id: "hot-tape", re: /^Two franchises moving in opposite directions:$/, alts: [
		() => "One team sliding, one climbing:",
		() => "Two clubs, two directions:",
		() => "The year's falling team and its opposite, side by side:",
		() => "While one franchise drops, another rises:",
		() => "Down for one, up for the other:" ] },
	{ id: "caps-list", re: /^One entry per team, best record first, with the change from last season and each roster's leader in win shares\.$/, alts: [
		() => "Every team gets an entry, best record first, with its change from last season and the leader of its roster in win shares.",
		() => "The league, team by team: the record, how it compares with last year and the best player by win shares.",
		() => "One line for each club in order of record, showing the swing from last season and who led the roster in win shares." ] },
	{ id: "caps-tiers", re: /^Sorted into four tiers by record: the top (\d+), the rest of the upper half, the middle, and the bottom quarter\.$/, alts: [
		(m: M) => "Four tiers by record: the top " + m[1] + ", the rest of the upper half, the middle, and the bottom quarter.",
		(m: M) => "The standings in four groups: " + m[1] + " at the top, the remainder of the upper half, the middle, and the bottom quarter.",
		(m: M) => "By record, the league falls into four tiers. The first holds " + m[1] + " teams; the others are the rest of the upper half, the middle and the bottom quarter." ] },
	{ id: "league-movers", re: /^Against last season's records, the biggest swings in (\d+):$/, alts: [
		(m: M) => "The biggest changes from last season's records, " + m[1] + ":",
		(m: M) => "How " + m[1] + " compared with the year before: the largest swings in wins.",
		(m: M) => "Who moved most in " + m[1] + "? Against last season, the biggest swings:" ] },
	{ id: "years-ago", re: /^What the league looked like (\d+) years ago(?: \((\d+)\))?:$/, alts: [
    (m: M) => `The league ${m[1]} years ago${m[2] ? `, in ${m[2]}` : ""}, for comparison:`,
    (m: M) => `Turn back ${m[1]} years${m[2] ? ` to ${m[2]}` : ""} and the picture was this:`,
    (m: M) => `${m[1]} years back${m[2] ? `, in ${m[2]}` : ""}, the league looked like this:` ] },
  { id: "years-ago-2", re: /^This season's facts beside the same page (\d+) years ago:$/, alts: [
		(m: M) => "This season's facts, next to the same page from " + m[1] + " years ago:",
		(m: M) => "Then and now: " + m[1] + " years apart, the same facts side by side:",
		(m: M) => "The same page " + m[1] + " years ago, set against this season:" ] },
	{ id: "last-line", re: /^How last year's favorite and this year's champion actually played out:$/, alts: [
		() => "Last year's favorite and this year's champion, as they actually played out:",
		() => "What happened to the team we picked, and to the team that won:",
		() => "The pick and the champion, compared on what they did:" ] },
	{ id: "aging", re: /^(\d+) players aged (\d+) or older held regular roles this season\. The most productive:$/, alts: [
		(m: M) => m[1] + " players of " + m[2] + " or older held regular roles this season. The most productive:",
		(m: M) => "Age " + m[2] + " or older, and still in the rotation: " + m[1] + " players. The most productive of them:",
		(m: M) => "The veterans first: " + m[1] + " players aged " + m[2] + " or older held regular roles this season, led by:" ] },
	{ id: "drought", re: /^Seasons since each team last made the playoffs:$/, alts: [
		() => "How long each team has gone without the playoffs, in seasons:",
		() => "The waiting list: seasons since each team last reached the playoffs.",
		() => "Counting the seasons since each team last played in the postseason:" ] },
	{ id: "ledger", re: /^(\d+) players changed franchises between seasons\. Counting the win shares they produced this season:$/, alts: [
		(m: M) => m[1] + " players switched franchises between seasons. What they produced this year, in win shares:",
		(m: M) => "Between seasons " + m[1] + " players moved to new teams. Here is what they gave their new clubs, in win shares:",
		(m: M) => "The summer's movers numbered " + m[1] + ". Counting their win shares this season:" ] },
	{ id: "ledger-net", re: /^Net win shares from players who arrived or left between seasons:$/, alts: [
		() => "Win shares gained and lost through arrivals and departures between seasons, net:",
		() => "The summer, in net win shares: what arrived minus what left.",
		() => "Netting out the win shares of everyone who came or went between seasons:" ] },
	{ id: "breakout", re: /^The biggest rating gains among rotation players this season:$/, alts: [
		() => "The largest jumps in rating among rotation players this season:",
		() => "Rotation players whose ratings rose the most this season:",
		() => "Who got better the fastest? The biggest rating gains among regulars:" ] },
	{ id: "draft-top", re: /^The top of the (\d+) first round, with each team's record:$/, alts: [
		(m: M) => "The top of the " + m[1] + " first round, and how each team did that season:",
		(m: M) => "The " + m[1] + " first round, pick by pick, with each team's record:",
		(m: M) => "Who picked where in the " + m[1] + " first round, and the record behind each pick:" ] },
	{ id: "deadline", re: /^Two teams at opposite ends of the deadline ledger:$/, alts: [
		() => "The best and the worst of the trade deadline, side by side:",
		() => "Two teams, two outcomes from the deadline:",
		() => "At the top and bottom of the deadline ledger:" ] },
	{ id: "franchise-wins", re: /^Franchise wins through (\d+) \(current teams\):$/, alts: [
		(m: M) => "All-time franchise wins through " + m[1] + " for the current teams:",
		(m: M) => "The win totals of the current franchises, through " + m[1] + ":",
		(m: M) => "Through " + m[1] + ", the franchises ranked by total wins:" ] },
	{ id: "mile-watch", re: /^Within reach next season, at this season's pace:$/, alts: [
		() => "Close enough to reach next season, if they keep this season's pace:",
		() => "On this year's pace, these marks fall next season:",
		() => "Next season's milestones, at the pace set this year:" ] },
	{ id: "busts-note", re: /^Ratings can still change; production so far favors the later pick\.$/, alts: [
		() => "Ratings can still move; so far the later pick has produced more.",
		() => "It is early, but the later pick has done more with his chances.",
		() => "Production so far leans toward the player taken later, though ratings can still change." ] },
	{ id: "contracts-best", re: /^The best-value contract of (\d+) against the worst among big deals:$/, alts: [
		(m: M) => "The best value of " + m[1] + " set against the worst of the big contracts:",
		(m: M) => "In " + m[1] + ", the contract that gave the most and the big deal that gave the least:",
		(m: M) => "Best bargain against worst burden, " + m[1] + ":" ] },
	{ id: "wire-contracts", re: /^The four largest contracts signed this season:$/, alts: [
		() => "The biggest four contracts signed this season:",
		() => "Four deals led the market this season:",
		() => "The largest signings of the season, four in all:" ] },
	{ id: "fa-recap", re: /^Free-agent deals measured against what that money bought league-wide in their first season:$/, alts: [
		() => "Free-agent contracts against the league-wide price of production, as of the first season:",
		() => "What the new deals bought in year one, compared with what the same money bought around the league:",
		() => "Measured by the going rate for win shares, the free-agent class of the summer:" ] },
	{ id: "rankings", re: /^Changes to the all-time rankings this season, biggest first:$/, alts: [
		() => "The biggest moves on the all-time lists this season:",
		() => "How the all-time rankings shifted this season, largest changes first:",
		() => "Climbers on the all-time lists, biggest jump first:" ] },
	{ id: "draft-retro", re: /^How the first picks of (\d+) ranked in their class by career win shares:$/, alts: [
		(m: M) => "Where the first picks of " + m[1] + " stand in their class by career win shares:",
		(m: M) => "The top picks of " + m[1] + ", ranked within their class by career win shares:",
		(m: M) => "Career win shares put the first picks of " + m[1] + " in this order within their class:" ] },
	{ id: "contracts-lead", re: /^The winner, of the (.+), predates this league's player records, so neither his name nor his line is in this file\.$/, alts: [
		(m: M) => "The award went to a player of the " + m[1] + " who predates this league's records, so neither his name nor his line is in this file.",
		(m: M) => "This league's player records begin after the winner's time with the " + m[1] + ", so he is not in this file.",
		(m: M) => "The winner played for the " + m[1] + " before this league's player records begin; neither his name nor his statistics are on file.",
		(m: M) => "The " + m[1] + " player who won it is from before this league's records, so the file has neither his name nor his stats.",
		(m: M) => "A " + m[1] + " player took the award, but this league's player records start later; no name or line to show.",
		(m: M) => "He played for the " + m[1] + " in a season this file's player records do not reach, so nothing about him is on file." ] },
	{ id: "mvp-missing", re: /^The (\d+) (.+?) is not in this league file \(pre-league history\), so his season line is unavailable\.$/, alts: [
		(m: M) => "The " + m[1] + " " + m[2] + " is from before this league's records, so his season line is not on file.",
		(m: M) => "He is not in this league file, which starts after " + m[1] + ": the " + m[2] + " season line is unavailable.",
		(m: M) => "The " + m[2] + " for " + m[1] + " went to a player this file does not cover, so there is no season line to show.",
		(m: M) => "This league's player records begin after " + m[1] + ", so the " + m[2] + " winner has no season line here.",
		(m: M) => "The " + m[1] + " " + m[2] + " is from the years before the file's player records; his season line is not available." ] },
	{ id: "wire-lead", re: /^(\d+) trades, (\d+) free-agent signings, (\d+) re-signings and (\d+) releases this season\. The headliners:$/, alts: [
		(m: M) => "The transaction log shows " + m[1] + " " + plural(m[1], "trade") + ", " + m[2] + " free-agent " + plural(m[2], "signing") + ", " + m[3] + " " + plural(m[3], "re-signing") + " and " + m[4] + " " + plural(m[4], "release") + ". The headliners:",
		(m: M) => "This season: " + m[1] + " " + plural(m[1], "trade") + ", " + m[2] + " " + plural(m[2], "signing") + " in free agency, " + m[3] + " " + plural(m[3], "re-signing") + " and " + m[4] + " " + plural(m[4], "release") + ". Leading the list:",
		(m: M) => "In all, " + m[1] + " " + plural(m[1], "trade") + ", " + m[2] + " free-agent " + plural(m[2], "deal") + ", " + m[3] + " " + plural(m[3], "re-signing") + " and " + m[4] + " " + plural(m[4], "release") + ". The big ones:" ] },
	{ id: "slow-starts", re: /^Slow starts: top-five picks from the last few drafts\.$/, alts: [
		() => "Slow starts for some top-five picks of the last few drafts:",
		() => "Top-five picks from recent drafts who have yet to deliver:",
		() => "Recent top-five picks off to a slow start:" ] },
	{ id: "class-leader", re: /^The class leader and the best value outside the top (\d+) picks\.$/, alts: [
		(m: M) => "The best rookie in the class, and the best value taken outside the top " + m[1] + ".",
		(m: M) => "Two rookies stand out: the class leader and the best player picked below No. " + m[1] + ".",
		(m: M) => "The leader of the class, plus the best find outside the first " + m[1] + " picks." ] },
	{ id: "po-sweeps-old", re: /^(\d+) series of the (.+) finished in (.+) ended without a loss for the winner:$/, alts: [
		(m: M) => "No loss for the winner in " + m[1] + " series of " + m[2] + " in " + m[3] + ":",
		(m: M) => "Sweeps in " + m[3] + ": " + m[1] + " of the " + m[2] + " series ended with no win for the loser:" ] },
	{ id: "draft-retro-lead", re: /^(\d+) years on, the (\d+) draft has produced ([\d.]+) career win shares from (\d+) picks; (\d+) of them are still playing\.$/, alts: [
		(m: M) => "The " + m[2] + " draft, " + m[1] + " years later: " + m[4] + " picks, " + m[3] + " career win shares, " + m[5] + " " + plural(m[5], "player") + " still active.",
		(m: M) => "Of the " + m[4] + " players picked in " + m[2] + ", " + m[5] + " " + (+m[5] === 1 ? "is" : "are") + " still playing after " + m[1] + " years, with " + m[3] + " career win shares between them.",
		(m: M) => m[1] + " years after the " + m[2] + " draft: " + m[3] + " career win shares from " + m[4] + " picks, and " + m[5] + " still in the league." ] },
	{ id: "contracts-paid", re: /^Teams paid (\d+) players (\$[\d,.]+M) this season; the league-wide rate was ([\d.]+) win shares per \$1M\. Measured against that rate:$/, alts: [
		(m: M) => "Payroll for " + m[1] + " players came to " + m[2] + " this season, a league-wide rate of " + m[3] + " win shares per $1M. Against that rate:",
		(m: M) => m[2] + " went to " + m[1] + " players this season, which bought " + m[3] + " win shares per $1M across the league. Measured that way:",
		(m: M) => "The league paid " + m[1] + " players " + m[2] + " and got " + m[3] + " win shares per $1M. How the contracts compare:" ] },
	{ id: "deadline-lead", re: /^(\d+) in-season trades were made\. Measured by the win shares each team got from the players it received, minus what the players it sent away produced for their new team the rest of the season:$/, alts: [
		(m: M) => m[1] + " " + plural(m[1], "trade was", "trades were") + " made during the season. Each team's score is the win shares of the players it got, minus those the departed players produced for their new teams afterwards:",
		(m: M) => "The scorecard for " + m[1] + " in-season " + plural(m[1], "trade") + ": win shares from the players a team received, less what its former players gave their new clubs the rest of the way:",
		(m: M) => "After " + m[1] + " in-season " + plural(m[1], "trade") + ", teams are measured by what they got minus what they gave up, in win shares for the rest of the season:" ] },
];


const norm = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();

// The rule a plain lead paragraph matches, if any
export const ruleOf = (text: string) =>
	RULES.find((r) => r.re.test(norm(text)))?.id;

export const varyStats = () => ({
	rules: RULES.length,
	alts: RULES.reduce((a, r) => a + r.alts.length, 0),
});

const varyArticle = (a: Article, facts: Pick<NewsFacts, "seedKey" | "season">) => {
	const first = a.body[0];
	if (first?.type !== "p" || first.segs.length !== 1 || typeof first.segs[0] !== "string") {
		return a;
	}
	const text = norm(segsText(first.segs));
	for (const rule of RULES) {
		const m = text.match(rule.re);
		if (!m) {
			continue;
		}
		const r = new Rng([facts.seedKey, facts.season, "vary", rule.id, a.head].join("|"));
		const k = r.int(0, rule.alts.length);
		if (k >= rule.alts.length) {
			return a;
		}
		return {
			...a,
			body: [{ type: "p" as const, segs: [rule.alts[k]!(m)] }, ...a.body.slice(1)],
		};
	}
	return a;
};

// Swap the lead paragraph of every article for an alternative where a rule matches
export const varyPaper = (paper: Paper, facts: Pick<NewsFacts, "seedKey" | "season">): Paper => ({
	...paper,
	sections: paper.sections.map((s) => ({
		...s,
		articles: s.articles.map((a) => varyArticle(a, facts)),
	})),
});
