// Franchise reboots: the words around a team's relocation, rename or rebrand (news, fan reaction, newspaper feature). The franchise
// keeps its tid, so records, history and rivalries carry over by themselves; this only tells the story. Seeded by tid and season.
import { Rng } from "./pbpFlavor/rng.ts";

export type FranchiseChangeKind = "relocation" | "rename" | "rebrand";

export type FranchiseChange = {
	tid: number;
	season: number;
	kind: FranchiseChangeKind;
	// "Seattle SuperSonics"
	from: string;
	to: string;
	// The old city, for a relocation
	fromRegion?: string;
	toRegion?: string;
	// 0-1 team hype at the time, if known
	hype?: number;
};

const KIND_CODE: Record<FranchiseChangeKind, number> = {
	relocation: 1,
	rename: 2,
	rebrand: 3,
};

type TeamLook = {
	region?: string;
	name?: string;
	colors?: readonly string[];
};

// What changed from last season's team row to this one's, if anything. Rows from very old leagues can lack the name, city or
// colors: nothing is read into a missing field (no "undefined undefined are moving" story)
export const franchiseChangeKind = (
	prev: TeamLook,
	now: TeamLook,
): FranchiseChangeKind | undefined => {
	if (
		prev.region === undefined ||
		prev.name === undefined ||
		now.region === undefined ||
		now.name === undefined
	) {
		return undefined;
	}
	if (prev.region !== now.region) {
		return "relocation";
	}
	if (prev.name !== now.name) {
		return "rename";
	}
	if (
		Array.isArray(prev.colors) &&
		Array.isArray(now.colors) &&
		prev.colors.join() !== now.colors.join()
	) {
		return "rebrand";
	}
	return undefined;
};

// One or two sentences on how the fans took it
export const fanReaction = (c: FranchiseChange): string => {
	const rng = new Rng(c.tid * 1000 + c.season, 8800 + KIND_CODE[c.kind]);
	const hype = c.hype ?? 0.5;
	if (c.kind === "relocation") {
		const old = c.fromRegion ?? "the old city";
		const nu = c.toRegion ?? "the new city";
		return `${rng.pick([
			`Fans in ${old} are heartbroken; a few hundred gathered outside the old arena with signs.`,
			`In ${old}, the reaction is bitter: season-ticket holders say they will not watch.`,
			`${old} loses its team, and the local paper runs a black front page.`,
		])} ${rng.pick(
			hype >= 0.5
				? [
						`In ${nu}, the first ticket sale sold out in hours.`,
						`${nu} is ready: the welcome rally drew a big crowd downtown.`,
					]
				: [
						`${nu} is curious but cautious; the team will have to win them over.`,
						`Early ticket sales in ${nu} are modest.`,
					],
		)}`;
	}
	if (c.kind === "rename") {
		return rng.pick(
			hype >= 0.5
				? [
						"Fans are split, but the new merchandise is already sold out.",
						"Longtime fans grumble about the old name; the kids seem to love the new one.",
					]
				: [
						"Fans mostly shrug: a new name won't fix the roster.",
						"Social media is merciless about the new name, but the team insists it will grow on people.",
					],
		);
	}
	return rng.pick([
		"The new colors get mixed reviews, and the throwback jerseys are suddenly in high demand.",
		"Fans react to the new look with a mix of excitement and nostalgia.",
		"The team calls it a fresh start; fans call it a fresh reason to buy a jersey.",
	]);
};

// The news line for a change, with the fan reaction (plain text; the caller adds the link)
export const changeHeadline = (c: FranchiseChange) => {
	if (c.kind === "relocation") {
		return `The ${c.from} are moving and will now be the ${c.to}.`;
	}
	if (c.kind === "rename") {
		return `The ${c.from} are now the ${c.to}.`;
	}
	return `The ${c.to} unveiled new colors and a new look.`;
};

// A newspaper feature on the move
export const featureParagraphs = (
	c: FranchiseChange,
	record?: { won: number; lost: number; titles: number; seasons: number },
): { head: string; body: string[] } => {
	const rng = new Rng(c.tid * 1000 + c.season, 8900 + KIND_CODE[c.kind]);
	const head =
		c.kind === "relocation"
			? rng.pick([
					`Goodbye, ${c.fromRegion ?? c.from}: the ${c.to} begin a new era`,
					`The ${c.to} are born, and the history moves with them`,
				])
			: c.kind === "rename"
				? rng.pick([
						`From ${c.from} to ${c.to}`,
						`A new name for an old franchise: meet the ${c.to}`,
					])
				: rng.pick([
						`The ${c.to} get a new look`,
						`New colors for the ${c.to}`,
					]);
	const body = [
		c.kind === "rebrand"
			? `The ${c.to} have changed their colors and look ahead of the ${c.season} season.`
			: `The franchise formerly known as the ${c.from} will play as the ${c.to} from the ${c.season} season.`,
	];
	if (record && record.seasons > 0) {
		body.push(
			`It takes everything with it: ${record.seasons} seasons, a ${record.won}-${record.lost} record${record.titles > 0 ? ` and ${record.titles} championship${record.titles === 1 ? "" : "s"}` : ""}, every record in the book and every rivalry. The old banners stay part of the history${c.kind === "relocation" ? ", even if they hang in a new building" : ""}.`,
		);
	}
	body.push(fanReaction(c));
	return { head, body };
};
