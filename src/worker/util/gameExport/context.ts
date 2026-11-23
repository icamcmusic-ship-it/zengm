// Per-game download: each team's context (coaching, identity, front office, who was available, lineups) and each player's (profile,
// season baseline, role, fatigue, matchups, shots). Hidden information follows the player page: ratings as the page shows them (scouting
// fuzz; wingspan, like height, unfuzzed), no ratings or wingspan under the no visible ratings challenge (but for retired players),
// archetype and badges in words only, trait readings as the Traits page reads them.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	DEFENSE_NAMES,
	fitLabel,
	OFFENSE_NAMES,
} from "../../../common/coachSystems.ts";
import {
	exportShowsRatings,
	formatHeight,
} from "../../../common/playerExport.ts";
import {
	GM_TRAIT_INFO,
	GM_TRAIT_KEYS,
	gmStyleLabels,
	gmTraitLabel,
} from "../../../common/gmPersonality.ts";
import { describeRequest } from "../../core/ownerOffice/owner.ts";
import { parseCareer } from "../../../common/pbpFlavor/career.ts";
import { traitStatusText } from "../../../common/playerTraits/categories.ts";
import { TRAIT_DEFINITIONS } from "../../../common/playerTraits/definitions.ts";
import { formatTraitReading } from "../../../common/playerTraits/scouting.ts";
import type { Game, Player } from "../../../common/types.ts";
import {
	SHOT_ZONE_NAMES,
	type PbpAnalysis,
} from "../../../common/gameExport/pbpAnalysis.ts";
import { gameScore } from "../../../common/gameExport/index.ts";
import { gmEnabled } from "../../core/gm/index.ts";
import { gmFinanceStyleOf } from "../../core/gm/finance.ts";
import { GM_FINANCE_STYLES } from "../../../common/gmFinance.ts";
import moodComponents from "../../core/player/moodComponents.ts";
import { coachRelSummary } from "../../core/staff/relationships.ts";
import {
	getHeadCoachForSeason,
	getTeamCoachSystem,
	staffEnabled,
} from "../../core/staff/index.ts";
import getPayroll from "../../core/team/getPayroll.ts";
import { idb } from "../../db/index.ts";
import { getPlayer } from "../../views/player.ts";
import g from "../g.ts";
import { getTraitsForView, getTraitViewContext } from "../playerTraitsView.ts";
import { isBefore, type SeasonContext } from "./pregame.ts";

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

const PT_LABELS: [number, string][] = [
	[0, "No playing time"],
	[0.75, "Less playing time"],
	[1, "Normal"],
	[1.25, "More playing time"],
	[1.75, "Lots of playing time"],
];
const ptLabel = (ptm: number) => {
	let best = PT_LABELS[2]!;
	for (const row of PT_LABELS) {
		if (Math.abs(row[0] - ptm) < Math.abs(best[0] - ptm)) {
			best = row;
		}
	}
	return best[1];
};

// ---- player profiles (as on the player page) ----

export const playerProfile = async (
	pRaw: Player,
	season: number,
	traitContext: Awaited<ReturnType<typeof getTraitViewContext>>,
) => {
	const p: any = await getPlayer(pRaw);
	if (!p) {
		return null;
	}
	const showRatings = exportShowsRatings(
		!!g.get("challengeNoRatings"),
		pRaw.tid,
		PLAYER.RETIRED,
	);
	const row: any =
		p.ratings.findLast((r: any) => r.season === season) ?? p.ratings.at(-1);
	const arch = p.archetype;
	const label: string | undefined = arch?.label;
	const badges = (p.tieredBadges?.earned ?? []).slice(0, 6).map((b: any) => ({
		name: b.name,
		tier: b.tierName,
		category: b.category,
	}));
	// (trait readings as the Traits page shows them, which it does under the no visible ratings challenge too: they are scouting
	// estimates, not ratings)
	const traits = getTraitsForView(pRaw, traitContext);
	return {
		pos: row?.pos ?? null,
		age: season - p.born.year,
		ageNow: p.age,
		height: formatHeight(p.hgt),
		heightIn: p.hgt,
		weight: p.weight,
		// (a rating, unfuzzed like height on the player page; hidden under the no visible ratings challenge)
		wingspan: showRatings && typeof row?.wng === "number" ? row.wng : null,
		archetype: arch
			? {
					name: arch.name,
					label,
					defensiveTag: label?.includes(" · ")
						? label.split(" · ").slice(1).join(" · ")
						: null,
					tier: arch.tier ?? null,
					why: arch.whyBullets ?? [],
					whyLine: (arch.whyBullets ?? []).slice(0, 2).join(" · "),
				}
			: null,
		badges,
		traits: traits
			? traits.traits.map((t) => ({
					name: TRAIT_DEFINITIONS[t.key]?.name ?? t.key,
					reading: formatTraitReading(t),
					exact: t.exact,
					status: traitStatusText(t),
				}))
			: null,
		ratingsShown: showRatings,
		asOf: "export",
	};
};

