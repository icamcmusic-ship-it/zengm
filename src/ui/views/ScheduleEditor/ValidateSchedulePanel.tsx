import { useState } from "react";
import type { View } from "../../../common/types.ts";
import { DataTable } from "../../components/DataTable/index.tsx";
import { ActionButton } from "../../components/ActionButton.tsx";
import { showNotification } from "../../util/showNotification.ts";
import { toWorker } from "../../util/toWorker.ts";
import { getScheduleRestStats } from "../../../common/scheduleRestStats.ts";
import {
	getEditedScheduleRules,
	validateEditedSchedule,
} from "../../../common/validateEditedSchedule.ts";

type Schedule = View<"scheduleEditor">["schedule"];

// Checks of the edited schedule before saving: the errors the worker would refuse it for (the same validateEditedSchedule), and
// each team's rest (back-to-backs, 3 games in 4 nights, longest break, same-day conflicts) and home/away balance
export const ValidateSchedulePanel = ({
	allStarGame,
	allStarGameAlreadyHappened,
	godMode,
	onRepaired,
	phase,
	savedSchedule,
	schedule,
	teams,
	userTid,
}: {
	godMode: boolean;
	onRepaired: (schedule: Schedule) => void;
	phase: number;
	// The schedule as saved (when the editor was opened)
	savedSchedule: Schedule;
	userTid: number;
} & Pick<
	View<"scheduleEditor">,
	"allStarGame" | "allStarGameAlreadyHappened" | "schedule" | "teams"
>) => {
	const [repairing, setRepairing] = useState(false);

	const games = schedule.filter((game) => game.type !== "placeholder");
	const errorMessage = validateEditedSchedule(
		games,
		getEditedScheduleRules({
			activeTids: new Set(teams.map((t) => t.tid)),
			allStarGameAlreadyHappened,
			allStarGameSetting: allStarGame,
			phase,
			scheduleHasAllStarGame: savedSchedule.some(
				(game) => game.type === "allStarGame",
			),
		}),
	);

	const stats = getScheduleRestStats(
		games.map((game) => [game.homeTid, game.awayTid] as const),
		games.map((game) => game.day),
	);

	let numThreeInFour = 0;
	let numB2B = 0;
	let numSameDay = 0;
	for (const s of stats.values()) {
		numThreeInFour += s.threeInFour;
		numB2B += s.b2b;
		numSameDay += s.sameDay;
	}
	const numTeams = Math.max(1, stats.size);

	const cols = [
		{ title: "Team", sortType: "string" as const },
		{ title: "G", desc: "Games", sortType: "number" as const },
		{ title: "Home", sortType: "number" as const },
		{ title: "Away", sortType: "number" as const },
		{
			title: "+/-",
			desc: "Home games minus away games",
			sortType: "number" as const,
		},
		{ title: "B2B", desc: "Back-to-backs", sortType: "number" as const },
		{
			title: "3-in-4",
			desc: "3 games in 4 nights",
			sortType: "number" as const,
		},
		{
			title: "Streak",
			desc: "Most days in a row with a game",
			sortType: "number" as const,
		},
		{
			title: "Break",
			desc: "Longest stretch of days off between games",
			sortType: "number" as const,
		},
		{
			title: "Conflicts",
			desc: "Games on a day the team already plays",
			sortType: "number" as const,
		},
	];

	const rows = teams.map((t) => {
		const s = stats.get(t.tid);
		const balance = s ? s.home - s.away : 0;
		return {
			key: t.tid,
			classNames:
				s && s.sameDay > 0
					? "table-danger"
					: t.tid === userTid
						? "table-info"
						: undefined,
			data: [
				t.seasonAttrs.abbrev,
				s?.numGames ?? 0,
				s?.home ?? 0,
				s?.away ?? 0,
				{
					value: balance > 0 ? `+${balance}` : balance,
					sortValue: balance,
					classNames: Math.abs(balance) > 1 ? "text-warning" : undefined,
				},
				s?.b2b ?? 0,
				{
					value: s?.threeInFour ?? 0,
					classNames: s && s.threeInFour > 0 ? "text-warning" : undefined,
				},
				{
					value: s?.maxConsecutive ?? 0,
					classNames: s && s.maxConsecutive > 2 ? "text-danger" : undefined,
				},
				s?.maxDaysOff ?? 0,
				{
					value: s?.sameDay ?? 0,
					classNames: s && s.sameDay > 0 ? "text-danger" : undefined,
				},
			],
		};
	});

	const repair = async () => {
		setRepairing(true);
		try {
			const { numMoved, schedule: repaired } = await toWorker(
				"main",
				"repairEditedSchedule",
				schedule,
			);
			let after = 0;
			const repairedGames = repaired.filter(
				(game) => game.type !== "placeholder",
			);
			for (const s of getScheduleRestStats(
				repairedGames.map((game) => [game.homeTid, game.awayTid] as const),
				repairedGames.map((game) => game.day),
			).values()) {
				after += s.threeInFour;
			}
			if (numMoved > 0) {
				onRepaired(repaired);
			}
			showNotification({
				type: numMoved > 0 ? "success" : "info",
				text:
					numMoved > 0
						? `Moved ${numMoved} game${numMoved === 1 ? "" : "s"}: ${numThreeInFour} → ${after} 3-in-4s. Save the schedule to keep it.`
						: "No game could be moved to remove a 3-in-4 without making the schedule worse.",
			});
		} catch (error) {
			showNotification({
				type: "error",
				text: error.message,
			});
		} finally {
			setRepairing(false);
		}
	};

	return (
		<>
			{errorMessage !== undefined ? (
				<div className="alert alert-danger">
					This schedule can't be saved: {errorMessage}
				</div>
			) : (
				<div className="alert alert-success">
					No errors: this schedule can be saved.
				</div>
			)}
			<p>
				Per team: {(numB2B / numTeams).toFixed(1)} back-to-backs,{" "}
				{(numThreeInFour / numTeams).toFixed(1)} 3-in-4s
				{numSameDay > 0 ? `, ${numSameDay} same-day conflicts in total` : ""}.
			</p>
			{godMode ? (
				<ActionButton
					className="mb-3"
					disabled={numThreeInFour === 0 || errorMessage !== undefined}
					onClick={repair}
					processing={repairing}
					processingText="Repairing"
					variant="secondary"
				>
					Auto-repair 3-in-4s
				</ActionButton>
			) : null}
			<DataTable
				className="text-center"
				cols={cols}
				defaultSort={[0, "asc"]}
				hideAllControls
				name="ScheduleEditorValidate"
				rows={rows}
			/>
		</>
	);
};
