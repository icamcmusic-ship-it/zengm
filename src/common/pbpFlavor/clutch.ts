import { formatClock } from "../formatClock.ts";
import { Rng } from "./rng.ts";

// Flavor wording for game-winning / game-tying / game-saving plays (event log, news feed, player feats, box score notes). Built only from
// the sim's own clutch-play record (ClutchMeta), so it works with play-by-play logging off, and seeded by gid + the play's index like the
// rest of the flavor engine, so the same game always reads the same. Never touches Math.random.

export type ClutchShotType =
	| "atRim"
	| "tipIn"
	| "putBack"
	| "lowPost"
	| "midRange"
	| "threePointer"
	| "ft";

export type ClutchPlayerRef = { pid: number; name: string };

export type ClutchMeta =
	| {
			kind: "winner" | "tying" | "forceOT";
			player: ClutchPlayerRef;
			shot: ClutchShotType;
			// How the final points came, when free throws finished it: "and1" = and-one after a made 2 (three-point play), "and1Three" = after a 3
			finish?: "and1" | "and1Three" | "twoFt" | "threeFt";
			time: number;
			elam: boolean;
			ast?: ClutchPlayerRef;
			def?: ClutchPlayerRef;
			// forceOT: "double" etc. (empty for the first overtime); tying: whether it forced a shootout
			otLabel?: string;
			shootout?: boolean;
	  }
	| {
			kind: "defense";
			play: "blk" | "stl" | "tov";
			player: ClutchPlayerRef;
			opp: ClutchPlayerRef;
			// Shot type that was blocked
			shot?: ClutchShotType;
			time: number;
			// Defensive team's lead when the play happened (0 = tied)
			lead: number;
	  }
	| {
			kind: "shootout";
			player: ClutchPlayerRef;
			opp: ClutchPlayerRef;
	  };

type Link = (p: ClutchPlayerRef) => string;

const KIND_CODE = { winner: 1, tying: 2, forceOT: 3, defense: 4, shootout: 5 };

const clockPhrase = (rng: Rng, time: number, ft: boolean) => {
	if (time <= 0) {
		return ft
			? "with no time on the clock"
			: rng.pick(["at the buzzer", "as time expires", "at the horn"]);
	}
	const c = formatClock(time);
	return rng.pick([
		`with ${c} seconds left`,
		`with ${c} seconds remaining`,
		`with ${c} left on the clock`,
		`with just ${c} seconds to go`,
	]);
};

const shotPhrase = (
	rng: Rng,
	shot: ClutchShotType,
	link: Link,
	def: ClutchPlayerRef | undefined,
) => {
	switch (shot) {
		case "threePointer":
			return rng.pick([
				"buries a step-back three",
				"drills a three from the wing",
				"splashes a corner three",
				"knocks down a pull-up three",
				"hits a deep three",
			]);
		case "midRange":
			return rng.pick([
				"hits a pull-up jumper",
				"drains a fadeaway jumper",
				"knocks down a mid-range jumper",
				"rises up for a jumper from the elbow",
			]);
		case "lowPost":
			return rng.pick([
				"scores on a turnaround in the post",
				"banks in a hook shot",
				"spins baseline and scores",
				"backs down his man and scores",
			]);
		case "atRim": {
			const base = rng.pick([
				"finishes at the rim",
				"drives for a layup",
				"throws down a dunk",
				"scoops in a layup",
			]);
			return def ? `${base} over ${link(def)}` : base;
		}
		case "tipIn":
			return rng.pick(["tips it in", "taps in the miss"]);
		case "putBack":
			return rng.pick(["puts back the miss", "cleans up the miss"]);
		case "ft":
			return rng.pick(["sinks the free throw", "hits the free throw"]);
	}
};

export const clutchFlavorText = (
	meta: ClutchMeta,
	gid: number,
	index: number,
	link: Link,
) => {
	const rng = new Rng(gid, 9100 + index * 17 + KIND_CODE[meta.kind]);
	const who = link(meta.player);

	if (meta.kind === "shootout") {
		return `${who} ${rng.pick(["outduels", "beats", "outshoots"])} ${link(meta.opp)} in a shootout`;
	}

	if (meta.kind === "defense") {
		let action;
		if (meta.play === "blk") {
			const s = meta.shot;
			action =
				s === "threePointer"
					? rng.pick([
							`blocks ${link(meta.opp)}'s three-point try`,
							`gets a hand on ${link(meta.opp)}'s three`,
						])
					: s === "atRim" || s === "tipIn" || s === "putBack"
						? rng.pick([
								`blocks ${link(meta.opp)} at the rim`,
								`swats ${link(meta.opp)}'s layup`,
								`rejects ${link(meta.opp)} at the basket`,
							])
						: rng.pick([
								`blocks ${link(meta.opp)}'s jumper`,
								`rejects ${link(meta.opp)}'s shot`,
							]);
		} else if (meta.play === "stl") {
			action = rng.pick([
				`picks ${link(meta.opp)}'s pocket`,
				`strips ${link(meta.opp)}`,
				`steals the ball from ${link(meta.opp)}`,
			]);
		} else {
			action = rng.pick([
				`forces ${link(meta.opp)} into a turnover`,
				`pressures ${link(meta.opp)} into a turnover`,
			]);
		}
		const end =
			meta.lead > 0
				? rng.pick(["to preserve the win", "to protect the lead", "to seal it"])
				: rng.pick([
						"in a tie game to set up the win",
						"with the score tied to save the game",
					]);
		return `${who} ${action} ${clockPhrase(rng, meta.time, false)} ${end}`;
	}

	let action;
	if (meta.finish === "and1") {
		action = rng.pick([
			"converts the three-point play",
			"completes the and-one",
		]);
	} else if (meta.finish === "and1Three") {
		action = "completes the four-point play";
	} else if (meta.finish === "twoFt") {
		action = rng.pick(["sinks both free throws", "hits a pair of free throws"]);
	} else if (meta.finish === "threeFt") {
		action = "sinks all three free throws";
	} else {
		action = shotPhrase(rng, meta.shot, link, meta.def);
		if (meta.ast) {
			action += rng.pick([
				`, set up by ${link(meta.ast)},`,
				` off a feed from ${link(meta.ast)}`,
				` on a pass from ${link(meta.ast)}`,
			]);
		}
	}

	const clock = meta.elam
		? ""
		: ` ${clockPhrase(rng, meta.time, meta.shot === "ft")}`;

	let end;
	if (meta.kind === "winner") {
		end = rng.pick(["to win it", "to win the game", "for the win"]);
	} else if (meta.kind === "forceOT") {
		const ot = meta.otLabel ? `${meta.otLabel} overtime` : "overtime";
		end = rng.pick([`to force ${ot}`, `to send it to ${ot}`]);
	} else {
		end = meta.shootout ? "to force a shootout" : "to tie it";
	}

	return `${who} ${action}${clock} ${end}`;
};
