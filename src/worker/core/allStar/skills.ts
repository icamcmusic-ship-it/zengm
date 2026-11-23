// Skills challenge (the allStarSkills setting, basketball): a timed obstacle course with four stations, a dribbling slalom
// (handle), passing targets (accuracy: a miss costs time and another try), a jumper that must go in before moving on, and a
// sprint to a layup at the far end. Everyone runs once; the two fastest run the final. Simulated on its own seeded stream.
import type {
	AllStarPlayer,
	AllStars,
	Conditions,
	Player,
	SkillsRun,
} from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { updatePlayerAwards } from "../awards/awardsByPlayer.ts";
import { courtOf, skillsTalent, weekendRandom } from "./weekend.ts";

export const NUM_PLAYERS_SKILLS = 6;
// Of the field, this many are bigs (frontcourt), for the guards vs bigs showcase
const NUM_BIGS = 2;

type Skills = NonNullable<AllStars["skills"]>;

const gauss = (rand: () => number) => {
	const u = Math.max(1e-12, rand());
	const v = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const round1 = (x: number) => Math.round(x * 10) / 10;

// The season's assists, steals and turnovers per game and 3P%: the stats half of the invitation
const seasonLine = (p: Player, season: number) => {
	let gp = 0;
	let ast = 0;
	let tov = 0;
	let tp = 0;
	let tpa = 0;
	for (const row of p.stats) {
		if (row.season === season && !row.playoffs) {
			gp += row.gp ?? 0;
			ast += row.ast ?? 0;
			tov += row.tov ?? 0;
			tp += row.tp ?? 0;
			tpa += row.tpa ?? 0;
		}
	}
	return {
		gp,
		astPerGame: gp > 0 ? ast / gp : 0,
		tovPerGame: gp > 0 ? tov / gp : 0,
		tpp: tpa >= 20 ? tp / tpa : 0.33,
	};
};

const inviteScore = (p: Player, season: number) => {
	const t = skillsTalent(p);
	const line = seasonLine(p, season);
	return (
		(t.handle + t.pass + t.shoot + t.speed) / 4 +
		1.5 * Math.min(10, line.astPerGame) -
		1 * Math.min(5, line.tovPerGame) +
		30 * (line.tpp - 0.33)
	);
};

// The field: the best by skills and this season's play, NUM_BIGS of them bigs. Needs at least 2 healthy players
export const pickSkillsField = (
	activePlayers: Player[],
	season: number,
): Skills | undefined => {
	const healthy = activePlayers.filter((p) => p.injury.gamesRemaining === 0);
	const ranked = orderBy(
		healthy,
		[(p) => inviteScore(p, season), (p) => p.pid],
		["desc", "asc"],
	);
	const bigs = ranked
		.filter((p) => courtOf(p.ratings.at(-1)!.pos) === "frontcourt")
		.slice(0, NUM_BIGS);
	const rest = ranked
		.filter((p) => !bigs.includes(p))
		.slice(0, NUM_PLAYERS_SKILLS - bigs.length);
	const field = [...rest, ...bigs];
	if (field.length < 2) {
		return undefined;
	}
	const players: AllStarPlayer[] = field.map((p) => ({
		pid: p.pid,
		tid: p.tid,
		name: `${p.firstName} ${p.lastName}`,
	}));
	// Running order: the stream for this season, so it's the same every time
	const rand = weekendRandom(season, "skillsOrder");
	const indexes = players.map((_, i) => i);
	for (let i = indexes.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
	}
	return {
		players,
		rounds: [{ indexes, runs: [] }],
	};
};

// One trip through the course
export const runCourse = (
	t: ReturnType<typeof skillsTalent>,
	rand: () => number,
	index: number,
): SkillsRun => {
	const f = (x: number) => Math.min(1, Math.max(0, x / 100));

	// Dribbling slalom, and maybe losing the ball on a cone
	let handle = 11 - 4 * f(t.handle) + 0.5 * gauss(rand);
	if (rand() < 0.15 * (1 - f(t.handle))) {
		handle += 2.5;
	}
	handle = Math.max(5, handle);

	// Passing: hit the target to move on (three tries, then he moves on anyway)
	let pass = 0;
	let passMisses = 0;
	for (let i = 0; i < 3; i++) {
		pass += 2.2 + 0.4 * rand();
		if (rand() < 0.3 + 0.6 * f(t.pass)) {
			break;
		}
		passMisses += 1;
	}

	// The jumper must go in (at most 8 tries)
	let shoot = 0;
	let shotMisses = 0;
	for (let i = 0; i < 8; i++) {
		shoot += 2.2 + 0.5 * rand();
		if (rand() < 0.25 + 0.5 * f(t.shoot)) {
			break;
		}
		shotMisses += 1;
	}

	// The sprint to a layup at the other end
	let sprint = 7.5 - 2.5 * f(t.speed) + 0.3 * gauss(rand);
	if (rand() < 0.06) {
		sprint += 2;
	}
	sprint = Math.max(4, sprint);

	handle = round1(handle);
	pass = round1(pass);
	shoot = round1(shoot);
	sprint = round1(sprint);
	return {
		index,
		time: round1(handle + pass + shoot + sprint),
		handle,
		pass,
		shoot,
		sprint,
		passMisses,
		shotMisses,
	};
};

// Fastest first; a tie goes to the faster first-round time, then running order
export const rankRuns = (skills: Skills, roundIndex: number) => {
	const round = skills.rounds[roundIndex]!;
	const first = new Map(skills.rounds[0]!.runs.map((r) => [r.index, r.time]));
	return orderBy(
		round.runs,
		[
			"time",
			(r) => first.get(r.index) ?? Infinity,
			(r) => round.indexes.indexOf(r.index),
		],
		["asc", "asc", "asc"],
	);
};

export const simSkills = async (conditions: Conditions) => {
	const season = g.get("season");
	const allStars = await idb.cache.allStars.get(season);
	const skills = allStars?.skills;
	if (!allStars || !skills || skills.winner !== undefined) {
		return;
	}

	const rand = weekendRandom(season, "skills");
	const talents = new Map<number, ReturnType<typeof skillsTalent>>();
	for (const [i, entry] of skills.players.entries()) {
		const p = await idb.cache.players.get(entry.pid);
		talents.set(
			i,
			p ? skillsTalent(p) : { handle: 0, pass: 0, shoot: 0, speed: 0 },
		);
	}

	const run = (roundIndex: number) => {
		const round = skills.rounds[roundIndex]!;
		round.runs = round.indexes.map((index) =>
			runCourse(talents.get(index)!, rand, index),
		);
	};

	// Start over if a run was saved half done
	skills.rounds = skills.rounds.slice(0, 1);
	run(0);
	if (skills.players.length > 2) {
		const finalists = rankRuns(skills, 0)
			.slice(0, 2)
			.map((r) => r.index);
		skills.rounds.push({ indexes: finalists, runs: [] });
		run(1);
	}
	skills.winner = rankRuns(skills, skills.rounds.length - 1)[0]!.index;

	await idb.cache.allStars.put(allStars);

	const p = skills.players[skills.winner]!;
	await updatePlayerAwards({
		awardsToDelete: [],
		awardsToSave: [
			{
				pid: p.pid,
				tid: p.tid,
				name: p.name,
				award: { type: "Skills Challenge Winner" },
			},
		],
		logEventInfo: { conditions },
		season,
	});
};
