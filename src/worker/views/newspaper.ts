import { PHASE, PLAYER } from "../../common/constants.ts";
import { getCurrentContract } from "../../common/contracts.ts";
import { buildPaper } from "../../common/newspaper/index.ts";
import type {
	EditionId,
	NPAward,
	NPDraftee,
	NPFeat,
	NPGame,
	NPInjury,
	NPLine,
	NPPlayer,
	NPRetiree,
	NPSeries,
	NPSigning,
	NPTeam,
	NPTeamAward,
	NPTrade,
	NewsFacts,
} from "../../common/newspaper/types.ts";
import type { Game, Player, TeamSeason } from "../../common/types.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getActiveSeasonSelector } from "../db/merged/players.ts";
import { idb } from "../db/index.ts";
import { league, team } from "../core/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateSeason, validateTeam } from "../util/processInputs.ts";

const processInputs = (params: RouteParams<"newspaper">) => {
	return {
		team: validateTeam(params.team, ["all"]),
		season: validateSeason(params.season),
	};
};

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

const getEdition = (season: number, gp: number): EditionId => {
	const current = g.get("season");
	if (season < current) {
		return "final";
	}
	const phase = g.get("phase");
	if (phase >= PHASE.DRAFT_LOTTERY) {
		return "final";
	}
	if (phase === PHASE.PLAYOFFS) {
		return "playoffs";
	}
	if (phase < PHASE.REGULAR_SEASON || gp === 0) {
		return "preseason";
	}
	return "midseason";
};

// Sum a player's stat rows for one season and type, then turn into per game numbers
const lineFor = (
	p: Player,
	season: number,
	playoffs: boolean,
): NPLine | undefined => {
	const rows = p.stats.filter(
		(s) => s.season === season && s.playoffs === playoffs,
	);
	if (rows.length === 0) {
		return undefined;
	}
	const sum = (key: string) =>
		rows.reduce((acc, row) => acc + num((row as any)[key]), 0);
	const gp = sum("gp");
	if (gp === 0) {
		return undefined;
	}
	const min = sum("min");
	const trb = sum("drb") + sum("orb") || sum("trb");
	const fga = sum("fga");
	const tpa = sum("tpa");
	const per =
		min > 0
			? rows.reduce((acc, row) => acc + num(row.per) * num(row.min), 0) / min
			: 0;
	return {
		gp,
		min: min / gp,
		pts: sum("pts") / gp,
		trb: trb / gp,
		ast: sum("ast") / gp,
		stl: sum("stl") / gp,
		blk: sum("blk") / gp,
		per,
		ws: sum("ows") + sum("dws"),
		fgp: fga > 0 ? (100 * sum("fg")) / fga : 0,
		tpp: tpa > 0 ? (100 * sum("tp")) / tpa : 0,
		tp: sum("tp") / gp,
	};
};

// The team a player played for most that season (or his current team)
const seasonTid = (p: Player, season: number) => {
	const rows = p.stats.filter((s) => s.season === season && !s.playoffs);
	if (rows.length === 0) {
		return p.tid;
	}
	// Last stint is where he ended up
	return rows.at(-1)!.tid;
};

const ratingsFor = (p: Player, season: number) =>
	p.ratings.findLast((r) => r.season === season);

