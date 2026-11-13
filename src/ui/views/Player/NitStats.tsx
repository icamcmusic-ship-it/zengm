import { DataTable } from "../../components/DataTable/index.tsx";
import HideableSection from "../../components/HideableSection.tsx";
import { wrappedTeamAbbrevLink } from "../../components/TeamAbbrevLink.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { helpers } from "../../util/helpers.ts";

const STATS = [
	"gp",
	"min",
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"fgp",
	"tpp",
	"ftp",
] as const;

/**
 * College mode: his NIT games, apart from the national tournament's postseason stats (per game).
 */
export const NitStats = ({ player }: { player: View<"player">["player"] }) => {
	const rows = player.nitStats;
	if (rows.length === 0) {
		return null;
	}
	return (
		<HideableSection title="NIT">
			<DataTable
				className="mb-3"
				cols={getCols(["Year", "Team", ...STATS.map((stat) => `stat:${stat}`)])}
				defaultSort={[0, "asc"]}
				hideAllControls
				name="Player:NIT"
				rows={rows.map((row, i) => ({
					key: i,
					data: [
						row.season,
						wrappedTeamAbbrevLink({
							abbrev: row.abbrev,
							season: row.season,
							tid: row.tid,
						}),
						...STATS.map((stat) => helpers.roundStat(row[stat], stat)),
					],
				}))}
			/>
		</HideableSection>
	);
};
