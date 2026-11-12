import { getScoutingExport } from "../core/scoutingReports/index.ts";
import {
	PLAYER,
	PLAYER_STATS_TABLES,
	PLAYER_SUMMARY,
	RATINGS,
	getPlayerStatsTableStats,
} from "../../common/constants.ts";
import {
	TRAIT_CATEGORIES,
	traitStatusText,
} from "../../common/playerTraits/categories.ts";
import { TRAIT_DEFINITIONS } from "../../common/playerTraits/definitions.ts";
import { formatTraitReading } from "../../common/playerTraits/scouting.ts";
import {
	exportShowsRatings,
	type ExportTable,
	type PlayerExport,
} from "../../common/playerExport.ts";
import { PLAYER_GAME_STATS } from "../../common/constants.ts";
import { getCols } from "../../common/getCols.ts";
import getWinner from "../../common/getWinner.ts";
import { processPlayerStats } from "./processPlayerStats.ts";
import { ratingsKeysForView } from "../core/player/expandedRatings.ts";
import { idb } from "../db/index.ts";
import { getPlayer } from "../views/player.ts";
import { g } from "./index.ts";
import { getTraitViewContext, getTraitsForView } from "./playerTraitsView.ts";

const SUMMARY_STATS = Object.values(PLAYER_SUMMARY)[0]?.stats ?? [];

const pickStats = (row: Record<string, unknown> | undefined) => {
	if (!row) {
		return undefined;
	}
	if (typeof row.gp === "number" && row.gp <= 0) {
		return undefined;
	}
	const out: Record<string, number> = {};
	for (const key of SUMMARY_STATS) {
		const value = row[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			out[key] = Math.round(value * 10) / 10;
		}
	}
	return out;
};

// Column titles like the player page ("FG%", "3PA"), falling back to the key
const colTitle = (prefix: "stat" | "rating", key: string): string => {
	try {
		return getCols([`${prefix}:${key}`])[0]!.title;
	} catch {
		// Game highs (fgMax) have the stat's own title, under a Game Highs header on the page
		if (key.endsWith("Max") && key.length > 3) {
			return colTitle(prefix, key.slice(0, -3));
		}
		return key;
	}
};

const cell = (value: unknown): string | number => {
	// Game highs are [value, gid, abbrev, tid, season]
	if (Array.isArray(value)) {
		return cell(value[0]);
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
	}
	if (value == null) {
		return "";
	}
	return String(value);
};

const statsTables = (
	p: any,
	section: string,
	rowsAll: any[],
	careers: { regularSeason?: any; playoffs?: any },
	teamKey: "abbrev" | "teamName",
) => {
	const tables: ExportTable[] = [];
	for (const info of Object.values(PLAYER_STATS_TABLES)) {
		const stats = getPlayerStatsTableStats(info.stats);
		for (const playoffs of [false, true]) {
			// Rows are regular season (playoffs false), playoffs (true) or both together ("combined"), which is left out
			const rows = rowsAll.filter(
				(row) =>
					(playoffs ? row.playoffs === true : !row.playoffs) &&
					(row.gp ?? 0) > 0,
			);
			if (rows.length === 0) {
				continue;
			}
			const career = playoffs ? careers.playoffs : careers.regularSeason;
			tables.push({
				section,
				title: `${info.name}${playoffs ? " (playoffs)" : ""}`,
				cols: [
					"Year",
					"Team",
					"Age",
					...stats.map((stat) => colTitle("stat", stat)),
				],
				rows: [
					...rows.map((row) => [
						row.season,
						cell(row[teamKey] ?? row.abbrev),
						cell(row.age),
						...stats.map((stat) => cell(row[stat])),
					]),
					...(career && (career.gp ?? 0) > 0
						? [["Career", "", "", ...stats.map((stat) => cell(career[stat]))]]
						: []),
				],
			});
		}
	}
	return tables;
};

