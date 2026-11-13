// The action around a play: the set the offense ran to get the shot (pick-and-roll, isolation, post-up, drive-and-kick, backdoor cut,
// off-ball screens, hand-offs, leak-outs), the defense it ran into (switches, double teams, the zone), and the move that got the shot off
// (Euro steps, spin moves, crossovers and ankle-breakers, pump fakes, up-and-unders). None of it is in the sim's events: it is derived from
// the play the sim logged (zone, assist, who was on the floor) and the players' ratings, and picked with the session's seeded generator,
// so it can only change the words, never the game. Also: what kind of turnover, steal or rebound a line describes, for the top plays.
import { pickW, usedWithin } from "./variety.ts";
import type { Rng } from "./rng.ts";
import { archetypeOf } from "./calls.ts";
import { TIER, cap, gate, poss, type FPlayer } from "./types.ts";

export type ActionKind =
	// how the offense got the shot
	| "pick-and-roll"
	| "pick-and-pop"
	| "isolation"
	| "post-up"
	| "drive-and-kick"
	| "backdoor-cut"
	| "off-ball-screen"
	| "handoff"
	| "leak-out"
	| "outlet"
	// what the defense did
	| "switch"
	| "double-team"
	| "zone"
	// the move
	| "euro-step"
	| "spin-move"
	| "crossover"
	| "ankle-breaker"
	| "pump-fake"
	| "up-and-under"
	| "goaltending"
	// blocks, steals, hustle
	| "chase-down"
	| "loose-ball"
	| "deflection"
	| "interception"
	| "strip"
	| "trap"
	// turnovers
	| "charge-taken"
	| "offensive-foul"
	| "illegal-screen"
	| "travel"
	| "double-dribble"
	| "carry"
	| "three-seconds"
	| "backcourt"
	| "eight-second"
	| "five-second"
	| "shot-clock"
	| "bad-pass"
	| "lost-ball"
	// rebounds
	| "box-out"
	| "rebound-battle";

export const ACTION_KINDS: readonly ActionKind[] = [
	"pick-and-roll",
	"pick-and-pop",
	"isolation",
	"post-up",
	"drive-and-kick",
	"backdoor-cut",
	"off-ball-screen",
	"handoff",
	"leak-out",
	"outlet",
	"switch",
	"double-team",
	"zone",
	"euro-step",
	"spin-move",
	"crossover",
	"ankle-breaker",
	"pump-fake",
	"up-and-under",
	"goaltending",
	"chase-down",
	"loose-ball",
	"deflection",
	"interception",
	"strip",
	"trap",
	"charge-taken",
	"offensive-foul",
	"illegal-screen",
	"travel",
	"double-dribble",
	"carry",
	"three-seconds",
	"backcourt",
	"eight-second",
	"five-second",
	"shot-clock",
	"bad-pass",
	"lost-ball",
	"box-out",
	"rebound-battle",
];

type Row = [number, string, ActionKind, ...any[]];

// A move or a set that was worded in the last few dozen lines is left out rather than repeated: the plain wording is used instead
const freshOnly = (rows: (Row | false)[]) =>
	rows.filter((x): x is Row => !!x && !usedWithin(x[1], 150));

// ---- the announcer's way of naming a player a second time, from his style (cosmetic only) ----
const ROLE_NAMES: Record<
	ReturnType<typeof archetypeOf>,
	[string[], string[]]
> = {
	// [any league, men's league only]
	sniper: [["the sharpshooter", "the marksman", "the shooter"], []],
	slasher: [["the slasher", "the downhill driver"], []],
	post: [["the post scorer", "the low-post threat"], ["the big man"]],
	stretch: [["the stretch big", "the floor-spacing big"], []],
	playmaker: [["the floor general", "the playmaker", "the table-setter"], []],
	rim: [["the rim protector", "the anchor in the middle"], ["the big man"]],
	athlete: [["the high-flyer", "the athlete"], []],
	glue: [["the role player", "the hustle player"], ["the glue guy"]],
};

