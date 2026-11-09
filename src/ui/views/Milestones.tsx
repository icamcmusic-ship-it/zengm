import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";
import { RB_WORDS } from "../../common/recordsBook.ts";
import type {
	MilestoneRow,
	ReachedRow,
} from "../../worker/util/recordsBookData.ts";
import { ActiveMark } from "./RecordsBook.tsx";

type TeamInfo = { abbrev: string; region: string; name: string };

const fmt = (n: number) => helpers.numberWithCommas(n);

export const ordinal = (n: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const chaseText = (r: MilestoneRow) => {
	const unit = RB_WORDS[r.k].unit;
	if (r.target.kind === "milestone") {
		return `${fmt(r.target.mark)} career ${unit}`;
	}
	return `${ordinal(r.target.rank)} all-time in ${unit}`;
};

export const WhenText = ({
	r,
	teams,
}: {
	r: MilestoneRow;
	teams: TeamInfo[];
}) => {
	if (r.when.type === "game") {
		const opp = teams[r.when.oppTid];
		return (
			<>
				Game {r.when.n}, day {r.when.day} {r.when.home ? "vs" : "at"}{" "}
				{opp?.abbrev ?? "?"}
			</>
		);
	}
	if (r.when.type === "nextSeason") {
		return <>Next season, about game {r.when.n}</>;
	}
	return <>Later</>;
};

export const reachedText = (r: ReachedRow) =>
	`${fmt(r.t)} career ${RB_WORDS[r.k].unit}`;

const Milestones = ({
	horizon,
	inSeason,
	reached,
	rows,
	season,
	tid,
	userTid,
}: View<"milestones">) => {
	useTitleBar({
		title: "Milestones",
		dropdown: {
			fields: [
				{
					key: "team",
					options: { type: "teams", all: true },
					value: tid,
				},
				{
					key: "horizon",
					options: [
						{ key: "season", label: inSeason ? "This season" : "Next season" },
						{ key: "two", label: "Within a season and a half" },
					],
					value: horizon,
				},
			],
			view: "milestones",
		},
	});
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const teams = teamInfoCache as TeamInfo[];

	const teamLink = (t: number) =>
		teams[t] ? (
			<a
				href={helpers.leagueUrl(["roster", `${teams[t]!.abbrev}_${t}`, season])}
			>
				{teams[t]!.abbrev}
			</a>
		) : null;

	return (
		<>
			<MoreLinks type="playerStats" page="milestones" />
			<p>
				Active players within reach of a round career number (regular season) or
				of the next player above them in the all-time top 100, and when they'd
				get there at their pace: this season's per-game rate (last season's
				early on) and the share of their team's games they play. The projected
				game is from the schedule. All-time leaders are in the{" "}
				<a href={helpers.leagueUrl(["records_book"])}>Records Book</a>.
			</p>
			<div className="row">
				<div className="col-xl-8 mb-3">
					<h2>Up next</h2>
					{rows.length === 0 ? (
						<p>No one is within reach right now.</p>
					) : (
						<div className="table-responsive">
							<table className="table table-sm table-striped table-hover">
								<thead>
									<tr>
										<th>Player</th>
										<th>Team</th>
										<th>Chasing</th>
										<th className="text-end">Now</th>
										<th className="text-end">Needs</th>
										<th className="text-end">Pace</th>
										<th>Projected</th>
									</tr>
								</thead>
								<tbody>
									{rows.slice(0, 150).map((r) => (
										<tr
											key={`${r.pid}-${r.k}-${r.target.kind}`}
											className={r.tid === userTid ? "table-info" : undefined}
										>
											<td>
												<a href={helpers.leagueUrl(["player", r.pid])}>
													{r.name}
												</a>
												{r.rank !== null ? (
													<span className="text-body-secondary small ms-1">
														#{r.rank}
													</span>
												) : null}
											</td>
											<td>{teamLink(r.tid)}</td>
											<td>
												{chaseText(r)}
												{r.target.kind === "rank" ? (
													<span className="text-body-secondary small">
														{" "}
														(passing{" "}
														<a
															href={helpers.leagueUrl(["player", r.target.pid])}
														>
															{r.target.name}
														</a>
														{r.target.active ? <ActiveMark /> : null},{" "}
														{fmt(r.target.v)})
													</span>
												) : null}
											</td>
											<td className="text-end">{fmt(r.v)}</td>
											<td className="text-end">{fmt(r.need)}</td>
											<td className="text-end">
												{r.k === "gp" ? "-" : r.perGame.toFixed(1)}
											</td>
											<td>
												<WhenText r={r} teams={teams} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
				<div className="col-xl-4 mb-3">
					<h2>Recently reached</h2>
					{reached.length === 0 ? (
						<p>No milestones reached this season yet.</p>
					) : (
						<ul className="list-unstyled">
							{reached.map((r, i) => (
								<li key={i} className="mb-1">
									<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>{" "}
									<span className="text-body-secondary small">
										{teamLink(r.tid)}
									</span>
									: {reachedText(r)}
									<span className="text-body-secondary small">
										{" "}
										(
										{r.gid !== undefined && teams[r.tid] ? (
											<a
												href={helpers.leagueUrl([
													"game_log",
													`${teams[r.tid]!.abbrev}_${r.tid}`,
													r.season,
													r.gid,
												])}
											>
												{r.season}, day {r.day}
											</a>
										) : (
											r.season
										)}
										)
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
};

export default Milestones;
