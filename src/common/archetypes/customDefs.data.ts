// Custom builds: profiles no NBA 2K build covers, found by the diagnostics' uncovered-profiles report (diag.script.test.ts,
// ARCH_DIAG_GAPS) among players whose best 2K build was a poor fit: mostly small and wing players who rebound, post up or
// defend without shooting, veterans whose athleticism is gone, and two kinds of center. Named in the 2K style, but they are
// not 2K names (`custom`: no "Same build in 2K" line). Each profile is the cluster's mean shape (weights in units of 0.55
// z, relative to his own level, as for the 2K builds), plus what the name promises (twoK/concepts.ts).
import { conceptsOf } from "./twoK/concepts.ts";
import type {
	ArchetypeFamily,
	ArchetypeGroup,
	DimKey,
	Pos,
	TwoKDef,
} from "./types.ts";

type Dims = Partial<Record<DimKey, number>>;

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^\da-z]+/g, "-")
		.replace(/^-|-$/g, "");

const custom = (
	name: string,
	positions: Pos[],
	hgt: [number, number],
	w: Dims,
	group: ArchetypeGroup,
	family: ArchetypeFamily,
	desc: string,
	// (ceilings on what the name says he lacks: Archetype's `cap`)
	cap?: Dims,
): TwoKDef => {
	const out: Dims = { ...w };
	const need: Dims = {};
	const needFor: Dims = {};
	const xw: Dims = {};
	const tags = new Set<string>(["custom"]);
	for (const c of conceptsOf(name)) {
		// The skills the name is about (weight 2 or more) at least as the name promises them; its lesser weights only where
		// the profile says nothing (a "Slashing" cleaner need not handle the ball)
		for (const [d, cw] of Object.entries(c.w) as [DimKey, number][]) {
			if (cw >= 2 || out[d] === undefined) {
				out[d] = Math.max(out[d] ?? -Infinity, cw);
			}
		}
		for (const [d, f] of Object.entries(c.need ?? {}) as [DimKey, number][]) {
			// (a floor on handling for a slasher only where the profile does not want it low)
			if ((out[d] ?? 0) >= 0) {
				need[d] = Math.max(need[d] ?? -Infinity, f);
			}
		}
		for (const [d, f] of Object.entries(c.needFor ?? {}) as [
			DimKey,
			number,
		][]) {
			needFor[d] = Math.max(needFor[d] ?? -Infinity, f);
		}
		Object.assign(xw, c.xw ?? {});
		if (c.tag) {
			tags.add(c.tag);
		}
	}
	return {
		id: slug(name),
		name,
		aliases: [],
		group,
		family,
		positions,
		hgt,
		w: out,
		xw,
		need,
		needFor,
		...(cap ? { cap } : {}),
		desc,
		tags: [...tags],
		builds: 0,
		custom: true,
	};
};

// Height bands of the clusters (hgt rating; the gate is soft)
// No group nudge by position (a build for every position it lists)
const universal = (d: TwoKDef): TwoKDef => ({
	...d,
	tags: [...d.tags, "universal"],
});

const SMALL: [number, number] = [0, 36];
const WING: [number, number] = [33, 50];
const SMALL_WING: [number, number] = [0, 50];
const FORWARD: [number, number] = [33, 65];
const BIG_FORWARD: [number, number] = [48, 66];
const BIG: [number, number] = [63, 100];

