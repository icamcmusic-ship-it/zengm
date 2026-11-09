import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";

const SeriesRecaps = ({ recaps, season, selected }: View<"seriesRecaps">) => {
	useTitleBar({
		title: "Series Recaps",
		dropdown: {
			fields: [{ key: "season", options: { type: "seasons" }, value: season }],
			view: "seriesRecaps",
		},
	});
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const abbrev = (tid: number) => teamInfoCache[tid]?.abbrev ?? `${tid}`;
	const url = (key: string) =>
		helpers.leagueUrl(["series_recaps", season, key]);

	if (recaps.length === 0) {
		return <p>No playoff series have been played in {season} yet.</p>;
	}

	const rounds = [...new Set(recaps.map((r) => r.round))].sort((a, b) => b - a);

	return (
		<div className="row">
			<div className="col-lg-4 mb-3">
				{rounds.map((ri) => (
					<div key={ri} className="mb-2">
						<h2 className="h6 mb-1">
							{recaps.find((r) => r.round === ri)!.roundName}
						</h2>
						<ul className="list-unstyled mb-0">
							{recaps
								.filter((r) => r.round === ri)
								.map((r) => (
									<li key={r.key}>
										<a
											href={url(r.key)}
											className={
												selected?.key === r.key ? "fw-bold" : undefined
											}
										>
											{abbrev(r.winner.tid)} {r.winner.won}-{r.loser.won}{" "}
											{abbrev(r.loser.tid)}
										</a>
										{r.upset ? (
											<span className="badge text-bg-warning ms-1">Upset</span>
										) : null}
										{r.comeback && r.comeback[1] - r.comeback[0] >= 2 ? (
											<span className="badge text-bg-info ms-1">Comeback</span>
										) : null}
										{!r.complete ? (
											<span className="badge text-bg-secondary ms-1">
												In progress
											</span>
										) : null}
									</li>
								))}
						</ul>
					</div>
				))}
			</div>
			{selected ? (
				<div className="col-lg-8" data-testid="series-recap">
					<h2 className="h4">{selected.headline}</h2>
					<div className="text-body-secondary mb-2">
						{season} {selected.roundName}
					</div>
					{selected.text.map((line, i) => (
						<p key={i} className="mb-1">
							{line}
						</p>
					))}

					{selected.games.length > 0 ? (
						<>
							<h3 className="h5 mt-3">Game by game</h3>
							<table className="table table-sm table-striped">
								<thead>
									<tr>
										<th>Game</th>
										<th>Away</th>
										<th>Home</th>
										<th>Winner</th>
										<th>Series</th>
									</tr>
								</thead>
								<tbody>
									{selected.games.map((gm) => (
										<tr key={gm.gid}>
											<td>
												<a
													href={helpers.leagueUrl([
														"game_log",
														`${abbrev(gm.homeTid)}_${gm.homeTid}`,
														season,
														gm.gid,
													])}
												>
													{gm.no}
												</a>
											</td>
											<td>
												{abbrev(gm.awayTid)} {gm.awayPts}
											</td>
											<td>
												{abbrev(gm.homeTid)} {gm.homePts}
											</td>
											<td>
												{abbrev(gm.winTid)} by {gm.margin}
												{gm.overtimes > 0
													? ` (${gm.overtimes > 1 ? gm.overtimes : ""}OT)`
													: ""}
											</td>
											<td>
												{abbrev(selected.winner.tid)} {gm.wWins}-{gm.lWins}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</>
					) : (
						<p className="text-body-secondary">
							No box scores are stored for this series.
						</p>
					)}

					{selected.turningPoints.length > 0 ? (
						<>
							<h3 className="h5">Turning points</h3>
							<ul>
								{selected.turningPoints.map((tp, i) => (
									<li key={i}>{tp.text}</li>
								))}
							</ul>
						</>
					) : null}

					{selected.leaders.length > 0 ? (
						<>
							<h3 className="h5">
								Series leaders
								{selected.mvp ? (
									<span className="ms-2 badge text-bg-success">
										Series MVP: {selected.mvp.name}
									</span>
								) : null}
							</h3>
							<table className="table table-sm table-striped">
								<thead>
									<tr>
										<th>Player</th>
										<th>Team</th>
										<th>GP</th>
										<th>PTS</th>
										<th>TRB</th>
										<th>AST</th>
										<th title="Game score per game">GmSc</th>
									</tr>
								</thead>
								<tbody>
									{selected.leaders.map((p) => (
										<tr key={p.pid}>
											<td>
												<a href={helpers.leagueUrl(["player", p.pid])}>
													{p.name}
												</a>
											</td>
											<td>{abbrev(p.tid)}</td>
											<td>{p.gp}</td>
											<td>{p.pts}</td>
											<td>{p.trb}</td>
											<td>{p.ast}</td>
											<td>{p.gmsc}</td>
										</tr>
									))}
								</tbody>
							</table>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
};

export default SeriesRecaps;
