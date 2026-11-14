import { MoreLinks } from "../components/MoreLinks.tsx";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { GroupDot } from "../components/Archetype/ArchetypeLabel.tsx";
import { ArchetypeTuningPanel } from "../components/Archetype/ArchetypeTuningPanel.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { GROUPS, GROUP_INFO } from "../../common/archetypes/index.ts";
import type { View } from "../../common/types.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const Archetypes = ({ byGroup, rows, season, total }: View<"archetypes">) => {
	useTitleBar({ title: "Archetype Landscape" });
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);

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
				// (other names for the same archetype are not shown, but a search finds them)
				searchValue: [r.name, ...r.aliases].join(" "),
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
										{challengeNoRatings ? p.abbrev : `${p.ovr} ${p.abbrev}`}
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
				A player gets the one archetype whose shape is most similar to his game:
				his ratings, mostly relative to his own level (so the same archetype
				fits a bench player and a star; the tier says which), partly his
				standing among players at his position, and his stats from last season
				when he played real minutes, at the positions the archetype is played
				at. It is saved at the start of every preseason, so a player's label
				holds for the season. Prospects and players without a saved label show a
				live reading. {total} players in {season}.
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

			<ArchetypeTuningPanel />

			<DataTable
				cols={cols}
				defaultSort={[2, "desc"]}
				name="Archetypes"
				rows={tableRows}
				nonfluid
			/>
		</>
	);
};

export default Archetypes;
