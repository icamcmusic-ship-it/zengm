import { Fragment, useState } from "react";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { GmTraitBars, hotSeatClass } from "../components/GmCard.tsx";
import { StaffFace } from "../components/StaffFace.tsx";
import { PlusMinus } from "../components/PlusMinus.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";

const MOVE_TEXT = {
	hired: "hired",
	fired: "fired",
	retired: "retirement of",
	left: "left",
};

const FrontOffices = ({
	market,
	moves,
	rows,
	traitInfo,
}: View<"frontOffices">) => {
	useTitleBar({ title: "Front Offices" });
	const [open, setOpen] = useState<number | undefined>();

	const seasons = [...new Set(moves.map((m) => m.season))].slice(0, 12);

	return (
		<>
			<MoreLinks type="league" page="front_offices" />
			<p>
				Every AI team's general manager and his leanings, which shift the team's
				trades, signings, draft picks and strategy a little. Owners fire GMs who
				fall short of expectations for too long (the preseason projection of
				wins, plus playoff success). Click a row to see all of a GM's leanings.
			</p>
			<h2>General managers</h2>
			<div className="table-responsive">
				<table className="table table-striped table-sm table-hover">
					<thead>
						<tr>
							<th>Team</th>
							<th>GM</th>
							<th>Age</th>
							<th>Style</th>
							<th>Since</th>
							<th title="Record with this team">Record</th>
							<th title="Wins above the preseason expectations, per 82 games, with this team">
								+/- Exp
							</th>
							<th title="Playoff appearances with this team">Playoffs</th>
							<th>Titles</th>
							<th>Job security</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const gm = row.gm;
							return (
								<Fragment key={row.tid}>
									<tr
										onClick={
											gm
												? () => setOpen(open === row.tid ? undefined : row.tid)
												: undefined
										}
										style={gm ? { cursor: "pointer" } : undefined}
									>
										<td>
											<a
												href={helpers.leagueUrl([
													"roster",
													`${row.abbrev}_${row.tid}`,
												])}
											>
												{row.abbrev}
											</a>
										</td>
										{gm ? (
											<>
												<td className="text-nowrap">
													{gm.name}
													{gm.previousTeams.length > 0 ? (
														<span className="text-body-secondary">
															{" "}
															(ex-{gm.previousTeams.join(", ")})
														</span>
													) : null}
												</td>
												<td>{gm.age}</td>
												<td>
													{gm.styleLabels.length > 0
														? gm.styleLabels.join(" · ")
														: "Balanced"}
												</td>
												<td>{gm.since}</td>
												<td className="text-nowrap">
													{gm.tenureSeasons > 0 ? `${gm.won}-${gm.lost}` : "—"}
												</td>
												<td>
													{gm.tenureSeasons > 0 ? (
														<PlusMinus>{gm.aboveExp}</PlusMinus>
													) : (
														"—"
													)}
												</td>
												<td>{gm.playoffs}</td>
												<td>{gm.titles}</td>
												<td className={hotSeatClass(gm.hotSeatLabel)}>
													{gm.hotSeatLabel}
												</td>
											</>
										) : (
											<td colSpan={9} className="text-body-secondary">
												{row.user ? "You" : "Vacant"}
											</td>
										)}
									</tr>
									{gm && open === row.tid ? (
										<tr>
											<td colSpan={10}>
												<div className="d-flex flex-wrap gap-3">
													{gm.face ? (
														<div style={{ width: 80, height: 120 }}>
															<StaffFace
																face={gm.face}
																colors={row.colors}
																age={gm.age}
																seed={gm.gmid}
															/>
														</div>
													) : null}
													<div>
														<div>
															Born {gm.born.year} in {gm.born.loc}. Career:{" "}
															{gm.careerWon}-{gm.careerLost}
															{gm.careerTitles > 0
																? `, ${gm.careerTitles} title${gm.careerTitles > 1 ? "s" : ""}`
																: ""}
														</div>
														<GmTraitBars traits={gm.traits} />
													</div>
												</div>
											</td>
										</tr>
									) : null}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>

			<h2>GM carousel</h2>
			{seasons.length === 0 ? (
				<p>No GM has been fired or hired yet.</p>
			) : (
				seasons.map((season) => (
					<Fragment key={season}>
						<h3 className="h5">After the {season} season</h3>
						<ul>
							{moves
								.filter((m) => m.season === season)
								.map((m, i) => (
									<li key={i}>
										<a
											href={helpers.leagueUrl([
												"roster",
												`${m.abbrev}_${m.tid}`,
											])}
										>
											{m.abbrev}
										</a>{" "}
										{m.type === "retired" ? (
											<>
												{MOVE_TEXT.retired} {m.name}
											</>
										) : (
											<>
												{MOVE_TEXT[m.type]} {m.name}
												{m.type === "hired" &&
												m.previousTeams &&
												m.previousTeams.length > 0
													? ` (formerly ${m.previousTeams.join(", ")})`
													: m.type === "hired"
														? " (first GM job)"
														: ""}
											</>
										)}
									</li>
								))}
						</ul>
					</Fragment>
				))
			)}

			<h2>On the market</h2>
			{market.length === 0 ? (
				<p>No former GMs are looking for a job.</p>
			) : (
				<div className="table-responsive">
					<table className="table table-striped table-sm">
						<thead>
							<tr>
								<th>Name</th>
								<th>Age</th>
								<th>Style</th>
								<th>Last job</th>
								<th>Career</th>
								<th>Titles</th>
							</tr>
						</thead>
						<tbody>
							{market.map((gm) => (
								<tr key={gm.gmid}>
									<td className="text-nowrap">{gm.name}</td>
									<td>{gm.age}</td>
									<td>
										{gm.styleLabels.length > 0
											? gm.styleLabels.join(" · ")
											: "Balanced"}
									</td>
									<td>
										{gm.lastTeam
											? `${gm.lastTeam.abbrev}, until ${gm.lastTeam.end}`
											: ""}
									</td>
									<td className="text-nowrap">
										{gm.careerWon}-{gm.careerLost}
									</td>
									<td>{gm.careerTitles}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<h2>Leanings</h2>
			<ul>
				{Object.values(traitInfo).map((info) => (
					<li key={info.name}>
						<b>{info.name}</b> ({info.low} to {info.high}): {info.description}
					</li>
				))}
			</ul>
		</>
	);
};

export default FrontOffices;
