import { useState } from "react";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { dropdownOptions } from "../hooks/useDropdownOptions.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { PlusMinus } from "../components/PlusMinus.tsx";
import type { View } from "../../common/types.ts";
import { LINEUPS_FINAL } from "../../common/advStats.ts";

// Advanced Tracking Stats: a team-season's five-man lineups and its players' on/off numbers

const fmt1 = (x: number | undefined) => (x === undefined ? "" : x.toFixed(1));

const num = (x: number | undefined) => ({
	value: fmt1(x),
	sortValue: x ?? -Infinity,
});

const pm = (x: number | undefined, decimals = 1) => ({
	value:
		x === undefined ? "" : <PlusMinus decimalPlaces={decimals}>{x}</PlusMinus>,
	sortValue: x ?? -Infinity,
});

const Lineups = ({
	lineups,
	numPlayers,
	onOff,
	playoffs,
	season,
	team,
	tid,
}: View<"lineups">) => {
	useTitleBar({
		title: "Lineups",
		dropdown: {
			fields: [
				{ key: "team", options: { type: "teams" }, value: tid },
				{ key: "season", options: { type: "seasons" }, value: season },
				{
					key: "playoffs",
					options: dropdownOptions.playoffs,
					value: playoffs,
				},
			],
			view: "lineups",
		},
	});

	const [minMinutes, setMinMinutes] = useState(10);

	const lineupCols = [
		{ title: "Lineup", sortType: "string" as const },
		{
			title: "MP",
			desc: "Minutes played together",
			sortType: "number" as const,
		},
		{
			title: "Poss",
			desc: "Offensive possessions",
			sortType: "number" as const,
		},
		{
			title: "ORtg",
			desc: "Points per 100 possessions",
			sortType: "number" as const,
		},
		{
			title: "DRtg",
			desc: "Opponents' points per 100 possessions",
			sortType: "number" as const,
			sortSequence: ["asc", "desc"] as ("asc" | "desc")[],
		},
		{ title: "Net", desc: "Net rating", sortType: "number" as const },
		{ title: "+/-", desc: "Plus/minus", sortType: "number" as const },
	];

	const lineupRows: DataTableRow[] = lineups
		.filter((row) => row.min >= minMinutes)
		.map((row) => ({
			key: row.key,
			data: [
				{
					value: (
						<span className="text-wrap">
							{row.players.map((p, i) => (
								<span key={p.pid} className="text-nowrap">
									{i > 0 ? ", " : ""}
									<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
									{p.pos ? (
										<span className="text-body-secondary"> {p.pos}</span>
									) : null}
								</span>
							))}
						</span>
					),
					sortValue: row.players.map((p) => p.name).join(", "),
					searchValue: row.players.map((p) => p.name).join(" "),
				},
				num(row.min),
				row.possFor,
				num(row.ortg),
				num(row.drtg),
				pm(row.net),
				pm(row.pm, 0),
			],
		}));

	const onOffCols = [
		{ title: "Name", sortType: "string" as const },
		{ title: "Pos", sortType: "string" as const },
		{ title: "G", sortType: "number" as const },
		{ title: "MP", sortType: "number" as const },
		{
			title: "On ORtg",
			desc: "Team points per 100 possessions with him on the floor",
			sortType: "number" as const,
		},
		{
			title: "On DRtg",
			desc: "Opponents' points per 100 possessions with him on the floor",
			sortType: "number" as const,
			sortSequence: ["asc", "desc"] as ("asc" | "desc")[],
		},
		{ title: "On Net", sortType: "number" as const },
		{
			title: "Off Net",
			desc: "Team net rating with him off the floor, in the games he played",
			sortType: "number" as const,
		},
		{ title: "On-Off", sortType: "number" as const },
		{
			title: "Rim Deter",
			desc: "Opponents' rim attempts per 100 possessions with him on minus off (negative: he deters drives)",
			sortType: "number" as const,
			sortSequence: ["asc", "desc"] as ("asc" | "desc")[],
		},
	];

	const onOffRows: DataTableRow[] = onOff.map((p) => ({
		key: p.pid,
		data: [
			{
				value: <a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>,
				sortValue: p.name,
			},
			p.pos,
			p.gp,
			{ value: Math.round(p.min), sortValue: p.min },
			num(p.onOrtg),
			num(p.onDrtg),
			pm(p.onNet),
			pm(p.offNet),
			pm(p.onOffNet),
			pm(p.rimDeter),
		],
	}));

	return (
		<>
			<p>
				Five-man lineups and on/off numbers from the game sim's tracking
				(Advanced Tracking Stats). Ratings are per 100 possessions. Only the
				most used {numPlayers}-man lineups of each team-season are kept (the top{" "}
				{LINEUPS_FINAL} by minutes after the playoffs).
			</p>
			{team ? (
				<p>
					Team: ORtg {fmt1(team.ortg)}, DRtg {fmt1(team.drtg)}, net{" "}
					<PlusMinus decimalPlaces={1}>{team.net ?? 0}</PlusMinus>; clutch{" "}
					{Math.round(team.clMin)} min,{" "}
					<PlusMinus decimalPlaces={0}>{team.clPm}</PlusMinus>.
				</p>
			) : (
				<p>No tracking stats for this team and season.</p>
			)}

			<h2 className="mt-3">Lineups</h2>
			<div className="d-flex align-items-center gap-2 mb-2">
				<label htmlFor="lineups-min-minutes" className="form-label mb-0">
					Minimum minutes
				</label>
				<input
					id="lineups-min-minutes"
					type="number"
					className="form-control form-control-sm"
					style={{ width: 90 }}
					min={0}
					value={minMinutes}
					onChange={(event) => {
						const value = Number(event.target.value);
						setMinMinutes(Number.isFinite(value) ? value : 0);
					}}
				/>
			</div>
			<DataTable
				cols={lineupCols}
				defaultSort={[1, "desc"]}
				name="Lineups"
				rows={lineupRows}
				nonfluid
			/>

			<h2 className="mt-4">On/Off</h2>
			<DataTable
				cols={onOffCols}
				defaultSort={[3, "desc"]}
				name="LineupsOnOff"
				rows={onOffRows}
				nonfluid
			/>
		</>
	);
};

export default Lineups;
