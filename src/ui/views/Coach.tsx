import useTitleBar from "../hooks/useTitleBar.tsx";
import { PlayerPicture } from "../components/PlayerPicture.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import {
	CoachPortrait,
	GradeBadge,
	HotSeatBadge,
	RatingBars,
	Term,
} from "../components/CoachUi.tsx";

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

const Coach = ({
	awards,
	coach: c,
	colors,
	playerThen,
	relationships,
	stats,
	transactions,
	tree,
}: View<"coach">) => {
	useTitleBar({ title: c.name });

	return (
		<>
			<div className="d-flex flex-wrap gap-3 mb-3">
				<CoachPortrait
					face={c.face}
					colors={colors}
					age={c.age}
					player={c.faceAsPlayer}
					seed={c.cid}
					width={120}
				/>
				<div style={{ flex: "1 1 280px", minWidth: 0 }}>
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
					<div>
						<Term term="ovr">Overall at his job</Term>: <b>{c.ovr}</b>{" "}
						<GradeBadge value={c.ovr} />
					</div>
					<div className="my-2" style={{ maxWidth: 420 }}>
						<Term term="ratings">
							<b>Ratings</b>
						</Term>
						<RatingBars ratings={c.ratings} />
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
								<Term term="reputation" />: {c.systems.reputation} (
								{c.systems.reputationText})
								{c.systems.hotSeatText ? (
									<>
										{" "}
										· <Term term="hotSeat" />{" "}
										<HotSeatBadge text={c.systems.hotSeatText} />
									</>
								) : null}
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
							{c.systems.decisions ? (
								<div data-testid="coach-decisions">
									Decisions: {c.systems.decisions.starters} ·{" "}
									{c.systems.decisions.loyalty} ·{" "}
									{c.systems.decisions.foulTrouble} ·{" "}
									{c.systems.decisions.injuries} · {c.systems.decisions.rest}
								</div>
							) : null}
							{c.systems.mentor && c.systems.inherited.length > 0 ? (
								<div data-testid="coach-inherited">
									Carried from {c.systems.mentor.name}:{" "}
									{c.systems.inherited.join(", ")}
								</div>
							) : null}
							{c.systems.familiarity !== undefined &&
							c.tid >= 0 &&
							c.role === "head" ? (
								<div title="How familiar his systems were to the team when he took over (the previous coach ran them, the two share a coaching tree, assistants who worked under him or his mentor). Familiar systems start further along and install faster.">
									System familiarity with his team: {c.systems.familiarity}%
								</div>
							) : null}
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

			{playerThen ? (
				<div className="mb-3" data-testid="coach-then-and-now">
					<h2>Then and Now</h2>
					<div className="d-flex flex-wrap gap-4 align-items-end">
						<figure className="mb-0 text-center">
							<div style={{ width: 100, height: 150 }}>
								<PlayerPicture
									face={playerThen.face}
									colors={playerThen.colors}
									jersey={playerThen.jersey}
								/>
							</div>
							<figcaption className="small">
								<a href={helpers.leagueUrl(["player", playerThen.pid])}>
									Player
								</a>
								, {playerThen.season}
							</figcaption>
						</figure>
						<figure className="mb-0 text-center">
							<CoachPortrait
								face={c.face}
								colors={colors}
								age={c.age}
								player={c.faceAsPlayer}
								seed={c.cid}
								width={100}
							/>
							<figcaption className="small">Coach, now</figcaption>
						</figure>
					</div>
				</div>
			) : null}

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

			{tree ? (
				<div data-testid="coach-tree">
					<h2>Career and coaching tree</h2>
					<p className="mb-1">
						{tree.exPlayer !== undefined ? (
							<>
								A former{" "}
								<a href={helpers.leagueUrl(["player", tree.exPlayer])}>
									player
								</a>
								,{" "}
							</>
						) : null}
						{tree.start
							? tree.initial
								? `with the league since its first season (${tree.start})`
								: `started as ${tree.start.toLowerCase()} (${tree.startSeason})`
							: "career start not recorded"}
						{tree.promotions.map((pr) => (
							<span key={pr.season}>
								; {pr.season}: {pr.fromName} → {pr.toName}
								{pr.abbrev ? ` (${pr.abbrev})` : ""}
							</span>
						))}
						.
					</p>
					{tree.up.length > 0 ? (
						<p className="mb-1">
							Mentors:{" "}
							{tree.up.map((m, i) => (
								<span key={m.cid}>
									{i > 0 ? " ← " : ""}
									<a href={helpers.leagueUrl(["coach", m.cid])}>{m.name}</a>
								</span>
							))}
						</p>
					) : null}
					{tree.down.length > 0 ? (
						<>
							<div className="fw-bold">Head coaches from his tree</div>
							<ul>
								{tree.down.map((d) => (
									<li key={d.cid} style={{ marginLeft: (d.depth - 1) * 16 }}>
										<a href={helpers.leagueUrl(["coach", d.cid])}>{d.name}</a> (
										{d.role}
										{d.abbrev ? `, ${d.abbrev}` : ""})
									</li>
								))}
							</ul>
						</>
					) : null}
					{tree.assistants.length > 0 ? (
						<>
							<div className="fw-bold">Assistants under him</div>
							<ul className="small">
								{tree.assistants.map((a) => (
									<li key={a.cid}>
										<a href={helpers.leagueUrl(["coach", a.cid])}>{a.name}</a> (
										{a.job}, {a.seasons}{" "}
										{a.seasons === 1 ? "season" : "seasons"})
										{a.becameHead ? " · became a head coach" : ""}
									</li>
								))}
							</ul>
						</>
					) : null}
				</div>
			) : null}

			{relationships && relationships.length > 0 ? (
				<div data-testid="coach-relationships">
					<h2>Player relationships</h2>
					<p className="text-body-secondary small mb-1">
						Built over the seasons together: playing time against the player's
						role, his development, personalities and winning. A close bond lifts
						the player's mood (and his wish to re-sign) and his development plan
						a little; a strained one does the opposite.
					</p>
					<ul className="small">
						{relationships.map((r) => (
							<li key={r.pid}>
								<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>
								{r.abbrev ? ` (${r.abbrev})` : ""}:{" "}
								<span
									className={
										r.v >= 0.3
											? "text-success"
											: r.v <= -0.15
												? "text-danger"
												: undefined
									}
								>
									{r.label}
								</span>
								, {r.seasons} {r.seasons === 1 ? "season" : "seasons"}
								{r.current ? "" : `, last ${r.last}`}
							</li>
						))}
					</ul>
				</div>
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
