import clsx from "clsx";
import { useState } from "react";
import { ProspectLinks } from "./Bracket.tsx";
import { HonorList, postseasonText, type WithSeason } from "./common.tsx";

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

const shortLabel = (label: string) =>
	label === "Preseason"
		? "Pre"
		: label === "Final"
			? "Fin"
			: label.replace("Week ", "");

/**
 * The AP poll, week by week: the Top 25 with each team's move from the previous poll and its first-place votes, others receiving votes, the week's biggest risers and fallers, weeks at No. 1, and every ranked team's poll history.
 */
export const Polls = (props: WithSeason) => {
	const { polls, teams } = props;
	const [index, setIndex] = useState(polls.length - 1);
	const poll = polls[Math.min(index, polls.length - 1)]!;
	const isFinal = poll === polls.at(-1);
	const isFirst = index === 0;
	const name = (t: number) => teams[t]!.school;

	const moves = poll.ranked
		.map((entry, i) => ({
			team: entry.team,
			rank: i + 1,
			diff: entry.prev === undefined ? undefined : entry.prev - (i + 1),
		}))
		.filter((m) => m.diff !== undefined) as {
		team: number;
		rank: number;
		diff: number;
	}[];
	const risers = moves
		.filter((m) => m.diff > 0)
		.sort((a, b) => b.diff - a.diff || a.rank - b.rank)
		.slice(0, 3);
	const fallers = moves
		.filter((m) => m.diff < 0)
		.sort((a, b) => a.diff - b.diff || a.rank - b.rank)
		.slice(0, 3);
	const entered = poll.ranked
		.map((entry, i) => ({ entry, rank: i + 1 }))
		.filter(({ entry }) => entry.prev === undefined);

	return (
		<>
			<div className="d-flex flex-wrap align-items-center gap-2 mb-3">
				<button
					type="button"
					className="btn btn-sm btn-light-bordered"
					disabled={isFirst}
					onClick={() => setIndex(index - 1)}
					aria-label="Previous poll"
				>
					‹ Prev
				</button>
				<select
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					value={index}
					onChange={(event) => setIndex(Number(event.target.value))}
					aria-label="Poll"
					data-testid="poll-select"
				>
					{polls.map((p, i) => (
						<option key={i} value={i}>
							{p.label}
							{p.ranked[0] ? `: ${name(p.ranked[0].team)}` : ""}
						</option>
					))}
				</select>
				<button
					type="button"
					className="btn btn-sm btn-light-bordered"
					disabled={isFinal}
					onClick={() => setIndex(index + 1)}
					aria-label="Next poll"
				>
					Next ›
				</button>
				<span className="text-body-secondary small">
					{isFirst
						? "Voted before a game was played."
						: isFinal
							? "Final poll, released before the NCAA tournament."
							: `After week ${poll.week} of the regular season.`}{" "}
					62 voters.
				</span>
			</div>
			<div className="row">
				<div className="col-12 col-lg-8">
					<div className="table-responsive">
						<table
							className="table table-striped table-borderless table-sm table-nonfluid"
							data-testid="poll-table"
						>
							<thead>
								<tr>
									<th>Rank</th>
									{isFirst ? null : (
										<th title="Change from the previous poll">+/-</th>
									)}
									<th>Team</th>
									<th>Record</th>
									<th>Conf</th>
									<th title="Points (first-place votes)">Pts</th>
									{isFinal ? <th>Postseason</th> : null}
									<th>Prospects</th>
								</tr>
							</thead>
							<tbody>
								{poll.ranked.map((entry, i) => {
									const t = teams[entry.team]!;
									return (
										<tr key={entry.team}>
											<td>{i + 1}</td>
											{isFirst ? null : (
												<td className="text-nowrap">
													<Change rank={i + 1} prev={entry.prev} />
												</td>
											)}
											<td className="text-nowrap">{t.school}</td>
											<td>
												{entry.w}-{entry.l}
											</td>
											<td className="text-nowrap">{t.conf}</td>
											<td className="text-nowrap">
												{entry.pts}
												{entry.firstPlace > 0 ? ` (${entry.firstPlace})` : null}
											</td>
											{isFinal ? (
												<td className="text-nowrap">{postseasonText(t)}</td>
											) : null}
											<td>
												<ProspectLinks
													prospects={props.prospectsBySchool[t.school] ?? []}
												/>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					{poll.others.length > 0 ? (
						<p className="small" data-testid="poll-others">
							<b>Others receiving votes:</b>{" "}
							{poll.others.map((o) => `${name(o.team)} ${o.pts}`).join(", ")}
						</p>
					) : null}
					{poll.dropped.length > 0 ? (
						<p className="small">
							<b>Dropped out:</b> {poll.dropped.map(name).join(", ")}
						</p>
					) : null}
				</div>
				<div className="col-12 col-lg-4">
					{isFirst ? null : (
						<>
							<h3>Movers</h3>
							<ul className="list-unstyled" data-testid="poll-movers">
								{risers.map((m) => (
									<li key={m.team}>
										<span className="text-success">▲{m.diff}</span>{" "}
										{name(m.team)} (to No. {m.rank})
									</li>
								))}
								{fallers.map((m) => (
									<li key={m.team}>
										<span className="text-danger">▼{-m.diff}</span>{" "}
										{name(m.team)} (to No. {m.rank})
									</li>
								))}
								{entered.length > 0 ? (
									<li>
										<b>In:</b>{" "}
										{entered
											.map(({ entry, rank }) => `${name(entry.team)} (${rank})`)
											.join(", ")}
									</li>
								) : null}
								{risers.length + fallers.length + entered.length === 0 ? (
									<li className="text-body-secondary">Nobody moved.</li>
								) : null}
							</ul>
						</>
					)}
					<h3>Weeks at No. 1</h3>
					<ul className="list-unstyled" data-testid="poll-no1">
						{props.weeksAtNo1.map((row) => (
							<li key={row.team}>
								{name(row.team)}: {row.weeks}
							</li>
						))}
					</ul>
					<HonorList
						honors={props.honorWinners}
						filter={/All-American/}
						title="All-Americans (prospects)"
					/>
				</div>
			</div>
			<h3>Poll history</h3>
			<p className="text-body-secondary small">
				Every team that was ranked, and where, in each of the {polls.length}{" "}
				polls. Click a column to see that poll.
			</p>
			<div className="table-responsive">
				<table
					className="table table-striped table-borderless table-sm table-nonfluid text-center"
					data-testid="poll-history"
				>
					<thead>
						<tr>
							<th className="text-start">Team</th>
							<th title="Best rank">Best</th>
							<th title="Polls ranked">Wks</th>
							{polls.map((p, i) => (
								<th
									key={i}
									title={p.label}
									className={clsx("cursor-pointer", {
										"table-info": i === index,
									})}
									onClick={() => setIndex(i)}
								>
									{shortLabel(p.label)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{props.pollHistory.map((row) => (
							<tr key={row.team}>
								<td className="text-start text-nowrap">{name(row.team)}</td>
								<td>{row.best}</td>
								<td>{row.weeks}</td>
								{row.ranks.map((rank, i) => (
									<td
										key={i}
										className={clsx({
											"fw-bold": rank === 1,
											"table-info": i === index,
										})}
									>
										{rank > 0 ? rank : ""}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
};
