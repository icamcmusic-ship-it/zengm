// Player page "Rankings" (League extras, a Records Book option, see common/playerRankings.ts): where his career
// totals rank all-time and in each franchise, and his top single seasons
import { useState } from "react";
import HideableSection from "../../components/HideableSection.tsx";
import { helpers } from "../../util/helpers.ts";
import type { PlayerRankingRow } from "../../../worker/util/playerRankingsData.ts";

const SHOW = 8;

const fmt = (v: number, d: number) =>
	d > 0 ? v.toFixed(d) : helpers.numberWithCommas(Math.round(v));

const rankText = (r: PlayerRankingRow) =>
	`${r.tied ? "T-" : ""}${helpers.ordinal(r.rank)}`;

export const rankingSentence = (r: PlayerRankingRow) => {
	const what = `${r.playoffs ? "playoff " : ""}${r.unit}`;
	if (r.scope === "league") {
		return r.rank === 1
			? `${r.tied ? "Tied for the a" : "A"}ll-time leader in ${what}`
			: `${rankText(r)} all-time in ${what}`;
	}
	if (r.scope === "franchise") {
		return r.rank === 1
			? `${r.tied ? "Tied for f" : "F"}ranchise leader in ${what} for the ${r.teamName}`
			: `${rankText(r)} in ${r.teamName} history in ${what}`;
	}
	return r.rank === 1
		? `${r.tied ? "Tied for the s" : "S"}ingle-season record for ${what}`
		: `${rankText(r)}-most ${what} in a season`;
};

const statsUrl = (r: PlayerRankingRow) =>
	helpers.leagueUrl([
		"player_stats",
		r.scope === "franchise" && r.abbrev !== undefined
			? `${r.abbrev}_${r.tid}`
			: "all",
		r.scope === "season" ? r.season! : "career",
		"totals",
		r.playoffs ? "playoffs" : "regularSeason",
	]);

const Ranking = ({ r }: { r: PlayerRankingRow }) => {
	const sentence = rankingSentence(r);
	return (
		<li className="mb-1">
			<span
				className={`badge rounded-pill me-2 ${
					r.rank === 1 ? "bg-warning text-dark" : "bg-secondary"
				}`}
				style={{ minWidth: 42 }}
				title={`Top ${r.of} shown`}
			>
				#{r.rank}
			</span>
			<a href={statsUrl(r)}>{sentence}</a> ({fmt(r.v, r.d)}
			{r.scope === "season" ? `, ${r.season}` : null})
			{r.scope === "franchise" && r.abbrev !== undefined ? (
				<>
					{" "}
					<a
						className="text-body-secondary"
						href={helpers.leagueUrl(["team_history", `${r.abbrev}_${r.tid}`])}
					>
						history
					</a>
				</>
			) : null}
			{r.above && r.aboveName !== undefined ? (
				<span className="text-body-secondary">
					{" "}
					&middot; {fmt(r.above.v - r.v, r.d)} behind #{r.above.rank}{" "}
					<a href={helpers.leagueUrl(["player", r.above.pid])}>{r.aboveName}</a>
				</span>
			) : null}
		</li>
	);
};

export const Rankings = ({
	rankings,
}: {
	rankings: PlayerRankingRow[] | undefined;
}) => {
	const [all, setAll] = useState(false);
	if (!rankings || rankings.length === 0) {
		return null;
	}
	const shown = all ? rankings : rankings.slice(0, SHOW);
	return (
		<HideableSection
			title="Rankings"
			description="All-time and franchise rankings of his career totals, and his top seasons"
		>
			<ul className="list-unstyled mb-3">
				{shown.map((r) => (
					<Ranking
						key={`${r.scope}|${r.tid ?? ""}|${r.season ?? ""}|${r.stat}|${r.playoffs}`}
						r={r}
					/>
				))}
			</ul>
			{rankings.length > SHOW ? (
				<button
					className="btn btn-light-bordered btn-sm mb-3"
					onClick={() => {
						setAll(!all);
					}}
				>
					{all ? "Show fewer" : `Show all ${rankings.length}`}
				</button>
			) : null}
		</HideableSection>
	);
};
