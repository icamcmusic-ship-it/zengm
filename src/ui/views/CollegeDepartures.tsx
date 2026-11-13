// College mode: the pro draft, transfers and signings of a season (docs/college-mode.md)
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";
import {
	CLASS_NAMES,
	SeasonSelect,
	Stars,
	TeamName,
} from "./College/common.tsx";

const PlayerLink = ({ pid, name }: { pid: number; name: string }) => (
	<a href={helpers.leagueUrl(["player", pid])}>{name}</a>
);

const CollegeDepartures = ({
	commits,
	graduated,
	proDraft,
	season,
	seasons,
	teams,
	transfers,
	userTid,
}: View<"collegeDepartures">) => {
	useTitleBar({ title: "Departures & Arrivals" });
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);

	return (
		<>
			<SeasonSelect
				page="college_departures"
				season={season}
				seasons={seasons}
			/>
			{proDraft.length === 0 &&
			transfers.length === 0 &&
			commits.length === 0 ? (
				<p>
					Nothing yet for {season}. After the season, seniors graduate and the
					best players are taken in the pro draft; then the transfer portal
					opens and the recruits sign.
				</p>
			) : null}
			{proDraft.length > 0 ? (
				<>
					<h2>Pro draft</h2>
					<p>
						{proDraft.length} players were drafted
						{graduated !== undefined
							? `, ${graduated} other seniors graduated`
							: ""}
						.
					</p>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped table-hover"
							style={{ maxWidth: 720 }}
						>
							<thead>
								<tr>
									<th>Pick</th>
									<th>Player</th>
									<th>Pos</th>
									<th>Class</th>
									<th>Age</th>
									<th>School</th>
									{challengeNoRatings ? null : (
										<>
											<th className="text-end">Ovr</th>
											<th className="text-end">Pot</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{proDraft.map((p) => (
									<tr
										key={p.pid}
										className={p.tid === userTid ? "table-info" : undefined}
									>
										<td>{p.pick}</td>
										<td className="text-nowrap">
											<PlayerLink pid={p.pid} name={p.name} />
										</td>
										<td>{p.pos}</td>
										<td>{CLASS_NAMES[p.classYear]}</td>
										<td>{p.age}</td>
										<td className="text-nowrap">
											<TeamName
												teams={teams}
												tid={p.tid}
												season={season}
												userTid={userTid}
											/>
										</td>
										{challengeNoRatings ? null : (
											<>
												<td className="text-end">{p.ovr}</td>
												<td className="text-end">{p.pot}</td>
											</>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
			{transfers.length > 0 ? (
				<>
					<h2>Transfer portal</h2>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped table-hover"
							style={{ maxWidth: 720 }}
						>
							<thead>
								<tr>
									<th>Player</th>
									<th>Pos</th>
									<th>Class</th>
									<th>From</th>
									<th>To</th>
									{challengeNoRatings ? null : (
										<th className="text-end">Ovr</th>
									)}
								</tr>
							</thead>
							<tbody>
								{transfers.map((p) => (
									<tr
										key={p.pid}
										className={
											p.tid === userTid || p.toTid === userTid
												? "table-info"
												: undefined
										}
									>
										<td className="text-nowrap">
											<PlayerLink pid={p.pid} name={p.name} />
										</td>
										<td>{p.pos}</td>
										<td>{CLASS_NAMES[p.classYear]}</td>
										<td className="text-nowrap">
											<TeamName
												teams={teams}
												tid={p.tid}
												season={season}
												userTid={userTid}
											/>
										</td>
										<td className="text-nowrap">
											{p.toTid !== undefined ? (
												<TeamName
													teams={teams}
													tid={p.toTid}
													season={season}
													userTid={userTid}
												/>
											) : null}
										</td>
										{challengeNoRatings ? null : (
											<td className="text-end">{p.ovr}</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
			{commits.length > 0 ? (
				<>
					<h2>Signing day</h2>
					<p className="text-body-secondary small">
						The top 150 recruits, every 4 and 5 star recruit and your school's
						class.
					</p>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped table-hover"
							style={{ maxWidth: 720 }}
						>
							<thead>
								<tr>
									<th>Rk</th>
									<th>Player</th>
									<th>Stars</th>
									<th>Pos</th>
									<th>From</th>
									<th>School</th>
								</tr>
							</thead>
							<tbody>
								{[...commits]
									.sort((a, b) => a.rank - b.rank)
									.map((p) => (
										<tr
											key={p.pid}
											className={p.tid === userTid ? "table-info" : undefined}
										>
											<td>{p.rank}</td>
											<td className="text-nowrap">
												<PlayerLink pid={p.pid} name={p.name} />
											</td>
											<td>
												<Stars stars={p.stars} />
											</td>
											<td>{p.pos}</td>
											<td className="text-nowrap">{p.state}</td>
											<td className="text-nowrap">
												<TeamName
													teams={teams}
													tid={p.tid}
													season={season}
													userTid={userTid}
												/>
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
		</>
	);
};

export default CollegeDepartures;
