// Scouts who disagree (League Extras: Scout Consensus & Flags). Every scout of the user's department who has seen a prospect gives his own
// grade: the prospect's value as the department sees it (his true value seen through the department's shared scouting error, the fuzz),
// then the scout's own lean (his bias, "our guy") and his own error, sized by how much is still unknown about the prospect (the
// department's remaining uncertainty) and by the scout (quality and experience, his specialty, whether he covers the prospect's region).
// So a wide spread honestly means the room knows less. Pure and deterministic: seeded per league, scout, prospect and season, never the
// game's random numbers, and nothing is stored.
import { Rng } from "../ratingsBuilds/rng.ts";
import { REGION_AFFINITY } from "../staffDepth/regions.ts";
import type { ScoutRegion } from "../staffDepth/types.ts";
import type { ScoutBias, Specialty } from "./types.ts";

export type RoomScout = {
	id: number;
	name: string;
	// "college scout", "Director of Scouting", ...
	title: string;
	specialty: Specialty;
	bias: ScoutBias;
	// 0-1, experience included
	quality: number;
	// His region this season (Scouting Director & Regions), undefined without a region plan
	region?: ScoutRegion;
	director?: boolean;
};

export type RoomProspect = {
	pid: number;
	// Value as the user's department sees it (valueFuzz)
	value: number;
	// Remaining scouting uncertainty, rating points (the scouting report's)
	uncertainty: number;
	region: ScoutRegion;
	// Rank in his class by the user's scouts' value (1 = top)
	rank: number;
	// Drafted after the next draft
	future: boolean;
	// Big events he was seen at this season (tournament, showcase, combine)
	events: number;
	age: number;
	// As the user sees them (fuzz applied); undefined when hidden
	ratings?: {
		spd: number;
		jmp: number;
		tp: number;
		hgt: number;
		ovr: number;
		pot: number;
	};
	// Pre-draft points per game, when he has a record
	pts?: number;
	// Scout ids who picked him as their guy this season
	ourGuyOf?: number[];
};

export type RoomGrade = {
	scoutId: number;
	name: string;
	title: string;
	// Covers his region (saw him the most)
	familiar: boolean;
	// Value-scale grade and where it would slot him in his class
	value: number;
	slot: number;
	slotText: string;
	reason: string;
	outlier?: "high" | "low";
};

export type SpreadLabel = "Agree" | "Mixed" | "Split" | "One look";

export type Room = {
	n: number;
	consensus: number;
	consensusSlot: number;
	consensusText: string;
	// Standard deviation of the grades, value points (0 with one scout)
	spread: number;
	label: SpreadLabel;
	// Best and worst slot among the scouts
	slotRange: [number, number];
	grades: RoomGrade[];
	// "Scouts split: No. 4 to No. 19", "Baker: much higher than the room"
	summary: string;
	outliers: string[];
};

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// Who has seen him: the scouts covering his region always; the top of the class is seen by everyone; the rest of the room catches him
// at the big events or on the way through, seeded per scout and prospect. The Director sees the top 30. At least one scout always has.
export const whoSees = (
	scouts: RoomScout[],
	p: Pick<RoomProspect, "pid" | "region" | "rank" | "future" | "events">,
	seed: string,
	season: number,
) => {
	const out: { s: RoomScout; familiar: boolean }[] = [];
	for (const s of scouts) {
		const familiar = s.director
			? false
			: s.region !== undefined
				? s.region === p.region
				: REGION_AFFINITY[s.specialty][p.region] >= 1;
		let sees = familiar;
		if (!sees) {
			if (s.director) {
				sees = p.rank <= (p.future ? 5 : 30);
			} else if (p.future) {
				sees =
					p.rank <= 5 &&
					new Rng(`roomSees|${seed}|${s.id}|${p.pid}|${season}`).random() < 0.5;
			} else if (p.rank <= 10) {
				sees = true;
			} else {
				const prob =
					Math.min(0.75, 0.25 * p.events) +
					(p.rank <= 30 ? 0.35 : p.rank <= 60 ? 0.12 : 0.04);
				sees =
					new Rng(`roomSees|${seed}|${s.id}|${p.pid}|${season}`).random() <
					prob;
			}
		}
		if (sees) {
			out.push({ s, familiar });
		}
	}
	if (out.length === 0) {
		const field = scouts.filter((s) => !s.director);
		const best = (field.length > 0 ? field : scouts).toSorted(
			(a, b) =>
				REGION_AFFINITY[b.specialty][p.region] * b.quality -
					REGION_AFFINITY[a.specialty][p.region] * a.quality || a.id - b.id,
		)[0];
		if (best) {
			out.push({ s: best, familiar: false });
		}
	}
	return out;
};