export const roleNames = (p: FPlayer, female: boolean): string[] => {
	const [any, men] = ROLE_NAMES[archetypeOf(p)];
	return female ? any : [...any, ...men];
};

// ---- the move that got a shot off: only shots he made for himself (unassisted, in the half court) ----
export type MoveResult = {
	text: string;
	action: ActionKind;
	def?: FPlayer;
	wow?: boolean;
};

export const signatureMove = (
	rng: Rng,
	o: {
		p: FPlayer;
		// "three" for a three-pointer, else the sim's zone
		zone: "rim" | "post" | "mid" | "three";
		made: boolean;
		def: FPlayer | null | undefined;
		andOne: boolean;
	},
): MoveResult | null => {
	const p = o.p;
	const r = p.R;
	const n = p.name;
	const D = o.def ?? undefined;
	const dn = D ? D.name : "his man";
	// how likely a move is at all: the better the handle (or the post game), the more often
	const skill =
		o.zone === "post" ? Math.max(r.ins, r.drb - 5) : Math.max(r.drb, r.oiq - 5);
	const base =
		{ rim: 0.16, post: 0.2, mid: 0.13, three: 0.07 }[o.zone] *
		(0.4 + Math.max(0, skill - 35) / 50);
	if (rng.random() >= base) {
		return null;
	}
	const rows: (Row | false)[] = [];
	const add = (
		w: number,
		t: string,
		a: ActionKind,
		x?: { def?: boolean; wow?: boolean },
	) => {
		if (w > 0 && (!x?.def || D)) {
			rows.push([w, t, a, x ?? {}]);
		}
	};
	const h = r.drb;
	const quick = Math.min(r.drb, r.spd);
	if (o.made) {
		if (o.zone === "rim") {
			add(
				TIER.u * gate(quick, 55),
				`${n} Euro-steps past ${dn} and lays it in`,
				"euro-step",
				{ def: true },
			);
			add(
				TIER.u * gate(quick, 55),
				`${n} gathers, Euro-steps around the help and finishes off the glass`,
				"euro-step",
			);
			add(
				TIER.u * gate(quick, 58),
				`${n} sells the step one way, Euro-steps the other and lays it in`,
				"euro-step",
			);
			add(
				TIER.u * gate(quick, 60),
				`${n} Euro-steps through two defenders and scoops it in`,
				"euro-step",
			);
			add(
				TIER.r * gate(Math.min(quick, r.dnk), 70),
				`${n} Euro-steps past ${dn} and throws it down`,
				"euro-step",
				{ def: true, wow: true },
			);
			add(
				TIER.u * gate(h, 58),
				`${n} spins past ${dn} in the lane and lays it in`,
				"spin-move",
				{ def: true },
			);
			add(
				TIER.u * gate(h, 58),
				`${n} hits a spin move in traffic and kisses it off the glass`,
				"spin-move",
			);
			add(
				TIER.u * gate(h, 62),
				`${n} spins baseline and flips in a reverse layup`,
				"spin-move",
			);
			add(
				TIER.u * gate(h, 55),
				`${n} crosses ${dn} over and blows by for the layup`,
				"crossover",
				{ def: true },
			);
			add(
				TIER.u * gate(h, 55),
				`${n} goes between the legs, crosses over and gets all the way to the rim for the layup`,
				"crossover",
			);
			add(
				TIER.r * gate(h, 72),
				`${n} crosses over ${dn}, who stumbles to the floor, and strolls in for the layup`,
				"ankle-breaker",
				{ def: true, wow: true },
			);
			add(
				TIER.e * gate(h, 80),
				`${n} breaks ${poss(dn)} ankles with a crossover and lays it in untouched`,
				"ankle-breaker",
				{ def: true, wow: true },
			);
			add(
				TIER.u * gate(quick, 58),
				`${n} hesitates, then explodes past ${dn} for the layup`,
				"crossover",
				{ def: true },
			);
			add(
				TIER.u * gate(h, 62),
				`${n} spins out of a double team and lays it in`,
				"spin-move",
			);
			add(
				TIER.u * gate(quick, 58),
				`${n} Euro-steps and finishes with the left hand`,
				"euro-step",
			);
			add(
				TIER.u * gate(r.oiq, 50),
				`${n} pump-fakes ${dn} into the air and lays it in`,
				"pump-fake",
				{ def: true },
			);
			add(
				TIER.u * gate(r.oiq, 50),
				`${n} gets the shot-blocker off his feet with a pump fake and finishes`,
				"pump-fake",
			);
			add(
				TIER.u * gate(Math.max(r.oiq, h), 55),
				`${n} goes up and under ${dn} for the reverse layup`,
				"up-and-under",
				{ def: true },
			);
			if (D && D.R.hgt >= 60 && !o.andOne) {
				add(
					TIER.r * 0.6,
					`${n} goes up for the layup and ${dn} pins it against the glass, but it's goaltending; the basket counts`,
					"goaltending",
					{ def: true },
				);
				add(
					TIER.r * 0.5,
					`${poss(n)} layup is swatted on the way down by ${dn}: goaltending, and the basket counts`,
					"goaltending",
					{ def: true },
				);
			}
		} else if (o.zone === "post") {
			add(
				TIER.c * gate(r.ins, 50),
				`${n} pump-fakes on the block, gets ${dn} in the air and goes up and under for the score`,
				"up-and-under",
				{ def: true },
			);
			add(
				TIER.c * gate(r.ins, 50),
				`${n} uses an up-and-under on the block and banks it in`,
				"up-and-under",
			);
			add(
				TIER.u * gate(Math.max(r.ins, h), 55),
				`${n} shoulder-fakes, spins middle and hits the jump hook`,
				"spin-move",
			);
			add(
				TIER.u * gate(r.ins, 52),
				`${n} up-fakes, steps through and lays it in`,
				"up-and-under",
			);
			add(
				TIER.u * gate(Math.max(r.ins, h), 55),
				`${n} spins baseline on ${dn} and drops in a hook`,
				"spin-move",
				{ def: true },
			);
			add(
				TIER.u * gate(Math.max(r.ins, h), 55),
				`${n} spins off ${dn} on the block and scores`,
				"spin-move",
				{ def: true },
			);
			add(
				TIER.u * gate(r.ins, 55),
				`${n} drop-steps around ${dn} and scores on the block`,
				"post-up",
				{ def: true },
			);
			add(
				TIER.r * gate(Math.min(r.ins, h), 66),
				`${n} works ${dn} with a Dream Shake on the block and lays it in`,
				"pump-fake",
				{ def: true, wow: true },
			);
			add(
				TIER.u * gate(r.fg, 55),
				`${n} faces up ${dn}, jab-steps and hits a turnaround fadeaway`,
				"post-up",
				{ def: true },
			);
		} else if (o.zone === "mid") {
			add(
				TIER.r * gate(h, 70),
				`${n} crosses over ${dn}, sends him to the floor and buries the pull-up jumper`,
				"ankle-breaker",
				{ def: true, wow: true },
			);
			add(
				TIER.u * gate(r.oiq, 50),
				`${n} pump-fakes, lets ${dn} fly by and knocks down the pull-up jumper`,
				"pump-fake",
				{ def: true },
			);
			add(
				TIER.u * gate(r.oiq, 50),
				`${n} gets his man to bite on a pump fake and hits the pull-up from the elbow`,
				"pump-fake",
			);
			add(
				TIER.u * gate(Math.min(h, r.fg), 58),
				`${n} spins away from ${dn} and hits the fadeaway`,
				"spin-move",
				{ def: true },
			);
			add(
				TIER.u * gate(h, 55),
				`${n} hits ${dn} with a hesitation crossover and pulls up from the elbow`,
				"crossover",
				{ def: true },
			);
			add(
				TIER.u * gate(h, 55),
				`${n} crosses over at the free-throw line and pulls up for two`,
				"crossover",
			);
			add(
				TIER.u * gate(h, 60),
				`${n} breaks ${dn} down with a crossover, steps back and hits the jumper`,
				"crossover",
				{ def: true },
			);
		} else {
			add(
				TIER.r * gate(Math.min(h, r.tp), 68),
				`${n} crosses ${dn} to the floor and drills the step-back three`,
				"ankle-breaker",
				{ def: true, wow: true },
			);
			add(
				TIER.u * gate(Math.min(r.oiq, r.tp), 55),
				`${n} pump-fakes ${dn} out of the play, side-steps and buries the three`,
				"pump-fake",
				{ def: true },
			);
			add(
				TIER.u * gate(Math.min(h, r.tp), 55),
				`${n} crosses over ${dn} and buries a pull-up three`,
				"crossover",
				{ def: true },
			);
			add(
				TIER.u * gate(Math.min(h, r.tp), 58),
				`${n} hesitates, crosses over and splashes a pull-up three`,
				"crossover",
			);
			add(
				TIER.u * gate(Math.min(h, r.tp), 58),
				`${n} shakes ${dn} with a between-the-legs crossover and hits a step-back three`,
				"crossover",
				{ def: true },
			);
		}
	} else if (o.zone === "rim") {
		add(
			TIER.u * gate(quick, 55),
			`${n} Euro-steps past ${dn} but can't finish`,
			"euro-step",
			{ def: true },
		);
		add(
			TIER.u * gate(quick, 55),
			`${n} Euro-steps into the lane and his layup rolls off`,
			"euro-step",
		);
		add(
			TIER.u * gate(h, 58),
			`${poss(n)} spin move gets him to the rim, but the layup won't drop`,
			"spin-move",
		);
		add(
			TIER.u * gate(h, 55),
			`${n} crosses over ${dn} and gets to the rim, but misses the layup`,
			"crossover",
			{ def: true },
		);
		add(
			TIER.u * gate(r.oiq, 50),
			`${n} pump-fakes ${dn} into the air, but the layup rims out`,
			"pump-fake",
			{ def: true },
		);
		add(
			TIER.u * gate(Math.max(r.oiq, h), 55),
			`${n} goes up and under, but the reverse layup won't fall`,
			"up-and-under",
		);
		add(
			TIER.u * gate(h, 60),
			`${n} spins past ${dn} and comes up short on the layup`,
			"spin-move",
			{ def: true },
		);
		add(
			TIER.u * gate(quick, 58),
			`${n} Euro-steps around the help but puts too much on the layup`,
			"euro-step",
		);
		add(
			TIER.u * gate(h, 55),
			`${n} goes between the legs, beats ${dn} off the bounce and misses at the rim`,
			"crossover",
			{ def: true },
		);
		add(
			TIER.u * gate(r.oiq, 52),
			`${n} gets the shot-blocker to leave his feet with a pump fake, but the layup won't go`,
			"pump-fake",
		);
	} else if (o.zone === "post") {
		add(
			TIER.c * gate(r.ins, 50),
			`${n} pump-fakes on the block and goes up and under, but it rims out`,
			"up-and-under",
		);
		add(
			TIER.u * gate(Math.max(r.ins, h), 55),
			`${n} spins baseline on ${dn}, but his hook is off`,
			"spin-move",
			{ def: true },
		);
		add(
			TIER.u * gate(r.ins, 55),
			`${n} drop-steps around ${dn} and misses at the rim`,
			"post-up",
			{ def: true },
		);
		add(
			TIER.u * gate(r.ins, 52),
			`${n} uses a pump fake on the block, but ${dn} doesn't bite and the shot is off`,
			"pump-fake",
			{ def: true },
		);
		add(
			TIER.u * gate(Math.max(r.ins, h), 55),
			`${n} spins to the middle for a hook that rolls off`,
			"spin-move",
		);
	} else if (o.zone === "mid") {
		add(
			TIER.u * gate(r.oiq, 50),
			`${n} pump-fakes ${dn} into the air but misses the pull-up`,
			"pump-fake",
			{ def: true },
		);
		add(
			TIER.u * 0.7 * gate(h, 55),
			`${poss(n)} crossover gets ${dn} leaning, but the pull-up jumper is off`,
			"crossover",
			{ def: true },
		);
		add(
			TIER.u * 0.7 * gate(h, 55),
			`${n} crosses over at the elbow and pulls up, but it's long`,
			"crossover",
		);
		add(
			TIER.u * 0.7 * gate(h, 58),
			`${n} shakes ${dn} with a hesitation but misses the pull-up`,
			"crossover",
			{ def: true },
		);
		add(
			TIER.u * gate(Math.min(h, r.fg), 58),
			`${n} spins into a fadeaway that rims out`,
			"spin-move",
		);
		add(
			TIER.u * gate(Math.min(h, r.fg), 60),
			`${n} spins away from ${dn} and the fadeaway hits the back rim`,
			"spin-move",
			{ def: true },
		);
	} else {
		add(
			TIER.u * gate(Math.min(h, r.tp), 55),
			`${n} crosses over and pulls up from three, but it's off`,
			"crossover",
		);
		add(
			TIER.u * gate(Math.min(r.oiq, r.tp), 55),
			`${n} pump-fakes ${dn} by, side-steps and misses the three`,
			"pump-fake",
			{ def: true },
		);
	}
	const x = pickW(rng, freshOnly(rows));
	if (!x) {
		return null;
	}
	const extra = x[3] as { def?: boolean; wow?: boolean };
	return {
		text: x[1],
		action: x[2],
		def: extra.def ? D : undefined,
		wow: !!extra.wow,
	};
};

