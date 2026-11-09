import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { LocalStateUI, View } from "../../common/types.ts";
import { isFinals } from "../../common/rivalries/index.ts";

type TeamInfoCache = LocalStateUI["teamInfoCache"];

const TeamLink = ({
	tid,
	season,
	teamInfoCache,
}: {
	tid: number;
	season?: number;
	teamInfoCache: TeamInfoCache;
}) => {
	const t = teamInfoCache[tid];
	if (!t) {
		return <>Team {tid}</>;
	}
	return (
		<a href={helpers.leagueUrl(["team_history", `${t.abbrev}_${tid}`])}>
			{season === undefined ? `${t.region} ${t.name}` : t.abbrev}
		</a>
	);
};

const tierClass = (tier: string) =>
	tier === "Bitter"
		? "text-bg-danger"
		: tier === "Heated"
			? "text-bg-warning"
			: tier === "Simmering"
				? "text-bg-info"
				: "text-bg-secondary";

export const RivalryBadge = ({
	score,
	tier,
}: {
	score: number;
	tier: string;
}) => (
	<span className={`badge ${tierClass(tier)}`} title={`Rivalry score ${score}`}>
		{tier} {Math.round(score)}
	</span>
);

const pairUrl = (a: number, b: number) =>
	helpers.leagueUrl(["rivalries", `${a}-${b}`]);

