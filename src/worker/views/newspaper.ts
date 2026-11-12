import { featureOffError, featureOn } from "../util/nativeFeatures.ts";
import {
	coachSystemsEnabled,
	getCoachProfile,
	getTeamCoachSystem,
	hotSeatNow,
} from "../core/staff/systems.ts";
import { DEFENSE_NAMES, OFFENSE_NAMES } from "../../common/coachSystems.ts";
import { PHASE, PLAYER } from "../../common/constants.ts";
import { getCurrentContract } from "../../common/contracts.ts";
import { buildPaper } from "../../common/newspaper/index.ts";
import type { FaceConfig } from "facesjs";
import { DEFAULT_TEAM_COLORS } from "../../common/constants.ts";
import type {
	EditionId,
	NPAward,
	NPCareerRow,
	NPChampion,
	NPMvp,
	NPRetroPick,
	NPThen,
	NPDraftee,
	NPFeat,
	NPGame,
	NPInjury,
	NPPlayer,
	NPRetiree,
	NPSeries,
	NPSigning,
	NPTeam,
	NPTeamAward,
	NPTrade,
	NewsFacts,
	Paper,
	Seg,
} from "../../common/newspaper/types.ts";
import { parseRumorText } from "../../common/rumors/text.ts";
import { getRumorState } from "../core/rumors/index.ts";
import type { Game, Player, TeamSeason } from "../../common/types.ts";
import {
	aggregateGames,
	decideRebuild,
	pickEdition,
	careerBefore,
	honorsBefore,
	lineFor,
	num,
	seasonTid,
} from "./newspaperFacts.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getActiveSeasonSelector } from "../db/merged/players.ts";
import { idb } from "../db/index.ts";
import { league, team } from "../core/index.ts";
import getNumPlayoffTeams from "../core/season/getNumPlayoffTeams.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateSeason, validateTeam } from "../util/processInputs.ts";
import { getProStats } from "../../common/preDraft.ts";

const processInputs = (params: RouteParams<"newspaper">) => {
	return {
		team: validateTeam(params.team, ["all"]),
		season: validateSeason(params.season),
	};
};

const getEdition = (season: number, gp: number): EditionId =>
	pickEdition({
		season,
		currentSeason: g.get("season"),
		phase: g.get("phase"),
		gp,
	});

// "Springfield, USA" gives USA. Born where the file does not say gives nothing
const countryOf = (loc: string | undefined) => {
	const last = loc?.split(",").at(-1)?.trim();
	return last || undefined;
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
	const logos: Record<number, { imgURL?: string; imgURLSmall?: string }> = {};
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
		const hist: NonNullable<NPTeam["hist"]> = [];
		let firstSeason = season;
		let prev: NPTeam["prev"];
		for (const ts of history.toSorted((a, b) => a.season - b.season)) {
			firstSeason = Math.min(firstSeason, ts.season);
			if (
				ts.season < season &&
				ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) > 0
			) {
				hist.push({
					season: ts.season,
					won: ts.won,
					lost: ts.lost,
					tied: ts.tied || undefined,
					otl: ts.otl || undefined,
					playoffRoundsWon: ts.playoffRoundsWon,
				});
			}
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
			hist,
		});
		const info = g.get("teamInfoCache")[t.tid];
		logos[t.tid] = {
			imgURL: s.imgURL ?? info?.imgURL,
			imgURLSmall: s.imgURLSmall ?? info?.imgURLSmall,
		};
	}
	void numRounds;
	return { teams: out, recordWins, logos };
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

// How many teams make the playoffs (the play-in not included)
const getPlayoffTeamCount = async (season: number) => {
	try {
		return (await getNumPlayoffTeams(season)).numPlayoffTeams;
	} catch {
		return undefined;
	}
};

type History = Pick<
	NewsFacts,
	"champions" | "mvps" | "prevPairs" | "draftRetro" | "then" | "careerBoard"
