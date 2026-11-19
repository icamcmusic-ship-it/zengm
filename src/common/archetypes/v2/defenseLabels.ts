// archnouns: the defensive label's own description and "why" line (the user: a player with an offensive and a defensive
// label has both in his description and his why). Keyed by the label without its Long / Switchable prefix.
const DEFENSE_TEXT: Record<string, { desc: string; why: string }> = {
	"Switch Defender": {
		desc: "guards the perimeter and the rim, so he can switch",
		why: "Defends both the perimeter and the rim well",
	},
	"Help-Side Roamer": {
		desc: "roams off his man for steals and blocks",
		why: "Gets steals and blocks well beyond his position",
	},
	"Swatting Guard": {
		desc: "a guard who blocks shots",
		why: "Blocks and contests shots like a much bigger player",
	},
	"Shot Eraser": {
		desc: "an elite rim protector",
		why: "Rim protection among the league's very best",
	},
	"Shot Blocker": {
		desc: "a shot blocker",
		why: "Blocks shots at a high rate",
	},
	"Post Defender": {
		desc: "a sturdy post defender",
		why: "Holds his ground in the post",
	},
	"Rim Protector": {
		desc: "protects the rim",
		why: "Protects the rim well",
	},
	"Perimeter Stalker": {
		desc: "hounds his man all over the floor",
		why: "Strong perimeter defense with a relentless motor",
	},
	"Point-of-Attack Pest": {
		desc: "pressures the ball and jumps passing lanes",
		why: "Pressures the ball and gets steals",
	},
	"Lockdown Defender": {
		desc: "locks down the other team's best perimeter player",
		why: "Elite perimeter defense with the feet to stay in front",
	},
	"Cerebral Defender": {
		desc: "defends with positioning and smarts more than feet",
		why: "Elite perimeter defense from smarts and positioning",
	},
	"On-Ball Stopper": {
		desc: "stays in front of ball handlers",
		why: "Quick feet on the ball",
	},
	"Perimeter Defender": {
		desc: "a solid perimeter defender",
		why: "Defends the perimeter well",
	},
	"Ball-Hawking Menace": {
		desc: "a relentless ball hawk",
		why: "Gets steals with nonstop effort",
	},
	"Passing-Lane Interceptor": {
		desc: "jumps passing lanes for steals",
		why: "Reads passing lanes for steals",
	},
	"Ball Hawk": {
		desc: "a ball hawk",
		why: "Gets steals",
	},
};

const baseOf = (label: string) => label.replace(/^(Long|Switchable) /, "");

// "On defense, he protects the rim." (with his length or versatility when the label says so)
export const defenseSentence = (label: string): string => {
	const t = DEFENSE_TEXT[baseOf(label)];
	if (!t) {
		return `On defense: ${label}.`;
	}
	const extra = /^Long /.test(label)
		? ", with long arms"
		: /^Switchable /.test(label)
			? ", and switches onto anyone"
			: "";
	return `On defense, ${t.desc}${extra}.`;
};

// The why bullet for the defensive label
export const defenseWhy = (label: string): string => {
	const t = DEFENSE_TEXT[baseOf(label)];
	const extra = /^Long /.test(label)
		? " (long arms)"
		: /^Switchable /.test(label)
			? " (switches onto anyone)"
			: "";
	return `Defense (${label}): ${t ? t.why : "his defense stands out"}${extra}`;
};
