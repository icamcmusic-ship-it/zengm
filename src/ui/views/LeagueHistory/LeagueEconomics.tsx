import { useMemo } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import {
	DataTable,
	type DataTableRow,
} from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { frivolitiesMenu } from "../Frivolities.tsx";
import {
	SeriesChart,
	TeamHistoryLink,
	TeamSeasonLink,
	pct,
	type ChartRow,
} from "./common.tsx";

// Payrolls are in thousands of dollars
const money = (x: number) => helpers.formatCurrency(x / 1000, "M", 1);

const PAYROLL_SERIES = [
	{ key: "mean", label: "Average payroll" },
	{ key: "max", label: "Biggest payroll", dashed: true },
];
const PAYROLL_BAND = { lo: "min", hi: "max", label: "Smallest to biggest" };
const GINI_SERIES = [{ key: "gini", label: "Gini coefficient of payrolls" }];
const giniFormat = (y: number) => y.toFixed(2);

const growthText = (g: number | null) =>
	g === null
		? "–"
		: `${g > 0.0005 ? "+" : g < -0.0005 ? "−" : ""}${pct(Math.abs(g))}`;

const LeagueEconomics = ({
	champions,
	cheapestChampions,
	latestTeamInfos,
	numTaxes,
	seasons,
	summary,
	taxByTeam,
	taxes,
	teamInfos,
	unknownSeasons,
}: View<"leagueEconomics">) => {
	useTitleBar({ title: "League Economics", customMenu: frivolitiesMenu });

	const info = (tid: number, season?: number) =>
		(season !== undefined ? teamInfos[`${tid}|${season}`] : undefined) ??
		latestTeamInfos[tid] ?? { abbrev: "???", region: "", name: "" };

	const payrollRows = useMemo(
		() =>
			seasons.map((s): ChartRow => ({
				x: s.season,
				mean: s.mean,
				max: s.max,
				min: s.min,
				gini: s.gini,
			})),
		[seasons],
	);

	const champBySeason = new Map(champions.map((c) => [c.season, c]));

	if (seasons.length === 0 && taxes.length === 0) {
		return (
			<p>
				No season has end of season payrolls yet. They are recorded when a
				season's playoffs end, so check back after this season.
				{unknownSeasons.length > 0
					? " Seasons imported without payrolls are left out (unknown, not $0)."
					: ""}
			</p>
		);
	}

	const last = seasons.at(-1);

	const seasonCols = getCols([
		{ title: "Season", sortType: "number" },
		{ title: "Average", sortType: "number" },
		{
			title: "Growth",
			desc: "Change in the average payroll per season",
			sortType: "number",
		},
		{ title: "Biggest", sortType: "number" },
		{ title: "Smallest", sortType: "number" },
		{
			title: "Gap",
			desc: "Biggest minus smallest payroll",
			sortType: "number",
		},
		{
			title: "Gini",
			desc: "0 = every team pays the same; higher = payrolls further apart",
			sortType: "number",
		},
		{
			title: "Tax Payers",
			desc: "Teams that paid the luxury tax, and the total",
			sortType: "number",
		},
		{
			title: "Champion",
			desc: "Champion's payroll rank (1 = biggest)",
			sortType: "number",
		},
	]);
	const seasonRows: DataTableRow[] = [...seasons].reverse().map((s) => {
		const c = champBySeason.get(s.season);
		return {
			key: s.season,
			data: [
				s.season,
				{ value: money(s.mean), sortValue: s.mean },
				{ value: growthText(s.growth), sortValue: s.growth },
				{
					value: (
						<>
							<TeamSeasonLink
								tid={s.top.tid}
								abbrev={info(s.top.tid, s.season).abbrev}
								season={s.season}
							/>{" "}
							{money(s.max)}
						</>
					),
					sortValue: s.max,
				},
				{
					value: (
						<>
							<TeamSeasonLink
								tid={s.bottom.tid}
								abbrev={info(s.bottom.tid, s.season).abbrev}
								season={s.season}
							/>{" "}
							{money(s.min)}
						</>
					),
					sortValue: s.min,
				},
				{ value: money(s.spread), sortValue: s.spread },
				{ value: s.gini === null ? "–" : s.gini.toFixed(3), sortValue: s.gini },
				{
					value: s.taxPayers > 0 ? `${s.taxPayers}, ${money(s.taxTotal)}` : "0",
					sortValue: s.taxTotal,
				},
				{
					value: c ? (
						<>
							<TeamSeasonLink
								tid={c.tid}
								abbrev={info(c.tid, c.season).abbrev}
								season={c.season}
							/>{" "}
							{helpers.ordinal(c.rank)} of {c.of}
						</>
					) : (
						<span className="text-body-secondary">–</span>
					),
					sortValue: c ? c.rank : null,
				},
			],
		};
	});

	const cheapCols = getCols([
		{ title: "Champion", sortType: "string" },
		{ title: "Payroll", sortType: "number" },
		{
			title: "Of Average",
			desc: "Payroll as a share of that season's average",
			sortType: "number",
		},
		{ title: "Rank", desc: "Payroll rank (1 = biggest)", sortType: "number" },
	]);
	const cheapRows: DataTableRow[] = cheapestChampions.map((c) => {
		const t = info(c.tid, c.season);
		return {
			key: c.season,
			data: [
				{
					value: (
						<TeamSeasonLink tid={c.tid} abbrev={t.abbrev} season={c.season}>
							{c.season} {t.region} {t.name}
						</TeamSeasonLink>
					),
					sortValue: c.season,
				},
				{ value: money(c.payroll), sortValue: c.payroll },
				{ value: pct(c.rel, 0), sortValue: c.rel },
				{ value: `${helpers.ordinal(c.rank)} of ${c.of}`, sortValue: c.rank },
			],
		};
	});

	const taxTeamCols = getCols([
		{ title: "Team", sortType: "string" },
		{ title: "Times", desc: "Seasons paying the tax", sortType: "number" },
		{ title: "Total", sortType: "number" },
		{ title: "Last", sortType: "number" },
	]);
	const taxTeamRows: DataTableRow[] = taxByTeam.map((x) => {
		const t = info(x.tid);
		return {
			key: x.tid,
			data: [
				{
					value: (
						<TeamHistoryLink tid={x.tid} abbrev={t.abbrev}>
							{t.region} {t.name}
						</TeamHistoryLink>
					),
					sortValue: `${t.region} ${t.name}`,
				},
				x.times,
				{ value: money(x.total), sortValue: x.total },
				x.last,
			],
		};
	});

	const taxCols = getCols([
		{ title: "Team", sortType: "number" },
		{ title: "Tax", sortType: "number" },
		{ title: "Payroll", sortType: "number" },
	]);
	const taxRows: DataTableRow[] = taxes.map((x) => {
		const t = info(x.tid, x.season);
		return {
			key: `${x.tid}-${x.season}`,
			data: [
				{
					value: (
						<TeamSeasonLink tid={x.tid} abbrev={t.abbrev} season={x.season}>
							{x.season} {t.abbrev}
						</TeamSeasonLink>
					),
					sortValue: x.season,
				},
				{ value: money(x.amount), sortValue: x.amount },
				{
					value: x.payroll !== null ? money(x.payroll) : "–",
					sortValue: x.payroll,
				},
			],
		};
	});

	return (
		<>
			<p>
				Payroll inequality, luxury tax bills, payroll growth and whether the
				biggest payroll wins. Payrolls are as of the end of each season. More:{" "}
				<a href={helpers.leagueUrl(["league_finances"])}>League Finances</a>
			</p>

			{summary && last ? (
				<div className="row row-cols-2 row-cols-md-4 g-2 mb-3">
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Seasons with payrolls
							</div>
							<div className="fs-5 fw-bold">{summary.n}</div>
							<div className="small">
								{summary.from === summary.to
									? summary.from
									: `${summary.from}-${summary.to}`}
							</div>
						</div>
					</div>
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Payroll gap, {last.season}
							</div>
							<div className="fs-5 fw-bold">{money(last.spread)}</div>
							<div className="small">
								Gini {last.gini === null ? "–" : last.gini.toFixed(3)}
							</div>
						</div>
					</div>
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Average payroll growth
							</div>
							<div className="fs-5 fw-bold">
								{summary.cagr === null
									? "–"
									: `${growthText(summary.cagr)} a year`}
							</div>
							<div className="small">
								{money(seasons[0]!.mean)} → {money(last.mean)}
							</div>
						</div>
					</div>
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Biggest payroll won it all
							</div>
							<div className="fs-5 fw-bold">
								{summary.decided > 0
									? `${summary.topPaidWon} of ${summary.decided}`
									: "–"}
							</div>
							<div className="small">
								{summary.decided > 0
									? `Top 3 payrolls won ${summary.top3Won}`
									: "No finished season with payrolls"}
							</div>
						</div>
					</div>
				</div>
			) : null}

			{unknownSeasons.length > 0 ? (
				<p className="small text-body-secondary">
					{unknownSeasons.length} season{unknownSeasons.length === 1 ? "" : "s"}{" "}
					without payrolls for most teams (
					{unknownSeasons.length > 4
						? `${unknownSeasons[0]}-${unknownSeasons.at(-1)}`
						: unknownSeasons.join(", ")}
					) {unknownSeasons.length === 1 ? "is" : "are"} left out: unknown, not
					$0. The season in progress gets its payrolls when its playoffs end.
				</p>
			) : null}

			{seasons.length > 1 ? (
				<div className="row">
					<div className="col-lg-6">
						<h2>Payrolls by season</h2>
						<SeriesChart
							rows={payrollRows}
							series={PAYROLL_SERIES}
							band={PAYROLL_BAND}
							yFormat={(y) => money(y)}
							zero
							ariaLabel="Team payroll range and average by season"
							renderTooltip={(row) => (
								<>
									<b>{row.x}</b>
									<br />
									Average: {money(row.mean!)}
									<br />
									Biggest: {money(row.max!)}
									<br />
									Smallest: {money(row.min!)}
								</>
							)}
						/>
					</div>
					<div className="col-lg-6">
						<h2>Inequality by season</h2>
						<SeriesChart
							rows={payrollRows}
							series={GINI_SERIES}
							yFormat={giniFormat}
							zero
							ariaLabel="Gini coefficient of team payrolls by season"
							renderTooltip={(row) => (
								<>
									<b>{row.x}</b>
									<br />
									Gini: {row.gini === null ? "–" : row.gini!.toFixed(3)}
								</>
							)}
						/>
					</div>
				</div>
			) : null}

			{seasonRows.length > 0 ? (
				<>
					<h2>Season by season</h2>
					<DataTable
						cols={seasonCols}
						defaultSort={[0, "desc"]}
						name="LeagueEconomicsSeasons"
						pagination={seasonRows.length > 25}
						rows={seasonRows}
						small
					/>
				</>
			) : null}

			{cheapRows.length > 0 ? (
				<>
					<h2 className="mt-4">Cheapest champions</h2>
					<p className="small text-body-secondary">
						Title teams by payroll against that season's average (100% =
						average).
						{summary?.meanRank !== null && summary?.meanRank !== undefined
							? ` The champion's payroll ranked ${summary.meanRank.toFixed(1)} on average (1 = biggest).`
							: ""}
					</p>
					<DataTable
						cols={cheapCols}
						defaultSort={[2, "asc"]}
						name="LeagueEconomicsCheapest"
						rows={cheapRows}
						small
					/>
				</>
			) : null}

			<h2 className="mt-4">Luxury tax</h2>
			{taxRows.length > 0 ? (
				<div className="row">
					<div className="col-md-6">
						<h3>Payers, all time</h3>
						<DataTable
							cols={taxTeamCols}
							defaultSort={[2, "desc"]}
							name="LeagueEconomicsTaxTeams"
							pagination={taxTeamRows.length > 15}
							rows={taxTeamRows}
							small
						/>
					</div>
					<div className="col-md-6">
						<h3>Biggest bills</h3>
						{numTaxes > taxes.length ? (
							<p className="small text-body-secondary">
								Top {taxes.length} of {numTaxes}.
							</p>
						) : null}
						<DataTable
							cols={taxCols}
							defaultSort={[1, "desc"]}
							name="LeagueEconomicsTaxes"
							pagination={taxRows.length > 15}
							rows={taxRows}
							small
						/>
					</div>
				</div>
			) : (
				<p>No team has paid the luxury tax yet.</p>
			)}
		</>
	);
};

export default LeagueEconomics;
