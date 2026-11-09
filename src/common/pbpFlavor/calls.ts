// Derived play types and the colour around a play: what kind of shot it was (read off the sim's own shot zone and the wording picked for
// it), the player's style (from his ratings: cosmetic only), announcer calls for the big moments, crowd reactions, momentum and milestone
// notes. Everything here only words what the sim already logged; choices come from the session's seeded generator, never Math.random.
import { pickV } from "./variety.ts";
import type { Rng } from "./rng.ts";
import { aRun, cap, type FPlayer } from "./types.ts";

// ---- the player's style, from his ratings (never from the sim's state) ----
export type Archetype =
	| "sniper"
	| "slasher"
	| "post"
	| "stretch"
	| "playmaker"
	| "rim"
	| "athlete"
	| "glue";

export const archetypeOf = (p: FPlayer): Archetype => {
	const r = p.R;
	if (r.hgt >= 62 && r.tp >= 60) {
		return "stretch";
	}
	if (r.hgt >= 65 && r.ins >= 60) {
		return "post";
	}
	if (r.hgt >= 62 && (r.reb >= 60 || r.diq >= 60)) {
		return "rim";
	}
	if (r.tp >= 68) {
		return "sniper";
	}
	if (r.pss >= 68) {
		return "playmaker";
	}
	if (r.drb >= 60 && r.spd >= 60) {
		return "slasher";
	}
	if (r.jmp >= 70 || r.spd >= 72) {
		return "athlete";
	}
	return "glue";
};

// ---- what kind of shot it was ----
export type ShotKind =
	| "heave"
	| "alley-oop"
	| "inbound-lob"
	| "putback-dunk"
	| "tip-in"
	| "putback"
	| "dunk"
	| "layup"
	| "floater"
	| "hook"
	| "post-move"
	| "fadeaway"
	| "step-back"
	| "pull-up"
	| "bank-shot"
	| "jumper"
	| "deep-two"
	| "logo-three"
	| "deep-three"
	| "corner-three"
	| "step-back-three"
	| "pull-up-three"
	| "catch-and-shoot-three"
	| "three";

export const SHOT_KINDS: readonly ShotKind[] = [
	"heave",
	"alley-oop",
	"inbound-lob",
	"putback-dunk",
	"tip-in",
	"putback",
	"dunk",
	"layup",
	"floater",
	"hook",
	"post-move",
	"fadeaway",
	"step-back",
	"pull-up",
	"bank-shot",
	"jumper",
	"deep-two",
	"logo-three",
	"deep-three",
	"corner-three",
	"step-back-three",
	"pull-up-three",
	"catch-and-shoot-three",
	"three",
];

const DUNK =
	/\bdunk|\bslam|\bjams?\b|flush|throws? (?:it )?down|hammer|tomahawk|windmill|rocks the rim|posteriz|(?<!draped )all over|on [^,]*'s head/;

/* The shot's kind, from the sim's zone (rim, post, mid-range, three; putbacks and inbound tip-ins are their own events) and the words
   the shot was given. `text` is the shot alone (no pass), with the players' names already taken out, so a name like "Banks" can't
   read as a bank shot. */
export const classifyShot = (
	text: string,
	o: {
		three: boolean;
		zone: "rim" | "post" | "mid" | undefined;
		putback: boolean;
		inboundTip: boolean;
		fake: boolean;
		ptype: string | undefined;
	},
): ShotKind => {
	const t = text.toLowerCase();
	if (o.ptype === "heave" || o.ptype === "heave-made") {
		return "heave";
	}
	if (o.ptype === "alleyoop" || o.ptype === "fastbreak-oop") {
		return "alley-oop";
	}
	if (o.inboundTip) {
		return "inbound-lob";
	}
	if (o.ptype === "putbackdunk") {
		return "putback-dunk";
	}
	if (o.ptype === "tipin") {
		return "tip-in";
	}
	if (o.ptype === "putback" || o.putback) {
		return DUNK.test(t)
			? "putback-dunk"
			: /\btip|\btaps?\b/.test(t)
				? "tip-in"
				: "putback";
	}
	if (o.fake) {
		return "deep-two";
	}
	if (o.three) {
		if (/logo|half-court/.test(t)) {
			return "logo-three";
		}
		if (
			/\b(?:28|30|35) feet|way downtown|well beyond|behind the line|from 30/.test(
				t,
			)
		) {
			return "deep-three";
		}
		if (/corner/.test(t)) {
			return "corner-three";
		}
		if (/step-?back|steps back|side-step/.test(t)) {
			return "step-back-three";
		}
		if (
			/pull-?up|pulls up|off the dribble|crosses over|hesitation|shakes|sizes up|dances|stops on a dime|right in/.test(
				t,
			)
		) {
			return "pull-up-three";
		}
		if (
			/catch|spot|screen|pops?\b|pop |flare|curl|pin-?down|stagger|hand-?off|relocat|on the move|closeout|wing|slot|above the break|top of the key/.test(
				t,
			)
		) {
			return "catch-and-shoot-three";
		}
		return "three";
	}
	if (DUNK.test(t)) {
		return "dunk";
	}
	if (/floater|floats|runner|teardrop/.test(t)) {
		return "floater";
	}
	if (/hook/.test(t)) {
		return "hook";
	}
	if (/fadeaway|fades/.test(t)) {
		return "fadeaway";
	}
	if (/step-?back|steps back/.test(t)) {
		return "step-back";
	}
	if (/pull-?up|pulls up|stops short/.test(t)) {
		return "pull-up";
	}
	if (o.zone === "mid" && /\bbank|glass/.test(t)) {
		return "bank-shot";
	}
	if (o.zone === "post") {
		return "post-move";
	}
	if (o.zone === "mid") {
		return "jumper";
	}
	return "layup";
};

