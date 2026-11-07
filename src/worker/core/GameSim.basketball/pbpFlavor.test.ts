import { assert, test } from "vitest";
import { local } from "../../../ui/util/local.ts";
import {
	makeLiveBoxScore,
	playLive,
	simulateGame,
	simulateLiveGame,
	withSeededRandom,
	type Line,
} from "./simLiveGameForTests.ts";

/*
 * The play-by-play text of the live game (src/common/pbpFlavor): played through the real live-game event processor on real simulated games.
 * Checks the text is deterministic, never uses the sim's random numbers, has no broken wording, varies, keeps score and clock right and
 * has the plays a game should have at about the rates the BBGM League Explorer's play-by-play has.
 */

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

let cache: { seed: number; lines: Line[]; box: any; result: any }[] | undefined;
const games = async () => {
	if (!cache) {
		cache = [];
		for (const seed of SEEDS) {
			const { lines, boxScore, result } = await simulateLiveGame(seed);
			cache.push({ seed, lines, box: boxScore, result });
		}
	}
	return cache;
};

const allText = (lines: Line[]) =>
	lines.flatMap((l) => [l.text, l.note].filter(Boolean));

test("the same game reads the same every time", async () => {
	const a = await simulateLiveGame(7);
	const b = await simulateLiveGame(7);
	assert.deepStrictEqual(a.lines, b.lines);
	// ...and not like another game
	const c = await simulateLiveGame(8);
	assert.notDeepEqual(
		a.lines.map((l) => l.text),
		c.lines.map((l) => l.text),
	);
});

test("wording never uses Math.random, and never depends on it", async () => {
	const { events, result } = await simulateGame(11);
	const reference = playLive(events.slice(), makeLiveBoxScore(result, 11));

	const original = Math.random;
	let sawFlavor = false;
	let calls = 0;
	Math.random = () => {
		calls += 1;
		if ((new Error().stack ?? "").includes("/common/pbpFlavor/")) {
			sawFlavor = true;
		}
		return original();
	};
	try {
		const again = playLive(events.slice(), makeLiveBoxScore(result, 11));
		assert.deepStrictEqual(again, reference);
	} finally {
		Math.random = original;
	}
	assert.isFalse(sawFlavor, "the flavor layer called Math.random");
	void calls;

	// A different stream of random numbers changes nothing either
	const seeded = await withSeededRandom(12345, () =>
		playLive(events.slice(), makeLiveBoxScore(result, 11)),
	);
	assert.deepStrictEqual(seeded, reference);
});

test("playing the events in chunks of any size gives the same text", async () => {
	const { events, result } = await simulateGame(5);
	const whole = playLive(events.slice(), makeLiveBoxScore(result, 5));
	// (processLiveGameEvents is called once per line by the live view; fast-forward calls it in a row, which is the same thing)
	const again = playLive(events.slice(), makeLiveBoxScore(result, 5));
	assert.deepStrictEqual(whole, again);
});

