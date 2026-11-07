// @ts-nocheck -- a close port of the Explorer's plain-JS phrase tables, which are loosely typed on purpose (rows of [weight, text, ...extras])
// The words: one play, worded from the player's ratings. Ported from the BBGM League Explorer's play-by-play engine (docs/js/pbp.js).
// A made shot is a (shot, pass) pair that agree: a post move comes off an entry pass, a catch-and-shoot three off a kick-out or a screen, a
// pull-up only unassisted, a transition finish only after a steal or a defensive rebound (and its outlet only from the player who grabbed
// that rebound).
import { pickV, pickW, varyUse, varyW, weighted } from "./variety.ts";
import { R100, TIER, gate } from "./types.ts";

// dunks by type: power and flair need the dunk and leaping ratings; the showier, the rarer ([weight, text, showy])
export function dunkKinds(p: any) {
	const r = p.R,
		n = p.name,
		d = r.dnk,
		j = r.jmp,
		s = r.stre;
	return [
		[TIER.c * gate(d, 50), n + " throws down a two-handed dunk"],
		[TIER.c * gate(d, 50), n + " finishes with a one-handed slam"],
		[TIER.c * gate(d, 55), n + " rises up and flushes it"],
		[TIER.c * gate(d, 55), n + " slams it home"],
		[
			TIER.u * gate(Math.min(d, s), 60),
			n + " powers through contact for a two-handed jam",
		],
		[
			TIER.u * gate(Math.min(d, s), 62),
			n + " bulls his way to the rim and dunks it",
		],
		[TIER.u * gate(Math.min(d, j), 65), n + " rises for a tomahawk dunk", 1],
		[
			TIER.u * gate(Math.min(d, j), 62),
			n + " goes baseline for a reverse dunk",
		],
		[
			TIER.r * gate(Math.min(d, j), 75),
			n + " rocks the rim with a windmill",
			1,
		],
		[
			TIER.r * gate(Math.min(d, j), 72),
			n + " cocks it back and hammers it home",
			1,
		],
		[
			TIER.r * gate(Math.min(d, j), 74),
			n + " takes off a step inside the foul line and throws it down",
			1,
		],
		[TIER.e * gate(Math.min(d, j), 85), n + " spins for a 360 dunk", 1],
		[
			TIER.e * gate(Math.min(d, j, r.drb), 85),
			n + " goes between the legs for the dunk",
			1,
		],
		[
			TIER.e * gate(Math.min(d, j), 82),
			n + " double-clutches in midair and throws it down",
			1,
		],
	];
}
// the dribble move before a shot he made for himself
export function handleSetups(p: any) {
	const r = p.R,
		h = r.drb,
		sp = r.spd;
	return [
		[TIER.c * gate(h, 45), "crosses over"],
		[TIER.c * gate(h, 45), "gets a step with a hesitation dribble"],
		[TIER.c * gate(h, 40), "jab-steps"],
		[TIER.u * gate(h, 60), "goes between the legs and"],
		[
			TIER.u * gate(Math.min(h, sp), 60),
			"beats his man with an in-and-out dribble and",
		],
		[TIER.u * gate(h, 60), "spins off his defender and"],
		[TIER.r * gate(h, 72), "snatches the ball back behind his defender and"],
		[TIER.r * gate(h, 72), "goes behind the back to shake his man and"],
		[TIER.r * gate(Math.min(h, sp), 75), "splits the screen with a burst and"],
		[TIER.e * gate(h, 85), "breaks his defender's ankles with a crossover and"],
		[TIER.e * gate(h, 88), "pulls off a Shammgod and"],
	];
}
/* shot kinds: rim, dunk, post, mid, three; self = created off the dribble (never assisted), catch = needs a pass.
   An option can name the defender he beat (def: on the floor, the and-one's fouler when there is one), say it was
   showy (wow: the crowd and bench react now and then) or call for its own kind of pass (pw: the pick-and-pop). */