// ---- season baseline ----

const STAT_KEYS = [
	"min",
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"tov",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
] as const;

const lineOf = (p: any) => ({
	min: n(p.min),
	pts: n(p.pts),
	trb: n(p.orb) + n(p.drb),
	ast: n(p.ast),
	stl: n(p.stl),
	blk: n(p.blk),
	tov: n(p.tov),
	fg: n(p.fg),
	fga: n(p.fga),
	tp: n(p.tp),
	tpa: n(p.tpa),
	ft: n(p.ft),
	fta: n(p.fta),
});

export const seasonBaseline = (
	ctx: SeasonContext,
	pid: number,
	boxLine: any,
	pRaw: Player | undefined,
	career: number[] | undefined,
	feats: { notes?: string[]; fs?: number }[],
) => {
	const { game } = ctx;
	const playoffs = !!game.playoffs;
	const games: { game: Game; line: any }[] = [];
	for (const x of ctx.seasonGames) {
		if (!!x.playoffs !== playoffs) {
			continue;
		}
		for (const t of x.teams) {
			const line = t.players.find((q: any) => q.pid === pid);
			if (line && n(line.min) > 0) {
				games.push({ game: x, line });
			}
		}
	}
	const before = games.filter(
		(x) => x.game.gid !== game.gid && isBefore(x.game, game),
	);
	const sum: Record<string, number> = {};
	for (const k of STAT_KEYS) {
		sum[k] = before.reduce((s, x) => s + (lineOf(x.line) as any)[k], 0);
	}
	const gp = before.length;
	const per = (k: string) => (gp > 0 ? r1(sum[k]! / gp) : null);
	const pctOf = (a: string, b: string) =>
		sum[b]! > 0 ? r3(sum[a]! / sum[b]!) : null;
	const thisLine = lineOf(boxLine);
	const played = n(boxLine.min) > 0;

	// This game's rank among his stored games this season (points and game score)
	const rankBy = (f: (line: any) => number) => {
		if (!played) {
			return null;
		}
		const v = f(boxLine);
		return (
			1 + games.filter((x) => x.game.gid !== game.gid && f(x.line) > v).length
		);
	};

	// Career highs: before the game (stored with the play-by-play) when known, else his stats rows' single-game highs (which include it)
	const parsed = career ? parseCareer(career) : undefined;
	const careerHighs: Record<
		string,
		{ game: number; before: number | null; high: boolean }
	> = {};
	const statKeys: [string, number][] = [
		["pts", thisLine.pts],
		["trb", thisLine.trb],
		["ast", thisLine.ast],
		["stl", thisLine.stl],
		["blk", thisLine.blk],
		["tp", thisLine.tp],
	];
	for (const [k, v] of statKeys) {
		let beforeHigh: number | null = null;
		let high = false;
		if (parsed && (parsed.high as any)[k] !== undefined) {
			beforeHigh = (parsed.high as any)[k];
			high = played && v > 0 && v >= beforeHigh!;
		} else if (pRaw) {
			let max = 0;
			for (const row of pRaw.stats) {
				const m = (row as any)[`${k}Max`];
				const val = Array.isArray(m) ? m[0] : undefined;
				if (typeof val === "number" && val > max) {
					max = val;
				}
			}
			high = played && v > 0 && v >= max;
		}
		careerHighs[k] = { game: v, before: beforeHigh, high };
	}

	return {
		gpBefore: gp,
		averagesBefore:
			gp > 0
				? {
						min: per("min"),
						pts: per("pts"),
						trb: per("trb"),
						ast: per("ast"),
						stl: per("stl"),
						blk: per("blk"),
						tov: per("tov"),
						fgPct: pctOf("fg", "fga"),
						tpPct: pctOf("tp", "tpa"),
						ftPct: pctOf("ft", "fta"),
					}
				: null,
		thisGame: played
			? {
					...thisLine,
					min: r1(thisLine.min),
					gameScore: r1(gameScore(boxLine)),
				}
			: null,
		vsAverage:
			played && gp > 0
				? {
						pts: r1(thisLine.pts - sum.pts! / gp),
						trb: r1(thisLine.trb - sum.trb! / gp),
						ast: r1(thisLine.ast - sum.ast! / gp),
						min: r1(thisLine.min - sum.min! / gp),
					}
				: null,
		seasonRank: played
			? {
					of: games.length,
					pts: rankBy((l) => n(l.pts)),
					gameScore: rankBy((l) => gameScore(l)),
				}
			: null,
		careerHighs,
		careerHighsSource: parsed ? "beforeGame" : "statsRows",
		feats: feats.flatMap((f) => f.notes ?? []),
		featScore: feats.find((f) => f.fs !== undefined)?.fs ?? null,
	};
};

