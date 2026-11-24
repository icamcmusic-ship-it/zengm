import { Fragment, useState } from "react";
import { MoreLinks } from "../components/MoreLinks.tsx";
import {
	GmBehaviorLine,
	GmTraitBars,
	hotSeatClass,
} from "../components/GmCard.tsx";
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
	financeInfo,
	noRatings,
}: View<"frontOffices">) => {
	useTitleBar({ title: "Front Offices" });
	const [open, setOpen] = useState<number | undefined>();

	// Carousel groups, newest first (moves come sorted): the offseason after a season, or during one
	const groupKey = (m: { season: number; midSeason?: boolean }) =>
		`${m.season}${m.midSeason ? "-during" : ""}`;
	const groups = [
		...new Map(moves.map((m) => [groupKey(m), m] as const)).values(),
	]
		.slice(0, 12)
		.map((m) => ({
			key: groupKey(m),
			season: m.season,
			midSeason: !!m.midSeason,
		}));
	const numCols = 13 + (financeInfo ? 1 : 0) - (noRatings ? 1 : 0);

	return (
		<>
			<MoreLinks type="league" page="front_offices" />
			<p>
				Every AI team's general manager and his leanings, which shift the team's
				trades, signings, payroll, draft picks and strategy, next to his track
				record (what he has actually done in all his jobs: trades a season,
				average payroll and luxury tax seasons). Owners fire GMs who fall short
				of expectations for too long (the preseason projection of wins, plus
				playoff success). Click a row to see all of a GM's leanings, the picks
				he has moved and his rosters' age.
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
							{financeInfo ? <th>Finances</th> : null}
							<th>Since</th>
							<th title="Record with this team">Record</th>
							{noRatings ? null : (
								<th title="Wins above the preseason expectations, per 82 games, with this team">
									+/- Exp
								</th>
							)}
							<th title="Playoff appearances with this team">Playoffs</th>
							<th>Titles</th>
							<th>Job security</th>
							<th title="Trades a season, in all his jobs">Trades</th>
							<th title="Average payroll as a share of the salary cap, in all his jobs">
								Payroll
							</th>
							<th title="Seasons his team paid the luxury tax, in all his jobs">
								Tax
							</th>
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
													<a href={helpers.leagueUrl(["gm", gm.gmid])}>
														{gm.name}
													</a>
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
												{financeInfo ? (
													<td
														className="text-nowrap"
														title={gm.finance?.description}
													>
														{gm.finance?.name}
													</td>
												) : null}
												<td>{gm.since}</td>
												<td className="text-nowrap">
													{gm.tenureSeasons > 0 ? `${gm.won}-${gm.lost}` : "—"}
												</td>
												{noRatings ? null : (
													<td>
														{gm.tenureSeasons > 0 &&
														gm.aboveExp !== undefined ? (
															<PlusMinus>{gm.aboveExp}</PlusMinus>
														) : (
															"—"
														)}
													</td>
												)}
												<td>{gm.playoffs}</td>
												<td>{gm.titles}</td>
												<td className={hotSeatClass(gm.hotSeatLabel)}>
													{gm.hotSeatLabel}
												</td>
												<td>
													{gm.behavior.seasons > 0
														? gm.behavior.tradesPerSeason.toFixed(1)
														: "—"}
												</td>
												<td>
													{gm.behavior.payroll !== undefined
														? `${Math.round(gm.behavior.payroll * 100)}%`
														: "—"}
												</td>
												<td>
													{gm.behavior.taxSeasonsOf > 0
														? `${gm.behavior.taxSeasons}/${gm.behavior.taxSeasonsOf}`
														: "—"}
												</td>
											</>
										) : (
											<td colSpan={numCols - 1} className="text-body-secondary">
												{row.user ? "You" : "Vacant"}
											</td>
										)}
									</tr>
									{gm && open === row.tid ? (
										<tr>
											<td colSpan={numCols}>
												<div className="d-flex flex-wrap gap-3">
													{gm.face ? (
														<div style={{ width: 80, height: 120 }}>
															<StaffFace
																face={gm.face}
																lazy
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
															{gm.execAwards.length > 0
																? `. Executive of the Year: ${gm.execAwards.join(", ")}`
																: ""}
														</div>
														{gm.finance ? (
															<div>
																Finances: <b>{gm.finance.name}</b>.{" "}
																{gm.finance.description}
															</div>
														) : null}
														<GmBehaviorLine behavior={gm.behavior} />
														<GmTraitBars
															bands={gm.traitBands}
															traits={gm.traits}
														/>
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
			{groups.length === 0 ? (
				<p>No GM has been fired or hired yet.</p>
			) : (
				groups.map((group) => (
					<Fragment key={group.key}>
						<h3 className="h5">
							{group.midSeason ? "During" : "After"} the {group.season} season
						</h3>
						<ul>
							{moves
								.filter((m) => groupKey(m) === group.key)
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
												{MOVE_TEXT.retired}{" "}
												<a href={helpers.leagueUrl(["gm", m.gmid])}>{m.name}</a>
											</>
										) : (
											<>
												{MOVE_TEXT[m.type]}{" "}
												<a href={helpers.leagueUrl(["gm", m.gmid])}>{m.name}</a>
												{m.type === "hired" && m.finance
													? `, ${/^[aeiou]/i.test(m.finance) ? "an" : "a"} ${m.finance} GM`
													: ""}
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
								{financeInfo ? <th>Finances</th> : null}
								<th>Last job</th>
								<th>Career</th>
								<th>Titles</th>
								<th>Track record</th>
							</tr>
						</thead>
						<tbody>
							{market.map((gm) => (
								<tr key={gm.gmid}>
									<td className="text-nowrap">
										<a href={helpers.leagueUrl(["gm", gm.gmid])}>{gm.name}</a>
									</td>
									<td>{gm.age}</td>
									<td>
										{gm.styleLabels.length > 0
											? gm.styleLabels.join(" · ")
											: "Balanced"}
									</td>
									{financeInfo ? (
										<td title={gm.finance?.description}>{gm.finance?.name}</td>
									) : null}
									<td>
										{gm.lastTeam
											? `${gm.lastTeam.abbrev}, until ${gm.lastTeam.end}`
											: ""}
									</td>
									<td className="text-nowrap">
										{gm.careerWon}-{gm.careerLost}
									</td>
									<td>{gm.careerTitles}</td>
									<td className="text-nowrap">
										{gm.behavior.seasons > 0
											? `${gm.behavior.tradesPerSeason.toFixed(1)} trades/season${gm.behavior.payroll !== undefined ? `, payroll ${Math.round(gm.behavior.payroll * 100)}% of cap` : ""}`
											: "—"}
									</td>
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
			{financeInfo ? (
				<>
					<h2>Finance styles</h2>
					<p>
						How a GM runs his team's money within the owner's budget. The
						owner's type wins where they disagree (a bottom line owner won't let
						a spendthrift pay luxury tax).
					</p>
					<ul>
						{financeInfo.map((info) => (
							<li key={info.key}>
								<b>{info.name}</b>: {info.description}
							</li>
						))}
					</ul>
				</>
			) : null}
		</>
	);
};

export default FrontOffices;
