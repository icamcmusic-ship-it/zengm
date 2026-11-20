// Coach of the Year and Executive of the Year race tables (League Extra coachExecAwards), for Award Races and the Award Settings preview
import type { ReactNode } from "react";
import {
	COACH_EXEC_VARIABLE_DOCS,
	COY_VARIABLES,
	EOY_VARIABLES,
	type CoyVariable,
	type EoyVariable,
} from "../../common/coachExecAwards.ts";
import type { CoachExecRace } from "../../worker/core/awards/coachExecAwards.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { DataTable, type Col, type DataTableRow } from "./DataTable/index.tsx";

// Win probability, as shown in the award race tables (see worker/core/seasonOdds/awardOdds.ts)
export const formatProb = (prob: number) => {
	if (prob <= 0) {
		return "0%";
	}
	if (prob >= 1) {
		return "100%";
	}
	if (prob < 0.01) {
		return "<1%";
	}
	if (prob > 0.99) {
		return ">99%";
	}
	return `${Math.round(100 * prob)}%`;
};

export const COACH_EXEC_VARIABLE_LABELS: Record<
	CoyVariable | EoyVariable,
	string
> = {
	winp: "Pct",
	prevWinp: "Prev",
	expWinp: "Exp",
	rosterWinp: "Roster",
	mov: "MOV",
	playoffRoundsWon: "PRW",
	injuryRate: "Inj",
	movesWS: "MovesWS",
	payrollEff: "PayEff",
};

const WINP_VARIABLES = new Set<string>([
	"winp",
	"prevWinp",
	"expWinp",
	"rosterWinp",
]);

export const formatCoachExecVariable = (key: string, value: number) => {
	if (WINP_VARIABLES.has(key)) {
		return helpers.roundWinp(value);
	}
	if (key === "playoffRoundsWon") {
		return value < 0 ? "-" : String(value);
	}
	if (key === "injuryRate" || key === "payrollEff") {
		return value.toFixed(2);
	}
	return value.toFixed(1);
};

export const coachExecVariableCols = (keys: readonly string[]): Col[] =>
	keys.map((key) => ({
		title: COACH_EXEC_VARIABLE_LABELS[key as CoyVariable] ?? key,
		desc: `${key}: ${COACH_EXEC_VARIABLE_DOCS[key as CoyVariable] ?? ""}`,
		sortSequence: ["desc", "asc"],
		sortType: "number",
	}));

export const CoachExecRaceTable = ({
	race,
	season,
	title,
}: {
	race: CoachExecRace;
	season: number;
	title?: ReactNode;
}) => {
	const { userTid } = useLocal(["userTid"]);
	const variables: readonly string[] =
		race.kind === "coy" ? COY_VARIABLES : EOY_VARIABLES;
	const hasOdds = race.candidates.some((c) => c.odds !== undefined);

	const cols: Col[] = [
		{ title: "#", sortSequence: ["asc", "desc"], sortType: "number" },
		{
			title: race.kind === "coy" ? "Coach" : "Front Office",
			sortType: "name",
		},
		{ title: "Team", sortType: "string" },
		{ title: "Record", sortType: "record" },
		...coachExecVariableCols(variables),
		{
			title: "Score",
			desc: `Award score, from the formula: ${race.formula}`,
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
	];
	if (hasOdds) {
		cols.push({
			title: "Win%",
			desc: "Chance to win, projecting award scores to the end of the regular season",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		});
	}

	const rows: DataTableRow[] = race.candidates.map((c, i) => {
		const winner = race.winnerId === c.id;
		const name =
			race.kind === "coy" ? (
				<a href={helpers.leagueUrl(["coach", c.id])}>{c.name}</a>
			) : "gmid" in c && c.gmid !== undefined ? (
				<a href={helpers.leagueUrl(["front_offices"])}>{c.name}</a>
			) : (
				c.name
			);
		return {
			key: c.id,
			data: [
				i + 1,
				{
					value: (
						<>
							{name}
							{winner ? (
								<span className="ms-1 badge bg-success">Winner</span>
							) : null}
						</>
					),
					sortValue: c.name,
					searchValue: c.name,
				},
				<a href={helpers.leagueUrl(["roster", `${c.abbrev}_${c.tid}`, season])}>
					{c.abbrev}
				</a>,
				helpers.formatRecord(c),
				...variables.map((key) => {
					const value = (c.vars as Record<string, number>)[key] ?? 0;
					return {
						value: formatCoachExecVariable(key, value),
						sortValue: value,
					};
				}),
				{
					value: Number.isFinite(c.score) ? c.score.toFixed(3) : "-",
					sortValue: Number.isFinite(c.score) ? c.score : null,
				},
				...(hasOdds
					? [
							{
								value: formatProb(c.odds ?? 0),
								sortValue: c.odds ?? 0,
							},
						]
					: []),
			],
			classNames: {
				"table-info": c.tid === userTid,
			},
		};
	});

	const titleNode = title ?? <h2>{race.name}</h2>;

	if (rows.length === 0) {
		return (
			<>
				{titleNode}
				<p className="mt-2">No candidates yet...</p>
			</>
		);
	}

	return (
		<DataTable
			classNameWrapper="mb-1"
			cols={cols}
			defaultSort={[0, "asc"]}
			defaultStickyCols={window.mobile ? 0 : 2}
			hideAllControls
			name={`AwardRaces${race.key}`}
			rows={rows}
			title={titleNode}
		/>
	);
};
