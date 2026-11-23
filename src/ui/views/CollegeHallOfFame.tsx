// College Hall of Fame: the Hall of Fame page and its Watch tab in a college league (worker/views/collegeHallOfFame.ts)
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import HideableSection from "../components/HideableSection.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";

type HofData = NonNullable<View<"hallOfFame">["college"]>;
type WatchData = NonNullable<View<"hallOfFameWatch">["college"]>;

const Schools = ({
	schools,
}: {
	schools: { tid: number; abbrev: string; region: string }[];
}) => (
	<>
		{schools.map((s, i) => (
			<span key={s.tid}>
				{i > 0 ? ", " : null}
				<a
					href={helpers.leagueUrl(["team_history", `${s.abbrev}_${s.tid}`])}
					title={s.region}
				>
					{s.abbrev}
				</a>
			</span>
		))}
	</>
);

const schoolsSort = (schools: { abbrev: string }[]) =>
	schools.map((s) => s.abbrev).join(", ");

const years = (first: number | undefined, last: number | undefined) =>
	first === undefined ? "" : first === last ? `${first}` : `${first}-${last}`;

const exitText = (exit: string | undefined, pick: number | undefined) =>
	exit === "pro"
		? `Pro draft${pick !== undefined ? ` (#${pick})` : ""}`
		: exit === "graduated"
			? "Graduated"
			: exit === "left"
				? "Left school"
				: "";

const s = (title: string, desc?: string) => ({
	title,
	desc,
	sortType: "number" as const,
});

const playerCols = [
	{ title: "Name", sortType: "name" as const },
	{ title: "Pos", sortType: "string" as const },
	{ title: "Schools", sortType: "string" as const },
	{ title: "Years", sortType: "string" as const },
	s("Inducted", "Season inducted"),
	{ title: "Left", desc: "How he left school", sortType: "string" as const },
	{ title: "Accolades", sortType: "string" as const },
	s("Score", "College Hall of Fame score when inducted"),
	s("G", "Games played"),
	s("PTS", "Points per game"),
	s("TRB", "Rebounds per game"),
	s("AST", "Assists per game"),
	s("WS", "Win shares"),
];

const coachCols = [
	{ title: "Name", sortType: "name" as const },
	{ title: "Inducted", sortType: "number" as const },
	{ title: "Retired", sortType: "number" as const },
	{
		title: "School",
		desc: "School with the most seasons",
		sortType: "string" as const,
	},
	s("W", "Wins"),
	s("L", "Losses"),
	s("Titles", "National titles"),
	s("F4", "Final Fours"),
	s("COY", "Coach of the Year awards"),
];

export const CollegeHallOfFame = ({ college }: { college: HofData }) => {
	const { userTid } = useLocal(["userTid"]);
	const rows: DataTableRow[] = college.players.map((p) => ({
		key: p.pid,
		data: [
			wrappedPlayerNameLabels({
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
			}),
			p.pos,
			{
				value: <Schools schools={p.schools} />,
				sortValue: schoolsSort(p.schools),
				searchValue: p.schools.map((x) => `${x.abbrev} ${x.region}`).join(" "),
			},
			years(p.firstSeason, p.lastSeason),
			p.inducted,
			exitText(p.exit, p.pick),
			p.line,
			p.score,
			p.gp,
			p.pts.toFixed(1),
			p.trb.toFixed(1),
			p.ast.toFixed(1),
			p.ws.toFixed(1),
		],
		classNames: {
			"table-info": p.schools.some((x) => x.tid === userTid),
		},
	}));

	const coachRows: DataTableRow[] = college.coaches.map((c) => ({
		key: c.cid,
		data: [
			<a href={helpers.leagueUrl(["coach", c.cid])}>{c.name}</a>,
			c.inducted,
			c.retiredYear ?? null,
			c.school ? (
				<a
					href={helpers.leagueUrl([
						"team_history",
						`${c.school.abbrev}_${c.school.tid}`,
					])}
				>
					{c.school.abbrev}
				</a>
			) : null,
			c.won,
			c.lost,
			c.titles,
			c.finalFours,
			c.coy,
		],
	}));

	return (
		<>
			<p>
				Players become eligible for the College Hall of Fame {college.wait}{" "}
				{helpers.plural("season", college.wait)} after they leave school
				(graduating, turning pro or leaving the sport; a transfer to another
				school here doesn't count), and stay candidates for {college.window}{" "}
				seasons. Each season a committee inducts a class of 2 to 4 of the best
				candidates whose college career scores at least {college.min}: national
				and conference awards, win shares, national titles, Final Fours and
				tournament trips, and seasons played. Inductees who played for your
				school are <span className="text-info">highlighted in blue</span>.
			</p>
			{rows.length === 0 ? (
				<p className="text-body-secondary">
					Nobody has been inducted yet. The first class is chosen when a season
					ends, once players have been gone {college.wait} seasons.
				</p>
			) : null}
			<DataTable
				cols={playerCols}
				defaultSort={[4, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name="CollegeHallOfFame"
				pagination
				rows={rows}
			/>
			{coachRows.length > 0 ? (
				<HideableSection title="Coaches" className="mt-3" pageName="hallOfFame">
					<p>
						Head coaches are inducted {college.wait}{" "}
						{helpers.plural("season", college.wait)} after they retire, when
						their wins, national titles, Final Fours, tournament trips and Coach
						of the Year awards clear the bar.
					</p>
					<DataTable
						cols={coachCols}
						defaultSort={[1, "desc"]}
						name="CollegeHallOfFameCoaches"
						rows={coachRows}
					/>
				</HideableSection>
			) : null}
			{college.classes.length > 0 ? (
				<HideableSection title="Classes" className="mt-3" pageName="hallOfFame">
					<ul className="list-unstyled">
						{college.classes.map((c) => (
							<li key={c.season}>
								<b>{c.season}</b>: {c.players}{" "}
								{helpers.plural("player", c.players)}
								{c.coaches > 0
									? `, ${c.coaches} ${helpers.plural("coach", c.coaches)}`
									: ""}{" "}
								(class of up to {c.classSize}, {c.candidates}{" "}
								{helpers.plural("candidate", c.candidates)})
							</li>
						))}
					</ul>
				</HideableSection>
			) : null}
		</>
	);
};

const watchStatus = (row: WatchData["active"][number]) => {
	switch (row.status) {
		case "active":
			return row.classYear ? `Active (${row.classYear})` : "Active";
		case "waiting":
			return `Eligible ${row.eligible}`;
		case "candidate":
			return "Candidate";
		case "inducted":
			return `Inducted ${row.inducted}`;
		default:
			return "Not inducted";
	}
};

const watchCols = (min: number) => [
	{ title: "Name", sortType: "name" as const },
	{ title: "Pos", sortType: "string" as const },
	{ title: "Schools", sortType: "string" as const },
	s("Score", `College Hall of Fame score so far (the bar is ${min})`),
	s(
		"Proj",
		"Projected score: active players' score so far carried over the rest of their four seasons",
	),
	{ title: "Accolades", sortType: "string" as const },
	{ title: "Status", sortType: "string" as const },
];

const watchRows = (rows: WatchData["active"]): DataTableRow[] =>
	rows.map((row) => ({
		key: row.pid,
		data: [
			wrappedPlayerNameLabels({
				pid: row.pid,
				firstName: row.firstName,
				lastName: row.lastName,
			}),
			row.pos,
			{
				value: <Schools schools={row.schools} />,
				sortValue: schoolsSort(row.schools),
			},
			row.score,
			row.projected,
			row.line,
			watchStatus(row),
		],
	}));

export const CollegeHallOfFameWatch = ({ college }: { college: WatchData }) => {
	const cols = watchCols(college.min);
	return (
		<>
			<p>
				Each player's College Hall of Fame score (the bar is {college.min}).
				Players are candidates {college.wait}{" "}
				{helpers.plural("season", college.wait)} after they leave school, and
				each season's class takes 2 to 4 of the best.
			</p>
			<HideableSection title="Current players" className="mb-3">
				<DataTable
					cols={cols}
					defaultSort={[4, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="CollegeHallOfFameWatch"
					pagination
					rows={watchRows(college.active)}
				/>
			</HideableSection>
			<HideableSection title="Left school">
				<DataTable
					cols={cols}
					defaultSort={[3, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="CollegeHallOfFameWatchLeft"
					pagination
					rows={watchRows(college.retired)}
				/>
			</HideableSection>
		</>
	);
};
