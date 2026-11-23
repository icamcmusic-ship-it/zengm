// Wording for the plays other than shots, passes, steals and rebounds (those are in phrases.ts): fouls, free throws, substitutions,
// timeouts, out-of-bounds plays, the end of a period. Ported from the BBGM League Explorer's play-by-play engine, reworded where BBGM's
// sim logs one event per free throw and per foul rather than one per trip to the line.
import { pickV, pickW, weighted } from "./variety.ts";
import type { Rng } from "./rng.ts";
import {
	R100,
	aRun,
	bare,
	cap,
	clockOf,
	poss as possessive,
	type FPlayer,
} from "./types.ts";

// Team names are passed in the form used mid-sentence: "the Lakers" (or "Team LeBron" with no article, as in the All-Star Game).

export type Trip = {
	shooter: FPlayer;
	// shots in the trip, shots taken so far, makes so far
	n: number;
	i: number;
	m: number;
	three: boolean;
	andOne: boolean;
	intentional: boolean;
	bonus: boolean;
	fouler: FPlayer | undefined;
	// a flagrant foul's free throws: the fouled team keeps the ball after them, there is no rebound
	keepBall?: boolean;
	// the front end of a one-and-one (college rules) that is missed: no second shot
	oneAndOne?: boolean;
};

const ORD = ["first", "second", "third", "fourth"];

// A foul that is not a shooting foul
export const nonShootingFoul = (
	rng: Rng,
	f: FPlayer,
	tag: string,
	ballTeam: string,
	opts: {
		intentional: boolean;
		shooter?: FPlayer;
		bonus: boolean;
		teamPenalty?: string;
		// content3: a foul to give late in a period (seconds left; the team is not in the penalty), a foul to stop a break that has just started
		toGive?: number;
		stopsBreak?: boolean;
		// a one-and-one whose front end is missed: one shot, not two
		oneAndOne?: boolean;
	},
) => {
	const n = f.name;
	const ball = bare(ballTeam);
	const r = f.R;
	if (opts.intentional) {
		const s = opts.shooter ? opts.shooter.name : "the ball handler";
		const call = pickV(rng, [
			`${n} fouls ${s} intentionally to stop the clock`,
			`${n} grabs ${s} right away`,
			`${n} wraps up ${s} on purpose`,
			`Intentional foul by ${n} on ${s}`,
			`${n} sends ${s} to the line as the clock stops`,
			`${n} gets the foul in on ${s} right away`,
			`${n} chases down ${s} and fouls to stop the clock`,
			`${n} reaches in on ${s} the moment he catches it`,
			`${n} lunges at ${s} for the foul`,
			`${n} hugs ${s} before he can get up the floor`,
			`${n} fouls ${s} immediately; they have to stop the clock`,
			`${n} slaps at ${s} and gets the whistle they wanted`,
		]);
		return `${call} (${tag}).${opts.bonus ? "" : ` ${ball} ball on the side.`}`;
	}
	// content3: a foul to give, a foul that stops a break
	if (!opts.bonus && opts.stopsBreak) {
		const call = pickV(rng, [
			`${n} grabs the ball handler to stop the break`,
			`${n} takes the foul before the break can develop`,
			`${n} wraps up the ball handler in the open floor`,
			`${n} fouls to keep them from running`,
			`${n} reaches out and stops the fast break with a foul`,
		]);
		return `${call} (${tag}). ${pickV(rng, [`Side out, ${ball} ball.`, `${cap(ballTeam)} will inbound.`, `${ball} ball on the side.`])}`;
	}
	if (!opts.bonus && opts.toGive !== undefined) {
		const secs = Math.max(1, Math.round(opts.toGive));
		const left = `${secs} ${secs === 1 ? "second" : "seconds"}`;
		const call = pickV(rng, [
			`${n} uses a foul to give with ${left} left`,
			`${n} takes the foul they had to give`,
			`With a foul to give, ${n} reaches in and takes it`,
			`${n} fouls on the floor with ${left} to go; they had one to give`,
			`${n} grabs his man before the shot: a foul to give`,
		]);
		return `${call} (${tag}). ${pickV(rng, [`${cap(ballTeam)} inbound again with ${left} left.`, `Side out, ${ball} ball.`, `${cap(ballTeam)} will have to set it up again.`])}`;
	}
	const rows: [number, string][] = [
		[1, `Reach-in foul on ${n}`],
		[1, `Loose-ball foul on ${n}`],
		[0.8, `${n} is called for holding off the ball`],
		[0.8, `Over-the-back foul on ${n} fighting for position`],
		[0.8, `${n} is whistled for a hand-check`],
		[0.6, `${n} grabs a handful of jersey on the cut`],
		[0.5, `${n} bumps the ball handler on the dribble`],
		[r.diq < 45 ? 0.9 : 0.2, `${n} swipes at the ball and gets arm`],
		[
			r.hgt >= 65 ? 0.9 : 0.15,
			`${n} is called for an over-the-back foul on the rebound`,
		],
		[r.hgt >= 65 ? 0.6 : 0.1, `${n} leans on the post player`],
		[r.spd >= 60 ? 0.5 : 0.1, `${n} is a step slow and fouls on the drive`],
		[0.8, `${n} reaches in on the drive`],
		[0.7, `Holding foul on ${n} in the post`],
		[0.6, `${n} gets tangled up with his man off the ball`],
		[0.6, `${n} is called for a body foul on the drive`],
		[0.5, `${n} draws the whistle with an arm bar`],
		[0.5, `${n} hip-checks the cutter`],
		[r.hgt >= 62 ? 0.6 : 0.2, `${n} is whistled for a push on the rebound`],
		[r.diq >= 60 ? 0.4 : 0.15, `${n} takes a foul to stop the break`],
		[0.8, `${n} is called for a hold on the perimeter`],
		[0.7, `Blocking foul on ${n}`],
		[0.7, `${n} is whistled for bumping the cutter`],
		[0.6, `${n} gets caught reaching on the crossover`],
		[0.6, `Foul on ${n} away from the ball`],
		[0.6, `${n} runs through a screen and is called for the foul`],
		[0.5, `${n} is whistled for an illegal use of the hands`],
		[0.5, `${n} gets a hand on the dribbler's hip: hand-check`],
		[r.hgt >= 65 ? 0.6 : 0.1, `${n} is called for pushing in the post`],
		[r.hgt >= 62 ? 0.5 : 0.15, `Loose-ball foul on ${n} going for the rebound`],
		[r.spd < 50 ? 0.5 : 0.15, `${n} can't stay in front and grabs his man`],
	];
	const x = pickW(rng, rows)!;
	if (opts.bonus && opts.shooter) {
		// The fouling team is "in the penalty"/"over the limit", the team with the ball is "in the bonus"
		const team = opts.teamPenalty ? cap(opts.teamPenalty) : "They";
		const state = pickV(rng, [
			`${team} are in the penalty`,
			`${cap(ballTeam)} are in the bonus`,
			`${team} are over the limit`,
		]);
		return `${x[1]} (${tag}). ${state}, so ${opts.shooter.name} ${pickV(rng, opts.oneAndOne ? ["heads to the line for a one-and-one", "will shoot the one-and-one", "goes to the line for a one-and-one"] : ["heads to the line", "goes to the line for two", "will shoot two"])}.`;
	}
	return `${x[1]} (${tag}). ${pickV(rng, [`Side out, ${ball} ball.`, `${cap(ballTeam)} inbound from the sideline.`, `Baseline inbound for ${ballTeam}.`, `${ball} ball.`, `${cap(ballTeam)} keep it.`, `${ball} will inbound.`, `${ball} ball out of bounds.`, `${cap(ballTeam)} take it out on the side.`, `No shots; ${ball} ball.`])}`;
};