>;

const historyCache = new Map<string, History>();

// What the league's past says: champions, MVPs, last season's playoff pairs, the draft class of five years ago, where the stars of ten years ago are now, and the all-time scoring list. It only changes when a season ends, so it is cached per season.
const getHistory = async (
	season: number,
	teams: NPTeam[],
	numRounds: number,
	edition: EditionId,
): Promise<History> => {
	const key = `${g.get("lid")}|${season}|${g.get("season")}|${edition === "final" ? 1 : 0}`;
	const hit = historyCache.get(key);
	if (hit) {
		return hit;
	}
	const first = g.get("startingSeason");

	// Champions and runners-up from the team seasons
	const champions: NPChampion[] = [];
	for (let y = Math.max(first, season - 40); y < season; y++) {
		const rounds = g.get("numGamesPlayoffSeries", y).length;
		const won = teams.find((t) =>
			t.hist?.some((h) => h.season === y && h.playoffRoundsWon >= rounds),
		);
		const lost = teams.find((t) =>
			t.hist?.some((h) => h.season === y && h.playoffRoundsWon === rounds - 1),
		);
		if (won) {
			champions.push({ season: y, tid: won.tid, runnerUp: lost?.tid });
		}
	}

	// MVPs
	const mvps: NPMvp[] = [];
	for (let y = Math.max(first, season - 25); y < season; y++) {
		const row = await idb.merged.awards.get(y);
		const mvp = row?.awards.find(
			(a) => a.shortName === "MVP" && a.group === undefined,
		);
		const w = (mvp?.winner as any)?.[0];
		if (w?.pid !== undefined) {
			const p = await idb.merged.players.get(w.pid);
			mvps.push({
				season: y,
				pid: w.pid,
				name: p ? `${p.firstName} ${p.lastName}` : String(w.name ?? ""),
				tid: w.tid,
				age: p ? y - p.born.year : undefined,
			});
		}
		const fm = row?.awards.find((a) => a.shortName === "FMVP");
		const c = champions.find((x) => x.season === y);
		const fw = (fm?.winner as any)?.[0];
		if (c && fw?.name) {
			c.fmvp = fw.name;
		}
	}

	// Last season's playoff pairs
	const prevPairs: [number, number][] = [];
	if (season - 1 >= first) {
		const ps = await idb.merged.playoffSeries.get(season - 1);
		for (const round of ps?.series ?? []) {
			for (const s of round) {
				if (s.away) {
					prevPairs.push([s.home.tid, s.away.tid]);
				}
			}
		}
	}

	// One pass over everyone who ever played: the draft class of five years ago, the stars of ten years ago, the scoring list
	const retroYear = season - 5 >= first ? season - 5 : undefined;
	const thenYear = season - 10 >= first ? season - 10 : undefined;
	const board: NPCareerRow[] = [];
	const retroPicks: NPRetroPick[] = [];
	const thenRows: (NPThen & { _p: Player })[] = [];
	await idb.merged.players.forEach({ activeAndRetired: true }, (p) => {
		const career = careerBefore(p, season);
		const active = p.tid >= 0 || p.tid === PLAYER.FREE_AGENT;
		if (career && career.pts >= 3000) {
			board.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				tid: p.tid >= 0 ? p.tid : -1,
				active,
				pts: career.pts,
				trb: career.trb,
				ast: career.ast,
				ws: career.ws,
				seasons: career.seasons,
			});
		}
		if (
			retroYear !== undefined &&
			p.draft.year === retroYear &&
			p.draft.round > 0
		) {
			const c = careerBefore(p, season);
			retroPicks.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pick: p.draft.pick,
				round: p.draft.round,
				draftTid: p.draft.tid,
				tid: p.tid >= 0 ? p.tid : -1,
				retired: p.retiredYear !== Infinity && p.tid === PLAYER.RETIRED,
				ovr: ratingsFor(p, season - 1)
					? Math.round(ratingsFor(p, season - 1)!.ovr)
					: undefined,
				pts: c?.pts ?? 0,
				ws: c?.ws ?? 0,
				seasons: c?.seasons ?? 0,
				allStar: honorsBefore(p, season).allStar,
			});
		}
		if (thenYear !== undefined) {
			const line = lineFor(p, thenYear, false);
			if (line && line.gp >= 40) {
				const now = lineFor(p, season - 1, false);
				const r = ratingsFor(p, season - 1);
				thenRows.push({
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					ws: line.ws,
					pts: line.pts,
					tid: seasonTid(p, thenYear),
					nowTid: p.tid,
					retired: p.tid === PLAYER.RETIRED,
					age: p.born.year ? season - 1 - p.born.year : undefined,
					ovr: r ? Math.round(r.ovr) : undefined,
					nowPpg: now && now.gp >= 10 ? now.pts : undefined,
					_p: p,
				});
			}
		}
	});
	const careerBoard = board.toSorted((a, b) => b.pts - a.pts).slice(0, 30);
	const draftRetro =
		retroYear !== undefined && retroPicks.length >= 10
			? {
					year: retroYear,
					picks: retroPicks
						.toSorted((a, b) => a.round - b.round || a.pick - b.pick)
						.slice(0, 20),
				}
			: undefined;
	const then =
		thenYear !== undefined && thenRows.length >= 5
			? {
					year: thenYear,
					list: thenRows
						.toSorted((a, b) => b.ws - a.ws)
						.slice(0, 6)
						.map(({ _p, ...rest }) => rest),
				}
			: undefined;

	void numRounds;
	const out: History = {
		champions,
		mvps,
		prevPairs,
		draftRetro,
		then,
		careerBoard,
	};
	historyCache.set(key, out);
	if (historyCache.size > 12) {
		historyCache.delete(historyCache.keys().next().value!);
	}
	return out;
};

