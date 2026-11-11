// Perimeter Defense (League extras, basketball, see docs/native-features.md): how the default DPOY and All-Defensive awards score
// and fill their teams with the setting on. Awards whose formula was edited are left alone.
import { defaultAwardsBasketball } from "../../../common/defaultGameAttributes.ts";
import {
	nativeFeatureEnabled,
	nativeFeatureOption,
} from "../../../common/nativeFeatures.ts";
import g from "../../util/g.ts";

// The default formula is dws/3.1 + seasonFraction*winp + gp/82*(blk/4.1 + stl/1.8). Defensive win shares come mostly from
// defensive rebounds and blocks, so bigs dominate it: a starting C averages about 2.4x the DWS of a starting PG. With the setting
// on, DWS counts a quarter less and steals (which the setting's sim change leans to on-ball defenders) half more; blocks the same.
export const PERIMETER_DEFENSE_FORMULA =
	"0.75 * dws/3.1 + seasonFraction * winp + gp / 82 * (blk / 4.1 + 1.5 * stl / 1.8)";

type AwardLike = {
	formula: string;
	formulaByPos?: unknown;
	numTeams?: number;
	statRange?: unknown;
};

const STOCK_FORMULAS = new Set([
	defaultAwardsBasketball.dpoy.formula,
	defaultAwardsBasketball.def.formula,
]);

const enabled = () =>
	__SPORT === "basketball" &&
	nativeFeatureEnabled("perimeterDefense", (key) => g.get(key as any));

// The formula the award's score is computed with, if the setting replaces it
export const perimeterDefenseFormula = (award: AwardLike) =>
	award.statRange === undefined &&
	STOCK_FORMULAS.has(award.formula) &&
	award.formulaByPos === undefined &&
	enabled()
		? PERIMETER_DEFENSE_FORMULA
		: undefined;

export type AllDefensiveFormat = "none" | "oneGuard" | "gfc";

// "oneGuard" wants a true guard, a GF (a wing) doesn't count
const TRUE_GUARDS = new Set(["PG", "SG", "G"]);
const GUARDS = new Set(["PG", "SG", "G", "GF"]);
const FORWARDS = new Set(["GF", "SF", "F", "PF", "FC"]);
const CENTERS = new Set(["FC", "C"]);

// The All-Defensive team format, for a team award built on the default defense formula
export const allDefensiveFormat = (award: AwardLike): AllDefensiveFormat => {
	if (
		award.numTeams === undefined ||
		award.statRange !== undefined ||
		!STOCK_FORMULAS.has(award.formula) ||
		!enabled()
	) {
		return "none";
	}
	const format = nativeFeatureOption<string>(
		"perimeterDefenseAllDefensive",
		(key) => g.get(key as any),
	);
	return format === "oneGuard" || format === "gfc" ? format : "none";
};

// Fill numTeams teams of 5 from players sorted best first. "oneGuard": every team has at least one guard (the best guard left takes
// the team's last slot if none made it on score). "gfc": 2 guards, 2 forwards and a center per team (a GF can fill a guard or forward
// slot, an FC a forward or center slot, each player the first open one of his slots). Teams are ranked by the order players are taken,
// so the best scores make the 1st team. Returns fewer players when there aren't enough.
export const fillAllDefensive = <T extends { pos: string }>(
	sortedPlayers: T[],
	numTeams: number,
	format: AllDefensiveFormat,
	perTeam = 5,
): T[][] => {
	const teams: T[][] = [];
	const used = new Set<T>();
	for (let i = 0; i < numTeams; i++) {
		const team: T[] = [];
		if (format === "gfc" && perTeam === 5) {
			const open = { g: 2, f: 2, c: 1 };
			for (const p of sortedPlayers) {
				if (team.length >= perTeam) {
					break;
				}
				if (used.has(p)) {
					continue;
				}
				const slot =
					GUARDS.has(p.pos) && open.g > 0
						? "g"
						: FORWARDS.has(p.pos) && open.f > 0
							? "f"
							: CENTERS.has(p.pos) && open.c > 0
								? "c"
								: undefined;
				if (slot) {
					open[slot] -= 1;
					team.push(p);
					used.add(p);
				}
			}
			// Not enough players at some position: the best players left
			for (const p of sortedPlayers) {
				if (team.length >= perTeam) {
					break;
				}
				if (!used.has(p)) {
					team.push(p);
					used.add(p);
				}
			}
		} else {
			for (const p of sortedPlayers) {
				if (team.length >= perTeam) {
					break;
				}
				if (used.has(p)) {
					continue;
				}
				const isLast = team.length === perTeam - 1;
				if (
					format === "oneGuard" &&
					isLast &&
					!team.some((p2) => TRUE_GUARDS.has(p2.pos)) &&
					!TRUE_GUARDS.has(p.pos)
				) {
					// The last slot is for a guard
					const guard = sortedPlayers.find(
						(p2) => !used.has(p2) && TRUE_GUARDS.has(p2.pos),
					);
					if (guard) {
						team.push(guard);
						used.add(guard);
						continue;
					}
				}
				team.push(p);
				used.add(p);
			}
		}
		teams.push(team);
	}
	return teams;
};