// Rivalry score by season, as a small line chart
const ScoreChart = ({
	rows,
}: {
	rows: { season: number; score: number; series: unknown }[];
}) => {
	if (rows.length < 2) {
		return null;
	}
	const w = 600;
	const h = 120;
	const pad = 20;
	const max = Math.max(1, ...rows.map((r) => r.score));
	const x = (i: number) => pad + (i * (w - 2 * pad)) / (rows.length - 1);
	const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
	const d = rows
		.map((r, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(r.score)}`)
		.join(" ");
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-100 mb-2"
			style={{ maxWidth: w }}
			role="img"
			aria-label="Rivalry score by season"
		>
			<path d={d} fill="none" stroke="var(--bs-primary)" strokeWidth={2} />
			{rows.map((r, i) =>
				r.series ? (
					<circle
						key={r.season}
						cx={x(i)}
						cy={y(r.score)}
						r={4}
						fill="var(--bs-danger)"
					>
						<title>
							{r.season}: playoff meeting, score {r.score}
						</title>
					</circle>
				) : null,
			)}
			<text x={pad} y={h - 4} fontSize={11} fill="currentColor">
				{rows[0]!.season}
			</text>
			<text
				x={w - pad}
				y={h - 4}
				fontSize={11}
				textAnchor="end"
				fill="currentColor"
			>
				{rows.at(-1)!.season}
			</text>
		</svg>
	);
};

const Rivalries = ({
	finalsPairs,
	finalsSeries,
	selected,
	top,
}: View<"rivalries">) => {
	useTitleBar({ title: "Rivalries" });
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const T = (tid: number, season?: number) => (
		<TeamLink tid={tid} season={season} teamInfoCache={teamInfoCache} />
	);

	return (
		<>
			<p>
				A rivalry score for every pair of teams, from their playoff meetings
				(later rounds and long series count more, the Finals most), close games,
				sharing a division, star duels and recent history. Older history fades:
				it counts half as much every 6 seasons.
			</p>

			{selected ? (
				<div className="card mb-3" data-testid="rivalry-detail">
					<div className="card-body">
						<h2 className="card-title h4">
							{T(selected.a)} vs. {T(selected.b)}{" "}
							<RivalryBadge score={selected.score} tier={selected.tier} />
						</h2>
						{selected.lines.map((line, i) => (
							<p key={i} className="mb-1">
								{line}
							</p>
						))}
						<div className="small text-body-secondary mt-2 mb-3">
							Score: playoffs {selected.parts.playoffs}, regular season{" "}
							{selected.parts.regularSeason}, close games {selected.parts.close}{" "}
							({selected.closeGames}), division/conference{" "}
							{selected.parts.geography}, star duels {selected.parts.stars},
							recent {selected.parts.recent}
						</div>
						<h3 className="h5">Rivalry timeline</h3>
						<ScoreChart rows={selected.timeline} />
						<div className="table-responsive" style={{ maxHeight: 400 }}>
							<table className="table table-sm table-striped">
								<thead>
									<tr>
										<th>Season</th>
										<th>{teamInfoCache[selected.a]?.abbrev} W</th>
										<th>{teamInfoCache[selected.b]?.abbrev} W</th>
										<th>All-time edge</th>
										<th>Playoffs</th>
										<th>Score</th>
									</tr>
								</thead>
								<tbody>
									{[...selected.timeline].reverse().map((r) => (
										<tr key={r.season}>
											<td>{r.season}</td>
											<td>{r.aW}</td>
											<td>{r.bW}</td>
											<td>
												{r.cum === 0
													? "Even"
													: `${teamInfoCache[r.cum > 0 ? selected.a : selected.b]?.abbrev} +${Math.abs(r.cum)}`}
											</td>
											<td>
												{r.series ? (
													<a
														href={helpers.leagueUrl([
															"series_recaps",
															r.season,
															`${selected.a}-${selected.b}`,
														])}
													>
														{teamInfoCache[r.series.winner]?.abbrev} won{" "}
														{r.series.wWon}-{r.series.wLost}
														{isFinals(r.series) ? " (Finals)" : ""}
													</a>
												) : null}
											</td>
											<td>{r.score}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			) : (
				<p>No rivalries yet: play some games first.</p>
			)}

			<div className="row">
				<div className="col-lg-7">
					<h2 className="h4">Top rivalries</h2>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped table-hover"
							data-testid="top-rivalries"
						>
							<thead>
								<tr>
									<th>#</th>
									<th>Teams</th>
									<th>Rivalry</th>
									<th title="Playoff series won">Series</th>
									<th>Finals</th>
									<th title="Regular season games won">Reg. season</th>
									<th>Last met</th>
								</tr>
							</thead>
							<tbody>
								{top.map((r, i) => (
									<tr
										key={r.key}
										className={
											selected?.key === r.key ? "table-primary" : undefined
										}
									>
										<td>{i + 1}</td>
										<td>
											<a href={pairUrl(r.a, r.b)}>
												{teamInfoCache[r.a]?.abbrev} vs.{" "}
												{teamInfoCache[r.b]?.abbrev}
											</a>
										</td>
										<td>
											<RivalryBadge score={r.score} tier={r.tier} />
										</td>
										<td>
											{r.seriesA}-{r.seriesB}
										</td>
										<td>{r.finals || null}</td>
										<td>
											{r.rsA}-{r.rsB}
										</td>
										<td>{r.lastMet ?? null}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
				<div className="col-lg-5">
					<h2 className="h4">Finals rivals</h2>
					{finalsPairs.length === 0 ? (
						<p>No Finals played yet.</p>
					) : (
						<table className="table table-sm table-striped">
							<thead>
								<tr>
									<th>Teams</th>
									<th>Finals</th>
									<th>Rivalry</th>
								</tr>
							</thead>
							<tbody>
								{finalsPairs.map((r) => (
									<tr key={r.key}>
										<td>
											<a href={pairUrl(r.a, r.b)}>
												{teamInfoCache[r.a]?.abbrev} vs.{" "}
												{teamInfoCache[r.b]?.abbrev}
											</a>
										</td>
										<td>{r.finals}</td>
										<td>
											<RivalryBadge score={r.score} tier={r.tier} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<h2 className="h4">Finals matchups</h2>
					<table
						className="table table-sm table-striped"
						data-testid="finals-matchups"
					>
						<thead>
							<tr>
								<th>Season</th>
								<th>Champion</th>
								<th>Runner-up</th>
								<th>Result</th>
							</tr>
						</thead>
						<tbody>
							{finalsSeries.map((s) => (
								<tr key={s.season}>
									<td>{s.season}</td>
									<td>
										{T(s.winner, s.season)}
										{s.wSeed !== undefined ? ` (${s.wSeed})` : ""}
									</td>
									<td>
										{T(s.loser, s.season)}
										{s.lSeed !== undefined ? ` (${s.lSeed})` : ""}
									</td>
									<td>
										<a
											href={helpers.leagueUrl([
												"series_recaps",
												s.season,
												`${Math.min(s.winner, s.loser)}-${Math.max(s.winner, s.loser)}`,
											])}
										>
											{s.wWon}-{s.wLost}
										</a>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</>
	);
};

export default Rivalries;