export const getNewsFacts = async (
	season: number,
): Promise<{
	facts: NewsFacts;
	logos: Record<number, { imgURL?: string; imgURLSmall?: string }>;
}> => {
	const numRounds = g.get("numGamesPlayoffSeries", season).length;
	const { teams, recordWins, logos } = await getTeams(season, numRounds);
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

	// Games: the box scores give close and overtime records, streaks, double-doubles and season series
	const allGames: Game[] = await idb.merged.games.getAll({ season });
	const agg = aggregateGames(allGames);
	for (const t of teams) {
		const a = agg.teams.get(t.tid);
		if (a) {
			t.close = a.close;
			t.ot = a.ot;
			t.bestStreak = a.bestStreak;
			t.worstStreak = a.worstStreak;
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
		const box = agg.players.get(p.pid);
		players.push({
			pid: p.pid,
			name,
			tid,
			age: season - p.born.year,
			pos: r.pos ?? "",
			ovr: Math.round(r.ovr),
			pot: Math.round(r.pot),
			prevOvr: prevR ? Math.round(prevR.ovr) : undefined,
			gp: line?.gp ?? 0,
			min: line?.min ?? 0,
			pts: line?.pts ?? 0,
			trb: line?.trb ?? 0,
			ast: line?.ast ?? 0,
			stl: line?.stl ?? 0,
			blk: line?.blk ?? 0,
			per: line?.per ?? 0,
			ws: line?.ws ?? 0,
			fgp: line?.fgp ?? 0,
			tpp: line?.tpp ?? 0,
			tp: line?.tp ?? 0,
			gs: line?.gs,
			ftp: line && (line.ftp ?? -1) >= 0 ? line.ftp : undefined,
			tov: line?.tov,
			pf: line?.pf,
			orb: line?.orb,
			ows: line?.ows,
			dws: line?.dws,
			pm: line && line.pm !== 0 ? line.pm : undefined,
			dd: box?.dd,
			td: box?.td,
			g30: box?.g30,
			g40: box?.g40,
			hi: box?.hi,
			boxGp: box?.boxGp,
			career: careerBefore(p, season),
			honors: honorsBefore(p, season),
			college: p.college || undefined,
			country: countryOf(p.born.loc),
			jersey: p.jerseyNumber,
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
				p.draft.year === season - 1 &&
				!getProStats(p).some((s) => s.season < season),
			contractAmount:
				isCurrent && contract
					? (contract.amounts.at(season - contract.start) ??
						contract.amounts.at(-1))
					: undefined,
			contractExp:
				isCurrent && contract
					? contract.start + contract.amounts.length - 1
					: undefined,
			contractStart: isCurrent && contract ? contract.start : undefined,
			contractType: isCurrent && contract ? contract.type : undefined,
			prevTid: prevLine
				? getProStats(p)
						.filter((s) => s.season === season - 1 && !s.playoffs)
						.at(-1)?.tid
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

	// Games with box scores
	const games: NPGame[] = allGames.map(gameToNP);
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
	// What each traded player gave the team that got him this season, from his own stats rows
	const tradedPids = trades.flatMap((tr) =>
		tr.got.flat().flatMap((a) => (a.kind === "player" ? [a.pid] : [])),
	);
	if (tradedPids.length > 0) {
		const tps = await idb.merged.players.getAll({
			pids: [...new Set(tradedPids)],
		});
		for (const tr of trades) {
			tr.got.forEach((side, i) => {
				for (const a of side) {
					const p =
						a.kind === "player" ? tps.find((x) => x.pid === a.pid) : undefined;
					if (a.kind === "player" && p) {
						const rows = getProStats(p).filter(
							(r) => r.season === season && !r.playoffs && r.tid === tr.tids[i],
						);
						if (rows.length > 0) {
							a.ws = rows.reduce(
								(acc, r) => acc + num((r as any).ows) + num((r as any).dws),
								0,
							);
						}
					}
				}
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
			const rows = getProStats(p).filter((s) => !s.playoffs);
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

	// Payroll is only known for the season in progress: it is the contracts on the roster now
	if (isCurrent) {
		for (const t of teams) {
			const total = players
				.filter((p) => p.tid === t.tid && p.contractAmount !== undefined)
				.reduce((acc, p) => acc + (p.contractAmount ?? 0), 0);
			if (total > 0) {
				t.payroll = total;
			}
		}
	}

	// Counts for the transaction wire, from this season's own events
	const seasonEvents = await idb.merged.events.getAll({ season });
	const wire = {
		trades: seasonEvents.filter((e) => e.type === "trade").length,
		freeAgents: seasonEvents.filter((e) => e.type === "freeAgent").length,
		reSigned: seasonEvents.filter((e) => e.type === "reSigned").length,
		releases: seasonEvents.filter((e) => e.type === "release").length,
	};

	// Releases, named from the season's player list or the players store
	const releaseEvents = seasonEvents.filter(
		(e) => e.type === "release" && e.pids?.length && e.tids?.length,
	);
	const releases: NonNullable<NewsFacts["releases"]> = [];
	if (releaseEvents.length > 0) {
		const relPlayers = await idb.merged.players.getAll({
			pids: [...new Set(releaseEvents.map((e) => e.pids![0]!))],
		});
		for (const e of releaseEvents) {
			const p = relPlayers.find((x) => x.pid === e.pids![0]);
			if (p) {
				releases.push({
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					tid: e.tids![0]!,
				});
			}
		}
	}

	// The draft lottery of this season, once it has been run
	const lotteryResult = await idb.merged.draftLotteryResults.get(season);
	const lottery = lotteryResult
		? lotteryResult.result
				.map((x, i) => ({
					tid: x.tid,
					originalTid: x.originalTid,
					slot: i + 1,
					pick: num(x.pick),
					chances: num(x.chances),
				}))
				.filter((x) => x.pick > 0)
		: undefined;

	const history = await getHistory(season, teams, numRounds, edition);

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

	const facts: NewsFacts = {
		leagueName: await league.getName(),
		seedKey: `${g.get("lid")}|${g.get("startingSeason")}`,
		season,
		edition,
		numGames: g.get("numGames", season),
		numRounds,
		gp: maxGp,
		userTid: g.get("userTid"),
		confs: confs.map((c) => ({ cid: c.cid, name: c.name })),
		divs: g
			.get("divs", season)
			.map((d) => ({ did: d.did, cid: d.cid, name: d.name })),
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
		playIn: ps ? !!ps.playIns : g.get("playIn"),
		numPlayoffTeams: await getPlayoffTeamCount(season),
		byConf: confs.length > 1,
		salaryCap: g.get("salaryCap"),
		luxuryPayroll: g.get("luxuryPayroll"),
		minPayroll: g.get("minPayroll"),
		h2h: agg.h2h.filter((h) => h.aw + h.bw >= 2),
		wire,
		lottery: lottery && lottery.length > 0 ? lottery : undefined,
		releases,
		...history,
	};
	// Coaching systems: head coaches' systems and hot seats (current season only)
	if (season === g.get("season") && coachSystemsEnabled()) {
		const heads: NonNullable<NewsFacts["coaching"]>["heads"] = [];
		for (const c of await idb.cache.coaches.getAll()) {
			if (c.tid < 0 || c.role !== "head") {
				continue;
			}
			const sys = await getTeamCoachSystem(c.tid);
			const profile = getCoachProfile(c);
			heads.push({
				tid: c.tid,
				cid: c.cid,
				name: `${c.firstName} ${c.lastName}`,
				offense: OFFENSE_NAMES[profile.off],
				defense: DEFENSE_NAMES[profile.def],
				heat: await hotSeatNow(c),
				expectedPct:
					profile.expect?.season === season ? profile.expect.pct : undefined,
				fit: sys?.fit ?? 50,
			});
		}
		facts.coaching = { heads };
	}
	// Rumors: this season's rumors and how they turned out (only while they are in the league's rolling window)
	if (featureOn("rumors")) {
		const toSegs = (text: string): Seg[] =>
			parseRumorText(text).map((segment): Seg => {
				if (segment.type === "text") {
					return segment.text;
				}
				if (segment.type === "team") {
					const t = teams.find((row) => row.tid === segment.tid);
					return {
						tid: segment.tid,
						t: t ? `${t.region} ${t.name}` : "???",
						season,
					};
				}
				if (segment.type === "player") {
					return { pid: segment.pid, t: segment.name };
				}
				return segment.name;
			});
		const rumors = getRumorState()
			.items.filter((r) => r.season === season)
			.toReversed()
			.slice(0, 60)
			.map((r) => ({
				tids:
					r.fromTid !== undefined && r.fromTid >= 0
						? [...r.tids, r.fromTid]
						: r.tids,
				segs: toSegs(r.text),
				status: r.status,
				outcome: r.outcome ? toSegs(r.outcome) : undefined,
			}));
		if (rumors.length > 0) {
			facts.rumors = rumors;
		}
	}
	return { facts, logos };
};

type PhotoInfo = {
	face?: FaceConfig;
	imgURL?: string;
	colors: [string, string, string];
	jersey?: string;
};

const photoPids = (paper: Paper) => {
	const pids = new Set<number>();
	for (const sec of paper.sections) {
		for (const a of sec.articles) {
			if (a.photoPid !== undefined) {
				pids.add(a.photoPid);
			}
		}
	}
	return [...pids].slice(0, 40);
};

const getPhotos = async (paper: Paper, facts: NewsFacts) => {
	const photos: Record<number, PhotoInfo> = {};
	for (const pid of photoPids(paper)) {
		const p = await idb.merged.players.get(pid);
		if (!p) {
			continue;
		}
		const tid = facts.players.find((x) => x.pid === pid)?.tid ?? p.tid;
		const t = tid >= 0 ? await idb.cache.teams.get(tid) : undefined;
		photos[pid] = {
			face: p.imgURL ? undefined : p.face,
			imgURL: p.imgURL || undefined,
			colors: t?.colors ?? DEFAULT_TEAM_COLORS,
			jersey: t?.jersey,
		};
	}
	return photos;
};

// Past seasons never change, so their papers are kept. The season in progress is rebuilt when a phase changes or several days have been played, not on every simmed day
type Built = {
	stamp: string;
	gp: number;
	result: {
		paper: Paper;
		abbrevs: Record<number, string>;
		logos: Record<number, { imgURL?: string; imgURLSmall?: string }>;
		photos: Record<number, PhotoInfo>;
		champs: Record<number, number>;
	};
};
const paperCache = new Map<string, Built>();

const currentGp = async (season: number) => {
	const tss = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	return Math.max(
		0,
		...tss.map((ts) => ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0)),
	);
};

export default defineView({
	id: "newspaper",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("newspaper");
		if (featureOff) {
			return featureOff;
		}
		const isCurrent = inputs.season === g.get("season");
		const inputsChanged =
			updateEvents.has("firstRun") ||
			inputs.season !== prevInputs?.season ||
			inputs.team !== prevInputs?.team;
		const structural =
			updateEvents.has("playerMovement") || updateEvents.has("newPhase");
		const simmed = updateEvents.has("gameSim");
		if (!inputsChanged && !structural && !(simmed && isCurrent)) {
			return;
		}
		if (__SPORT !== "basketball") {
			return {
				error: "The newspaper is only available in Basketball GM." as const,
			};
		}

		const key = `${g.get("lid")}|${inputs.season}|${inputs.team}`;
		const gp = isCurrent ? await currentGp(inputs.season) : 0;
		const stamp = isCurrent
			? `${g.get("phase")}|${g.get("gameOver") ? 1 : 0}`
			: "past";
		const hit = paperCache.get(key);
		const decision = decideRebuild({
			inputsChanged,
			structural,
			simmed,
			isCurrent,
			cached: hit !== undefined,
			sameStamp: hit?.stamp === stamp,
			gpDelta: gp - (hit?.gp ?? 0),
		});
		if (decision === "skip") {
			return;
		}
		if (decision === "reuse" && hit) {
			return {
				error: undefined,
				...hit.result,
				season: inputs.season,
				team: inputs.team,
				userTid: g.get("userTid"),
				seasons: seasonList(),
			};
		}

		const { facts, logos } = await getNewsFacts(inputs.season);
		const tid = typeof inputs.team === "number" ? inputs.team : undefined;
		const paper = buildPaper(facts, tid);
		const result = {
			paper,
			abbrevs: Object.fromEntries(
				facts.teams.map((t) => [t.tid, t.abbrev]),
			) as Record<number, string>,
			logos,
			photos: await getPhotos(paper, facts),
			champs: {
				...Object.fromEntries(
					(facts.champions ?? []).map((x) => [x.season, x.tid]),
				),
				...(facts.champion !== undefined
					? { [facts.season]: facts.champion }
					: {}),
			} as Record<number, number>,
		};
		paperCache.set(key, { stamp, gp, result });
		if (paperCache.size > 24) {
			paperCache.delete(paperCache.keys().next().value!);
		}
		return {
			error: undefined,
			...result,
			season: inputs.season,
			team: inputs.team,
			userTid: g.get("userTid"),
			seasons: seasonList(),
		};
	},
});

const seasonList = () => {
	const out: number[] = [];
	for (let y = g.get("startingSeason"); y <= g.get("season"); y++) {
		out.push(y);
	}
	return out;
};
