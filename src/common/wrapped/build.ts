import { planDeck } from "./deck.ts";
import { slideTexts, spoilerText } from "./items.ts";
import { quizSlides } from "./quiz.ts";
import { isLeagueIndex, LeagueIndex } from "./league.ts";
import type { Deck, Slide, WLeague, WrappedMode } from "./types.ts";
import type { Topic, TopicCtx } from "./topics/helpers.ts";
import { SEASON_TOPICS } from "./topics/season.ts";
import { TEAM_TOPICS } from "./topics/team.ts";
import { PLAYER_TOPICS } from "./topics/player.ts";
import { ALL_TOPICS } from "./topics/all.ts";
import {
	MORE_ALL,
	MORE_PLAYER,
	MORE_SEASON,
	MORE_TEAM,
} from "./topics/more.ts";

import { X_PLAYER } from "./topics/xplayer.ts";
import { X_TEAM } from "./topics/xteam.ts";
import { X_SEASON } from "./topics/xseason.ts";
import { X_ALL } from "./topics/xall.ts";
import { DEAL_SEASON } from "./topics/dealsSeason.ts";
import { DEAL_TEAM } from "./topics/dealsTeam.ts";
import { DEAL_ALL, DEAL_PLAYER } from "./topics/dealsPeople.ts";

// The first topic sets, and the extra ones ported from the Explorer later
export const BASE_TOPICS: Record<WrappedMode, Topic[]> = {
	season: [...SEASON_TOPICS, ...MORE_SEASON],
	team: [...TEAM_TOPICS, ...MORE_TEAM],
	player: [...PLAYER_TOPICS, ...MORE_PLAYER],
	all: [...ALL_TOPICS, ...MORE_ALL],
};

export const EXTRA_TOPICS: Record<WrappedMode, Topic[]> = {
	season: X_SEASON,
	team: X_TEAM,
	player: X_PLAYER,
	all: X_ALL,
};

// Front-office topics: trades, contracts, releases, lotteries and the draft (they need the trades, contracts and lotteries in the snapshot)
export const DEAL_TOPICS: Record<WrappedMode, Topic[]> = {
	season: DEAL_SEASON,
	team: DEAL_TEAM,
	player: DEAL_PLAYER,
	all: DEAL_ALL,
};

export const TOPICS: Record<WrappedMode, Topic[]> = {
	season: [
		...BASE_TOPICS.season,
		...EXTRA_TOPICS.season,
		...DEAL_TOPICS.season,
	],
	team: [...BASE_TOPICS.team, ...EXTRA_TOPICS.team, ...DEAL_TOPICS.team],
	player: [
		...BASE_TOPICS.player,
		...EXTRA_TOPICS.player,
		...DEAL_TOPICS.player,
	],
	all: [...BASE_TOPICS.all, ...EXTRA_TOPICS.all, ...DEAL_TOPICS.all],
};

const runTopic = (t: Topic, ctx: TopicCtx, out: Slide[]) => {
	let r: ReturnType<Topic>;
	try {
		r = t(ctx);
	} catch (error) {
		console.error(error);
		return;
	}
	if (Array.isArray(r)) {
		out.push(...r);
	} else if (r) {
		out.push(r);
	}
};

const finishCandidates = (ctx: TopicCtx, out: Slide[]) => {
	// Slides that name the champion while talking about the title are spoilers
	if (ctx.mode !== "all" && ctx.X.decided(ctx.season)) {
		const c = ctx.X.champion(ctx.season);
		const names: string[] = [];
		if (c) {
			names.push(`${c.region} ${c.name}`, c.region, c.name, c.abbrev);
		}
		const fm = ctx.X.awardWinner(ctx.season, "Finals MVP");
		if (fm) {
			names.push(fm.name);
		}
		if (names.length > 0) {
			for (const s of out) {
				if (spoilerText(slideTexts(s).join(" . "), names)) {
					s.spoiler = true;
				}
			}
		}
	}
	// The deck's own subject needs no name tag
	const self =
		ctx.mode === "team" && ctx.tid !== undefined
			? ctx.X.teamName(ctx.tid, ctx.season)
			: ctx.mode === "player" && ctx.pid !== undefined
				? ctx.X.players.get(ctx.pid)?.name
				: undefined;
	for (const s of out) {
		if (s.who === undefined) {
			const p = s.pid !== undefined ? ctx.X.players.get(s.pid) : undefined;
			if (p) {
				s.who = p.name;
			} else if (s.tid !== undefined) {
				s.who = ctx.X.teamName(s.tid, s.season ?? ctx.season);
			}
		}
		if (s.who === self) {
			delete s.who;
		}
	}
	try {
		out.push(...quizSlides(ctx));
	} catch (error) {
		console.error(error);
	}
	return out;
};

// Every candidate slide; a topic that throws is skipped, so one bad topic can't break the deck
export const candidates = (ctx: TopicCtx) => {
	const out: Slide[] = [];
	for (const t of TOPICS[ctx.mode]) {
		runTopic(t, ctx, out);
	}
	return finishCandidates(ctx, out);
};

// The same, but lets the caller do other work (like answer messages) between topics. Gives exactly what candidates gives.
export const candidatesAsync = async (
	ctx: TopicCtx,
	pause: () => Promise<void>,
) => {
	const out: Slide[] = [];
	let t0 = performance.now();
	for (const t of TOPICS[ctx.mode]) {
		runTopic(t, ctx, out);
		// Only pause once a while's gone by, since pausing has a cost too
		if (performance.now() - t0 > 30) {
			await pause();
			t0 = performance.now();
		}
	}
	return finishCandidates(ctx, out);
};

export const buildDeck = (
	L: WLeague | LeagueIndex,
	o: {
		mode: WrappedMode;
		season: number;
		tid?: number;
		pid?: number;
		n?: unknown;
	},
): Deck => {
	const X = isLeagueIndex(L) ? L : new LeagueIndex(L);
	const soFar = o.mode !== "all" && !X.decided(o.season);
	const ctx: TopicCtx = {
		X,
		mode: o.mode,
		season: o.season,
		tid: o.tid,
		pid: o.pid,
		soFar,
	};
	const seed = `${o.mode}|${o.season}|${o.tid ?? ""}|${o.pid ?? ""}`;
	const slides = planDeck(candidates(ctx), o.mode, o.n, seed);
	let title = `${o.season} Wrapped`;
	if (o.mode === "team" && o.tid !== undefined) {
		title = `${X.teamName(o.tid, o.season)} ${o.season} Wrapped`;
	} else if (o.mode === "player" && o.pid !== undefined) {
		title = `${X.players.get(o.pid)?.name ?? "Player"} ${o.season} Wrapped`;
	} else if (o.mode === "all") {
		title = "All-Time Wrapped";
	}
	return {
		mode: o.mode,
		season: o.season,
		title,
		subtitle: soFar ? "Season in progress: awards and playoffs come later" : "",
		soFar,
		slides,
	};
};
