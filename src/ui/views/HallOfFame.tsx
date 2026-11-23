import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import type { View } from "../../common/types.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";
import { useLocal } from "../util/local.ts";
import { HallOfFamePlaques } from "./HallOfFamePlaques.tsx";
import { HallOfFameSpeeches } from "./HallOfFameSpeeches.tsx";
import { useIsCollege } from "../util/collegeMode.ts";
import HideableSection from "../components/HideableSection.tsx";

const HallOfFame = ({
	ballotOn,
	players,
	plaques,
	stats,
	wing,
	words,
}: View<"hallOfFame">) => {
	useTitleBar({ title: "Hall of Fame" });
	const { userTid } = useLocal(["userTid"]);
	const college = useIsCollege();

	if (college) {
		return (
			<p>
				College leagues have no Hall of Fame. Players leave for the pros or
				graduate rather than retire, so nobody is ever inducted.
			</p>
		);
	}

	const wingRows: DataTableRow[] = wing.map((row) => ({
		key: `${row.kind}${row.id}`,
		data: [
			row.kind === "coach" ? (
				<a href={helpers.leagueUrl(["coach", row.id])}>{row.name}</a>
			) : (
				<a href={helpers.leagueUrl(["front_offices"])}>{row.name}</a>
			),
			row.kind === "coach" ? "Coach" : "Executive",
			row.inducted,
			row.retiredYear ?? null,
			row.tid >= 0 && row.abbrev ? (
				<a
					href={helpers.leagueUrl(["team_history", `${row.abbrev}_${row.tid}`])}
				>
					{row.abbrev}
				</a>
			) : null,
			row.won,
			row.lost,
			row.titles,
			row.awards,
		],
	}));

	const superCols = [
		{
			title: "",
			colspan: 10,
		},
		{
			title: "Best Season",
			colspan: 2 + stats.length,
		},
		{
			title: "Career Stats",
			colspan: stats.length,
		},
	];

	const cols = getCols([
		"Name",
		"Pos",
		"Drafted",
		"Retired",
		{
			title: "Inducted",
			desc: "Season inducted",
			sortType: "number",
		},
		{
			title: "Vote",
			desc: "Hall of Fame ballot: year on the ballot and share of the vote when he got in",
			sortType: "string",
		},
		"Pick",
		"Peak Ovr",
		"MVP",
		"Titles",
		"Year",
		"Team",
		...stats.map((stat) => `stat:${stat}`),
		...stats.map((stat) => `stat:${stat}`),
	]);

	const rows: DataTableRow<"player">[] = players.map((p) => {
		// No pro stats (bestStats falls back to his career stats, which have no season or team): no best season to show
		const bestSeason: number | undefined = p.bestStats?.season;
		const hasBestTeam =
			bestSeason !== undefined &&
			typeof p.bestStats.tid === "number" &&
			p.bestStats.tid >= 0 &&
			p.bestStats.abbrev !== undefined;
		return {
			key: p.pid,
			metadata: {
				type: "player",
				pid: p.pid,
				season: "career",
				playoffs: "regularSeason",
			},
			data: [
				wrappedPlayerNameLabels({
					pid: p.pid,
					firstName: p.firstName,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
				}),
				p.bestPos,
				p.draft.year,
				p.retiredYear,
				p.inducted ?? null,
				p.ballot ?? null,
				p.draft.round > 0 ? `${p.draft.round}-${p.draft.pick}` : "",
				p.peakOvr,
				p.countMvp,
				p.countTitles,
				bestSeason ?? null,
				hasBestTeam ? (
					<a
						href={helpers.leagueUrl([
							"roster",
							`${p.bestStats.abbrev}_${p.bestStats.tid}`,
							bestSeason,
						])}
					>
						{p.bestStats.abbrev}
					</a>
				) : null,
				...stats.map((stat) =>
					bestSeason !== undefined
						? helpers.roundStat(p.bestStats[stat], stat)
						: null,
				),
				...stats.map((stat) =>
					p.careerStats?.[stat] !== undefined
						? helpers.roundStat(p.careerStats[stat], stat)
						: null,
				),
			],
			classNames: {
				"table-danger": p.legacyTid === userTid,
				"table-info":
					p.statsTids.slice(0, p.statsTids.length - 1).includes(userTid) &&
					p.legacyTid !== userTid,
				"table-success":
					p.statsTids.at(-1) === userTid && p.legacyTid !== userTid,
			},
		};
	});

	return (
		<>
			<p>
				Players are eligible to be inducted into the Hall of Fame after they
				retire{ballotOn ? " and are voted in on the Hall of Fame ballot" : ""}.
				The score behind it is very similar to{" "}
				<a href="http://espn.go.com/nba/story/_/id/8736873/nba-experts-rebuild-springfield-hall-fame-espn-magazine">
					the method described in this article
				</a>
				. Hall of Famers who played for your team are{" "}
				<span className="text-info">highlighted in blue</span>. Hall of Famers
				who retired with your team are{" "}
				<span className="text-success">highlighted in green</span>. Hall of
				Famers who played most of their career with your team are{" "}
				<span className="text-danger">highlighted in red</span>.
			</p>

			<HallOfFamePlaques plaques={plaques} />

			<HallOfFameSpeeches words={words} />

			<DataTable
				cols={cols}
				defaultSort={[cols.length - 2, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name="HallOfFame"
				pagination
				rows={rows}
				superCols={superCols}
			/>

			{wing.length > 0 ? (
				<HideableSection
					title="Coaches and executives"
					className="mt-3"
					pageName="hallOfFame"
				>
					<p>
						Head coaches (wins, titles, Coach of the Year awards, playoff trips)
						and general managers (titles, Executive of the Year awards, winning
						over their careers) are inducted
						{ballotOn
							? " once they have been retired for the waiting period"
							: " when they retire"}
						, if their case clears the bar.
					</p>
					<DataTable
						cols={wingCols}
						defaultSort={[2, "desc"]}
						name="HallOfFameWing"
						rows={wingRows}
					/>
				</HideableSection>
			) : null}
		</>
	);
};

const wingCols = [
	{ title: "Name", sortType: "name" as const },
	{ title: "Role", sortType: "string" as const },
	{ title: "Inducted", sortType: "number" as const },
	{ title: "Retired", sortType: "number" as const },
	{
		title: "Team",
		desc: "Team with the most seasons",
		sortType: "string" as const,
	},
	{ title: "W", desc: "Wins", sortType: "number" as const },
	{ title: "L", desc: "Losses", sortType: "number" as const },
	{ title: "Titles", sortType: "number" as const },
	{
		title: "Awards",
		desc: "Coach of the Year / Executive of the Year",
		sortType: "number" as const,
	},
];

export default HallOfFame;
