import { DataTable } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { ERA_KEYS, ERA_KEY_NAMES } from "../../common/leagueEras.ts";

const LeagueEras = ({ rows }: View<"leagueEras">) => {
	useTitleBar({ title: "League Eras" });

	const cols = [
		{ title: "Season", sortSequence: ["desc", "asc"], sortType: "number" },
		{ title: "Era" },
		...ERA_KEYS.map((key) => ({
			title: ERA_KEY_NAMES[key],
			sortSequence: ["desc", "asc"],
			sortType: "number",
		})),
		{
			title: "3PA%",
			desc: "Share of shots that were threes",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
		{
			title: "Poss",
			desc: "Possessions per team game",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
		{ title: "Rule Change Vote" },
	] as any[];

	const dataRows = rows.map((row) => ({
		key: row.season,
		classNames: row.current ? "table-info" : undefined,
		data: [
			row.season,
			`${row.label}${row.scheduled ? " (real history)" : ""}${row.current ? " (current)" : ""}`,
			...ERA_KEYS.map((key) =>
				key === "pace"
					? row.values[key].toFixed(1)
					: row.values[key].toFixed(3),
			),
			row.tpShare === undefined ? null : `${(row.tpShare * 100).toFixed(1)}%`,
			row.poss === undefined ? null : row.poss.toFixed(1),
			row.vote
				? `${row.vote.title}: ${row.vote.passed ? "passed" : "failed"} ${row.vote.yes}-${row.vote.no}${row.vote.userVote === undefined ? "" : ` (you: ${row.vote.userVote ? "yes" : "no"})`}`
				: null,
		],
	}));

	return (
		<>
			<p>
				The league's style of play each season. Each offseason the style takes a
				small random step, pulled back toward normal and toward what the best
				teams did. Values are the game simulation settings (1 is normal for the
				factors, 100 for pace).
			</p>
			<DataTable
				cols={cols}
				defaultSort={[0, "desc"]}
				name="LeagueEras"
				pagination={dataRows.length > 100}
				rows={dataRows}
			/>
		</>
	);
};

export default LeagueEras;