// ---- team context ----

export const teamCoaching = async (
	ctx: SeasonContext,
	i: 0 | 1,
	ctxPlayers: any[],
) => {
	const { game } = ctx;
	const tid = game.teams[i].tid;
	const sys = (game.teams[i] as any).coachSys as
		| { off: string; def: string }
		| undefined;
	let headCoach = null;
	let schemeFit = null;
	if (staffEnabled() && tid >= 0) {
		const c = await getHeadCoachForSeason(tid, game.season);
		if (c) {
			const interim = c.succession?.interim;
			headCoach = {
				cid: c.cid,
				name: `${c.firstName} ${c.lastName}`,
				acting: !!interim && interim.season === game.season,
			};
		}
		if (game.season === g.get("season")) {
			const s = await getTeamCoachSystem(tid);
			if (s) {
				schemeFit = {
					overall: fitLabel(s.fit),
					offense: fitLabel(s.offFit),
					defense: fitLabel(s.defFit),
					// Share of his systems installed (familiarity)
					install: r3(s.install),
					bestOffense: OFFENSE_NAMES[s.bestOff] ?? s.bestOff,
					bestDefense: DEFENSE_NAMES[s.bestDef] ?? s.bestDef,
					asOf: "export",
				};
			}
		}
	}
	// In-game adjustments: minutes the rotation moved from a player's plan during the game (hot and cold hands)
	const adjustments = ctxPlayers
		.filter(
			(p) =>
				p.ctx &&
				typeof p.ctx.plan === "number" &&
				typeof p.ctx.planEnd === "number" &&
				Math.abs(p.ctx.plan - p.ctx.planEnd) >= 0.5,
		)
		.map((p) => ({
			pid: p.pid,
			planMin: r1(p.ctx.plan),
			planEndMin: r1(p.ctx.planEnd),
			change: r1(p.ctx.planEnd - p.ctx.plan),
		}));
	const hasPlan = ctxPlayers.some(
		(p) => p.ctx && typeof p.ctx.plan === "number",
	);
	return {
		headCoach,
		systems: sys
			? {
					offense:
						OFFENSE_NAMES[sys.off as keyof typeof OFFENSE_NAMES] ?? sys.off,
					defense:
						DEFENSE_NAMES[sys.def as keyof typeof DEFENSE_NAMES] ?? sys.def,
				}
			: null,
		schemeFit,
		adjustments: hasPlan ? adjustments : null,
	};
};