const getTeams = async (season: number, numRounds: number) => {
	const teams = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: [
			"abbrev",
			"region",
			"name",
			"cid",
			"did",
			"won",
			"lost",
			"tied",
			"otl",
			"wonHome",
			"lostHome",
			"wonAway",
			"lostAway",
			"streak",
			"playoffRoundsWon",
			"pop",
		],
		stats: ["gp", "pts", "oppPts"],
		season,
		showNoStats: true,
	});

	const out: NPTeam[] = [];
	let recordWins: NewsFacts["recordWins"];
	for (const t of teams) {
		const s = t.seasonAttrs as any;
		if (!s) {
			continue;
		}
		const history: TeamSeason[] = await idb.merged.teamSeasons.getAll({
			tid: t.tid,
		});
		const titles: number[] = [];
		let firstSeason = season;
		let prev: NPTeam["prev"];
		for (const ts of history) {
			firstSeason = Math.min(firstSeason, ts.season);
			if (
				ts.season < season &&
				ts.playoffRoundsWon >= g.get("numGamesPlayoffSeries", ts.season).length
			) {
				titles.push(ts.season);
			}
			if (ts.season === season - 1 && ts.won + ts.lost > 0) {
				prev = {
					won: ts.won,
					lost: ts.lost,
					tied: ts.tied,
					otl: ts.otl,
					playoffRoundsWon: ts.playoffRoundsWon,
				};
			}
			if (ts.season < season && (!recordWins || ts.won > recordWins.won)) {
				recordWins = {
					won: ts.won,
					tid: ts.tid,
					season: ts.season,
					region: ts.region ?? "",
					name: ts.name ?? "",
				};
			}
		}
		const stats = t.stats as any;
		const gp = num(stats?.gp);
		out.push({
			tid: t.tid,
			abbrev: s.abbrev,
			region: s.region,
			name: s.name,
			cid: s.cid,
			did: s.did,
			gp,
			won: num(s.won),
			lost: num(s.lost),
			tied: num(s.tied) || undefined,
			otl: num(s.otl) || undefined,
			pts: gp > 0 ? num(stats.pts) : undefined,
			oppPts: gp > 0 ? num(stats.oppPts) : undefined,
			streak: num(s.streak),
			wonHome: num(s.wonHome),
			lostHome: num(s.lostHome),
			wonAway: num(s.wonAway),
			lostAway: num(s.lostAway),
			playoffRoundsWon:
				typeof s.playoffRoundsWon === "number" ? s.playoffRoundsWon : -1,
			pop: s.pop,
			prev,
			titles,
			firstSeason,
		});
	}
	void numRounds;
	return { teams: out, recordWins };
};

const gameToNP = (game: Game): NPGame => {
	const stars = [game.won.tid, game.lost.tid].flatMap((tid) => {
		const t = game.teams.find((x) => x.tid === tid);
		const best = (t?.players ?? [])
			.map((p: any) => ({
				pid: p.pid as number,
				name: String(p.name ?? ""),
				tid,
				pts: num(p.pts),
				trb: num(p.trb) || num(p.orb) + num(p.drb),
				ast: num(p.ast),
				min: num(p.min),
			}))
			.toSorted(
				(a, b) =>
					b.pts + 0.4 * (b.trb + b.ast) - (a.pts + 0.4 * (a.trb + a.ast)),
			)[0];
		return best ? [best] : [];
	});
	return {
		gid: game.gid,
		day: game.day,
		playoffs: !!game.playoffs,
		won: { tid: game.won.tid, pts: game.won.pts },
		lost: { tid: game.lost.tid, pts: game.lost.pts },
		overtimes: num(game.overtimes),
		stars,
	};
};