// What the user can see of these players, for "Download players" (PDF/JSON/CSV). Ratings are the scouted (fuzzed) ones,
// hidden entirely by the "no visible ratings" challenge (except retired players, like the player page), traits are the
// user's readings (ranges for prospects), and the secret aging curve is only included once revealed (retired players).
// The raw player never leaves the worker.
export const getPlayersForExport = async ({
	pids,
	season,
	gameLog = false,
}: {
	pids: number[];
	season?: number;
	// Current season's game log, for the PDF/JSON (off by default: it's long)
	gameLog?: boolean;
}): Promise<PlayerExport[]> => {
	const currentSeason = g.get("season");
	const traitContext = await getTraitViewContext();
	const teamInfo = g.get("teamInfoCache");
	const ratingKeys = ratingsKeysForView(RATINGS);
	const out: PlayerExport[] = [];

	const gameStats = Array.from(
		new Set(Object.values(PLAYER_GAME_STATS).flatMap((x) => x.stats)),
	);
	const pidSet = new Set(pids);
	const games = gameLog
		? await idb.merged.games.getAll(
				{ season: currentSeason },
				{
					filter: (game) =>
						game.teams.some((t) => t.players.some((p) => pidSet.has(p.pid))),
				},
			)
		: [];
	const abbrev = (tid: number) =>
		tid < 0 ? "ASG" : (teamInfo[tid]?.abbrev ?? "???");
	const gameLogTable = (pid: number): ExportTable | undefined => {
		const rows: (string | number)[][] = [];
		for (const game of games) {
			const t0 = game.teams[0].players.some((p) => p.pid === pid)
				? 0
				: game.teams[1].players.some((p) => p.pid === pid)
					? 1
					: undefined;
			if (t0 === undefined) {
				continue;
			}
			const t1 = t0 === 0 ? 1 : 0;
			const row = game.teams[t0].players.find((p) => p.pid === pid)!;
			if (!row.min) {
				continue;
			}
			const processed = processPlayerStats(row, gameStats);
			const winner = getWinner(game.teams);
			rows.push([
				game.playoffs ? `PO ${game.day ?? ""}` : (game.day ?? ""),
				abbrev(game.teams[t0].tid),
				`${t0 === 0 ? "vs" : "@"} ${abbrev(game.teams[t1].tid)}`,
				`${winner === t0 ? "W" : winner === t1 ? "L" : "T"} ${game.teams[t0].pts}-${game.teams[t1].pts}`,
				...gameStats.map((stat) => cell(processed[stat])),
			]);
		}
		if (rows.length === 0) {
			return;
		}
		return {
			section: "Game log",
			title: `${currentSeason} game log`,
			cols: [
				"Day",
				"Team",
				"Opp",
				"Result",
				...gameStats.map((stat) => colTitle("stat", stat)),
			],
			rows,
		};
	};

	for (const pid of pids) {
		const pRaw = await idb.merged.players.get(pid);
		if (!pRaw) {
			continue;
		}
		const p = await getPlayer(pRaw);
		if (!p) {
			continue;
		}
		const retired = pRaw.tid === PLAYER.RETIRED;
		const showRatings = exportShowsRatings(
			!!g.get("challengeNoRatings"),
			pRaw.tid,
			PLAYER.RETIRED,
		);

		const wantedSeason = season ?? currentSeason;
		const ratingsRow: any =
			p.ratings.findLast((r: any) => r.season === wantedSeason) ??
			p.ratings.at(-1);
		const statsRow = p.stats.findLast(
			(row: any) => row.season === wantedSeason && !row.playoffs,
		);

		const traits = getTraitsForView(pRaw, traitContext);
		const t = pRaw.tid >= 0 ? teamInfo[pRaw.tid] : undefined;
		const team = await (pRaw.tid >= 0
			? idb.cache.teams.get(pRaw.tid)
			: undefined);

		const lastPreDraft = p.preDraftStats.at(-1) as any;

		const tables: ExportTable[] = statsTables(
			p,
			"Stats",
			p.stats,
			{
				regularSeason: p.careerStats,
				playoffs: (p as any).careerStatsPlayoffs,
			},
			"abbrev",
		);
		if (showRatings && p.ratings.length > 0) {
			tables.push({
				section: "Ratings history",
				title: "Ratings by season (as scouted)",
				cols: [
					"Year",
					"Team",
					"Age",
					"Pos",
					"Ovr",
					"Pot",
					...ratingKeys.map((key) => colTitle("rating", key)),
					"Skills",
				],
				rows: p.ratings.map((r: any) => [
					r.season,
					cell(r.abbrev),
					cell(r.age),
					cell(r.pos),
					cell(r.ovr),
					cell(r.pot),
					...ratingKeys.map((key) => cell(r[key])),
					(r.skills ?? []).join(" "),
				]),
			});
		}
		if (traits) {
			for (const category of TRAIT_CATEGORIES) {
				const rows = traits.traits
					.filter((t) => (category.traits as readonly string[]).includes(t.key))
					.map((t) => [
						TRAIT_DEFINITIONS[t.key]?.name ?? t.key,
						formatTraitReading(t),
						traitStatusText(t),
					]);
				if (category.key === "physical" && traits.agingCurve) {
					rows.push([
						"Aging curve",
						traits.agingCurve.name,
						traits.agingCurve.description,
					]);
				}
				if (rows.length > 0) {
					tables.push({
						section: "Traits",
						title: category.name,
						cols: ["Trait", "Reading", "Status"],
						rows,
					});
				}
			}
		}
		if (p.preDraftStats.length > 0) {
			tables.push(
				...statsTables(p, "College/Overseas", p.preDraftStats, {}, "teamName"),
			);
		}
		if (p.earlierHonors.length > 0) {
			tables.push({
				section: "College/Overseas",
				title: "Honors before the draft",
				cols: ["Year", "Honor"],
				rows: p.earlierHonors.map((h: any) => [h.season, h.type]),
			});
		}
		const log = gameLog ? gameLogTable(pid) : undefined;
		if (log) {
			tables.push(log);
		}
		if (p.awards.length > 0) {
			tables.push({
				section: "Awards",
				title: "Awards",
				cols: ["Year", "Award"],
				rows: p.awards.map((a: any) => [
					a.season,
					`${a.groupPrefix ? `${a.groupPrefix} ` : ""}${a.type}`,
				]),
			});
		}

		out.push({
			pid: p.pid,
			name: p.name,
			tid: pRaw.tid,
			team: t
				? `${t.region} ${t.name}`
				: pRaw.tid === PLAYER.FREE_AGENT
					? "Free agent"
					: pRaw.tid === PLAYER.UNDRAFTED
						? "Draft prospect"
						: retired
							? "Retired"
							: "",
			abbrev: t?.abbrev ?? "",
			pos: ratingsRow?.pos ?? "",
			age: p.age,
			born: p.born,
			hgt: p.hgt,
			weight: p.weight,
			wingspan:
				showRatings && typeof ratingsRow?.wng === "number"
					? ratingsRow.wng
					: undefined,
			college: p.college || undefined,
			draft: {
				year: p.draft.year,
				round: p.draft.round,
				pick: p.draft.pick,
				abbrev: (p.draft as any).abbrev ?? undefined,
			},
			contract:
				pRaw.tid === PLAYER.RETIRED || pRaw.tid === PLAYER.UNDRAFTED
					? undefined
					: p.contract
						? {
								// format() gives millions; thousands like the rest of the game
								amount: Math.round(p.contract.amount * 1000),
								exp: p.contract.exp,
							}
						: undefined,
			injury:
				p.injury.gamesRemaining > 0
					? `${p.injury.type} (${p.injury.gamesRemaining} games)`
					: undefined,
			season: ratingsRow?.season ?? wantedSeason,
			ratings: showRatings
				? {
						ovr: ratingsRow?.ovr,
						pot: ratingsRow?.pot,
						...Object.fromEntries(
							ratingKeys
								.filter((key) => typeof ratingsRow?.[key] === "number")
								.map((key) => [key, ratingsRow[key]]),
						),
					}
				: undefined,
			skills: showRatings ? (ratingsRow?.skills ?? []) : [],
			badges: showRatings ? (ratingsRow?.badges ?? []) : [],
			archetype: showRatings ? p.archetype?.label : undefined,
			traits: traits
				? traits.traits.map((trait) => ({
						name: TRAIT_DEFINITIONS[trait.key]?.name ?? trait.key,
						reading: formatTraitReading(trait),
						exact: trait.exact,
					}))
				: undefined,
			// Only set once revealed (retirement), see getPlayerTraitsForUI
			agingCurve: traits?.agingCurve?.name,
			seasonStats: pickStats(statsRow as any),
			careerStats: pickStats(p.careerStats as any),
			awards: p.awards.map(
				(award: any) =>
					`${award.season} ${award.groupPrefix ? `${award.groupPrefix} ` : ""}${award.type}`,
			),
			preDraft: lastPreDraft
				? {
						team: lastPreDraft.teamName,
						season: lastPreDraft.season,
						stats: pickStats(lastPreDraft) ?? {},
					}
				: undefined,
			tables,
			scouting: await getScoutingExport(pRaw.pid),
			face: pRaw.imgURL ? undefined : pRaw.face,
			imgURL: pRaw.imgURL || undefined,
			colors: team?.colors,
			jersey: team?.jersey,
		});
	}

	return out;
};