// A shooting foul: the shooter, the fouler and what it was on
export const shootingFoul = (
	rng: Rng,
	shooter: FPlayer,
	f: FPlayer | undefined,
	tag: string,
	three: boolean,
	n: number,
	// content3: fouled on a break that has just started
	x?: { trans?: boolean },
) => {
	const r = shooter.R;
	// [what happened, how the fouler is attached]
	const how: [string, string][] = three
		? [
				[" is fouled shooting a three", "by"],
				[" gets fouled behind the arc", "by"],
				[" is hit on the arm on a three", "by"],
				[" is fouled on the three-point attempt", "by"],
				[" gets bumped on the landing of a three", "by"],
				[" is fouled by the closeout on a three", "by"],
				[" gets hit on the wrist from deep", "by"],
				[" is clipped on the elbow shooting a three", "by"],
				[" draws the foul on a three from the wing", "on"],
				[" has his landing space taken away on a three", "by"],
			]
		: r.ins >= 60
			? [
					[" is fouled in the post", "by"],
					[" draws contact on the drive", "from"],
					[" gets hacked going up", "by"],
					[" is fouled on the drive", "by"],
					[" gets wrapped up on the way to the rim", "by"],
					[" gets hammered on the drop step", "by"],
					[" draws the foul with an up-fake in the post", "on"],
					[" is fouled on the hook", "by"],
					[" gets bumped off his spot on the way up", "by"],
					[" is grabbed on the arm in the lane", "by"],
					[" draws the whistle going up on the block", "on"],
				]
			: [
					[" is fouled on the drive", "by"],
					[" draws a shooting foul", "on"],
					[" gets fouled on a jumper", "by"],
					[" draws contact at the rim", "from"],
					[" is fouled going to the basket", "by"],
					[" is hacked on the arm going up", "by"],
					[" gets hit on the floater", "by"],
					[" draws the foul on a pump fake", "on"],
					[" is fouled on the pull-up", "by"],
					[" is fouled on the layup attempt", "by"],
					[" gets hit across the arm in the lane", "by"],
					[" draws the whistle on the drive", "on"],
					[" is bumped in midair", "by"],
					[" gets fouled on the way up", "by"],
				];
	// (a break that has just started: the foul is on the run)
	if (x?.trans && !three) {
		how.length = 0;
		how.push(
			[" is fouled on the break", "by"],
			[" is taken down going in on the fast break", "by"],
			[" gets hit from behind on the break", "by"],
			[" draws the foul in transition", "on"],
			[" is fouled going in for the layup on the run", "by"],
		);
	}
	const [what, prep] = how[Math.floor(rng.random() * how.length)]!;
	const text = what + (f ? ` ${prep} ${f.name} (${tag})` : "");
	const tail =
		n === 3
			? pickV(rng, [
					" Three shots.",
					" He heads to the line for three.",
					" Three free throws coming.",
					" Three shots coming up.",
					" He'll get three from the line.",
					" That's three free throws for him.",
				])
			: pickV(rng, [
					" Two shots.",
					" Two at the line.",
					" He'll shoot two.",
					" Two free throws coming.",
					" He'll go to the line for two.",
					" Two shots coming up.",
					" He heads to the stripe for two.",
					" A pair of free throws for him.",
					" He'll get two from the line.",
					" Two shots on the way.",
					" He goes to the line for a pair.",
				]);
	return shooter.name + text + "." + tail;
};

const nerveLine = (rng: Rng, made: boolean) =>
	made
		? pickV(rng, [
				"No nerves there.",
				"He doesn't flinch.",
				"Cool as can be with the game this tight.",
				"Steady at the line with everything on the line.",
				"Ice in his veins.",
				"Nothing but net with the building holding its breath.",
				"Just another free throw, to hear him tell it.",
				"He wanted the ball in his hands there.",
				"That's as calm as you'll see anyone at the line.",
			])
		: pickV(rng, [
				"The pressure shows.",
				"He can't convert with the game this tight.",
				"A costly miss at this stage.",
				"That one could haunt him.",
				"The door stays open.",
				"That gives the other side some life.",
				"He'll want that one back.",
			]);

