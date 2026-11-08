import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";

const MOVE_TEXT = {
	hired: "hired",
	fired: "fired",
	reSigned: "re-signed",
	left: "left (contract expired)",
	retired: "retired",
};

const Coaches = ({
	carousel,
	coy,
	currentSeason,
	headCoaches,
	season,
}: View<"coaches">) => {
	useTitleBar({
		title: "Coaches",
		dropdown: {
			fields: [
				{
					key: "season",
					options: { type: "seasons" },
					value: season,
				},
			],
			view: "coaches",
		},
	});

	return (
		<>
			<MoreLinks type="league" page="coaches" />
			<h2>Head coaches</h2>
			<div className="table-responsive">
				<table className="table table-striped table-sm table-hover">
					<thead>
						<tr>
							<th>Team</th>
							<th>Coach</th>
							<th>Age</th>
							<th>Ovr</th>
							<th>Style</th>
							<th>{season} record</th>
							<th>Career</th>
							<th>Titles</th>
							<th>Awards</th>
						</tr>
					</thead>
					<tbody>
						{headCoaches.map((c) => (
							<tr key={c.cid}>
								<td>
									<a
										href={helpers.leagueUrl(["staff", `${c.abbrev}_${c.tid}`])}
									>
										{c.abbrev}
									</a>
								</td>
								<td>
									<a href={helpers.leagueUrl(["coach", c.cid])}>{c.name}</a>
								</td>
								<td>{c.age}</td>
								<td>{c.ovr}</td>
								<td>{c.styleText}</td>
								<td>
									{c.seasonWon !== undefined
										? `${c.seasonWon}-${c.seasonLost}`
										: season === currentSeason
											? "in progress"
											: ""}
								</td>
								<td>
									{c.headWon}-{c.headLost}
								</td>
								<td>{c.titles}</td>
								<td>{c.numAwards}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h2>Coaching carousel, {season}</h2>
			{carousel.length === 0 ? (
				<p>No coaching moves this season.</p>
			) : (
				<ul>
					{carousel.map((m, i) => (
						<li key={i}>
							<a href={helpers.leagueUrl(["staff", `${m.abbrev}_${m.tid}`])}>
								{m.abbrev}
							</a>{" "}
							{MOVE_TEXT[m.type]}{" "}
							<a href={helpers.leagueUrl(["coach", m.cid])}>{m.name}</a> (
							{m.roleName})
						</li>
					))}
				</ul>
			)}

			<h2>Coach of the Year</h2>
			{coy.length === 0 ? (
				<p>Awarded after the playoffs.</p>
			) : (
				<ul>
					{coy.map((a) => (
						<li key={a.season}>
							{a.season}:{" "}
							<a href={helpers.leagueUrl(["coach", a.cid])}>{a.name}</a> (
							{a.abbrev})
						</li>
					))}
				</ul>
			)}
		</>
	);
};

export default Coaches;