export const teamIdentity = (
	ctx: SeasonContext,
	i: 0 | 1,
	strength: { strength: number },
	profiles: Map<number, any>,
) => {
	const { game } = ctx;
	const tid = game.teams[i].tid;
	const ts = ctx.teamSeasons.get(tid);
	const prior = ctx.priorByTeam[i];
	const tot = {
		pts: 0,
		opp: 0,
		fga: 0,
		orb: 0,
		tov: 0,
		fta: 0,
		oFga: 0,
		oOrb: 0,
		oTov: 0,
		oFta: 0,
		min: 0,
		rim: 0,
		post: 0,
		mid: 0,
		tpa: 0,
	};
	for (const x of prior) {
		const side = x.teams[0].tid === tid ? 0 : 1;
		const us: any = x.teams[side];
		const them: any = x.teams[1 - side];
		tot.pts += n(us.pts);
		tot.opp += n(them.pts);
		tot.fga += n(us.fga);
		tot.orb += n(us.orb);
		tot.tov += n(us.tov);
		tot.fta += n(us.fta);
		tot.oFga += n(them.fga);
		tot.oOrb += n(them.orb);
		tot.oTov += n(them.tov);
		tot.oFta += n(them.fta);
		tot.min += n(us.min) / (x.numPlayersOnCourt ?? 5);
		tot.rim += n(us.fgaAtRim);
		tot.post += n(us.fgaLowPost);
		tot.mid += n(us.fgaMidRange);
		tot.tpa += n(us.tpa);
	}
	const poss =
		(tot.fga -
			tot.orb +
			tot.tov +
			0.44 * tot.fta +
			(tot.oFga - tot.oOrb + tot.oTov + 0.44 * tot.oFta)) /
		2;
	let powerRank = null;
	for (const row of ts?.powerRankHistory ?? []) {
		if (game.day === undefined || row.day <= game.day) {
			powerRank = { rank: row.rank, day: row.day, playoffs: !!row.playoffs };
		}
	}
	// Badge and archetype mix of the players who played (as the player pages show them)
	const played = game.teams[i].players.filter((p: any) => n(p.min) > 0);
	const archetypes = new Map<string, number>();
	const badges = new Map<string, number>();
	for (const p of played) {
		const prof = profiles.get(p.pid);
		if (prof?.archetype?.name) {
			archetypes.set(
				prof.archetype.name,
				(archetypes.get(prof.archetype.name) ?? 0) + 1,
			);
		}
		for (const b of prof?.badges ?? []) {
			badges.set(b.name, (badges.get(b.name) ?? 0) + 1);
		}
	}
	const sortMix = (m: Map<string, number>) =>
		[...m.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name, count]) => ({ name, count }));
	const sys = (game.teams[i] as any).coachSys as
		| { off: string; def: string }
		| undefined;
	return {
		powerRank,
		strength: strength.strength,
		gpBefore: prior.length,
		ortg: poss > 0 ? r1((100 * tot.pts) / poss) : null,
		drtg: poss > 0 ? r1((100 * tot.opp) / poss) : null,
		pace: poss > 0 && tot.min > 0 ? r1((48 * poss) / tot.min) : null,
		shotProfile:
			tot.fga > 0
				? {
						rim: r3(tot.rim / tot.fga),
						post: r3(tot.post / tot.fga),
						mid: r3(tot.mid / tot.fga),
						three: r3(tot.tpa / tot.fga),
					}
				: null,
		defensiveScheme: sys
			? (DEFENSE_NAMES[sys.def as keyof typeof DEFENSE_NAMES] ?? sys.def)
			: null,
		archetypeMix: sortMix(archetypes),
		badgeMix: sortMix(badges),
	};
};