// One free throw
export const freeThrow = (
	rng: Rng,
	trip: Trip | null,
	p: FPlayer,
	made: boolean,
	opts: { late: boolean; makesBefore: number },
) => {
	const n = p.name;
	const r = p.R;
	const nerve =
		opts.late && rng.random() < 0.5 ? ` ${nerveLine(rng, made)}` : "";
	if (!trip || trip.shooter.pid !== p.pid) {
		return (
			(made
				? pickV(rng, [
						`${n} makes the free throw`,
						`${n} sinks a free throw`,
						`${n} hits from the line`,
						`${n} drops in a free throw`,
						`${n} knocks down the free throw`,
						`${n} is good from the line`,
						`${n} converts at the line`,
						`${n} makes his free throw`,
						`${n} gets the free throw to go`,
						`${n} is on target from the line`,
					])
				: pickV(rng, [
						`${n} misses the free throw`,
						`${n} can't convert at the line`,
						`${n}'s free throw rims out`,
						`${n}'s free throw is off the front rim`,
						`${n} leaves the free throw short`,
						`${n}'s free throw spins out`,
						`${n} comes up empty at the line`,
					])) +
			"." +
			nerve
		);
	}
	const i = trip.i; // 0-based index of this shot
	const total = trip.n;
	const last = i === total - 1;
	const ord = ORD[i] ?? `#${i + 1}`;
	const m = trip.m + (made ? 1 : 0); // makes including this one
	if (trip.oneAndOne && !made) {
		return (
			pickV(rng, [
				`${n} misses the front end of the one-and-one`,
				`${n} can't convert the front end of the one-and-one`,
				`${possessive(n)} one-and-one comes up empty: the front end rims out`,
				`${n} leaves the front end of the one-and-one short`,
			]) +
			"." +
			nerve
		);
	}
	if (trip.andOne) {
		const word = trip.three ? "four" : "three";
		return (
			(made
				? pickV(rng, [
						`${n} completes the ${word}-point play`,
						`${n} makes the and-one free throw`,
						`${n} converts the free throw`,
						`${n} hits the bonus free throw for the ${word}-point play`,
						`${n} finishes the old-fashioned ${word}-point play`,
						`${n} adds the free throw to complete the and-one`,
						`${n} cashes in the and-one`,
						`${n} makes the free throw: a ${word}-point trip`,
						`${n} knocks down the free throw to finish the play`,
						`${n} swishes the free throw for the ${word}-point play`,
						`${n} adds the extra point at the line`,
					])
				: pickV(rng, [
						`${n} misses the and-one free throw`,
						`${n} can't convert the free throw`,
						`${n}'s and-one free throw rims out`,
						`${n} leaves the and-one free throw short`,
						`${n} can't finish the ${word}-point play: the free throw is off`,
						`${n}'s free throw is off the back rim, so it stays a basket and nothing more`,
						`${n} misses the free throw that went with the basket`,
					])) +
			"." +
			nerve
		);
	}
	let text: string;
	if (!last) {
		text = made
			? pickV(rng, [
					`${n} makes the ${ord} free throw`,
					`${n} hits the ${ord} one`,
					`${n} knocks down the ${ord} free throw`,
					`${n} sinks the ${ord}`,
					r.ft >= 75
						? `${n} swishes the ${ord} free throw`
						: `${n} calmly makes the ${ord}`,
					r.ft < 55
						? `${n} gets a friendly roll on the ${ord} free throw`
						: `${n} steps up and hits the ${ord}`,
					`${n} drops in the ${ord} free throw`,
					`${n} is good on the ${ord}`,
					`${n} buries the ${ord} free throw`,
					`${n} is true on the ${ord} free throw`,
					`${n} puts the ${ord} one through`,
					`${n} converts the ${ord}`,
					`${n} cans the ${ord} free throw`,
					`${n} gets the ${ord} one to drop`,
					`${n} takes his time and makes the ${ord}`,
					`${n} rattles in the ${ord} free throw`,
					`${n} swishes the ${ord} one`,
					`${n} is on target with the ${ord}`,
					`${n} makes the ${ord} look easy`,
					`${n} rolls in the ${ord} free throw`,
					`${n} gets the ${ord} to go down`,
					`${n} hits nothing but net on the ${ord}`,
				])
			: pickV(rng, [
					`${n} misses the ${ord} free throw`,
					`${n} can't convert the ${ord}`,
					`${n}'s ${ord} free throw rims out`,
					`${n} clanks the ${ord} one`,
					`${n}'s ${ord} free throw is off the back rim`,
					`${n} leaves the ${ord} one short`,
					`${n}'s ${ord} free throw rattles out`,
					`${n}'s ${ord} free throw is long`,
					`${n} is off the mark on the ${ord}`,
					`${n}'s ${ord} one hits the heel of the rim`,
					`${n}'s ${ord} free throw spins out`,
					`${n} can't get the ${ord} one to go`,
					`${n} back-rims the ${ord} free throw`,
					`${n}'s ${ord} attempt catches the side of the rim and falls away`,
					`${n} misfires on the ${ord}`,
					`${n} short-arms the ${ord} free throw`,
					`${n}'s ${ord} one rolls around and out`,
					`No good on the ${ord} from ${n}`,
					`${n} leaves the ${ord} free throw on the front rim`,
					`${n}'s ${ord} free throw bounces twice and falls off`,
					`${n} pulls the ${ord} one to the left`,
				]);
	} else if (m === total) {
		// every shot made
		text =
			total === 2
				? pickV(rng, [
						`${n} makes the second as well: both free throws are good`,
						`${n} sinks the second for a perfect trip`,
						`${n} knocks down the second, 2 for 2`,
						`${n} swishes the second; both fall`,
						`${n} calmly hits the second to make both`,
						`${n} is perfect at the line, 2 for 2`,
						`${n} drops in the second for two more`,
						`${n} makes it two for two`,
						`${n} adds the second; a clean trip to the line`,
						`${n} buries the second too`,
						`${n} hits the second, and that's both`,
						`${n} takes both points from the line`,
						`${n} is good again: two free throws, two makes`,
						`${n} gets the second to drop as well`,
						`${n} cashes in both free throws`,
						`${n} follows it up with the second: two points at the line`,
						`${n} knocks down the back end of the pair too`,
						`${n} drills the second to complete a 2-for-2 trip`,
						`${n} gets both to go down`,
						`${n} makes the second, nothing but net`,
						`${n} finishes off a perfect trip with the second`,
						`${n} adds the second free throw; two for two`,
						`${n} splashes the second as well`,
						`${n} makes the second, too: a perfect trip`,
						`${n} gets both, the second touching nothing but net`,
						`${n} is two for two after the second drops`,
						`${n} knocks down the pair`,
					])
				: pickV(rng, [
						`${n} makes the third: all 3 free throws are good`,
						`${n} drains the third and hits all 3`,
						`${n} knocks down the third, 3 for 3`,
						`${n} is perfect on all three`,
						`${n} makes the third, too: three for three`,
						`${n} sinks the last one for all three points`,
						`${n} cashes in all three free throws`,
					]);
	} else if (made) {
		text = pickV(rng, [
			`${n} makes the ${ord}, finishing ${m} of ${total} at the line`,
			`${n} hits the ${ord} to go ${m} of ${total}`,
			`${n} gets the ${ord} to fall: ${m} of ${total}`,
			`${n} salvages the trip with the ${ord}, ${m} of ${total}`,
			`${n} makes the ${ord} this time; ${m} of ${total} at the line`,
			`${n} knocks down the ${ord} for ${m} of ${total}`,
			`${n} recovers to make the ${ord}: ${m} of ${total}`,
			`${n} drops in the ${ord} after missing; ${m} of ${total}`,
			`${n} steadies himself and makes the ${ord}: ${m} of ${total}`,
			`${n} gets one back with the ${ord}, ${m} of ${total}`,
		]);
	} else if (m === 0) {
		text = pickV(
			rng,
			total === 2
				? [
						`${n} misses the second too and comes up empty`,
						`${n} can't hit either free throw`,
						`${n} misses both; the second hits the front rim`,
						`${n} leaves both free throws out there`,
						`${n} is 0 for 2 on the trip`,
						`${n} misses the second as well: nothing from the trip`,
						`${n} misses again, and it is an empty trip to the line`,
					]
				: [`${n} misses all 3 free throws`, `${n} comes up empty at the line`],
		);
	} else {
		text = pickV(rng, [
			`${n} misses the ${ord} and finishes ${m} of ${total}`,
			`${n} leaves the ${ord} short; ${m} of ${total} at the line`,
			`${n} can't add the ${ord}: ${m} of ${total}`,
			`${n}'s ${ord} one rims out, so it's ${m} of ${total}`,
			`${n} gives one back, missing the ${ord}; ${m} of ${total}`,
			`${n} rims out the ${ord}, ${m} of ${total} on the trip`,
			`${n} can't get the ${ord} to fall and settles for ${m} of ${total}`,
			`The ${ord} one from ${n} is off; ${m} of ${total}`,
			`${n} misses the ${ord}; ${m} of ${total} on the trip`,
			`${n}'s ${ord} free throw is short, and he settles for ${m} of ${total}`,
			total === 2
				? `${n} splits the pair at the line`
				: `${n} misses the last one and makes ${m} of ${total}`,
		]);
	}
	// a defensive lane violation on a made free throw: it was shot again (no stat of its own); very rare
	if (made && last && !opts.late && rng.random() < 0.006) {
		text += pickV(rng, [
			", on a re-shot after a lane violation by the defense",
			"; the first try was waved off for a lane violation",
		]);
	}
	return `${text}.${last ? nerve : ""}`;
};