// ---- the set the offense ran, as a short sentence before the shot ----

// A shot line that already names its own action (a pass out of the pick-and-roll, a post entry, a kick-out, a move...) gets no set before it
const HAS_ACTION =
	/pick-and-|screen|\bpost|hand-?off|backdoor|\bdrives?\b|\bdrive-|kick|\bcuts?\b|double team|skip pass|swing pass|outlet|\blob|horns|spain|isolat|one-more|extra pass|entry|high-low|dump|pocket|relocat|curl|pin-?down|stagger|cross|spin|euro|pump|break|transition|2-on-1|coast|step-?back|side-step|hesitation|jab|fake|sizes up|one-on-one|clear|switch|zone|block|baseline|elbow|wing|corner|top of the key|in the paint|lane|leaks/i;

export type SetResult = { text: string; action: ActionKind };

export const setPlay = (
	rng: Rng,
	o: {
		p: FPlayer;
		ast: FPlayer | undefined;
		zone: "rim" | "post" | "mid" | "three";
		made: boolean;
		// the line the set goes before (names taken out)
		line: string;
		mates: FPlayer[];
		defs: FPlayer[];
		// the defense's look, and the teams as they read in a sentence ("the Celtics")
		scheme: string;
		offense: string;
		defense: string;
	},
): SetResult | null => {
	if (HAS_ACTION.test(o.line)) {
		return null;
	}
	const p = o.p;
	const n = p.name;
	const r = p.R;
	const A = o.ast;
	const an = A?.name;
	const big = (q: FPlayer) => q.R.hgt >= 60;
	const others = o.mates.filter((q) => q.pid !== p.pid && q.pid !== A?.pid);
	const screener =
		others.length > 0
			? others.reduce((a, b) =>
					b.R.hgt + b.R.stre > a.R.hgt + a.R.stre ? b : a,
				)
			: undefined;
	const guard =
		others.length > 0
			? others.reduce((a, b) => (b.R.drb + b.R.pss > a.R.drb + a.R.pss ? b : a))
			: undefined;
	const D =
		o.defs.length > 0
			? o.defs[Math.floor(rng.random() * o.defs.length)]
			: undefined;
	const tallD =
		o.defs.length > 0
			? o.defs.reduce((a, b) => (b.R.hgt > a.R.hgt ? b : a))
			: undefined;
	const rows: (Row | false)[] = [];
	const add = (w: number, t: string, a: ActionKind) => {
		if (w > 0) {
			rows.push([w, t, a]);
		}
	};
	const Off = cap(o.offense);
	const zone = o.scheme === "zone";
	const switching = o.scheme === "switch";

	if (A && an) {
		// assisted: the pass is in the line already, the set says how it came about
		if (o.zone === "rim") {
			if (big(p)) {
				add(1, `${an} and ${n} run the pick-and-roll.`, "pick-and-roll");
				add(
					0.7,
					`${n} screens and dives while ${an} draws the big up high.`,
					"pick-and-roll",
				);
				add(
					0.6,
					`${Off} run Horns: ${an} at the top, ${n} at the elbow.`,
					"pick-and-roll",
				);
				add(
					1,
					`${n} sets the screen for ${an} and rolls hard to the rim.`,
					"pick-and-roll",
				);
				add(
					0.7,
					`${n} slips the screen before the defense can show.`,
					"pick-and-roll",
				);
				add(
					0.6,
					`${an} comes off a high screen from ${n}, and ${n} dives to the basket.`,
					"pick-and-roll",
				);
			} else {
				add(
					0.8,
					`${n} catches his man ball-watching and cuts backdoor.`,
					"backdoor-cut",
				);
				add(0.6, `${n} fakes the pop-out and goes backdoor.`, "backdoor-cut");
				add(0.5, `${n} cuts hard off a back screen.`, "off-ball-screen");
			}
			add(
				0.6,
				`${an} gets into the lane and draws two defenders.`,
				"drive-and-kick",
			);
			if (A.R.hgt >= 62) {
				add(
					0.5,
					`${an} draws a double team from ${o.defense} in the post.`,
					"double-team",
				);
			}
		} else if (o.zone === "three") {
			add(
				1,
				`${an} gets into the paint and the defense collapses.`,
				"drive-and-kick",
			);
			add(
				0.8,
				`${an} attacks the closeout and draws the help.`,
				"drive-and-kick",
			);
			add(
				0.7,
				`${an} drives baseline and finds the open man.`,
				"drive-and-kick",
			);
			if (screener) {
				add(
					0.8,
					`${n} comes off a pin-down from ${screener.name}.`,
					"off-ball-screen",
				);
				add(
					0.6,
					`${n} runs off staggered screens from ${screener.name} and a teammate.`,
					"off-ball-screen",
				);
			}
			add(0.6, `${n} flares off a screen on the weak side.`, "off-ball-screen");
			add(
				0.6,
				`${n} relocates to the corner as ${an} drives.`,
				"drive-and-kick",
			);
			add(
				switching ? 0.8 : 0.3,
				`${Off} get ${o.defense} to switch the screen, and the help is a step late.`,
				"switch",
			);
			add(0.6, `${an} and ${n} work a dribble hand-off up top.`, "handoff");
			if (big(p) && r.tp >= 50) {
				add(
					1.5,
					`${n} sets a ball screen for ${an} and pops out to the arc.`,
					"pick-and-pop",
				);
			}
			if (A.R.hgt >= 62 || A.R.ins >= 60) {
				add(
					1,
					`${an} is doubled in the post and passes out of it.`,
					"double-team",
				);
			}
			if (zone) {
				add(1.5, `${Off} swing it around the zone.`, "zone");
				add(
					1,
					`${an} finds the soft spot in the zone and kicks it out.`,
					"zone",
				);
			}
		} else if (o.zone === "mid") {
			add(0.8, `${an} and ${n} run a dribble hand-off.`, "handoff");
			add(0.6, `${n} pops to the elbow off a down screen.`, "off-ball-screen");
			if (screener) {
				add(
					0.8,
					`${n} curls off a screen from ${screener.name}.`,
					"off-ball-screen",
				);
			}
			if (big(p)) {
				add(
					1,
					`${n} sets the high screen for ${an} and pops to the elbow.`,
					"pick-and-pop",
				);
			} else if (screener) {
				add(
					0.6,
					`${screener.name} sets a high screen for ${an}.`,
					"pick-and-roll",
				);
			}
			if (zone) {
				add(1, `${n} flashes to the middle of the zone.`, "zone");
			}
		} else {
			add(1, `${n} seals his man deep in the paint.`, "post-up");
			if (D) {
				add(1, `${n} posts up ${D.name} on the block.`, "post-up");
			}
			add(0.6, `${n} establishes position on the left block.`, "post-up");
			add(
				0.6,
				`${n} posts up on the right block as the weak side clears.`,
				"post-up",
			);
			if (switching && tallD) {
				add(
					0.8,
					`A switch leaves a smaller defender on ${n} in the post.`,
					"switch",
				);
			}
		}
	} else {
		// unassisted (every miss, too)
		if (o.zone === "post") {
			if (D) {
				add(1, `${n} backs ${D.name} down on the left block.`, "post-up");
				add(
					0.8,
					`${n} establishes deep post position against ${D.name}.`,
					"post-up",
				);
				add(
					0.8,
					`${n} calls for the ball on the block and goes to work on ${D.name}.`,
					"post-up",
				);
			}
			add(
				0.6,
				`${n} catches it on the mid-post and backs his man down.`,
				"post-up",
			);
			add(
				r.ins >= 60 ? 0.7 : 0.3,
				`${n} draws a double team from ${o.defense} and goes up anyway.`,
				"double-team",
			);
			if (switching && D && D.R.hgt < p.R.hgt - 5) {
				add(
					1,
					`${n} punishes the switch: ${D.name} is on him in the post.`,
					"switch",
				);
			}
		} else {
			const handler = r.drb >= 55 || r.pss >= 60;
			if (handler) {
				const iso = r.drb >= 65 ? 1.5 : 0.7;
				add(iso, `${Off} clear out and let ${n} go to work.`, "isolation");
				add(iso, `Isolation for ${n} at the top of the key.`, "isolation");
				add(
					iso * 0.8,
					`${n} sizes up his man on the wing, one-on-one.`,
					"isolation",
				);
				add(
					iso * 0.6,
					`Everybody else spaces to the corners for ${n}.`,
					"isolation",
				);
				add(iso * 0.6, `${Off} spread the floor for ${n}.`, "isolation");
				if (D) {
					add(
						iso,
						`${n} waves off the screen and isolates on ${D.name}.`,
						"isolation",
					);
					add(iso * 0.7, `${n} gets ${D.name} on an island.`, "isolation");
					add(
						iso * 0.6,
						`${n} attacks ${D.name} off the bounce from the top.`,
						"isolation",
					);
				}
				if (screener) {
					add(
						1,
						`${screener.name} sets a high screen for ${n}.`,
						"pick-and-roll",
					);
					add(
						0.8,
						`${n} comes off a ball screen from ${screener.name}.`,
						"pick-and-roll",
					);
					add(
						0.5,
						`${n} rejects the screen from ${screener.name} and goes the other way.`,
						"pick-and-roll",
					);
					add(
						0.6,
						`${n} uses a screen from ${screener.name} to get downhill.`,
						"pick-and-roll",
					);
					add(
						0.5,
						`${n} gets a high pick from ${screener.name} and turns the corner.`,
						"pick-and-roll",
					);
				}
				if (
					tallD &&
					tallD.R.hgt >= p.R.hgt + 20 &&
					(switching || rng.random() < 0.3)
				) {
					add(
						0.5,
						`${n} gets the switch he wants: ${tallD.name} is on him.`,
						"switch",
					);
					add(
						0.4,
						`${n} hunts the switch and gets ${tallD.name} out on the perimeter.`,
						"switch",
					);
				}
			}
			// (a pass that led straight to a made shot would have been an assist: those sets only go before a miss)
			if (!o.made && (!handler || o.zone === "three" || o.zone === "mid")) {
				if (guard && guard.pid !== p.pid) {
					add(
						o.zone === "rim" ? 0.3 : 0.8,
						`${guard.name} drives and kicks it out to ${n}.`,
						"drive-and-kick",
					);
					add(
						0.5,
						`${guard.name} and ${n} work a dribble hand-off.`,
						"handoff",
					);
				}
				if (screener && screener.pid !== p.pid) {
					add(
						0.6,
						`${n} comes off a pin-down from ${screener.name}.`,
						"off-ball-screen",
					);
				}
			}
			if (!o.made && big(p) && o.zone === "three" && guard) {
				add(
					1.2,
					`${n} screens for ${guard.name} and pops out to the arc.`,
					"pick-and-pop",
				);
			}
			if (!o.made && big(p) && o.zone === "rim" && guard) {
				add(
					1,
					`${guard.name} and ${n} run the pick-and-roll, and ${n} rolls to the rim.`,
					"pick-and-roll",
				);
			}
			if (zone && o.zone !== "rim") {
				add(1, `${Off} probe the zone.`, "zone");
				if (!o.made) {
					add(0.7, `${Off} can't find a seam in the zone.`, "zone");
					add(
						0.5,
						`The ball handler is trapped, and it swings to ${n}.`,
						"double-team",
					);
				}
				add(0.7, `Against the zone, ${n} finds a gap.`, "zone");
			}
			if (D && o.zone === "rim" && switching) {
				add(0.3, `${n} gets ${D.name} on a switch after the screen.`, "switch");
			}
			if (!o.made && o.zone === "rim" && r.spd >= 55) {
				add(
					0.4,
					`${n} cuts backdoor behind a ball-watching defense.`,
					"backdoor-cut",
				);
			}
		}
	}
	const x = pickW(rng, freshOnly(rows));
	return x ? { text: x[1], action: x[2] } : null;
};

