import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { MoreLinks } from "../components/MoreLinks.tsx";
import type { View } from "../../common/types.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import { useLocal } from "../util/local.ts";
import { COY_KEY } from "../../common/coachExecAwards.ts";
import {
	AwardStatPicker,
	KeyStatsNote,
	keyStatCell,
	keyStatCol,
	useAwardStatCols,
} from "../components/AwardKeyStats.tsx";

// Coach of the Year and Executive of the Year (built in): winners only, no key stats
const CoachExecHistoryTable = ({
	award,
	rows,
	userTid,
}: {
	award: string;
	rows: NonNullable<View<"awardHistory">["coachExecRows"]>;
	userTid: number;
}) => {
	const coy = award === COY_KEY;
	const cols = [
		...getCols(["Season"]),
		{ title: coy ? "Coach" : "Front Office", sortType: "name" as const },
		...getCols(["Team", "Record"]),
		{ title: "Playoffs", sortType: "string" as const },
		{
			title: "Race",
			desc: "Award race of that season",
			sortSequence: [],
		},
	];
	const tableRows: DataTableRow[] = rows.map((row) => ({
		key: row.key,
		data: [
			<a href={helpers.leagueUrl(["history", row.season])}>{row.season}</a>,
			{
				value:
					row.cid !== undefined ? (
						<a href={helpers.leagueUrl(["coach", row.cid])}>{row.name}</a>
					) : row.gmid !== undefined ? (
						<a href={helpers.leagueUrl(["front_offices"])}>{row.name}</a>
					) : (
						row.name
					),
				sortValue: row.name,
				searchValue: row.name,
			},
			<a
				href={helpers.leagueUrl([
					"roster",
					`${row.abbrev}_${row.tid}`,
					row.season,
				])}
			>
				{row.abbrev}
			</a>,
			row.record,
			row.playoffs,
			<a href={helpers.leagueUrl(["award_races", row.season])}>Race</a>,
		],
		classNames: {
			"table-info": row.user || row.tid === userTid,
		},
	}));

	if (rows.length === 0) {
		return <p>This award has not been given yet.</p>;
	}

	return (
		<DataTable
			cols={cols}
			defaultSort={[0, "desc"]}
			defaultStickyCols={window.mobile ? 0 : 1}
			name={`AwardHistory${award}`}
			pagination
			rows={tableRows}
		/>
	);
};

