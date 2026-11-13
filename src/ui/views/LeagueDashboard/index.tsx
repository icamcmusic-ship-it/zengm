import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { PlayoffMatchup } from "../../components/PlayoffMatchup.tsx";
import Leaders from "./Leaders.tsx";
import Standings from "./Standings.tsx";
import StartingLineup from "./StartingLineup.tsx";
import TeamStats from "./TeamStats.tsx";
import type { View } from "../../../common/types.ts";
import Headlines from "./Headlines.tsx";
import GamesToWatch from "./GamesToWatch.tsx";
import RecentAchievements from "./RecentAchievements.tsx";
import MilestoneWatch from "./MilestoneWatch.tsx";
import RumorMill from "./RumorMill.tsx";
import { useLocal } from "../../util/local.ts";
import { useFeatureOn, useFeatureOption } from "../../util/nativeFeatures.ts";

const LeagueDashboard = ({
	att,
	cash,
	confOrAllTeams,
	events,
	leagueLeaders,
	lost,
	maxPlayoffSeed,
	maxPlayoffSeedNoPlayIn,
	messages,
	name,
	numGamesToWinSeries,
	numPlayersOnCourt,
	otl,
	payroll,
	playoffRoundsWon,
	playoffsByConf,
	pointsFormula,
	profit,
	rank,
	region,
	revenue,
	roundsWonText,
	series,
	seriesTitle,
	showPlayoffSeries,
	starters,
	startersStats,
	teamLeaders,
	teamStats,
	teams,
	tied,
	usePts,
	won,
}: View<"leagueDashboard">) => {
	useTitleBar({ title: `${region} ${name} Dashboard` });

	const { luxuryPayroll, salaryCap, salaryCapType, season, userTid } = useLocal(
		["luxuryPayroll", "salaryCap", "salaryCapType", "season", "userTid"],
	);

	// League extras
	const showHype = useFeatureOption<boolean>("featureHypeDashboard");
	const showRumors = useFeatureOn("rumors");
	const showMilestones = useFeatureOption<boolean>(
		"featureMilestonesDashboard",
	);
	const showAchievements = useFeatureOption<boolean>(
		"featureAchievementsDashboard",
	);
	const newspaperOn = useFeatureOn("newspaper");
	const wrappedOn = useFeatureOn("wrapped");
	const storylinesOn = useFeatureOn("storylines");
	const timelineOn = useFeatureOn("timeline");
	const scoutingDepthOn = useFeatureOn("scoutingDepth");
	const coachingDepthOn = useFeatureOn("coachingDepth");
	const staffReportOn = scoutingDepthOn || coachingDepthOn;
	const recordsLinks = [
		...(newspaperOn
			? [
					{
						key: "newspaper",
						node: (
							<a href={helpers.leagueUrl(["newspaper"])}>» Latest newspaper</a>
						),
					},
				]
			: []),
		...(wrappedOn
			? [
					{
						key: "wrapped",
						node: <a href={helpers.leagueUrl(["wrapped"])}>» Latest Wrapped</a>,
					},
				]
			: []),
		...(storylinesOn
			? [
					{
						key: "storylines",
						node: (
							<>
								<a href={helpers.leagueUrl(["storylines"])}>» Top storylines</a>
								{" | "}
								<a
									href={helpers.leagueUrl([
										"storylines",
										"team",
										helpers.getTeamUrlPart(userTid),
									])}
								>
									your team
								</a>
							</>
						),
					},
				]
			: []),
		...(timelineOn
			? [
					{
						key: "timeline",
						node: (
							<a href={helpers.leagueUrl(["timeline"])}>» League timeline</a>
						),
					},
				]
			: []),
	];

	return (
		<>
			<div className="row">
				<div className="col-xl-7 col-lg-8">
					<div className="row">
						<div className="col-sm-4 mb-sm-3">
							{showPlayoffSeries && series ? (
								<>
									<div className="mb-1 mt-2">
										<b>{seriesTitle}</b>
									</div>
									<PlayoffMatchup
										expandTeamNames
										numGamesToWinSeries={numGamesToWinSeries}
										season={season}
										series={series}
										userTid={userTid}
									/>
									<div className="mt-1 mb-sm-3">
										<a href={helpers.leagueUrl(["playoffs"])}>» Playoffs</a>
									</div>
								</>
							) : null}
							<div className="d-none d-sm-block mt-2">
								<Standings
									confOrAllTeams={confOrAllTeams}
									maxPlayoffSeed={maxPlayoffSeed}
									maxPlayoffSeedNoPlayIn={maxPlayoffSeedNoPlayIn}
									playoffsByConf={playoffsByConf}
									pointsFormula={pointsFormula}
									usePts={usePts}
									userTid={userTid}
								/>
							</div>
						</div>
						<div className="col-sm-8">
							<div className="text-center mb-3">
								<span style={{ fontSize: "3rem" }}>
									{won}-{lost}
									{otl > 0 ? <>-{otl}</> : null}
									{tied > 0 ? <>-{tied}</> : null}
								</span>
								<br />
								<span style={{ fontSize: "1.5rem" }}>
									{playoffRoundsWon < 0 ? (
										<span>
											{helpers.ordinal(rank)} in{" "}
											{playoffsByConf !== false ? "conference" : "league"}
										</span>
									) : (
										<span className="d-none d-sm-inline">{roundsWonText}</span>
									)}
								</span>
							</div>

							<div className="row">
								<div className="col-6">
									<Leaders
										leagueLeaders={leagueLeaders}
										teamLeaders={teamLeaders}
									/>
									<h2>Inbox</h2>
									{messages.length === 0 ? (
										<p>No messages!</p>
									) : (
										<>
											<table className="table table-sm messages-table">
												<tbody>
													{messages.map((m) => (
														<tr
															key={m.mid}
															className={m.read ? undefined : "fw-bold"}
														>
															<td className="year">
																<a href={helpers.leagueUrl(["message", m.mid])}>
																	{m.year}
																</a>
															</td>
															<td className="from">
																<a href={helpers.leagueUrl(["message", m.mid])}>
																	{m.from}
																</a>
															</td>
														</tr>
													))}
												</tbody>
											</table>
											<p>
												<a href={helpers.leagueUrl(["inbox"])}>
													» All Messages
												</a>
											</p>
										</>
									)}
								</div>
								<div className="col-6">
									<TeamStats teamStats={teamStats} />
									<h2>Finances</h2>
									<div className="mb-3">
										Avg Attendance: {helpers.numberWithCommas(Math.round(att))}
										<br />
										Revenue (YTD): {helpers.formatCurrency(revenue, "M")}
										<br />
										Profit (YTD): {helpers.formatCurrency(profit, "M")}
										<br />
										Cash: {helpers.formatCurrency(cash / 1000, "M")}
										<br />
										Payroll: {helpers.formatCurrency(payroll / 1000, "M")}
										<br />
										{salaryCapType === "none" ? (
											<>
												Luxury Tax:{" "}
												{helpers.formatCurrency(luxuryPayroll / 1000, "M")}
											</>
										) : (
											<>
												Salary Cap:{" "}
												{helpers.formatCurrency(salaryCap / 1000, "M")}
											</>
										)}
										<br />
										<a href={helpers.leagueUrl(["team_finances"])}>
											» Team Finances
										</a>
										<br />
										<a href={helpers.leagueUrl(["league_finances"])}>
											» League Finances
										</a>
									</div>
								</div>
							</div>
						</div>
					</div>
					<StartingLineup
						numPlayersOnCourt={numPlayersOnCourt}
						starters={starters}
						startersStats={startersStats}
					/>
				</div>
				<div className="col-xl-5 col-lg-4 mb-3">
					{showHype ? (
						<GamesToWatch
							refreshKey={`${won}-${lost}-${otl}-${tied}-${playoffRoundsWon}`}
						/>
					) : null}
					<Headlines
						events={events}
						season={season}
						teams={teams}
						userTid={userTid}
					/>
					{showRumors ? (
						<RumorMill
							refreshKey={`${won}-${lost}-${otl}-${tied}-${playoffRoundsWon}`}
						/>
					) : null}
					{showMilestones ? (
						<MilestoneWatch
							refreshKey={`${won}-${lost}-${otl}-${tied}-${playoffRoundsWon}`}
						/>
					) : null}
					{showAchievements ? (
						<RecentAchievements
							refreshKey={`${won}-${lost}-${otl}-${tied}-${playoffRoundsWon}`}
						/>
					) : null}
					{staffReportOn ? (
						<div className="mt-3" data-testid="dashboard-staff-report">
							<h2>Your staff</h2>
							<a href={helpers.leagueUrl(["staff_report"])}>
								» Staff Report
							</a>{" "}
							<span className="text-body-secondary">
								targets, development, fit and conditioning
							</span>
						</div>
					) : null}
					{recordsLinks.length > 0 ? (
						<div className="mt-3">
							<h2>From the records</h2>
							<ul className="list-unstyled mb-0">
								{recordsLinks.map((link) => (
									<li key={link.key}>{link.node}</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			</div>
		</>
	);
};

export default LeagueDashboard;
