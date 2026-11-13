// College mode: recruiting (board, actions, commitments, signing day results). docs/college-mode.md
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { toWorker } from "../util/toWorker.ts";
import type { View } from "../../common/types.ts";
import { SeasonSelect, Stars, TeamName } from "./College/common.tsx";
import { RecruitBoard, RecruitingHeader } from "./College/RecruitBoard.tsx";

const CollegeRecruiting = ({
	autoRecruit,
	canEdit,
	classRankings,
	commits,
	current,
	lateRecruiting,
	offerLimit,
	offers,
	openSpots,
	recruits,
	region,
	season,
	seasons,
	signed,
	signingDayPassed,
	state,
	teams,
	userPrestige,
	userTid,
	weeksLeft,
}: View<"collegeRecruiting">) => {
	useTitleBar({ title: "Recruiting" });
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	const [tab, setTab] = useState<"board" | "commits" | "results">(
		!current || signingDayPassed ? "results" : "board",
	);
	const userAbbrev = teams[userTid]?.abbrev ?? "You";
	const committed = recruits
		.filter((r) => r.commit !== undefined)
		.sort((a, b) => a.rank - b.rank);
	const userCommits = committed.filter((r) => r.commit === userTid);

	return (
		<>
			<SeasonSelect
				page="college_recruiting"
				season={season}
				seasons={seasons}
			/>
			<ul className="nav nav-tabs mb-3">
				{(
					[
						["board", "Board"],
						["commits", `Commitments (${committed.length})`],
						["results", "Signing day"],
					] as const
				).map(([key, label]) => (
					<li className="nav-item" key={key}>
						<button
							type="button"
							className={`nav-link${tab === key ? " active" : ""}`}
							onClick={() => setTab(key)}
						>
							{label}
						</button>
					</li>
				))}
			</ul>

			{tab === "board" ? (
				current && recruits.length > 0 ? (
					<>
						<p>
							{region} (prestige <b>{userPrestige}</b>) has {userCommits.length}{" "}
							commitment
							{userCommits.length === 1 ? "" : "s"}. Every week you get
							recruiting points to spend: <b>scout</b> a recruit to see what he
							wants and his real ratings, <b>contact</b> him, make a{" "}
							<b>home visit</b> or bring him on an <b>official visit</b>{" "}
							(limited each season), and <b>offer</b> a scholarship (two offers
							per open scholarship). Each contact or visit comes with a pitch:
							playing time, prestige, closeness to home, your coach, winning or
							NIL money. It works best on what he cares about. A recruit commits
							once a school that offered him is past the red line and well ahead
							of the others, and can decommit if another school passes it by
							far. Committed recruits sign on signing day.
						</p>
						<RecruitingHeader
							autoRecruit={autoRecruit}
							offerLimit={offerLimit}
							offers={offers}
							openSpots={openSpots}
							state={state}
						>
							{lateRecruiting && weeksLeft > 0 ? (
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
									Next recruiting week ({weeksLeft} left)
								</button>
							) : null}
						</RecruitingHeader>
						<RecruitBoard
							rows={recruits}
							canEdit={canEdit}
							autoRecruit={autoRecruit}
							userAbbrev={userAbbrev}
							extraColumns={[
								{ title: "Rk", render: (r) => r.rank },
								{ title: "Stars", render: (r) => <Stars stars={r.stars} /> },
								{
									title: "From",
									render: (r) => (
										<>
											{r.state}
											{r.miles !== undefined ? (
												<span
													className="text-body-secondary ms-1"
													title="Miles from his hometown to your campus"
												>
													({r.miles} mi)
												</span>
											) : null}
										</>
									),
								},
							]}
							emptyText="No recruits match."
						/>
					</>
				) : (
					<p>
						{signingDayPassed
							? "Signing day is over. Next year's recruiting class appears in the preseason."
							: "No recruiting class yet."}
					</p>
				)
			) : null}

			{tab === "commits" ? (
				committed.length > 0 ? (
					<div className="table-responsive">
						<table
							className="table table-sm table-striped"
							style={{ maxWidth: 640 }}
						>
							<thead>
								<tr>
									<th>Rk</th>
									<th>Player</th>
									<th>Stars</th>
									<th>Pos</th>
									<th>School</th>
								</tr>
							</thead>
							<tbody>
								{committed.map((r) => (
									<tr
										key={r.pid}
										className={r.commit === userTid ? "table-info" : undefined}
									>
										<td>{r.rank}</td>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["player", r.pid])}>
												{r.name}
											</a>
										</td>
										<td>
											<Stars stars={r.stars} />
										</td>
										<td>{r.pos}</td>
										<td>
											<TeamName
												teams={teams}
												tid={r.commit!}
												season={season}
												userTid={userTid}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p>No commitments yet.</p>
				)
			) : null}

			{tab === "results" ? (
				<>
					{current && signed.length > 0 ? (
						<>
							<h2>Your signing class</h2>
							<div className="table-responsive">
								<table
									className="table table-sm table-striped"
									style={{ maxWidth: 560 }}
								>
									<thead>
										<tr>
											<th>Player</th>
											<th>Stars</th>
											<th>Rk</th>
											<th>Pos</th>
											{challengeNoRatings ? null : (
												<>
													<th className="text-end">Ovr</th>
													<th className="text-end">Pot</th>
												</>
											)}
										</tr>
									</thead>
									<tbody>
										{signed.map((p) => (
											<tr key={p.pid}>
												<td className="text-nowrap">
													<a href={helpers.leagueUrl(["player", p.pid])}>
														{p.name}
													</a>
													{p.walkOn ? (
														<span className="badge bg-secondary ms-1">
															Walk-on
														</span>
													) : null}
												</td>
												<td>
													<Stars stars={p.stars} />
												</td>
												<td>{p.walkOn ? "" : p.rank}</td>
												<td>{p.pos}</td>
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
					{classRankings.length > 0 ? (
						<div className="row">
							<div className="col-lg-5">
								<h2>Class rankings</h2>
								<div className="table-responsive">
									<table
										className="table table-sm table-striped"
										data-testid="class-rankings"
									>
										<thead>
											<tr>
												<th>#</th>
												<th>School</th>
												<th className="text-end">Signed</th>
												<th className="text-end">5★</th>
												<th className="text-end">4★</th>
												<th className="text-end">3★</th>
												<th className="text-end">Pts</th>
											</tr>
										</thead>
										<tbody>
											{classRankings.slice(0, 25).map((row) => (
												<tr
													key={row.tid}
													className={
														row.tid === userTid ? "table-info" : undefined
													}
												>
													<td>{row.rank}</td>
													<td className="text-nowrap">
														<TeamName
															teams={teams}
															tid={row.tid}
															season={season}
															userTid={userTid}
														/>
													</td>
													<td className="text-end">{row.count}</td>
													<td className="text-end">{row.stars[0]}</td>
													<td className="text-end">{row.stars[1]}</td>
													<td className="text-end">{row.stars[2]}</td>
													<td className="text-end">{row.points}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								{(() => {
									const user = classRankings.find((r) => r.tid === userTid);
									return user && user.rank > 25 ? (
										<p>
											Your class ranks No. {user.rank} ({user.count} signed,{" "}
											{user.points} pts).
										</p>
									) : null;
								})()}
							</div>
							<div className="col-lg-7">
								<h2>Who signed where</h2>
								<div className="table-responsive">
									<table className="table table-sm table-striped">
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
												.slice(0, 100)
												.map((c) => (
													<tr
														key={c.pid}
														className={
															c.tid === userTid ? "table-info" : undefined
														}
													>
														<td>{c.rank}</td>
														<td className="text-nowrap">
															<a href={helpers.leagueUrl(["player", c.pid])}>
																{c.name}
															</a>
														</td>
														<td>
															<Stars stars={c.stars} />
														</td>
														<td>{c.pos}</td>
														<td className="text-nowrap">{c.state}</td>
														<td className="text-nowrap">
															<TeamName
																teams={teams}
																tid={c.tid}
																season={season}
																userTid={userTid}
															/>
														</td>
													</tr>
												))}
										</tbody>
									</table>
								</div>
							</div>
						</div>
					) : (
						<p>
							{current && !signingDayPassed
								? "Signing day is the last phase of the offseason. The results show up here."
								: "No signing day results for this season."}
						</p>
					)}
				</>
			) : null}
		</>
	);
};

export default CollegeRecruiting;
