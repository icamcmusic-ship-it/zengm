import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import {
	DataTable,
	type DataTableRow,
} from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { frivolitiesMenu } from "../Frivolities.tsx";
import { PlayerLink } from "./common.tsx";
import { cmpNumber } from "../../../common/leagueHistory/jerseyNumbers.ts";

const span = (first: number, last: number) =>
	first === last ? `${first}` : `${first}-${last}`;

const JerseyNumbersTeams = ({
	bar,
	candidates,
	knownRows,
	numbers,
	numCandidates,
	retired,
	teams,
	tid,
	unknownRows,
	valueStat,
}: View<"jerseyNumbersTeams">) => {
	const team = teams.find((t) => t.tid === tid);
	useTitleBar({
		title: team
			? `Jersey Numbers: ${team.region} ${team.name}`
			: "Jersey Numbers by Team",
		customMenu: frivolitiesMenu,
	});
	const abbrevOf = (t: number) =>
		teams.find((x) => x.tid === t)?.abbrev ?? "???";
	const teamLink = (t: number) => (
		<a
			href={helpers.leagueUrl([
				"frivolities",
				"jersey_numbers",
				"teams",
				`${abbrevOf(t)}_${t}`,
			])}
		>
			{abbrevOf(t)}
		</a>
	);
	const numberSort = (n: string) => {
		const x = /^\d+$/.test(n) ? Number(n) : 1000;
		return x + n.length / 1000;
	};

	const numberCols = getCols([
		{ title: "#", desc: "Jersey number", sortType: "number" },
		{
			title: "Best",
			desc: "Best player to wear it for this team",
			sortType: "name",
		},
		{
			title: valueStat,
			desc: `${valueStat} wearing this number for this team`,
			sortType: "number",
		},
		{
			title: "Years",
			desc: "His seasons in it (sorted by how many)",
			sortType: "number",
		},
		{ title: "Also Wore It", sortType: "string" },
		{ title: "Wearers", sortType: "number" },
		{
			title: "Seasons",
			desc: "Player seasons in this number",
			sortType: "number",
		},
		{ title: "Retired", sortType: "string" },
	]);
	const numberRows: DataTableRow[] = numbers.map((x) => {
		const best = x.top[0]!;
		return {
			key: x.number,
			data: [
				{
					value: <b>{x.number}</b>,
					sortValue: numberSort(x.number),
					searchValue: x.number,
				},
				{
					value: <PlayerLink pid={best.pid} name={best.name} />,
					sortValue: best.name,
					searchValue: best.name,
				},
				best.value.toFixed(1),
				{ value: span(best.first, best.last), sortValue: best.seasons },
				x.top.slice(1).map((s, i) => (
					<span key={s.pid}>
						{i > 0 ? ", " : ""}
						<PlayerLink pid={s.pid} name={s.name} />{" "}
						<span className="small text-body-secondary">
							{s.value.toFixed(1)}
						</span>
					</span>
				)),
				x.wearers,
				x.seasons,
				x.retired ? "Yes" : "",
			],
			classNames: { "table-warning": x.retired },
		};
	});

	const retiredCols = getCols([
		{ title: "Team", sortType: "string" },
		{ title: "#", sortType: "number" },
		{ title: "Honoree", sortType: "name" },
		{ title: "Retired", desc: "Season retired", sortType: "number" },
		{
			title: valueStat,
			desc: `${valueStat} wearing the number for this team`,
			sortType: "number",
		},
		{
			title: "Yrs",
			desc: "Seasons in the number for this team",
			sortType: "number",
		},
	]);
	const retiredRows: DataTableRow[] = retired.map((r, i) => ({
		key: i,
		data: [
			{ value: teamLink(r.tid), sortValue: abbrevOf(r.tid) },
			{ value: r.number, sortValue: numberSort(r.number) },
			{
				value:
					r.pid !== null ? (
						<PlayerLink pid={r.pid} name={r.name} />
					) : (
						r.name || "–"
					),
				sortValue: r.name,
				searchValue: r.name,
			},
			r.seasonRetired,
			{
				value:
					r.value !== null ? (
						r.value.toFixed(1)
					) : (
						<span
							className="text-body-secondary"
							title={
								r.wore === false
									? "No stats on file in this number for this team"
									: "Not a player in this league"
							}
						>
							–
						</span>
					),
				sortValue: r.value,
			},
			{ value: r.seasons ?? "–", sortValue: r.seasons },
		],
		classNames: { "table-info": r.tid === tid },
	}));

	const candCols = getCols([
		{ title: "Team", sortType: "string" },
		{ title: "#", sortType: "number" },
		"Name",
		{
			title: valueStat,
			desc: `${valueStat} in the number for this team`,
			sortType: "number",
		},
		{ title: "Yrs", sortType: "number" },
		{ title: "Seasons", sortType: "string" },
		{
			title: "AS",
			desc: "All-Star seasons with this team",
			sortType: "number",
		},
		{ title: "Status", sortType: "string" },
	]);
	const candRows: DataTableRow[] = candidates.map((c) => ({
		key: `${c.tid}-${c.number}-${c.pid}`,
		data: [
			{ value: teamLink(c.tid), sortValue: abbrevOf(c.tid) },
			{ value: c.number, sortValue: numberSort(c.number) },
			{
				value: (
					<>
						<PlayerLink pid={c.pid} name={c.name} />
						{c.hof ? <span className="badge bg-danger ms-1">HOF</span> : null}
					</>
				),
				sortValue: c.name,
				searchValue: c.name,
			},
			c.value.toFixed(1),
			c.seasons,
			span(c.first, c.last),
			c.allStar,
			c.stillHere ? "Still on team" : c.active ? "Active elsewhere" : "Retired",
		],
		classNames: { "table-info": c.tid === tid },
	}));

	const sortedTeams = [...teams].sort((a, b) =>
		`${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`),
	);
	const teamRetired = retired
		.filter((r) => r.tid === tid)
		.sort((a, b) => cmpNumber(a.number, b.number));

	return (
		<>
			<p>
				The best player to wear each number for each team, every retired number
				with what its honoree did in it, and the numbers that look due to be
				retired. More:{" "}
				<a
					href={helpers.leagueUrl([
						"frivolities",
						"most",
						"retired_jersey_numbers",
					])}
				>
					Most Retired Jersey Numbers
				</a>
			</p>

			<div className="d-flex align-items-center gap-2 mb-3">
				<label htmlFor="jn-team" className="mb-0">
					Team
				</label>
				<select
					id="jn-team"
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					value={tid}
					onChange={(event) => {
						const t = Number(event.target.value);
						realtimeUpdate(
							[],
							helpers.leagueUrl([
								"frivolities",
								"jersey_numbers",
								"teams",
								`${abbrevOf(t)}_${t}`,
							]),
						);
					}}
				>
					{sortedTeams.map((t) => (
						<option key={t.tid} value={t.tid}>
							{t.region} {t.name}
							{t.disabled ? " (inactive)" : ""}
						</option>
					))}
				</select>
			</div>

			{teamRetired.length > 0 ? (
				<p>
					<b>Retired:</b>{" "}
					{teamRetired.map((r, i) => (
						<span key={i}>
							{i > 0 ? ", " : ""}#{r.number}{" "}
							{r.pid !== null ? (
								<PlayerLink pid={r.pid} name={r.name} />
							) : (
								r.name
							)}
						</span>
					))}
				</p>
			) : (
				<p className="text-body-secondary">
					This team hasn't retired a number.
				</p>
			)}

			{numberRows.length > 0 ? (
				<DataTable
					key={tid}
					cols={numberCols}
					defaultSort={[0, "asc"]}
					name="JerseyNumbersTeam"
					pagination={numberRows.length > 40}
					rows={numberRows}
					small
				/>
			) : (
				<p>No player has a jersey number on file for this team yet.</p>
			)}
			{unknownRows > 0 ? (
				<p className="small text-body-secondary">
					{unknownRows} of {knownRows + unknownRows} player seasons have no
					jersey number on file and are left out (unknown, not a number).
				</p>
			) : null}

			<h2 className="mt-4">Numbers to retire</h2>
			<p className="small text-body-secondary">
				Players with {bar}+ {valueStat} and 3+ seasons in one number for one
				team, whose number that team hasn't retired (and who hasn't been honored
				by it). The bar is the median of what honorees produced in their
				numbers, or {bar} until enough numbers are retired.
				{numCandidates > candidates.length
					? ` Showing the top ${candidates.length} of ${numCandidates}.`
					: ""}
			</p>
			{candRows.length > 0 ? (
				<DataTable
					cols={candCols}
					defaultSort={[3, "desc"]}
					name="JerseyNumbersCandidates"
					pagination={candRows.length > 20}
					rows={candRows}
					small
				/>
			) : (
				<p>Nobody qualifies yet.</p>
			)}

			<h2 className="mt-4">Retired numbers, all teams</h2>
			{retiredRows.length > 0 ? (
				<DataTable
					cols={retiredCols}
					defaultSort={[3, "desc"]}
					name="JerseyNumbersRetired"
					pagination={retiredRows.length > 20}
					rows={retiredRows}
					small
				/>
			) : (
				<p>No team has retired a number yet.</p>
			)}
		</>
	);
};

export default JerseyNumbersTeams;
