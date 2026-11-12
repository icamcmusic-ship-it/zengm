// Shared bits of the college mode pages (docs/college-mode.md)
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import type { ReactNode } from "react";
import { COLLEGE_REGION_NAMES } from "../../../common/college/constants.ts";

export type CollegeTeamNames = Record<
	number,
	{
		tid: number;
		abbrev: string;
		region: string;
		won: number;
		lost: number;
		conf: string;
	}
>;

export const SeasonSelect = ({
	page,
	season,
	seasons,
}: {
	page: string;
	season: number;
	seasons: number[];
}) => {
	if (seasons.length <= 1) {
		return null;
	}
	return (
		<select
			className="form-select form-select-sm d-inline-block mb-3"
			style={{ width: "auto" }}
			aria-label="Season"
			value={season}
			onChange={(event) => {
				realtimeUpdate(
					[],
					helpers.leagueUrl([page, event.target.value] as any),
				);
			}}
		>
			{seasons.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</select>
	);
};

export const TeamName = ({
	teams,
	tid,
	season,
	userTid,
	record,
	children,
}: {
	teams: CollegeTeamNames;
	tid: number;
	season: number;
	userTid?: number;
	record?: boolean;
	children?: ReactNode;
}) => {
	const t = teams[tid];
	if (!t) {
		return <span className="text-body-secondary">TBD</span>;
	}
	return (
		<>
			<a
				href={helpers.leagueUrl(["roster", `${t.abbrev}_${tid}`, season])}
				className={tid === userTid ? "fw-bold" : undefined}
			>
				{t.region}
			</a>
			{children}
			{record ? (
				<span className="text-body-secondary ms-1 small">
					{t.won}-{t.lost}
				</span>
			) : null}
		</>
	);
};

export const Stars = ({ stars }: { stars: number }) => (
	<span className="text-warning text-nowrap" title={`${stars} stars`}>
		{"★".repeat(stars)}
		<span className="text-body-tertiary">
			{"★".repeat(Math.max(0, 5 - stars))}
		</span>
	</span>
);

export const CLASS_NAMES = ["HS", "Fr", "So", "Jr", "Sr"];

export type BracketMatchup = {
	home: number;
	away: number;
	seedHome?: number;
	seedAway?: number;
	pts?: [number, number];
};

// A single-elimination bracket, one column per round (conference tournaments, the NIT)
export const Bracket = ({
	rounds,
	roundName,
	season,
	teams,
	userTid,
}: {
	rounds: BracketMatchup[][];
	roundName: (round: number) => string;
	season: number;
	teams: CollegeTeamNames;
	userTid: number;
}) => (
	<div className="d-flex flex-wrap gap-3">
		{rounds.map((round, i) => (
			<div key={i} style={{ minWidth: 220 }}>
				<h3 className="fs-6">{roundName(i)}</h3>
				{round.map((m, j) =>
					m.away === -2 ? null : (
						<div key={j} className="border rounded mb-2 p-1 small">
							{(["home", "away"] as const).map((side, k) => {
								const tid = m[side];
								const seed = side === "home" ? m.seedHome : m.seedAway;
								const won = m.pts !== undefined && m.pts[k]! > m.pts[1 - k]!;
								return (
									<div
										key={side}
										className={`d-flex justify-content-between${won ? " fw-bold" : ""}`}
									>
										<span>
											{seed !== undefined ? (
												<span className="text-body-secondary me-1">{seed}</span>
											) : null}
											{tid >= 0 ? (
												<TeamName
													teams={teams}
													tid={tid}
													season={season}
													userTid={userTid}
												/>
											) : (
												<span className="text-body-secondary">TBD</span>
											)}
										</span>
										<span>{m.pts ? m.pts[k] : ""}</span>
									</div>
								);
							})}
						</div>
					),
				)}
			</div>
		))}
	</div>
);

export const FirstFour = ({
	games,
	season,
	teams,
	userTid,
}: {
	games: {
		home: number;
		away: number;
		seed: number;
		region: number;
		bid: string;
		pts?: [number, number];
	}[];
	season: number;
	teams: CollegeTeamNames;
	userTid: number;
}) => (
	<div className="mb-3">
		<h3>First Four</h3>
		<div className="d-flex flex-wrap gap-2">
			{games.map((game, i) => (
				<div
					key={i}
					className="border rounded p-1 small"
					style={{ minWidth: 220 }}
					data-testid="first-four-game"
				>
					<div className="text-body-secondary">
						{COLLEGE_REGION_NAMES[game.region]} {game.seed} seed (
						{game.bid === "auto" ? "automatic bids" : "at-large"})
					</div>
					{(["home", "away"] as const).map((side, k) => {
						const won =
							game.pts !== undefined && game.pts[k]! > game.pts[1 - k]!;
						return (
							<div
								key={side}
								className={`d-flex justify-content-between${won ? " fw-bold" : ""}`}
							>
								<TeamName
									teams={teams}
									tid={game[side]}
									season={season}
									userTid={userTid}
									record
								/>
								<span>{game.pts ? game.pts[k] : ""}</span>
							</div>
						);
					})}
				</div>
			))}
		</div>
	</div>
);
