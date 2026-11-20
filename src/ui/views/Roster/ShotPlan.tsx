import { toWorker } from "../../util/toWorker.ts";
import type { View } from "../../../common/types.ts";
import { showNotification } from "../../util/showNotification.ts";
import type { CSSProperties } from "react";

type Player = View<"roster">["players"][number];

// Shot Share Model: the game plan for a player on the user's team (a bounded multiplier on his share of the team's shots)
export const shotPlans: {
	shotPlan: -1 | 0 | 1;
	style: CSSProperties;
	text: string;
	title: string;
}[] = [
	{
		shotPlan: -1,
		style: {
			backgroundColor: "#ffc107",
			color: "#000",
		},
		text: "-",
		title: "Fewer shots",
	},
	{
		shotPlan: 0,
		style: {
			backgroundColor: "rgb(204, 204, 204)",
			color: "#000",
		},
		text: " ",
		title: "Normal",
	},
	{
		shotPlan: 1,
		style: {
			backgroundColor: "#17a2b8",
			color: "#fff",
		},
		text: "+",
		title: "More shots",
	},
];

const ShotPlan = ({ p, userTid }: { p: Player; userTid: number }) => {
	const value = (p as { shotPlan?: number }).shotPlan ?? 0;
	const info = shotPlans.find((x) => x.shotPlan === value) ?? shotPlans[1]!;

	return (
		<select
			className="form-select pt-modifier-select"
			value={info.shotPlan}
			onChange={async (event) => {
				const shotPlan = Number(event.currentTarget.value);

				// Never AI teams
				if (p.tid !== userTid) {
					return;
				}

				try {
					await toWorker("main", "updateShotPlan", {
						pid: p.pid,
						shotPlan,
					});
				} catch (error) {
					showNotification({
						type: "error",
						text: `Error updating the game plan: ${error.message}`,
					});
					throw error;
				}
			}}
			style={info.style}
			aria-label="Game plan: shots"
		>
			{shotPlans.map(({ text, shotPlan, title }) => {
				return (
					<option key={shotPlan} value={shotPlan} aria-label={title}>
						{text}
					</option>
				);
			})}
		</select>
	);
};

export default ShotPlan;
