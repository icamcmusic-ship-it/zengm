import { planDeck } from "./deck.ts";
import { LeagueIndex } from "./league.ts";
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

export const TOPICS: Record<WrappedMode, Topic[]> = {
	season: [...SEASON_TOPICS, ...MORE_SEASON],
	team: [...TEAM_TOPICS, ...MORE_TEAM],
	player: [...PLAYER_TOPICS, ...MORE_PLAYER],
	all: [...ALL_TOPICS, ...MORE_ALL],
};

// Every candidate slide; a topic that throws is skipped, so one bad topic can't break the deck
export const candidates = (ctx: TopicCtx) => {
	const out: Slide[] = [];
	for (const t of TOPICS[ctx.mode]) {
		let r: ReturnType<Topic>;
		try {
			r = t(ctx);
		} catch (error) {
			console.error(error);
			continue;
		}
		if (Array.isArray(r)) {
			out.push(...r);
		} else if (r) {
			out.push(r);
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
	return out;
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
	const X = L instanceof LeagueIndex ? L : new LeagueIndex(L);
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
