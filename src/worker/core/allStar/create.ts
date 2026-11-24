import { updatePlayerAwards } from "../awards/awardsByPlayer.ts";
import { g, helpers } from "../../util/index.ts";
import type {
	AllStars,
	Conditions,
	AllStarPlayer,
	Player,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { last, orderBy, range, assertDefined } from "../../../common/utils.ts";
import { getPosByGpF } from "../player/getPosByGpF.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { shuffle } from "../../../common/random.ts";
import { player } from "../index.ts";
import { isCollege } from "../college/isCollege.ts";
import { isRedshirting } from "../college/redshirt.ts";
import {
	castVotes,
	selectFromVotes,
	slotsFor,
	type VoteCandidate,
} from "./vote.ts";
import { courtOf, dunkTalent, threeTalent, weekendRandom } from "./weekend.ts";
import { pickRisingStars } from "./risingStars.ts";
import { pickSkillsField } from "./skills.ts";

// This is from the old football awards sytem. Eventually should make All-Star teams use the same formulas as the default All-League awards...
// Football players from player.formatAll, with currentStats added in create
const mvpScoreStats = [
	"defSk",
	"defTckLoss",
	"defTckAst",
	"defTckSolo",
	"defFmbFrc",
	"defFmbRec",
	"defInt",
	"defPssDef",
	"rusYds",
	"rusTD",
	"fmbLost",
	"recYds",
	"recTD",
	"pssYds",
	"pssTD",
	"pssInt",
	"pba",
	"rba",
	"pbw",
	"rbw",
	"prTD",
	"krTD",
] as const;

type PlayerWithCurrentStats = {
	currentStats: Record<(typeof mvpScoreStats)[number], number>;
};

// Stats can be missing in historical data, treat that the same as 0
const getCurrentStats = (
	stats: Record<(typeof mvpScoreStats)[number], number | undefined>,
) => {
	const currentStats = {} as PlayerWithCurrentStats["currentStats"];
	for (const stat of mvpScoreStats) {
		currentStats[stat] = stats[stat] ?? 0;
	}
	return currentStats;
};

const dpoyScore = (p: PlayerWithCurrentStats) => {
	const s = p.currentStats;

	return (
		s.defSk * 4 +
		s.defTckLoss * 0.4 +
		s.defTckAst * 0.2 +
		s.defTckSolo * 0.4 +
		s.defFmbFrc * 3 +
		s.defFmbRec * 3 +
		s.defInt * 6 +
		s.defPssDef * 2
	);
};
const opoyScore = (p: PlayerWithCurrentStats) => {
	const s = p.currentStats;
	let rushing = s.rusYds * 0.125 + s.rusTD * 6 - s.fmbLost * 2;
	const receiving = s.recYds * 0.0975 + s.recTD * 6;

	// Penalty for rushing QBs
	if (s.pssYds > s.rusYds) {
		rushing *= 0.5;
	}

	return rushing + receiving;
};
const offScore = (p: PlayerWithCurrentStats) => {
	const s = p.currentStats;
	const passing = s.pssYds * 0.04 + s.pssTD * 4 - s.pssInt * 2.5;
	const rushingReceiving = opoyScore(p);

	return 1.1 * passing + rushingReceiving;
};
const poyScore = (p: PlayerWithCurrentStats) => {
	const s = p.currentStats;
	const attempts = s.pba + s.rba;
	if (attempts === 0) {
		return 0;
	}

	// Account for rate and volume
	return ((s.pbw + s.rbw) / attempts) * Math.sqrt(attempts);
};
const mvpScore = (p: PlayerWithCurrentStats) => {
	const s = p.currentStats;
	const offense = offScore(p);
	const defense = 2.25 * dpoyScore(p);
	const returns = (s.prTD + s.krTD) * 6;
	const blocking = 4 * poyScore(p);

	return offense + defense + returns + blocking;
};

const MIN_PLAYERS_CONTEST = 2;

// Players who can be All-Stars or enter a contest: on a team (not free agents), and in college mode not redshirting (they don't play)
export const isEligible = <
	T extends {
		tid: number;
		redshirt?: number;
	},
>(
	p: T,
) => p.tid >= 0 && !(isCollege() && isRedshirting(p));

// All the players who could be All-Stars, best first
export const getAllStarCandidates = async () => {
	const playersAll = (
		await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
	).filter((p) => isEligible(p));
	const players = await player.formatAll(playersAll, {
		attrs: ["pid", "firstName", "name", "tid", "injury"],
		ratings: ["pos", "ovr"],
		stats: bySport({
			baseball: [
				"war",

				// For position determination
				"gpF",
			],
			basketball: ["ewa", "ws", "gp", "pts"],
			football: [
				"keyStats",
				"pntYds",
				"fg",
				"krTD",
				"krYds",
				"prTD",
				"prYds",
				"pssYds",
				"pssTD",
				"pssInt",
				"rusYds",
				"rusTD",
				"recYds",
				"recTD",
				"fmbLost",
				"prTD",
				"krTD",
				"ydsFromScrimmage",
				"season",
				"abbrev",
				"tid",
				"jerseyNumber",
				"defIntTD",
				"defFmbTD",
				"defSft",
				"defSk",
				"defInt",
				"defPssDef",
				"defFmbFrc",
				"defFmbRec",
				"defTckSolo",
				"defTckAst",
				"defTckLoss",
				"totTD",
				"pbw",
				"pba",
				"pbwr",
				"rbw",
				"rba",
				"rbwr",
			],
			hockey: ["ps"],
		}),
		season: g.get("season"),
		mergeStats: "totOnly",

		// This is needed if the ASG happens before any normal games are played
		showNoStats: true,
	});

	// Basketball: games his team has played, for the games minimum and the per-game part of the score
	const teamGpByTid = new Map<number, number>();
	let maxTeamGp = 0;
	if (__SPORT === "basketball") {
		const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[g.get("season")], [g.get("season"), "Z"]],
		);
		for (const ts of teamSeasons) {
			const teamGp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
			teamGpByTid.set(ts.tid, teamGp);
			maxTeamGp = Math.max(maxTeamGp, teamGp);
		}
	}

	// Basketball: has he played MIN_GP_FRAC of his team's games (once teams have played 10)? Those who haven't come after
	// everyone who has, only picked if the league runs out of players
	const meetsMinGp = (p: (typeof players)[number]) =>
		__SPORT !== "basketball" ||
		maxTeamGp < 10 ||
		(p.stats.gp ?? 0) >= MIN_GP_FRAC * (teamGpByTid.get(p.tid) ?? 0);

	const score = (p: (typeof players)[number]) => {
		if (__SPORT === "basketball") {
			// Value (2.5 x EWA + win shares) half as this season's total, half per game over his team's games, so a clearly
			// elite player who missed some games isn't buried by players who compiled more minutes
			const value = 2.5 * (p.stats.ewa ?? 0) + (p.stats.ws ?? 0);
			const gp = p.stats.gp ?? 0;
			const teamGp = teamGpByTid.get(p.tid) ?? 0;
			if (gp > 0 && teamGp > 0 && meetsMinGp(p)) {
				return 0.5 * value + 0.5 * (value / gp) * Math.max(gp, teamGp);
			}
			return value;
		}
		return bySport({
			baseball: p.stats.war ?? 0,
			football: mvpScore({ currentStats: getCurrentStats(p.stats) }),
			basketball: 0,
			hockey: p.stats.ps ?? 0,
		});
	};

	// pid last, so equal players always come out in the same order
	return orderBy(
		players,
		[(p) => (meetsMinGp(p) ? 1 : 0), score, (p) => p.ratings.ovr, (p) => p.pid],
		["desc", "desc", "desc", "asc"],
	);
};

