// League extras: built-in unretirements (the "Unretirements" feature, settings in common/nativeFeatures.ts). Same logic as
// the old console script tools/console-scripts/unretire.js: once a season, at the start of free agency, with the chosen
// chance, ONE random retired player whose (latest) retirement came at the minimum age or older comes back as a free
// agent, with his last ratings boosted by a random number of ovr points.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import player from "../player/index.ts";

// Basketball ratings that can be raised (hgt never changes)
export const UNRETIRE_RATING_KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

export type UnretireConfig = {
	// Percent per season, 0-100
	chance: number;
	minRetireAge: number;
	boostMin: number;
	boostMax: number;
};

export const getUnretireConfig = (): UnretireConfig => {
	const boostA = featureOption<number>("unretireBoostMin");
	const boostB = featureOption<number>("unretireBoostMax");
	return {
		chance: featureOption<number>("unretireChance"),
		minRetireAge: featureOption<number>("unretireMinAge"),
		boostMin: Math.min(boostA, boostB),
		boostMax: Math.max(boostA, boostB),
	};
};

type MinimalPlayer = Pick<
	Player,
	"tid" | "diedYear" | "born" | "retiredYear" | "ratings"
> & {
	unretired?: number;
	unretiredByScript?: boolean;
};

export const isUnretireEligible = (p: MinimalPlayer, minRetireAge: number) => {
	if (p.tid !== PLAYER.RETIRED) {
		return false;
	}
	if (p.diedYear !== undefined && p.diedYear !== null) {
		return false;
	}
	// Each player comes back at most once (also honors the flag of the old console script)
	if (p.unretired !== undefined || p.unretiredByScript) {
		return false;
	}
	if (
		!p.born ||
		typeof p.born.year !== "number" ||
		!Number.isFinite(p.retiredYear)
	) {
		return false;
	}
	if (!p.ratings || p.ratings.length === 0) {
		return false;
	}
	return p.retiredYear - p.born.year >= minRetireAge;
};

// Raise ratings one point at a time until ovrFn reaches the target. Strong ratings are favoured (a good player gets
// better at what he is good at), but weak ones can move too.
export const boostRatingsTo = (
	ratings: Record<string, number>,
	targetOvr: number,
	ovrFn: (ratings: any) => number,
	rand: () => number = Math.random,
) => {
	let guard = 0;
	while (ovrFn(ratings) < targetOvr && guard++ < 2000) {
		const open = UNRETIRE_RATING_KEYS.filter((k) => ratings[k]! < 100);
		if (open.length === 0) {
			break;
		}
		const weights = open.map((k) => 20 + ratings[k]!);
		let r = rand() * weights.reduce((a, b) => a + b, 0);
		let pick = open.at(-1)!;
		for (let i = 0; i < open.length; i++) {
			r -= weights[i]!;
			if (r <= 0) {
				pick = open[i]!;
				break;
			}
		}
		ratings[pick] = ratings[pick]! + 1;
	}
	return ratings;
};

export type UnretireResult = {
	pid: number;
	name: string;
	age: number;
	oldOvr: number;
	newOvr: number;
};

const unretirePlayer = async (
	p: Player,
	config: UnretireConfig,
): Promise<UnretireResult> => {
	const last = p.ratings.at(-1)!;
	const oldOvr = last.ovr;
	const boost = helpers.bound(
		Math.floor(
			config.boostMin + Math.random() * (config.boostMax - config.boostMin + 1),
		),
		config.boostMin,
		config.boostMax,
	);

	// Fresh ratings row for this season, copied from his last one, so his history stays intact
	const season = g.get("season");
	if (last.season !== season) {
		player.addRatingsRow(p);
	}
	const row = p.ratings.at(-1)! as { locked?: boolean };
	row.locked = false;
	boostRatingsTo(
		row as unknown as Record<string, number>,
		Math.min(100, oldOvr + boost),
		player.ovr as (ratings: any) => number,
	);

	// Recompute ovr, pot, pos and skills as the game does (0 seasons of development)
	await player.develop(p, 0);
	await player.updateValues(p);

	p.retiredYear = Infinity;
	(p as Player & { unretired?: number }).unretired = season;
	player.addToFreeAgents(p, {});
	await idb.cache.players.put(p);

	const name = `${p.firstName} ${p.lastName}`;
	const newOvr = p.ratings.at(-1)!.ovr;
	await logEvent({
		type: "freeAgent",
		text: `<a href="${helpers.leagueUrl(["player", p.pid])}">${name}</a> has come out of retirement and is now a free agent.`,
		showNotification: true,
		pids: [p.pid],
		tids: [PLAYER.FREE_AGENT],
		score: 20,
	});

	return {
		pid: p.pid,
		name,
		age: season - p.born.year,
		oldOvr,
		newOvr,
	};
};

export const getUnretireEligible = async (minRetireAge: number) => {
	const pool: Player[] = [];
	await idb.merged.players.forEach({ activeAndRetired: true }, (p) => {
		if (isUnretireEligible(p, minRetireAge)) {
			pool.push(p);
		}
	});
	return pool;
};

// One roll. force skips the dice (for tests and the console).
export const rollUnretirement = async ({
	force = false,
}: { force?: boolean } = {}): Promise<UnretireResult | undefined> => {
	const config = getUnretireConfig();
	if (!force && Math.random() * 100 >= config.chance) {
		return undefined;
	}
	const pool = await getUnretireEligible(config.minRetireAge);
	if (pool.length === 0) {
		return undefined;
	}
	const p = pool[Math.floor(Math.random() * pool.length)]!;
	return unretirePlayer(p, config);
};

// Phase hook: one roll per season, at the start of free agency
export const unretireAtPhase = async (phase: number) => {
	if (phase !== PHASE.FREE_AGENCY || !featureOn("unretire")) {
		return;
	}
	try {
		await rollUnretirement();
	} catch (error) {
		console.error("Unretirement failed", error);
	}
};
