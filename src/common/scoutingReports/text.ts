// Wording helpers for scouting reports: seeded choices so the same report always reads the same, but two players (or two scouts) rarely
// read alike. Pure.
import { Rng } from "../ratingsBuilds/rng.ts";
import type { PeerGroup, RoleScale } from "./types.ts";

export class Voice {
	private rng: Rng;
	constructor(seed: string) {
		this.rng = new Rng(seed);
	}
	pick<T>(options: readonly T[]): T {
		return options[Math.floor(this.rng.random() * options.length)]!;
	}
	chance(p: number) {
		return this.rng.random() < p;
	}
	// A child voice for one part of the report, so adding a sentence in one part never changes the wording of another
	child(key: string) {
		return new Voice(`${this.rng.seedString}|${key}`);
	}
}

export const capFirst = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export const pct = (x: number) => `${x.toFixed(1)}%`;

export const money = (thousands: number) =>
	thousands >= 1000
		? `$${(thousands / 1000).toFixed(thousands >= 10000 ? 0 : 1)}M`
		: `$${Math.round(thousands)}k`;

export const feetInches = (inches: number) =>
	`${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

export const andJoin = (items: string[]) =>
	items.length <= 1
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// Role tiers, for floor/ceiling and outcomes. 0 = out of the league ... 7 = franchise player
export const ROLE_TIERS = 8;

export const tierForOvr = (ovr: number, s: RoleScale) =>
	ovr >= s.franchise
		? 7
		: ovr >= s.allStar
			? 6
			: ovr >= s.qualityStarter
				? 5
				: ovr >= s.starter
					? 4
					: ovr >= s.rotation
						? 3
						: ovr >= s.bench
							? 2
							: ovr >= s.bench - 5
								? 1
								: 0;

export const roleName = (tier: number, group: PeerGroup) => {
	const noun = group === "big" ? "big" : group === "guard" ? "guard" : "wing";
	switch (Math.max(0, Math.min(7, Math.round(tier)))) {
		case 7:
			return "franchise player";
		case 6:
			return "All-Star";
		case 5:
			return `quality starting ${noun}`;
		case 4:
			return `starting ${noun}`;
		case 3:
			return `rotation ${noun}`;
		case 2:
			return `end-of-bench ${noun}`;
		case 1:
			return "fringe roster player";
		default:
			return "out of the league";
	}
};

// Short labels for draft tiers in the track record ("lottery talent")
export const draftTierName = (tier: number) =>
	[
		"not an NBA player",
		"camp body",
		"second-round flier",
		"rotation prospect",
		"first-round talent",
		"lottery talent",
		"All-Star upside",
		"franchise talent",
	][Math.max(0, Math.min(7, Math.round(tier)))]!;

// What a career became, for the track record ("became an All-Star")
export const outcomeName = (tier: number) =>
	[
		"washed out",
		"barely stuck",
		"was a bench player",
		"became a rotation player",
		"became a starter",
		"became a quality starter",
		"became an All-Star",
		"became a franchise player",
	][Math.max(0, Math.min(7, Math.round(tier)))]!;

export const draftRangeName = (tier: number, numTeams: number) =>
	tier >= 7
		? "a top-three pick"
		: tier >= 6
			? "a top-five pick"
			: tier >= 5
				? "a lottery pick"
				: tier >= 4
					? `a pick in the ${numTeams >= 20 ? "middle of the first round" : "first round"}`
					: tier >= 3
						? "a late first-round pick"
						: tier >= 2
							? "a second-round pick"
							: "a camp invite, not a draft pick";
