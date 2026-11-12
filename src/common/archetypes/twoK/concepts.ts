// The vocabulary of NBA 2K build names. A build name is a string of concepts ("2-Way" + "Inside-Out" + "Dimer"): each concept
// says which dimensions the name promises (a profile weight of at least that much, and a floor on how far the skill must
// stand out from the player's own level), how the expanded ratings refine it (`xw`, never required) and how it reads in a
// one-line description. Used by build2k.script.test.ts to turn the converted 2K builds into archetypes.
import type { ArchetypeFamily, DimKey } from "../types.ts";

type Dims = Partial<Record<DimKey, number>>;

export type Concept = {
	key: string;
	re: RegExp;
	// Profile weights the name promises (at least)
	w: Dims;
	// Floors relative to his own level: league-wide z (need) or z for his size (needFor)
	need?: Dims;
	needFor?: Dims;
	// Refinements with expanded ratings (weights on pdef/idef/len/cs/orl/sec), never floors
	xw?: Dims;
	family: ArchetypeFamily;
	tag?: string;
	phrase: string;
};

export const CONCEPTS: Concept[] = [
	{
		key: "twoWay",
		re: /2-Way|Two Way|Both Ends/,
		w: { diq: 1.5 },
		need: { diq: 0 },
		family: "defender",
		tag: "defense",
		phrase: "defends his position",
	},
	{
		key: "lockdown",
		re: /Lockdown|\bLock\b|Clamp|Guard Dog|Eliminator|Defender|Defensive(?! Rebound)|Edge[ -]Enforc|3 & D|Switch-Defending|Curtain/,
		w: { dper: 2.5 },
		need: { pdef: 0.3, dper: 0.1 },
		xw: { pdef: 2 },
		family: "defender",
		tag: "defense",
		phrase: "locks down the perimeter",
	},
	{
		key: "steal",
		re: /Ball[ -]Hawk|Ball[ -]Snatch|Thie[fv]|Snatch & Slash|Disruptive|Chaos/,
		w: { stl: 2.5 },
		need: { stl: 0.3, pdef: 0.1 },
		xw: { pdef: 1.5, len: 0.5 },
		family: "defender",
		tag: "defense",
		phrase: "hunts steals and deflections",
	},
	{
		key: "rimD",
		re: /Eras|Obliterat|Swats|Backline|Anchor|Guardian|Rim[ -]Reap|Paint[ -]Hawk|Curtain/,
		w: { blk: 2.5, dint: 1.5 },
		need: { blk: 0.3 },
		needFor: { blk: 0 },
		xw: { idef: 2 },
		family: "defender",
		tag: "defense",
		phrase: "protects the rim",
	},
	{
		key: "oreb",
		re: /Crash|Putback|Board[ -]Hunt/,
		w: { reb: 2.5 },
		needFor: { reb: 0.3 },
		xw: { orl: 1 },
		family: "rebounder",
		tag: "rebounding",
		phrase: "crashes the offensive glass",
	},
	{
		key: "reb",
		re: /Clean|Board(?![ -]Hunt)|Glass(?! Visionary)|Rebound|Floor-Sweeping/,
		w: { reb: 2.5 },
		needFor: { reb: 0.3 },
		xw: { orl: -0.5 },
		family: "rebounder",
		tag: "rebounding",
		phrase: "cleans the glass",
	},
	{
		key: "outlet",
		re: /Break[ -]Start/,
		w: { pss: 2, reb: 1.5 },
		need: { pss: 0.2 },
		family: "playmaker",
		tag: "playmaking",
		phrase: "starts the break with his outlet passes",
	},
	{
		key: "threeLevel",
		re: /3-Level/,
		w: { three: 2, mid: 2, fin: 1.5 },
		need: { three: 0.2, mid: 0.2 },
		family: "scorer",
		tag: "shooting",
		phrase: "scores at all three levels",
	},
	{
		key: "insideOut",
		re: /Inside-Out/,
		w: { fin: 2, three: 2 },
		need: { three: 0.2, fin: 0.1 },
		family: "scorer",
		tag: "shooting",
		phrase: "scores at the rim and from three",
	},
	{
		key: "catchShoot",
		re: /Sharp|Stretch|Strech|Pop|3 & D|Catch & Shoot|Off-Screen|Big Range|Automatic|Shots|Silk|PlayShot|Laser/,
		w: { three: 2.5 },
		need: { three: 0.3 },
		xw: { cs: 1 },
		family: "shooter",
		tag: "shooting",
		phrase: "spaces the floor with his jumper",
	},
	{
		key: "shotHunt",
		re: /3PT|Snip|Shot Hunter|Gunner|Logo|Cash Out/,
		w: { three: 2.5 },
		need: { three: 0.3 },
		xw: { cs: -0.5 },
		family: "shooter",
		tag: "shooting",
		phrase: "hunts threes",
	},
	{
		key: "midPaint",
		re: /Mid-Paint/,
		w: { mid: 2.5, fin: 1.5 },
		need: { mid: 0.3 },
		family: "scorer",
		phrase: "scores from mid-range and in the paint",
	},
	{
		key: "midPost",
		re: /Mid-Post/,
		w: { mid: 2.5, post: 2 },
		need: { mid: 0.3 },
		needFor: { post: 0.2 },
		family: "scorer",
		phrase: "scores from mid-range and the post",
	},
	{
		key: "mid",
		re: /Mid-Range|Middy|Mid-Slash|Maestro|Menace|Smooth|Faceup/,
		w: { mid: 2.5 },
		need: { mid: 0.3 },
		family: "scorer",
		phrase: "lives in the mid-range",
	},
	{
		key: "post",
		re: /(?<!Mid-)Post(?!eriz|er\b)|Footwork/,
		w: { post: 2.5 },
		needFor: { post: 0.3 },
		family: "scorer",
		phrase: "scores in the post",
	},
	{
		key: "paint",
		re: /(?<!Mid-)Paint(?![ -]Hawk)/,
		w: { fin: 2, post: 1.5 },
		need: { fin: 0.2 },
		family: "scorer",
		phrase: "scores in the paint",
	},
	{
		key: "slash",
		re: /Sla[Ss]h|Blow-By|Drive & Rise/,
		w: { fin: 2.5, draw: 1.5, drb: 1 },
		need: { fin: 0.3, drb: -0.2 },
		family: "slasher",
		phrase: "attacks the basket off the dribble",
	},
	{
		key: "finish",
		re: /Finish|Laymak|Layup|Bullmaker/,
		w: { fin: 2.5 },
		need: { fin: 0.3 },
		family: "slasher",
		phrase: "finishes around the rim",
	},
	{
		key: "dunk",
		re: /Dunk|Rim[ -]Rock|Rim[ -]Wreck|Poster|[Mm]ash|Yamming/,
		w: { fin: 2.5, jmp: 1.5 },
		need: { fin: 0.3 },
		family: "athlete",
		tag: "athletic",
		phrase: "dunks on people",
	},
	{
		key: "air",
		re: /High[ -]Fly|Aerial|Glide|Athletic|Explosive|Force of Nature/,
		w: { jmp: 2.5, ath: 2 },
		need: { ath: 0.3 },
		family: "athlete",
		tag: "athletic",
		phrase: "plays above the rim",
	},
	{
		key: "lob",
		re: /Lob/,
		w: { fin: 2, jmp: 1.5 },
		need: { fin: 0.2 },
		family: "athlete",
		tag: "athletic",
		phrase: "catches lobs",
	},
	{
		key: "riser",
		re: /Ris(?:er|ing)/,
		w: { mid: 1.5, jmp: 1 },
		family: "scorer",
		phrase: "rises up for his shot",
	},
	{
		key: "run",
		re: /Rim[ -]Run|Wing[ -]Run|Pick-Diving|Speedy/,
		w: { spd: 2, ath: 1.5 },
		need: { spd: 0.2 },
		family: "athlete",
		tag: "athletic",
		phrase: "runs the floor",
	},
	{
		key: "tempo",
		re: /Tempo|Pilot/,
		w: { spd: 2, drb: 2 },
		need: { spd: 0.2, drb: 0.2 },
		family: "playmaker",
		phrase: "pushes the pace",
	},
	{
		key: "creator",
		re: /Creat|Iso|Ankle|Shifty|Shot Hunter/,
		w: { drb: 2.5, usg: 1.5 },
		need: { drb: 0.3 },
		xw: { cs: -1 },
		family: "scorer",
		phrase: "creates his own shot off the dribble",
	},
	{
		key: "pass",
		re: /Playmak|Play(?:Shot|Sla[Ss]h)|Dim|Dot|Table[ -]Sett|Distributor|Point (?:Forward|Four|Center)|Point$|Visionary|Engine|Triple-Double/,
		w: { pss: 2.5 },
		need: { pss: 0.3 },
		xw: { sec: 0.5 },
		family: "playmaker",
		tag: "playmaking",
		phrase: "sets up teammates",
	},
	{
		key: "tripleDouble",
		re: /Triple-Double/,
		w: { reb: 2, usg: 1.5 },
		needFor: { reb: 0.2 },
		family: "playmaker",
		phrase: "fills every column of the box score",
	},
	{
		key: "scorer",
		re: /Scor|Bucket|Engine/,
		w: { usg: 1.5 },
		family: "scorer",
		phrase: "carries a scoring load",
	},
	{
		key: "strength",
		re: /Bull|Physical|Power|Bodyguard|Grinder|Tank|[Mm]asher|Pound/,
		w: { stre: 2 },
		need: { stre: 0.2 },
		family: "hustle",
		phrase: "plays through contact",
	},
	{
		key: "skill",
		re: /Crafty|Skilled|Fluid|Phenom|Prodigy|Savant|Versatile|King/,
		w: { oiq: 1.5 },
		family: "skilled",
		phrase: "wins with skill and feel",
	},
];