// Three-point contest, by stats: this regular season's threes, summed over all his teams this season (not just his last
// stat row, which is only his current team after a trade, or last season, or a playoff row)
export const getSeasonThrees = (
	stats: {
		season: number;
		playoffs: boolean;
		gp?: number;
		tp?: number;
		tpa?: number;
	}[],
	season: number,
) => {
	let gp = 0;
	let tp = 0;
	let tpa = 0;
	for (const row of stats) {
		if (row.season === season && !row.playoffs) {
			gp += row.gp ?? 0;
			tp += row.tp ?? 0;
			tpa += row.tpa ?? 0;
		}
	}
	return {
		gp,
		tp,
		tpa,
		tpp: tpa > 0 ? tp / tpa : 0,
	};
};

// Dunk contest invitations: above-the-rim talent (dunk/jumping, max vertical, wingspan, badges, a showman's ego), how often he
// actually finishes at the rim this season, and youth (it's a young man's contest)
const dunkInvite = (p: Player, season: number) => {
	let gp = 0;
	let rim = 0;
	for (const row of p.stats) {
		if (row.season === season && !row.playoffs) {
			gp += row.gp ?? 0;
			rim += row.fgAtRim ?? 0;
		}
	}
	const rimPerGame = gp > 0 ? rim / gp : 0;
	const age = season - p.born.year;
	return (
		dunkTalent(p) +
		1.5 * Math.min(6, rimPerGame) +
		0.4 * helpers.bound(27 - age, -5, 5)
	);
};

