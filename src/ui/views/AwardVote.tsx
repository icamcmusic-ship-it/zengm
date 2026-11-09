import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { SimVote } from "../../common/awardVote/index.ts";

const NUM_ROWS: Record<SimVote["kind"], number> = {
	mvp: 10,
	player: 8,
	team: 20,
};

const VoteTable = ({
	vote,
	season,
	userTids,
}: {
	vote: SimVote;
	season: number;
	userTids: number[];
}) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const rows = vote.rows.slice(0, NUM_ROWS[vote.kind]);
	const maxPts = vote.voters * vote.points[0]!;
	return (
		<div className="mb-4" data-testid={`award-vote-${vote.shortName}`}>
			<h2 className="h4">{vote.name}</h2>
			<div className="small text-body-secondary mb-1">
				{vote.voters} voters, ballot points{" "}
				{vote.kind === "team"
					? vote.points
							.map((p, i) => `${p} for a ${vote.places[i]} vote`)
							.join(", ")
					: vote.points.join("-")}
				. Max {maxPts} points.
			</div>
			<div className="table-responsive">
				<table className="table table-sm table-hover mb-0">
					<thead>
						<tr>
							<th>#</th>
							<th>Player</th>
							<th>Team</th>
							{vote.places.map((p) => (
								<th key={p} className="text-end" title={`${p} votes`}>
									{vote.kind === "team" ? p.replace(" team", "") : p}
								</th>
							))}
							<th className="text-end">Pts</th>
							<th style={{ minWidth: 110 }}>Share</th>
							<th>Narratives</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => {
							const t = teamInfoCache[r.tid];
							return (
								<tr
									key={r.pid}
									className={
										userTids.includes(r.tid) ? "table-info" : undefined
									}
								>
									<td>
										{vote.kind === "team" ? (r.tm ? `${r.tm}` : "") : r.rank}
									</td>
									<td>
										<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>
									</td>
									<td>
										{t ? (
											<a
												href={helpers.leagueUrl([
													"roster",
													`${t.abbrev}_${r.tid}`,
													season,
												])}
											>
												{t.abbrev}
											</a>
										) : null}
									</td>
									{r.votes.map((v, i) => (
										<td key={i} className="text-end">
											{v || ""}
										</td>
									))}
									<td className="text-end">{r.pts}</td>
									<td>
										<div className="d-flex align-items-center gap-1">
											<div
												className="bg-primary"
												style={{
													height: 8,
													width: Math.max(1, Math.round(r.share * 70)),
												}}
											/>
											<span className="small">
												{(r.share * 100).toFixed(1)}%
											</span>
										</div>
									</td>
									<td className="small text-body-secondary">
										{r.narratives
											.map((n) =>
												n.startsWith("-") ? `− ${n.slice(1)}` : n.slice(1),
											)
											.join(", ")}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
};

const AwardVote = ({
	decides,
	inProgress,
	season,
	source,
	userTids,
	votes,
}: View<"awardVote">) => {
	useTitleBar({
		title: "Award Vote",
		jumpTo: true,
		jumpToSeason: season,
		dropdown: {
			fields: [{ key: "season", options: { type: "seasons" }, value: season }],
			view: "awardVote",
		},
	});

	return (
		<>
			<MoreLinks type="awards" page="award_vote" season={season} />
			<p>
				A simulated media vote: {votes[0]?.voters ?? 100} voters each fill out a
				ballot from the award formula's candidates, with their own noise and
				their own taste for narratives (team success, scoring, availability,
				voter fatigue with the defending winner).{" "}
				{source === "projected"
					? inProgress
						? "This is the projected vote if the season ended today."
						: "The awards have not been given yet."
					: source === "stored"
						? decides
							? "This is the vote saved when the awards were given, and it decided the winners."
							: "This is the vote saved when the awards were given; the winners were decided by the award formula, and the vote agrees with them."
						: "No vote was saved for this season, so this one is reconstructed from the award winners."}
			</p>
			{votes.length === 0 ? (
				<p>No candidates yet.</p>
			) : (
				votes.map((vote) => (
					<VoteTable
						key={vote.shortName}
						vote={vote}
						season={season}
						userTids={userTids}
					/>
				))
			)}
		</>
	);
};

export default AwardVote;
