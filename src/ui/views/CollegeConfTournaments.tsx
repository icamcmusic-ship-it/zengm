// College mode: conference tournament brackets (docs/college-mode.md)
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { SeasonSelect, TeamName } from "./College/common.tsx";
import { confRoundName } from "../../common/collegeStats/ncaa.ts";

const CollegeConfTournaments = ({
	season,
	seasons,
	teams,
	tournaments,
	userCid,
	userTid,
}: View<"collegeConfTournaments">) => {
	useTitleBar({ title: "Conference Tournaments" });
	const [cid, setCid] = useState<number | undefined>(undefined);
	const current =
		tournaments.find((t) => t.cid === (cid ?? userCid)) ?? tournaments[0];

	return (
		<>
			<SeasonSelect
				page="college_conf_tournaments"
				season={season}
				seasons={seasons}
			/>
			{tournaments.length === 0 ? (
				<p>
					The conference tournaments start when the regular season is over.
					Every team plays in its conference's tournament (the top seeds get
					byes) and the champion gets an automatic bid to the national
					tournament.
				</p>
			) : (
				<>
					<select
						className="form-select mb-3"
						style={{ width: "auto", maxWidth: "100%" }}
						aria-label="Conference"
						value={current?.cid}
						onChange={(event) => setCid(Number(event.target.value))}
					>
						{tournaments.map((t) => (
							<option key={t.cid} value={t.cid}>
								{t.name}
								{t.champion !== undefined
									? ` (champion: ${teams[t.champion]?.region})`
									: ""}
							</option>
						))}
					</select>
					{current ? (
						<>
							{current.champion !== undefined ? (
								<p className="fs-5">
									Champion:{" "}
									<TeamName
										teams={teams}
										tid={current.champion}
										season={season}
										userTid={userTid}
									/>
								</p>
							) : null}
							<div className="d-flex flex-wrap gap-3">
								{current.rounds.map((round, i) => (
									<div key={i} style={{ minWidth: 220 }}>
										<h3 className="fs-6">
											{confRoundName(i, current.rounds.length)}
										</h3>
										{round.map((m, j) =>
											m.away === -2 ? null : (
												<div key={j} className="border rounded mb-2 p-1 small">
													{(["home", "away"] as const).map((side, k) => {
														const tid = m[side];
														const seed =
															side === "home" ? m.seedHome : m.seedAway;
														const won =
															m.pts !== undefined && m.pts[k]! > m.pts[1 - k]!;
														return (
															<div
																key={side}
																className={`d-flex justify-content-between${won ? " fw-bold" : ""}`}
															>
																<span>
																	{seed !== undefined ? (
																		<span className="text-body-secondary me-1">
																			{seed}
																		</span>
																	) : null}
																	{tid >= 0 ? (
																		<TeamName
																			teams={teams}
																			tid={tid}
																			season={season}
																			userTid={userTid}
																		/>
																	) : (
																		<span className="text-body-secondary">
																			TBD
																		</span>
																	)}
																</span>
																<span>{m.pts ? m.pts[k] : ""}</span>
															</div>
														);
													})}
												</div>
											),
										)}
									</div>
								))}
							</div>
						</>
					) : null}
				</>
			)}
		</>
	);
};

export default CollegeConfTournaments;