// A scout's lean on a prospect, value points (bounded), and what drives it
export const scoutLean = (
	s: Pick<RoomScout, "id" | "bias">,
	p: Pick<RoomProspect, "ratings" | "pts" | "age" | "ourGuyOf">,
) => {
	const r = p.ratings;
	let lean = 0;
	switch (s.bias) {
		case "athletes":
			lean = r ? 0.06 * (r.spd + r.jmp - 100) : 0;
			break;
		case "shooters":
			lean = r ? 0.08 * (r.tp - 50) : 0;
			break;
		case "size":
			lean = r ? 0.08 * (r.hgt - 50) : 0;
			break;
		case "production":
			lean = p.pts !== undefined ? 0.25 * (p.pts - 12) : -0.5;
			break;
		case "tools":
			lean = r ? 0.12 * (r.pot - r.ovr - 12) : 0;
			break;
		case "youth":
			lean = p.age <= 19 ? 2 : p.age <= 20 ? 1 : p.age >= 22 ? -1.5 : 0;
			break;
		case "harsh":
			lean = -1.5;
			break;
		case "generous":
			lean = 1.5;
			break;
		case "none":
			lean = 0;
	}
	lean = clamp(lean, -2.5, 2.5);
	const ourGuy = p.ourGuyOf?.includes(s.id) ?? false;
	return { lean: lean + (ourGuy ? 2.5 : 0), biasLean: lean, ourGuy };
};

// One scout's own error, value points: what the department can't know, more for a weaker scout, less for one who covers the region or
// whose specialty fits
export const scoutError = (
	s: Pick<RoomScout, "quality" | "specialty">,
	p: Pick<RoomProspect, "uncertainty" | "region">,
	familiar: boolean,
) =>
	(0.8 + 0.85 * Math.max(0, p.uncertainty)) *
	(1.35 - 0.7 * clamp(s.quality, 0, 1)) *
	(familiar ? 0.8 : 1.1) *
	(REGION_AFFINITY[s.specialty][p.region] >= 1 ? 0.9 : 1);

const BIAS_REASON: Partial<Record<ScoutBias, [string, string]>> = {
	athletes: ["Loves the athleticism", "Doesn't see the athlete he wants"],
	shooters: ["Sold on the jumper", "Doesn't trust the shot"],
	size: ["Likes the size and length", "Thinks he's undersized"],
	production: ["The numbers back him up", "Wants to see more production"],
	tools: ["Betting on the tools", "Doesn't see the tools to grow into"],
	youth: ["Young for the class, lots of runway", "Old for the class"],
	harsh: ["", "Tough grader: sees the holes first"],
	generous: ["Sees the best case", ""],
};

export const slotText = (slot: number, numTeams: number, numPicks: number) =>
	slot <= 3
		? "a top-3 pick"
		: slot <= 10
			? "a top-10 pick"
			: slot <= Math.min(14, numTeams)
				? "a lottery pick"
				: slot <= numTeams
					? "a first-rounder"
					: slot <= numPicks
						? "a second-rounder"
						: "an undrafted free agent";

// Where a value would slot in his class: 1 + the other prospects valued higher (classValues: the others, any order)
export const slotFor = (value: number, classValues: number[]) =>
	1 + classValues.filter((v) => v > value).length;

export const SPREAD_MIXED = 1.6;
export const SPREAD_SPLIT = 3.2;

export const spreadLabel = (n: number, sd: number): SpreadLabel =>
	n < 2
		? "One look"
		: sd >= SPREAD_SPLIT
			? "Split"
			: sd >= SPREAD_MIXED
				? "Mixed"
				: "Agree";

const lastName = (name: string) => name.split(" ").at(-1) ?? name;

