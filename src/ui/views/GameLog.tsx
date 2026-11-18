import clsx from "clsx";
import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import useClickable from "../hooks/useClickable.tsx";
import type { View, Game } from "../../common/types.ts";
import { bySport } from "../../common/sportFunctions.ts";
import getWinner from "../../common/getWinner.ts";
import formatScoreWithShootout from "../../common/formatScoreWithShootout.ts";
import { BoxScoreWrapper } from "../components/BoxScoreWrapper.tsx";
import { GameHype } from "../components/GameHype.tsx";
import { BoxScoreRow } from "../components/BoxScoreRow.tsx";
import { useLocal } from "../util/local.ts";
import { isValidElement, useState, type ReactNode } from "react";
import { buildPlayByPlayEntries } from "../components/BoxScorePlayByPlay.basketball.tsx";
import { downloadFile, jsonFileBytes } from "../util/downloadFile.ts";
import { toWorker } from "../util/toWorker.ts";
import { GAME_ACRONYM } from "../../common/constants.ts";

const StatsRow = ({
	p,
	...props
}: {
	i: number;
	p: unknown;
	season: number;
}) => {
	const { clicked, toggleClicked } = useClickable();

	const classes = clsx({
		"table-warning": clicked,
	});
	return (
		<BoxScoreRow className={classes} onClick={toggleClicked} p={p} {...props} />
	);
};

// A line of play-by-play as plain text (the page renders it with links and notes)
const plainText = (node: ReactNode): string => {
	if (node === null || node === undefined || typeof node === "boolean") {
		return "";
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(plainText).join("");
	}
	if (isValidElement(node)) {
		const inner = plainText((node.props as { children?: ReactNode }).children);
		// (a note or a second sentence on its own line reads as a new sentence)
		return typeof node.type === "string" && BLOCK_TAGS.has(node.type)
			? ` ${inner} `
			: inner;
	}
	return "";
};
const BLOCK_TAGS = new Set(["div", "p", "br", "li", "span"]);

// "Download game data": one JSON file with everything stored for the game (worker api exportGame: the box score with
// every player's line, the scoring summary...) and its play-by-play, as the events the sim logged and as the text the
// Play-By-Play tab shows (period, clock, team, score after the play), when the game's play-by-play was stored
const DownloadGame = ({ boxScore }: { boxScore: any }) => {
	const [status, setStatus] = useState<
		"idle" | "working" | "done" | "noPbp" | "error"
	>("idle");
	const download = async () => {
		setStatus("working");
		try {
			const { leagueName, game, playByPlay } = await toWorker(
				"main",
				"exportGame",
				{ gid: boxScore.gid },
			);
			const teams = boxScore.teams.map((t: any) => ({
				tid: t.tid,
				region: t.region,
				name: t.name,
				abbrev: t.abbrev,
			}));
			let lines:
				| {
						period: number;
						clock: string | undefined;
						team: string | undefined;
						text: string;
						score: Record<string, number>;
						pids: number[];
				  }[]
				| undefined;
			if (__SPORT === "basketball" && boxScore.pbp) {
				try {
					lines = buildPlayByPlayEntries(boxScore).map((e) => ({
						period: e.period,
						clock: e.time,
						team: e.t === undefined ? undefined : teams[e.t]?.abbrev,
						text: plainText(e.text).replace(/\s+/g, " ").trim(),
						score: {
							[teams[0].abbrev]: e.score[0],
							[teams[1].abbrev]: e.score[1],
						},
						pids: e.pids,
					}));
				} catch (error) {
					console.error(error);
				}
			}
			const file = {
				kind: "game",
				version: 1,
				sport: __SPORT,
				exported: new Date().toISOString(),
				// (teams[0] is the home team, as in the game)
				teams,
				game,
				playByPlay: playByPlay
					? {
							lines,
							players: playByPlay.players,
							events: playByPlay.events,
							rivalry: playByPlay.rivalry,
							context: playByPlay.context,
						}
					: null,
			};
			downloadFile(
				`${GAME_ACRONYM}_${leagueName}_game_${game.season}_${teams[1].abbrev}_at_${teams[0].abbrev}_${game.gid}.json`.replace(
					/[^\w.-]/g,
					"_",
				),
				jsonFileBytes(file, 1),
				"application/json",
			);
			setStatus(playByPlay ? "done" : "noPbp");
		} catch (error) {
			console.error(error);
			setStatus("error");
		}
	};
	return (
		<div className="d-flex flex-wrap align-items-center gap-2 mt-3">
			<button
				type="button"
				className="btn btn-sm btn-secondary"
				disabled={status === "working"}
				onClick={download}
			>
				Download game data (JSON)
			</button>
			<span className="small text-body-secondary" role="status">
				{status === "working"
					? "Preparing..."
					: status === "done"
						? "Downloaded: box score and play-by-play."
						: status === "noPbp"
							? "Downloaded the box score. No play-by-play was stored for this game."
							: status === "error"
								? "Could not make the file."
								: "Box score, every player's line and the play-by-play."}
			</span>
		</div>
	);
};

const findPrevNextGids = (games: Game[], currentGid: number) => {
	let prevGid;
	let nextGid;
	let currentGidInList = false;

	for (const [i, game] of games.entries()) {
		if (game.gid === currentGid) {
			currentGidInList = true;
			nextGid = games[i - 1]?.gid;
			prevGid = games[i + 1]?.gid;
			break;
		}
	}

	return { currentGidInList, prevGid, nextGid };
};