// What a name says, in the order the name says it
export const conceptsOf = (name: string) =>
	CONCEPTS.map((c) => ({ c, at: name.search(c.re) }))
		.filter((x) => x.at >= 0)
		.sort((x, y) => x.at - y.at)
		.map((x) => x.c);

// Hand-written descriptions for the 2K names that are nicknames rather than a string of concepts
export const SPECIAL_DESCS: Record<string, string> = {
	"The Anomaly": "A one-of-a-kind big: skills no player his size should have.",
	"Yamming Force of Nature":
		"An overwhelming athlete who gets to the rim and finishes above it.",
	"Master Of Both Ends": "Dominates the game on offense and on defense.",
	"Mr. Two Way": "A guard who scores and guards the other team's best.",
	"Footwork Pharaoh": "Wins in the post with footwork and touch.",
	"From The Logo": "Pulls up from anywhere past half court.",
	"Shifty King": "Breaks defenders down with the best handle on the floor.",
	"Walking Bucket": "Scores from everywhere on the floor.",
	"Offensive Engine":
		"The offense runs through him: scoring, handling and passing.",
	"Dot Dispenser": "A pass-first table setter who racks up assists.",
	"Triple-Double Threat": "Scores, rebounds and passes every night.",
	"Dunk Tank": "Powers through contact for dunks.",
	"Steel Curtain": "A wall on defense, inside and out.",
	Grinder: "Does the dirty work: strength, effort and no glamour.",
	Footer: "Seven feet of size around the basket.",
	Bodyguard: "A physical forward who protects his teammates and the paint.",
	"Big Smooth": "A big man with a smooth scoring touch.",
	"Big Range": "A big forward with deep shooting range.",
	"Big Glide": "A big, gliding point guard who gets where he wants.",
	"Laser Beam": "A pure shooter with a quick, flat-footed release.",
	Automatic: "Money from anywhere: a knockdown shooter.",
	"Cash Out": "A scoring point guard who cashes threes off the dribble.",
	Eliminator: "Takes the other team's best scorer out of the game.",
	"The Guard Dog": "Hounds ball handlers the length of the floor.",
	"Swats & Shots": "Blocks shots at one end and makes threes at the other.",
	"Silk Stretch": "A center with a silky outside shot.",
	"Fluid Four": "A power forward who moves and handles like a wing.",
};
