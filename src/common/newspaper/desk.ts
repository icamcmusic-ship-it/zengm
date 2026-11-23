// The award race tracker column and the medical desk: two recurring in-season pages built from NewsFacts.awardTracker and
// NewsFacts.medical (and the injury list). Box score stats and games missed only, so they read the same under No Visible Ratings.

import { Ctx, P } from "./ctx.ts";
import { fmt1, plural } from "./text.ts";
import type { Article, Block, NPAwardRace, NPPlayer, Seg } from "./types.ts";

const RACE_LABELS: Record<string, string> = {
	MVP: "MVP",
	DPOY: "Defensive Player of the Year",
	ROY: "Rookie of the Year",
	SMOY: "Sixth Man of the Year",
	MIP: "Most Improved Player",
};

// "▲2", "▼1", "new", "–", or "" without an earlier snapshot
export const moveText = (rank: number, prev: number | undefined) => {
	if (prev === undefined) {
		return "";
	}
	if (prev === 0) {
		return "new";
	}
	if (prev > rank) {
		return `▲${prev - rank}`;
	}
	if (prev < rank) {
		return `▼${rank - prev}`;
	}
	return "–";
};

const raceLine = (key: string, p: NPPlayer | undefined) => {
	if (!p) {
		return "";
	}
	if (key === "DPOY") {
		return `${fmt1(p.stl)} stl, ${fmt1(p.blk)} blk, ${fmt1(p.trb)} reb`;
	}
	return `${fmt1(p.pts)}/${fmt1(p.trb)}/${fmt1(p.ast)}`;
};

// Biggest climber into the top 3 across the races
const biggestMove = (races: NPAwardRace[]) => {
	let best:
		| { race: NPAwardRace; row: NPAwardRace["rows"][number]; up: number }
		| undefined;
	for (const race of races) {
		for (const [i, row] of race.rows.entries()) {
			if (row.prev === undefined) {
				continue;
			}
			const up = row.prev === 0 ? 6 - (i + 1) : row.prev - (i + 1);
			if (up > 0 && (!best || up > best.up)) {
				best = { race, row, up };
			}
		}
	}
	return best;
};

export const awardTrackerColumn = (c: Ctx): Article | undefined => {
	const races = (c.f.awardTracker ?? []).filter((race) => race.rows.length > 0);
	if (races.length === 0 || c.done) {
		return undefined;
	}
	const r = c.rng("award-tracker");
	const mvp = races.find((race) => race.key === "MVP") ?? races[0]!;
	const leader = mvp.rows[0]!;
	const move = biggestMove(races);
	const sinceGp = races.find((race) => race.sinceGp !== undefined)?.sinceGp;

	const body: Block[] = [
		P(
			`Where the races stand through ${plural(c.f.gp, "game")}, by the same scoring the voters' ballots follow`,
			sinceGp !== undefined
				? `, and how they have moved since the last check after ${plural(sinceGp, "game")}.`
				: `; this is the first check of the ${c.season} season, so the arrows start next time.`,
		),
	];
	if (move) {
		const label = RACE_LABELS[move.race.key] ?? move.race.name;
		body.push(
			P(
				"Biggest mover: ",
				c.pl(move.row.pid, move.row.name),
				move.row.prev === 0
					? ` crashed the ${label} top three from outside the top five.`
					: ` climbed ${plural(move.up, "spot")} in the ${label} race.`,
			),
		);
	}
	for (const race of races) {
		body.push(
			{ type: "sub", text: RACE_LABELS[race.key] ?? race.name },
			{
				type: "table",
				head: [
					"",
					"Player",
					"Team",
					race.key === "DPOY" ? "STL/BLK/REB" : "PTS/REB/AST",
					"Move",
				],
				numCols: [0],
				rows: race.rows.map((row, i) => [
					[String(i + 1)],
					[c.pl(row.pid, row.name)],
					[c.tl(row.tid, c.team(row.tid)?.abbrev)],
					[raceLine(race.key, c.player(row.pid))],
					[moveText(i + 1, row.prev)],
				]),
			},
		);
	}
	const second = mvp.rows[1];
	return {
		id: "award-tracker",
		type: "award-tracker",
		size: "feature",
		kicker: "Award race tracker",
		head: c.freshHead(r, [
			leader.prev !== undefined && leader.prev !== 1
				? `${leader.name} takes over the ${RACE_LABELS[mvp.key] ?? mvp.key} race`
				: `${leader.name} holds the top spot`,
			move
				? `On the move: ${move.row.name} climbs the ${RACE_LABELS[move.race.key] ?? move.race.key} board`
				: undefined,
			second
				? `Tracker: ${leader.name} leads, ${second.name} gives chase`
				: undefined,
		])!,
		byline: c.byline("awards"),
		photoPid: leader.pid,
		body,
	};
};