// Share of his team's games a player must have played to be on the All-Star ballot (once teams have played 10 games)
export const MIN_GP_FRAC = 0.4;

// The All-Star vote (allStarVote, basketball). With exactly two conferences each votes for its own team of allStarNum, otherwise
// the league votes for 2 x allStarNum. Injured picks stay All-Stars (listed as injured) and the commissioner names the next
// healthy player at the same court from the coaches' order. Returns undefined if a ballot can't fill its team with healthy
// players (a tiny league), so the old stats pick runs instead.
const pickByVote = async (
	candidates: Awaited<ReturnType<typeof getAllStarCandidates>>,
	allStarNum: number,
	numConfs: number,
) => {
	const season = g.get("season");
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	const tsByTid = new Map(teamSeasons.map((ts) => [ts.tid, ts]));
	const cidByTid = new Map(
		(await idb.cache.teams.getAll()).map((t) => [t.tid, t.cid]),
	);
	const teamGpOf = (ts: (typeof teamSeasons)[number] | undefined) =>
		ts ? ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) : 0;
	let maxTeamGp = 0;
	for (const ts of teamSeasons) {
		maxTeamGp = Math.max(maxTeamGp, teamGpOf(ts));
	}

	// Before any games, the candidates' order (BBGM's pick without stats) stands in for value and scoring
	const noGames = maxTeamGp === 0;

	const rows: (VoteCandidate & { healthy: boolean })[] = [];
	for (const [i, c] of candidates.entries()) {
		const ts = tsByTid.get(c.tid);
		const teamGp = teamGpOf(ts);
		const gp = c.stats.gp ?? 0;
		if (maxTeamGp >= 10 && gp < MIN_GP_FRAC * teamGp) {
			continue;
		}
		const raw = await idb.cache.players.get(c.pid);
		const prevAllStars =
			raw?.awards.filter((a) => a.type === "All-Star" && a.season < season)
				.length ?? 0;
		rows.push({
			pid: c.pid,
			tid: c.tid,
			name: c.name,
			cid: numConfs === 2 ? (cidByTid.get(c.tid) ?? -1) : -1,
			court: courtOf(c.ratings.pos),
			value: noGames ? -i : 2.5 * (c.stats.ewa ?? 0) + (c.stats.ws ?? 0),
			ppg: noGames ? -i : gp > 0 ? (c.stats.pts ?? 0) : 0,
			teamWinp:
				ts && teamGp > 0 ? (ts.won + 0.5 * (ts.tied ?? 0)) / teamGp : 0.5,
			teamHype: ts?.hype ?? 0.5,
			teamPop: ts?.pop ?? 1,
			prevAllStars,
			healthy: c.injury.gamesRemaining === 0,
		});
	}

	const numStarters = g.get("numPlayersOnCourt");
	const ballots =
		numConfs === 2
			? orderBy(
					[...Map.groupBy(rows, (r) => r.cid)].filter(([cid]) => cid >= 0),
					(x) => x[0],
					"asc",
				).map((x) => ({ rows: x[1], num: allStarNum, starters: numStarters }))
			: [{ rows, num: 2 * allStarNum, starters: 2 * numStarters }];
	if (numConfs === 2 && ballots.length !== 2) {
		return;
	}

	const rand = weekendRandom(season, "vote");
	const remaining: AllStarPlayer[] = [];
	const votes: NonNullable<AllStars["votes"]> = [];
	const healthyPids = new Set<number>();
	// Overall order of the picks (by value, best first), for the draft and mixed teams
	const orderIndex = new Map(candidates.map((c, i) => [c.pid, i]));
	for (const ballot of ballots) {
		const healthyByPid = new Map(ballot.rows.map((r) => [r.pid, r.healthy]));
		const voteRows = castVotes(ballot.rows, rand);
		const picked = selectFromVotes(voteRows, ballot.num, ballot.starters);
		const used = new Set(picked.map((r) => r.pid));
		const coachOrder = orderBy(
			voteRows,
			[(r) => r.playerRank + r.mediaRank, "fanRank", "pid"],
			["asc", "asc", "asc"],
		);
		const out: AllStarPlayer[] = [];
		let numHealthy = 0;
		for (const row of picked) {
			const obj: AllStarPlayer = {
				pid: row.pid,
				tid: row.tid,
				name: row.name,
			};
			if (row.selected === "starter") {
				obj.starter = true;
			}
			if (healthyByPid.get(row.pid)) {
				out.push(obj);
				healthyPids.add(row.pid);
				numHealthy += 1;
				continue;
			}
			obj.injured = true;
			out.push(obj);
			// The commissioner's replacement: same court if possible
			const replacement =
				coachOrder.find(
					(r) =>
						!used.has(r.pid) &&
						healthyByPid.get(r.pid) &&
						r.court === row.court,
				) ??
				coachOrder.find((r) => !used.has(r.pid) && healthyByPid.get(r.pid));
			if (replacement) {
				used.add(replacement.pid);
				replacement.selected = "replacement";
				out.push({
					pid: replacement.pid,
					tid: replacement.tid,
					name: replacement.name,
					replacement: true,
				});
				healthyPids.add(replacement.pid);
				numHealthy += 1;
			}
		}
		if (numHealthy < ballot.num) {
			return;
		}
		remaining.push(
			...orderBy(out, [(p) => orderIndex.get(p.pid) ?? Infinity], ["asc"]),
		);
		// The top of the ballot for the vote page: everyone picked and the next few at each court
		const shown = new Set<number>();
		for (const court of ["backcourt", "frontcourt"] as const) {
			const byScore = orderBy(
				voteRows.filter((r) => r.court === court),
				["score", "pid"],
				["asc", "asc"],
			);
			for (const r of byScore.slice(0, 10)) {
				shown.add(r.pid);
			}
		}
		for (const r of voteRows) {
			if (r.selected || shown.has(r.pid)) {
				votes.push(r);
			}
		}
	}

	return {
		remaining,
		votes: orderBy(votes, ["cid", "score", "pid"], ["asc", "asc", "asc"]),
		healthyPids,
		byConf: numConfs === 2,
	};
};

