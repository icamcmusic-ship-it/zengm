import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import {
	HypeBadge,
	HypeText,
	Reasons,
	gameUrl,
} from "../components/GameHype.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { TopPlay } from "../../common/bestPlays/topPlays.ts";

const PLAY_BADGE: Record<string, string> = {
	winner: "text-bg-danger",
	buzzer: "text-bg-danger",
	stop: "text-bg-primary",
	goAhead: "text-bg-warning",
	tying: "text-bg-warning",
};

const BestGames = ({
	games,
	numGames,
	numWithPbp,
	plays,
	season,
	userTids,
}: View<"bestGames">) => {
	useTitleBar({
		title: "Best Games",
		dropdown: {
			fields: [
				{
					key: "season",
					options: { type: "seasons", all: true },
					value: season,
				},
			],
			view: "bestGames",
		},
	});
	const { teamInfoCache } = useLocal(["teamInfoCache"]);

	const playUrl = (p: TopPlay) => {
		const tid = p.tids?.[0];
		const t = tid === undefined ? undefined : teamInfoCache[tid];
		return t
			? helpers.leagueUrl(["game_log", `${t.abbrev}_${tid}`, p.season, p.gid])
			: undefined;
	};
	const matchup = (p: TopPlay) => {
		if (!p.tids) {
			return null;
		}
		const [h, a] = p.tids;
		return `${teamInfoCache[a]?.abbrev ?? "?"} at ${teamInfoCache[h]?.abbrev ?? "?"}${season === "all" ? `, ${p.season}` : ""}`;
	};

	const allTime = season === "all";

	return (
		<>
			<MoreLinks type="schedule" page="best_games" />
			<p>
				The {allTime ? "best games of all time" : "season's best games"}, ranked
				by the post-game rating from{" "}
				<a href={helpers.leagueUrl(["hype"])}>Games to Watch</a> (how close it
				was, comebacks, overtime, star performances and what was at stake), and
				the top plays.{" "}
				{numWithPbp === 0
					? "No game here has saved play-by-play, so the plays are the clutch plays the box scores recorded (game-winners, shots to force overtime, defensive stops)."
					: numWithPbp < numGames
						? `${numWithPbp} of ${numGames} games have saved play-by-play; the others contribute their clutch plays.`
						: null}
			</p>
			<div className="row">
				<div className="col-lg-7">
					<h2>Best games</h2>
					{games.length === 0 ? (
						<p>No finished games with box scores yet.</p>
					) : (
						<ol className="ps-4" data-testid="best-games">
							{games.map((h) => {
								const [home, away] = h.teams;
								const user =
									userTids.includes(home!.tid) || userTids.includes(away!.tid);
								return (
									<li key={h.gid} className="mb-3">
										<div className="d-flex flex-wrap align-items-baseline gap-2">
											<a
												href={gameUrl(h)}
												className={user ? "fw-bold" : undefined}
											>
												{away!.abbrev} {away!.pts}, {home!.abbrev} {home!.pts}
											</a>
											<span className="text-body-secondary small">
												{allTime ? `${h.season} ` : ""}
												{h.kind === "po"
													? "Playoffs"
													: h.kind === "pi"
														? "Play-in"
														: `Day ${h.day}`}
												{h.series ? `, ${h.series}` : ""}
											</span>
											<HypeBadge
												score={h.rating}
												label={h.post?.label ?? h.label}
												title={`Post-game rating ${h.rating} out of 100`}
											/>
										</div>
										{h.post && h.post.reasons.length > 0 ? (
											<Reasons reasons={h.post.reasons} max={3} />
										) : null}
									</li>
								);
							})}
						</ol>
					)}
				</div>
				<div className="col-lg-5">
					<h2>Top plays</h2>
					{plays.length === 0 ? (
						<p>No highlight plays yet.</p>
					) : (
						<ol className="ps-4" data-testid="top-plays">
							{plays.map((p, i) => {
								const url = playUrl(p);
								return (
									<li key={i} className="mb-2">
										<span
											className={`badge ${PLAY_BADGE[p.kind] ?? "text-bg-secondary"} me-1`}
										>
											{p.label}
										</span>
										{p.tags.slice(0, 2).map((t) => (
											<span key={t} className="badge text-bg-light border me-1">
												{t}
											</span>
										))}
										<div>
											<HypeText text={p.text} />
										</div>
										<div className="small text-body-secondary">
											{url ? <a href={url}>{matchup(p)}</a> : matchup(p)}
											{p.period !== undefined
												? ` · ${p.period > 4 ? `OT${p.period > 5 ? p.period - 4 : ""}` : `Q${p.period}`} ${p.clock}`
												: ""}
											{p.after ? ` · ${p.after[1]}-${p.after[0]}` : ""}
											{p.source === "clutch" ? " · from the box score" : ""}
										</div>
									</li>
								);
							})}
						</ol>
					)}
				</div>
			</div>
		</>
	);
};

export default BestGames;
