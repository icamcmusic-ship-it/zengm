import { Fragment, useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import Overall from "./TeamHistory/Overall.tsx";
import Players from "./TeamHistory/Players.tsx";
import Seasons from "./TeamHistory/Seasons.tsx";
import HideableSection from "../components/HideableSection.tsx";
import { useLocal } from "../util/local.ts";
import { Championships } from "./TeamHistory/Championships.tsx";

type VsGmRow = NonNullable<View<"gmHistory">["vsGms"]>[number];

// Your record (regular season and playoffs) against the teams each AI GM ran while he ran them, and every trade you made with him
const VsGms = ({ rows }: { rows: VsGmRow[] }) => {
	const [open, setOpen] = useState<number | undefined>();
	return (
		<div className="table-responsive" data-testid="gm-history-vs">
			<table className="table table-sm table-striped table-hover">
				<thead>
					<tr>
						<th>GM</th>
						<th>Teams</th>
						<th title="Regular season record against his teams">Record</th>
						<th title="Playoff games">Playoffs</th>
						<th>Trades</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<Fragment key={row.gmid}>
							<tr>
								<td>
									<a href={helpers.leagueUrl(["gm", row.gmid])}>{row.name}</a>
									{row.current ? null : (
										<span className="text-body-secondary small"> (former)</span>
									)}
								</td>
								<td>{row.abbrevs.join(", ")}</td>
								<td>
									{row.won}-{row.lost}
									{row.tied > 0 ? `-${row.tied}` : ""}
								</td>
								<td>
									{row.playoffWon + row.playoffLost > 0
										? `${row.playoffWon}-${row.playoffLost}`
										: ""}
								</td>
								<td>
									{row.trades.length > 0 ? (
										<button
											type="button"
											className="btn btn-link p-0 border-0 align-baseline"
											onClick={() =>
												setOpen(open === row.gmid ? undefined : row.gmid)
											}
										>
											{row.trades.length}
										</button>
									) : (
										0
									)}
								</td>
							</tr>
							{open === row.gmid
								? row.trades.map((trade) => (
										<tr key={trade.eid}>
											<td colSpan={5} className="small ps-4">
												<a
													href={helpers.leagueUrl(["trade_summary", trade.eid])}
												>
													{trade.season}
												</a>
												: you got {trade.got.join(", ") || "nothing"}; he got{" "}
												{trade.gave.join(", ") || "nothing"}
											</td>
										</tr>
									))
								: null}
						</Fragment>
					))}
				</tbody>
			</table>
		</div>
	);
};

const GmHistory = ({
	bestRecord,
	championships,
	execAwards,
	finalsAppearances,
	players,
	playoffAppearances,
	stats,
	teamHistories,
	totalLost,
	totalTied,
	totalOtl,
	totalWinp,
	totalWon,
	vsGms,
	worstRecord,
}: View<"gmHistory">) => {
	useTitleBar({
		title: "GM History",
	});
	const { userTid } = useLocal(["userTid"]);

	const showOverall = teamHistories.length !== 1;

	return (
		<>
			<p>
				More:{" "}
				<a href={helpers.leagueUrl(["team_records", "by_team", "your_teams"])}>
					Your Team Records
				</a>{" "}
				|{" "}
				<a href={helpers.leagueUrl(["draft_team_history", "your_teams"])}>
					Your Draft Picks
				</a>
			</p>

			<div className="row">
				<div className="col-sm-5 col-md-3">
					{showOverall ? (
						<HideableSection pageName="GmHistory" title="Overall">
							<Overall
								bestRecord={bestRecord}
								championships={championships}
								finalsAppearances={finalsAppearances}
								numSeasons={Math.sumPrecise(
									teamHistories.map((row) => row.history.length),
								)}
								playoffAppearances={playoffAppearances}
								totalLost={totalLost}
								totalTied={totalTied}
								totalOtl={totalOtl}
								totalWinp={totalWinp}
								totalWon={totalWon}
								worstRecord={worstRecord}
							/>
						</HideableSection>
					) : null}

					{teamHistories.map((teamHistory, i) => {
						const title = teamHistory.history[0]!.name ?? "";
						const titleKeyOverride = `${title}-${i}`;
						return (
							<HideableSection
								key={i}
								title={title}
								titleKeyOverride={titleKeyOverride}
								className={showOverall ? "mt-3" : undefined}
							>
								<Overall
									bestRecord={teamHistory.bestRecord}
									championships={teamHistory.championships}
									finalsAppearances={teamHistory.finalsAppearances}
									numSeasons={teamHistory.history.length}
									playoffAppearances={teamHistory.playoffAppearances}
									totalLost={teamHistory.totalLost}
									totalTied={teamHistory.totalTied}
									totalOtl={teamHistory.totalOtl}
									totalWinp={teamHistory.totalWinp}
									totalWon={teamHistory.totalWon}
									worstRecord={teamHistory.worstRecord}
								/>
								<Seasons history={teamHistory.history} userSeasons={[]} />
							</HideableSection>
						);
					})}
				</div>
				<div className="col-sm-7 col-md-9 mt-3 mt-sm-0">
					<p>
						This GM History page is similar to the{" "}
						<a href={helpers.leagueUrl(["team_history"])}>Team History page</a>,
						except it's not just for one team. It's for every team you were the
						GM of.
					</p>
					<p>
						Currently, there are three ways to change teams: (1) do a really bad
						job and the owner will fire you; (2) do a really good job and other
						teams may try to hire you after the playoffs end; and (3) enable{" "}
						<a href={helpers.leagueUrl(["god_mode"])}>God Mode</a> and go to
						Tools &gt; Switch Team.
					</p>
					<p>
						If you do change teams in God Mode, the one listed here for a given
						season will be the team you controlled when the playoffs ended.
					</p>
					<Championships
						history={teamHistories.flatMap((row) => row.history)}
					/>
					{execAwards.length > 0 ? (
						<HideableSection pageName="GmHistory" title="Executive of the Year">
							<ul className="list-unstyled">
								{execAwards.map((award) => (
									<li key={award.season}>
										<a href={helpers.leagueUrl(["history", award.season])}>
											{award.season}
										</a>{" "}
										-{" "}
										<a
											href={helpers.leagueUrl([
												"roster",
												`${award.abbrev}_${award.tid}`,
												award.season,
											])}
										>
											{award.region} {award.name}
										</a>
									</li>
								))}
							</ul>
						</HideableSection>
					) : null}
					{vsGms && vsGms.length > 0 ? (
						<HideableSection pageName="GmHistory" title="You vs the AI GMs">
							<VsGms rows={vsGms} />
						</HideableSection>
					) : null}
					<HideableSection title="Players">
						<Players gmHistory players={players} stats={stats} tid={userTid} />
					</HideableSection>
				</div>
			</div>
		</>
	);
};

export default GmHistory;
