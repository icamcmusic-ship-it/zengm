import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";

type Season = View<"bracketArchive">["seasons"][number];
type Side = NonNullable<Season["rounds"][number]["series"][number]["away"]>;

const SideRow = ({
	side,
	won,
	userTids,
	season,
}: {
	side: Side;
	won: boolean;
	userTids: number[];
	season: number;
}) => (
	<div
		className={`d-flex justify-content-between ${won ? "fw-bold" : "text-body-secondary"} ${userTids.includes(side.tid) ? "table-info" : ""}`}
	>
		<span>
			{side.seed}.{" "}
			<a
				href={helpers.leagueUrl([
					"roster",
					`${side.abbrev}_${side.tid}`,
					season,
				])}
			>
				{side.abbrev}
			</a>
		</span>
		<span>{side.won}</span>
	</div>
);

const Bracket = ({
	season,
	userTids,
}: {
	season: Season;
	userTids: number[];
}) => (
	<div className="d-flex gap-3 overflow-auto small">
		{season.rounds.map((round, r) => (
			<div key={r} style={{ minWidth: 110 }}>
				<div className="fw-bold mb-1">{round.name}</div>
				{round.series.map((s, j) => (
					<div key={j} className="border rounded px-1 mb-1">
						<SideRow
							side={s.home}
							won={!s.away || s.home.won > s.away.won}
							userTids={userTids}
							season={season.season}
						/>
						{s.away ? (
							<SideRow
								side={s.away}
								won={s.away.won > s.home.won}
								userTids={userTids}
								season={season.season}
							/>
						) : (
							<div className="text-body-secondary">bye</div>
						)}
					</div>
				))}
			</div>
		))}
	</div>
);

const BracketArchive = ({ seasons, userTids }: View<"bracketArchive">) => {
	useTitleBar({ title: "Bracket Archive" });
	const [open, setOpen] = useState<Set<number>>(
		() => new Set(seasons.slice(0, 1).map((s) => s.season)),
	);
	const toggle = (season: number) => {
		const next = new Set(open);
		if (next.has(season)) {
			next.delete(season);
		} else {
			next.add(season);
		}
		setOpen(next);
	};
	if (seasons.length === 0) {
		return <p>No playoff brackets yet.</p>;
	}
	return (
		<>
			<p>
				Every season's playoff bracket. Click a season to open its bracket, or
				go to its full <a href={helpers.leagueUrl(["playoffs"])}>Playoffs</a>{" "}
				page and{" "}
				<a href={helpers.leagueUrl(["series_recaps"])}>Series Recaps</a>.
			</p>
			<div className="mb-2">
				<button
					type="button"
					className="btn btn-sm btn-light-bordered me-2"
					onClick={() => setOpen(new Set(seasons.map((s) => s.season)))}
				>
					Open all
				</button>
				<button
					type="button"
					className="btn btn-sm btn-light-bordered"
					onClick={() => setOpen(new Set())}
				>
					Close all
				</button>
			</div>
			<ul className="list-group" data-testid="bracket-archive">
				{seasons.map((season) => (
					<li key={season.season} className="list-group-item">
						<div className="d-flex flex-wrap gap-2 align-items-baseline">
							<button
								type="button"
								className="btn btn-link p-0 border-0 fw-bold"
								onClick={() => toggle(season.season)}
							>
								{season.season}
							</button>
							{season.champion ? (
								<span>
									Champion:{" "}
									<b>
										{season.champion.region} {season.champion.name}
									</b>{" "}
									(No. {season.champion.seed})
									{season.runnerUp
										? `, beat the ${season.runnerUp.name} ${season.champion.won}-${season.runnerUp.won}`
										: ""}
								</span>
							) : (
								<span className="text-body-secondary">In progress</span>
							)}
							<a
								className="ms-auto small"
								href={helpers.leagueUrl(["playoffs", season.season])}
							>
								Full bracket
							</a>
						</div>
						{open.has(season.season) ? (
							<div className="mt-2">
								<Bracket season={season} userTids={userTids} />
							</div>
						) : null}
					</li>
				))}
			</ul>
		</>
	);
};

export default BracketArchive;
