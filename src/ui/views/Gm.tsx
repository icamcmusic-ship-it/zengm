import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { GmTraitBars } from "../components/GmCard.tsx";
import { StaffFace } from "../components/StaffFace.tsx";

const REASONS = {
	fired: "Fired",
	retired: "Retired",
	left: "Left",
};

const playoffText = (roundsWon: number, numRounds: number) => {
	if (roundsWon < 0) {
		return "";
	}
	if (numRounds > 0 && roundsWon >= numRounds) {
		return "Champion";
	}
	return roundsWon === 0
		? "Made playoffs"
		: `Won ${roundsWon} round${roundsWon > 1 ? "s" : ""}`;
};

const Gm = ({
	age,
	born,
	career,
	currentTid,
	execAwards,
	face,
	hof,
	hotSeatLabel,
	name,
	notableTrades,
	numTrades,
	retiredYear,
	seasons,
	status,
	styleLabels,
	tenures,
	traits,
	gmid,
}: View<"gm">) => {
	useTitleBar({ title: name });

	const won =
		seasons.reduce((sum, row) => sum + row.won, 0) + (career?.won ?? 0);
	const lost =
		seasons.reduce((sum, row) => sum + row.lost, 0) + (career?.lost ?? 0);
	const titles =
		seasons.filter(
			(row) =>
				row.playoffRoundsWon >= 0 && row.playoffRoundsWon >= row.numRounds,
		).length + (career?.titles ?? 0);
	const current = tenures.find(
		(x) => x.end === undefined && x.tid === currentTid,
	);

	return (
		<>
			<div className="d-flex flex-wrap gap-3 mb-3" data-testid="gm-profile">
				{face ? (
					<div style={{ width: 120, height: 180 }}>
						<StaffFace face={face} age={age} seed={gmid} />
					</div>
				) : null}
				<div style={{ flex: "1 1 280px", minWidth: 0 }}>
					<div>
						<b>
							{status === "employed" && current
								? `General manager of the ${current.name}`
								: status === "retired"
									? `Retired (${retiredYear})`
									: status === "available"
										? "Available (on the GM market)"
										: "General manager"}
						</b>
						{hotSeatLabel ? (
							<span className="ms-2">· {hotSeatLabel}</span>
						) : null}
					</div>
					<div>
						Age {age}, born {born.year} in {born.loc}
					</div>
					<div>
						Career: {won}-{lost}
						{titles > 0 ? `, ${titles} title${titles > 1 ? "s" : ""}` : ""}
						{execAwards.length > 0
							? `, Executive of the Year ${execAwards.join(", ")}`
							: ""}
						{hof !== undefined ? `, Hall of Fame (${hof})` : ""}
					</div>
					{styleLabels.length > 0 ? (
						<div className="text-body-secondary">{styleLabels.join(" · ")}</div>
					) : null}
					<p className="mt-2 mb-0">
						<a href={helpers.leagueUrl(["front_offices"])}>Front Offices</a> ·{" "}
						<a href={helpers.leagueUrl(["gm_history"])}>Your GM History</a>
					</p>
				</div>
				<div style={{ flex: "0 1 360px" }}>
					<GmTraitBars traits={traits} />
				</div>
			</div>

			<h2>Tenures</h2>
			<div className="table-responsive">
				<table
					className="table table-sm table-striped"
					data-testid="gm-tenures"
				>
					<thead>
						<tr>
							<th>Team</th>
							<th>Seasons</th>
							<th>W-L</th>
							<th>Playoffs</th>
							<th>Titles</th>
							<th>How it ended</th>
						</tr>
					</thead>
					<tbody>
						{tenures.map((x, i) => (
							<tr key={i}>
								<td>
									<a
										href={helpers.leagueUrl([
											"team_history",
											`${x.abbrev}_${x.tid}`,
										])}
									>
										{x.name}
									</a>
								</td>
								<td>
									{x.start}–{x.end ?? ""}
								</td>
								<td>
									{x.won}-{x.lost}
								</td>
								<td>{x.playoffs}</td>
								<td>{x.titles}</td>
								<td>
									{x.end === undefined
										? "Current"
										: x.reason
											? REASONS[x.reason]
											: ""}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h2>Career</h2>
			{seasons.length === 0 ? (
				<p>
					{career
						? `${career.seasons} seasons: ${career.won}-${career.lost}, ${career.playoffs} playoff appearances, ${career.titles} titles (season by season results are not kept after retirement).`
						: "No complete seasons yet."}
				</p>
			) : (
				<div className="table-responsive">
					<table
						className="table table-sm table-striped"
						data-testid="gm-career"
					>
						<thead>
							<tr>
								<th>Season</th>
								<th>Team</th>
								<th>W-L</th>
								<th title="Expected wins at the start of the season">Exp. W</th>
								<th>Playoffs</th>
								<th>Awards</th>
							</tr>
						</thead>
						<tbody>
							{seasons.map((row) => (
								<tr key={`${row.season}-${row.tid}`}>
									<td>
										<a href={helpers.leagueUrl(["history", row.season])}>
											{row.season}
										</a>
									</td>
									<td>
										<a
											href={helpers.leagueUrl([
												"roster",
												`${row.abbrev}_${row.tid}`,
												row.season,
											])}
										>
											{row.abbrev}
										</a>
									</td>
									<td>
										{row.won}-{row.lost}
										{row.tied > 0 ? `-${row.tied}` : ""}
										{row.otl > 0 ? `-${row.otl}` : ""}
										{row.partial ? (
											<span className="text-body-secondary"> (partial)</span>
										) : null}
									</td>
									<td>{row.expWon ?? ""}</td>
									<td>{playoffText(row.playoffRoundsWon, row.numRounds)}</td>
									<td>{row.exec ? "Executive of the Year" : ""}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<h2>Notable trades</h2>
			{notableTrades.length === 0 ? (
				<p>No trades yet.</p>
			) : (
				<>
					<p className="text-body-secondary">
						The biggest of his {numTrades} trade{numTrades === 1 ? "" : "s"}.
					</p>
					<ul data-testid="gm-trades">
						{notableTrades.map((trade) => (
							<li key={trade.eid}>
								<a href={helpers.leagueUrl(["trade_summary", trade.eid])}>
									{trade.season}
								</a>{" "}
								with {trade.otherAbbrev}
								{trade.withUser ? " (you)" : ""}: got{" "}
								{trade.got.join(", ") || "nothing"}; gave{" "}
								{trade.gave.join(", ") || "nothing"}
							</li>
						))}
					</ul>
				</>
			)}
		</>
	);
};

export default Gm;