const sd = (xs: number[]) => {
	if (xs.length < 2) {
		return 0;
	}
	const m = xs.reduce((a, x) => a + x, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

export const buildRoom = ({
	scouts,
	prospect: p,
	classValues,
	numTeams,
	numPicks,
	seed,
	season,
}: {
	scouts: RoomScout[];
	prospect: RoomProspect;
	// The other prospects of his class, value as the user sees it
	classValues: number[];
	numTeams: number;
	numPicks: number;
	seed: string;
	season: number;
}): Room | undefined => {
	const seen = whoSees(scouts, p, seed, season);
	if (seen.length === 0 || !Number.isFinite(p.value)) {
		return undefined;
	}
	const grades: RoomGrade[] = seen.map(({ s, familiar }) => {
		const { lean, biasLean, ourGuy } = scoutLean(s, p);
		const unit = clamp(
			new Rng(`room|${seed}|${s.id}|${p.pid}|${season}`).normal(0, 1),
			-2.2,
			2.2,
		);
		const err = unit * scoutError(s, p, familiar);
		const value = Math.round((p.value + lean + err) * 10) / 10;
		const slot = slotFor(value, classValues);
		const sees = slotText(slot, numTeams, numPicks);
		let reason: string;
		const biasWords = BIAS_REASON[s.bias];
		if (ourGuy) {
			reason = `"He's my guy": pounding the table, sees ${sees}`;
		} else if (
			biasWords &&
			Math.abs(biasLean) >= 1 &&
			Math.abs(biasLean) >= Math.abs(err)
		) {
			const words = biasLean > 0 ? biasWords[0] : biasWords[1];
			reason = `${words || "Has his own take"}; sees ${sees}`;
		} else if (Math.abs(err) < 1) {
			reason = `In line with what we know; sees ${sees}`;
		} else if (familiar) {
			reason =
				err > 0
					? `Has seen him the most and likes what he's seen; sees ${sees}`
					: `Has seen him the most and has doubts; sees ${sees}`;
		} else {
			reason =
				err > 0
					? `Only caught him a few times, but came away impressed; sees ${sees}`
					: `Only caught him a few times and wasn't sold; sees ${sees}`;
		}
		return {
			scoutId: s.id,
			name: s.name,
			title: s.title,
			familiar,
			value,
			slot,
			slotText: sees,
			reason,
		};
	});
	const values = grades.map((g) => g.value);
	const n = values.length;
	const consensus =
		Math.round((values.reduce((a, x) => a + x, 0) / n) * 10) / 10;
	const spread = Math.round(sd(values) * 100) / 100;
	const label = spreadLabel(n, spread);
	const outliers: string[] = [];
	if (n >= 3) {
		for (const g of grades) {
			const others = values.filter((_, i) => grades[i] !== g);
			const mean = others.reduce((a, x) => a + x, 0) / others.length;
			const diff = g.value - mean;
			if (Math.abs(diff) >= Math.max(3, 1.75 * sd(others))) {
				g.outlier = diff > 0 ? "high" : "low";
				outliers.push(
					`${lastName(g.name)}: much ${diff > 0 ? "higher" : "lower"} than the room (sees ${g.slotText})`,
				);
			}
		}
	} else if (n === 2) {
		const [a, b] = grades.toSorted((x, y) => y.value - x.value);
		if (a!.value - b!.value >= 4.5) {
			a!.outlier = "high";
			b!.outlier = "low";
			outliers.push(
				`${lastName(a!.name)} has him much higher than ${lastName(b!.name)}`,
			);
		}
	}
	const slots = grades.map((g) => g.slot);
	const slotRange: [number, number] = [Math.min(...slots), Math.max(...slots)];
	const consensusSlot = slotFor(consensus, classValues);
	const consensusText = slotText(consensusSlot, numTeams, numPicks);
	const summary =
		n < 2
			? `Only ${grades[0]!.name} has seen him: ${consensusText}, but nobody can back that up yet.`
			: label === "Split"
				? `Scouts split: anywhere from No. ${slotRange[0]} to No. ${slotRange[1]}. Treat the consensus (${consensusText}) with caution.`
				: label === "Mixed"
					? `Some debate (No. ${slotRange[0]} to No. ${slotRange[1]}); the room leans ${consensusText}.`
					: `The room agrees: ${consensusText}.`;
	return {
		n,
		consensus,
		consensusSlot,
		consensusText,
		spread,
		label,
		slotRange,
		grades: grades.toSorted(
			(a, b) => b.value - a.value || a.scoutId - b.scoutId,
		),
		summary,
		outliers,
	};
};
