import HideableSection from "../../components/HideableSection.tsx";
import { helpers } from "../../util/helpers.ts";
import type { ProspectNcaaSummary } from "../../../common/collegeStats/ncaa.ts";

// Same as ncaaResultText in common/collegeStats/ncaa.ts, which is not imported here to keep the college data out of the UI bundle
const ncaaResultText = (summary: ProspectNcaaSummary) =>
	summary.ncaa !== undefined
		? `${summary.ncaa === "Champion" ? "National Champion" : summary.ncaa} (seed ${summary.ncaaSeed})`
		: undefined;

const ordinal = (x: number) => helpers.ordinal(x);

/**
 * His team's college season in his draft year: record, conference finish, AP rank, conference tournament and NCAA tournament results, and his postseason games.
 */
export const CollegeSeasonSection = ({
	summary,
}: {
	summary: ProspectNcaaSummary;
}) => {
	const ncaa = ncaaResultText(summary);
	return (
		<HideableSection
			title={`${summary.season} ${summary.school}`}
			description="His team's college season before the draft. The postseason games are part of his college stats."
		>
			<ul className="list-unstyled mb-2" data-testid="college-season">
				<li>
					<b>Record:</b> {summary.w}-{summary.l} ({summary.confW}-
					{summary.confL} {summary.conf}, {ordinal(summary.confRank)} of{" "}
					{summary.confSize})
					{summary.apRank !== undefined ? `, AP #${summary.apRank}` : null}
				</li>
				<li>
					<b>{summary.conf} Tournament:</b> {summary.confTourney}
				</li>
				<li>
					<b>NCAA Tournament:</b>{" "}
					{ncaa !== undefined
						? `${ncaa}, ${summary.region} Region`
						: "Did not make the tournament"}
				</li>
				<li>
					<a
						href={helpers.leagueUrl([
							"college_overseas",
							summary.season,
							ncaa !== undefined ? "ncaa" : "standings",
						])}
					>
						See the {summary.season} college season
					</a>
				</li>
			</ul>
			{summary.games.length > 0 ? (
				<div className="table-responsive">
					<table className="table table-striped table-borderless table-sm table-nonfluid">
						<thead>
							<tr>
								<th>Round</th>
								<th>Opp</th>
								<th>Result</th>
								<th>MIN</th>
								<th>PTS</th>
								<th>TRB</th>
								<th>AST</th>
								<th>STL</th>
								<th>BLK</th>
								<th>FG</th>
								<th>3P</th>
								<th>FT</th>
							</tr>
						</thead>
						<tbody>
							{summary.games.map((game, i) => (
								<tr key={i}>
									<td className="text-nowrap">
										{game.event === "ncaa" ? "NCAA " : `${summary.conf} `}
										{game.round}
									</td>
									<td className="text-nowrap">
										{game.oppSeed !== undefined ? `(${game.oppSeed}) ` : null}
										{game.opp}
									</td>
									<td className="text-nowrap">
										{game.won ? "W" : "L"} {game.tm}-{game.oppScore}
										{game.ot > 0 ? ` ${game.ot > 1 ? game.ot : ""}OT` : null}
									</td>
									<td>{game.min}</td>
									<td>{game.pts}</td>
									<td>{game.trb}</td>
									<td>{game.ast}</td>
									<td>{game.stl}</td>
									<td>{game.blk}</td>
									<td>
										{game.fg}-{game.fga}
									</td>
									<td>
										{game.tp}-{game.tpa}
									</td>
									<td>
										{game.ft}-{game.fta}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</HideableSection>
	);
};