// A substitution: [on, off] pairs
export const substitution = (
	rng: Rng,
	teamName: string,
	pairs: [FPlayer, FPlayer | undefined][],
	why: {
		foulTrouble: Set<number>;
		injured: Set<number>;
		fouledOut: Set<number>;
		ejected?: Set<number>;
		// players who have been subbed out earlier in the game
		back?: Set<number>;
	},
) => {
	const bits = pairs.map(([a, b]) => ({ a, b }));
	if (bits.length === 1) {
		const { a, b } = bits[0]!;
		if (!b) {
			return `${a.name} checks in.`;
		}
		if (why.injured.has(b.pid)) {
			return pickV(rng, [
				`${a.name} comes in for the injured ${b.name}.`,
				`${b.name} is replaced by ${a.name} after the injury.`,
				`${a.name} takes over for ${b.name}, who is hurt.`,
				`${b.name} can't continue; ${a.name} checks in.`,
				`${a.name} is summoned from the bench with ${b.name} hurt.`,
			]);
		}
		if (why.ejected?.has(b.pid)) {
			return pickV(rng, [
				`${a.name} takes the place of the ejected ${b.name}.`,
				`${a.name} checks in for ${b.name}, who has been tossed.`,
				`${b.name} is gone for the night; ${a.name} comes in.`,
			]);
		}
		if (why.fouledOut.has(b.pid)) {
			return pickV(rng, [
				`${a.name} checks in for ${b.name}, who has fouled out.`,
				`${b.name} is done for the night on fouls; ${a.name} replaces him.`,
				`${a.name} comes in for ${b.name}, who has used up his fouls.`,
			]);
		}
		if (why.foulTrouble.has(b.pid)) {
			return pickV(rng, [
				`${b.name} heads to the bench in foul trouble; ${a.name} checks in.`,
				`${a.name} replaces ${b.name}, who has picked up too many fouls.`,
				`${b.name} sits with foul trouble, and ${a.name} comes in.`,
				`${a.name} comes on to protect ${b.name} from another foul.`,
			]);
		}
		return pickV(rng, [
			...(why.back?.has(a.pid)
				? [
						`${a.name} returns for ${b.name}.`,
						`${a.name} is back in for ${b.name}.`,
						`${a.name} heads back to the scorer's table and checks in for ${b.name}.`,
					]
				: []),
			`${a.name} checks in for ${b.name}.`,
			`${a.name} subs in for ${b.name}.`,
			`${a.name} replaces ${b.name}.`,
			`${b.name} heads to the bench; ${a.name} checks in.`,
			`${a.name} comes on for ${b.name}.`,
			`${b.name} gets a breather; ${a.name} in.`,
			`${a.name} in, ${b.name} out.`,
			`${a.name} reports in for ${b.name}.`,
			`${b.name} takes a seat; ${a.name} is in.`,
			`${a.name} gets the call and replaces ${b.name}.`,
			`${b.name} comes out for a rest, and ${a.name} takes over.`,
			`${a.name} enters the game for ${b.name}.`,
			`${a.name} is at the scorer's table for ${b.name}.`,
			`${b.name} sits; ${a.name} comes off the bench.`,
			`${a.name} spells ${b.name}.`,
			`${b.name} gets a rest. ${a.name} checks in.`,
			`${a.name} takes over for ${b.name}.`,
			`${a.name} off the bench for ${b.name}.`,
			`A breather for ${b.name}: ${a.name} comes in.`,
			`${a.name} is waved in for ${b.name}.`,
			`${b.name} heads to the sideline, ${a.name} on.`,
			`${a.name} gets some run in place of ${b.name}.`,
			`${cap(teamName)} send in ${a.name} for ${b.name}.`,
			`${cap(teamName)} go to ${a.name}; ${b.name} sits.`,
			`${b.name} gives way to ${a.name}.`,
			`Here comes ${a.name}, in for ${b.name}.`,
			`${a.name} gets the nod, and ${b.name} goes to the bench.`,
			`${b.name} checks out; ${a.name} checks in.`,
			`${a.name} comes in to give ${b.name} a rest.`,
			`${b.name} gets a seat, and ${a.name} gets his minutes.`,
			`${a.name} for ${b.name}.`,
			`${cap(teamName)} bring ${a.name} off the bench for ${b.name}.`,
			`${a.name} is on, ${b.name} is off.`,
			`${b.name} catches his breath on the bench; ${a.name} steps in.`,
		]);
	}
	const off = (b: FPlayer | undefined) => (b ? b.name : "a teammate");
	// (three ways to list who came in for whom, so a long night of changes doesn't read as one line over and over)
	const style = Math.floor(rng.random() * 3);
	const list =
		style === 0
			? bits.map(({ a, b }) => `${a.name} in for ${off(b)}`).join(", ")
			: style === 1
				? bits.map(({ a, b }) => `${a.name} for ${off(b)}`).join(", ")
				: bits.map(({ a, b }) => `${a.name} replaces ${off(b)}`).join("; ");
	const many = bits.length >= 3;
	return pickV(rng, [
		`${bare(teamName)} substitution: ${list}.`,
		`Changes for ${teamName}: ${list}.`,
		`Lineup changes for ${teamName}: ${list}.`,
		`Fresh legs for ${teamName}: ${list}.`,
		`Substitutions for ${teamName}: ${list}.`,
		`${cap(teamName)} go to the bench: ${list}.`,
		`${cap(teamName)} shuffle the lineup: ${list}.`,
		`New faces for ${teamName}: ${list}.`,
		`${cap(teamName)} make their changes: ${list}.`,
		`Help off the bench for ${teamName}: ${list}.`,
		`A new look for ${teamName}: ${list}.`,
		`${cap(teamName)} swap some players: ${list}.`,
		`The ${bare(teamName)} bench gets the call: ${list}.`,
		`${cap(teamName)} rotate: ${list}.`,
		`${cap(teamName)} go to their bench: ${list}.`,
		`${bare(teamName)} changes: ${list}.`,
		`More minutes for the ${bare(teamName)} reserves: ${list}.`,
		`${cap(teamName)} freshen things up: ${list}.`,
		`A different group for ${teamName}: ${list}.`,
		many
			? `A wave of changes for ${teamName}: ${list}.`
			: `A couple of changes for ${teamName}: ${list}.`,
		many
			? `${cap(teamName)} change most of the lineup: ${list}.`
			: `Two changes for ${teamName}: ${list}.`,
	]);
};