// ---- the shot clock ----
export const beatClockText = (rng: Rng) =>
	pickV(rng, [
		" just before the shot clock expires",
		" to beat the shot clock",
		" with the shot clock about to expire",
		" as the shot clock hits one",
		" a split second before the shot-clock horn",
	]);

export const lateClockMiss = (rng: Rng) =>
	pickV(rng, [
		" with the shot clock running out",
		" as the shot clock expires",
		", a forced look late in the clock",
	]);

// ---- second chances ----
export const secondChanceLead = (rng: Rng, made: boolean) =>
	pickV(
		rng,
		made
			? [
					"On the second chance, ",
					"Second-chance points: ",
					"Off the offensive board, ",
				]
			: [
					"On the second chance, ",
					"Off the offensive board, ",
					"With another chance, ",
				],
	);

// ---- the heat check: a three by a player who has made his last few ----
export const heatCheckNote = (
	rng: Rng,
	name: string,
	straight: number,
	made: boolean,
) =>
	made
		? pickV(rng, [
				`Heat check, and it's good: ${straight + 1} straight for ${name}.`,
				`${name} is feeling it: ${straight + 1} makes in a row.`,
				`${name} takes the heat check and cashes it.`,
				`Nobody can cool off ${name}: that's ${straight + 1} straight.`,
			])
		: pickV(rng, [
				`The heat check is off; ${possessiveOf(name)} run of ${straight} straight makes ends.`,
				`${name} tried one heat check too many.`,
				`${possessiveOf(name)} heat check misses after ${straight} straight makes.`,
			]);

const possessiveOf = (name: string) =>
	/s$/i.test(name) ? `${name}'` : `${name}'s`;

// ---- announcer calls for the big moments ----
export type CallKind =
	| "poster"
	| "dunk"
	| "oop"
	| "block"
	| "chasedown"
	| "deep"
	| "buzzer"
	| "winner"
	| "dagger"
	| "heat"
	| "heave";

export const bigCall = (rng: Rng, kind: CallKind): string => {
	switch (kind) {
		case "poster":
			return pickV(rng, [
				"Oh my!",
				"Are you kidding me?!",
				"Put that one on a poster!",
				"Wow!",
				"He just dunked on him!",
			]);
		case "dunk":
			return pickV(rng, [
				"Boom!",
				"Oh, what a finish!",
				"Thunder!",
				"Look out below!",
			]);
		case "oop":
			return pickV(rng, [
				"What a connection!",
				"Up, and in!",
				"Special delivery!",
				"What a lob!",
			]);
		case "block":
			return pickV(rng, [
				"Get that out of here!",
				"Rejected!",
				"Not in his house!",
				"Denied!",
				"No, no, no!",
			]);
		case "chasedown":
			return pickV(rng, [
				"Out of nowhere!",
				"Where did he come from?!",
				"What a hustle play!",
			]);
		case "deep":
			return pickV(rng, [
				"Bang!",
				"From way downtown!",
				"Splash!",
				"Are you serious?!",
				"From the parking lot!",
			]);
		case "buzzer":
			return pickV(rng, [
				"At the horn!",
				"Got it off in time!",
				"Beat the buzzer!",
				"Just in time!",
			]);
		case "winner":
			return pickV(rng, [
				"Bang! Ballgame!",
				"He did it!",
				"What a finish!",
				"Unbelievable!",
				"Cold-blooded!",
			]);
		case "dagger":
			return pickV(rng, [
				"Dagger!",
				"That might do it.",
				"That should seal it.",
				"Ice cold.",
			]);
		case "heat":
			return pickV(rng, [
				"He's feeling it!",
				"Splash!",
				"Too hot to handle!",
				"Bang!",
			]);
		case "heave":
			return pickV(rng, [
				"You have got to be kidding me!",
				"No way!",
				"Bedlam!",
			]);
	}
};

