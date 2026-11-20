import { defineChart, dot, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useState } from "react";
import type { View } from "../../common/types.ts";
import { LINE_CURVE } from "./Message/OwnerMoodsChart.tsx";

type Team = View<"powerRankings">["teams"][number];

export const RankChange = ({ change }: { change: number | undefined }) => {
	if (change === undefined) {
		return null;
	}
	if (change > 0) {
		return (
			<span
				className="text-success ms-1"
				title={`Up ${change} since last week`}
			>
				▲{change}
			</span>
		);
	}
	if (change < 0) {
		return (
			<span
				className="text-danger ms-1"
				title={`Down ${-change} since last week`}
			>
				▼{-change}
			</span>
		);
	}
	return (
		<span
			className="text-body-secondary ms-1"
			title="No change since last week"
		>
			–
		</span>
	);
};

const PowerRankingsChart = ({
	teams,
	userTid,
}: {
	teams: Team[];
	userTid: number;
}) => {
	const [tid, setTid] = useState(userTid);

	const teamsWithHistory = teams
		.filter((t) => t.powerRankHistory.length > 0)
		.toSorted((a, b) =>
			`${a.seasonAttrs.region} ${a.seasonAttrs.name}`.localeCompare(
				`${b.seasonAttrs.region} ${b.seasonAttrs.name}`,
			),
		);
	const t =
		teamsWithHistory.find((t) => t.tid === tid) ??
		teamsWithHistory.find((t) => t.tid === userTid) ??
		teamsWithHistory[0];
	const history = t?.powerRankHistory;
	const numTeams = teams.length;

	const definition = (() => {
		const data = (history ?? []).map((row, i) => ({
			...row,
			week: i + 1,
		}));
		return defineChart({
			marks: [
				lineY(data, {
					x: "week",
					y: "rank",
					stroke: "var(--bs-primary)",
					strokeWidth: 2,
					curve: LINE_CURVE,
				}),
				dot(data, {
					x: "week",
					y: "rank",
					r: 3,
					fill: "var(--bs-white)",
					stroke: "var(--bs-primary)",
					strokeWidth: 2,
				}),
			],
			scales: {
				x: {
					scale: scaleLinear().domain([1, Math.max(2, data.length)]),
					axis: {
						label: {
							text: "Week",
						},
					},
				},
				y: {
					// Rank 1 at the top
					scale: scaleLinear().domain([numTeams, 1]),
					axis: {
						label: {
							text: "Rank",
						},
					},
				},
			},
			tooltip,
		});
	})();

	// Need at least two snapshots to show anything interesting
	if (!t || teamsWithHistory.every((t) => t.powerRankHistory.length < 2)) {
		return null;
	}

	return (
		<div className="mb-3" style={{ maxWidth: 500 }}>
			<div className="d-flex align-items-center gap-2 mb-1">
				<b>Rank over time</b>
				<select
					className="form-select form-select-sm w-auto"
					value={t.tid}
					onChange={(event) => {
						setTid(Number.parseInt(event.target.value));
					}}
				>
					{teamsWithHistory.map((t) => (
						<option key={t.tid} value={t.tid}>
							{t.seasonAttrs.region} {t.seasonAttrs.name}
						</option>
					))}
				</select>
			</div>
			<Chart
				definition={definition}
				height={200}
				initialWidth={500}
				ariaLabel="Power rank over time"
				renderTooltipBody={({ points }) => {
					const row = points[0]?.datum;
					if (!row) {
						return null;
					}
					return (
						<>
							Week {row.week}: #{row.rank}
						</>
					);
				}}
			/>
		</div>
	);
};

export default PowerRankingsChart;
