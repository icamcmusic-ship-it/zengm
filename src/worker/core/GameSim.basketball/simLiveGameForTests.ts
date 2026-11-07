// Test support: simulates a game with the real sim and plays its events through the real live-game event processor (the same code the live
// view runs), returning each line of text with the score and clock at that moment.
import GameSim from "./index.ts";
import { player, team } from "../index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import processLiveGameEvents from "../../../ui/util/processLiveGameEvents.basketball.tsx";

export type Line = {
	text: string;
	// a team's index, when the line has a team logo
	t: 0 | 1 | undefined;
	textOnly: boolean;
	score: [number, number];
	time: string | undefined;
	// the plain text of the second line, if any
	note: string;
};

// A ReactNode made of strings, fragments and elements, as text; a <br> becomes a newline
export const nodeToText = (node: any): string => {
	if (node === null || node === undefined || typeof node === "boolean") {
		return "";
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(nodeToText).join("");
	}
	if (node.type === "br") {
		return "\n";
	}
	return nodeToText(node.props?.children);
};

export const withSeededRandom = async <T>(
	seed: number,
	fn: () => Promise<T> | T,
) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const FIRST = [
	"Marcus",
	"DeShawn",
	"Tyler",
	"Jalen",
	"Chris",
	"Andre",
	"Luka",
	"Jamal",
	"Kevin",
	"Brandon",
	"Isaiah",
	"Malik",
	"Devin",
	"Cole",
	"Trae",
	"Anthony",
	"Zion",
	"Kyle",
	"Jaylen",
	"Darius",
	"Miles",
	"Terrence",
	"Elijah",
	"Nikola",
	"Giannis",
];
// Names that stress the text: names ending in s, suffixes, apostrophes, hyphens, particles, a name that is also a team word
const LAST = [
	"Hammonds",
	"Smith",
	"Davis Jr.",
	"O'Neal",
	"Garcia-Lopez",
	"Johnson",
	"Williams",
	"Brown",
	"Ross",
	"Young",
	"Hughes",
	"Jackson III",
	"St. Pierre",
	"Mills",
	"Adebayo",
	"Thomas",
	"Heat",
	"Rivers",
	"Lewis",
	"De La Cruz",
	"Carter",
	"Banks",
	"Wallace",
	"Harris",
	"Moore",
];

export const genTeams = async (playersPerTeam = 15) => {
	resetG();
	g.setWithoutSavingToDB("season", 2013);
	const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
	// Draw a bigger pool and keep the best of it, so the rosters look like those of a real league
	const pool = range(playersPerTeam * 6).map(() =>
		player.generate(0, 19, 2010, true, DEFAULT_LEVEL),
	);
	for (const [i, p] of pool.entries()) {
		await player.develop(p, 2 + (i % 6), true);
		p.valueNoPot = p.ratings.at(-1)!.ovr;
		p.valueNoPotFuzz = p.valueNoPot;
	}
	pool.sort((a, b) => b.valueNoPot - a.valueNoPot);
	const players: any[] = [];
	for (const [i, p] of pool.slice(0, playersPerTeam * 2).entries()) {
		p.tid = i % 2;
		players.push(p);
	}
	// The best players first, as on a real roster
	for (const tid of [0, 1]) {
		const roster = players
			.filter((p) => p.tid === tid)
			.sort((a, b) => b.valueNoPot - a.valueNoPot);
		for (const [i, p] of roster.entries()) {
			p.rosterOrder = i;
		}
	}
	for (const [i, p] of players.entries()) {
		p.firstName = FIRST[(i * 7 + 3) % FIRST.length];
		p.lastName = LAST[(i * 11 + 5) % LAST.length];
	}
	await resetCache({
		players,
		teams: teamsDefault.map(team.generate),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
};

export const simulateGame = (seed: number) => {
	return withSeededRandom(seed, async () => {
		await genTeams();
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: true,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return { result, events: result.playByPlay!.slice() as any[], seed };
	});
};

const zeroStats = {
	min: 0,
	fg: 0,
	fga: 0,
	tp: 0,
	tpa: 0,
	ft: 0,
	fta: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	tov: 0,
	stl: 0,
	blk: 0,
	ba: 0,
	pf: 0,
	pts: 0,
	pm: 0,
};

// The box score the live view starts from: both teams and every player, all stats at 0
export const makeLiveBoxScore = (
	result: Awaited<ReturnType<typeof simulateGame>>["result"],
	seed: number,
) => ({
	gid: seed,
	numPeriods: 4,
	quarter: "",
	time: "12:00",
	teams: result.team.map((t, i) => ({
		tid: i,
		region: ["Boston", "Dallas"][i],
		name: ["Celtics", "Mavericks"][i],
		abbrev: ["BOS", "DAL"][i],
		...zeroStats,
		ptsQtrs: [] as number[],
		players: t.player.map((p) => ({
			pid: p.id,
			name: p.name,
			pos: p.pos,
			inGame: false,
			injury: { type: "Healthy", gamesRemaining: 0 },
			...zeroStats,
		})),
	})),
});

// Plays every event through the processor, as the live view does
export const playLive = (events: any[], boxScore: any) => {
	const lines: Line[] = [];
	let overtimes = 0;
	let quarters: string[] = [];
	while (events.length > 0) {
		const out = processLiveGameEvents({
			events,
			boxScore,
			overtimes,
			quarters,
		});
		overtimes = out.overtimes;
		quarters = out.quarters;
		if (out.text !== undefined) {
			const full = nodeToText(out.text);
			const [main, ...rest] = full.split("\n");
			lines.push({
				text: main ?? "",
				t: out.t,
				textOnly: out.textOnly,
				score: [boxScore.teams[0].pts, boxScore.teams[1].pts],
				time: boxScore.time,
				note: rest.join(" "),
			});
		}
	}
	return lines;
};

export const simulateLiveGame = async (seed: number) => {
	const { result, events } = await simulateGame(seed);
	const boxScore: any = makeLiveBoxScore(result, seed);
	const lines = playLive(events, boxScore);
	return { lines, boxScore, result };
};
