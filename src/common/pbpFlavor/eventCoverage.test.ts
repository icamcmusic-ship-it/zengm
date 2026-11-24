import { assert, test } from "vitest";
import type { PlayByPlayEventOutput } from "../../worker/core/GameSim.basketball/PlayByPlayLogger.ts";
import { FlavorSession } from "./session.ts";

/*
 * Every event type the basketball sim logs is either worded by the flavor session (describe returns a line, or "silent" for the start of
 * a shot, which its result words) or on purpose left to the plain wording of processLiveGameEvents (describe returns undefined). The
 * record below must list every type (a new type fails the typecheck until it is added here), and each is checked at run time.
 */
const HANDLED: Record<PlayByPlayEventOutput["type"], "flavor" | "fallback"> = {
	fgAtRim: "flavor",
	fgAtRimAndOne: "flavor",
	fgLowPost: "flavor",
	fgLowPostAndOne: "flavor",
	fgMidRange: "flavor",
	fgMidRangeAndOne: "flavor",
	tp: "flavor",
	tpAndOne: "flavor",
	fgTipIn: "flavor",
	fgTipInAndOne: "flavor",
	fgPutBack: "flavor",
	fgPutBackAndOne: "flavor",
	ft: "flavor",
	missFt: "flavor",
	blkAtRim: "flavor",
	blkLowPost: "flavor",
	blkMidRange: "flavor",
	blkTp: "flavor",
	blkTipIn: "flavor",
	blkPutBack: "flavor",
	missPutBack: "flavor",
	missAtRim: "flavor",
	missLowPost: "flavor",
	missMidRange: "flavor",
	missTp: "flavor",
	missTipIn: "flavor",
	pfNonShooting: "flavor",
	pfBonus: "flavor",
	pfFG: "flavor",
	pfTP: "flavor",
	drb: "flavor",
	orb: "flavor",
	foulOut: "flavor",
	injury: "flavor",
	knock: "flavor",
	knockReturn: "flavor",
	techFoul: "flavor",
	flagrantFoul: "flavor",
	ejection: "flavor",
	fgaAtRim: "flavor",
	fgaLowPost: "flavor",
	fgaMidRange: "flavor",
	fgaPutBack: "flavor",
	fgaTp: "flavor",
	fgaTpFake: "flavor",
	fgaTipIn: "flavor",
	jumpBall: "flavor",
	gameOver: "flavor",
	overtime: "flavor",
	period: "flavor",
	stl: "flavor",
	sub: "flavor",
	tov: "flavor",
	offFoul: "flavor",
	elamActive: "flavor",
	timeout: "flavor",
	endOfPeriod: "flavor",
	outOfBounds: "flavor",
	shootoutStart: "flavor",
	shootoutTeam: "flavor",
	shootoutShot: "flavor",
	shootoutTie: "flavor",
	// (no text at all: processLiveGameEvents only updates the timeouts left in the box score, and never passes it to describe)
	timeouts: "fallback",
};

// Every field any event type has, with plausible values: the two teams' players are 1-5 and 11-15
const eventOf = (type: string): any => ({
	type,
	t: 0,
	pid: 1,
	pid2: 11,
	pidDefense: 11,
	pidAst: 2,
	pidFoul: undefined,
	pidShooting: 11,
	pidTov: 11,
	pidPass: 2,
	pids: [6],
	pidsOff: [5],
	clock: 300,
	period: 2,
	num: 1,
	level: 1,
	reason: type === "endOfPeriod" ? "runOutClock" : "techs",
	back: true,
	outOfBounds: false,
	desperation: false,
	numLeft: 3,
	advancesBall: false,
	on: "offense",
	rounds: 5,
	made: true,
	target: 110,
	timeouts: [3, 3],
});

const session = () => {
	const players = [];
	for (const t of [0, 1] as const) {
		for (let i = 1; i <= 7; i++) {
			players.push({
				pid: t * 10 + i,
				name: `Player${t * 10 + i} Name${t * 10 + i}`,
				pos: "G",
				t,
				ratings: undefined,
			});
		}
	}
	return new FlavorSession({
		gid: 3,
		numPeriods: 4,
		quarterLength: 12,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players,
	});
};

const host = {
	stat: () => undefined,
	score: () => [98, 91] as [number, number],
	onCourt: (t: 0 | 1) => [1, 2, 3, 4, 5].map((i) => t * 10 + i),
};

test("every play-by-play event type is worded by the flavor session or on purpose left to the plain wording", () => {
	for (const [type, how] of Object.entries(HANDLED)) {
		if (type === "timeouts") {
			continue;
		}
		const s = session();
		// (a shot's result is worded with its attempt)
		if (!type.startsWith("fga")) {
			s.describe(eventOf("fgaMidRange"), host as any);
		}
		const r = s.describe(eventOf(type), host as any);
		if (how === "flavor") {
			assert.isDefined(r, type);
			if (typeof r === "object") {
				// (keepText: the plain line, with a note of its own)
				const words = `${r.text} ${r.note ?? ""}`.trim();
				assert.isAbove(words.length, 0, type);
				assert.notMatch(words, /undefined|NaN/, type);
			} else {
				assert.strictEqual(r, "silent", type);
			}
		} else {
			assert.isUndefined(r, type);
		}
	}
});

test("the Elam Ending line says where each team stands", () => {
	const r: any = session().describe(eventOf("elamActive"), host as any);
	assert.include(r.text, "110");
	assert.include(r.text, "the Celtics up 98-91");
	assert.include(r.text, "need 12 more");
	assert.include(r.text, "the Mavericks need 19");
});
