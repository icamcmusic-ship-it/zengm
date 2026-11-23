import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type {
	AllStarMiniGame,
	AllStarPlayer,
	View,
} from "../../common/types.ts";

type Abbrevs = View<"allStarWeekend">["abbrevs"];

const PlayerLink = ({
	p,
	abbrevs,
}: {
	p: { pid: number; tid: number; name: string };
	abbrevs: Abbrevs;
}) => (
	<>
		<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>{" "}
		<span className="text-body-secondary">{abbrevs[p.tid] ?? ""}</span>
	</>
);

const BoxScore = ({
	abbrevs,
	game,
}: {
	abbrevs: Abbrevs;
	game: AllStarMiniGame;
}) => {
	return (
		<>
			<p>
				<b>
					{game.teamNames[0]} {game.score[0]}, {game.teamNames[1]}{" "}
					{game.score[1]}
				</b>
				{game.overtimes > 0
					? ` (${game.overtimes > 1 ? `${game.overtimes}` : ""}OT)`
					: null}
				{game.target !== undefined ? ` · first to ${game.target}` : null}
				{game.mvp ? (
					<>
						{" "}
						· MVP: <PlayerLink p={game.mvp} abbrevs={abbrevs} />
					</>
				) : null}
			</p>
			<div className="row">
				{([0, 1] as const).map((i) => (
					<div className="col-lg-6" key={i}>
						<h4>{game.teamNames[i]}</h4>
						<div className="table-responsive">
							<table className="table table-sm table-striped table-hover">
								<thead>
									<tr>
										<th>Name</th>
										<th title="Minutes">MP</th>
										<th title="Points">PTS</th>
										<th title="Rebounds">TRB</th>
										<th title="Assists">AST</th>
										<th title="Field goals">FG</th>
										<th title="Three-pointers">3P</th>
										<th title="Free throws">FT</th>
										<th title="Made shots at the rim (dunks and layups)">
											Rim
										</th>
									</tr>
								</thead>
								<tbody>
									{game.players[i].map((p) => (
										<tr key={p.pid}>
											<td>
												<PlayerLink p={p} abbrevs={abbrevs} />
											</td>
											<td>{helpers.roundStat(p.min, "min")}</td>
											<td>{p.pts}</td>
											<td>{p.trb}</td>
											<td>{p.ast}</td>
											<td>
												{p.fg}-{p.fga}
											</td>
											<td>
												{p.tp}-{p.tpa}
											</td>
											<td>
												{p.ft}-{p.fta}
											</td>
											<td>{p.rim}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				))}
			</div>
		</>
	);
};

const Roster = ({
	abbrevs,
	name,
	players,
}: {
	abbrevs: Abbrevs;
	name: string;
	players: AllStarPlayer[];
}) => (
	<div className="col-sm-6 col-lg-3 mb-3">
		<h4>{name}</h4>
		<ul className="list-unstyled mb-0">
			{players.map((p) => (
				<li key={p.pid}>
					<PlayerLink p={p} abbrevs={abbrevs} />
					{p.injured ? " (injured)" : null}
				</li>
			))}
		</ul>
	</div>
);

const selectedLabel = {
	starter: "Starter",
	reserve: "Reserve",
	replacement: "Injury replacement",
};

const AllStarWeekend = ({
	abbrevs,
	confNames,
	gid,
	mvp,
	risingStars,
	score,
	season,
	skills,
	teamNames,
	tournament,
	votes,
}: View<"allStarWeekend">) => {
	useTitleBar({
		title: "All-Star Weekend",
		dropdown: {
			fields: [{ key: "season", options: { type: "seasons" }, value: season }],
			view: "allStarWeekend",
		},
	});

	const ballots = votes
		? [...new Set(votes.map((v) => v.cid))].map((cid) => ({
				cid,
				rows: votes.filter((v) => v.cid === cid),
			}))
		: [];

	return (
		<>
			<h2>All-Star Game</h2>
			{score ? (
				<p>
					{teamNames[0]} {score[0]}, {teamNames[1]} {score[1]}
					{mvp ? (
						<>
							{" "}
							· MVP: <PlayerLink p={mvp} abbrevs={abbrevs} />
						</>
					) : null}
					{gid !== undefined ? (
						<>
							{" "}
							·{" "}
							<a href={helpers.leagueUrl(["game_log", "special", season, gid])}>
								Box score
							</a>
						</>
					) : null}
				</p>
			) : (
				<p>
					Not played yet.{" "}
					<a href={helpers.leagueUrl(["all_star", "teams", season])}>
						See the All-Star teams.
					</a>
				</p>
			)}

			{tournament ? (
				<>
					<h2>Tournament</h2>
					<p>
						Four teams, two semifinals to {tournament.targetSemis} points, and
						the winners meet in the All-Star Game to {tournament.targetFinal}.
					</p>
					<div className="row">
						{tournament.teams.map((players, i) => (
							<Roster
								key={i}
								abbrevs={abbrevs}
								name={tournament.teamNames[i]!}
								players={players}
							/>
						))}
					</div>
					{tournament.semis.map((semi, i) =>
						semi.game ? (
							<div key={i}>
								<h3>Semifinal {i + 1}</h3>
								<BoxScore abbrevs={abbrevs} game={semi.game} />
							</div>
						) : null,
					)}
				</>
			) : null}

			{risingStars ? (
				<>
					<h2>Rising Stars</h2>
					{risingStars.game ? (
						<BoxScore abbrevs={abbrevs} game={risingStars.game} />
					) : (
						<div className="row">
							{([0, 1] as const).map((i) => (
								<Roster
									key={i}
									abbrevs={abbrevs}
									name={risingStars.teamNames[i]}
									players={risingStars.teams[i]}
								/>
							))}
						</div>
					)}
				</>
			) : null}

			{skills ? (
				<>
					<h2>Skills Challenge</h2>
					<p>
						A timed course: a dribbling slalom, passing targets (a miss costs
						time), a jumper that has to go in, and a sprint to a layup. The two
						fastest run it again in the final.
						{skills.winner !== undefined ? (
							<>
								{" "}
								Winner:{" "}
								<PlayerLink
									p={skills.players[skills.winner]!}
									abbrevs={abbrevs}
								/>
							</>
						) : null}
					</p>
					{skills.rounds.map((round, i) =>
						round.runs.length > 0 ? (
							<div key={i} className="table-responsive">
								<h3>{i === 0 ? "First round" : "Final"}</h3>
								<table className="table table-sm table-striped table-hover">
									<thead>
										<tr>
											<th>Name</th>
											<th>Dribbling</th>
											<th>Passing</th>
											<th>Shooting</th>
											<th>Sprint</th>
											<th>Total</th>
										</tr>
									</thead>
									<tbody>
										{round.runs
											.toSorted((a, b) => a.time - b.time)
											.map((run) => (
												<tr key={run.index}>
													<td>
														<PlayerLink
															p={skills.players[run.index]!}
															abbrevs={abbrevs}
														/>
													</td>
													<td>{run.handle.toFixed(1)}s</td>
													<td>
														{run.pass.toFixed(1)}s
														{run.passMisses > 0
															? ` (${run.passMisses} missed)`
															: null}
													</td>
													<td>
														{run.shoot.toFixed(1)}s
														{run.shotMisses > 0
															? ` (${run.shotMisses} missed)`
															: null}
													</td>
													<td>{run.sprint.toFixed(1)}s</td>
													<td>
														<b>{run.time.toFixed(1)}s</b>
													</td>
												</tr>
											))}
									</tbody>
								</table>
							</div>
						) : null,
					)}
				</>
			) : null}

			{ballots.length > 0 ? (
				<>
					<h2>All-Star Vote</h2>
					<p>
						Starters: fans 50%, players 25%, media 25% (the weighted rank), two
						backcourt and three frontcourt players. Reserves are picked by the
						players' and media's ranks.
					</p>
					{ballots.map(({ cid, rows }) => (
						<div key={cid} className="table-responsive">
							{cid >= 0 ? <h3>{confNames[cid] ?? "Conference"}</h3> : null}
							<table className="table table-sm table-striped table-hover">
								<thead>
									<tr>
										<th>Name</th>
										<th>Court</th>
										<th>Fan votes</th>
										<th>Fan rank</th>
										<th>Player rank</th>
										<th>Media rank</th>
										<th>Selected</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => (
										<tr key={row.pid}>
											<td>
												<PlayerLink p={row} abbrevs={abbrevs} />
											</td>
											<td>
												{row.court === "backcourt" ? "Backcourt" : "Frontcourt"}
											</td>
											<td>{helpers.numberWithCommas(row.fanVotes)}</td>
											<td>{row.fanRank}</td>
											<td>{row.playerRank}</td>
											<td>{row.mediaRank}</td>
											<td>
												{row.selected ? selectedLabel[row.selected] : null}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					))}
				</>
			) : null}
		</>
	);
};

export default AllStarWeekend;
