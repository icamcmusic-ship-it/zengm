import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { MyFace } from "../components/MyFace.tsx";
import { COACH_RATING_NAMES } from "../../common/staff.ts";

const TX_TEXT = {
	hired: "Hired by",
	fired: "Fired by",
	reSigned: "Re-signed with",
	left: "Contract expired, left",
	retired: "Retired from",
};

const playoffText = (roundsWon: number, numRounds: number) => {
	if (roundsWon < 0) {
		return "";
	}
	if (numRounds > 0 && roundsWon >= numRounds) {
		return "League champion";
	}
	return roundsWon === 0
		? "Made playoffs"
		: `Won ${roundsWon} playoff round${roundsWon > 1 ? "s" : ""}`;
};

const Coach = ({ awards, coach: c, stats, transactions }: View<"coach">) => {
	useTitleBar({ title: c.name });

	return (
		<>
			<div className="d-flex gap-3 mb-3">
				{c.face ? (
					<div style={{ width: 120, height: 180 }}>
						<MyFace face={c.face} />
					</div>
				) : null}
				<div>
					<div>
						<b>
							{c.tid >= 0
								? c.roleName
								: c.retiredYear !== undefined
									? `Retired (${c.retiredYear})`
									: "Free agent"}
						</b>
						{c.tid >= 0 && c.abbrev ? (
							<>
								{" "}
								for{" "}
								<a href={helpers.leagueUrl(["staff", `${c.abbrev}_${c.tid}`])}>
									{c.abbrev}
								</a>
							</>
						) : null}
					</div>
					<div>
						Age {c.age}, born in {c.born.loc}
					</div>
					{c.tid >= 0 ? (
						<div>
							Contract: {helpers.formatCurrency(c.contract.amount / 1000, "M")}{" "}
							per season thru {c.contract.exp}
						</div>
					) : null}
					<div>Ovr at current job: {c.ovr}</div>
					<div>
						{(
							Object.keys(
								COACH_RATING_NAMES,
							) as (keyof typeof COACH_RATING_NAMES)[]
						).map((key) => (
							<span key={key} className="me-3">
								{COACH_RATING_NAMES[key]}: <b>{c.ratings[key]}</b>
							</span>
						))}
					</div>
					<div>Style: {c.styleText}</div>
					{c.systems ? (
						<div data-testid="coach-systems">
							<div>
								Offense: <b>{c.systems.offense}</b> · Defense:{" "}
								<b>{c.systems.defense}</b>
							</div>
							<div>
								{c.systems.philosophy} · {c.systems.personality} ·{" "}
								{c.systems.background} · Game management {c.systems.mgmt} ·
								Adaptability {c.systems.adapt}
							</div>
							<div>
								Reputation: {c.systems.reputation} ({c.systems.reputationText})
								{c.systems.hotSeatText
									? ` · Hot seat: ${c.systems.hotSeatText}`
									: ""}
								{c.systems.mentor ? (
									<>
										{" "}
										· Coaching tree:{" "}
										<a
											href={helpers.leagueUrl(["coach", c.systems.mentor.cid])}
										>
											{c.systems.mentor.name}
										</a>
									</>
								) : null}
							</div>
							{c.tid >= 0 && c.role === "head" && c.abbrev ? (
								<a
									href={helpers.leagueUrl([
										"coach_notes",
										`${c.abbrev}_${c.tid}`,
									])}
								>
									Coach's notes
								</a>
							) : null}
						</div>
					) : null}
					{c.headSeasons > 0 ? (
						<div>
							Head coach record: {c.headWon}-{c.headLost} in {c.headSeasons}{" "}
							season{c.headSeasons > 1 ? "s" : ""}
							{c.titles > 0
								? `, ${c.titles} title${c.titles > 1 ? "s" : ""}`
								: ""}
						</div>
					) : null}
				</div>
			</div>

			{awards.length > 0 ? (
				<>
					<h2>Awards</h2>
					<ul>
						{awards.map((a) => (
							<li key={`${a.season}-${a.type}`}>
								{a.season} {a.type}
							</li>
						))}
					</ul>
				</>
			) : null}

			<h2>Seasons</h2>
			{stats.length === 0 ? (
				<p>No completed seasons yet.</p>
			) : (
				<div className="table-responsive">
					<table className="table table-striped table-sm table-hover">
						<thead>
							<tr>
								<th>Season</th>
								<th>Team</th>
								<th>Job</th>
								<th>W</th>
								<th>L</th>
								<th>Playoffs</th>
							</tr>
						</thead>
						<tbody>
							{stats.map((row) => (
								<tr key={row.season}>
									<td>{row.season}</td>
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
									<td>{row.roleName}</td>
									<td>{row.won}</td>
									<td>{row.lost}</td>
									<td>
										{playoffText(row.playoffRoundsWon, row.numPlayoffRounds)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{transactions.length > 0 ? (
				<>
					<h2>Transactions</h2>
					<ul>
						{transactions.map((tx, i) => (
							<li key={i}>
								{tx.season}: {TX_TEXT[tx.type]} {tx.abbrev} ({tx.roleName})
							</li>
						))}
					</ul>
				</>
			) : null}
		</>
	);
};

export default Coach;