export const teamFrontOffice = async (ctx: SeasonContext, i: 0 | 1) => {
	const { game } = ctx;
	const tid = game.teams[i].tid;
	if (tid < 0) {
		return null;
	}
	const t = await idb.cache.teams.get(tid);
	const godMode = !!g.get("godMode");
	let gm = null;
	if (gmEnabled() && t?.gm) {
		const traits = t.gm.traits;
		const finance = gmFinanceStyleOf(t.gm);
		gm = {
			name: `${t.gm.firstName} ${t.gm.lastName}`,
			since: t.gm.tenures.at(-1)?.start ?? null,
			style: gmStyleLabels(traits),
			leanings: GM_TRAIT_KEYS.map((key) => ({
				name: GM_TRAIT_INFO[key].name,
				label: gmTraitLabel(key, traits[key]),
				// (numbers only in God Mode, like the pages)
				...(godMode ? { value: r3(traits[key]) } : {}),
			})),
			finance: finance ? GM_FINANCE_STYLES[finance].name : null,
			asOf: "export",
		};
	}
	const current = game.season === g.get("season");
	const ts = ctx.teamSeasons.get(tid);
	const payroll = current
		? await getPayroll(tid)
		: (ts?.payrollEndOfSeason ?? null);
	const cap = g.get("salaryCap");
	const tax = g.get("luxuryPayroll");
	let owner = null;
	if (g.get("userTids").includes(tid) && ts) {
		const open = (ts.ownerSeason?.requests ?? []).filter(
			(r) => r.status === "open",
		);
		let mood = null;
		const prevTs = (
			await idb.merged.teamSeasons.getAll({
				tid,
				seasons: [game.season - 3, game.season],
			})
		)
			.filter((x) => x.ownerMood)
			.at(-1);
		if (prevTs?.ownerMood) {
			const m = prevTs.ownerMood;
			mood = {
				season: prevTs.season,
				wins: r3(m.wins),
				playoffs: r3(m.playoffs),
				money: r3(m.money),
				total: r3(m.wins + m.playoffs + m.money),
			};
		}
		owner = {
			mood,
			openRequests: open.map((r) => ({
				kind: r.kind,
				text: describeRequest(r),
				due: r.due,
			})),
			ultimatum: open.some((r) => r.kind === "makePlayoffs"),
			asOf: "export",
		};
	}
	return {
		gm,
		payroll: payroll ?? null,
		salaryCap: cap,
		luxuryTax: tax,
		minPayroll: g.get("minPayroll"),
		overCap: payroll !== null ? payroll > cap : null,
		overTax: payroll !== null ? payroll > tax : null,
		payrollAsOf: current ? "export" : "endOfSeason",
		owner,
	};
};

export const teamAvailability = (game: Game, i: 0 | 1) => {
	const out: { pid: number; name: string; reason: string; detail?: string }[] =
		[];
	const playingThrough: { pid: number; injury: string }[] = [];
	const injuredInGame: { pid: number; injury: string; games: number }[] = [];
	const restrictions: { pid: number; factor: number }[] = [];
	for (const p of game.teams[i].players as any[]) {
		const played = n(p.min) > 0;
		if (!played) {
			const inj = p.injuryAtStart ?? p.injury;
			const injured =
				inj &&
				inj.gamesRemaining > 0 &&
				!inj.newThisGame &&
				!p.injury?.newThisGame;
			out.push({
				pid: p.pid,
				name: p.name,
				reason: p.ctx?.rest
					? "rest"
					: injured
						? "injury"
						: p.ctx?.ptm === 0
							? "noPlayingTime"
							: "coachDecision",
				...(injured
					? { detail: `${inj.type} (${inj.gamesRemaining} games)` }
					: {}),
			});
		}
		if (p.injuryAtStart && played) {
			playingThrough.push({ pid: p.pid, injury: p.injuryAtStart.type });
		}
		if (p.injury?.newThisGame) {
			injuredInGame.push({
				pid: p.pid,
				injury: p.injury.type,
				games: p.injury.gamesRemaining,
			});
		}
		if (typeof p.ctx?.restr === "number" && p.ctx.restr < 1) {
			restrictions.push({ pid: p.pid, factor: r3(p.ctx.restr) });
		}
	}
	const recorded = (game.teams[i].players as any[]).some((p) => p.ctx);
	return {
		out,
		playingThrough,
		injuredInGame,
		minutesRestrictions: recorded ? restrictions : null,
	};
};

