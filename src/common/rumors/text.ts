import type { Rumor, RumorType } from "./types.ts";

// Tokens in rumor text. Names are stored so a rumor still reads right after the player retires or the coach leaves
const clean = (name: string) => name.replaceAll(/[:{}]/g, "");
export const tokTeam = (tid: number) => `{t:${tid}}`;
export const tokPlayer = (pid: number, name: string) =>
	`{p:${pid}:${clean(name)}}`;
export const tokCoach = (cid: number, name: string) =>
	`{c:${cid}:${clean(name)}}`;
export const tokGm = (tid: number, name: string) => `{g:${tid}:${clean(name)}}`;

export type RumorSegment =
	| { type: "text"; text: string }
	| { type: "team"; tid: number }
	| { type: "player"; pid: number; name: string }
	| { type: "coach"; cid: number; name: string }
	| { type: "gm"; tid: number; name: string };

const TOKEN = /{([cgpt]):(-?\d+)(?::([^}]*))?}/g;

export const parseRumorText = (text: string): RumorSegment[] => {
	const segments: RumorSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(TOKEN)) {
		if (match.index > last) {
			segments.push({ type: "text", text: text.slice(last, match.index) });
		}
		const id = Number.parseInt(match[2]!);
		const name = match[3] ?? "";
		if (match[1] === "t") {
			segments.push({ type: "team", tid: id });
		} else if (match[1] === "p") {
			segments.push({ type: "player", pid: id, name });
		} else if (match[1] === "c") {
			segments.push({ type: "coach", cid: id, name });
		} else {
			segments.push({ type: "gm", tid: id, name });
		}
		last = match.index + match[0].length;
	}
	if (last < text.length) {
		segments.push({ type: "text", text: text.slice(last) });
	}
	return segments;
};

// Plain text (or HTML, with the link callbacks) of a rumor
export const renderRumorText = (
	text: string,
	teamName: (tid: number) => string,
	link?: {
		team?: (tid: number, name: string) => string;
		player?: (pid: number, name: string) => string;
	},
) =>
	parseRumorText(text)
		.map((segment) => {
			if (segment.type === "text") {
				return segment.text;
			}
			if (segment.type === "team") {
				const name = teamName(segment.tid);
				return link?.team ? link.team(segment.tid, name) : name;
			}
			if (segment.type === "player") {
				return link?.player
					? link.player(segment.pid, segment.name)
					: segment.name;
			}
			return segment.name;
		})
		.join("");

export type RumorTextInput = {
	type: RumorType;
	kind?: string;
	confidence: number;
	// Tokens
	t0: string;
	t1?: string;
	p?: string;
	who?: string;
	// Draft year of a pick, position group of a draft target
	year?: number | string;
	group?: string;
};

const GROUP_TEXT: Record<string, string> = {
	G: "a guard",
	F: "a wing",
	C: "a big man",
};

