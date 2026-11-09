import { MoreLinks } from "../components/MoreLinks.tsx";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { GroupDot } from "../components/Archetype/ArchetypeLabel.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { GROUPS, GROUP_INFO } from "../../common/archetypes/index.ts";
import type { View } from "../../common/types.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const Archetypes = ({
	byGroup,
	rows,
	season,
	total,
	trend,
}: View<"archetypes">) => {
	useTitleBar({ title: "Archetype Landscape" });

	const cols = [
		{ title: "Archetype", sortType: "string" as const },
		{ title: "Group", sortType: "string" as const },
		{
			title: "#",
			desc: "Players with it right now",
			sortType: "number" as const,
		},
		{ title: "%", desc: "Share of the league", sortType: "number" as const },
		{
			title: "Best players",
			sortType: "string" as const,
			sortSequence: [] as ("asc" | "desc")[],
		},
	];

	const tableRows: DataTableRow[] = rows.map((r) => ({
		key: r.id,
		data: [
			{
				value: (
					<span title={r.desc}>
						<GroupDot group={r.group} />
						{r.name}
					</span>
				),
				sortValue: r.name,
				searchValue: r.name,
			},
			GROUP_INFO[r.group].label,
			r.count,
			{ value: pct(r.share), sortValue: r.share },
			{
				value:
					r.top.length > 0 ? (
						<>
							{r.top.map((p, i) => (
								<span key={p.pid}>
									{i > 0 ? ", " : ""}
									<a href={helpers.leagueUrl(["player", p.pid])}>
										{p.name}
									</a>{" "}
									<span className="text-body-secondary">
										{p.ovr} {p.abbrev}
									</span>
								</span>
							))}
						</>
					) : (
						""
					),
				sortValue: r.top[0]?.name ?? "",
				searchValue: r.top.map((p) => p.name).join(" "),
			},
		],
	}));

	return (
		<>
			<MoreLinks type="playerRatings" page="archetypes" />
			<p>
				Archetypes are derived from each player's ratings (not assigned), and
				saved at the start of every preseason, so a player's label holds for the
				season. Prospects and players without a saved label show a live reading.{" "}
				{total} players in {season}.
			</p>

			<div className="d-flex flex-wrap gap-3 mb-4">
				{GROUPS.map((g) => (
					<div key={g} className="card" style={{ minWidth: 120 }}>
						<div className="card-body p-2">
							<div className="text-body-secondary">
								<GroupDot group={g} />
								{GROUP_INFO[g].label}
							</div>
							<div className="h4 mb-0">{byGroup[g]}</div>
							<div className="text-body-secondary">
								{total > 0 ? pct(byGroup[g] / total) : ""}
							</div>
						</div>
					</div>
				))}
			</div>

			<DataTable
				cols={cols}
				defaultSort={[2, "desc"]}
				name="Archetypes"
				rows={tableRows}
				nonfluid
			/>

			<h2 className="mt-4">Trends</h2>
			{trend.length < 2 ? (
				<p className="text-body-secondary">
					Trends appear once players have saved labels from two or more
					preseasons.
				</p>
			) : (
				<div className="table-responsive">
					<table className="table table-sm table-striped w-auto">
						<thead>
							<tr>
								<th>Season</th>
								{GROUPS.map((g) => (
									<th key={g}>{GROUP_INFO[g].label}</th>
								))}
								<th>Most common</th>
							</tr>
						</thead>
						<tbody>
							{trend.map((t) => (
								<tr key={t.season}>
									<td>{t.season}</td>
									{GROUPS.map((g) => (
										<td key={g}>
											{t.total > 0 ? pct(t.groups[g] / t.total) : ""}
										</td>
									))}
									<td>
										{t.top.map((x) => `${x.name} (${x.count})`).join(", ")}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
};

export default Archetypes;
