import { Fragment, useState } from "react";
import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { toWorker } from "../util/toWorker.ts";
import { useLocal } from "../util/local.ts";
import allowForceTie from "../../common/allowForceTie.ts";
import { Dropdown } from "react-bootstrap";
import { ForceWin } from "../components/ForceWin.tsx";
import { ScoreBox } from "../components/ScoreBox/index.tsx";
import { helpers } from "../util/helpers.ts";
import { HypeLine, useHypeGids } from "../components/GameHype.tsx";

const Schedule = ({
	backToBack,
	canLiveSimFirstGame,
	completed,
	elam,
	elamASG,
	showDays,
	tid,
	ties,
	topPlayers,
	upcoming,
}: View<"schedule">) => {
	useTitleBar({
		title: "Schedule",
		dropdown: {
			fields: [{ key: "team", options: { type: "teams" }, value: tid }],
			view: "schedule",
		},
	});

	const { gameSimInProgress, godMode, phase, userTid } = useLocal([
		"gameSimInProgress",
		"godMode",
		"phase",
		"userTid",
	]);

	// Hype of the next games only: it is judged on what is known today
	const hype = useHypeGids(
		upcoming
			.slice(0, 8)
			.filter((game) => game.teams[0].tid >= 0 && game.teams[1].tid >= 0)
			.map((game) => game.gid),
	);

	const [forcingAll, setForcingAll] = useState(false);
	const [forceWinKey, setForceWinKey] = useState(0);

	const handleForceAll =
		(type: "win" | "lose" | "tie" | "none") => async () => {
			setForcingAll(true);
			await toWorker("main", "setForceWinAll", { tid, type });
			setForceWinKey((key) => key + 1);
			setForcingAll(false);
		};

	return (
		<>
			<MoreLinks type="team" page="schedule" tid={tid} />
			{godMode ? (
				<Dropdown className="mb-3">
					<Dropdown.Toggle
						variant="god-mode"
						id="dropdown-basic"
						disabled={forcingAll}
					>
						Force all
					</Dropdown.Toggle>

					<Dropdown.Menu>
						<Dropdown.Item onClick={handleForceAll("win")}>Win</Dropdown.Item>
						<Dropdown.Item onClick={handleForceAll("lose")}>Lose</Dropdown.Item>
						{allowForceTie({
							// Doesn't matter what team, we're just checking in general
							homeTid: 0,
							awayTid: 0,
							elam,
							elamASG,
							phase,
							ties,
						}) ? (
							<Dropdown.Item onClick={handleForceAll("tie")}>Tie</Dropdown.Item>
						) : null}
						<Dropdown.Item onClick={handleForceAll("none")}>
							Reset
						</Dropdown.Item>
					</Dropdown.Menu>
				</Dropdown>
			) : null}
			<div className="d-flex flex-wrap" style={{ gap: "2rem" }}>
				<div style={{ maxWidth: 510 }} className="flex-grow-1">
					<h2>Upcoming Games</h2>
					<ul className="list-group">
						{upcoming.map((game, i) => {
							const tradeDeadline =
								game.teams[0].tid === -3 && game.teams[1].tid === -3;
							const canWatch =
								game.teams[0].playoffs || (canLiveSimFirstGame && i === 0);

							const actions =
								canWatch && tradeDeadline
									? undefined
									: [
											canWatch
												? {
														disabled: gameSimInProgress,
														highlight:
															tid !== userTid &&
															(game.teams[0].tid === userTid ||
																game.teams[1].tid === userTid),
														text: (
															<>
																Watch
																<br />
																game
															</>
														),
														onClick: () =>
															toWorker("actions", "liveGame", game.gid),
													}
												: {
														disabled: gameSimInProgress,
														highlight:
															tid !== userTid &&
															(game.teams[0].tid === userTid ||
																game.teams[1].tid === userTid),
														text: (
															<>
																Sim
																<br />
																to
																<br />
																game
															</>
														),
														onClick: () => {
															toWorker("actions", "simToGame", game.gid);
														},
													},
										];

							const allowTie = allowForceTie({
								homeTid: game.teams[0].tid,
								awayTid: game.teams[1].tid,
								elam,
								elamASG,
								phase,
								ties,
							});

							const otherTid =
								game.teams[0].tid === tid
									? game.teams[1].tid
									: game.teams[0].tid;

							// Realistic schedule length: the day, and the days off since the team's previous game in the list
							let dayInfo = null;
							if (showDays) {
								let prevDay: number | undefined;
								for (let j = i - 1; j >= 0; j--) {
									const prev = upcoming[j]!;
									if (prev.teams[0].tid >= 0 && prev.teams[1].tid >= 0) {
										prevDay = prev.day;
										break;
									}
								}
								const daysOff =
									prevDay !== undefined && game.teams[0].tid >= 0
										? game.day - prevDay - 1
										: undefined;
								dayInfo = (
									<div
										className="small text-body-secondary mb-1"
										data-testid="schedule-day"
									>
										Day {game.day}
										{daysOff !== undefined && daysOff > 0
											? ` · ${daysOff} ${daysOff === 1 ? "day" : "days"} off`
											: null}
									</div>
								);
							}

							return (
								<Fragment key={game.gid}>
									{dayInfo}
									<ScoreBox
										game={{
											// Leave out forceTie, since ScoreBox wants the value for finished games
											finals: game.finals,
											gid: game.gid,
											season: game.season,
											teams: game.teams,
										}}
										playersUpcoming={
											topPlayers.type === "byTid"
												? topPlayers.playersByTid[otherTid]
												: topPlayers.playersByGid[game.gid]
										}
										playersUpcomingAbbrev={topPlayers.type === "byTid"}
										actions={actions}
									/>
									<HypeLine h={hype[game.gid]} className="mt-1" />
									{backToBack?.[game.gid]?.includes(tid) ? (
										<div
											className="mt-1 small text-body-secondary"
											data-testid="back-to-back"
											title="Second night of a back-to-back: a little more fatigue and injury risk, and some teams rest veterans"
										>
											<span className="badge bg-secondary">B2B</span> Second
											night of a back-to-back
											{backToBack[game.gid]!.length > 1
												? " for both teams"
												: null}
										</div>
									) : null}
									<ForceWin
										key={forceWinKey}
										allowTie={allowTie}
										className="mb-3"
										game={game}
									/>
								</Fragment>
							);
						})}
					</ul>
				</div>
				<div style={{ maxWidth: 510 }} className="flex-grow-1">
					<h2>Completed Games</h2>
					{completed.map((game) => (
						<ScoreBox
							boxScoreTeamOverride={helpers.getTeamUrlPart(tid)}
							className="mb-3"
							key={game.gid}
							game={game}
						/>
					))}
				</div>
			</div>
		</>
	);
};

export default Schedule;