export const timeoutText = (
	rng: Rng,
	team: string,
	numLeft: number,
	opts: {
		runBy?: { team: string; label: string };
		down?: { margin: number; clock: string };
		advancesBall: boolean;
		lateTie?: boolean;
	},
) => {
	const left = numLeft > 0 ? `${numLeft} left` : "their last";
	let why: string;
	if (opts.runBy) {
		why = `, after ${aRun(opts.runBy.label)} by ${opts.runBy.team}`;
	} else if (opts.down) {
		why = `, down ${opts.down.margin} with ${opts.down.clock} left`;
	} else if (opts.lateTie) {
		why = pickV(rng, [
			", to set up the last shot",
			", to draw up a play with the game tied",
			", to draw up the final possession",
			", with the game tied and the ball in their hands",
		]);
	} else {
		why = opts.advancesBall
			? pickV(rng, [
					"",
					", to set up a play",
					", to draw something up",
					", to advance the ball",
					", to get the ball into the frontcourt",
					", to get organized",
				])
			: pickV(rng, [
					"",
					", to catch their breath",
					", to talk it over",
					", to set up a play",
					", to regroup",
					", to settle things down",
					", to get everyone on the same page",
					", to make an adjustment on defense",
					", to give the starters a breather",
					", to slow the game down",
					", to change the matchups",
					", to stop the bleeding",
					", to get a look at the defense",
					", to rest some tired legs",
				]);
	}
	const adv = opts.advancesBall
		? pickV(rng, [
				" They'll advance the ball to the frontcourt.",
				" The ball is moved up to half court.",
				" They'll inbound in the frontcourt.",
				" They will take it out at half court.",
			])
		: "";
	const head = pickV(rng, [
		`Timeout, ${bare(team)}`,
		`Timeout, ${bare(team)}`,
		`${cap(team)} call timeout`,
		`${cap(team)} take a timeout`,
		`${cap(team)} use a timeout`,
		`Time out on the floor, ${bare(team)}`,
		`${cap(team)} stop play with a timeout`,
		`A timeout for ${team}`,
		`${cap(team)} want time`,
		`${cap(team)} signal for a timeout`,
		`Timeout called by ${team}`,
	]);
	return `${head}${why} (${left}).${adv}`;
};

// The ball goes out of bounds with no stat of its own
export const outOfBounds = (
	rng: Rng,
	o: {
		on: "offense" | "defense";
		prev: "shot" | "block" | "other";
		teamOn: string; // the team that touched it last
		other: string; // the other team (keeps the ball)
		a?: FPlayer; // an offensive player
		d?: FPlayer; // a defensive player
		blocker?: FPlayer;
		hgtOff?: boolean;
	},
) => {
	const { a, d } = o;
	const other = o.other;
	const otherBare = bare(other);
	const teamOn = o.teamOn;
	if (o.prev === "block") {
		const b = o.blocker;
		if (o.on === "defense") {
			return pickV(rng, [
				"Blocked out of bounds; " + other + " keep it.",
				"The block goes out of bounds: " + otherBare + " ball.",
				"Blocked, and the ball lands out of bounds. " +
					cap(other) +
					" keep it.",
				"The blocked shot sails over the baseline; " + otherBare + " ball.",
				...(b
					? [
							b.name + " swats it into the stands; " + otherBare + " ball.",
							b.name +
								" sends it into the third row. " +
								cap(other) +
								" keep it.",
							possessive(b.name) +
								" block goes out of bounds, and " +
								other +
								" will inbound.",
						]
					: []),
			]);
		}
		return pickV(rng, [
			"The loose ball after the block goes out off " +
				teamOn +
				": " +
				otherBare +
				" ball.",
			"Scramble for the blocked shot, and it goes out off " + teamOn + ".",
			"Nobody can control the blocked shot, and it is last touched by " +
				teamOn +
				": " +
				otherBare +
				" ball.",
			"The blocked shot bounces out of bounds off " +
				teamOn +
				". " +
				cap(other) +
				" take over.",
		]);
	}
	if (o.prev === "shot") {
		// the rebound goes out
		if (o.on === "defense") {
			return pickV(rng, [
				"The ball goes out of bounds off a defender: " + otherBare + " ball.",
				"Loose ball knocked out of bounds by " +
					teamOn +
					"; " +
					other +
					" keep it.",
				"Off the defense, " + otherBare + " ball.",
				"The rebound is tipped out of bounds by " +
					teamOn +
					". " +
					cap(other) +
					" keep the ball.",
				"The miss is batted out of bounds by " +
					teamOn +
					"; " +
					otherBare +
					" ball.",
				"Nobody can secure the rebound, and it goes out off " +
					teamOn +
					". " +
					cap(other) +
					" get another chance.",
				...(d
					? [
							d.name +
								" can't hold on to the rebound and it goes out of bounds: " +
								otherBare +
								" ball.",
							d.name +
								" tips the rebound over the baseline. " +
								cap(other) +
								" keep it.",
							"The rebound goes off " +
								possessive(d.name) +
								" hands and out; " +
								other +
								" will inbound under the basket.",
						]
					: []),
			]);
		}
		return pickV(rng, [
			"The rebound goes out of bounds off " +
				teamOn +
				": " +
				otherBare +
				" ball.",
			"Loose ball, tied up; the possession arrow gives it to " + other + ".",
			"The long rebound caroms out of bounds off " +
				teamOn +
				"; " +
				otherBare +
				" ball.",
			"The miss is tipped out of bounds by " +
				teamOn +
				". " +
				cap(other) +
				" ball.",
			"Fight for the rebound, and it goes out off " +
				teamOn +
				": " +
				otherBare +
				" ball.",
			"The rebound is knocked out of bounds, last touched by " +
				teamOn +
				". " +
				cap(other) +
				" take over.",
			cap(teamOn) + " can't keep the rebound in play; " + otherBare + " ball.",
			"Out of bounds on the rebound, off " +
				teamOn +
				". " +
				cap(other) +
				" will bring it up.",
			"The ball squirts out of the pack and over the sideline off " +
				teamOn +
				"; " +
				otherBare +
				" ball.",
			"No rebound: the ball goes out off " +
				teamOn +
				", and " +
				other +
				" take possession.",
			"The carom is batted around and goes out off " +
				teamOn +
				". " +
				cap(otherBare) +
				" ball.",
			...(a
				? [
						a.name +
							" tries to tip the miss back and knocks it out of bounds: " +
							otherBare +
							" ball.",
						a.name +
							" goes for the offensive rebound, but it glances off his hands and out. " +
							cap(other) +
							" ball.",
						"The rebound goes off " +
							possessive(a.name) +
							" fingertips and out of bounds; " +
							other +
							" take over.",
						a.name +
							" can't save the rebound from going out. " +
							cap(other) +
							" get the ball.",
						a.name +
							" crashes the glass and gets a hand on it, but it goes out of bounds: " +
							otherBare +
							" ball.",
					]
				: []),
		]);
	}
	if (o.on === "defense") {
		const rows: [number, string][] = [];
		if (d) {
			rows.push(
				[
					1,
					"Kicked ball on " +
						d.name +
						"; " +
						other +
						" inbound with a fresh shot clock.",
				],
				[
					1,
					d.name +
						" kicks the ball trying to stop the entry pass. " +
						cap(other) +
						" keep it.",
				],
				[
					0.8,
					"Kicked-ball violation on " +
						d.name +
						". " +
						cap(other) +
						" reset on the sideline.",
				],
				[
					1,
					"The pass is deflected off " +
						d.name +
						" and out of bounds: " +
						otherBare +
						" ball.",
				],
				[
					0.8,
					d.name +
						" gets a fingertip on the pass and it goes out; " +
						other +
						" keep the ball.",
				],
				[
					0.8,
					d.name +
						" knocks the ball away, but out of bounds. " +
						cap(other) +
						" keep it.",
				],
				[
					0.7,
					d.name +
						" pokes at the dribble and it rolls over the sideline: " +
						otherBare +
						" ball.",
				],
				[
					0.6,
					d.name +
						" sticks a foot in the passing lane: kicked ball, and " +
						other +
						" inbound on the side.",
				],
				[
					0.5,
					"The officials whistle " +
						d.name +
						" for kicking the pass. " +
						cap(other) +
						" keep the ball.",
				],
			);
		}
		if (a && d) {
			rows.push(
				[
					1.2,
					"Held ball: " +
						a.name +
						" and " +
						d.name +
						" both come up with it. The possession arrow goes to " +
						other +
						".",
				],
				[
					0.8,
					d.name +
						" ties up " +
						a.name +
						" for a held ball. Jump ball at the circle; " +
						a.name +
						" tips it to a teammate, " +
						otherBare +
						" ball.",
				],
				[
					0.7,
					"Jump ball: " +
						d.name +
						" gets his hands on it along with " +
						a.name +
						", and the possession arrow keeps it with " +
						other +
						".",
				],
				[
					0.6,
					a.name +
						" and " +
						d.name +
						" wrestle for the ball on the floor: jump ball, and the arrow points to " +
						other +
						".",
				],
			);
			const up = a.R.hgt + a.R.jmp >= d.R.hgt + d.R.jmp;
			rows.push([
				0.8,
				"Tie-up between " +
					a.name +
					" and " +
					d.name +
					". " +
					a.name +
					(up
						? " controls the jump"
						: " steals the jump from the taller " + d.name) +
					" for " +
					other +
					".",
			]);
		}
		if (!rows.length) {
			rows.push([1, "Off the defense, " + otherBare + " ball."]);
		}
		return pickW(rng, rows)![1];
	}
	return pickV(rng, [
		"Out of bounds off " + teamOn + ": " + otherBare + " ball.",
		"The ball goes out off " + teamOn + "; " + otherBare + " ball.",
		"Last touched by " + teamOn + ": " + otherBare + " ball.",
		"The ball rolls out of bounds off " +
			teamOn +
			". " +
			cap(other) +
			" take over.",
		...(a
			? [
					a.name + " can't keep it in play; " + otherBare + " ball.",
					"The ball goes off " +
						possessive(a.name) +
						" foot and out of bounds: " +
						otherBare +
						" ball.",
				]
			: []),
	]);
};

