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
	return `${x[1]} (${tag}). ${pickV(rng, [`Side out, ${ball} ball.`, `${cap(ballTeam)} inbound from the sideline.`, `Baseline inbound for ${ballTeam}.`, `${ball} ball.`])}`;
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
			]
		: r.ins >= 60
			? [
					[" is fouled in the post", "by"],
					[" draws contact on the drive", "from"],
					[" gets hacked going up", "by"],
					[" is fouled on the drive", "by"],
					[" gets wrapped up on the way to the rim", "by"],
				]
			: [
					[" is fouled on the drive", "by"],
					[" draws a shooting foul", "on"],
					[" gets fouled on a jumper", "by"],
					[" draws contact at the rim", "from"],
					[" is fouled going to the basket", "by"],
				];
	const [what, prep] = how[Math.floor(rng.random() * how.length)]!;
	const text = what + (f ? ` ${prep} ${f.name} (${tag})` : "");
	const tail =
		n === 3
			? pickV(rng, [" Three shots.", " He heads to the line for three."])
			: pickV(rng, [" Two shots.", " Two at the line.", " He'll shoot two."]);
	return shooter.name + text + "." + tail;
};

const nerveLine = (rng: Rng, made: boolean) =>
	made
		? pickV(rng, [
				"No nerves there.",
				"He doesn't flinch.",
				"Cool as can be with the game this tight.",
				"Steady at the line with everything on the line.",
			])
		: pickV(rng, [
				"The pressure shows.",
				"He can't convert with the game this tight.",
				"A costly miss at this stage.",
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
					])
				: pickV(rng, [
						`${n} misses the free throw`,
						`${n} can't convert at the line`,
						`${n}'s free throw rims out`,
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
					])
				: pickV(rng, [
						`${n} misses the and-one free throw`,
						`${n} can't convert the free throw`,
						`${n}'s and-one free throw rims out`,
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
				])
			: pickV(rng, [
					`${n} misses the ${ord} free throw`,
					`${n} can't convert the ${ord}`,
					`${n}'s ${ord} free throw rims out`,
					`${n} clanks the ${ord} one`,
					`${n}'s ${ord} free throw is off the back rim`,
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
					])
				: pickV(rng, [
						`${n} makes the third: all 3 free throws are good`,
						`${n} drains the third and hits all 3`,
						`${n} knocks down the third, 3 for 3`,
					]);
	} else if (made) {
		text = pickV(rng, [
			`${n} makes the ${ord}, finishing ${m} of ${total} at the line`,
			`${n} hits the ${ord} to go ${m} of ${total}`,
		]);
	} else if (m === 0) {
		text = pickV(
			rng,
			total === 2
				? [
						`${n} misses the second too and comes up empty`,
						`${n} can't hit either free throw`,
						`${n} misses both; the second hits the front rim`,
					]
				: [`${n} misses all 3 free throws`, `${n} comes up empty at the line`],
		);
	} else {
		text = pickV(rng, [
			`${n} misses the ${ord} and finishes ${m} of ${total}`,
			`${n} leaves the ${ord} short; ${m} of ${total} at the line`,
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
			`${a.name} checks in for ${b.name}.`,
			`${a.name} subs in for ${b.name}.`,
			`${a.name} replaces ${b.name}.`,
			`${b.name} heads to the bench; ${a.name} checks in.`,
		]);
	}
	return `${bare(teamName)} substitution: ${bits.map(({ a, b }) => `${a.name} in for ${b ? b.name : "a teammate"}`).join(", ")}.`;
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
		]);
	} else {
		why = opts.advancesBall
			? pickV(rng, ["", ", to set up a play", ", to draw something up"])
			: pickV(rng, [
					"",
					", to catch their breath",
					", to talk it over",
					", to set up a play",
				]);
	}
	const adv = opts.advancesBall
		? pickV(rng, [
				" They'll advance the ball to the frontcourt.",
				" The ball is moved up to half court.",
			])
		: "";
	return `Timeout, ${bare(team)}${why} (${left}).${adv}`;
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
		]);
	}
	return pickV(rng, [
		"The clock runs out while the defense tries to foul.",
		"Time expires before the defense can get the whistle.",
		"The horn sounds as the defense reaches in; no foul in time.",
	]);
};

export const heaveText = (rng: Rng, p: FPlayer, made: boolean) => {
	const n = p.name;
	if (made) {
		return pickV(rng, [
			`${n} launches from beyond half court as the horn sounds and banks it in! The bench goes wild.`,
			`${n} heaves it from 45 feet at the horn, and it drops! The arena explodes.`,
			`${n} catches, takes two dribbles and lets it fly from the opposite foul line at the horn. Nothing but net!`,
		]);
	}
	return pickV(rng, [
		`${n} heaves one from beyond half court as time expires; well short.`,
		`${possessive(n)} desperation heave from 50 feet at the horn hits the backboard and falls away.`,
		`${n} launches from just past half court as the horn sounds; it's off the mark.`,
		`${n} lets one fly from 40 feet with the clock running out; it clanks off the rim.`,
		`${possessive(n)} heave from the far side of half court is wide.`,
	]);
};

export const injuryText = (rng: Rng, p: FPlayer) =>
	pickV(rng, [
		`${p.name} was injured!`,
		`${p.name} goes down and has to leave the game with an injury.`,
		`${p.name} is helped off the floor; it looks like an injury.`,
	]);

export const tipOff = (
	rng: Rng,
	a: FPlayer,
	b: FPlayer,
	winnerTeam: string,
	overtime: boolean,
) => {
	const lead = overtime ? "Overtime tip: " : "Tip-off: ";
	return (
		lead +
		pickV(rng, [
			`${a.name} and ${b.name} jump; ${winnerTeam} get the ball.`,
			`${a.name} wins the tip over ${b.name}, and ${winnerTeam} have it.`,
			`${a.name} out-leaps ${b.name} and taps it to a teammate: ${winnerTeam} ball.`,
		])
	);
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
	return pickV(rng, [`End of ${which}: ${lead}.`, `${lead} after ${which}.`]);
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
			])
		: pickV(rng, [
				"The noise is deafening.",
				"Nobody in the building is sitting down now.",
				"The crowd is roaring.",
				"You can feel the tension in the building.",
			]);

export const pickOnCourt = (
	rng: Rng,
	ps: FPlayer[],
	w: (p: FPlayer) => number,
) => weighted(rng, ps, w);
export { R100, clockOf };
