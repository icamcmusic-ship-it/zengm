import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { View } from "../../common/types.ts";
import HideableSection from "../components/HideableSection.tsx";
import { CollegeHallOfFameWatch } from "./CollegeHallOfFame.tsx";

type Row = View<"hallOfFameWatch">["active"][number];

const pct = (x: number) => `${Math.round(100 * x)}%`;

export const hofStatusText = (row: {
	status: string;
	inducted?: number;
	eligible?: number;
	years?: number;
	lastPct?: number;
}) => {
	switch (row.status) {
		case "active":
			return "Active";
		case "inducted":
			return `Inducted ${row.inducted ?? ""}`.trim();
		case "waiting":
			return `Eligible ${row.eligible}`;
		case "ballot":
			return `On ballot (${row.years} ${helpers.plural("year", row.years ?? 0)}, ${row.lastPct?.toFixed(1)}%)`;
		case "fellOff":
			return `Fell off (${row.lastPct?.toFixed(1)}%)`;
		default:
			return "Not inducted";
	}
};

const scoreCols = () => [
	{
		title: "Score",
		desc: "Hall of Fame score (career win shares and EWA plus the best 5 seasons), per 100 of the threshold",
		sortType: "number" as const,
	},
	{
		title: "Proj",
		desc: "Projected final score, per 100 of the threshold (active players: the rest of his career from his recent seasons and his age)",
		sortType: "number" as const,
	},
	{
		title: "Chance",
		desc: "Chance he makes the Hall of Fame",
		sortType: "number" as const,
	},
	{ title: "Status", sortType: "string" as const },
];

const toRows = (rows: Row[]): DataTableRow[] =>
	rows.map((row) => ({
		key: row.pid,
		data: [
			wrappedPlayerNameLabels({
				pid: row.pid,
				firstName: row.firstName,
				lastName: row.lastName,
			}),
			row.pos,
			row.age,
			row.tid >= 0 ? (
				<a href={helpers.leagueUrl(["roster", `${row.abbrev}_${row.tid}`])}>
					{row.abbrev}
				</a>
			) : null,
			{ value: Math.round(100 * row.ratio), sortValue: row.ratio },
			{ value: Math.round(100 * row.projRatio), sortValue: row.projRatio },
			{ value: pct(row.chance), sortValue: row.chance },
			hofStatusText(row),
		],
	}));

const HallOfFameWatch = ({
	active,
	ballotOn,
	college,
	retired,
	wait,
}: View<"hallOfFameWatch">) => {
	useTitleBar({
		title: college ? "College Hall of Fame Watch" : "Hall of Fame Watch",
	});

	if (college) {
		return <CollegeHallOfFameWatch college={college} />;
	}

	const cols = [...getCols(["Name", "Pos", "Age", "Team"]), ...scoreCols()];

	return (
		<>
			<p>
				Each player's Hall of Fame score against the line for induction (100 is
				exactly the line). For active players the projection adds the rest of
				his career, from his last three seasons and his age, and the chance
				allows for how uncertain that is.{" "}
				{ballotOn
					? `Retired players go on the ballot ${wait} ${helpers.plural("season", wait)} after retiring and need 75% of the vote; the chance includes the voters.`
					: "Players are inducted when they retire if their final score is over the line."}
			</p>

			<HideableSection title="Active players" className="mb-3">
				<DataTable
					cols={cols}
					defaultSort={[6, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="HallOfFameWatch"
					pagination
					rows={toRows(active)}
				/>
			</HideableSection>

			<HideableSection title="Recently retired">
				<DataTable
					cols={cols}
					defaultSort={[6, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="HallOfFameWatchRetired"
					pagination
					rows={toRows(retired)}
				/>
			</HideableSection>
		</>
	);
};

export default HallOfFameWatch;