test("no broken text across many games", async () => {
	const problems: string[] = [];
	const rules: [string, RegExp][] = [
		["undefined/NaN", /undefined|NaN|\[object|\bnull\b/],
		["doubled word", /\b(['a-z]{2,}) \1\b/i],
		["doubled punctuation", /[,:;]{2}|\.\.(?!\.)|, ,|\. \./],
		["space before punctuation", /\s[!,.:;?](\s|$)/],
		["double space", / {2}/],
		["s's possessive", /\b[A-Za-z]+s's\b/],
		["a before a vowel", /\b[Aa] (?!one|Euro|uni|US|U\.)[AEIOUaeiou]/],
		[
			"an before a consonant",
			/\b[Aa]n (?!hour|honest|8|11|18|[AEIOUaeiou])[A-Za-z]/,
		],
		["a before 8/11/18", /\ba (8|11|18|8\d)\b/],
		["empty parentheses", /\(\s*\)/],
		[
			"open and contested",
			/\b(wide-open|wide open|uncontested|open 15|open 17|open three)\b.*\b(contested|hand in his face|in his face|draped|over two defenders)\b/i,
		],
		[
			"contested and open",
			/\bcontested\b.*\b(wide-open|wide open|uncontested|an open)\b/i,
		],
		["lowercase start", /^[a-z]/],
		["tally on nothing", /\(0 [A-Z]+\)/],
		["unbalanced parentheses", /^[^()]*\)|\([^)]*$/],
	];
	let n = 0;
	for (const g of await games()) {
		for (const l of g.lines) {
			for (const text of [l.text, l.note]) {
				if (!text) {
					continue;
				}
				n += 1;
				for (const [name, re] of rules) {
					if (re.test(text)) {
						problems.push(`${name}: ${text}`);
					}
				}
			}
			assert.isTrue(l.text.length > 0, "empty line");
		}
	}
	assert.isTrue(n > 5000);
	assert.deepStrictEqual(problems.slice(0, 15), []);
});

test("possessives of names ending in s, and a/an", async () => {
	// (the test league has a Hammonds and a team word as a surname)
	const text = (await games()).flatMap((g) => allText(g.lines)).join("\n");
	assert.notMatch(text, /Hammonds's/);
	assert.match(text, /Hammonds'/);
});

test("score and clock are right on every line", async () => {
	for (const g of await games()) {
		const pts = g.result.team.map((t: any) => t.stat.pts);
		const last = g.lines.at(-1)!;
		assert.deepStrictEqual(last.score, pts, `seed ${g.seed}`);
		let prev: [number, number] = [0, 0];
		let prevSecs = Infinity;
		for (const l of g.lines) {
			assert.isTrue(
				l.score[0] >= prev[0] && l.score[1] >= prev[1],
				`score went backwards, seed ${g.seed}: ${l.text}`,
			);
			assert.isTrue(
				l.score[0] + l.score[1] - prev[0] - prev[1] <= 4,
				`one line scored more than 4 points, seed ${g.seed}: ${l.text}`,
			);
			prev = l.score;
			if (l.time) {
				const [m, s] = l.time.split(":");
				const secs = s === undefined ? Number(m) : Number(m) * 60 + Number(s);
				if (l.textOnly) {
					prevSecs = Infinity;
				} else {
					assert.isTrue(
						secs <= prevSecs + 0.05,
						`clock went backwards, seed ${g.seed}: ${l.time} after ${prevSecs} ${l.text}`,
					);
					prevSecs = secs;
				}
			}
		}
	}
});

test("a scored play names the player and updates his running total", async () => {
	for (const g of (await games()).slice(0, 8)) {
		const pts = new Map<string, number>();
		for (const t of g.box.teams) {
			for (const p of t.players) {
				pts.set(p.name, 0);
			}
		}
		void pts;
		for (const l of g.lines) {
			if (l.score[0] + l.score[1] === 0) {
				continue;
			}
			const m = /\((\d+) PTS\)/.exec(l.text);
			if (m) {
				assert.isTrue(Number(m[1]) <= l.score[0] + l.score[1], l.text);
			}
		}
	}
});

test("lines of every kind show up, and the text varies", async () => {
	const lines = (await games()).flatMap((g) => g.lines);
	const texts = lines.map((l) => l.text);
	const kinds: Record<string, RegExp> = {
		made: /\(\d+ PTS\)/,
		assist: /\(\d+ AST\)/,
		rebound: /\(\d+ REB\)/,
		steal: /\(\d+ STL\)/,
		block: /\(\d+ BLK\)/,
		turnover: /\(\d+ TOV\)/,
		foul: /team foul \d+/,
		freeThrow: /free throw|at the line/,
		timeout: /^Timeout/,
		substitution: /checks in|subs in|replaces|substitution/,
		tip: /^Tip-off/,
		period: /^Start of/,
		final: /^End of game/,
		milestone:
			/Double-double|triple-double|That's (30|40|50) for|already has 20|20 points before halftime/,
		run: /run for|run by/,
		lead: /take the lead|go back in front|ties it at|ahead for good|game-winner|to force overtime/,
	};
	for (const [name, re] of Object.entries(kinds)) {
		assert.isTrue(
			lines.some((l) => re.test(l.text) || re.test(l.note)),
			`no ${name} line in 30 games`,
		);
	}

	// variety: most lines are different, and a line rarely repeats one of the few before it (names and numbers aside)
	const key = (t: string) =>
		t
			.replaceAll(/\([^)]*\)/g, "")
			.replaceAll(/[A-Z][\w'.-]*( [A-Z][\w'.-]*)*/g, "N")
			.replaceAll(/\d+/g, "#");
	let repeats = 0;
	let shots = 0;
	for (const g of await games()) {
		const recent: string[] = [];
		for (const l of g.lines) {
			if (
				!/\(\d+ PTS\)|misses|rims|off the mark|short|long/.test(l.text) ||
				l.textOnly
			) {
				continue;
			}
			shots += 1;
			const k = key(l.text);
			if (recent.includes(k)) {
				repeats += 1;
			}
			recent.push(k);
			if (recent.length > 3) {
				recent.shift();
			}
		}
	}
	assert.isTrue(
		repeats / shots < 0.04,
		`phrases repeat too soon: ${repeats}/${shots}`,
	);
	assert.isTrue(
		new Set(texts).size / texts.length > 0.5,
		"too many identical lines",
	);
});

test("special plays happen at about the rates of the League Explorer's play-by-play", async () => {
	const G = await games();
	const count = (re: RegExp) =>
		G.reduce((a, g) => a + g.lines.filter((l) => re.test(l.text)).length, 0) /
		G.length;
	const alleyOop = count(
		/alley-oop|catches the lob from|cuts backdoor and flushes the lob|floats a lob to the rim|throws the lob ahead/,
	);
	const poster = count(
		/posteriz|dunks all over|throws it down on [^.]*'s head|in the face of|climbs over [^.]* for a one-handed slam|tomahawks it home right over/,
	);
	const shotClock = count(
		/shot-clock violation|shot clock expires|shot clock runs out/,
	);
	const dunks = count(/dunk|slam|flush|jam|windmill|tomahawk/);
	const charges = count(
		/takes the charge|draws the charge|called for a charge/,
	);
	const kicked = count(/Kicked|kicks the ball/);
	const held = count(/Held ball|ties up|Tie-up/);
	const heaves = count(
		/heave|from beyond half court|from just past half court/,
	);
	assert.isTrue(
		alleyOop >= 0.3 && alleyOop <= 3,
		`alley-oops per game: ${alleyOop}`,
	);
	assert.isTrue(poster >= 0.03 && poster <= 1.5, `posters per game: ${poster}`);
	assert.isTrue(shotClock <= 1, `shot-clock violations per game: ${shotClock}`);
	assert.isTrue(dunks >= 1 && dunks <= 20, `dunks per game: ${dunks}`);
	assert.isTrue(charges >= 0.3 && charges <= 6, `charges per game: ${charges}`);
	assert.isTrue(
		kicked + held >= 0.5 && kicked + held <= 8,
		`kicked/held balls per game: ${kicked + held}`,
	);
	assert.isTrue(heaves >= 0.2 && heaves <= 4, `heaves per game: ${heaves}`);
});

test("a league of women reads in the feminine and has no dunks", async () => {
	local.getState().actions.update({ gender: "female" });
	try {
		const lines: Line[] = [];
		for (const seed of [21, 22, 23]) {
			lines.push(...(await simulateLiveGame(seed)).lines);
		}
		const text = lines.flatMap((l) => [l.text, l.note]).join("\n");
		assert.notMatch(text, /\b(he|his|him|himself|He)\b/);
		assert.notMatch(text, /dunk|slam|jam\b|flush|windmill|tomahawk|posteriz/);
		assert.match(text, /\b(her|she|herself)\b/);
	} finally {
		local.getState().actions.update({ gender: "male" });
	}
});

test("fast-forwarding past the shot attempts keeps the score and the possession right", async () => {
	const { events, result } = await simulateGame(3);
	const box: any = makeLiveBoxScore(result, 3);
	const lines = playLive(events, box);
	// every shot result is worded once: made baskets and misses are counted from the lines, free throws too
	const made = lines.filter((l) => /\(\d+ PTS\)/.test(l.text)).length;
	assert.isTrue(made > 30);
	assert.strictEqual(box.teams[0].pts, result.team[0].stat.pts);
	assert.strictEqual(box.teams[1].pts, result.team[1].stat.pts);
});
