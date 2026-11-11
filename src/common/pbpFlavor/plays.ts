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
		]);
		return `${call} (${tag}).${opts.bonus ? "" : ` ${ball} ball on the side.`}`;
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
		return `${x[1]} (${tag}). ${state}, so ${opts.shooter.name} ${pickV(rng, ["heads to the line", "goes to the line for two", "will shoot two"])}.`;
	}
	return `${x[1]} (${tag}). ${pickV(rng, [`Side out, ${ball} ball.`, `${cap(ballTeam)} inbound from the sideline.`, `Baseline inbound for ${ballTeam}.`, `${ball} ball.`, `${cap(ballTeam)} keep it.`, `${ball} will inbound.`])}`;
};

// A shooting foul: the shooter, the fouler and what it was on
export const shootingFoul = (
	rng: Rng,
	shooter: FPlayer,
	f: FPlayer | undefined,
	tag: string,
	three: boolean,
	n: number,
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
				];
	const [what, prep] = how[Math.floor(rng.random() * how.length)]!;
	const text = what + (f ? ` ${prep} ${f.name} (${tag})` : "");
	const tail =
		n === 3
			? pickV(rng, [
					" Three shots.",
					" He heads to the line for three.",
					" Three free throws coming.",
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
			])
		: pickV(rng, [
				"The pressure shows.",
				"He can't convert with the game this tight.",
				"A costly miss at this stage.",
				"That one could haunt him.",
				"The door stays open.",
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
					])
				: pickV(rng, [
						`${n} misses the free throw`,
						`${n} can't convert at the line`,
						`${n}'s free throw rims out`,
						`${n}'s free throw is off the front rim`,
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
					])
				: pickV(rng, [
						`${n} misses the and-one free throw`,
						`${n} can't convert the free throw`,
						`${n}'s and-one free throw rims out`,
						`${n} leaves the and-one free throw short`,
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
					])
				: pickV(rng, [
						`${n} makes the third: all 3 free throws are good`,
						`${n} drains the third and hits all 3`,
						`${n} knocks down the third, 3 for 3`,
						`${n} is perfect on all three`,
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
			]);
		}
		if (why.ejected?.has(b.pid)) {
			return pickV(rng, [
				`${a.name} takes the place of the ejected ${b.name}.`,
				`${a.name} checks in for ${b.name}, who has been tossed.`,
			]);
		}
		if (why.fouledOut.has(b.pid)) {
			return `${a.name} checks in for ${b.name}, who has fouled out.`;
		}
		if (why.foulTrouble.has(b.pid)) {
			return pickV(rng, [
				`${b.name} heads to the bench in foul trouble; ${a.name} checks in.`,
				`${a.name} replaces ${b.name}, who has picked up too many fouls.`,
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
		]);
	} else {
		why = opts.advancesBall
			? pickV(rng, [
					"",
					", to set up a play",
					", to draw something up",
					", to advance the ball",
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
				]);
	}
	const adv = opts.advancesBall
		? pickV(rng, [
				" They'll advance the ball to the frontcourt.",
				" The ball is moved up to half court.",
				" They'll inbound in the frontcourt.",
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
		]);
	}
	return pickV(rng, [
		"The clock runs out while the defense tries to foul.",
		"Time expires before the defense can get the whistle.",
		"The horn sounds as the defense reaches in; no foul in time.",
		"The defense can't get the foul in before the horn.",
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
	]);
};

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
	];
	return lead + pickW(rng, rows)![1];
};

export const foulOutText = (_rng: Rng, p: FPlayer, fouls: number | undefined) =>
	`${p.name} has fouled out${fouls ? ` (${fouls} fouls)` : ""}.`;

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
			])
		: pickV(rng, [
				"The noise is deafening.",
				"Nobody in the building is sitting down now.",
				"The crowd is roaring.",
				"You can feel the tension in the building.",
				"Fans are standing in every corner of the arena.",
				"Every possession feels enormous now.",
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
		]);
	}
	if (reason === "flagrants") {
		return `${n} has been ejected: that's his second flagrant foul of the game.`;
	}
	return pickV(rng, [
		`${n} has been ejected.`,
		`${n} is ejected from the game and heads to the locker room.`,
	]);
};

export const technicalFreeThrow = (rng: Rng, p: FPlayer, made: boolean) =>
	made
		? pickV(rng, [
				`${p.name} makes the technical free throw.`,
				`${p.name} converts the technical free throw.`,
				`${p.name} hits the free throw for the technical.`,
				`${p.name} drops in the technical free throw.`,
			])
		: pickV(rng, [
				`${p.name} misses the technical free throw.`,
				`${p.name} can't convert the technical free throw.`,
				`${p.name} leaves the technical free throw short.`,
			]);
