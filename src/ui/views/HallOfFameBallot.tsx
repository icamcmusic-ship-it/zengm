import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import {
	DataTable,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import type { View } from "../../common/types.ts";
import HideableSection from "../components/HideableSection.tsx";
import { realtimeUpdate } from "../util/realtimeUpdate.ts";

const resultText = (result: string | undefined, year: number) => {
	if (result === "inducted") {
		return year === 1 ? "Inducted (first ballot)" : "Inducted";
	}
	if (result === "dropped") {
		return "Dropped (under 5%)";
	}
	if (result === "expired") {
		return "Out of years";
	}
	return "Stays on ballot";
};

const teamLink = (abbrev: string, tid: number) =>
	tid >= 0 && abbrev ? (
		<a href={helpers.leagueUrl(["team_history", `${abbrev}_${tid}`])}>
			{abbrev}
		</a>
	) : null;

const HallOfFameBallot = ({
	ballot,
	ceremony,
	dropPct,
	inductPct,
	season,
	seasons,
	snubs,
	veterans,
	voters,
	wait,
	wing,
}: View<"hallOfFameBallot">) => {
	useTitleBar({ title: "Hall of Fame Ballot" });

	const ballotCols = [
		...getCols(["#"]),
		{ title: "Name", sortType: "name" as const },
		...getCols(["Team", "Retired"]),
		{ title: "Year", desc: "Year on the ballot", sortType: "number" as const },
		{ title: "Vote", desc: "Share of the vote", sortType: "number" as const },
		{
			title: "Score",
			desc: "Hall of Fame score, per 100 of the instant-induction line",
			sortType: "number" as const,
		},
		{ title: "Result", sortType: "string" as const },
	];
	const ballotRows: DataTableRow[] = ballot.map((row, i) => ({
		key: row.pid,
		data: [
			i + 1,
			<a href={helpers.leagueUrl(["player", row.pid])}>{row.name}</a>,
			teamLink(row.abbrev, row.tid),
			row.retiredYear,
			row.year,
			{ value: `${row.pct.toFixed(1)}%`, sortValue: row.pct },
			Math.round((100 * row.score) / row.threshold),
			resultText(row.result, row.year),
		],
		classNames: {
			"table-success": row.result === "inducted",
			"table-secondary": row.result === "dropped" || row.result === "expired",
		},
	}));

	const snubCols = [
		{ title: "Name", sortType: "name" as const },
		...getCols(["Team", "Retired"]),
		{
			title: "Years",
			desc: "Years on the ballot",
			sortType: "number" as const,
		},
		{
			title: "Best",
			desc: "Best share of the vote",
			sortType: "number" as const,
		},
		{
			title: "Last",
			desc: "Last share of the vote",
			sortType: "number" as const,
		},
		{
			title: "Score",
			desc: "Hall of Fame score, per 100 of the instant-induction line",
			sortType: "number" as const,
		},
	];
	const snubRows: DataTableRow[] = snubs.map((row) => ({
		key: row.pid,
		data: [
			<a href={helpers.leagueUrl(["player", row.pid])}>{row.name}</a>,
			teamLink(row.abbrev, row.tid),
			row.retiredYear,
			row.years,
			{ value: `${row.maxPct.toFixed(1)}%`, sortValue: row.maxPct },
			{ value: `${row.lastPct.toFixed(1)}%`, sortValue: row.lastPct },
			Math.round((100 * row.score) / row.threshold),
		],
	}));

	return (
		<>
			<p>
				Retired players are on the ballot {wait}{" "}
				{helpers.plural("season", wait)} after retiring, if their Hall of Fame
				score is close enough to the line. {voters ?? 400} voters; {inductPct}%
				gets a player in, under {dropPct}% drops him, and nobody stays on more
				than 10 years. Every few seasons a veterans committee can induct a
				player who fell off.
			</p>

			{seasons.length > 0 ? (
				<div className="mb-3">
					<select
						className="form-select form-select-sm"
						style={{ maxWidth: 160 }}
						value={season}
						aria-label="Season"
						onChange={(event) => {
							realtimeUpdate(
								[],
								helpers.leagueUrl([
									"hall_of_fame_ballot",
									Number(event.target.value),
								]),
							);
						}}
					>
						{seasons.toReversed().map((s) => (
							<option key={s} value={s}>
								Class of {s}
							</option>
						))}
					</select>
				</div>
			) : (
				<p>No ballot has been held yet.</p>
			)}

			{season !== undefined && seasons.length > 0 ? (
				<HideableSection title={`${season} ballot`} className="mb-3">
					{ballot.length > 0 ? (
						<DataTable
							cols={ballotCols}
							defaultSort={[0, "asc"]}
							defaultStickyCols={window.mobile ? 0 : 2}
							name="HallOfFameBallot"
							pagination
							rows={ballotRows}
						/>
					) : (
						<p>Nobody was on the ballot.</p>
					)}
					{veterans.length > 0 ? (
						<p>
							Veterans committee:{" "}
							{veterans.map((row, i) => (
								<span key={row.pid}>
									{i > 0 ? ", " : ""}
									<a href={helpers.leagueUrl(["player", row.pid])}>
										{row.name}
									</a>{" "}
									(retired {row.retiredYear})
								</span>
							))}
						</p>
					) : null}
					{wing.length > 0 ? (
						<p>
							Coaches and executives:{" "}
							{wing.map((row, i) => (
								<span key={`${row.kind}${row.id}`}>
									{i > 0 ? ", " : ""}
									{row.kind === "coach" ? (
										<a href={helpers.leagueUrl(["coach", row.id])}>
											{row.name}
										</a>
									) : (
										row.name
									)}{" "}
									({row.kind === "coach" ? "coach" : "executive"}, {row.line})
								</span>
							))}
						</p>
					) : null}
				</HideableSection>
			) : null}

			{ceremony.length > 0 ? (
				<HideableSection title="Induction ceremony" className="mb-3">
					{ceremony.map((c) => (
						<div
							key={c.pid}
							className="border rounded p-3 mb-2 bg-body-tertiary"
							style={{ maxWidth: 720 }}
						>
							<h3 className="h5 mb-1">
								<a href={helpers.leagueUrl(["player", c.pid])}>{c.name}</a>
							</h3>
							<p className="small text-body-secondary">{c.line}</p>
							{c.speech.map((paragraph, i) => (
								<p key={i} className={i === c.speech.length - 1 ? "mb-0" : ""}>
									{paragraph}
								</p>
							))}
						</div>
					))}
				</HideableSection>
			) : null}

			<HideableSection title="Snubs">
				<p>
					The best players who fell off the ballot or ran out of years and are
					still not in.
				</p>
				{snubRows.length > 0 ? (
					<DataTable
						cols={snubCols}
						defaultSort={[6, "desc"]}
						defaultStickyCols={window.mobile ? 0 : 1}
						name="HallOfFameSnubs"
						rows={snubRows}
					/>
				) : (
					<p>None yet.</p>
				)}
			</HideableSection>
		</>
	);
};

export default HallOfFameBallot;
