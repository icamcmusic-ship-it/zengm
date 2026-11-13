import type { MarqueeKind } from "../../../common/marquee.ts";

type TaggedGame = {
	gid?: number;
	homeTid: number;
	awayTid: number;
	day: number;
	marquee?: MarqueeKind;
	rivalry?: boolean;
};

const HOLIDAYS = new Set<MarqueeKind | undefined>([
	"openingNight",
	"christmas",
	"mlk",
]);

/**
 * Marquee Games: the schedule editor keeps each game's tags when the user edits it. A game whose teams were changed is not the
 * matchup it was tagged for (no national TV, holiday or rivalry tag), and a holiday game moved off its holiday's day (the day most
 * of that holiday's games are on, so adding or deleting a day before it moves the whole slate with it) is no longer a holiday game.
 * Mutates and returns the games.
 */
export const fixEditedScheduleTags = <T extends TaggedGame>(
	games: T[],
	before: readonly TaggedGame[],
) => {
	const beforeByGid = new Map(
		before.flatMap((game) =>
			game.gid === undefined ? [] : [[game.gid, game] as const],
		),
	);
	for (const game of games) {
		if (game.marquee === undefined && !game.rivalry) {
			continue;
		}
		const old = game.gid === undefined ? undefined : beforeByGid.get(game.gid);
		const sameTeams =
			old !== undefined &&
			((old.homeTid === game.homeTid && old.awayTid === game.awayTid) ||
				(old.homeTid === game.awayTid && old.awayTid === game.homeTid));
		if (!sameTeams) {
			delete game.marquee;
			delete game.rivalry;
		}
	}

	const daysByHoliday = new Map<MarqueeKind, Map<number, number>>();
	for (const game of games) {
		if (game.marquee !== undefined && HOLIDAYS.has(game.marquee)) {
			const counts = daysByHoliday.get(game.marquee) ?? new Map();
			counts.set(game.day, (counts.get(game.day) ?? 0) + 1);
			daysByHoliday.set(game.marquee, counts);
		}
	}
	for (const game of games) {
		if (game.marquee === undefined || !HOLIDAYS.has(game.marquee)) {
			continue;
		}
		const counts = [...daysByHoliday.get(game.marquee)!].sort(
			(a, b) => b[1] - a[1] || a[0] - b[0],
		);
		if (game.day !== counts[0]![0]) {
			delete game.marquee;
		}
	}
	return games;
};
