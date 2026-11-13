// arch15: hand-written names of a build at a position group (posNames.ts), where its own name fits one group and another
// name says the same thing at another (merges across position groups add theirs in defs.data.ts). Each must agree with
// every position of its group the build is for (position.ts nameContradictsPosition) and be no other build's name.
import type { PosGroup } from "./posNames.ts";

export const POS_NAMES: Record<string, Partial<Record<PosGroup, string>>> = {
	"slashing-playmaker": { wing: "Downhill Point Forward" },
	"aerial-playmaker": { wing: "Aerial Point Forward" },
	"2-way-inside-out-dime-dropper": { wing: "2-Way Inside-Out Point Forward" },
	"inside-out-slasher": { wing: "Inside-Out Slashing Wing" },
	"rim-reaping-rim-runner": { wing: "Shot-Erasing Wing Runner" },
	"lockdown-eraser": { wing: "Help-Side Eraser" },
	"shot-erasing-cleaner": { guard: "Shot-Erasing Glass Guard" },
	"edge-enforcer": { big: "Edge-Enforcing Switch Big" },
	// (arch15 new builds)
	"3-and-d-specialist": { guard: "3 & D Guard" },
	"shot-erasing-guard-dog": { wing: "Shot-Erasing Lockdown Wing" },
};