export const endOfPeriod = (
	rng: Rng,
	reason: "runOutClock" | "noShot" | "intentionalFoul",
	team: string,
	sh?: FPlayer,
) => {
	const Team = cap(team);
	if (reason === "runOutClock") {
		return pickV(rng, [
			`${Team} dribble out the clock.`,
			`${Team} run out the clock.`,
			`${Team} hold the ball and let the clock run out.`,
			`${Team} are happy to let the final seconds tick away.`,
			`${Team} let the last seconds run off.`,
			`${Team} hold it for the horn.`,
			`No shot from ${team}: they run the clock down to zero.`,
			`${Team} dribble it out, and that's the horn.`,
			`${Team} are content to hold the ball as time expires.`,
			`${Team} take the air out of the ball until the horn.`,
			`${Team} walk it up and let the clock expire.`,
			`${Team} keep it out of reach until time runs out.`,
		]);
	}
	if (reason === "noShot") {
		if (sh && rng.random() < 0.05) {
			return pickV(rng, [
				`${possessive(sh.name)} jumper drops, but it's waved off on review: the ball was still on his fingertips when the clock hit zero.`,
				`${sh.name} gets a long shot to fall as the horn sounds, but the replay shows it came out of his hands too late. No basket.`,
				`${Team} think they've scored at the horn on ${possessive(sh.name)} runner, but the officials wave it off after review: too late.`,
			]);
		}
		return pickV(rng, [
			`${Team} can't get a shot off before the horn.`,
			`Time runs out with ${team} still setting up.`,
			`${Team} are still looking for a shot when the horn sounds.`,
			`${Team} get caught without a look as the horn goes.`,
			`The horn beats ${team} to the shot.`,
			`${Team} run out of time before they can shoot.`,
			`${Team} never find a look, and the horn sounds.`,
			`The clock beats ${team}: no shot.`,
			`${Team} are a beat late; the horn sounds first.`,
			`${Team} are still passing it around when the horn sounds.`,
			`The defense holds, and ${team} never get one up before the horn.`,
			`${Team} run out of clock with the ball still on the perimeter.`,
		]);
	}
	return pickV(rng, [
		"The clock runs out while the defense tries to foul.",
		"Time expires before the defense can get the whistle.",
		"The horn sounds as the defense reaches in; no foul in time.",
		"The defense can't get the foul in before the horn.",
		"The defense chases the ball until the horn: no foul, no more time.",
		"They try to foul, but the last seconds run off first.",
	]);
};