export const getNewsFacts = async (season: number): Promise<NewsFacts> => {
	const numRounds = g.get("numGamesPlayoffSeries", season).length;
	const { teams, recordWins } = await getTeams(season, numRounds);
	const maxGp = Math.max(
		0,
		...teams.map((t) => t.won + t.lost + (t.tied ?? 0) + (t.otl ?? 0)),
	);
	const edition = getEdition(season, maxGp);

	// Playoffs
	const ps = await idb.merged.playoffSeries.get(season);
	const series: NPSeries[][] = (ps?.series ?? []).map((round, i) =>
		round.map((s) => ({
			round: i,
			home: { tid: s.home.tid, seed: s.home.seed, won: s.home.won },
			away: s.away
				? { tid: s.away.tid, seed: s.away.seed, won: s.away.won }
				: undefined,
			gids: s.gids ?? [],
		})),
	);
	for (const s of series[0] ?? []) {
		for (const side of [s.home, s.away]) {
			const t = side ? teams.find((x) => x.tid === side.tid) : undefined;
			if (t && side) {
				t.seed = side.seed;
			}
		}
	}
	let champion: number | undefined;
	let runnerUp: number | undefined;
	if (edition === "final" && ps && ps.series.length === numRounds) {
		const fin = ps.series.at(-1)?.[0];
		if (fin?.away) {
			const homeWon = fin.home.won > fin.away.won;
			champion = homeWon ? fin.home.tid : fin.away.tid;
			runnerUp = homeWon ? fin.away.tid : fin.home.tid;
		}
	}

	// Players
	const players: NPPlayer[] = [];
	const injuries: NPInjury[] = [];
	const isCurrent = season === g.get("season");
	await idb.merged.players.forEach(getActiveSeasonSelector(season), (p) => {
		const line = lineFor(p, season, false);
		const r = ratingsFor(p, season);
		if (!r || p.tid === PLAYER.UNDRAFTED) {
			return;
		}
		if (!line && edition !== "preseason") {
			return;
		}
		const prevR = ratingsFor(p, season - 1);
		const prevLine = lineFor(p, season - 1, false);
		const tid = edition === "preseason" ? p.tid : seasonTid(p, season);
		if (tid < 0) {
			return;
		}
		const name = `${p.firstName} ${p.lastName}`;
		const contract = getCurrentContract(p);
		players.push({
			pid: p.pid,
			name,
			tid,
			age: season - p.born.year,
			pos: r.pos ?? "",
			ovr: Math.round(r.ovr),
			pot: Math.round(r.pot),
			prevOvr: prevR ? Math.round(prevR.ovr) : undefined,
			...(line ?? {
				gp: 0,
				min: 0,
				pts: 0,
				trb: 0,
				ast: 0,
				stl: 0,
				blk: 0,
				per: 0,
				ws: 0,
				fgp: 0,
				tpp: 0,
				tp: 0,
			}),
			po: lineFor(p, season, true),
			prevLine: prevLine
				? {
						gp: prevLine.gp,
						pts: prevLine.pts,
						trb: prevLine.trb,
						ast: prevLine.ast,
						ws: prevLine.ws,
					}
				: undefined,
			draftYear: p.draft.year,
			draftRound: p.draft.round,
			draftPick: p.draft.pick,
			draftTid: p.draft.tid,
			rookie:
				p.draft.year === season - 1 && !p.stats.some((s) => s.season < season),
			contractAmount:
				isCurrent && contract
					? (contract.amounts.at(season - contract.start) ??
						contract.amounts.at(-1))
					: undefined,
			contractExp:
				isCurrent && contract
					? contract.start + contract.amounts.length - 1
					: undefined,
		});
		if (isCurrent && p.injury.gamesRemaining > 0 && p.tid >= 0) {
			injuries.push({
				pid: p.pid,
				name,
				tid: p.tid,
				type: p.injury.type,
				gamesRemaining: p.injury.gamesRemaining,
			});
		}
	});

	// Awards
	const awards: NPAward[] = [];
	const teamAwards: NPTeamAward[] = [];
	const awardsRow = await idb.merged.awards.get(season);
	const confs = g.get("confs", season);
	for (const a of awardsRow?.awards ?? []) {
		if (typeof a.statRange === "number" && a.shortName !== "FMVP") {
			continue;
		}
		const group =
			a.group?.type === "conf"
				? (confs.find((c) => c.cid === (a.group as any).cid)?.name ??
					"Conference")
				: a.group?.type === "div"
					? "Division"
					: undefined; // Playoff series awards like Finals MVP count as league-wide
		if (a.numTeams === undefined) {
			const winner = a.winner[0];
			if (winner?.pid !== undefined) {
				awards.push({
					key: a.shortName,
					name: a.name,
					pid: winner.pid,
					tid: winner.tid,
					order: a.winner
						.map((w) => w.pid)
						.filter((pid): pid is number => pid !== undefined),
					group,
				});
			}
		} else if (!group) {
			teamAwards.push({
				key: a.shortName,
				name: a.name,
				teams: a.winner.map((list, i) => ({
					title: `${["First", "Second", "Third", "Fourth", "Fifth"][i] ?? `#${i + 1}`} team`,
					pids: list
						.map((w) => w.pid)
						.filter((pid): pid is number => pid !== undefined),
				})),
			});
		}
	}

	// Games with box scores, kept only for recent seasons
	const games: NPGame[] = [];
	await idb.merged.games.forEach({ season }, (game) => {
		games.push(gameToNP(game));
	});
	// Only keep what the paper can use: playoff games and the extremes of the regular season
	const keepGids = new Set<number>(
		games.filter((x) => x.playoffs).map((x) => x.gid),
	);
	const reg = games.filter((x) => !x.playoffs);
	const keepTop = (score: (x: NPGame) => number, n: number) => {
		for (const x of reg.toSorted((a, b) => score(b) - score(a)).slice(0, n)) {
			keepGids.add(x.gid);
		}
	};
	keepTop((x) => x.overtimes, 5);
	keepTop((x) => x.won.pts - x.lost.pts, 5);
	keepTop((x) => x.won.pts + x.lost.pts, 5);
	// Each team's best win, worst loss and best night (team edition)
	for (const t of teams) {
		const mine = reg.filter((x) => x.won.tid === t.tid || x.lost.tid === t.tid);
		const pick = (list: NPGame[], score: (x: NPGame) => number) => {
			const best = list.toSorted((a, b) => score(b) - score(a))[0];
			if (best) {
				keepGids.add(best.gid);
			}
		};
		pick(
			mine.filter((x) => x.won.tid === t.tid),
			(x) => x.won.pts - x.lost.pts,
		);
		pick(
			mine.filter((x) => x.lost.tid === t.tid),
			(x) => x.won.pts - x.lost.pts,
		);
		pick(mine, (x) =>
			Math.max(...x.stars.filter((s) => s.tid === t.tid).map((s) => s.pts), 0),
		);
		pick(mine, (x) => x.overtimes);
	}

	// Feats
	const feats: NPFeat[] = [];
	await idb.merged.playerFeats.forEach(undefined, (f) => {
		if (f.season !== season) {
			return;
		}
		feats.push({
			pid: f.pid,
			name: f.name,
			tid: f.tid,
			oppTid: f.oppTid,
			gid: f.gid,
			playoffs: f.playoffs,
			result: f.result,
			score: f.score,
			pts: num(f.stats.pts),
			trb: num(f.stats.trb) || num(f.stats.orb) + num(f.stats.drb),
			ast: num(f.stats.ast),
			stl: num(f.stats.stl),
			blk: num(f.stats.blk),
		});
	});

	// Transactions: the summer before plus the season itself, and the summer after once the season is over
	const trades: NPTrade[] = [];
	const signings: NPSigning[] = [];
	// Signing events have no phase, so the summer before is everything logged after the last playoff event of the previous season
	const prevEvents = await idb.merged.events.getAll({ season: season - 1 });
	const lastPlayoffEid = Math.max(
		-1,
		...prevEvents.filter((e) => e.type === "playoffs").map((e) => e.eid),
	);
	const events = [
		...prevEvents.filter((e) => {
			const phase = (e as { phase?: number }).phase;
			return phase !== undefined
				? phase >= PHASE.RESIGN_PLAYERS
				: lastPlayoffEid >= 0 && e.eid > lastPlayoffEid;
		}),
		...(await idb.merged.events.getAll({ season })).filter(
			(e) =>
				edition === "final" ||
				((e as { phase?: number }).phase ?? 0) <= PHASE.PLAYOFFS,
		),
	];
	for (const e of events) {
		if (e.type === "trade" && e.teams) {
			const got = [1, 0].map((from) =>
				e.teams![from]!.assets.map((a) =>
					"pid" in a
						? {
								kind: "player" as const,
								pid: a.pid,
								name: a.name,
								amount: a.contract.amount,
								exp: a.contract.exp,
							}
						: {
								kind: "pick" as const,
								season: a.season,
								round: a.round,
								originalTid: a.originalTid,
							},
				),
			) as NPTrade["got"];
			trades.push({
				phase: e.phase ?? 0,
				tids: e.tids,
				got,
				score: num(e.score),
			});
		} else if (
			(e.type === "freeAgent" || e.type === "reSigned") &&
			e.contract
		) {
			const p = players.find((x) => x.pid === e.pids[0]);
			signings.push({
				kind: e.type,
				phase: e.phase ?? 0,
				pid: e.pids[0],
				name: p?.name ?? (e.contract as any).name ?? "",
				tid: e.tids[0],
				amount: e.contract.amount,
				exp: e.contract.exp,
				score: num(e.score),
			});
		}
	}
	// Names for signed players not in the season's player list
	const missing = signings.filter((s) => !s.name).map((s) => s.pid);
	if (missing.length > 0) {
		const ps2 = await idb.merged.players.getAll({ pids: missing });
		for (const s of signings) {
			const p = ps2.find((x) => x.pid === s.pid);
			if (p) {
				s.name = `${p.firstName} ${p.lastName}`;
			}
		}
	}

	// Retirements
	const retirees: NPRetiree[] = [];
	if (edition === "final") {
		const retired = await idb.merged.players.getAll({ retiredYear: season });
		for (const p of retired) {
			const rows = p.stats.filter((s) => !s.playoffs);
			const sum = (key: string) =>
				rows.reduce((acc, row) => acc + num((row as any)[key]), 0);
			if (rows.length === 0) {
				continue;
			}
			retirees.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				age: season - p.born.year,
				tid: rows.at(-1)!.tid,
				seasons: new Set(rows.map((s) => s.season)).size,
				gp: sum("gp"),
				pts: Math.round(sum("pts")),
				trb: Math.round(sum("orb") + sum("drb")),
				ast: Math.round(sum("ast")),
				ws: sum("ows") + sum("dws"),
				titles: p.awards.filter((a) => a.type === "Won Championship").length,
				mvps: p.awards.filter(
					(a) =>
						"shortName" in a &&
						a.shortName === "MVP" &&
						!("group" in a && a.group),
				).length,
				allStars: p.awards.filter((a) => a.type === "All-Star").length,
				hof: !!p.hof,
			});
		}
	}

	// Draft
	const draft: NPDraftee[] = [];
	const drafted = await idb.merged.players.getAll({ draftYear: season });
	for (const p of drafted) {
		if (p.draft.round > 0 && p.draft.tid >= 0) {
			const r = p.ratings[0];
			draft.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				tid: p.draft.tid,
				round: p.draft.round,
				pick: p.draft.pick,
				age: season - p.born.year,
				pos: r?.pos ?? "",
				ovr: Math.round(r?.ovr ?? 0),
				pot: Math.round(r?.pot ?? 0),
				college: p.college || undefined,
			});
		}
	}

	return {
		leagueName: await league.getName(),
		seedKey: `${g.get("lid")}|${g.get("startingSeason")}`,
		season,
		edition,
		numGames: g.get("numGames", season),
		numRounds,
		gp: maxGp,
		userTid: g.get("userTid"),
		confs: confs.map((c) => ({ cid: c.cid, name: c.name })),
		teams,
		players,
		awards,
		teamAwards,
		series,
		currentRound:
			edition === "final" ? numRounds : Math.max(0, ps?.currentRound ?? 0),
		champion,
		runnerUp,
		games: games.filter((x) => keepGids.has(x.gid)),
		feats,
		trades,
		signings,
		retirees,
		draft,
		injuries,
		recordWins,
		firstSeason: g.get("startingSeason"),
	};
};

export default defineView({
	id: "newspaper",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			inputs.season !== prevInputs?.season ||
			inputs.team !== prevInputs?.team ||
			(inputs.season === g.get("season") &&
				(updateEvents.has("gameSim") ||
					updateEvents.has("playerMovement") ||
					updateEvents.has("newPhase")))
		) {
			if (__SPORT !== "basketball") {
				return {
					error: "The newspaper is only available in Basketball GM." as const,
				};
			}
			const facts = await getNewsFacts(inputs.season);
			const tid = typeof inputs.team === "number" ? inputs.team : undefined;
			const paper = buildPaper(facts, tid);
			return {
				error: undefined,
				paper,
				abbrevs: Object.fromEntries(
					facts.teams.map((t) => [t.tid, t.abbrev]),
				) as Record<number, string>,
				season: inputs.season,
				team: inputs.team,
				userTid: g.get("userTid"),
			};
		}
	},
});
