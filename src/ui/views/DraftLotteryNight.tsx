// Draft Lottery Night & Combine setting: the staged reveal of a lottery that has already been run (the worker ran it once,
// as without the setting). Purely presentational: the order, odds, jumps and reactions all come from the saved result.
import clsx from "clsx";
import type { ReactNode } from "react";
import {
	formatOdds,
	getLotteryNightRows,
	lotteryReaction,
	lotteryRecap,
	moveText,
	type LotteryNightRow,
} from "../../common/lotteryNight.ts";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";

type Teams = NonNullable<View<"draftLottery">["lotteryNightTeams"]>;

const TeamLogo = ({
	team,
	size,
}: {
	team: Teams[number] | undefined;
	size: number;
}) =>
	team?.imgURL ? (
		<img
			alt=""
			src={team.imgURL}
			style={{ width: size, height: size, objectFit: "contain" }}
		/>
	) : (
		<div style={{ width: size, height: size }} />
	);

const PickBadge = ({
	pick,
	team,
	size,
}: {
	pick: number;
	team: Teams[number] | undefined;
	size: number;
}) => (
	<div
		className="d-flex align-items-center justify-content-center fw-bold rounded-circle flex-shrink-0"
		style={{
			width: size,
			height: size,
			fontSize: size * 0.42,
			backgroundColor: team?.colors[0] ?? "#666",
			color: team?.colors[1] ?? "#fff",
			border: `2px solid ${team?.colors[2] ?? "#fff"}`,
		}}
	>
		{pick}
	</div>
);

const MoveBadge = ({ row }: { row: LotteryNightRow }) => (
	<span
		className={clsx(
			"badge",
			row.move > 0 ? "bg-success" : row.move < 0 ? "bg-danger" : "bg-secondary",
		)}
	>
		{moveText(row)}
	</span>
);

const teamName = (teams: Teams, tid: number) =>
	teams[tid] ? `${teams[tid].region} ${teams[tid].name}` : "?";

const Stage = ({
	row,
	teams,
	season,
	userTid,
}: {
	row: LotteryNightRow;
	teams: Teams;
	season: number;
	userTid: number;
}) => {
	const team = teams[row.tid];
	const user = row.tid === userTid;
	return (
		<div
			className={clsx("card mb-3", user ? "border-info" : undefined)}
			style={{ borderLeft: `8px solid ${team?.colors[0] ?? "#666"}` }}
			data-testid="lottery-night-stage"
		>
			<div className="card-body d-flex flex-wrap align-items-center gap-3">
				<PickBadge pick={row.pick} team={team} size={64} />
				<TeamLogo team={team} size={56} />
				<div className="flex-grow-1" style={{ minWidth: 0 }}>
					<div className="text-body-secondary small">
						The {helpers.ordinal(row.pick)} pick in the {season} draft goes to
					</div>
					<div className="fs-4 fw-bold text-truncate">
						{teamName(teams, row.tid)}
						{row.originalTid !== row.tid ? (
							<span className="fs-6 fw-normal text-body-secondary">
								{" "}
								(via {teamName(teams, row.originalTid)})
							</span>
						) : null}
					</div>
					<div className="d-flex flex-wrap gap-2 align-items-center mt-1">
						<MoveBadge row={row} />
						{row.oddsPick !== undefined ? (
							<span className="small text-body-secondary">
								{formatOdds(row.oddsPick)} odds of this pick going in
							</span>
						) : null}
					</div>
					<div className="mt-2 fst-italic">
						{lotteryReaction({
							row,
							team: teams[row.tid] ?? {},
							season,
							user,
						})}
					</div>
				</div>
			</div>
		</div>
	);
};

