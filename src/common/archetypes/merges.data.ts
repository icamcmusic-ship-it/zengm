// arch14: near-duplicate builds merged into one. Each pair promises the same skills (score.ts promisesOf) and the reading
// could not tell them apart: profiles with a cosine of 0.75 or more over the dimensions, or the two were the top two within
// 0.15 z for a quarter or more of the players either was picked for (league of 3,000 plus real NBA 2016-2025, arch14
// scratchpad mergecand.json). The removed build's name (and its own 2K aliases) become aliases of the kept one, for search;
// the kept one takes the union of their positions and height gates. A stored label with a removed id is read as the kept
// one (helpers.ts viewOf) and re-read at the next reading (ARCHETYPE_READING_VERSION).
// removed id -> kept id
export const MERGED: Record<string, string> = {
	"disruptive-lockdown": "edge-enforcer",
	"backline-lockdown": "lockdown-eraser",
	"shot-obliterating-lock": "lockdown-eraser",
	"glass-guardian-lob-threat": "rim-wrecking-glass-guardian",
	"ball-snatching-lockdown": "ball-hawking-lockdown",
	"physical-2-way-3pt-slasher": "2-way-inside-out-bully-slasher",
	"2-way-crafty-3-level-scorer": "2-way-3-level-scorer",
	"shot-erasing-sharp-riser": "backline-pick-and-popper",
	"disruptive-skilled-stretch": "edge-enforcing-skilled-stretch",
	"ball-snatching-stretch-four": "edge-enforcing-skilled-stretch",
	"shot-erasing-mid-paint-scorer": "rim-reaping-mid-paint-scorer",
	"gritty-high-flying-3pt-sniper": "high-flying-3pt-sniper",
	"shot-erasing-putback-bully": "bulldozing-glass-guardian",
	"2-way-blow-by-high-flyer": "2-way-high-flying-slasher",
	"backline-bulldozer": "physical-rim-reaper",
	"shot-erasing-rim-runner": "rim-reaping-rim-runner",
	"gritty-blow-by-high-flyer": "high-flying-slasher",
	"high-flying-middy-maestro": "mid-range-high-flyer",
	"inside-out-slashing-cleaner": "inside-out-board-enforcer",
	"board-hunting-lob-threat-bully": "board-hunting-power-dunker",
	"post-bully-board-enforcer": "post-bully-cleaner",
	"gritty-iso-savant": "iso-savant",
	"shot-creating-combo-guard": "iso-savant",
	"2-way-crafty-mid-range-slasher": "2-way-mid-range-slasher",
	"2-way-crafty-mid-paint-scorer": "2-way-mid-paint-scorer",
	"2-way-faceup-rising-cleaner": "2-way-mid-paint-crasher",
	"2-way-crafty-walking-bucket": "2-way-crafty-versatile-scorer",
	"board-enforcing-diming-riser": "triple-double-threat",
	"2-way-3pt-sniper": "2-way-off-screen-shooter",
	"shot-erasing-skilled-stretch": "shot-erasing-skilled-popper",
	playmaker: "pass-first-distributor",
	"crafty-3pt-sniper": "deep-range-sniper",
	"2-way-versatile-paint-finisher": "2-way-dual-finisher",
	"2-way-skilled-stretch": "2-way-pick-and-popper",
};

// The id a stored label stands for now
export const mergedId = (id: string): string => MERGED[id] ?? id;
