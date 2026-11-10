import { useState } from "react";
import type { WithSeason } from "./common.tsx";

const quad = (q: [number, number]) => `${q[0]}-${q[1]}`;

// Record on Selection Sunday (the quadrants cover every game before the NCAA tournament and the NIT)
const record = (t: WithSeason["teams"][number]) =>
	`${t.net.quads.reduce((sum, q) => sum + q[0], 0)}-${t.net.quads.reduce((sum, q) => sum + q[1], 0)}`;

const BubbleList = ({
	title,
	list,
	props,
	testid,
}: {
	title: string;
	list: number[];
	props: WithSeason;
	testid: string;
}) => (
	<div className="col-12 col-sm-6 col-xl-3 mb-3">
		<h3>{title}</h3>
		<ul className="list-unstyled mb-0" data-testid={testid}>
			{list.map((team) => {
				const t = props.teams[team]!;
				return (
					<li key={team}>
						<b>{t.school}</b>{" "}
						<span className="text-body-secondary small">
							{record(t)}, {t.conf}, NET {t.net.rank}, Q1{" "}
							{quad(t.net.quads[0]!)}
							{t.ncaaSeed !== undefined ? `, ${t.ncaaSeed} seed` : ""}
						</span>
					</li>
				);
			})}
		</ul>
	</div>
);

const statusText = (t: WithSeason["teams"][number]) =>
	t.ncaaSeed !== undefined
		? `${t.ncaaSeed} seed${t.bid === "auto" ? " (auto)" : ""}`
		: t.nitSeed !== undefined
			? "NIT"
			: "";

/**
 * Selection Sunday: the bubble (last four byes, last four in, first four out, next four out), the teams with a case that were left out, the conference tournament winners that took a bid from the bubble, and the NET-style ranking the committee reads, with records by quadrant.
 */
export const Selection = (props: WithSeason) => {
	const { selection, teams } = props;
	const [showAll, setShowAll] = useState(false);
	const byNet = teams
		.map((t, i) => ({ t, i }))
		.sort((a, b) => a.t.net.rank - b.t.net.rank);
	const shown = showAll ? byNet : byNet.slice(0, 75);
	const numAuto = teams.filter((t) => t.bid === "auto").length;
	return (
		<>
			<p className="text-body-secondary">
				68 teams: {numAuto} conference tournament champions and {68 - numAuto}{" "}
				at-large picks. The last four at-large teams play in the First Four.
			</p>
			<div className="row">
				<BubbleList
					title="Last four byes"
					list={selection.lastFourByes}
					props={props}
					testid="bubble-byes"
				/>
				<BubbleList
					title="Last four in"
					list={selection.lastFourIn}
					props={props}
					testid="bubble-in"
				/>
				<BubbleList
					title="First four out"
					list={selection.firstFourOut}
					props={props}
					testid="bubble-out"
				/>
				<BubbleList
					title="Next four out"
					list={selection.nextFourOut}
					props={props}
					testid="bubble-next"
				/>
			</div>
			<div className="row">
				<div className="col-12 col-lg-6 mb-3">
					<h3>Notable snubs</h3>
					{selection.snubs.length > 0 ? (
						<ul className="list-unstyled mb-0" data-testid="snubs">
							{selection.snubs.map(({ team, reason }) => {
								const t = teams[team]!;
								return (
									<li key={team}>
										<b>{t.school}</b> ({record(t)}): {reason}
									</li>
								);
							})}
						</ul>
					) : (
						<p className="mb-0">Nobody left out had much of a case.</p>
					)}
				</div>
				<div className="col-12 col-lg-6 mb-3">
					<h3>Bid thieves</h3>
					{selection.bidThieves.length > 0 ? (
						<ul className="list-unstyled mb-0" data-testid="bid-thieves">
							{selection.bidThieves.map((team) => {
								const t = teams[team]!;
								return (
									<li key={team}>
										<b>{t.school}</b> ({record(t)}, NET {t.net.rank}) won the{" "}
										{t.conf} tournament and took a bid from the bubble
									</li>
								);
							})}
						</ul>
					) : (
						<p className="mb-0">
							No conference tournament was won by a team that needed it to get
							in at the expense of the bubble.
						</p>
					)}
				</div>
			</div>
			<h3>NET ranking</h3>
			<p className="text-body-secondary small">
				Computed from results on Selection Sunday: margin (capped) and wins,
				both adjusted for the schedule and for where the game was played.
				Quadrants are records by opponent quality: Quadrant 1 is home against
				the NET top 30, neutral against the top 50, away against the top 75.
			</p>
			<div className="table-responsive">
				<table
					className="table table-striped table-borderless table-sm table-nonfluid"
					data-testid="net-table"
				>
					<thead>
						<tr>
							<th>NET</th>
							<th>Team</th>
							<th>Conf</th>
							<th title="Record on Selection Sunday">Record</th>
							<th title="Strength of schedule rank">SOS</th>
							<th title="Quadrant 1 record">Q1</th>
							<th title="Quadrant 2 record">Q2</th>
							<th title="Quadrant 3 record">Q3</th>
							<th title="Quadrant 4 record">Q4</th>
							<th title="Road record">Road</th>
							<th title="AP rank, final poll">AP</th>
							<th>Bid</th>
						</tr>
					</thead>
					<tbody>
						{shown.map(({ t, i }) => (
							<tr key={i}>
								<td>{t.net.rank}</td>
								<td className="text-nowrap">{t.school}</td>
								<td className="text-nowrap">{t.conf}</td>
								<td>{record(t)}</td>
								<td>{t.net.sosRank}</td>
								{t.net.quads.map((q, j) => (
									<td key={j} className="text-nowrap">
										{quad(q)}
									</td>
								))}
								<td className="text-nowrap">
									{t.net.roadW}-{t.net.roadL}
								</td>
								<td>{t.apRank ?? ""}</td>
								<td className="text-nowrap">{statusText(t)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{showAll ? null : (
				<button
					type="button"
					className="btn btn-sm btn-light-bordered mb-3"
					onClick={() => setShowAll(true)}
				>
					Show all {teams.length} teams
				</button>
			)}
		</>
	);
};
