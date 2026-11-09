import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import { RivalryBadge } from "../Rivalries.tsx";

// The team's top rivals by rivalry score (Rivalries feature)
export const Rivals = ({
	rivals,
}: {
	rivals: {
		key: string;
		tid: number;
		score: number;
		tier: string;
		seriesWon: number;
		seriesLost: number;
		finals: number;
	}[];
}) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	return (
		<ul className="list-unstyled mb-0" data-testid="team-rivals">
			{rivals.map((r) => {
				const t = teamInfoCache[r.tid];
				return (
					<li key={r.key} className="mb-1">
						<a href={helpers.leagueUrl(["rivalries", r.key])}>
							{t ? `${t.region} ${t.name}` : `Team ${r.tid}`}
						</a>{" "}
						<RivalryBadge score={r.score} tier={r.tier} />
						{r.seriesWon + r.seriesLost > 0 ? (
							<span className="text-body-secondary ms-2">
								playoff series {r.seriesWon}-{r.seriesLost}
								{r.finals > 0 ? `, ${r.finals} Finals` : ""}
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
};