// ---- the crowd, by whose building it is (teams[0] is the home team; not in a neutral exhibition) ----
export const homeCrowd = (
	rng: Rng,
	home: boolean,
	kind: "wow" | "tight" | "run",
	team: string,
) => {
	if (kind === "run") {
		return home
			? pickV(rng, [
					"The home crowd is roaring now.",
					"The arena is rocking.",
					"The fans are on their feet for this run.",
				])
			: pickV(rng, [
					"The building has gone quiet.",
					"That run has silenced the crowd.",
					`${cap(team)} have taken the crowd right out of it.`,
				]);
	}
	if (kind === "tight") {
		return home
			? pickV(rng, [
					"The home crowd is trying to will them on.",
					"Every fan in the building is standing.",
				])
			: pickV(rng, ["A few boos rain down.", "The crowd groans."]);
	}
	return home
		? pickV(rng, [
				"The home crowd erupts.",
				"The fans love that one.",
				"The roof nearly comes off.",
			])
		: pickV(rng, [
				"That one quiets the crowd.",
				"Even the home fans have to admire that.",
				`${cap(team)} bench celebrates on the road.`,
			]);
};

// ---- momentum ----
export const runLine = (
	rng: Rng,
	team: string,
	S: number,
	O: number,
	overSecs: number | undefined,
	clock: (s: number) => string,
) => {
	const label = `${S}-${O}`;
	const rows = [
		`That's ${aRun(label)} for ${team}.`,
		`${cap(team)} have ${S} of the last ${S + O} points.`,
		`${cap(team)} are on ${aRun(label)}.`,
		`The momentum is all with ${team}: ${aRun(label)}.`,
	];
	if (O === 0) {
		rows.push(
			`${cap(team)} have scored ${S} straight.`,
			`${S} unanswered for ${team}.`,
		);
	}
	if (overSecs !== undefined && overSecs >= 60) {
		rows.push(
			`${cap(team)} have outscored them ${label} over the last ${clock(overSecs)}.`,
		);
	}
	return pickV(rng, rows);
};

export const runEndedLine = (
	rng: Rng,
	scorer: string,
	runTeam: string,
	label: string,
) =>
	pickV(rng, [
		`That ends ${aRun(label)} by ${runTeam}.`,
		`${cap(scorer)} finally answer, stopping ${aRun(label)}.`,
		`${cap(scorer)} stop the bleeding after ${aRun(label)} by ${runTeam}.`,
	]);

// ---- streaks ----
export const streakLine = (rng: Rng, name: string, pts: number, team: string) =>
	pickV(rng, [
		`${name} has scored ${pts} straight for ${team}.`,
		`${pts} straight points for ${name}.`,
		`${name} is doing it all himself: ${pts} in a row for ${team}.`,
		`It's the ${name} show: ${pts} straight.`,
	]);

export const hotLine = (rng: Rng, name: string, n: number) =>
	n >= 6
		? pickV(rng, [
				`${name} is on fire: ${n} straight makes.`,
				`${name} can't miss: ${n} in a row.`,
				`${n} straight buckets for ${name}. Someone has to stop him.`,
			])
		: pickV(rng, [
				`${name} is heating up: ${n} straight makes.`,
				`That's ${n} straight buckets for ${name}.`,
				`${name} has found his rhythm: ${n} in a row.`,
			]);

export const droughtLine = (rng: Rng, d: string, team: string) => {
	const a = /^(8|11|18)\b/.test(d) ? "an" : "a";
	return pickV(rng, [
		`That ends ${a} ${d} drought for ${team}.`,
		`${cap(team)} finally score, ending ${a} ${d} drought.`,
		`${cap(team)} snap ${a} ${d} scoring drought.`,
	]);
};

// ---- milestones ----
export const pointsMilestone = (
	rng: Rng,
	short: string,
	m: number,
	exact: boolean,
	gameHigh: boolean,
) =>
	pickV(rng, [
		`That's ${m} for ${short}.`,
		`${short} reaches ${m}.`,
		...(exact
			? [
					`That's point number ${m} for ${short}.`,
					`${m} and counting for ${short}.`,
				]
			: []),
		...(gameHigh && m >= 30
			? [`That's ${m} for ${short}, the most of anyone tonight.`]
			: []),
	]);

export const doubleDouble = (rng: Rng, name: string, a: string, b: string) =>
	pickV(rng, [
		`Double-double for ${name}.`,
		`${name} has a double-double: ${a} and ${b}.`,
		`That's a double-double for ${name}.`,
	]);

export const tripleDouble = (rng: Rng, name: string, line: string) =>
	pickV(rng, [
		`That's a triple-double for ${name}.`,
		`Triple-double for ${name}: ${line}.`,
		`${name} completes the triple-double: ${line}.`,
	]);

export const tripleDoubleWatch = (
	rng: Rng,
	short: string,
	need: number,
	stat: string,
) =>
	pickV(rng, [
		`${short} is ${need} ${stat} shy of a triple-double.`,
		`Triple-double watch: ${short} needs ${need} more ${stat}.`,
		`${short} is flirting with a triple-double, ${need} ${stat} away.`,
	]);

export const doubleFigures = (rng: Rng, short: string, what: string) =>
	pickV(rng, [
		`${short} reaches double figures in ${what}.`,
		`That's 10 ${what} for ${short}.`,
	]);
