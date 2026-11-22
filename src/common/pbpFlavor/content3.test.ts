import { assert, test } from "vitest";
import {
	madeShot,
	passWord,
	rebText,
	shotOptions,
	tovText,
} from "./phrases.ts";
import {
	foulOutText,
	nonShootingFoul,
	outOfBounds,
	shootingFoul,
} from "./plays.ts";
import { beatClockText, classifyShot } from "./calls.ts";
import { FlavorSession, type FlavorHost } from "./session.ts";
import { Rng } from "./rng.ts";
import { VarietyMemory, setVariety } from "./variety.ts";
import { RATING_KEYS, type FPlayer, type Ratings } from "./types.ts";

/*
 * The play types added in the third content round, each only where the sim's events support it: the give-and-go (an assisted basket at
 * the rim), the stealer's assist on the break, the offensive rebounder's kick-out, the strip of a rebounder, a held ball lost on the
 * possession arrow, the rebound of his own miss and of an airball, a foul to give, a foul that stops a break, a break started by a
 * block, threes traded on back-to-back possessions, and the delay-of-game warning.
 */

const BAD = /undefined|NaN|\bnull\b|\[object|\${|[{}]| {2}|^\s|\s$/;

const ratings = (v: number, o: Partial<Ratings> = {}): Ratings => {
	const R: any = {};
	for (const k of RATING_KEYS) {
		R[k] = v;
	}
	return { ...R, ...o };
};

const NAMES = [
	"Joe Smith",
	"Marcus Hammonds",
	"Andre Davis Jr.",
	"Shaq O'Neal",
	"Jose Garcia-Lopez",
	"Luka De La Cruz",
	"Ty Banks",
	"Cole Rivers",
	"Dante Ashford",
	"Silas Thornton",
];

const players: FPlayer[] = NAMES.map((name, i) => ({
	pid: i,
	name,
	pos: "G",
	t: (i % 2) as 0 | 1,
	R: ratings(40 + i * 6),
}));

const ctxFor = (rng: Rng, p: FPlayer, o: Record<string, unknown> = {}) => {
	const others = players.filter((q) => q.pid !== p.pid);
	return {
		trans: false,
		lastReb: null,
		gap: 10,
		late: false,
		inbound: false,
		mate: () => rng.pick(others),
		third: () => rng.pick(others),
		def: () => rng.pick(others),
		dmate: () => rng.pick(others),
		female: false,
		zone: false,
		press: false,
		beatClockText: () => beatClockText(rng),
		...o,
	};
};

const GNG = /gives it up|return (?:feed|pass)|takes it right back|give-and-go/;

test("a give-and-go is an assisted basket at the rim, and its pass is the return pass from the assister", () => {
	let seen = 0;
	for (let i = 0; i < 6000; i++) {
		setVariety(new VarietyMemory(NAMES));
		const rng = new Rng(11, i);
		const p = players[i % players.length]!;
		const ast = players[(i + 3) % players.length]!;
		const assisted = i % 2 === 0;
		const zone = (["rim", "post", "mid", undefined] as const)[
			i % 4 === 3 ? 3 : i % 3
		];
		const three = zone === undefined;
		const ctx: any = ctxFor(rng, p);
		const text = madeShot(
			rng,
			{
				p,
				three,
				zone,
				ast: assisted ? ast : undefined,
				andOne: false,
				putback: false,
				ti: 0,
			},
			ctx,
		);
		assert.notMatch(text, BAD, text);
		if (GNG.test(text)) {
			seen += 1;
			assert.isTrue(assisted, `unassisted give-and-go: ${text}`);
			assert.strictEqual(zone, "rim", text);
			assert.strictEqual(ctx.ptype, "give-and-go", text);
			assert.include(text, `from ${ast.name}`, text);
			// (said once: the shot says he cut, the pass says who gave it back)
			assert.isBelow(text.split("give-and-go").length, 3, text);
			assert.isBelow(text.split("right back").length, 3, text);
		} else {
			assert.notStrictEqual(ctx.ptype, "give-and-go", text);
		}
	}
	assert.isAbove(seen, 10, "give-and-go lines");
	// its rows are assisted-only rows, and read as a layup or a dunk
	for (const p of players) {
		for (const x of shotOptions(
			{ p, three: false, andOne: false, ast: players[0] },
			false,
			false,
			ctxFor(new Rng(1, 1), p),
		)) {
			if (x.pw === "gng") {
				assert.strictEqual(x.self, 2, x.t);
				assert.include(
					["layup", "dunk"],
					classifyShot(x.t.replaceAll(p.name, "N"), {
						three: false,
						zone: "rim",
						putback: false,
						inboundTip: false,
						fake: false,
						ptype: undefined,
					}),
					x.t,
				);
			}
		}
	}
});

test("the stealer's assist and the offensive rebounder's kick-out are only said of the player who made the steal or the rebound", () => {
	setVariety(new VarietyMemory(NAMES));
	const STEAL = /steal|takeaway/;
	const BOARD = /offensive rebound|offensive board|second-chance/;
	const seen = { steal: 0, board: 0 };
	for (let i = 0; i < 3000; i++) {
		const rng = new Rng(12, i);
		const passer = players[i % players.length]!;
		const other = players[(i + 1) % players.length]!;
		for (const cls of ["three", "mid", "post", "rim", "dunk"]) {
			// on the break, after a steal
			const mine = passWord(
				rng,
				passer,
				cls,
				ctxFor(rng, other, { trans: true, stealer: passer.pid }),
				undefined,
			);
			assert.notMatch(mine, BAD, mine);
			if (STEAL.test(mine)) {
				seen.steal += 1;
				assert.include(mine, passer.name);
			}
			for (const ctx of [
				{ trans: true, stealer: other.pid },
				{ trans: true },
				{ trans: false, stealer: passer.pid },
			]) {
				assert.notMatch(
					passWord(rng, passer, cls, ctxFor(rng, other, ctx), undefined),
					STEAL,
				);
			}
			// in the half court, after his offensive rebound
			const kick = passWord(
				rng,
				passer,
				cls,
				ctxFor(rng, other, { lastReb: { pid: passer.pid, own: false } }),
				undefined,
			);
			assert.notMatch(kick, BAD, kick);
			if (BOARD.test(kick)) {
				seen.board += 1;
				assert.include(kick, passer.name);
			}
			for (const ctx of [
				{ lastReb: { pid: other.pid, own: false } },
				{ lastReb: null },
			]) {
				assert.notMatch(
					passWord(rng, passer, cls, ctxFor(rng, other, ctx), undefined),
					BOARD,
				);
			}
		}
	}
	assert.isAbove(seen.steal, 100);
	assert.isAbove(seen.board, 100);
});

test("a rebounder is only stripped right after his rebound; a held ball is a dead-ball turnover that is not out of bounds", () => {
	setVariety(new VarietyMemory(NAMES));
	const DREB =
		/comes down with the rebound|after the rebound|rips the rebound|outlet/;
	const OREB = /offensive rebound|offensive board/;
	const HELD = /held ball|tied up|ties up/;
	const seen = { dreb: 0, oreb: 0, held: 0, travel: 0 };
	for (let i = 0; i < 4000; i++) {
		const rng = new Rng(13, i);
		const p = players[i % players.length]!;
		const stl = players[(i + 1) % players.length]!;
		const steal = (ctx: Record<string, unknown>) =>
			tovText(rng, { k: "tov", p, stl, ti: 0 }, ctxFor(rng, p, ctx));
		const a = steal({ defReb: p.pid, gap: 2 });
		assert.notMatch(a, BAD, a);
		if (DREB.test(a)) {
			seen.dreb += 1;
		}
		const b = steal({ lastReb: { pid: p.pid, own: false }, gap: 3 });
		assert.notMatch(b, BAD, b);
		if (OREB.test(b)) {
			seen.oreb += 1;
		}
		for (const ctx of [
			{ defReb: p.pid, gap: 9 },
			{ defReb: stl.pid, gap: 2 },
			{ lastReb: { pid: p.pid, own: false }, gap: 12 },
			{ lastReb: { pid: stl.pid, own: false }, gap: 2 },
			{},
		]) {
			const t = steal(ctx);
			assert.notMatch(t, DREB, t);
			assert.notMatch(t, OREB, t);
		}
		// turnovers without a steal
		const tov = (ctx: Record<string, unknown>) =>
			tovText(rng, { k: "tov", p, ti: 0 }, ctxFor(rng, p, ctx));
		const h = tov({ drawer: stl, oob: false, offFoul: true });
		assert.notMatch(h, BAD, h);
		if (HELD.test(h)) {
			seen.held += 1;
			assert.include(h, stl.name);
		}
		assert.notMatch(tov({ drawer: stl, oob: true }), HELD);
		assert.notMatch(tov({ oob: false }), HELD);
		const r = tov({ lastReb: { pid: p.pid, own: false }, gap: 2, oob: false });
		if (OREB.test(r)) {
			seen.travel += 1;
			assert.match(r, /travel/);
		}
		assert.notMatch(tov({ oob: false, gap: 2 }), OREB);
	}
	assert.isAbove(seen.dreb, 200);
	assert.isAbove(seen.oreb, 200);
	assert.isAbove(seen.held, 20);
	assert.isAbove(seen.travel, 50);
});

test("the rebound of his own miss and of an airball are only said when that is what happened", () => {
	setVariety(new VarietyMemory(NAMES));
	const OWN = /own (?:miss|shot|rebound)/;
	const AIR = /airball|never drew iron|hit nothing|short of everything/;
	const seen = { own: 0, airOff: 0, airDef: 0 };
	for (let i = 0; i < 3000; i++) {
		const rng = new Rng(14, i);
		const p = players[i % players.length]!;
		const blk = players[(i + 1) % players.length]!;
		const own = rebText(rng, p, true, false, false, undefined, { own: true });
		assert.notMatch(own, BAD, own);
		if (OWN.test(own)) {
			seen.own += 1;
		}
		for (const off of [true, false]) {
			const air = rebText(rng, p, off, i % 2 === 0, false, undefined, {
				air: true,
			});
			assert.notMatch(air, BAD, air);
			if (AIR.test(air)) {
				seen[off ? "airOff" : "airDef"] += 1;
			}
			for (const t of [
				rebText(rng, p, off, false, false, undefined),
				rebText(rng, p, off, false, false, undefined, {}),
				// (a defensive rebound is never of his own miss; a blocked shot is neither)
				rebText(rng, p, false, false, false, undefined, { own: true }),
				rebText(rng, p, off, false, false, blk, { own: true, air: true }),
				rebText(rng, p, true, false, true, blk, { own: true, air: true }),
			]) {
				assert.notMatch(t, OWN, t);
				assert.notMatch(t, AIR, t);
			}
		}
	}
	assert.isAbove(seen.own, 500);
	assert.isAbove(seen.airOff, 500);
	assert.isAbove(seen.airDef, 500);
});

test("a foul to give, a foul that stops a break, a shooting foul on the break, fouling out and the ball out of bounds fill in", () => {
	setVariety(new VarietyMemory(NAMES));
	const tag = "P2, team foul 3";
	const GIVE = /to give/;
	const BREAK = /the break|open floor|from running|fast break/;
	const TRANS = /on the break|fast break|in transition|on the run/;
	const fouled = new Set<string>();
	for (let i = 0; i < 1500; i++) {
		const rng = new Rng(15, i);
		const f = players[i % players.length]!;
		const s = players[(i + 1) % players.length]!;
		const secs = 1 + (i % 24);
		const give = nonShootingFoul(rng, f, tag, "the Celtics", {
			intentional: false,
			bonus: false,
			toGive: secs,
		});
		assert.notMatch(give, BAD, give);
		assert.match(give, GIVE, give);
		assert.match(give, /^[A-Z].*\(P2, team foul 3\)\. .*\.$/, give);
		if (/\d+ seconds? (left|to go)/.test(give)) {
			assert.include(give, `${secs} second${secs === 1 ? "" : "s"}`, give);
		}
		const stop = nonShootingFoul(rng, f, tag, "the Celtics", {
			intentional: false,
			bonus: false,
			stopsBreak: true,
		});
		assert.notMatch(stop, BAD, stop);
		assert.match(stop, BREAK, stop);
		// (in the penalty there are free throws: neither wording)
		const bonus = nonShootingFoul(rng, f, tag, "the Celtics", {
			intentional: false,
			bonus: true,
			shooter: s,
			teamPenalty: "the Mavericks",
			toGive: secs,
			stopsBreak: true,
		});
		assert.notMatch(bonus, GIVE, bonus);
		assert.match(bonus, /line|shoot two/, bonus);
		const plain = nonShootingFoul(rng, f, tag, "the Celtics", {
			intentional: false,
			bonus: false,
		});
		assert.notMatch(plain, GIVE, plain);
		assert.notMatch(plain, BAD, plain);

		const onBreak = shootingFoul(rng, s, f, tag, false, 2, { trans: true });
		assert.notMatch(onBreak, BAD, onBreak);
		assert.match(onBreak, TRANS, onBreak);
		assert.isTrue(onBreak.startsWith(s.name), onBreak);
		for (const three of [false, true]) {
			const t = shootingFoul(rng, s, f, tag, three, three ? 3 : 2);
			assert.notMatch(t, BAD, t);
			assert.notMatch(t, TRANS, t);
			// (a three is never worded as a foul on the run)
			assert.notMatch(
				shootingFoul(rng, s, f, tag, true, 3, { trans: true }),
				TRANS,
			);
		}

		const out = foulOutText(rng, f, 6);
		assert.notMatch(out, BAD, out);
		assert.include(out, f.name);
		assert.include(out, "(6 fouls)");
		assert.match(out, /foul(?:ed|s) out|disqualified/, out);
		fouled.add(out.replaceAll(f.name, "N"));
		assert.notMatch(foulOutText(rng, f, undefined), BAD);

		// out of bounds: the team that keeps the ball is always named, and a player named is on the right side
		for (const on of ["offense", "defense"] as const) {
			for (const prev of ["shot", "block", "other"] as const) {
				const a = players[(i + 2) % players.length]!;
				const d = players[(i + 5) % players.length]!;
				const t = outOfBounds(rng, {
					on,
					prev,
					teamOn: "the Celtics",
					other: "the Mavericks",
					a,
					d,
					blocker: prev === "block" ? d : undefined,
				});
				assert.notMatch(t, BAD, t);
				assert.match(t, /^[A-Z].*[!.]$/, t);
				assert.match(t, /Mavericks|Celtics/, t);
				// the player who touched it last is on the team it went out off
				if (prev === "shot") {
					assert.isFalse(t.includes(on === "offense" ? d.name : a.name), t);
				}
			}
		}
	}
	assert.isAbove(fouled.size, 3);
});

// ---- whole lines, through a session ----

const makeSession = (gid: number) =>
	new FlavorSession({
		gid,
		numPeriods: 4,
		quarterLength: 12,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players: players.map((p) => ({
			pid: p.pid,
			name: p.name,
			pos: p.pos,
			t: p.t,
			ratings: { ...ratings(60, { spd: 70 }) },
		})),
	});

// Plays a list of events through a session; `pts` on an event is added to its team's score before it is worded
const play = (gid: number, events: any[]) => {
	const session = makeSession(gid);
	const score: [number, number] = [0, 0];
	const host: FlavorHost = {
		stat: () => ({ pts: 2, ast: 1, trb: 1, stl: 1, blk: 1, tov: 1, pf: 1 }),
		score: () => [score[0], score[1]],
		onCourt: (t) => players.filter((p) => p.t === t).map((p) => p.pid),
	};
	const out: { text: string; note: string }[] = [];
	for (const [i, e] of events.entries()) {
		const { pts, ...ev } = e;
		if (pts) {
			score[ev.t as 0 | 1] += pts;
		}
		const r = session.describe(ev, host, events.slice(i + 1));
		if (r && r !== "silent") {
			assert.notMatch(r.text, BAD, r.text);
			if (r.note) {
				assert.notMatch(r.note, BAD, r.note);
			}
			out.push({ text: r.text, note: r.note ?? "" });
		}
	}
	return out;
};

test("threes on back-to-back possessions are only called when the other team's three was the play before", () => {
	const TRADE =
		/answers right back|back-to-back possessions|answer from deep|match that three|trading threes/;
	let seen = 0;
	for (let gid = 1; gid <= 300; gid++) {
		const out = play(gid, [
			{ type: "fgaTp", t: 0, pid: 0, clock: 600, poss: 12 },
			{ type: "tp", t: 0, pid: 0, clock: 600, pts: 3 },
			{ type: "fgaTp", t: 1, pid: 1, clock: 585, poss: 12 },
			{ type: "tp", t: 1, pid: 1, clock: 585, pts: 3 },
			// the same team again, after a miss by the other one: not an answer
			{ type: "fgaTp", t: 0, pid: 2, clock: 570, poss: 12 },
			{ type: "missTp", t: 0, pid: 2, clock: 570 },
			{ type: "drb", t: 1, pid: 3, clock: 568 },
			{ type: "fgaTp", t: 1, pid: 3, clock: 555, poss: 12 },
			{ type: "tp", t: 1, pid: 3, clock: 555, pts: 3 },
			// a two, then a three by the other team: not an answer either
			{ type: "fgaMidRange", t: 0, pid: 4, clock: 540, poss: 12 },
			{ type: "fgMidRange", t: 0, pid: 4, clock: 540, pts: 2 },
			{ type: "fgaTp", t: 1, pid: 5, clock: 525, poss: 12 },
			{ type: "tp", t: 1, pid: 5, clock: 525, pts: 3 },
		]);
		assert.strictEqual(out.length, 7);
		assert.notMatch(out[0]!.note, TRADE);
		if (TRADE.test(out[1]!.note)) {
			seen += 1;
		}
		for (const o of out.slice(2)) {
			assert.notMatch(o.note, TRADE, o.note);
		}
	}
	assert.isAbove(seen, 60);
});

test("a break is said to start with a block only when a teammate's block was rebounded and the basket came on the run", () => {
	const BLOCK =
		/block starts the break|started with the block|rejection turns into|blocked it, and they run|swatted it at one end|blocked it at one end|his own block into|From his block/;
	const seen = { mate: 0, self: 0 };
	for (let gid = 1; gid <= 600; gid++) {
		const scorer = gid % 2 === 0 ? 1 : 5;
		const out = play(gid, [
			{ type: "fgaAtRim", t: 0, pid: 0, clock: 600, poss: 12 },
			{ type: "blkAtRim", t: 1, pid: 1, clock: 600 },
			{ type: "drb", t: 1, pid: 3, clock: 599 },
			{ type: "fgaAtRim", t: 1, pid: scorer, clock: 596, poss: 3 },
			{ type: "fgAtRim", t: 1, pid: scorer, clock: 596, pts: 2 },
			// a missed shot, a rebound and a basket on the run: no block to speak of
			{ type: "fgaAtRim", t: 0, pid: 0, clock: 580, poss: 12 },
			{ type: "missAtRim", t: 0, pid: 0, clock: 580 },
			{ type: "drb", t: 1, pid: 3, clock: 579 },
			{ type: "fgaAtRim", t: 1, pid: 5, clock: 576, poss: 3 },
			{ type: "fgAtRim", t: 1, pid: 5, clock: 576, pts: 2 },
			// a block the shooting team gets back: no break for the blocker's team
			{ type: "fgaAtRim", t: 0, pid: 0, clock: 560, poss: 12 },
			{ type: "blkAtRim", t: 1, pid: 1, clock: 560 },
			{ type: "orb", t: 0, pid: 2, clock: 559 },
			{ type: "fgaAtRim", t: 0, pid: 2, clock: 557, poss: 2 },
			{ type: "fgAtRim", t: 0, pid: 2, clock: 557, pts: 2 },
		]);
		const made = out.filter((o) => /\(2 PTS\)/.test(o.text));
		assert.strictEqual(made.length, 3);
		if (BLOCK.test(made[0]!.text)) {
			seen[scorer === 1 ? "self" : "mate"] += 1;
			assert.include(made[0]!.text, players[1]!.name);
			assert.match(made[0]!.text, /^[A-Z]/);
		}
		assert.notMatch(made[1]!.text, BLOCK, made[1]!.text);
		assert.notMatch(made[2]!.text, BLOCK, made[2]!.text);
	}
	assert.isAbove(seen.mate, 5);
	assert.isAbove(seen.self, 5);
});

test("a foul stops a break only within seconds of the steal, and is a foul to give only late in a period", () => {
	const BREAK = /the break|open floor|from running|fast break/;
	const GIVE = /to give/;
	const seen = { stop: 0, give: 0, old: 0 };
	for (let gid = 1; gid <= 400; gid++) {
		const out = play(gid, [
			{
				type: "stl",
				t: 1,
				pid: 1,
				pidTov: 0,
				outOfBounds: false,
				clock: 600,
				poss: 8,
			},
			{ type: "pfNonShooting", t: 0, pid: 2, clock: 597 },
			// a steal, and a foul 20 seconds later: only the stock line that needs no break can say so
			{
				type: "stl",
				t: 0,
				pid: 2,
				pidTov: 1,
				outOfBounds: false,
				clock: 500,
				poss: 8,
			},
			{ type: "pfNonShooting", t: 1, pid: 3, clock: 480 },
			// 10 seconds left in the period
			{ type: "pfNonShooting", t: 1, pid: 5, clock: 10 },
		]);
		assert.strictEqual(out.length, 5);
		if (BREAK.test(out[1]!.text)) {
			seen.stop += 1;
		}
		assert.notMatch(out[1]!.text, GIVE);
		if (BREAK.test(out[3]!.text)) {
			seen.old += 1;
			assert.include(out[3]!.text, "takes a foul to stop the break");
		}
		assert.notMatch(out[3]!.text, GIVE);
		if (GIVE.test(out[4]!.text)) {
			seen.give += 1;
			// (when the line says how much time is left, it is the event's clock)
			const secs = /(\d+) seconds?/.exec(out[4]!.text);
			if (secs) {
				assert.strictEqual(secs[1], "10", out[4]!.text);
			}
		}
	}
	assert.isAbove(seen.stop, 150);
	assert.isAbove(seen.give, 150);
	// (the stock row is one of many)
	assert.isBelow(seen.old, 60);
});

test("a team is warned for delay of game at most once, and the rebound of his own miss needs his own miss", () => {
	const OWN = /own (?:miss|shot|rebound)/;
	let warned = 0;
	let own = 0;
	for (let gid = 1; gid <= 40; gid++) {
		const events: any[] = [];
		for (let k = 0; k < 150; k++) {
			const t = k % 2;
			const clock = 700 - k * 4;
			events.push(
				{ type: "fgaMidRange", t, pid: t, clock, poss: 12 },
				{ type: "fgMidRange", t, pid: t, clock, pts: 2 },
			);
		}
		events.push(
			{ type: "fgaAtRim", t: 0, pid: 0, clock: 50, poss: 12 },
			{ type: "missAtRim", t: 0, pid: 0, clock: 50 },
			{ type: "orb", t: 0, pid: 0, clock: 49 },
			{ type: "fgaAtRim", t: 0, pid: 2, clock: 45, poss: 12 },
			{ type: "missAtRim", t: 0, pid: 2, clock: 45 },
			{ type: "orb", t: 0, pid: 4, clock: 44 },
		);
		const out = play(gid, events);
		const notes = out.filter((o) => /delay.of.game/i.test(o.note));
		assert.isAtMost(notes.length, 2);
		assert.isAtMost(notes.filter((o) => /Celtics/.test(o.note)).length, 1);
		assert.isAtMost(notes.filter((o) => /Mavericks/.test(o.note)).length, 1);
		warned += notes.length;
		const rebs = out.filter((o) => /\(1 REB\)/.test(o.text));
		assert.strictEqual(rebs.length, 2);
		if (OWN.test(rebs[0]!.text)) {
			own += 1;
		}
		assert.notMatch(rebs[1]!.text, OWN);
	}
	assert.isAbove(warned, 5);
	assert.isAbove(own, 8);
});