export const CUSTOM_DEFS: TwoKDef[] = [
	custom(
		"Post-Scoring Slasher",
		["PG", "G", "SG", "GF", "SF", "F", "PF"],
		[0, 62],
		{ post: 2.5, fin: 2.5, usg: 1, drb: -1.5, spd: -1, jmp: -1, three: -1 },
		"wing",
		"slasher",
		"Scores in the post and finishes at the rim, without much of a handle or a jumper.",
		// (arch12: "without much of a handle or a jumper" is part of the name's promise, so a guard who creates off the
		// dribble or shoots is not one)
		{ drb: 0.5, three: 0.7 },
	),
	custom(
		"Slashing Cleaner",
		["GF", "SF", "F"],
		WING,
		{ reb: 2.5, fin: 2, rim: 1, post: 1, drb: -1, mid: -1 },
		"wing",
		"rebounder",
		"A wing who crashes the glass and finishes inside.",
	),
	custom(
		"Glass-Cleaning Slasher",
		["PG", "G"],
		SMALL,
		{ fin: 2.5, reb: 2, usg: 1, post: 1, three: -1, dint: -1 },
		"guard",
		"slasher",
		"A small guard who attacks the rim and rebounds like a forward.",
	),
	custom(
		"Backline Lockdown",
		["SG", "GF", "SF", "F", "PF"],
		FORWARD,
		{ diq: 2.5, stl: 2, dint: 2, mid: -1.5, drb: -1, spd: -1, usg: -1 },
		"wing",
		"defender",
		"A defensive specialist who guards the perimeter and helps at the rim.",
	),
	custom(
		"Lockdown Eraser",
		["F", "PF", "FC", "C"],
		[0, 66],
		{ dint: 2.5, diq: 2, stl: 1.5, mid: -2.5, spd: -1.5, drb: -1 },
		"forward",
		"defender",
		"Protects the paint first and can still guard on the perimeter; no jumper to speak of.",
	),
	custom(
		"Post-Up Glass Cleaner",
		["PG", "G", "GF", "SF", "F", "PF", "FC", "C"],
		[0, 65],
		{ reb: 3, post: 2.5, mid: -2, spd: -2, jmp: -2, drb: -2 },
		"wing",
		"rebounder",
		"An undersized, earthbound post scorer who cleans the glass.",
	),
	custom(
		"Shot-Erasing Cleaner",
		["PG", "G", "GF", "SF", "F", "PF"],
		[0, 62],
		{ reb: 2.5, dint: 2, mid: -2, spd: -2, jmp: -1.5, drb: -1.5 },
		"wing",
		"rebounder",
		"Rebounds and protects the paint above his size, without a perimeter game.",
	),
	custom(
		"Glass-Cleaning Lockdown",
		["GF", "SF", "F", "PF", "FC", "C"],
		[33, 66],
		{ reb: 3, diq: 2.5, stl: 2, oiq: 1.5, mid: -2, jmp: -2, spd: -1.5 },
		"forward",
		"defender",
		"A smart, physical defender who rebounds: all effort, little shooting.",
	),
	custom(
		"Glass-Cleaning Playmaker",
		["PG", "G"],
		SMALL,
		{ pss: 2.5, reb: 2.5, oiq: 1, ath: -2, spd: -2, jmp: -1.5, mid: -1.5 },
		"guard",
		"playmaker",
		"A heady, earthbound point guard who passes and rebounds.",
	),
	custom(
		"High-Flying Shot Creator",
		["F", "PF", "FC", "C"],
		[48, 100],
		{ spd: 3, drb: 3, jmp: 3, ath: 2.5, diq: -2.5, reb: -2, oiq: -1.5 },
		"forward",
		"athlete",
		"A big who runs, jumps and handles like a wing: raw, but a rare athlete.",
	),
	custom(
		"Slashing Mid-Range Maestro",
		["FC", "C"],
		BIG,
		{ mid: 2.5, fin: 2, usg: 1, ft: 1, blk: -1, stl: -1 },
		"big",
		"scorer",
		"A scoring center: a soft mid-range touch and strong finishes, not a shot blocker.",
	),
	custom(
		"Shot-Erasing Post Scorer",
		["PG", "G", "SG"],
		SMALL,
		{ post: 3, dint: 2, spd: -2, jmp: -2, drb: -1.5, mid: -1.5 },
		"guard",
		"scorer",
		"A strong little guard who posts up and holds his own inside on defense.",
	),
	custom(
		"Post-Scoring Eraser",
		["GF", "SF", "F", "PF"],
		FORWARD,
		{ dint: 2.5, post: 2, stre: 1.5, spd: -2, jmp: -1.5, drb: -2, mid: -2 },
		"forward",
		"defender",
		"An undersized interior defender who scores on the block.",
	),
	custom(
		"Diming Cleaner",
		["GF", "SF", "F", "PF"],
		FORWARD,
		{ reb: 3, pss: 2, oiq: 2, diq: 1.5, mid: -2.5, spd: -2 },
		"forward",
		"playmaker",
		"A smart forward who rebounds and makes the extra pass.",
	),
	custom(
		"Shot-Creating Mid-Range Maestro",
		["FC", "C"],
		BIG,
		{ mid: 2.5, drb: 2.5, spd: 2.5, ath: 2, diq: -3, reb: -2 },
		"big",
		"scorer",
		"A center who faces up, handles and pulls up from mid-range like a wing.",
	),
	custom(
		"Slashing Eraser",
		["PG", "G", "GF", "SF", "F"],
		SMALL_WING,
		{ fin: 2, dint: 2, draw: 1.5, mid: -2, drb: -1, jmp: -1, three: -1 },
		"wing",
		"defender",
		"Gets to the rim on offense and defends the paint above his size.",
	),
	custom(
		"Slashing Lockdown",
		["GF", "SF"],
		WING,
		{ fin: 2, diq: 2, stl: 1.5, oiq: 1, drb: -1, mid: -1 },
		"wing",
		"defender",
		"A defensive wing who scores by cutting and attacking the rim.",
	),
	custom(
		"Aerial Guardian",
		["PG", "G", "SG"],
		SMALL,
		{ jmp: 3, ath: 2.5, spd: 2, blk: 2.5, usg: -2, three: -2 },
		"guard",
		"athlete",
		"A small, explosive leaper who blocks shots like a big.",
	),
	custom(
		"High-Flying Eraser",
		["F", "PF"],
		BIG_FORWARD,
		{ jmp: 3, blk: 2.5, spd: 2, ath: 2, diq: -2, pss: -2 },
		"forward",
		"athlete",
		"A bouncy forward who blocks shots on athleticism alone.",
	),
	custom(
		"Shot-Erasing Shot Creator",
		["F", "PF"],
		BIG_FORWARD,
		{ drb: 3, spd: 3, jmp: 3, blk: 2.5, diq: -2.5, fin: -1.5 },
		"forward",
		"scorer",
		"An athletic forward who handles like a guard and blocks shots: raw, but rare tools.",
	),
	// arch11: specialists and playmakers the 2K builds miss (low-overall role players above all), and playmaking for
	// scoring guards whose passing shows in their assist rate rather than a shot
	universal(
		custom(
			"Slashing Playmaker",
			["PG", "G", "SG", "GF", "SF", "F"],
			[0, 58],
			{ pss: 2.5, fin: 2, drb: 1.5, usg: 1.5, three: -0.5, mid: -1.5 },
			"wing",
			"playmaker",
			"Runs the offense off the dribble: gets into the paint to score or find a teammate.",
		),
	),
	custom(
		"Pick & Roll Finisher",
		["FC", "C"],
		[56, 100],
		{
			fin: 2.5,
			rim: 1.5,
			stre: 1.5,
			reb: 1,
			three: -3,
			mid: -2.5,
			drb: -2,
			usg: -1.5,
		},
		"big",
		"hustle",
		"A screen-and-roll big: sets picks, dives and finishes at the rim, with no jumper.",
	),
	custom(
		"Hustle Glass Cleaner",
		["F", "PF", "FC", "C"],
		[48, 100],
		{
			reb: 3,
			stre: 1,
			end: 1,
			usg: -2.5,
			three: -2,
			mid: -2,
			drb: -2,
			oiq: -1,
		},
		"big",
		"rebounder",
		"A pure rebounder: crashes the glass and does the dirty work, with no scoring game.",
	),
	custom(
		"Lockdown Stopper",
		["SG", "GF", "SF", "F"],
		[33, 60],
		{
			dper: 3,
			diq: 2,
			stl: 1.5,
			usg: -2.5,
			three: -1,
			mid: -1.5,
			drb: -1,
			oiq: -1,
		},
		"wing",
		"defender",
		"A defense-only wing: guards the other team's best scorer and stays out of the way on offense.",
	),
	custom(
		"Pass-First Distributor",
		["PG", "G"],
		[0, 45],
		{ pss: 3, oiq: 1, usg: -2, three: -1, mid: -1.5, fin: -1, ath: -1 },
		"guard",
		"playmaker",
		"A backup point guard who runs the offense and moves the ball, with little scoring of his own.",
	),
	universal(
		custom(
			"Athletic Hustler",
			["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
			[0, 70],
			{
				ath: 3,
				jmp: 3,
				spd: 2.5,
				end: 1,
				oiq: -2.5,
				mid: -2,
				three: -1.5,
				pss: -1.5,
				drb: -1,
				ft: -1,
			},
			"wing",
			"athlete",
			"A raw athlete: runs, jumps and plays hard, with the skills still to come.",
		),
	),
	custom(
		"Shot-Blocking Anchor",
		["FC", "C"],
		[60, 100],
		{
			blk: 3,
			dint: 2,
			reb: 1.5,
			three: -2,
			mid: -2,
			drb: -2,
			usg: -2,
			pss: -1,
		},
		"big",
		"defender",
		"A rim protector first and last: blocks shots and anchors the paint.",
	),
	universal(
		custom(
			"Deep-Range Sniper",
			["PG", "G", "SG", "GF", "SF", "F"],
			[0, 60],
			{ three: 3.5, ft: 1.5, usg: 1 },
			"wing",
			"shooter",
			"An elite shooter with unlimited range: the three is the weapon, whatever else he does.",
		),
	),
	// arch15: the gap analysis with sub-ratings (gaps.script.test.ts, arch15 scratchpad new-archetypes.md): recurring roles
	// that every existing build fit poorly, across a random league, veterans, prospects and real players
	// (guards and wings who defend and space the floor with their catch-and-shoot three: real 3-and-D role players, KCP, Jae
	// Crowder, Wesley Matthews; the 2K "3 & D Wing" is a folded alias of another build)
	custom(
		"3 & D Specialist",
		["PG", "G", "SG", "GF", "SF", "F"],
		[0, 58],
		{
			three: 2.5,
			dper: 2,
			diq: 1,
			stl: 0.5,
			drb: -1.5,
			pss: -1,
			post: -1,
			fin: -0.5,
			usg: -1,
		},
		"wing",
		"shooter",
		"A role player who guards the other team's scorer and spaces the floor with catch-and-shoot threes.",
		{ drb: 0.6 },
	),
	// (guards and wings who defend the ball and protect the rim from the help side, without a jumper or a handle: mostly
	// veterans whose athleticism is gone and long defensive wings)
	custom(
		"Shot-Erasing Guard Dog",
		["PG", "G", "SG", "GF", "SF", "F"],
		[0, 58],
		{
			dper: 2.5,
			blk: 2,
			dint: 1,
			diq: 1.5,
			mid: -2,
			drb: -1.5,
			pss: -0.5,
			usg: -1.5,
		},
		"wing",
		"defender",
		"A perimeter stopper who also blocks shots from the help side.",
	),
	// (athletic bigs who space the floor: Mo Bamba, Dragan Bender)
	custom(
		"High-Flying Stretch Big",
		["PF", "FC", "C"],
		[55, 100],
		{ three: 2.5, jmp: 2, ath: 1.5, post: -1.5, pss: -1, reb: -1 },
		"big",
		"shooter",
		"An athletic big who runs, jumps and spaces the floor with his three.",
	),
	// (athletic guards who beat their man off the dribble and finish, with no jumper to speak of)
	custom(
		"Blow-By Rim Attacker",
		["PG", "G", "SG", "GF"],
		[0, 50],
		{ fin: 2.5, drb: 2, ath: 1.5, spd: 1.5, three: -2, mid: -1 },
		"guard",
		"slasher",
		"A quick, explosive guard who lives at the rim off the dribble, with little of a jumper.",
		{ three: 0.6 },
	),
	// (athletic bigs who face up from mid-range)
	custom(
		"High-Flying Faceup Big",
		["PF", "FC", "C"],
		[55, 100],
		{ mid: 2.5, jmp: 2, ath: 1.5, three: -1, pss: -1.5, post: -0.5 },
		"big",
		"scorer",
		"An athletic big who faces up and knocks down the mid-range jumper.",
	),
	// arch13: the all-around star (no profile: read from his level, breadth and evenness, score.ts allAroundQuality)
	{
		...universal(
			custom(
				"Do-It-All Superstar",
				["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
				[0, 100],
				{},
				"wing",
				"balanced",
				"An elite all-around player: scores at every level, makes plays and defends, with no single skill that defines him.",
			),
		),
		tags: ["custom", "universal", "allAround"],
	},
];