export const teamLineups = (
	game: Game,
	i: 0 | 1,
	analysis: PbpAnalysis | undefined,
) => {
	const players = game.teams[i].players as any[];
	const starters = players.filter((p) => n(p.gs) > 0).map((p) => p.pid);
	const recorded = players.some((p) => p.ctx && typeof p.ctx.plan === "number");
	const minutes = players
		.filter((p) => n(p.min) > 0 || (p.ctx && n(p.ctx.plan) > 0))
		.map((p) => ({
			pid: p.pid,
			planned:
				recorded && typeof p.ctx?.plan === "number" ? r1(p.ctx.plan) : null,
			actual: r1(n(p.min)),
		}));
	if (!analysis) {
		return { starters, minutes, closing: null, groups: null, onOff: null };
	}
	return {
		starters,
		minutes,
		closing: analysis.closing[i],
		groups: analysis.lineups
			.filter((l) => l.t === i)
			.slice(0, 10)
			.map(({ t: _t, ...l }) => ({ ...l, min: r1(l.sec / 60) })),
		onOff: analysis.players
			.filter((p) => p.t === i)
			.map((p) => ({ pid: p.pid, ...p.onOff })),
	};
};

// ---- player role, fatigue, shots ----

export const playerRole = async (
	game: Game,
	i: 0 | 1,
	boxLine: any,
	baselineMin: number | null,
	pRaw: Player | undefined,
	rotationRank: number | null,
) => {
	const played = n(boxLine.min) > 0;
	const current =
		game.season === g.get("season") && g.get("phase") <= PHASE.PLAYOFFS;
	const tid = game.teams[i].tid;
	let mood = null;
	let coachRel = null;
	if (pRaw && current && pRaw.tid === tid && tid >= 0) {
		try {
			const comps = await moodComponents(pRaw, tid);
			mood = {
				playingTime: r1(comps.playingTime),
				text:
					comps.playingTime < -0.5
						? "Unhappy with his minutes"
						: comps.playingTime > 0.5
							? "Happy with his minutes"
							: "Content with his minutes",
				asOf: "export",
			};
		} catch (error) {
			console.error(error);
		}
		const rels = await coachRelSummary(pRaw);
		const cur = rels?.find((r) => r.current);
		if (cur) {
			coachRel = { coach: cur.name, label: cur.label, asOf: "export" };
		}
	}
	const ptm = typeof boxLine.ctx?.ptm === "number" ? boxLine.ctx.ptm : null;
	return {
		starter: n(boxLine.gs) > 0,
		played,
		role: !played ? "dnp" : n(boxLine.gs) > 0 ? "starter" : "bench",
		rotationRank,
		seasonMinBefore: baselineMin,
		playingTimeSetting:
			ptm === null ? null : { value: ptm, label: ptLabel(ptm) },
		moodAboutMinutes: mood,
		coachRelationship: coachRel,
	};
};

export const playerFatigue = (
	pid: number,
	analysis: PbpAnalysis | undefined,
) => {
	const p = analysis?.players.find((x) => x.pid === pid);
	if (!p) {
		return null;
	}
	return {
		energyCurve: null,
		minByPeriod: p.minByPeriod,
		stints: p.stints,
		longestStintMin: p.longestStintMin,
		knocks: p.events,
		foulTrouble: p.foulTrouble,
	};
};

export const playerShots = (pid: number, analysis: PbpAnalysis | undefined) => {
	if (!analysis) {
		return null;
	}
	return analysis.shots
		.filter((s) => s.pid === pid)
		.map(({ t: _t, pid: _pid, ...s }) => ({
			...s,
			zoneName: SHOT_ZONE_NAMES[s.zone],
		}));
};