export const heaveText = (rng: Rng, p: FPlayer, made: boolean) => {
	const n = p.name;
	if (made) {
		return pickV(rng, [
			`${n} launches from beyond half court as the horn sounds and banks it in! The bench goes wild.`,
			`${n} heaves it from 45 feet at the horn, and it drops! The arena explodes.`,
			`${n} catches, takes two dribbles and lets it fly from the opposite foul line at the horn. Nothing but net!`,
			`${n} throws it up from three-quarters court at the horn, and it's good! Unbelievable!`,
			`${n} lets one go from the far hash mark as time expires, and it banks in! Pandemonium!`,
			`${n} flings it from well beyond half court at the horn, and it goes! Nobody can believe it.`,
			`${n} takes one dribble past the far free-throw line and lets it go at the horn. Good!`,
		]);
	}
	return pickV(rng, [
		`${n} heaves one from beyond half court as time expires; well short.`,
		`${possessive(n)} desperation heave from 50 feet at the horn hits the backboard and falls away.`,
		`${n} launches from just past half court as the horn sounds; it's off the mark.`,
		`${n} lets one fly from 40 feet with the clock running out; it clanks off the rim.`,
		`${possessive(n)} heave from the far side of half court is wide.`,
		`${possessive(n)} long two-handed heave at the horn falls short.`,
		`${n} chucks one from 60 feet at the buzzer; not close.`,
		`${n} throws up a prayer from half court at the horn; it bounces off the top of the backboard.`,
		`${n} gets a running heave away from 55 feet before the horn; off the side of the rim.`,
		`${possessive(n)} three-quarter-court heave at the horn is on line, but short.`,
	]);
};

// Game Sim Fixes knocks: a minor in-game injury, and the evaluation a few minutes later
export const knockText = (rng: Rng, p: FPlayer) =>
	pickV(rng, [
		`${p.name} is shaken up on the play and heads to the bench to get checked out.`,
		`${p.name} is slow to get up and checks out of the game; the trainer takes a look.`,
		`${p.name} takes a knock and goes to the bench, flexing his hand.`,
		`${p.name} limps off after the play. He's being looked at on the bench.`,
		`${p.name} gets banged up on the play and heads back to the locker room to be evaluated.`,
	]);

export const knockReturnText = (rng: Rng, p: FPlayer, back: boolean) =>
	back
		? pickV(rng, [
				`${p.name} has been cleared and is available to return.`,
				`Good news for his team: ${p.name} is back on the bench and available.`,
				`${p.name} is cleared to return after being checked out.`,
			])
		: pickV(rng, [
				`${p.name} will not return to the game.`,
				`${p.name} has been ruled out for the rest of the game; it looks like a day-to-day thing.`,
				`${p.name} is done for the night as a precaution.`,
			]);

export const injuryText = (rng: Rng, p: FPlayer) =>
	pickV(rng, [
		`${p.name} was injured!`,
		`${p.name} goes down and has to leave the game with an injury.`,
		`${p.name} is helped off the floor; it looks like an injury.`,
		`${p.name} is down and holding his leg; he'll head to the locker room.`,
		`${p.name} limps to the bench with an apparent injury.`,
		`${p.name} stays down after the play, and the trainer comes out to check on him. He heads to the locker room.`,
		`${p.name} lands awkwardly and grabs at his ankle. He's done for now.`,
		`${p.name} comes up limping after the play and is taken out of the game.`,
		`Play is stopped with ${p.name} down on the floor. He walks off gingerly with the trainer.`,
		`${p.name} tweaks something on the play and heads straight to the back.`,
		`A hush falls over the arena as ${p.name} stays down. He's helped off the court.`,
		`${p.name} takes a knee and motions to the bench. He'll have to come out.`,
		`${p.name} pulls up lame and signals for a sub.`,
		`${p.name} is slow to get up and goes to the bench with the trainer.`,
		`${p.name} grabs at his side and asks to come out.`,
		`${p.name} is shaken up on the play and will not stay in the game.`,
		`The trainer is out to look at ${p.name}, who leaves the floor under his own power.`,
		`${p.name} is hurt on the play and heads for the bench.`,
	]);

export const tipOff = (
	rng: Rng,
	a: FPlayer,
	b: FPlayer,
	winnerTeam: string,
	overtime: boolean,
) => {
	const lead = overtime ? "Overtime tip: " : "Tip-off: ";
	// (the taller or bouncier one is expected to win it: an upset reads like one)
	const reach = (p: FPlayer) => p.R.hgt * 2 + p.R.jmp;
	const upset = reach(b) - reach(a) >= 25;
	const rows: [number, string][] = [
		[1, `${a.name} and ${b.name} jump; ${winnerTeam} get the ball.`],
		[1, `${a.name} wins the tip over ${b.name}, and ${winnerTeam} have it.`],
		[
			1,
			`${a.name} out-leaps ${b.name} and taps it to a teammate: ${winnerTeam} ball.`,
		],
		[
			0.8,
			`${a.name} controls the tip against ${b.name}; ${winnerTeam} start with it.`,
		],
		[0.8, `${a.name} gets up first and flicks it back to ${winnerTeam}.`],
		[
			upset ? 2 : 0,
			`${a.name} times it perfectly and steals the tip from the taller ${b.name}.`,
		],
		[upset ? 0 : 0.6, `${a.name} wins the jump cleanly over ${b.name}.`],
		[
			0.8,
			`${a.name} gets a hand on the jump ball first, and ${winnerTeam} come up with it.`,
		],
		[
			0.7,
			`${a.name} beats ${b.name} to the toss and tips it back: ${winnerTeam} ball.`,
		],
		[0.7, `The jump ball goes to ${winnerTeam}, tapped back by ${a.name}.`],
		[
			0.6,
			`${a.name} and ${b.name} meet at center court for the jump, and ${a.name} wins it.`,
		],
	];
	return lead + pickW(rng, rows)![1];
};

export const foulOutText = (
	rng: Rng,
	p: FPlayer,
	fouls: number | undefined,
) => {
	const tag = fouls ? ` (${fouls} fouls)` : "";
	return pickV(rng, [
		`${p.name} has fouled out${tag}.`,
		`${p.name} has fouled out${tag}.`,
		`That's the last foul for ${p.name}${tag}: he has fouled out.`,
		`${p.name} is done for the night${tag}: fouled out.`,
		`${p.name} fouls out${tag} and heads to the bench.`,
		`${p.name} is disqualified on fouls${tag}.`,
	]);
};

export const quarterNote = (
	rng: Rng,
	label: string,
	a0: string,
	b0: string,
	sa: number,
	sb: number,
) => {
	const a = bare(a0);
	const b = bare(b0);
	const lead =
		sa === sb
			? `All tied at ${sa}`
			: sa > sb
				? `${a} lead ${sa}-${sb}`
				: `${b} lead ${sb}-${sa}`;
	const which = label === "overtime" ? "overtime" : `the ${label}`;
	// "After one", "At the half", "After three" in a four-quarter game
	const short =
		label === "first quarter"
			? "After one"
			: label === "second quarter" || label === "first half"
				? "At the half"
				: label === "third quarter"
					? "After three"
					: undefined;
	return pickV(rng, [
		`End of ${which}: ${lead}.`,
		`${lead} after ${which}.`,
		...(short ? [`${short}: ${lead}.`] : []),
		...(label === "overtime" ? [] : [`That's ${which}. ${lead}.`]),
		`${cap(which)} is in the books: ${lead}.`,
		`The horn ends ${which}. ${lead}.`,
		`${lead} at the end of ${which}.`,
		`${cap(which)} is over: ${lead}.`,
		`${lead} as ${which} comes to a close.`,
		`${lead} when the horn sounds on ${which}.`,
		...(short
			? [
					sa === sb
						? `${short}, we're tied at ${sa}.`
						: `${short}, it's ${sa > sb ? a : b} by ${Math.abs(sa - sb)}.`,
				]
			: []),
	]);
};