const Recap = ({ rows, teams }: { rows: LotteryNightRow[]; teams: Teams }) => {
	const recap = lotteryRecap(rows, (tid) => teamName(teams, tid));
	const list = (xs: LotteryNightRow[]) =>
		xs.length === 0 ? (
			<p className="text-body-secondary mb-0">Nobody</p>
		) : (
			<ul className="list-unstyled mb-0">
				{xs.slice(0, 4).map((r) => (
					<li key={r.index} className="d-flex align-items-center gap-2 mb-1">
						<TeamLogo team={teams[r.tid]} size={24} />
						<span>
							{teamName(teams, r.tid)}: {helpers.ordinal(r.slot)} →{" "}
							<b>{helpers.ordinal(r.pick)}</b>
						</span>
					</li>
				))}
			</ul>
		);
	return (
		<div className="card mb-3" data-testid="lottery-night-recap">
			<div className="card-body">
				<h3 className="card-title">Lottery winners and losers</h3>
				<p>{recap.summary}</p>
				<div className="row g-3">
					<div className="col-12 col-sm-6">
						<h4 className="text-success">Winners</h4>
						{list(recap.winners)}
					</div>
					<div className="col-12 col-sm-6">
						<h4 className="text-danger">Losers</h4>
						{list(recap.losers)}
					</div>
				</div>
				{recap.longestShot ? (
					<p className="mt-2 mb-0 small text-body-secondary">
						Longest shot: the {teamName(teams, recap.longestShot.tid)} landed
						No. {recap.longestShot.pick} with{" "}
						{formatOdds(recap.longestShot.oddsPick)} odds.
					</p>
				) : null}
			</div>
		</div>
	);
};

export const LotteryNight = ({
	result,
	order,
	numRevealed,
	probs,
	teams,
	season,
	userTid,
	controls,
}: {
	// Lottery result with every pick known, in pre-lottery order
	result: { tid: number; originalTid: number; pick: number }[];
	// Reveal order (indexes of result), last pick first
	order: number[];
	numRevealed: number;
	probs: (number | undefined)[][] | undefined;
	teams: Teams;
	season: number;
	userTid: number;
	controls?: ReactNode;
}) => {
	const rows = getLotteryNightRows(result, probs);
	const byIndex = new Map(rows.map((r) => [r.index, r]));
	const revealed = order
		.slice(0, numRevealed)
		.map((i) => byIndex.get(i)!)
		.filter(Boolean);
	const latest = revealed.at(-1);
	const remaining = order.slice(numRevealed).map((i) => byIndex.get(i)!);
	const done = numRevealed >= order.length;

	return (
		<div className="mb-3" style={{ maxWidth: 900 }}>
			<h2>{season} Draft Lottery Night</h2>
			{controls}
			{!done ? (
				<div className="mb-3" aria-live="polite">
					{remaining.length === 2 ? (
						<div className="alert alert-warning py-2 mb-2">
							Down to the final two: the {teamName(teams, remaining[0]!.tid)}{" "}
							and the {teamName(teams, remaining[1]!.tid)}. One of them gets the
							No. 1 pick.
						</div>
					) : null}
					<div className="small text-body-secondary mb-1">
						Still in the running ({remaining.length}), with their odds of the
						No. 1 pick going in:
					</div>
					<div className="d-flex flex-wrap gap-2">
						{remaining
							.toSorted((a, b) => a.slot - b.slot)
							.map((r) => (
								<span
									key={r.index}
									className="d-inline-flex align-items-center gap-1 border rounded px-2 py-1 small"
									style={{ borderColor: teams[r.tid]?.colors[0] }}
								>
									<TeamLogo team={teams[r.tid]} size={18} />
									{teams[r.tid]?.region ?? "?"}
									{r.oddsFirst !== undefined ? (
										<span className="text-body-secondary">
											{formatOdds(r.oddsFirst)}
										</span>
									) : null}
								</span>
							))}
					</div>
				</div>
			) : null}
			{latest ? (
				<Stage
					key={latest.index}
					row={latest}
					teams={teams}
					season={season}
					userTid={userTid}
				/>
			) : null}
			{revealed.length > 1 ? (
				<ul className="list-unstyled mb-3">
					{revealed
						.slice(0, -1)
						.toReversed()
						.map((r) => (
							<li
								key={r.index}
								className={clsx(
									"d-flex flex-wrap align-items-center gap-2 py-1 border-bottom",
									r.tid === userTid ? "table-info" : undefined,
								)}
							>
								<PickBadge pick={r.pick} team={teams[r.tid]} size={28} />
								<TeamLogo team={teams[r.tid]} size={24} />
								<span className="fw-bold">{teamName(teams, r.tid)}</span>
								<MoveBadge row={r} />
							</li>
						))}
				</ul>
			) : null}
			{done ? <Recap rows={rows} teams={teams} /> : null}
		</div>
	);
};
