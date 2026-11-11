// Test support for coaching systems (common/coachSystems.ts): "leagues" of random coaches on generated rosters, each team's CoachSim
// normalized over its league like staff/systems.ts does, and games between them with the real sim. Used by coachSystems.test.ts and the
// calibration script (coachSystems.script.test.ts).
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	coachSimEffects,
	deriveCoachProfile,
	normalizeCoachSims,
	rosterSchemeFit,
	type CoachSim,
} from "../../../common/coachSystems.ts";
import type { CoachProfile, CoachRatings } from "../../../common/types.ts";
import { fitRatingsOf } from "../staff/systems.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { range } from "../../../common/utils.ts";

export type LeagueTeam = {
	profile: CoachProfile;
	head: CoachRatings;
	offFit: number;
	defFit: number;
	sim: CoachSim;
	players: any[];
};

const randomCoach = (random: () => number, i: number) => {
	const r = () =>
		Math.max(-1, Math.min(1, (random() + random() + random() - 1.5) * 0.9));
	const rating = () => Math.round(35 + 30 * random());
	return {
		firstName: `Coach${i}`,
		lastName: `Test${Math.floor(random() * 1e6)}`,
		born: { year: 1960 + Math.floor(random() * 30), loc: "USA" },
		ratings: { dev: rating(), off: rating(), def: rating(), mot: rating() },
		style: {
			pace: Math.round(r() * 100) / 100,
			threes: Math.round(r() * 100) / 100,
			defense: Math.round(r() * 100) / 100,
			rotation: Math.round(r() * 100) / 100,
		},
	};
};

// A league of numPairs * 2 teams: rosters from genTeams (two per call), a random coach each, sims normalized over the league
export const genLeague = async ({
	numPairs,
	seed,
	install = 1,
	settings = {},
}: {
	numPairs: number;
	seed: number;
	install?: number;
	settings?: Record<string, unknown>;
}) => {
	const random = makeSeededRandom(seed * 31 + 7);
	const teams: LeagueTeam[] = [];
	for (const pair of range(numPairs)) {
		await withSeededRandom(seed * 1009 + pair * 97, async () => {
			await genTeams();
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			for (const tid of [0, 1]) {
				const players = (
					await idb.cache.players.indexGetAll("playersByTid", tid)
				).sort((a, b) => b.valueNoPot - a.valueNoPot);
				const fit = rosterSchemeFit(players.map(fitRatingsOf));
				const c = randomCoach(random, teams.length);
				const profile = deriveCoachProfile(c);
				teams.push({
					profile,
					head: c.ratings,
					offFit: fit.off[profile.off],
					defFit: fit.def[profile.def],
					sim: coachSimEffects({
						profile,
						head: c.ratings,
						install,
						offFit: fit.off[profile.off],
						defFit: fit.def[profile.def],
						style: c.style,
					}),
					players: structuredClone(players),
				});
			}
		});
	}
	const normalized = normalizeCoachSims(teams.map((t) => t.sim));
	for (const [i, t] of teams.entries()) {
		t.sim = normalized[i]!;
	}
	return teams;
};

export type GameRow = {
	// league team index of each side
	idx: [number, number];
	team: any[];
	sims: [CoachSim | undefined, CoachSim | undefined];
};

