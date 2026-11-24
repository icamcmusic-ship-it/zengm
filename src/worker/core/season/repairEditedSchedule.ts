import { createScheduleEditor } from "./scheduleEditor.ts";

// The 3-in-4 repair of the realistic schedule builder (a local search over single games, scheduleEditor.ts)
const REPAIR_WINDOW = 12;

type EditorGame = {
	day: number;
	type: string;
	homeTid?: number;
	awayTid?: number;
	marquee?: string;
};

// Schedule editor's "Auto-repair 3-in-4s": moves upcoming games to nearby days to remove 3 games in 4 nights, like the schedule
// builder's repair pass. Completed games, the days already played, events (and the All-Star break) and Marquee Games' holiday
// games stay where they are, and holiday days get no more games. The schedule must be valid (validateEditedSchedule): no team
// twice on a day. Returns the games (the same objects, or copies with a new day) sorted by day, and how many moved.
export const repairEditedScheduleThreeInFour = <T extends EditorGame>(
	schedule: readonly T[],
) => {
	const games = schedule.filter(
		(game) =>
			game.type !== "placeholder" &&
			game.homeTid !== undefined &&
			game.awayTid !== undefined,
	);
	const placeholders = schedule.filter((game) => !games.includes(game));

	const editor = createScheduleEditor(
		games.map((game) => [game.homeTid!, game.awayTid!] as const),
		games.map((game) => game.day),
	);

	let lastCompletedDay = 0;
	for (const [i, game] of games.entries()) {
		if (game.type === "completed") {
			editor.pinned.add(i);
			lastCompletedDay = Math.max(lastCompletedDay, game.day);
		} else if (
			game.marquee !== undefined &&
			game.marquee !== "nationalTv" &&
			game.homeTid! >= 0
		) {
			editor.pinned.add(i);
			editor.dayCap.set(game.day, editor.gamesPerDay[game.day]!);
		}
	}
	for (let day = 1; day <= lastCompletedDay; day++) {
		editor.blocked[day] = 1;
	}

	editor.repairThreeInFour(REPAIR_WINDOW);

	let numMoved = 0;
	const repaired = games.map((game, i) => {
		const day = editor.gameDays[i]!;
		if (day === game.day) {
			return game;
		}
		numMoved += 1;
		return { ...game, day };
	});

	return {
		numMoved,
		schedule: [...repaired, ...placeholders].sort((a, b) => a.day - b.day),
	};
};