export const NoGamesMessage = ({
	warnAboutDelete,
}: {
	warnAboutDelete: boolean;
}) => (
	<div className="alert alert-info d-inline-block" style={{ maxWidth: 600 }}>
		No games found for this season.
		{warnAboutDelete ? (
			<>
				{" "}
				By default, box scores from old seasons are automatically deleted after
				2 seasons. You can edit this behavior with the{" "}
				<a href={helpers.leagueUrl(["settings"])}>
					Save Old Box Scores setting on the League Settings page
				</a>
				.
			</>
		) : null}
	</div>
);

const GamesList = ({
	currentSeason,
	gid,
	gamesList,
	season,
	team,
	tid,
}: {
	currentSeason: number;
	gamesList: View<"gameLog">["gamesList"];
	gid?: number;
	season: number;
	team: View<"gameLog">["team"];
	tid: number;
}) => {
	if (season < currentSeason && gamesList.games.length === 0) {
		return <NoGamesMessage warnAboutDelete />;
	}

	// The list is in a narrow column next to the box score. If a row is still too wide for it (very narrow column), scroll inside the list,
	// never the page
	return (
		<div className="table-responsive">
			<table className="table table-striped table-borderless table-sm game-log-list mb-0">
				<thead>
					<tr>
						<th>Opp</th>
						<th>W/L</th>
						<th>Score</th>
					</tr>
				</thead>
				<tbody>
					{gamesList.tid !== tid ? (
						<tr>
							<td colSpan={3}>Loading...</td>
						</tr>
					) : (
						gamesList.games.map((gm) => {
							const home = gm.teams[0].tid === tid;
							const user = home ? 0 : 1;
							const other = home ? 1 : 0;

							const winner = getWinner(gm.teams);
							const result =
								winner === user ? "W" : winner === other ? "L" : "T";

							const overtimeText = helpers.overtimeText(
								gm.overtimes,
								gm.numPeriods,
							);
							const overtimes =
								overtimeText === ""
									? ""
									: __SPORT === "baseball"
										? ` (${overtimeText})`
										: ` ${overtimeText}`;

							const oppAbbrev = gamesList.abbrevs[gm.teams[other].tid];

							const url = helpers.leagueUrl([
								"game_log",
								team === "special" ? team : helpers.getTeamUrlPart(team),
								season,
								gm.gid,
							]);

							return (
								<tr
									key={gm.gid}
									className={gm.gid === gid ? "table-info" : undefined}
								>
									<td className="game-log-cell">
										<a href={url} data-no-scroll-reset>
											{gm.neutralSite || home ? "" : "@"}
											{oppAbbrev}
										</a>
									</td>
									<td className={clsx("game-log-cell")}>
										<a
											href={url}
											data-no-scroll-reset
											className={
												gm.forceWin !== undefined ? "alert-god-mode" : undefined
											}
										>
											{result}
										</a>
									</td>
									<td className="game-log-cell game-log-cell-score">
										<a href={url} data-no-scroll-reset>
											{/* The score stays on one line, the overtime text goes to a second line when the column is too narrow for both */}
											<span className="text-nowrap">
												{formatScoreWithShootout(
													gm.teams[user],
													gm.teams[other],
												)}
											</span>
											{overtimes}
										</a>
									</td>
								</tr>
							);
						})
					)}
				</tbody>
			</table>
		</div>
	);
};

const GameLog = ({
	boxScore,
	gamesList,
	season,
	team,
	tid,
}: View<"gameLog">) => {
	useTitleBar({
		title: "Game Log",
		dropdown: {
			fields: [
				{
					key: "team",
					options: {
						type: "teams",
						allStarGame: bySport({ basketball: true, default: false }),
					},
					value: team,
				},
				{ key: "season", options: { type: "seasons" }, value: season },
			],
			view: "gameLog",
			params: { gid: boxScore.gid },
		},
	});

	const { season: currentSeason } = useLocal(["season"]);

	const { currentGidInList, nextGid, prevGid } = findPrevNextGids(
		gamesList.games,
		boxScore.gid,
	);

	const noGamesAndNoBoxScore =
		season < currentSeason && gamesList.games.length === 0 && boxScore.gid < 0;

	return (
		<>
			{tid >= 0 ? (
				<MoreLinks type="team" page="game_log" tid={tid} season={season} />
			) : null}

			{noGamesAndNoBoxScore ? (
				<NoGamesMessage warnAboutDelete />
			) : (
				<>
					<p />
					<div className="row">
						<div className="col-md-10">
							{boxScore.gid >= 0 ? <GameHype gid={boxScore.gid} /> : null}
							{boxScore.gid >= 0 ? (
								<BoxScoreWrapper
									boxScore={boxScore}
									currentGidInList={currentGidInList}
									nextGid={nextGid}
									prevGid={prevGid}
									showNextPrev
									sportState={undefined}
									tid={tid}
									Row={StatsRow}
								/>
							) : null}
							{boxScore.gid >= 0 ? (
								<DownloadGame key={boxScore.gid} boxScore={boxScore} />
							) : (
								<p>Select a game from the menu to view a box score.</p>
							)}
						</div>

						<div className="col-md-2 mt-3 mt-md-0">
							<GamesList
								currentSeason={currentSeason}
								gamesList={gamesList}
								gid={boxScore.gid}
								season={season}
								team={team}
								tid={tid}
							/>
						</div>
					</div>
				</>
			)}
		</>
	);
};

export default GameLog;
