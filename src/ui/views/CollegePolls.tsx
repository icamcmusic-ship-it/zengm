// College mode: AP Top 25, NET and Selection (docs/college-mode.md)
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { FirstFour, SeasonSelect, TeamName } from "./College/common.tsx";
import { COLLEGE_REGION_NAMES } from "../../common/college/constants.ts";

const Change = ({ rank, prev }: { rank: number; prev: number | undefined }) => {
	if (prev === undefined) {
		return <span className="badge bg-secondary">NEW</span>;
	}
	const diff = prev - rank;
	if (diff === 0) {
		return <span className="text-body-secondary">–</span>;
	}
	return (
		<span className={diff > 0 ? "text-success" : "text-danger"}>
			{diff > 0 ? "▲" : "▼"}
			{Math.abs(diff)}
		</span>
	);
};

const CollegePolls = ({
	net,
	polls,
	season,
	seasons,
	selection,
	firstFour,
	teams,
	userTid,
}: View<"collegePolls">) => {
	useTitleBar({ title: "Top 25 & Selection" });
	const [tab, setTab] = useState<"ap" | "net" | "selection">(
		selection ? "selection" : "ap",
	);
	const [index, setIndex] = useState<number | undefined>(undefined);
	const pollIndex = Math.min(index ?? polls.length - 1, polls.length - 1);
	const poll = polls[pollIndex];

	return (
		<>
			<SeasonSelect page="college_polls" season={season} seasons={seasons} />
			<ul className="nav nav-tabs mb-3">
				{(
					[
						["ap", "AP Top 25"],
						["net", "NET"],
						["selection", "Selection"],
					] as const
				).map(([key, name]) => (
					<li className="nav-item" key={key}>
						<button
							type="button"
							className={`nav-link${tab === key ? " active" : ""}`}
							onClick={() => setTab(key)}
						>
							{name}
						</button>
					</li>
				))}
			</ul>

			{tab === "ap" ? (
				poll ? (
					<>
						<select
							className="form-select form-select-sm mb-3"
							style={{ width: "auto" }}
							aria-label="Poll"
							value={pollIndex}
							onChange={(event) => setIndex(Number(event.target.value))}
						>
							{polls.map((p, i) => (
								<option key={i} value={i}>
									{p.label}
								</option>
							))}
						</select>
						<div className="table-responsive">
							<table
								className="table table-sm table-striped table-hover"
								style={{ maxWidth: 560 }}
							>
								<thead>
									<tr>
										<th>Rk</th>
										<th>Team</th>
										<th className="text-end">Record</th>
										<th className="text-end">Pts</th>
										<th className="text-end">Move</th>
									</tr>
								</thead>
								<tbody>
									{poll.ranked.map((entry, i) => (
										<tr key={entry.team}>
											<td>{i + 1}</td>
											<td>
												<TeamName
													teams={teams}
													tid={entry.team}
													season={season}
													userTid={userTid}
												/>
												{entry.firstPlace > 0 ? (
													<span className="text-body-secondary small ms-1">
														({entry.firstPlace})
													</span>
												) : null}
											</td>
											<td className="text-end">
												{entry.w}-{entry.l}
											</td>
											<td className="text-end">{entry.pts}</td>
											<td className="text-end">
												{pollIndex > 0 ? (
													<Change rank={i + 1} prev={entry.prev} />
												) : null}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{poll.others.length > 0 ? (
							<p className="small">
								<b>Others receiving votes:</b>{" "}
								{poll.others.slice(0, 15).map((o, i) => (
									<span key={o.team}>
										{i > 0 ? ", " : ""}
										{teams[o.team]?.region} {o.pts}
									</span>
								))}
							</p>
						) : null}
					</>
				) : (
					<p>No polls yet.</p>
				)
			) : null}

			{tab === "net" ? (
				net.length > 0 ? (
					<div className="table-responsive">
						<table
							className="table table-sm table-striped table-hover"
							style={{ maxWidth: 760 }}
						>
							<thead>
								<tr>
									<th>NET</th>
									<th>Team</th>
									<th className="text-end">W-L</th>
									<th className="text-end">SRS</th>
									<th className="text-end">SOS</th>
									<th className="text-end">Q1</th>
									<th className="text-end">Q2</th>
									<th className="text-end">Q3</th>
									<th className="text-end">Q4</th>
								</tr>
							</thead>
							<tbody>
								{net.map((row) => (
									<tr key={row.tid}>
										<td>{row.rank}</td>
										<td className="text-nowrap">
											<TeamName
												teams={teams}
												tid={row.tid}
												season={season}
												userTid={userTid}
											/>
										</td>
										<td className="text-end">
											{row.w}-{row.l}
										</td>
										<td className="text-end">{row.srs.toFixed(1)}</td>
										<td className="text-end">{row.sosRank}</td>
										{row.quads.map((q, i) => (
											<td className="text-end text-nowrap" key={i}>
												{q[0]}-{q[1]}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p>No games played yet.</p>
				)
			) : null}

			{tab === "selection" ? (
				selection ? (
					<>
						{firstFour && firstFour.length > 0 ? (
							<FirstFour
								games={firstFour}
								teams={teams}
								season={season}
								userTid={userTid}
							/>
						) : null}
						<div className="row">
							{COLLEGE_REGION_NAMES.slice(
								0,
								Math.max(...selection.field.map((t) => t.region)) + 1,
							).map((name, region) => (
								<div className="col-sm-6 col-lg-3 mb-3" key={name}>
									<h3>{name}</h3>
									<table className="table table-sm mb-0">
										<tbody>
											{selection.field
												.filter((t) => t.region === region)
												.sort((a, b) => a.seed - b.seed)
												.map((t) => (
													<tr key={t.tid}>
														<td style={{ width: 30 }}>{t.seed}</td>
														<td>
															<TeamName
																teams={teams}
																tid={t.tid}
																season={season}
																userTid={userTid}
																record
															/>
															{t.firstFour !== undefined ? (
																<span
																	className="badge bg-warning text-dark ms-1"
																	title="First Four: plays in for this seed"
																>
																	FF
																</span>
															) : null}
															{t.bid === "auto" ? (
																<span
																	className="badge bg-secondary ms-1"
																	title="Automatic bid (conference tournament champion)"
																>
																	AQ
																</span>
															) : null}
														</td>
													</tr>
												))}
										</tbody>
									</table>
								</div>
							))}
						</div>
						{(
							[
								["Last four in", selection.lastFourIn],
								["First four out", selection.firstFourOut],
								["Next four out", selection.nextFourOut],
							] as const
						).map(([label, tids]) =>
							tids.length > 0 ? (
								<p key={label} className="mb-1">
									<b>{label}:</b>{" "}
									{tids.map((tid, i) => (
										<span key={tid}>
											{i > 0 ? ", " : ""}
											<TeamName
												teams={teams}
												tid={tid}
												season={season}
												userTid={userTid}
												record
											/>
										</span>
									))}
								</p>
							) : null,
						)}
					</>
				) : (
					<p>
						The field is selected after the conference tournaments, from the
						NET, records against quadrants, strength of schedule and the
						conference tournament champions' automatic bids.
					</p>
				)
			) : null}
		</>
	);
};

export default CollegePolls;
