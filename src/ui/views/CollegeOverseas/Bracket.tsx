import clsx from "clsx";
import { Fragment } from "react";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import type { NcaaGame } from "../../../common/collegeStats/ncaa.ts";

type ProspectLink = {
	pid: number;
	name: string;
	pos: string;
	ovr: number;
	pot: number;
	draft?: { round: number; pick: number; abbrev: string };
};

export type BracketTeamInfo = {
	school: string;
	record: string;
	prospects: ProspectLink[];
};

export const ProspectLinks = ({
	prospects,
	prefix,
	short,
}: {
	prospects: ProspectLink[];
	prefix?: string;
	short?: boolean;
}) => {
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	if (prospects.length === 0) {
		return null;
	}
	return (
		<span className="small">
			{prefix}
			{prospects.map((p, i) => {
				const [first, ...rest] = p.name.split(" ");
				const name = short ? `${first![0]}. ${rest.join(" ")}` : p.name;
				return (
					<Fragment key={p.pid}>
						{i > 0 ? ", " : null}
						<a
							href={helpers.leagueUrl(["player", p.pid])}
							title={`${p.name}, ${p.pos}${challengeNoRatings ? "" : `, ${p.ovr}/${p.pot}`}${p.draft ? `, drafted ${p.draft.round}-${p.draft.pick} by ${p.draft.abbrev}` : ""}`}
						>
							{name}
						</a>
					</Fragment>
				);
			})}
		</span>
	);
};

const TeamRow = ({
	team,
	seed,
	score,
	won,
	info,
	showSeeds,
	ot,
}: {
	team: number;
	seed: number;
	score: number | undefined;
	won: boolean;
	info: BracketTeamInfo;
	showSeeds: boolean;
	ot?: number;
}) => {
	return (
		<div
			className={clsx("px-1", won ? "fw-bold" : "text-body-secondary")}
			data-team={info.school}
		>
			<div className="d-flex align-items-baseline gap-1">
				{showSeeds ? (
					<span className="small text-body-secondary" style={{ minWidth: 16 }}>
						{seed}
					</span>
				) : null}
				<span
					className="text-truncate flex-grow-1"
					title={`${info.school} (${info.record})`}
				>
					{info.school}
				</span>
				{score !== undefined ? (
					<span>
						{score}
						{ot ? (
							<span className="small fw-normal">
								{ot > 1 ? ` ${ot}OT` : " OT"}
							</span>
						) : null}
					</span>
				) : null}
			</div>
			{info.prospects.length > 0 ? (
				<div
					className="fw-normal text-truncate"
					style={{ marginLeft: showSeeds ? 20 : 0, fontSize: "0.75rem" }}
				>
					<ProspectLinks prospects={info.prospects} short />
				</div>
			) : null}
		</div>
	);
};

const GameBox = ({
	game,
	teamInfo,
	showSeeds,
	label,
}: {
	game: NcaaGame;
	teamInfo: (team: number) => BracketTeamInfo;
	showSeeds: boolean;
	label?: string;
}) => {
	const bye = game.b < 0;
	if (bye) {
		// The team shows up in the next round. An empty slot keeps the bracket lined up
		return <div aria-hidden="true" />;
	}
	const aWon = game.scoreA > game.scoreB;
	return (
		<div
			className="border rounded bg-body my-1"
			style={{ fontSize: "0.85rem" }}
			data-testid="bracket-game"
		>
			{label ? (
				<div className="small text-body-secondary px-1 border-bottom">
					{label}
				</div>
			) : null}
			<TeamRow
				team={game.a}
				seed={game.seedA}
				score={game.scoreA}
				won={aWon}
				info={teamInfo(game.a)}
				showSeeds={showSeeds}
				ot={aWon ? game.ot : undefined}
			/>
			<div className="border-top" />
			<TeamRow
				team={game.b}
				seed={game.seedB}
				score={game.scoreB}
				won={!aWon}
				info={teamInfo(game.b)}
				showSeeds={showSeeds}
				ot={!aWon ? game.ot : undefined}
			/>
		</div>
	);
};

/**
 * Single elimination bracket, one column per round, winners in bold. Columns scroll sideways on a small screen.
 */
export const Bracket = ({
	rounds,
	roundNames,
	teamInfo,
	showSeeds = false,
	wide = false,
	gameLabels,
}: {
	rounds: NcaaGame[][];
	roundNames: string[];
	teamInfo: (team: number) => BracketTeamInfo;
	showSeeds?: boolean;
	// Few games: let them be wider, side by side
	wide?: boolean;
	gameLabels?: string[];
}) => {
	if (gameLabels) {
		// Independent games (like the First Four), in a grid
		return (
			<div className="row g-2" style={{ maxWidth: 900 }}>
				{rounds[0]!.map((game, i) => (
					<div className="col-12 col-sm-6" key={i}>
						<GameBox
							game={game}
							teamInfo={teamInfo}
							showSeeds={showSeeds}
							label={gameLabels[i]}
						/>
					</div>
				))}
			</div>
		);
	}
	return (
		<div
			className="d-flex overflow-auto pb-2"
			style={{ gap: 12 }}
			data-testid="bracket"
		>
			{rounds.map((games, r) => (
				<div
					key={r}
					className="d-flex flex-column"
					style={{
						minWidth: wide ? 220 : 180,
						maxWidth: wide ? 300 : 210,
						flex: "1 0 auto",
					}}
				>
					<div className="fw-bold small text-center mb-1 text-nowrap">
						{roundNames[r]}
					</div>
					<div className="d-flex flex-column justify-content-around flex-grow-1">
						{games.map((game, i) => (
							<GameBox
								key={i}
								game={game}
								teamInfo={teamInfo}
								showSeeds={showSeeds}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
};