export const crowdLine = (rng: Rng, kind: "wow" | "tight", team: string) =>
	kind === "wow"
		? pickV(rng, [
				"The crowd is on its feet.",
				"That one gets the building going.",
				`${cap(team)} bench is up out of their seats.`,
				`${cap(team)} bench erupts.`,
				"Oohs and aahs from the crowd.",
				"That'll be on the highlight reel.",
				`${cap(team)} bench goes wild.`,
				"That brought the house down.",
				"The building is shaking.",
				`${cap(team)} bench is waving towels.`,
				"Phones come out all over the arena for the replay.",
				"The whole building wants to see that one again.",
				"Even the other bench had to appreciate that one.",
				"That one will be all over the highlight shows.",
			])
		: pickV(rng, [
				"The noise is deafening.",
				"Nobody in the building is sitting down now.",
				"The crowd is roaring.",
				"You can feel the tension in the building.",
				"Fans are standing in every corner of the arena.",
				"Every possession feels enormous now.",
				"Nobody is leaving this one early.",
				"The building is as loud as it has been all night.",
				"Both benches are standing.",
			]);

export const pickOnCourt = (
	rng: Rng,
	ps: FPlayer[],
	w: (p: FPlayer) => number,
) => weighted(rng, ps, w);
export { R100, clockOf };

// A technical foul at a dead ball: on a player (p) or on the bench (p undefined). One free throw for the other team, possession unchanged
export const technicalFoul = (
	rng: Rng,
	p: FPlayer | undefined,
	team: string,
	num: number,
	opts: {
		afterDunk: boolean;
		afterFoul: boolean;
		shooter: FPlayer | undefined;
	},
) => {
	let call: string;
	if (!p) {
		call = pickV(rng, [
			`Technical foul on the ${bare(team)} bench`,
			`The ${bare(team)} coach is hit with a technical after a long word with the officials`,
			`Technical foul on the ${bare(team)} coach for arguing the call`,
			`The ${bare(team)} bench is warned, then given a technical`,
			`The ${bare(team)} coach comes too far onto the floor and is given a technical`,
			`Technical foul on the ${bare(team)} bench: the officials have heard enough`,
		]);
	} else {
		const n = p.name;
		const rows: [number, string][] = [
			[1, `Technical foul on ${n} for arguing the call`],
			[1, `${n} is given a technical for complaining to the officials`],
			[0.7, `${n} says a little too much to the referee: technical foul`],
			[0.6, `Technical foul on ${n} for taunting`],
			[0.5, `${n} picks up a technical for an exchange with his defender`],
			[
				opts.afterFoul ? 1.2 : 0,
				`${n} can't believe the call and is hit with a technical`,
			],
			[opts.afterDunk ? 1 : 0, `${n} hangs on the rim and draws a technical`],
			[0.3, `${n} slams the ball down in frustration: technical foul`],
			[0.6, `${n} keeps talking after the whistle and is given a technical`],
			[0.5, `${n} waves off the official and draws a technical foul`],
			[0.5, `Technical foul on ${n}: the official had warned him already`],
			[
				opts.afterFoul ? 1 : 0,
				`${n} claps at the official after the whistle: technical foul`,
			],
			[
				0.3,
				`${n} is called for a delay of game after an earlier warning: technical foul`,
			],
		];
		call = pickW(rng, rows)![1];
	}
	const second =
		num >= 2
			? p
				? ` That's his second technical.`
				: ` That's the second one on the bench.`
			: "";
	const ft = opts.shooter
		? ` ${opts.shooter.name} ${pickV(rng, ["will shoot the free throw", "goes to the line for one", "takes the technical free throw"])}.`
		: "";
	return `${call}.${second}${ft}`;
};

// A flagrant foul: two free throws and the ball for the fouled team
export const flagrantFoul = (
	rng: Rng,
	f: FPlayer,
	shooter: FPlayer,
	tag: string,
	level: 1 | 2,
	ballTeam: string,
) => {
	const n = f.name;
	const s = shooter.name;
	const play = pickV(rng, [
		`${n} wraps up ${s} on the drive with no play on the ball`,
		`${n} swings through and catches ${s} high`,
		`${n} takes ${s} down hard in transition`,
		`${n} shoves ${s} in the back on the way to the rim`,
		`${n} undercuts ${s} as he goes up`,
		`${n} grabs ${s} around the shoulders on the way up`,
		`${n} follows through and hits ${s} in the head`,
		`${n} throws ${s} to the floor on the rebound`,
	]);
	const call =
		level === 2
			? pickV(rng, [
					"After a review, it's a flagrant 2",
					"The officials go to the monitor and upgrade it to a flagrant 2",
					"Flagrant foul, penalty 2",
				])
			: pickV(rng, [
					"After a review, it's a flagrant 1",
					"The officials review it: flagrant foul, penalty 1",
					"It's ruled a flagrant 1",
				]);
	return `${play}. ${call} (${tag}). Two free throws for ${s}, and ${ballTeam} keep the ball.`;
};

export const ejectionText = (
	rng: Rng,
	p: FPlayer | undefined,
	team: string,
	reason: string,
) => {
	if (!p) {
		return pickV(rng, [
			`The ${bare(team)} coach is ejected and heads to the locker room.`,
			`Two technicals: the ${bare(team)} coach has been tossed.`,
		]);
	}
	const n = p.name;
	if (reason === "techs") {
		return pickV(rng, [
			`${n} has been ejected after his second technical.`,
			`Two technicals: ${n} is tossed and heads to the locker room.`,
			`${n} gets his second technical and with it the rest of the night off: ejected.`,
		]);
	}
	if (reason === "flagrants") {
		return `${n} has been ejected: that's his second flagrant foul of the game.`;
	}
	return pickV(rng, [
		`${n} has been ejected.`,
		`${n} is ejected from the game and heads to the locker room.`,
		`${n} is tossed.`,
		`That is the end of the night for ${n}: ejected.`,
	]);
};

export const technicalFreeThrow = (rng: Rng, p: FPlayer, made: boolean) =>
	made
		? pickV(rng, [
				`${p.name} makes the technical free throw.`,
				`${p.name} converts the technical free throw.`,
				`${p.name} hits the free throw for the technical.`,
				`${p.name} drops in the technical free throw.`,
				`${p.name} knocks down the technical.`,
				`${p.name} makes the free throw awarded for the technical.`,
			])
		: pickV(rng, [
				`${p.name} misses the technical free throw.`,
				`${p.name} can't convert the technical free throw.`,
				`${p.name} leaves the technical free throw short.`,
				`${possessive(p.name)} technical free throw rims out.`,
				`${p.name} is off the mark on the technical free throw.`,
			]);