const create = async (conditions: Conditions) => {
	const allStars: AllStars = {
		season: g.get("season"),
		teamNames: ["", ""],
		teams: [[], []],
		remaining: [],
		finalized: false,
		type: "top",
	};

	// Not free agents (they'd have no team for the game or the news), and no redshirts
	const sortedPlayers = await getAllStarCandidates();
	const players = sortedPlayers;

	const allStarNum = g.get("allStarNum");

	let allStarType = g.get("allStarType");
	const confs = g.get("confs");
	if (__SPORT !== "basketball" && allStarType === "draft") {
		allStarType = "byConf";
	}
	if (allStarType === "byConf" && confs.length !== 2) {
		allStarType = "top";
	}

	let healthyPids = new Set<number>();
	let pickedAllStars = false;

	const pickAllStars = (
		candidates: typeof sortedPlayers,
		numTeams: 1 | 2,
	): boolean => {
		const numPlayersNeeded = numTeams * allStarNum;
		let count = 0;

		const addPlayer = (p: (typeof candidates)[number]) => {
			const obj: AllStarPlayer = {
				pid: p.pid,
				tid: p.tid,
				name: p.name,
			};

			const healthy = p.injury.gamesRemaining === 0;

			if (healthy) {
				healthyPids.add(p.pid);
				count += 1;
			} else {
				obj.injured = true;
			}

			allStars.remaining.push(obj);

			return healthy;
		};

		const pickAllStarsByPosition = (
			positionCounts: Record<string, number>,
			noPlayersBeyondPositionCounts?: boolean,
		) => {
			const positions = [];
			for (const [pos, numPlayers] of Object.entries(positionCounts)) {
				for (let i = 0; i < numPlayers; i++) {
					positions.push(pos);
				}
			}

			// If we need more than the default positions, they should be random
			shuffle(positions);

			const playersByPos = Object.groupBy(candidates, (p) => {
				if (__SPORT === "baseball") {
					// Find actual played position based on highest gpF value
					const pos = getPosByGpF(p.stats.gpF);
					if (pos !== undefined) {
						return pos;
					}
				}

				return p.ratings.pos;
			});

			let failed = false;

			while (count < numPlayersNeeded && !failed) {
				for (const pos of positions) {
					// Take 2 players from every position, if we're doing 2 teams at once, because they will alternate as selected for teams
					for (let i = 0; i < numTeams; i++) {
						if (!playersByPos[pos] || playersByPos[pos].length === 0) {
							failed = true;
						} else {
							let foundHealthyPlayer = false;
							while (!foundHealthyPlayer) {
								const p = playersByPos[pos].shift();
								if (!p) {
									failed = true;
									break;
								}
								foundHealthyPlayer = addPlayer(p);
							}
						}
					}

					if (count >= numPlayersNeeded) {
						break;
					}
				}

				// For baseball, we don't want to use this function for our bench, so only go through positionCounts once and then stop
				if (noPlayersBeyondPositionCounts) {
					break;
				}
			}

			return !failed;
		};

		return bySport({
			baseball: () => {
				pickAllStarsByPosition(
					{
						C: 1,
						"1B": 1,
						"2B": 1,
						"3B": 1,
						SS: 1,
						LF: 1,
						CF: 1,
						RF: 1,
						P: 8,
					},
					true,
				);

				// Fill out with best non-pitchers, regardless of position
				if (count < numPlayersNeeded) {
					const pidsUsed = new Set(allStars.remaining.map((p) => p.pid));
					const remainingCandidates = candidates.filter((p) => {
						if (pidsUsed.has(p.pid)) {
							return false;
						}

						const pos = getPosByGpF(p.stats.gpF);
						if (pos === "P") {
							return false;
						}

						return true;
					});

					for (const p of remainingCandidates) {
						addPlayer(p);

						if (count >= numPlayersNeeded) {
							// Success!
							return true;
						}
					}
				}

				return false;
			},
			basketball: () => {
				// A light court balance, the vote's slot minimums (4 backcourt and 6 frontcourt of 12 a team with 5 on the
				// court), the rest by value. A player at a court that's already filled its share waits, and is picked after all
				// if the other court runs out of players
				const slots = slotsFor(allStarNum, g.get("numPlayersOnCourt"));
				const minByCourt = {
					backcourt: numTeams * (slots.startersBack + slots.reservesBack),
					frontcourt: numTeams * (slots.startersFront + slots.reservesFront),
				};
				const countByCourt = { backcourt: 0, frontcourt: 0 };
				const deferred: typeof candidates = [];
				for (const p of candidates) {
					const court = courtOf(p.ratings.pos);
					const other = court === "backcourt" ? "frontcourt" : "backcourt";
					const otherNeeded = Math.max(
						0,
						minByCourt[other] - countByCourt[other],
					);
					if (numPlayersNeeded - count <= otherNeeded) {
						deferred.push(p);
						continue;
					}
					if (addPlayer(p)) {
						countByCourt[court] += 1;
					}

					if (count >= numPlayersNeeded) {
						// Success!
						return true;
					}
				}

				for (const p of deferred) {
					addPlayer(p);

					if (count >= numPlayersNeeded) {
						return true;
					}
				}

				// Didn't find enough players
				return false;
			},
			football: () =>
				pickAllStarsByPosition({
					QB: 3,
					RB: 3,
					WR: 5,
					TE: 2,
					OL: 6,
					DL: 6,
					LB: 5,
					S: 4,
					CB: 4,
					K: 1,
					P: 1,
				}),
			hockey: () =>
				pickAllStarsByPosition({
					C: 4,
					W: 8,
					D: 6,
					G: 2,
				}),
		})();
	};

	if (
		__SPORT === "basketball" &&
		allStarType === "tournament" &&
		Math.floor(allStarNum / 2) < g.get("numPlayersOnCourt")
	) {
		// Four teams need at least a lineup each
		allStarType = "top";
	}

	// Basketball, the All-Star vote: fans, players and media, with position slots and a minimum of games
	if (__SPORT === "basketball" && g.get("allStarVote")) {
		const voted = await pickByVote(sortedPlayers, allStarNum, confs.length);
		if (voted) {
			allStars.remaining = voted.remaining;
			allStars.votes = voted.votes;
			healthyPids = voted.healthyPids;
			pickedAllStars = true;
			if (allStarType === "byConf" && !voted.byConf) {
				allStarType = "top";
			}
			if (allStarType !== "byConf") {
				// One list, best first, for the draft and mixed teams
				const orderIndex = new Map(sortedPlayers.map((p, i) => [p.pid, i]));
				allStars.remaining = orderBy(
					allStars.remaining,
					[(p) => orderIndex.get(p.pid) ?? Infinity],
					["asc"],
				);
			}
		}
	}

	if (allStarType === "byConf" && !pickedAllStars) {
		// Try byConf, but if it fails, fall back on top
		const cidsByTid: Record<number, number> = {};
		const teams = await idb.cache.teams.getAll();
		for (const t of teams) {
			cidsByTid[t.tid] = t.cid;
		}

		const grouped = Map.groupBy(
			sortedPlayers.filter((p) => p.tid >= 0),
			(p) => cidsByTid[p.tid]!,
		);

		// Sorting is to make sure lowest cid is first
		const groupedPlayers = orderBy(grouped, (row) => row[0], "asc").map(
			(row) => row[1],
		);

		let numSuccess = 0;

		if (groupedPlayers.length === 2) {
			for (const confPlayers of groupedPlayers) {
				const success = pickAllStars(confPlayers, 1);
				if (success) {
					numSuccess += 1;
				} else {
					numSuccess = 0;
					break;
				}
			}
		}

		if (numSuccess === 2) {
			pickedAllStars = true;
		} else {
			// Reset if it failed to find enough players, don't do it by conf
			allStarType = "top";
			healthyPids = new Set();
			allStars.remaining = [];
		}
	}

	if (!pickedAllStars) {
		pickAllStars(sortedPlayers, 2);
	}

	// Do awards first, before picking captains, so remaining has all players
	const awardsByPlayer = allStars.remaining.map((p) => {
		return {
			pid: p.pid,
			tid: p.tid,
			name: p.name,
			award: { type: "All-Star" },
		};
	});
	await updatePlayerAwards({
		awardsToDelete: [],
		awardsToSave: awardsByPlayer,
		logEventInfo: {
			conditions,
		},
		season: g.get("season"),
	});

	// Returns false if there is no healthy player left to assign
	const assignTopPlayerToTeam = (team: (typeof allStars)["teams"][number]) => {
		const ind = allStars.remaining.findIndex(({ pid }) => healthyPids.has(pid));
		if (ind < 0) {
			return false;
		}
		team.push(allStars.remaining[ind]!);
		allStars.remaining.splice(ind, 1);
		return true;
	};

	if (
		allStarType === "tournament" &&
		healthyPids.size < 4 * g.get("numPlayersOnCourt")
	) {
		allStarType = "top";
	}

	if (allStarType === "draft" && healthyPids.size < 2) {
		// Not enough healthy players for two captains (a tiny league), so no draft
		allStarType = "top";
	}

	if (allStarType === "draft") {
		// Pick two captains
		for (const team of allStars.teams) {
			assignTopPlayerToTeam(team);
		}

		const getTeamName = (teamPlayers: (typeof allStars)["teams"][number]) => {
			const captainPID = teamPlayers[0]?.pid;
			const p = players.find((p2) => p2.pid === captainPID);
			assertDefined(p);
			return `Team ${p.firstName}`;
		};
		allStars.teamNames = [
			getTeamName(allStars.teams[0]),
			getTeamName(allStars.teams[1]),
		];

		if (allStars.teamNames[0] === allStars.teamNames[1]) {
			allStars.teamNames[1] += " 2";
		}
	} else if (allStarType === "tournament") {
		// Four teams, picked in snake order from the best down; each named for its best player. The semifinal winners become
		// teams 0 and 1 before the All-Star Game (prepareGame.ts)
		const teams: AllStarPlayer[][] = [[], [], [], []];
		const snake = [0, 1, 2, 3, 3, 2, 1, 0];
		let i = 0;
		while (true) {
			const ind = allStars.remaining.findIndex(({ pid }) =>
				healthyPids.has(pid),
			);
			if (ind < 0) {
				break;
			}
			teams[snake[i % snake.length]!]!.push(allStars.remaining[ind]!);
			allStars.remaining.splice(ind, 1);
			i += 1;
		}
		const names = teams.map((t) => {
			const p = players.find((p2) => p2.pid === t[0]?.pid);
			return p ? `Team ${p.firstName}` : "Team";
		});
		for (let j = 1; j < names.length; j++) {
			let k = 2;
			const base = names[j]!;
			while (names.slice(0, j).includes(names[j]!)) {
				names[j] = `${base} ${k}`;
				k += 1;
			}
		}
		allStars.tournament = {
			teamNames: names,
			teams,
			semis: [{ teams: [0, 3] }, { teams: [1, 2] }],
			targetSemis: 40,
			targetFinal: 25,
		};
		allStars.teamNames = ["Semifinal 1 winner", "Semifinal 2 winner"];
	} else if (allStarType === "byConf") {
		// First half of allStars.remaining is 1st conference, second half is 2nd conference
		for (const i of [0, 1] as const) {
			while (allStars.teams[i].length < allStarNum) {
				assignTopPlayerToTeam(allStars.teams[i]);
			}
		}

		// Order by cid ascending, same as players
		const confNames = orderBy(Object.values(confs), "cid", "asc").map(
			(conf) => conf.name,
		);
		allStars.teamNames[1] = `${confNames[1]}`;
		allStars.teamNames[0] = `${confNames[0]}`;
	} else {
		// Alternate team assignment when going through list of players, in snake fashion. With too few players for a full
		// game this still keeps the two sides within one player of each other (fewer per team); if that's still not enough
		// for a game, the game is called off when it comes up (prepareGame.ts)
		const snakeOrder = Math.random() < 0.5 ? [0, 1, 1, 0] : [1, 0, 0, 1];
		let i = 0;
		while (
			allStars.teams[0].length + allStars.teams[1].length <
			healthyPids.size
		) {
			const teamIndex = snakeOrder[i % snakeOrder.length]!;
			if (!assignTopPlayerToTeam(allStars.teams[teamIndex]!)) {
				break;
			}
			i += 1;
		}

		allStars.teamNames[1] = "All-Stars 1";
		allStars.teamNames[0] = "All-Stars 2";
	}

	allStars.type = allStarType;

	if (__SPORT === "basketball") {
		const season = g.get("season");
		const lastYear = await idb.merged.allStars.get(season - 1);
		let prevWinnerDunk: number | undefined;
		if (lastYear?.dunk?.winner !== undefined) {
			prevWinnerDunk = lastYear.dunk.players[lastYear.dunk.winner]!.pid;
		}
		let prevWinnerThree: number | undefined;
		if (lastYear?.three?.winner !== undefined) {
			prevWinnerThree = lastYear.three.players[lastYear.three.winner]!.pid;
		}

		// No redshirts: they don't play this season
		const activePlayers = (
			await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
		).filter((p) => isEligible(p));

		if (g.get("allStarDunk")) {
			const dunkers = orderBy(
				activePlayers.filter((p) => p.injury.gamesRemaining === 0),
				[
					(p) => (p.pid === prevWinnerDunk ? 1 : 0),
					(p) => dunkInvite(p, season),
					(p) => p.pid,
				],
				["desc", "desc", "asc"],
			)
				.slice(0, g.get("numPlayersDunk"))
				.map((p) => ({
					pid: p.pid,
					tid: p.tid,
					name: `${p.firstName} ${p.lastName}`,
				}));

			if (dunkers.length >= MIN_PLAYERS_CONTEST) {
				shuffle(dunkers);

				const controlling = [];
				for (const [i, dunker] of dunkers.entries()) {
					if (dunker.tid === g.get("userTid")) {
						controlling.push(i);
					}
				}

				const orderedByHeight = orderBy(
					activePlayers,
					(p) => last(p.ratings).hgt,
					"desc",
				);

				// Don't always take the tallest/shortest, add some randomness
				const numToPickFrom = Math.min(20, orderedByHeight.length);
				const indexes = range(numToPickFrom);
				shuffle(indexes);

				// -1 is because we want to turn .at(0) into .at(-1)
				const shortIndexes = [-indexes[0]! - 1, -indexes[1]! - 1] as const;

				shuffle(indexes);
				const longIndexes = [indexes[0]!, indexes[1]!] as const;

				allStars.dunk = {
					players: dunkers,
					rounds: [
						// First round
						{
							dunkers: range(dunkers.length),
							dunks: [],
						},
					],
					controlling,
					pidsShort: [
						orderedByHeight.at(shortIndexes[0])!.pid,
						orderedByHeight.at(shortIndexes[1])!.pid,
					],
					pidsTall: [
						orderedByHeight[longIndexes[0]]!.pid,
						orderedByHeight[longIndexes[1]]!.pid,
					],
				};
			}
		}

		if (g.get("allStarThree")) {
			// Half qualify by taking a lot of threes. Half qualify by ratings (plus any stats spots nobody qualifies for yet, early in the season).
			const numStats = Math.floor(g.get("numPlayersThree") / 2);

			// This regular season's threes. To qualify on stats he needs at least one attempt per team game so far (about the
			// most games anyone has played), then it's makes, with 3P% as the tiebreaker
			const threesByPid = new Map(
				activePlayers.map((p) => [p.pid, getSeasonThrees(p.stats, season)]),
			);
			let teamGames = 0;
			for (const threes of threesByPid.values()) {
				teamGames = Math.max(teamGames, threes.gp);
			}
			const minAttempts = Math.max(1, teamGames);
			const shootersStats = orderBy(
				activePlayers.filter(
					(p) =>
						p.injury.gamesRemaining === 0 &&
						threesByPid.get(p.pid)!.tpa >= minAttempts,
				),
				[
					(p) => threesByPid.get(p.pid)!.tp,
					(p) => threesByPid.get(p.pid)!.tpp,
					(p) => threeTalent(p),
					(p) => p.pid,
				],
				["desc", "desc", "desc", "asc"],
			).slice(0, numStats);

			const shootersRatings = orderBy(
				activePlayers.filter(
					(p) => p.injury.gamesRemaining === 0 && !shootersStats.includes(p),
				),
				[
					// Include last year's winner here too
					(p) => (p.pid === prevWinnerThree ? 1 : 0),
					// Catch-and-shoot shooting, and how he's actually shot it this season (by how many he's taken)
					(p) => {
						const threes = threesByPid.get(p.pid)!;
						return (
							threeTalent(p) +
							100 * (threes.tpp - 0.35) * Math.min(1, threes.tpa / minAttempts)
						);
					},
					(p) => p.pid,
				],
				["desc", "desc", "asc"],
			).slice(0, g.get("numPlayersThree") - shootersStats.length);

			const shooters = [...shootersStats, ...shootersRatings].map((p) => ({
				pid: p.pid,
				tid: p.tid,
				name: `${p.firstName} ${p.lastName}`,
			}));

			if (shooters.length >= MIN_PLAYERS_CONTEST) {
				shuffle(shooters);

				allStars.three = {
					players: shooters,
					rounds: [
						// First round
						{
							indexes: range(shooters.length),
							results: [
								{
									index: 0,
									racks: [[]],
								},
							],
						},
					],
				};
			}
		}

		if (g.get("allStarSkills")) {
			allStars.skills = pickSkillsField(activePlayers, season);
		}

		if (g.get("allStarRisingStars") && !isCollege()) {
			allStars.risingStars = pickRisingStars(activePlayers, season);
		}
	}

	return allStars;
};

export default create;