// Each pair of rosters (generated together) plays gamesPerPair games, alternating home court. With coaches false, the same rosters and seeds
// without coaching systems
export const simLeague = async ({
	league,
	seed,
	gamesPerPair,
	coaches,
	settings = {},
	playoffs = false,
}: {
	league: LeagueTeam[];
	seed: number;
	gamesPerPair: number;
	coaches: boolean;
	settings?: Record<string, unknown>;
	playoffs?: boolean;
}) => {
	const rows: GameRow[] = [];
	for (let pair = 0; pair * 2 < league.length; pair++) {
		await withSeededRandom(seed * 7919 + pair * 104729, async () => {
			await genTeams();
			// (the same rosters as when the league was made)
			for (const p of await idb.cache.players.getAll()) {
				await idb.cache.players.delete(p.pid);
			}
			for (const tid of [0, 1]) {
				for (const p of league[pair * 2 + tid]!.players) {
					await idb.cache.players.put(structuredClone(p));
				}
			}
			g.setWithoutSavingToDB("storePlayByPlay", false);
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			if (playoffs) {
				g.setWithoutSavingToDB("phase", 3);
			}
			for (const i of range(gamesPerPair)) {
				const teams = await loadTeams([0, 1], {});
				const sims: [CoachSim | undefined, CoachSim | undefined] = [
					undefined,
					undefined,
				];
				for (const tid of [0, 1]) {
					if (coaches) {
						const sim = { ...league[pair * 2 + tid]!.sim };
						(teams[tid] as any).coachSim = sim;
						sims[tid] = sim;
					}
				}
				const home = i % 2;
				const pairTeams: [any, any] = [teams[home]!, teams[1 - home]!];
				const sim = new GameSim({
					gid: pair * 1000 + i,
					teams: pairTeams,
					baseInjuryRate: 0,
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				const result = sim.run();
				rows.push({
					idx: [pair * 2 + home, pair * 2 + 1 - home],
					team: result.team,
					sims: [sims[home], sims[1 - home]],
				});
			}
		});
	}
	return rows;
};

const KEYS = [
	"pts",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ast",
	"tov",
	"orb",
	"drb",
	"fta",
	"stl",
	"blk",
	"pf",
] as const;

// Per team-game box score averages, and possessions (FGA + 0.44 FTA - ORB + TOV)
export const boxAverages = (rows: GameRow[]) => {
	const sums: Record<string, number> = {};
	for (const key of KEYS) {
		sums[key] = 0;
	}
	let poss = 0;
	let n = 0;
	for (const row of rows) {
		for (const t of row.team) {
			for (const key of KEYS) {
				sums[key]! += t.stat[key];
			}
			poss += t.stat.fga + 0.44 * t.stat.fta - t.stat.orb + t.stat.tov;
			n += 1;
		}
	}
	const out: Record<string, number> = {};
	for (const key of KEYS) {
		out[key] = sums[key]! / n;
	}
	out.fgp = sums.fg! / sums.fga!;
	out.tpp = sums.tp! / sums.tpa!;
	out.tpaRate = sums.tpa! / sums.fga!;
	out.orbp = sums.orb! / (sums.orb! + sums.drb!);
	out.poss = poss / n;
	return out;
};

// Per league team: its rates over its games (3PA rate, pace, ORB%, turnovers forced per 100 possessions, net rating)
export const teamRates = (rows: GameRow[], numTeams: number) => {
	const acc = range(numTeams).map(() => ({
		fga: 0,
		tpa: 0,
		orb: 0,
		oppDrb: 0,
		poss: 0,
		oppTov: 0,
		pts: 0,
		oppPts: 0,
		games: 0,
		won: 0,
	}));
	for (const row of rows) {
		for (const side of [0, 1]) {
			const a = acc[row.idx[side]!]!;
			const t = row.team[side].stat;
			const o = row.team[1 - side].stat;
			a.fga += t.fga;
			a.tpa += t.tpa;
			a.orb += t.orb;
			a.oppDrb += o.drb;
			a.poss += t.fga + 0.44 * t.fta - t.orb + t.tov;
			a.oppTov += o.tov;
			a.pts += t.pts;
			a.oppPts += o.pts;
			a.games += 1;
			a.won += t.pts > o.pts ? 1 : 0;
		}
	}
	return acc.map((a) => ({
		tpaRate: a.tpa / a.fga,
		pace: a.poss / a.games,
		orbp: a.orb / (a.orb + a.oppDrb),
		tovForced: (100 * a.oppTov) / a.poss,
		net: (100 * (a.pts - a.oppPts)) / a.poss,
		winPct: a.won / a.games,
	}));
};