export function shotOptions(e: any, putback: any, trans: any, ctx: any) {
	const r = e.p.R,
		n = e.p.name,
		o: any[] = [];
	const add = (w: any, cls: any, self: any, t: any, x?: any) => {
		if (w > 0) {
			o.push(Object.assign({ w, cls, self, t }, x || {}));
		}
	};
	const D = ctx && ctx.def ? ctx.def(e, !e.three) : null,
		dn = D ? D.name : "";
	if (e.three) {
		if (trans) {
			for (const t of [
				" pulls up in transition and hits a three",
				" trails the play and drills a three",
				" spots up on the break and buries a three",
				" stops at the arc on the break and knocks it down",
			]) {
				add(2, "three", 0, n + t);
			}
			return o;
		}
		const sh = r.tp,
			h = r.drb;
		// off the dribble: step-backs, side-steps, pull-ups
		if (h >= 55 && sh >= 60) {
			const w = 0.5 + 0.5 * R100(Math.min(h, sh));
			for (const t of [
				" hits a step-back three",
				" steps back and drains a three",
				" creates space with a step-back and buries it from deep",
				" crosses over and buries a pull-up three",
				" pulls up off the dribble and hits a three",
				" shakes his man and drains a three",
				" side-steps his defender and hits a three",
				" jab-steps, side-steps and knocks down a three",
				" drills a three off a hesitation dribble",
			]) {
				add(w, "three", 1, n + t);
			}
			if (D) {
				add(
					TIER.u * gate(Math.min(h, sh), 68) * 1.5,
					"three",
					1,
					n + " hits a step-back three over " + dn,
					{ def: D },
				);
			}
		}
		if (sh >= 70 && D) {
			add(
				TIER.u * gate(sh, 70),
				"three",
				1,
				n + " drains a three right in " + dn + "'s face",
				{ def: D },
			);
		}
		// deep ones
		for (const t of [
			" pulls up from 30 feet and hits",
			" buries a deep three from the logo",
			" hits from way downtown",
			" pulls up from well beyond the arc and hits",
		]) {
			add(TIER.u * gate(sh, 78) * 1.2, "three", 1, n + t, {
				wow: /logo/.test(t) ? 1 : 0,
			});
		}
		add(
			TIER.e * gate(sh, 82),
			"three",
			1,
			n + " pulls up from 35 feet and drains it",
			{ wow: 1 },
		);
		add(
			TIER.r * gate(sh, 80),
			"three",
			0,
			n + " launches from the logo and it's good",
			{ wow: 1 },
		);
		// off the catch: corner, spot-ups, screens
		for (const t of [
			" drains a corner three",
			" drills the corner three",
			" spots up in the corner and hits",
			" relocates to the corner and hits a three",
			" knocks down the three from the corner",
		]) {
			add(0.9, "three", 2, n + t);
		}
		for (const t of [
			" hits a catch-and-shoot three",
			" catches and fires: good",
			" knocks down a rhythm three off the catch",
			" knocks down a three from the wing",
			" drills a three from the top of the key",
			" knocks down a wide-open three",
			" lets it fly off the catch and drains it",
		]) {
			add(0.9, "three", 2, n + t);
		}
		add(
			TIER.u * gate(sh, 55),
			"three",
			2,
			n + " pump-fakes the closeout, side-steps and drills a three",
		);
		if (sh >= 65) {
			for (const t of [
				" comes off a pin-down screen and drains a three",
				" curls off a flare screen and hits a three",
				" comes off a stagger screen and splashes a three",
				" uses the double screen up top and buries a three",
			]) {
				add(0.8, "three", 2, n + t);
			}
		}
		if (sh >= 72) {
			add(TIER.u * gate(sh, 72), "three", 2, n + " hits a three on the move");
		}
		// a big who can shoot: the pick-and-pop
		if (r.hgt >= 58 && sh >= 50) {
			for (const t of [
				" sets the screen, pops to the arc and drains a three",
				" pops out to the three-point line and knocks it down",
				" flares out after the screen and hits a three",
			]) {
				add(0.8 * R100(sh) * R100(r.hgt) * 2, "three", 2, n + t, { pw: "pop" });
			}
		}
		for (const t of [
			" hits a three-pointer",
			" drains a three",
			" splashes a three",
			" connects from deep",
			" buries a three",
		]) {
			add(1, "three", 0, n + t);
		}
		add(0.15 * TIER.r * gate(sh, 60), "three", 0, n + " banks in a three");
		add(
			TIER.u * gate(sh, 70) * 0.5,
			"three",
			2,
			n + " fades into the corner and buries a three",
		);
		return o;
	}
	if (putback) {
		// his own miss or a teammate's; a tip-in for the long and the bouncy, a putback dunk for the dunkers
		const own = ctx && ctx.lastReb && ctx.lastReb.own;
		for (const t of [
			own ? " puts back his own miss" : " cleans up the miss",
			" scores on the putback",
			" goes right back up for two",
			" cleans it up with a short putback",
		]) {
			add(1, "rim", 1, n + t);
		}
		const tw = gate(Math.max(r.hgt, r.jmp), 55);
		for (const t of [
			" tips it in",
			" taps it back in over the top",
			" gets a fingertip on it and tips it in",
		]) {
			add(0.9 * tw, "tip", 1, n + t);
		}
		const dw = 1.4 * gate(Math.min(r.dnk, r.jmp), 60);
		for (const t of [
			" throws down the putback dunk",
			" slams home the putback",
			own
				? " follows his own miss with a dunk"
				: " flies in for a putback slam",
		]) {
			add(dw, "putdunk", 1, n + t);
		}
		add(
			TIER.r * 3 * gate(Math.min(r.dnk, r.jmp, r.stre), 72),
			"putdunk",
			1,
			n +
				" catches it on the way up and hammers home a putback jam over everyone",
			{ wow: 1 },
		);
		add(
			TIER.e * 3 * gate(Math.min(r.dnk, r.jmp), 82),
			"putdunk",
			1,
			n + " flushes the putback one-handed off the rim",
			{ wow: 1 },
		);
		return o;
	}
	const slam = r.dnk >= 70 && r.jmp >= 55;
	if (
		trans &&
		ctx &&
		ctx.stealer === e.p.pid &&
		!e.ast &&
		(!e.zone || e.zone === "rim")
	) {
		// the stealer takes it the other way himself: a pick-six
		ctx.pick6 = true;
		if (slam) {
			for (const t of [
				" takes it the other way and throws it down",
				" races the other way for an uncontested dunk",
				" has nothing but open floor and slams it home",
				" turns defense into offense with a breakaway slam",
			]) {
				add(1, "dunk", 0, n + t);
			}
		}
		for (const t of [
			" takes it the other way for the layup",
			" races ahead after his steal and finishes",
			" finishes his own steal with a breakaway layup",
			" is gone the other way for an easy two",
		]) {
			add(slam ? 0.5 : 1, "rim", 0, n + t);
		}
		add(
			TIER.r * 3 * gate(Math.min(r.dnk, r.jmp), 74),
			"dunk",
			0,
			n + " takes it the other way all alone and throws down a windmill",
			{ wow: 1 },
		);
		add(
			TIER.u * 2 * gate(Math.min(r.dnk, r.jmp), 66),
			"dunk",
			0,
			n + " is all alone on the breakaway and throws down a two-handed hammer",
			{ wow: 1 },
		);
		return o;
	}
	if (trans) {
		add(0.8, "rim", 0, n + " finishes a 3-on-2 break");
		add(0.6, "rim", 0, n + " leaks out and lays it in");
		if (slam) {
			for (const t of [
				" throws it down on the fast break",
				" finishes the break with a thunderous dunk",
				" outruns everyone and slams it home",
			]) {
				add(1.5, "dunk", 0, n + t);
			}
		}
		if (slam && D) {
			add(
				TIER.r * 4 * gate(Math.min(r.dnk, r.jmp, r.stre), 68),
				"dunk",
				0,
				n + " attacks " + dn + " on the break and dunks all over him",
				{ def: D, wow: 1 },
			);
		}
		for (const t of [
			" finishes the fast break with a layup",
			" beats everyone down the floor for an easy two",
			" lays it in on the break",
		]) {
			add(1, "rim", 0, n + t);
		}
		add(0.5, "rim", 1, n + " goes coast to coast for the layup");
		add(
			TIER.u * gate(Math.min(r.drb, r.spd), 60),
			"rim",
			1,
			n + " Euro-steps past the last defender on the break",
		);
		// a two on the run that isn't at the rim
		for (const t of [
			" pulls up in transition and hits a jumper",
			" stops short on the break and hits the pull-up",
		]) {
			add(0.8, "mid", 0, n + t);
		}
		add(0.6, "post", 0, n + " posts up early in transition and scores");
		return o;
	}
	const dw = slam ? 1.6 * R100(r.dnk) : 0.15 * R100(r.dnk);
	const dk = dunkKinds(e.p),
		dsum = dk.reduce((a, x) => a + x[0], 0) || 1;
	for (const [w, t, wow] of dk) {
		add((dw * w) / dsum, "dunk", 0, t, { wow });
	}
	if (dsum <= 1e-9) {
		add(dw, "dunk", 0, n + " dunks it");
	}
	add(dw / 3, "dunk", 2, n + " flushes it off the catch");
	// a poster: over a named defender, the and-one's fouler when there is one; only the elite leapers
	if (D) {
		const pw = dw * TIER.r * gate(Math.min(r.dnk, r.jmp, r.stre), 62) * 6;
		for (const t of [
			" posterizes " + dn,
			" dunks all over " + dn,
			" rises up and throws it down on " + dn + "'s head",
			" hammers it down in the face of " + dn,
			" climbs over " + dn + " for a one-handed slam",
		]) {
			add(pw, "dunk", 0, n + t, { def: D, wow: 1 });
		}
		add(
			dw * TIER.e * gate(Math.min(r.dnk, r.jmp), 80) * 3,
			"dunk",
			0,
			n + " tomahawks it home right over " + dn,
			{ def: D, wow: 1 },
		);
	} else {
		add(
			dw * TIER.r * gate(Math.min(r.dnk, r.jmp, r.stre), 72),
			"dunk",
			0,
			n + " posterizes the help defender",
			{ wow: 1 },
		);
	}
	if (r.drb >= 60 && r.spd >= 60) {
		const w = 0.12 + 0.12 * R100(Math.min(r.drb, r.spd));
		for (const t of [
			" slices to the rim for a reverse layup",
			" Euro-steps into a layup",
			" beats his man off the dribble and lays it in",
			" splits the double team and finishes at the rim",
			" spins past his defender for a finger roll",
			" goes left and kisses it off the glass",
			" gathers, Euro-steps and lays it in",
			" spins baseline and lays it in",
			" goes under the rim and finishes on the other side",
		]) {
			add(w, "rim", 1, n + t);
		}
		if (D) {
			for (const t of [
				" Euro-steps around " + dn + " for the layup",
				" blows by " + dn + " and lays it in",
				" spins past " + dn + " and finishes",
			]) {
				add(w * 0.8, "rim", 1, n + t, { def: D });
			}
		}
	}
	for (const t of [
		" makes a layup",
		" lays it in",
		" scores at the rim",
		" finishes a short layup",
		" banks it in off the glass",
		" lays it up and in",
		" gets to the rim and finishes",
	]) {
		add(1 / 6, "rim", 0, n + t);
	}
	for (const t of [
		" cuts backdoor for a layup",
		" rolls to the rim and finishes",
		" dives to the rim and lays it in",
		" catches it on the baseline cut and lays it in",
	]) {
		add(0.08, "rim", 2, n + t);
	}
	if (r.drb >= 60) {
		add(0.12, "mid", 1, n + " isolates on the wing and hits a pull-up jumper");
		add(
			0.1,
			"rim",
			1,
			n + " clears out for an isolation and drives for the layup",
		);
	}
	// an and-one at the rim: the finish through the hit
	if (e.andOne) {
		for (const t of [
			" muscles it up through the hit and in",
			" finishes off-balance while getting hit",
			" absorbs the bump and lays it in",
			" takes the hit and still gets it to drop",
		]) {
			add(0.35, "rim", 0, n + t);
		}
		const aw = gate(Math.min(r.drb, Math.max(r.jmp, r.spd)), 58) * 0.4;
		for (const t of [
			" hangs in the air, absorbs the contact and scoops it in",
			" twists through the contact and banks it in",
			" double-pumps through the foul and lays it in",
		]) {
			add(aw, "rim", 1, n + t, { wow: 1 });
		}
		add(0.3, "mid", 0, n + " hits the jumper through the contact");
	}
	const pw = r.ins >= 60 ? 0.9 * R100(r.ins) : 0.1;
	if (r.ins >= 55) {
		add(pw / 6, "post", 0, n + " posts up, spins baseline and lays it in");
		add(pw / 6, "post", 0, n + " drop-steps for a short hook");
	}
	if (r.hgt >= 65) {
		for (const t of [
			" backs down his man and drops in a hook",
			" scores on a turnaround in the post",
			" hits a jump hook over the top",
			" drop-steps baseline and lays it in",
			" up-fakes in the post and lays it in",
			" hits a sweeping hook across the lane",
			" drops in a left-handed hook",
		]) {
			add(pw / 6, "post", 0, n + t);
		}
		if (D) {
			for (const t of [
				" backs down " + dn + " and drops in a hook",
				" shoulders into " + dn + " and scores over him",
			]) {
				add(pw / 8, "post", 0, n + t, { def: D });
			}
		}
	} else {
		for (const t of [
			" works the post and scores",
			" hits a short turnaround",
			" scores on a little shoulder fake",
		]) {
			add(pw / 3, "post", 0, n + t);
		}
	}
	add(pw / 4, "post", 2, n + " seals his man and scores on the catch");
	const jw = r.fg >= 55 ? R100(r.fg) : 0.2;
	if (r.fg >= 75) {
		for (const t of [
			" drains a fadeaway jumper",
			" rises over the defense for a pull-up jumper",
			" hits a turnaround fadeaway from the baseline",
			" knocks down a step-back mid-range jumper",
			" nails a mid-range jumper off the dribble",
			" stops on a dime and hits the pull-up",
			" pulls up from the elbow and hits",
		]) {
			add(jw / 6, "mid", 1, n + t);
		}
	}
	if (r.fg >= 65 && D) {
		add(jw / 8, "mid", 1, n + " hits a turnaround jumper over " + dn, {
			def: D,
		});
	}
	if (r.fg >= 70) {
		add(
			jw / 10,
			"mid",
			1,
			n + " turns over his left shoulder and buries the fadeaway",
		);
	}
	for (const t of [
		" hits a jump shot",
		" makes a mid-range jumper",
		" knocks down a short jumper",
		" hits a baseline jumper",
		" drains an open 15-footer",
	]) {
		add(jw / 5, "mid", 0, n + t);
	}
	for (const t of [
		" pops out of the screen and hits from the elbow",
		" catches and knocks down the mid-range jumper",
		" hits an open 17-footer off the catch",
	]) {
		add(jw / 8, "mid", 2, n + t);
	}
	if (r.hgt >= 58) {
		add(
			jw / 6,
			"mid",
			2,
			n + " pops out after the screen and hits from 18 feet",
			{ pw: "pop" },
		);
	}
	if (r.drb >= 55 && r.ins >= 45) {
		for (const t of [
			" floats one in over the big man",
			" hits a runner in the lane",
			" lofts a teardrop over the defense",
			" floats in a runner off one foot",
		]) {
			add(0.13, "rim", 1, n + t);
		}
		if (D) {
			add(0.06, "rim", 1, n + " drops a floater in over " + dn, { def: D });
		}
		add(0.08, "mid", 1, n + " hits a floater from 10 feet");
	}
	if (r.hgt >= 65 && !e.ast && !e.andOne) {
		add(0.04, "rim", 0, n + " is credited with the basket on goaltending");
	}
	// rarer finishes, by rating
	const T2 = (w, cls, self, txt, x) => {
		if (w > 0) {
			add(w, cls, self, n + txt, x);
		}
	};
	T2(TIER.u * gate(r.drb, 55) * 0.3, "rim", 1, " scoops it in underhanded");
	T2(
		TIER.u * gate(Math.min(r.drb, r.spd), 60) * 0.3,
		"rim",
		1,
		" goes up-and-under for the reverse layup",
	);
	T2(
		TIER.u * gate(r.ins, 55) * 0.12,
		"rim",
		0,
		" finishes with a soft finger roll",
	);
	T2(TIER.u * gate(r.spd, 55) * 0.12, "rim", 1, " glides in for a finger roll");
	T2(
		TIER.r * gate(Math.min(r.drb, r.jmp), 70) * 0.3,
		"rim",
		1,
		" hangs in the air and switches hands for the layup",
		{ wow: 1 },
	);
	T2(
		TIER.r * gate(r.ins, 72) * 0.3,
		"post",
		0,
		" pump-fakes, steps through and lays it in",
	);
	T2(
		TIER.e * gate(Math.min(r.ins, r.drb), 80) * 0.3,
		"post",
		0,
		" breaks out a dream shake and lays it in",
		{ wow: 1 },
	);
	T2(
		TIER.e * gate(Math.min(r.ins, r.hgt), 80) * 0.3,
		"post",
		0,
		" drops in a sky hook",
	);
	T2(TIER.u * gate(r.fg, 60) * 0.3, "mid", 1, " nails a pull-up off the curl");
	T2(
		TIER.r * gate(r.fg, 72) * 0.3,
		"mid",
		1,
		" knocks down a one-legged fadeaway",
		{ wow: 1 },
	);
	T2(
		TIER.r * gate(r.fg, 70) * 0.3,
		"mid",
		0,
		" banks in a jumper from the wing",
	);
	T2(TIER.r * gate(r.fg, 60) * 0.3, "mid", 0, " uses the glass from 12 feet");
	T2(TIER.r * gate(r.fg, 60) * 0.3, "mid", 0, " banks it in from the elbow");
	return o;
}
export function passWord(rng: any, passer: any, cls: any, ctx: any, how: any) {
	const n = passer.name,
		pss = passer.R.pss;
	if (ctx.trans) {
		if (ctx.defReb === passer.pid && pss >= 65 && rng.random() < 0.15) {
			return pickV(rng, [
				"on a full-court baseball pass from " + n,
				"on a long outlet from " + n + " that hits him in stride",
			]);
		}
		return ctx.defReb === passer.pid
			? pickV(rng, [
					"on the outlet from " + n,
					"off a quick outlet from " + n,
					"on a long outlet from " + n,
				])
			: pickV(rng, [
					"off a hit-ahead pass from " + n,
					"on a long pass up the floor from " + n,
					"off a push pass from " + n,
					"with " + n + " finding him in stride",
				]);
	}
	if (how === "pop") {
		return pickV(rng, [
			"on the pick-and-pop with " + n,
			"with " + n + " finding him on the pop",
			"off the pick-and-pop, " + n + " with the feed",
		]);
	}
	const o = [];
	if (cls === "three") {
		o.push(
			"on a kick-out from " + n,
			"off a skip pass from " + n,
			"on a cross-court skip pass from " + n,
			"off a swing pass from " + n,
			"off an extra pass from " + n,
			"on a drive-and-kick from " + n,
			"off a hand-off from " + n,
			"after " + n + " drives and kicks it out",
			"on a kick-out after " + n + " collapses the defense",
		);
	}
	if (cls === "mid") {
		o.push(
			"off a hand-off from " + n,
			"on a kick-out from " + n,
			"off a swing pass from " + n,
			"out of a Horns set, from " + n,
			"off a dribble hand-off from " + n,
			"on a feed from " + n,
		);
	}
	if (cls === "post") {
		o.push(
			"off an entry pass from " + n,
			"on a feed into the post from " + n,
			"on a lob into the post from " + n,
		);
	}
	if (cls === "post" && passer.R.hgt >= 65) {
		o.push("on a high-low feed from " + n);
	}
	if (cls === "rim" || cls === "dunk") {
		o.push(
			"on a bounce pass from " + n,
			"on a drive-and-dish from " + n,
			"on a backdoor pass from " + n,
			"on a pocket pass from " + n + " out of the pick-and-roll",
			"on a dump-off from " + n,
			"with " + n + " finding him on the cut",
		);
		if (pss >= 60) {
			o.push(
				"off a Spain pick-and-roll, the pocket pass from " + n,
				"out of a Horns set, a pocket pass from " + n,
			);
		}
		if (passer.R.hgt >= 65) {
			o.push("on a high-low feed from " + n);
		}
	}
	if (pss >= 75 && cls !== "post") {
		o.push(
			"on a no-look pass from " + n,
			"off a behind-the-back feed from " + n,
			"on a pass threaded through traffic by " + n,
			"on a touch pass from " + n,
		);
	}
	// rarer passes, by passing rating
	const rare = [
		[TIER.u * gate(pss, 60), "off a one-touch pass from " + n],
		[
			TIER.u * gate(pss, 60),
			"on a bounce pass between two defenders from " + n,
		],
		[TIER.u * gate(pss, 65), "on a no-look feed from " + n],
		[TIER.r * gate(pss, 72), "off a wraparound pass from " + n],
		[TIER.r * gate(pss, 72), "on a pass over the top of the zone from " + n],
		[TIER.r * gate(pss, 74), "on a behind-the-back bounce pass from " + n],
		[TIER.e * gate(pss, 85), "off a behind-the-head pass from " + n],
		[TIER.e * gate(pss, 82), "on a no-look bounce pass from " + n],
	].filter((x) => x[0] > 0);
	if (rare.length && rng.random() < 0.18) {
		return pickW(rng, rare)[1];
	}
	return pickV(rng, o.length ? o : ["with the assist from " + n]);
}
/* An alley-oop: a lob from the passer, finished above the rim by a leaper (a dunk when he can, else a layup off
   the glass). It needs the assist and a finisher with the bounce for it, and a passer who can put it there. */
