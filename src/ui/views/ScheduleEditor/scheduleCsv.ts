// Schedule editor: the CSV import (a column per team, the cell is the visiting opponent; a row with only the special label is
// the All-Star Game or the trade deadline)
import { csvParse } from "d3-dsv";
import type { View } from "../../../common/types.ts";
import { groupByUnique, orderBy } from "../../../common/utils.ts";
import { validateEditedSchedule } from "../../../common/validateEditedSchedule.ts";

type Schedule = View<"scheduleEditor">["schedule"];
type Team = View<"scheduleEditor">["teams"][number];

// If these are ever changed it will break any previous CSV schedules on import, so be careful!
export const ALL_STAR_GAME_LABEL = "All-Star Game";
export const TRADE_DEADLINE_LABEL = "Trade Deadline";

const findDuplicates = (strings: string[]) => {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const string of strings) {
		if (seen.has(string)) {
			duplicates.add(string);
		} else {
			seen.add(string);
		}
	}

	return duplicates;
};

export const validateAndParseScheduleCSV = (
	csvText: string,
	teams: Team[],
	maxDayAlreadyPlayed: number,
	// Games already played this season, kept by the import
	completed: Schedule,
	rules: { allStarGameAllowed: boolean; tradeDeadlineAllowed: boolean },
): Schedule => {
	const parsed = csvParse(csvText);

	const teamsByAbbrev = groupByUnique(teams, (t) => t.seasonAttrs.abbrev);

	const teamColumns = parsed.columns.slice(1).map((abbrev) => abbrev.trim());
	if (!teamColumns[0]) {
		throw new Error("No team columns found");
	}
	for (const abbrev of teamColumns) {
		if (!teamsByAbbrev[abbrev]) {
			throw new Error(
				`Unknown abbrev in header: "${abbrev}". Available teams: ${teams.map((t) => t.seasonAttrs.abbrev).join(", ")}`,
			);
		}
	}
	const duplicateAbbrevs = findDuplicates(teamColumns);
	if (duplicateAbbrevs.size > 0) {
		const array = Array.from(duplicateAbbrevs);
		throw new Error(`Duplicate abbrevs in header: ${array.join(", ")}`);
	}

	const gamesByDay = new Map<number, { away: Team; home: Team }[]>();
	const teamsByDay = new Map<number, Set<number>>();
	const specials: Extract<
		Schedule[number],
		{ type: "allStarGame" | "tradeDeadline" }
	>[] = [];

	for (const row of parsed) {
		if (!parsed.columns[0]) {
			continue;
		}
		const dayStr = row[parsed.columns[0]];
		if (!dayStr) {
			continue;
		}

		const day = Number.parseInt(dayStr);
		if (Number.isNaN(day)) {
			throw new Error(`Invalid day "${dayStr}". Must be a number.`);
		}
		if (day <= maxDayAlreadyPlayed) {
			throw new Error(
				`Day ${day} has already been played. Cannot upload schedules for days <= ${maxDayAlreadyPlayed}.`,
			);
		}

		const firstCell = row[teamColumns[0]]?.trim();
		if (
			firstCell === ALL_STAR_GAME_LABEL ||
			firstCell === TRADE_DEADLINE_LABEL
		) {
			for (const abbrev of teamColumns.slice(1)) {
				if (row[abbrev]?.trim()) {
					throw new Error(`${firstCell} must be the only entry on day ${day}`);
				}
			}
			specials.push(
				firstCell === ALL_STAR_GAME_LABEL
					? { type: "allStarGame", day, homeTid: -1, awayTid: -2 }
					: { type: "tradeDeadline", day, homeTid: -3, awayTid: -3 },
			);
			continue;
		}

		const dayGames = gamesByDay.getOrInsertComputed(day, () => []);
		const teamsOnDay = teamsByDay.getOrInsertComputed(day, () => new Set());

		for (const colAbbrev of teamColumns) {
			const cellAbbrev = row[colAbbrev]?.trim();
			if (!cellAbbrev) {
				continue;
			}

			const colTeam = teamsByAbbrev[colAbbrev]!;

			const cellTeam = teamsByAbbrev[cellAbbrev];
			if (!cellTeam) {
				throw new Error(
					`Unknown opponent "${cellAbbrev}" for ${colAbbrev} on day ${day}`,
				);
			}
			if (colTeam.tid === cellTeam.tid) {
				throw new Error(`${colAbbrev} cannot play itself on day ${day}`);
			}
			// Both teams of the game: the column team hosts, the cell team visits
			if (teamsOnDay.has(cellTeam.tid)) {
				throw new Error(`${cellAbbrev} has multiple games on day ${day}`);
			}
			if (teamsOnDay.has(colTeam.tid)) {
				throw new Error(`${colAbbrev} has multiple games on day ${day}`);
			}

			teamsOnDay.add(cellTeam.tid);
			teamsOnDay.add(colTeam.tid);

			dayGames.push({
				away: cellTeam,
				home: colTeam,
			});
		}
	}

	const newSchedule: Schedule = [...specials];
	for (const [day, dayGames] of gamesByDay) {
		for (const { away, home } of dayGames.values()) {
			newSchedule.push({
				type: "game",
				day,
				awayTid: away.tid,
				awayAbbrev: away.seasonAttrs.abbrev,
				homeTid: home.tid,
				homeAbbrev: home.seasonAttrs.abbrev,
			});
		}
	}

	// The checks across rows (a team twice on a day, counting the games already played; special days: one of each, alone on
	// its day, no deadline once it passed, no All-Star Game when it's disabled or played), the same as the save's
	// (setScheduleFromEditor), so errors show at import and not only when saving
	const errorMessage = validateEditedSchedule([...completed, ...newSchedule], {
		activeTids: new Set(teams.map((t) => t.tid)),
		...rules,
	});
	if (errorMessage !== undefined) {
		throw new Error(errorMessage);
	}

	return orderBy(newSchedule, ["day"]);
};