// Every way a rumor can be worded. The hedging follows the confidence, so "long shot" rumors don't read like done deals
export const rumorTemplates = (r: RumorTextInput): string[] => {
	const { t0, t1 = "", p = "", who = "" } = r;
	const sure = r.confidence >= 0.5;
	const faint = r.confidence < 0.15;
	switch (r.type) {
		case "shopping":
			if (r.kind === "request") {
				return [
					`${p} wants out, and the ${t0} are taking calls.`,
					`The ${t0} are actively shopping ${p}, who asked to be traded.`,
					`Teams are lining up offers for ${p} after his trade request to the ${t0}.`,
				];
			}
			if (r.kind === "dump") {
				return [
					`The ${t0} would like to get out from under the contract of ${p}.`,
					`Looking to trim payroll, the ${t0} are quietly shopping ${p}.`,
					`${p} is available to any team with cap space, according to people around the ${t0}.`,
				];
			}
			if (r.kind === "deadline") {
				return [
					`With the trade deadline close, the ${t0} are listening to offers for ${p}.`,
					`The ${t0} are open for business, and ${p} is the name that keeps coming up.`,
					`Contenders are checking in with the ${t0} about ${p} before the deadline.`,
				];
			}
			if (r.kind === "rebuild") {
				return [
					`The rebuilding ${t0} are listening to offers for ${p}.`,
					`${p} doesn't fit the timeline of the ${t0}, who would move him for picks or young players.`,
					`The ${t0} are taking calls on ${p}.`,
				];
			}
			return faint
				? [
						`The ${t0} wouldn't hang up if a team called about ${p}.`,
						`${p} is not untouchable, people around the ${t0} say.`,
					]
				: [
						`The ${t0} are listening to offers for ${p}.`,
						`${p} is available for the right price, according to people around the ${t0}.`,
					];
		case "interest":
			if (r.kind === "user") {
				return [
					`The ${t0} have interest in ${p}.`,
					`${p} is on the radar of the ${t0}, who may call about him.`,
					`The ${t0} like ${p} and are weighing an offer.`,
				];
			}
			if (r.kind === "request") {
				return [
					`The ${t0} are among the teams pursuing ${p}, who wants out of the ${t1}.`,
					`The ${t0} have called the ${t1} about ${p} since his trade request.`,
				];
			}
			return [
				`The ${t0} have called the ${t1} about ${p}.`,
				`${p} of the ${t1} is on the radar of the ${t0}.`,
				`The ${t0} want veteran help and like ${p} of the ${t1}.`,
			];
		case "pick":
			return [
				`The ${t0} are shopping their ${r.year} first-round pick for help now.`,
				`The ${r.year} first-round pick of the ${t0} is available in the right deal.`,
				`The ${t0} are willing to part with their ${r.year} first-rounder to add a veteran.`,
			];
		case "unhappy":
			if (r.kind === "holdout") {
				return [
					`${p} is unhappy with his contract and could hold out when the ${t0} open the season.`,
					`${p} wants a new deal from the ${t0}, and a holdout is on the table.`,
				];
			}
			return sure
				? [
						`${p} is fed up with the ${t0} and is expected to ask out.`,
						`The relationship between ${p} and the ${t0} is close to breaking.`,
					]
				: [
						`${p} is unhappy with the ${t0} and could ask out.`,
						`All is not well between ${p} and the ${t0}.`,
						`${p} has grown frustrated with the ${t0}.`,
					];
		case "extension":
			return sure
				? [
						`${p} is expected to sign an extension with the ${t0}.`,
						`The ${t0} and ${p} are closing in on a contract extension.`,
					]
				: [
						`The ${t0} and ${p} have talked about a contract extension.`,
						`${p} is open to an extension with the ${t0}, and talks have started.`,
					];
		case "freeAgent":
			if (r.kind === "finalists") {
				return [
					`${p} is down to the ${t0} and the ${t1}.`,
					`The ${t0} and the ${t1} are the finalists for ${p}.`,
				];
			}
			return sure
				? [
						`${p} is expected to sign with the ${t0}.`,
						`The ${t0} are the clear front-runners for ${p}.`,
					]
				: [
						`${p} is leaning toward the ${t0}.`,
						`The ${t0} have made ${p} a priority in free agency.`,
						`The ${t0} are in the lead for ${p}, though nothing is close.`,
					];
		case "coach":
			return sure
				? [
						`${who} is not expected to be back as coach of the ${t0}.`,
						`The ${t0} are preparing to move on from coach ${who}.`,
					]
				: [
						`${who} is on the hot seat with the ${t0}.`,
						`The ${t0} are losing patience with coach ${who}.`,
						`The seat is getting warm for ${who}, coach of the ${t0}.`,
					];
		case "gm":
			return sure
				? [
						`${who}, general manager of the ${t0}, is not expected to keep his job.`,
						`Ownership of the ${t0} is ready to move on from general manager ${who}.`,
					]
				: [
						`${who}, general manager of the ${t0}, is under pressure.`,
						`The owner of the ${t0} is running out of patience with general manager ${who}.`,
					];
		case "draft": {
			const group = GROUP_TEXT[r.group ?? ""] ?? "the best player available";
			return [
				`The ${t0} are expected to target ${group} in the draft.`,
				`The ${t0} want ${group} with their first-round pick.`,
				`Scouts expect the ${t0} to take ${group} in the first round.`,
			];
		}
	}
};

// Team ids in a rumor's text (for links and filters)
export const rumorSearchText = (
	rumor: Pick<Rumor, "text" | "outcome">,
	teamName: (tid: number) => string,
) =>
	`${renderRumorText(rumor.text, teamName)} ${rumor.outcome ? renderRumorText(rumor.outcome, teamName) : ""}`.trim();