export function alleyOop(rng: any, e: any, ctx: any, trans: any) {
	if (
		!e.ast ||
		e.three ||
		e.andOne ||
		e.putback ||
		(e.zone && e.zone !== "rim")
	) {
		return null;
	}
	const r = e.p.R,
		a = e.ast,
		n = e.p.name,
		an = a.name;
	const w =
		gate(r.jmp, 58) *
		gate(Math.max(r.dnk, r.spd), 52) *
		(0.6 + R100(a.R.pss) * 0.8);
	if (!w || rng.random() > (trans ? 0.25 : 0.12) * w) {
		return null;
	}
	const dunk = r.dnk >= 58 && r.jmp >= 60;
	const o = [];
	const add = (wt, t) => {
		if (wt > 0) {
			o.push([wt, t]);
		}
	};
	if (trans) {
		add(
			1,
			an + " throws it ahead and " + n + " finishes the alley-oop on the break",
		);
		add(
			dunk ? 1 : 0,
			an + " lobs it up on the break and " + n + " slams it home",
		);
		add(
			dunk ? 1 : 0,
			n +
				" runs the floor and " +
				an +
				" throws the lob ahead for the alley-oop slam",
		);
		add(
			dunk ? 0 : 1,
			an + " lofts it ahead on the break and " + n + " lays in the lob",
		);
	} else if (dunk) {
		add(1, an + " lobs it up and " + n + " throws down the alley-oop");
		add(1, n + " rises to catch " + an + "'s lob and slams it home");
		add(1, an + " throws it up and " + n + " hammers home the alley-oop");
		add(1, n + " skies for the alley-oop from " + an);
		add(0.8, n + " cuts backdoor and flushes the lob from " + an);
		add(
			TIER.r * gate(Math.min(r.jmp, r.dnk), 76) * 3,
			n + " catches " + an + "'s lob with one hand and flushes it",
		);
		add(
			TIER.r * gate(Math.min(r.jmp, r.dnk), 78) * 3,
			n + " turns " + an + "'s lob into a reverse alley-oop jam",
		);
		add(
			TIER.e * gate(Math.min(a.R.pss, r.jmp), 78) * 4,
			an + " bounces it off the backboard and " + n + " slams it home",
		);
	} else {
		add(1, an + " floats a lob to the rim and " + n + " lays it in");
		add(1, n + " catches the lob from " + an + " and kisses it off the glass");
		add(1, n + " finishes an alley-oop layup from " + an);
	}
	ctx.ptype = trans ? "fastbreak-oop" : "alleyoop";
	ctx.wow = dunk;
	return pickW(rng, o)[1];
}
export function madeShot(rng: any, e: any, ctx: any) {
	const putback =
		!e.ast &&
		!e.three &&
		(e.putback ||
			(ctx.lastReb && ctx.lastReb.pid === e.p.pid && rng.random() < 0.7));
	const trans = !!ctx.trans && !putback;
	const oop = alleyOop(rng, e, ctx, trans);
	if (oop) {
		return oop;
	}
	// a fast break finished in numbers: a 2-on-1 with the dish, or the rebounder pushing it all the way himself
	if (trans && !e.three && (!e.zone || e.zone === "rim")) {
		const r = e.p.R,
			n = e.p.name,
			slam = r.dnk >= 65 && r.jmp >= 55;
		if (e.ast && rng.random() < 0.4) {
			ctx.ptype = "2on1";
			const an = e.ast.name;
			return pickV(rng, [
				an +
					" and " +
					n +
					" break out 2-on-1; " +
					an +
					" draws the last defender and dishes to " +
					n +
					" for the " +
					(slam ? "slam" : "layup"),
				n +
					" finishes a 2-on-1 with " +
					an +
					", taking the bounce pass for an easy " +
					(slam ? "dunk" : "layup"),
				an +
					" pushes it on a 2-on-1, waits for the defender to commit and feeds " +
					n +
					(slam ? " for the dunk" : " for the layup"),
				n +
					" runs the floor on a 2-on-1 and " +
					an +
					" hits him in stride for " +
					(slam ? "a dunk" : "a layup"),
				an +
					" looks off the last defender on a 2-on-1 and lays it off to " +
					n +
					" for " +
					(slam ? "the slam" : "the layup"),
			]);
		}
		if (
			!e.ast &&
			(ctx.defReb === e.p.pid || ctx.stealer === e.p.pid) &&
			r.spd >= 50 &&
			rng.random() < 0.55
		) {
			ctx.ptype = "coast";
			return pickV(
				rng,
				ctx.defReb === e.p.pid
					? [
							n +
								" pushes it himself after the board and goes coast to coast for the " +
								(slam ? "slam" : "layup"),
							n + " grabs it and goes the length of the floor for the layup",
							n +
								" takes the rebound end to end and finishes" +
								(r.drb >= 65 ? " with a Euro step" : " at the rim"),
						]
					: [
							n +
								" goes coast to coast after the steal for the " +
								(slam ? "dunk" : "layup"),
							n +
								" outruns everyone after his steal and " +
								(slam ? "throws it down" : "lays it in"),
						],
			);
		}
		if (e.ast && rng.random() < 0.2 && r.spd >= 55) {
			ctx.ptype = "fastbreak";
			return pickV(rng, [
				n +
					" beats everyone down the floor and " +
					e.ast.name +
					" finds him for " +
					(slam ? "a dunk" : "a layup"),
				n +
					" fills the lane on the break and finishes the feed from " +
					e.ast.name,
			]);
		}
	}
	// an assisted shot is never a self-created one; an unassisted one never needed a pass
	let opts = shotOptions(e, putback, trans, ctx).filter((x) =>
		e.ast ? x.self !== 1 : x.self !== 2,
	);
	// the box score's shot location decides the kind of two: at the rim, in the post, from mid-range
	const ZONE = { rim: ["rim", "dunk"], post: ["post"], mid: ["mid"] };
	if (e.zone && !putback) {
		const z = opts.filter((x) => ZONE[e.zone].includes(x.cls));
		if (z.length) {
			opts = z;
		}
	}
	const s = opts.length
		? weighted(rng, opts, (x) => x.w * varyW(x.t))
		: {
				t: e.p.name + (e.three ? " hits a three" : " scores"),
				cls: e.three ? "three" : "rim",
			};
	varyUse(s.t);
	if (s.def) {
		ctx.defUsed = s.def;
	}
	if (s.wow) {
		ctx.wow = true;
	}
	if (putback) {
		ctx.ptype =
			s.cls === "putdunk"
				? "putbackdunk"
				: s.cls === "tip"
					? "tipin"
					: "putback";
	} else if (trans && ctx.pick6 && ctx.stealer === e.p.pid) {
		ctx.ptype = "pick6";
	} else if (trans) {
		ctx.ptype = "fastbreak";
	}
	if (s.def && s.cls === "dunk" && !trans) {
		ctx.ptype = "poster";
	}
	let t = s.t;
	let flourished = false;
	// now and then, how it went in: beating the shot clock (after a long possession), through a crowd, off balance
	if (!putback && !trans && !s.def && rng.random() < 0.05) {
		const f = [];
		if (ctx.gap >= 20) {
			f.push([1, " with the shot clock winding down"]);
		}
		if (
			s.cls !== "dunk" &&
			!/open|uncontested|easy|through|contact|hit|bump|foul/.test(t)
		) {
			f.push(
				[0.6, " over two defenders"],
				[0.4, " while falling away"],
				[0.3, " with a hand in his face"],
			);
			const D = ctx.def ? ctx.def(e, false) : null;
			if (D && !e.andOne) {
				f.push(
					[0.5, " over the outstretched arm of " + D.name, D],
					[0.3, " with " + D.name + " draped all over him", D],
				);
			}
		}
		if (s.cls === "three" || s.cls === "mid") {
			f.push(
				[0.2, " and gets the friendly roll"],
				[0.15, ", the ball bouncing twice on the rim before it drops"],
			);
		}
		const x = f.length ? pickW(rng, f) : null;
		if (x) {
			t += x[1];
			flourished = true;
			if (x[2]) {
				ctx.defUsed = x[2];
			}
		}
	}
	// a dribble move before a shot he created (no move on putbacks, transition or assisted shots)
	if (s.self === 1 && !trans && !putback && rng.random() < 0.45) {
		const hs = handleSetups(e.p).filter((x) => x[0] > 0);
		if (hs.length) {
			const mv = weighted(rng, hs, (x) => x[0])[1];
			const rest = t
				.slice(e.p.name.length)
				.replace(
					/^ (hits|makes|drains|drills|knocks down|buries|nails|rises over the defense for) /,
					" hits ",
				);
			// (no second dribble move when the shot already has one)
			if (
				!/^ (crosses|shakes|side-steps|jab-steps|goes left|spins|beats|blows|splits|Euro|gathers|slices|isolates|clears out|stops|steps back|creates|pulls up off|turns over)/.test(
					t.slice(e.p.name.length),
				) &&
				!/hesitation|step-back|crossover|crosses over|side-step|shakes|spin|in-and-out|behind the back|Euro/.test(
					rest,
				)
			) {
				t = e.p.name + " " + mv + (mv.endsWith(" and") ? "" : ", then") + rest;
			}
		}
	}
	ctx.shotEnd = t.length;
	if (e.ast) {
		const pass = passWord(
			rng,
			e.ast,
			s.cls,
			Object.assign({}, ctx, { trans }),
			s.pw,
		);
		// (a pass phrase starting with the preposition the shot already used, or tacked on after a flourish, follows a comma)
		const prep = /^(on|off|with|out) /.exec(pass);
		const clash =
			flourished ||
			(prep &&
				new RegExp(
					String.raw`\b` + prep[1] + String.raw` (a|an|the|his|her)\b`,
				).test(t.slice(e.p.name.length)));
		t += (clash ? ", " : " ") + pass;
		// the pass before the assist (no stat of its own): the hockey assist
		const z = !trans && ctx.third ? ctx.third(e) : null;
		if (z && !e.andOne && rng.random() < 0.12) {
			t += pickV(rng, [
				", the ball swung over by " + z.name,
				", " + z.name + " making the extra pass to get it there",
				", with the hockey assist to " + z.name,
				", after " + z.name + " got the ball moving",
			]);
			ctx.thirdUsed = z;
		}
	}
	return t;
}
export function missText(rng: any, e: any, ctx: any) {
	const r = e.p.R,
		n = e.p.name;
	const tip = ctx.lastReb && ctx.lastReb.pid === e.p.pid && !e.three;
	const trans = !!ctx.trans && !tip;
	const z = e.zone;
	// a blocked shot never "rims out": it never reached the rim; the attempt matches the shot's zone
	if (e.blk) {
		if (e.three) {
			return pickV(rng, [
				n + " rises for a three",
				n + " tries a three from the wing",
				n + " lets a three fly from the corner",
				n + " pulls up for a three",
				n + " fires from the top of the key",
			]);
		}
		const rim = [
			n + " drives for a layup",
			n + " goes up in the paint",
			n + " tries a reverse layup",
			n + " attacks the rim",
			n + " goes up strong at the rim",
			r.dnk >= 60 ? n + " elevates for a dunk" : n + " tries a floater",
		];
		if (trans) {
			return pickV(rng, [
				n + " races in for a layup on the break",
				n + " has a step on everyone on the break and goes up",
				n + " pushes it ahead and goes up for the layup",
			]);
		}
		const post = [
			n + " goes up for a hook",
			n + " tries a turnaround in the post",
			n + " goes up with a short jumper in the post",
		];
		const mid = [
			n + " pulls up from 12 feet",
			n + " rises for a jumper",
			n + " tries a fadeaway",
			n + " pulls up from the elbow",
		];
		return pickV(
			rng,
			z === "rim"
				? rim
				: z === "post"
					? post
					: z === "mid"
						? mid
						: rim.concat(r.ins >= 60 ? post : mid),
		);
	}
	if (tip && rng.random() < 0.6) {
		return pickV(rng, [
			n + " misses the putback",
			n + " can't get the tip to fall",
			n + "'s second-chance layup rolls off",
		]);
	}
	const w = (x, t) => [x, t];
	if (e.three) {
		if (trans) {
			return pickV(rng, [
				n + " pulls up for a transition three and misses",
				n + " misses a three on the break",
				n + "'s three in transition is off",
			]);
		}
		return pickW(rng, [
			w(1, n + "'s three is halfway down and out"),
			w(1, n + "'s three from the top of the key rattles out"),
			w(1, n + "'s deep three is short"),
			w(1, n + " misses a three-pointer"),
			w(1, n + " misses from deep"),
			w(1, n + "'s three rims out"),
			w(
				1,
				r.tp >= 70
					? n + " misses a contested three"
					: n + " misses a three from the corner",
			),
			w(1, n + "'s three from the wing is off the mark"),
			w(1, n + " comes up short on a three"),
			w(1, n + "'s three hits back iron"),
			w(r.drb >= 55 ? 1 : 0.3, n + " misses a step-back three"),
			w(0.8, n + "'s three spins in and out"),
			w(0.8, n + "'s corner three rims out"),
			w(0.8, n + "'s three is just off"),
			w(0.6, n + "'s pull-up three hits the side of the rim"),
			w(0.6, n + "'s deep three clanks off the back iron"),
			w(r.tp >= 78 ? 0.4 : 0, n + " misses a 30-footer"),
			w(0.6, n + " misses a wide-open three"),
			w(TIER.r * (r.tp < 45 ? 1.5 : 0.35), n + " airballs a three"),
		])[1];
	}
	if (trans && (!z || z === "rim")) {
		return pickV(rng, [
			n + " blows the layup on the break",
			n + "'s fast-break layup rolls off",
			n + " misses the layup in transition",
			n + " can't finish on the break",
		]);
	}
	const rim = [
		w(1, n + " misses a layup"),
		w(1, n + "'s layup is off the glass and out"),
		w(1, n + " can't finish at the rim"),
		w(1, n + "'s floater rolls off"),
		w(
			1,
			r.dnk >= 75
				? n + " rattles a dunk off the back of the rim"
				: n + " misses in traffic at the rim",
		),
		w(1, n + "'s layup comes off the side of the backboard"),
		w(0.8, n + " can't get the layup to drop"),
		w(0.8, n + "'s layup rolls around the rim and out"),
		w(0.5, n + "'s finger roll spins out"),
		w(0.5, n + "'s reverse layup is too strong"),
		w(0.7, n + " misses a contested layup"),
		w(0.6, n + "'s runner is off the mark"),
	];
	const post = [
		w(1, n + " misses a hook shot"),
		w(1, n + "'s turnaround in the post is short"),
		w(1, n + " can't get a clean look against the fronting defense"),
		w(1, n + "'s jump hook rims out"),
		w(0.8, n + "'s hook rolls off the rim"),
		w(0.6, n + "'s fadeaway in the post is short"),
		w(0.6, n + " misses a turnaround over the double team"),
	];
	const mid = [
		w(1, n + "'s jumper hits the front rim"),
		w(1, n + "'s mid-range jumper is long"),
		w(1, n + " misses a pull-up from the elbow"),
		w(1, n + "'s fadeaway falls short"),
		w(1, n + " misses a baseline jumper"),
		w(0.8, n + "'s jumper rims out"),
		w(0.6, n + "'s pull-up jumper goes in and out"),
		w(0.7, n + "'s jumper from the elbow is long"),
		w(0.4, n + "'s bank shot is too hard"),
		w(0.6, n + "'s fadeaway hits the side of the rim"),
		w(TIER.r * 0.4, n + " airballs a fadeaway"),
	];
	if (z === "rim") {
		return pickW(rng, rim)[1];
	}
	if (z === "post") {
		return pickW(rng, post)[1];
	}
	if (z === "mid") {
		return pickW(rng, mid)[1];
	}
	const opts = [
		w(1, n + "'s jumper rolls around the rim and out"),
		w(1, n + "'s floater is a touch too strong"),
		w(1, n + " misses everything on a contested jumper"),
		w(1, n + "'s jumper hits the front rim"),
		w(1, n + "'s shot is long off the back iron"),
		w(1, n + "'s layup comes off the side of the backboard"),
		w(1, n + " misses a layup"),
		w(1, n + " misses a jump shot"),
		w(1, n + "'s floater rolls off"),
		w(1, n + " misses in the paint"),
		w(1, n + "'s pull-up jumper rims out"),
		w(1, n + " misses a short jumper"),
		w(1, n + "'s layup is off the glass and out"),
		w(1, n + " can't finish at the rim"),
		w(0.6, n + "'s jumper goes in and out"),
	];
	if (r.ins >= 60) {
		opts.push(
			w(1, n + " misses a hook shot"),
			w(1, n + "'s turnaround in the post is short"),
			w(1, n + " can't get a clean look against the fronting defense"),
		);
	}
	if (ctx.zone) {
		opts.push(w(1, n + " can't find a gap in the zone and misses a jumper"));
	}
	if (r.fg >= 60) {
		opts.push(
			w(1, n + " misses a fadeaway"),
			w(1, n + "'s mid-range jumper is long"),
		);
	}
	if (r.dnk >= 75) {
		opts.push(
			w(1, n + " misses a dunk attempt"),
			w(1, n + " rattles a dunk off the back of the rim"),
		);
	}
	return pickW(rng, opts)[1];
}
// the block itself: help-side or on the ball, a chase-down on the break (never "into the stands": that ball is rebounded)
export function blockText(rng: any, b: any, three: any, trans: any, ctx: any) {
	const r = b.R,
		bn = b.name;
	if (three) {
		return pickV(rng, [
			"blocked by " + bn,
			bn + " gets a piece of it",
			bn + " closes out and blocks it",
			bn + " flies out and gets a hand on the release",
		]);
	}
	if (trans && r.spd >= 55) {
		ctx.wow = true;
		ctx.ptype = "chasedown";
		return pickV(rng, [
			bn + " chases him down from behind and pins it on the glass",
			bn + " races back for the chase-down block",
			bn + " comes from nowhere for the chase-down block",
			bn + " runs him down and swats it from behind",
		]);
	}
	const big = r.hgt >= 70 || r.jmp >= 75;
	const o = [
		[1, "blocked by " + bn],
		[1, bn + " gets a hand on it"],
		[1, bn + " stuffs the shot"],
		[1, bn + " gets all ball"],
		[1, bn + " contests and gets a fingertip on it"],
		[0.8, bn + " sends it back"],
	];
	if (r.hgt >= 75 && r.jmp >= 70) {
		o.push(
			[1, bn + " erases it at the rim"],
			[0.7, bn + " swats it off the backboard"],
		);
	}
	if (big) {
		o.push(
			[1, bn + " swats it away"],
			[1, "rejected at the rim by " + bn],
			[1, bn + " pins it against the glass"],
			[1, bn + " meets him at the rim"],
		);
	}
	if (big || r.diq >= 60) {
		o.push(
			[0.8, bn + " slides over from the weak side and swats it"],
			[0.7, bn + " rotates over for the help-side block"],
			[0.6, bn + " comes across the lane and rejects it"],
		);
	}
	const x = pickW(rng, o)[1];
	if (
		/erases|swats it off|rejected at the rim|from the weak side|from behind/.test(
			x,
		) &&
		rng.random() < 0.5
	) {
		ctx.wow = true;
	}
	return x;
}
/* A turnover: by kind, as often as each happens (bad passes and lost balls most; travels, offensive fouls, the
   violations less), each kind only where it fits: an offensive foul only when he has a foul left in his box line,
   a backcourt or 8-second call only bringing the ball up, a shot-clock violation only after a long possession. */
