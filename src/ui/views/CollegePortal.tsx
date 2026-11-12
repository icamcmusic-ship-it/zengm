// College mode: the transfer portal (docs/college-mode.md)
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import type { View } from "../../common/types.ts";
import { TeamName } from "./College/common.tsx";
import { RecruitBoard, RecruitingHeader } from "./College/RecruitBoard.tsx";

const CollegePortal = ({
	after,
	autoRecruit,
	offerLimit,
	offers,
	open,
	openSpots,
	players,
	season,
	state,
	teams,
	transfers,
	userTid,
	weeksLeft,
}: View<"collegePortal">) => {
	useTitleBar({ title: "Transfer Portal" });
	const userAbbrev = teams[userTid]?.abbrev ?? "You";
	const own = players.filter((p) => p.from === userTid);

	return (
		<>
			{open ? (
				<>
					<p>
						The portal is open for {weeksLeft} more week
						{weeksLeft === 1 ? "" : "s"}. Recruit players from other schools
						with the same points as high school recruits: they commit (and join
						your roster) once your offer is past the red line and ahead of the
						others. Your own players in the portal ({own.length}) can be kept
						with a <b>retention pitch</b>. When the window closes, whoever is
						left picks a school with a spot, goes back to his school if it has
						room, or leaves. A player can transfer once without sitting out:
						players who already transferred do not enter the portal again.
					</p>
					<RecruitingHeader
						autoRecruit={autoRecruit}
						offerLimit={offerLimit}
						offers={offers}
						openSpots={openSpots}
						state={state}
					>
						{weeksLeft > 0 ? (
							<button
								type="button"
								className="btn btn-sm btn-primary"
								onClick={async () => {
									await toWorker(
										"main",
										"collegeAdvanceRecruitingWeek",
										undefined,
									);
								}}
							>
								Next portal week ({weeksLeft} left)
							</button>
						) : null}
					</RecruitingHeader>
					<RecruitBoard
						rows={players}
						canEdit
						autoRecruit={autoRecruit}
						userAbbrev={userAbbrev}
						extraColumns={[
							{
								title: "From",
								render: (r) => (
									<TeamName
										teams={teams}
										tid={r.from}
										season={season}
										userTid={userTid}
									/>
								),
							},
							{ title: "Yr", render: (r) => r.classYear },
						]}
						retain={(r) => r.from === userTid}
						emptyText="Nobody left in the portal."
					/>
				</>
			) : (
				<p>
					{after
						? "The transfer portal is closed for this year."
						: "The transfer portal opens after the season (the Transfer portal phase, after departures)."}
				</p>
			)}
			{transfers.length > 0 ? (
				<>
					<h2>Transfers this year</h2>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped"
							style={{ maxWidth: 640 }}
						>
							<thead>
								<tr>
									<th>Player</th>
									<th>Pos</th>
									<th className="text-end">Ovr</th>
									<th>From</th>
									<th>To</th>
								</tr>
							</thead>
							<tbody>
								{transfers.map((t) => (
									<tr
										key={t.pid}
										className={
											t.tid === userTid || t.toTid === userTid
												? "table-info"
												: undefined
										}
									>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["player", t.pid])}>
												{t.name}
											</a>
										</td>
										<td>{t.pos}</td>
										<td className="text-end">{t.ovr}</td>
										<td className="text-nowrap">
											<TeamName
												teams={teams}
												tid={t.tid}
												season={season}
												userTid={userTid}
											/>
										</td>
										<td className="text-nowrap">
											{t.toTid !== undefined ? (
												<TeamName
													teams={teams}
													tid={t.toTid}
													season={season}
													userTid={userTid}
												/>
											) : null}
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

export default CollegePortal;
