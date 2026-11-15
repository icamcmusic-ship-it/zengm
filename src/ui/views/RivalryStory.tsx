// Rivalry Stories (League extras): the story of one pair on the Rivalries page
import { helpers } from "../util/helpers.ts";
import type { LocalStateUI } from "../../common/types.ts";
import type {
	RivalryStory as Story,
	StoryGame,
} from "../../common/rivalryStories/aggregate.ts";
import { isFinals, type RivalSeries } from "../../common/rivalries/index.ts";

type TeamInfoCache = LocalStateUI["teamInfoCache"];

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const roundLabel = (s: RivalSeries) =>
	isFinals(s)
		? "Finals"
		: s.numRounds - 1 - s.round === 1
			? "Semifinals"
			: `Round ${s.round + 1}`;

export const RivalryStory = ({
	story,
	series,
	teamInfoCache,
}: {
	story: Story;
	series: RivalSeries[];
	teamInfoCache: TeamInfoCache;
}) => {
	const ab = (tid: number) => teamInfoCache[tid]?.abbrev ?? `T${tid}`;
	const { a, b, record } = story;
	const A = ab(a);
	const B = ab(b);
	const gameUrl = (gm: StoryGame) =>
		helpers.leagueUrl([
			"game_log",
			`${ab(gm.home)}_${gm.home}`,
			gm.season,
			gm.gid,
		]);
	const scoreText = (gm: StoryGame) =>
		`${ab(gm.away)} ${gm.aPts} @ ${ab(gm.home)} ${gm.hPts}${gm.ot > 0 ? (gm.ot === 1 ? " OT" : ` ${gm.ot}OT`) : ""}`;
	const playerUrl = (pid: number) => helpers.leagueUrl(["player", pid]);

	const gameList = (title: string, games: StoryGame[], testId: string) => (
		<div className="col-md-6">
			<h4 className="h6">{title}</h4>
			{games.length === 0 ? (
				<p className="text-body-secondary small">No logged games yet.</p>
			) : (
				<ul className="list-unstyled small" data-testid={testId}>
					{games.map((gm) => (
						<li key={gm.gid} className="mb-1">
							<span className="text-body-secondary">{gm.season}</span>{" "}
							<a href={gameUrl(gm)}>{scoreText(gm)}</a>
							{gm.note ? (
								<span className="text-body-secondary"> · {gm.note}</span>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);

	const maxHeat = Math.max(1, ...story.heat.map((h) => h.heat));

	return (
		<div className="mt-3" data-testid="rivalry-story">
			<h3 className="h5">All-time record</h3>
			<div className="row g-2 mb-2">
				{[
					["Regular season", `${A} ${record.rsA}-${record.rsB} ${B}`],
					["Playoff games", `${A} ${record.poA}-${record.poB} ${B}`],
					["Playoff series", `${A} ${record.seriesA}-${record.seriesB} ${B}`],
					[
						"Current streak",
						story.current
							? `${ab(story.current.tid)} ${story.current.n} straight`
							: "None",
					],
				].map(([label, value]) => (
					<div className="col-6 col-md-3" key={label}>
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">{label}</div>
							<div className="fw-bold">{value}</div>
						</div>
					</div>
				))}
			</div>
			<p className="small text-body-secondary">
				{story.longest
					.map(
						(s) =>
							`Longest ${ab(s.tid)} streak: ${s.n}${s.from !== undefined ? (s.from === s.to ? ` (${s.from})` : ` (${s.from}-${s.to})`) : ""}`,
					)
					.join(" · ")}
				{story.logged.games > 0
					? `${story.longest.length > 0 ? " · " : ""}Streaks, games and players from ${story.logged.games} logged games (${story.logged.from}${story.logged.to !== story.logged.from ? `-${story.logged.to}` : ""})${story.avgMargin !== undefined ? `, average margin ${story.avgMargin.toFixed(1)}` : ""}, ${story.ot} in overtime.`
					: " No games logged yet: the log starts with the box scores kept when the setting was turned on."}
			</p>

			{story.eras.length > 1 ? (
				<>
					<h3 className="h5">Head-to-head by era</h3>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped"
							data-testid="rivalry-eras"
						>
							<thead>
								<tr>
									<th>Seasons</th>
									<th>{A} W</th>
									<th>{B} W</th>
									<th>Series</th>
								</tr>
							</thead>
							<tbody>
								{story.eras.map((e) => (
									<tr key={e.from}>
										<td>
											{e.from}
											{e.to !== e.from ? `-${e.to}` : ""}
										</td>
										<td>{e.aW}</td>
										<td>{e.bW}</td>
										<td>
											{e.seriesA + e.seriesB > 0
												? `${A} ${e.seriesA}-${e.seriesB}`
												: null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}

			<h3 className="h5">Playoff history</h3>
			{series.length === 0 ? (
				<p className="small">They have never met in the playoffs.</p>
			) : (
				<ul className="small" data-testid="rivalry-series">
					{series.map((s) => (
						<li key={`${s.season}-${s.round}`}>
							{s.season} {roundLabel(s)}:{" "}
							<a
								href={helpers.leagueUrl([
									"series_recaps",
									s.season,
									`${Math.min(a, b)}-${Math.max(a, b)}`,
								])}
							>
								{ab(s.winner)} won {s.wWon}-{s.wLost}
							</a>
							{s.wSeed !== undefined &&
							s.lSeed !== undefined &&
							s.wSeed > s.lSeed
								? " (upset)"
								: ""}
						</li>
					))}
				</ul>
			)}

			<h3 className="h5">Memorable games</h3>
			<div className="row">
				{gameList("Best games", story.bestGames, "rivalry-best")}
				{gameList("Closest games", story.closestGames, "rivalry-closest")}
			</div>

			<h3 className="h5">Player duels</h3>
			{story.duels.length === 0 ? (
				<p className="small text-body-secondary">No logged games yet.</p>
			) : (
				<div className="table-responsive">
					<table
						className="table table-sm table-striped"
						data-testid="rivalry-duels"
					>
						<thead>
							<tr>
								<th>Player</th>
								<th>For</th>
								<th title="Games against the other side">GP</th>
								<th>PTS</th>
								<th>PPG</th>
								<th title="Most points in one game of the rivalry">Best</th>
							</tr>
						</thead>
						<tbody>
							{story.duels.map((d) => (
								<tr key={`${d.pid}-${d.tid}`}>
									<td>
										<a href={playerUrl(d.pid)}>{d.name}</a>
									</td>
									<td>{ab(d.tid)}</td>
									<td>{d.gp}</td>
									<td>{d.pts}</td>
									<td>{d.ppg.toFixed(1)}</td>
									<td>
										{d.best} ({d.bestSeason})
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{story.defense.length > 0 ? (
				<>
					<h4 className="h6">Defense in the rivalry</h4>
					<ul className="small" data-testid="rivalry-defense">
						{story.defense.map((d) => (
							<li key={`${d.pid}-${d.tid}`}>
								<a href={playerUrl(d.pid)}>{d.name}</a> ({ab(d.tid)}) held{" "}
								{ab(d.tid === a ? b : a)} shooters to {pct(d.pct)} on {d.dfga}{" "}
								defended shots
							</li>
						))}
					</ul>
				</>
			) : null}
			{story.onOff.length > 0 ? (
				<>
					<h4 className="h6">On the floor in rivalry games</h4>
					<ul className="small" data-testid="rivalry-onoff">
						{story.onOff.map((d) => (
							<li key={`${d.pid}-${d.tid}`}>
								<a href={playerUrl(d.pid)}>{d.name}</a> ({ab(d.tid)}):{" "}
								{d.onNet > 0 ? "+" : ""}
								{d.onNet} in {d.gp} games
							</li>
						))}
					</ul>
				</>
			) : null}

			<div className="row">
				<div className="col-md-6">
					<h3 className="h5">Crossed the rivalry</h3>
					{story.crossings.length === 0 ? (
						<p className="small text-body-secondary">
							No player in the log has played for both.
						</p>
					) : (
						<ul className="small" data-testid="rivalry-crossings">
							{story.crossings.map((c) => (
								<li key={`${c.pid}-${c.season}-${c.to}`}>
									{c.season}: <a href={playerUrl(c.pid)}>{c.name}</a>,{" "}
									{ab(c.from)} → {ab(c.to)}
									{c.how === "trade"
										? " (trade)"
										: c.how === "signing"
											? " (free agency)"
											: ""}
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="col-md-6">
					<h3 className="h5">On the sidelines</h3>
					{story.coaches.length === 0 ? (
						<p className="small text-body-secondary">
							No coaching matchups logged (they need the Coaching Staff
							setting).
						</p>
					) : (
						<ul className="small" data-testid="rivalry-coaches">
							{story.coaches.map((c) => (
								<li key={`${c.coachA}|${c.coachB}`}>
									{c.coachA} ({A}) {c.aW}-{c.bW} {c.coachB} ({B})
								</li>
							))}
						</ul>
					)}
					<h3 className="h5">On the big stage</h3>
					<p className="small">
						{story.marquee.nationalTv} national TV game
						{story.marquee.nationalTv === 1 ? "" : "s"}, {story.marquee.holiday}{" "}
						holiday game
						{story.marquee.holiday === 1 ? "" : "s"},{" "}
						{story.marquee.rivalryGames} scheduled rivalry game
						{story.marquee.rivalryGames === 1 ? "" : "s"}.
					</p>
				</div>
			</div>

			<h3 className="h5">Heat timeline</h3>
			<div className="table-responsive" style={{ maxHeight: 420 }}>
				<table className="table table-sm" data-testid="rivalry-heat">
					<thead>
						<tr>
							<th>Season</th>
							<th style={{ minWidth: 90 }}>Heat</th>
							<th>Why</th>
						</tr>
					</thead>
					<tbody>
						{[...story.heat].reverse().map((h) => (
							<tr key={h.season}>
								<td>{h.season}</td>
								<td>
									<div className="d-flex align-items-center gap-1">
										<div
											className={h.delta >= 0 ? "bg-danger" : "bg-secondary"}
											style={{
												height: 8,
												width: `${Math.max(2, (60 * h.heat) / maxHeat)}px`,
												borderRadius: 2,
											}}
										/>
										<span className="small">
											{Math.round(h.heat)}
											{h.delta !== 0 ? (
												<span
													className={
														h.delta > 0 ? "text-danger" : "text-body-secondary"
													}
												>
													{" "}
													{h.delta > 0 ? "▲" : "▼"}
												</span>
											) : null}
										</span>
									</div>
								</td>
								<td className="small">{h.why.join("; ")}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
};