export function tovText(rng: any, e: any, ctx: any) {
	const n = e.p.name,
		r = e.p.R;
	const to = ctx.mate(e);
	const rows: any[] = [];
	const add = (wt: any, t: any, x?: any) => {
		if (wt > 0) {
			rows.push([wt, t, x || {}]);
		}
	};
	if (e.stl && ctx.oob) {
		// the ball goes out of bounds off the player it was knocked from (a dead ball)
		const s = e.stl.name;
		for (const t of [
			s + " strips " + n + " and the ball goes out of bounds off " + n,
			s + " knocks the ball off " + n + " and out of bounds",
			s + " pokes it away from " + n + ", and it trickles out of bounds",
			s + " gets a hand on " + n + "'s dribble and it goes out off " + n,
			s + " deflects " + n + "'s pass out of bounds",
		]) {
			add(1, t);
		}
		if (to) {
			add(0.6, s + " tips " + n + "'s pass for " + to.name + " out of bounds", {
				mate: to,
			});
		}
		const x = pickW(rng, rows)!;
		if (x[2].mate) {
			ctx.mateUsed = x[2].mate;
		}
		return x[1];
	}
	if (e.stl) {
		// a steal: the defender takes the ball from the offense (his team gets the line, the offense's player is named)
		const s = e.stl.name,
			sr = e.stl.R;
		for (const t of [
			s + " picks " + n + "'s pocket",
			"steal by " + s + " on " + n,
			s + " strips " + n,
			s + " pokes it away from " + n + " on the drive",
			s + " reads the play and steals it from " + n,
			s + " deflects " + n + "'s dribble and comes up with it",
			s + " anticipates the dribble and swipes it from " + n,
			s + " digs down on " + n + "'s drive and pokes it loose",
		]) {
			add(1, t);
		}
		for (const t of [
			s + " swipes it from " + n + " in the post",
			s + " swipes down on " + n + " in the post and strips him",
		]) {
			add(r.ins >= 50 || r.hgt >= 60 ? 0.8 : 0.2, t);
		}
		for (const t of [
			s + " dives on the floor for the loose ball and wins it from " + n,
			s + " sneaks in from the weak side and pokes it free from " + n,
			s + " traps " + n + " in the corner and takes it",
		]) {
			add(0.8, t);
		}
		if (to) {
			for (const t of [
				s +
					" jumps the passing lane and picks off " +
					n +
					"'s pass meant for " +
					to.name,
				s +
					" steps in front of " +
					to.name +
					" and intercepts " +
					n +
					"'s pass",
				s + " tips " + n + "'s pass for " + to.name + " and runs it down",
				s +
					" gets a hand on " +
					n +
					"'s pass to " +
					to.name +
					", and the deflection goes his way",
			]) {
				add(1.2 * (0.6 + R100(sr.diq)), t, { mate: to });
			}
		}
		// a teammate's deflection, a stolen inbound, a trap in the press
		const dm = ctx.dmate ? ctx.dmate(e) : null;
		if (dm) {
			for (const t of [
				dm.name + " deflects " + n + "'s pass and " + s + " runs it down",
				dm.name +
					" gets a hand on the ball, and " +
					s +
					" comes up with the loose ball",
			]) {
				add(0.6, t, { dmate: dm });
			}
		}
		if (ctx.inbound && !ctx.trans) {
			const iw = ctx.press ? 2 : 0.5;
			for (const t of [
				s + " picks off the inbound pass from " + n,
				s + " jumps the inbounds pass from " + n,
				s + " steals the inbound pass from " + n,
			]) {
				add(iw, t);
			}
			if (dm && ctx.press) {
				add(
					iw,
					s +
						" and " +
						dm.name +
						" trap " +
						n +
						" near half court, and " +
						s +
						" comes away with it",
					{ dmate: dm },
				);
			}
		}
		const x = pickW(rng, rows)!;
		if (x[2].mate) {
			ctx.mateUsed = x[2].mate;
		}
		if (x[2].dmate) {
			ctx.dmateUsed = x[2].dmate;
		}
		return x[1];
	}
	const D = ctx.drawer;
	// bad passes (to a named teammate)
	if (to) {
		const t2 = to.name;
		for (const t of [
			n + "'s pass for " + t2 + " sails out of bounds",
			"bad pass by " + n + ": " + t2 + " was cutting the other way",
			n + " throws it behind " + t2 + " and out of bounds",
			n + " and " + t2 + " get crossed up on a hand-off",
			n + "'s lob for " + t2 + " is too high and goes out",
			n + " tries to thread a pass to " + t2 + " and it skips out of bounds",
			"the cross-court pass from " +
				n +
				" for " +
				t2 +
				" is off target and out",
		]) {
			add(0.6, t, { mate: to });
		}
		if (to.R.hgt >= 62) {
			add(
				0.5,
				n +
					" tries to feed " +
					t2 +
					" in the post, and the entry pass goes out of bounds",
				{ mate: to },
			);
		}
		if (ctx.defReb === e.p.pid) {
			add(
				1.5,
				"the outlet from " + n + " sails over " + t2 + "'s head and out",
				{ mate: to },
			);
		}
	}
	// lost balls out of bounds
	for (const t of [
		n + " fumbles the pass out of bounds",
		n + " gets stripped in traffic and it goes out off him",
		n + " loses the ball out of bounds",
		n + " loses the ball out of bounds in traffic",
		n + " steps out of bounds along the baseline",
		n + " steps on the sideline driving baseline",
		n + " loses his footing and steps out of bounds",
	]) {
		add(0.5, t);
	}
	for (const t of [
		n + " loses the handle",
		n + " dribbles it off his foot and out of bounds",
		n + " loses the handle and it rolls out of bounds",
	]) {
		add(r.drb < 55 ? 0.7 : 0.25, t);
	}
	// travels and dribbling violations
	for (const t of [
		n + " is called for traveling",
		n + " travels on a spin move",
		n + " shuffles his pivot foot and is called for a travel",
		n + " takes an extra step on the drive: traveling",
	]) {
		add(0.35, t);
	}
	if (r.hgt >= 65) {
		add(0.4, n + " travels in the post");
	}
	if (r.drb >= 60) {
		add(0.3, n + " gets called for a travel on the Euro step");
	}
	add(r.drb < 50 ? 0.5 : 0.2, n + " is called for a double dribble");
	for (const t of [
		n + " is called for a carry",
		n + " is called for palming the ball on a crossover",
	]) {
		add(r.drb >= 60 ? 0.35 : 0.2, t);
	}
	// offensive fouls (a personal foul too: only when he has one to spare in his box line)
	if (ctx.offFoul) {
		const fw = ctx.offFoulW || 1;
		const tag = { foul: 1 };
		if (D) {
			for (const t of [
				n + " is called for a charge; " + D.name + " takes it",
				D.name + " plants his feet and takes the charge from " + n,
				D.name + " draws the charge on " + n,
				n + " barrels into " + D.name + ": offensive foul",
				n + " shoves off " + D.name + " to create space: offensive foul",
			]) {
				add(0.45 * fw, t, { foul: 1, drawer: D, charge: !/shoves/.test(t) });
			}
		}
		for (const t of [
			n + " is called for a charge driving into the lane",
			n + " is called for a push-off",
			n + " commits an offensive foul",
			n + " is whistled for an illegal screen",
			n + " is called for a moving screen",
			n + " hooks his defender on the drive: offensive foul",
		]) {
			add(0.3 * fw, t, tag);
		}
		if (ctx.trans) {
			add(fw, n + " is called for a charge in transition", tag);
		}
		if (r.hgt >= 70) {
			add(
				0.4 * fw,
				n + " is whistled for an over-the-back offensive foul",
				tag,
			);
		}
	}
	// three seconds, mostly bigs
	add(
		r.hgt >= 65 ? 0.4 : 0.12,
		n +
			(rng.random() < 0.5
				? " is called for three seconds"
				: " is called for a three-second violation"),
	);
	// bringing the ball up: an 8-second call, a backcourt violation (more against a press, more from a weak handler)
	if ((ctx.inbound || ctx.defReb) && !ctx.trans && !ctx.lastReb) {
		const bw = (ctx.press ? 4 : 1) * (r.drb < 50 ? 1.5 : 1) * 0.12;
		for (const t of [
			n + " is called for a backcourt violation",
			"8-second violation: " +
				n +
				" can't get it past half court" +
				(ctx.press ? " against the press" : ""),
			n + " steps back over half court: backcourt violation",
		]) {
			add(bw, t);
		}
		if (ctx.press) {
			add(0.6, "the full-court press traps " + n + " and he throws it away");
		}
		if (ctx.inbound) {
			add(
				0.12,
				"five-second violation: " + n + " can't get the inbound pass in",
			);
		}
	}
	// a long possession that ends without a shot. (BBGM's sim never lets the shot clock run out, so only a turnover deep into the clock reads
	// as a violation; a little earlier it is "with the shot clock winding down".)
	if (e.shotClock) {
		rows.length = 0;
	}
	if (ctx.gap >= 12 || e.shotClock) {
		const w = e.shotClock ? 1 : Math.min(1, (ctx.gap - 11) / 8);
		for (const t of [
			"shot-clock violation: the trap leaves " + n + " without a shot",
			"shot-clock violation: " + n + " can't get a shot off",
			n +
				"'s shot misses the rim entirely as the shot clock runs out: violation",
			"the shot clock expires with the ball in " + n + "'s hands",
		]) {
			add(0.45 * w, t);
		}
		for (const t of [
			"with the shot clock winding down, " + n + " throws it away",
			n + " forces a pass late in the shot clock and turns it over",
			n + " is stuck with the shot clock running down and loses the ball",
		]) {
			add(e.shotClock ? 0 : 0.5 * w, t);
		}
	}
	// The sim says whether the ball went out of bounds: only wordings that match are used
	const isOob = (t: string) =>
		/out of bounds|goes out|and out\b|sails out|skips out|over .*head and out|steps on the sideline|rolls out/.test(
			t,
		);
	let ok = rows.filter((r) => (ctx.oob ? isOob(r[1]) : !isOob(r[1])));
	if (!ok.length) {
		ok = ctx.oob
			? [[1, n + " loses the ball out of bounds", {}]]
			: [[1, n + " is called for traveling", {}]];
	}
	const x = pickW(rng, ok)!;
	if (x[2].mate) {
		ctx.mateUsed = x[2].mate;
	}
	if (x[2].foul) {
		ctx.offFoulUsed = true;
	}
	if (x[2].drawer) {
		ctx.drawerUsed = x[2].drawer;
		if (x[2].charge) {
			ctx.chargeTaken = x[2].drawer;
		}
	}
	return x[1];
}
export function rebText(
	rng: any,
	p: any,
	off: any,
	three: any,
	ownBlock: any,
	blk: any,
) {
	if (ownBlock) {
		return pickV(rng, [
			p.name + " recovers his own blocked shot",
			p.name + " chases down his blocked shot and keeps it alive",
		]);
	}
	// a block kept in play: the blocker's team recovers it (or the shooter's team scrambles for it)
	if (blk && rng.random() < 0.6) {
		if (!off && p === blk) {
			return pickV(rng, [
				p.name + " gathers in his own block",
				p.name + " controls the loose ball after his block",
				p.name + " blocks it to himself",
			]);
		}
		if (!off) {
			return pickV(rng, [
				p.name + " scoops up the loose ball after the block",
				p.name + " collects the blocked shot",
				p.name + " corrals the block",
			]);
		}
		return pickV(rng, [
			p.name + " scrambles after the block and gets it back",
			p.name + " grabs the loose ball after the block",
		]);
	}
	if (off) {
		return pickV(rng, [
			p.name + " grabs the offensive rebound",
			"offensive rebound by " + p.name,
			p.name + " keeps it alive with an offensive board",
			p.name + " crashes the glass and gets it back",
			p.name + " outfights everyone for the offensive rebound",
			"the rebound is tipped out to " + p.name,
			p.name + " comes up with it in a scrum under the basket",
			three
				? p.name + " tracks down the long rebound"
				: p.name + " tips it to himself",
			p.name + " sneaks in for the offensive board",
		]);
	}
	return pickV(rng, [
		p.name + " skies for the rebound",
		p.name + " high-points the rebound",
		p.name + " collects the carom",
		p.name + " grabs the rebound",
		"defensive rebound by " + p.name,
		p.name + " secures the board",
		p.name + " clears the glass",
		p.name + " boxes out and grabs it",
		p.name + " pulls down the rebound",
		three
			? p.name + " gathers the long rebound"
			: p.name + " rebounds in traffic",
		p.name + " snatches the rebound",
	]);
}