// ---- what a line describes, read off the words picked for it ----
export const tovAction = (
	text: string,
	o: { shotClock: boolean; charge: boolean; offFoul: boolean },
): ActionKind => {
	const t = text.toLowerCase();
	if (o.shotClock) {
		return "shot-clock";
	}
	if (o.charge) {
		return "charge-taken";
	}
	if (/illegal screen|moving screen|on the screen/.test(t)) {
		return "illegal-screen";
	}
	if (o.offFoul) {
		return "offensive-foul";
	}
	if (/travel/.test(t)) {
		return "travel";
	}
	if (/double dribble|double-dribble/.test(t)) {
		return "double-dribble";
	}
	if (/carry|carrying|palming/.test(t)) {
		return "carry";
	}
	if (/three seconds|three-second|3 seconds/.test(t)) {
		return "three-seconds";
	}
	if (/backcourt|back over half court/.test(t)) {
		return "backcourt";
	}
	if (/8-second|eight-second|eight seconds/.test(t)) {
		return "eight-second";
	}
	if (/five-second|5-second/.test(t)) {
		return "five-second";
	}
	if (/trap|press/.test(t)) {
		return "trap";
	}
	if (/pass|lob|outlet|feed|hand-off|inbound/.test(t)) {
		return "bad-pass";
	}
	return "lost-ball";
};

export const stealAction = (text: string): ActionKind => {
	const t = text.toLowerCase();
	if (/dives|loose ball|on the floor/.test(t)) {
		return "loose-ball";
	}
	if (/trap/.test(t)) {
		return "trap";
	}
	if (
		/intercept|picks off|passing lane|jumps the|steps in front|steals the inbound/.test(
			t,
		)
	) {
		return "interception";
	}
	if (/deflect|tips|gets a hand/.test(t)) {
		return "deflection";
	}
	return "strip";
};