const AwardHistory = ({
	award,
	awardName,
	awardOptions,
	coachExecRows,
	formulaChanged,
	keyStats,
	mip,
	numTeams,
	playoffSeries,
	rows,
}: View<"awardHistory">) => {
	useTitleBar({
		title: "Award History",
		dropdown:
			award !== undefined
				? {
						fields: [{ key: "award", options: awardOptions, value: award }],
						view: "awardHistory",
					}
				: undefined,
	});

	const { userTid } = useLocal(["userTid"]);
	const [showAll, setShowAll] = useState(false);
	const statCols = useAwardStatCols(award ?? "", keyStats, award !== undefined);

	if (award === undefined) {
		return (
			<>
				<MoreLinks type="awards" page="award_history" />
				<p>No awards have been given yet.</p>
			</>
		);
	}

	if (coachExecRows) {
		return (
			<>
				<MoreLinks type="awards" page="award_history" />
				<p className="text-body-secondary">
					{award === COY_KEY
						? "The best head coach of each season, scored by the Coach of the Year formula in Award Settings."
						: "The best front office of each season (an AI team's general manager, or you), scored by the Executive of the Year formula in Award Settings."}
				</p>
				<CoachExecHistoryTable
					award={award}
					rows={coachExecRows}
					userTid={userTid}
				/>
			</>
		);
	}

	const stats = statCols.stats.filter((stat) => stat !== "score");
	const shownRows = showAll ? rows : rows.filter((row) => row.rank === 1);
	const hasGroups = shownRows.some((row) => row.groupName !== undefined);
	const hasScore =
		playoffSeries && shownRows.some((row) => row.score !== undefined);
	const anyFinalists = rows.some((row) => row.rank > 1);

	const cols = [
		...getCols(["Season"]),
		...(showAll
			? getCols(["#"], {
					"#": numTeams !== undefined ? { desc: "Team" } : { desc: "Finish" },
				})
			: []),
		...(hasGroups
			? [
					{
						title: playoffSeries ? "Series" : "Group",
						sortType: "string" as const,
					},
				]
			: []),
		...getCols(["Name", "Pos", "Age", "Team", "Record"]),
		...stats.map((stat) => keyStatCol(stat, keyStats)),
		...(hasScore ? getCols(["stat:score"]) : []),
		{
			title: "Race",
			desc: "Award race of that season",
			sortSequence: [],
		},
	];

	const tableRows: DataTableRow<"player">[] = shownRows.map((row) => {
		return {
			key: row.key,
			metadata: {
				type: "player",
				pid: row.pid,
				season: row.season,
				playoffs: "regularSeason",
			},
			data: [
				<a href={helpers.leagueUrl(["history", row.season])}>{row.season}</a>,
				...(showAll ? [row.rank] : []),
				...(hasGroups ? [row.groupName] : []),
				wrappedPlayerNameLabels({
					pid: row.pid,
					season: row.season,
					defaultWatch: row.watch,
					firstName: row.firstName,
					lastName: row.lastName,
				}),
				row.pos,
				row.age,
				<a
					href={helpers.leagueUrl([
						"roster",
						`${row.abbrev}_${row.tid}`,
						row.season,
					])}
				>
					{row.abbrev}
				</a>,
				row.record,
				...stats.map((stat) =>
					keyStatCell(
						row.stats[stat],
						stat,
						mip && stat !== "keyStats" ? row.prevStats?.[stat] : undefined,
					),
				),
				...(hasScore ? [keyStatCell(row.score, "score")] : []),
				<a href={helpers.leagueUrl(["award_races", row.season])}>Race</a>,
			],
			classNames: {
				"table-danger": row.hof,
				"table-info": row.tid === userTid,
			},
		};
	});

	return (
		<>
			<MoreLinks type="awards" page="award_history" />

			<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
				<AwardStatPicker
					awardName={awardName ?? award}
					keyStats={keyStats}
					statCols={statCols}
				/>
				{anyFinalists ? (
					<div className="btn-group btn-group-sm">
						<button
							className={`btn ${showAll ? "btn-light-bordered" : "btn-primary"}`}
							type="button"
							onClick={() => {
								setShowAll(false);
							}}
						>
							{numTeams !== undefined ? "First team" : "Winners"}
						</button>
						<button
							className={`btn ${showAll ? "btn-primary" : "btn-light-bordered"}`}
							type="button"
							onClick={() => {
								setShowAll(true);
							}}
						>
							{numTeams !== undefined ? "All teams" : "Top finishers"}
						</button>
					</div>
				) : null}
			</div>

			{mip ? (
				<p className="text-body-secondary small mb-2">
					Changes in parentheses are from the season before.
				</p>
			) : null}

			{rows.length === 0 ? (
				<p>This award has not been given yet.</p>
			) : (
				<DataTable
					cols={cols}
					defaultSort={[0, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name={`AwardHistory${award}`}
					pagination
					rows={tableRows}
				/>
			)}

			<KeyStatsNote
				keyStats={keyStats}
				who={showAll ? "these players" : "the players listed"}
			/>
			{formulaChanged ? (
				<p className="small text-body-secondary">
					This award's formula changed over time. Each season is compared using
					the formula it had then.
				</p>
			) : null}
			{playoffSeries ? (
				<p className="small text-body-secondary">
					Series stats are only kept for the stats saved with the award, so
					other stats show a dash.
				</p>
			) : null}
		</>
	);
};

export default AwardHistory;
