import { g, helpers, logEvent } from "../../util/index.ts";
import { playerLink, teamLink } from "../contract/options.ts";
import type { Conditions, Player } from "../../../common/types.ts";

// League discipline for technical and flagrant fouls (basketball, with the technicalFouls setting), like the NBA's: technicals and
// flagrant points add up over the regular season, with fines and automatic suspensions at thresholds. A suspension is a number of his
// team's games he sits out (game/loadTeams.ts treats him like an injured player, game/writePlayerStats.ts counts the games down).
// Bookkeeping only: nothing here draws a random number.

// The 16th technical of the regular season is a one game suspension, and every second one after it another
export const TECH_SUSPENSION_FIRST = 16;
export const TECH_SUSPENSION_EVERY = 2;
// Flagrant points: 1 for a flagrant 1, 2 for a flagrant 2. Reaching 6 is a one game suspension, every 2 more another
export const FLAGRANT_SUSPENSION_FIRST = 6;
export const FLAGRANT_SUSPENSION_EVERY = 2;
// A warning in the news as a player closes in on the technical foul suspension
export const TECH_WARNING = TECH_SUSPENSION_FIRST - 4;

// Fines in dollars for a league with a $140.588M cap (the NBA's 2024-25), scaled to the league's cap and rounded to $100
const NBA_CAP_THOUSANDS = 140588;
export const scaleFine = (dollars: number, salaryCap: number) =>
	Math.max(
		100,
		Math.round((dollars * salaryCap) / NBA_CAP_THOUSANDS / 100) * 100,
	);
// The fine for his nth technical of the season, the NBA's schedule
export const techFine = (n: number) =>
	n <= 5 ? 2000 : n <= 10 ? 3000 : n <= 15 ? 4000 : 5000;
export const FLAGRANT2_FINE = 35000;

export type Discipline = NonNullable<Player["discipline"]>;

// How many games a new total earns him, given the old one (0 or more)
export const suspensionGames = (
	before: number,
	after: number,
	first: number,
	every: number,
) => {
	const count = (x: number) =>
		x < first ? 0 : 1 + Math.floor((x - first) / every);
	return Math.max(0, count(after) - count(before));
};

export const isSuspended = (
	p: Pick<Player, "discipline">,
	season: number = g.get("season"),
) =>
	!!p.discipline &&
	p.discipline.season === season &&
	(p.discipline.suspension ?? 0) > 0;

const current = (p: Player, season: number): Discipline => {
	if (!p.discipline || p.discipline.season !== season) {
		p.discipline = { season, tf: 0, fp: 0, fines: 0 };
	}
	return p.discipline;
};

// He sat out one of his team's games: one fewer left. Returns whether anything changed
export const serveSuspensionGame = (p: Player) => {
	if (!isSuspended(p)) {
		return false;
	}
	p.discipline!.suspension! -= 1;
	p.discipline!.served = (p.discipline!.served ?? 0) + 1;
	return true;
};

// After a regular season game: his technicals (tf) and flagrant points (fp) from it. Returns whether p changed
export const recordDiscipline = async (
	p: Player,
	game: { tf: number; fp: number; flagrant2: number },
	conditions?: Conditions,
) => {
	if (game.tf <= 0 && game.fp <= 0) {
		return false;
	}
	const season = g.get("season");
	const salaryCap = g.get("salaryCap");
	const d = current(p, season);

	let fine = 0;
	for (let i = 1; i <= game.tf; i++) {
		fine += scaleFine(techFine(d.tf + i), salaryCap);
	}
	fine += game.flagrant2 * scaleFine(FLAGRANT2_FINE, salaryCap);

	const tfBefore = d.tf;
	const fpBefore = d.fp;
	d.tf += game.tf;
	d.fp += game.fp;
	d.fines += fine;

	const techGames = suspensionGames(
		tfBefore,
		d.tf,
		TECH_SUSPENSION_FIRST,
		TECH_SUSPENSION_EVERY,
	);
	const flagrantGames = suspensionGames(
		fpBefore,
		d.fp,
		FLAGRANT_SUSPENSION_FIRST,
		FLAGRANT_SUSPENSION_EVERY,
	);
	const games = techGames + flagrantGames;
	if (games > 0) {
		d.suspension = (d.suspension ?? 0) + games;
	}

	if (p.tid < 0) {
		return true;
	}
	const userTids: number[] = g.get("userTids");
	const showNotification = userTids.includes(p.tid);
	const fined = `He has been fined ${helpers.formatCurrency(d.fines, "", 0)} this season.`;
	const gamesText = `${games} ${helpers.plural("game", games)}`;
	if (games > 0) {
		const why =
			techGames > 0 && flagrantGames > 0
				? `his ${helpers.ordinal(d.tf)} technical foul and ${d.fp} flagrant foul points`
				: techGames > 0
					? `his ${helpers.ordinal(d.tf)} technical foul of the season`
					: `reaching ${d.fp} flagrant foul points this season`;
		await logEvent(
			{
				type: "discipline",
				text: `${playerLink(p)} of the ${teamLink(p.tid)} has been suspended ${gamesText} for ${why}. ${fined}`,
				pids: [p.pid],
				tids: [p.tid],
				score: 10,
				showNotification,
			},
			conditions,
		);
	} else if (game.flagrant2 > 0) {
		await logEvent(
			{
				type: "discipline",
				text: `${playerLink(p)} of the ${teamLink(p.tid)} has been fined ${helpers.formatCurrency(scaleFine(FLAGRANT2_FINE, salaryCap), "", 0)} for his flagrant 2 foul. He has ${d.fp} flagrant foul points this season.`,
				pids: [p.pid],
				tids: [p.tid],
				score: 0,
				showNotification: false,
			},
			conditions,
		);
	} else if (tfBefore < TECH_WARNING && d.tf >= TECH_WARNING) {
		const left = TECH_SUSPENSION_FIRST - d.tf;
		await logEvent(
			{
				type: "discipline",
				text: `Hothead watch: ${playerLink(p)} of the ${teamLink(p.tid)} has ${d.tf} technical fouls this season, ${left} away from an automatic suspension. ${fined}`,
				pids: [p.pid],
				tids: [p.tid],
				score: 0,
				showNotification,
			},
			conditions,
		);
	}
	return true;
};