// ---- Medical desk ---------------------------------------------------------

export const medicalDesk = (c: Ctx, tid?: number): Article | undefined => {
	const med = c.f.medical;
	if (!med || c.done || c.pre) {
		return undefined;
	}
	const mine = <T extends { tid: number }>(list: T[]) =>
		tid === undefined ? list : list.filter((x) => x.tid === tid);
	const out = mine(c.f.injuries.filter((i) => i.gamesRemaining > 0)).toSorted(
		(a, b) => b.gamesRemaining - a.gamesRemaining,
	);
	const longTerm = out.filter((i) => i.gamesRemaining > 3).slice(0, 5);
	const dayToDay = out.filter((i) => i.gamesRemaining <= 3).slice(0, 4);
	const returns = mine(med.returns).slice(0, 4);
	const fragile = mine(med.fragile).slice(0, 3);
	const ironMen = mine(med.ironMen).slice(0, 3);
	if (longTerm.length + dayToDay.length + returns.length === 0) {
		return undefined;
	}
	const r = c.rng("medical", tid ?? "");
	const team = (x: { tid: number }): Seg[] =>
		tid === undefined ? [" (", c.tl(x.tid, c.team(x.tid)?.abbrev), ")"] : [];
	const body: Block[] = [];
	if (longTerm.length > 0) {
		body.push(
			{ type: "sub", text: "Out" },
			{
				type: "list",
				items: longTerm.map((i) => [
					c.pl(i.pid, i.name),
					...team(i),
					`: ${i.type.toLowerCase()}, about ${plural(i.gamesRemaining, "game")} to go`,
					(i.seasonInjuries ?? 0) >= 2
						? `, ${c.pr("his")} ${["", "", "second", "third", "fourth"][i.seasonInjuries!] ?? "latest"} trip to the injury list this season`
						: (i.careerInjuries ?? 0) >= 5
							? `, injury number ${i.careerInjuries} of ${c.pr("his")} career`
							: "",
				]),
			},
		);
	}
	if (dayToDay.length > 0) {
		body.push(
			{ type: "sub", text: "Day to day" },
			{
				type: "list",
				items: dayToDay.map((i) => [
					c.pl(i.pid, i.name),
					...team(i),
					`: ${i.type.toLowerCase()}, could be back within ${plural(i.gamesRemaining, "game")}`,
				]),
			},
		);
	}
	if (returns.length > 0) {
		body.push(
			{ type: "sub", text: "Back in the lineup" },
			{
				type: "list",
				items: returns.map((x) => [
					c.pl(x.pid, x.name),
					...team(x),
					`: cleared after missing ${plural(x.games, "game")} with ${x.type.toLowerCase()}`,
				]),
			},
		);
	}
	const notes: { lead: string; segs: Seg[] }[] = [];
	for (const x of fragile) {
		notes.push({
			lead: "Durability watch",
			segs: [
				c.pl(x.pid, x.name),
				...team(x),
				` has been hurt ${plural(x.injuries, "time")} in three seasons, ${plural(x.games, "game")} missed.`,
			],
		});
	}
	for (const x of ironMen) {
		notes.push({
			lead: "Iron man",
			segs: [
				c.pl(x.pid, x.name),
				...team(x),
				`: ${x.seasons} seasons and never on the injury report.`,
			],
		});
	}
	if (tid === undefined) {
		const worst = med.teamGamesLost[0];
		if (worst && worst.games >= 10) {
			notes.push({
				lead: "Hardest hit",
				segs: [
					"The ",
					c.tl(worst.tid, c.tfull(worst.tid)),
					` have lost ${plural(worst.games, "man-game")} to injury this season, the most in the league.`,
				],
			});
		}
	}
	if (notes.length > 0) {
		body.push(
			{ type: "sub", text: "Durability notes" },
			{ type: "notebook", items: notes },
		);
	}
	const top = longTerm[0] ?? returns[0] ?? dayToDay[0]!;
	return {
		id: tid === undefined ? "medical-desk" : `medical-desk-${tid}`,
		type: "medical",
		size: "feature",
		kicker: "Medical desk",
		head: c.freshHead(r, [
			longTerm[0] ? `${longTerm[0].name} headlines the injury list` : undefined,
			returns[0] ? `${returns[0].name} is back` : undefined,
			`From the training room: ${top.name} and the rest`,
		])!,
		byline: { ...c.byline("medical"), role: "Medical correspondent" },
		body,
	};
};
