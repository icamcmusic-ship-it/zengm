import { useMemo } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import {
	DataTable,
	type DataTableRow,
} from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import type { PickSummary } from "../../../common/leagueHistory/pickValue.ts";
import { frivolitiesMenu } from "../Frivolities.tsx";
import {
	HistoryLoading,
	PlayerLink,
	SeriesChart,
	rate,
	rateTitle,
	type ChartRow,
} from "./common.tsx";

type Loaded = Extract<View<"pickValue">, { loading: false }>;

const ws = (x: number | null) => (x === null ? "–" : x.toFixed(1));

const SERIES = [
	{ key: "mean", label: "Mean career WS" },
	{ key: "median", label: "Median career WS", dashed: true },
];
const BAND = { lo: "p25", hi: "p75", label: "Middle half of careers" };
const yFormat = (y: number) => y.toFixed(0);

const summaryCells = (s: PickSummary, names: Record<number, string>) => [
	s.n,
	{ value: ws(s.mean), sortValue: s.mean },
	{ value: ws(s.median), sortValue: s.median },
	{
		value: s.n > 0 ? `${ws(s.p25)}-${ws(s.p75)}` : "–",
		sortValue: s.p75,
	},
	{
		value:
			s.best !== null ? (
				<>
					<PlayerLink pid={s.best} name={names[s.best] ?? ""} />{" "}
					<span className="small text-body-secondary">{ws(s.max)}</span>
				</>
			) : (
				"–"
			),
		sortValue: s.max,
		searchValue: s.best !== null ? (names[s.best] ?? "") : "",
	},
	{
		value: <span title={rateTitle(s.played, "played")}>{rate(s.played)}</span>,
		sortValue: s.played.n > 0 ? s.played.hit / s.played.n : null,
	},
	{
		value: (
			<span title={rateTitle(s.starter, "became starters")}>
				{rate(s.starter)}
			</span>
		),
		sortValue: s.starter.n > 0 ? s.starter.hit / s.starter.n : null,
	},
	{
		value: (
			<span title={rateTitle(s.allStar, "became All-Stars")}>
				{rate(s.allStar)}
			</span>
		),
		sortValue: s.allStar.n > 0 ? s.allStar.hit / s.allStar.n : null,
	},
];

const summaryCols = (first: string) =>
	getCols([
		{ title: first, sortType: "number" },
		{ title: "N", desc: "Players", sortType: "number" },
		{ title: "Mean", desc: "Mean career win shares", sortType: "number" },
		{ title: "Median", desc: "Median career win shares", sortType: "number" },
		{
			title: "Middle Half",
			desc: "25th to 75th percentile of career win shares",
			sortType: "number",
		},
		{ title: "Best", desc: "Best career at this pick", sortType: "number" },
		{ title: "Played", desc: "Played at least one game", sortType: "number" },
		{
			title: "Starter",
			desc: "A season of 20+ games starting at least half of them",
			sortType: "number",
		},
		{
			title: "All-Star",
			desc: "Made at least one All-Star team",
			sortType: "number",
		},
	]);

const PickValueLoaded = ({
	hasDraftClasses,
	names,
	startingSeason,
	value: V,
}: Loaded) => {
	useTitleBar({ title: "Draft Pick Value", customMenu: frivolitiesMenu });

	const chartRows = useMemo(
		() =>
			V
				? V.slots
						.filter((s) => s.n > 0)
						.map((s): ChartRow => ({
							x: s.pick,
							mean: s.mean,
							median: s.median,
							p25: s.p25,
							p75: s.p75,
							n: s.n,
						}))
				: [],
		[V],
	);

	if (!V) {
		return (
			<p>
				{hasDraftClasses
					? `No draft class since the league began in ${startingSeason} has 4 seasons in the books yet (classes drafted before then are partial), so no pick has a track record to chart.`
					: "Nobody has been drafted yet, so there is no pick value to chart."}
			</p>
		);
	}

	const slotRows: DataTableRow[] = V.slots.map((s) => ({
		key: s.pick,
		data: [s.pick, ...summaryCells(s, names)],
	}));
	const bandRows: DataTableRow[] = [
		...V.bands.map((b) => ({
			key: b.label,
			data: [{ value: b.label, sortValue: b.lo }, ...summaryCells(b, names)],
		})),
		{
			key: "undrafted",
			data: [
				{ value: "Undrafted", sortValue: 9999 },
				...summaryCells(V.undrafted, names),
			],
		},
	];
	const top = V.bands[0];

	return (
		<>
			<p>
				What every pick has produced in this league: the typical career, the
				range of outcomes and how often the pick hits. Draft classes{" "}
				{V.from === V.to ? V.from : `${V.from}-${V.to}`} ({V.classes} class
				{V.classes === 1 ? "" : "es"}, {V.numPicks} picks with {V.mature}+
				seasons played since). Career regular season win shares; a pick who
				never played counts as 0. More:{" "}
				<a href={helpers.leagueUrl(["frivolities", "redraft"])}>Redraft</a> |{" "}
				<a href={helpers.leagueUrl(["frivolities", "draft_position"])}>
					Best Player at Every Pick
				</a>
			</p>

			{top ? (
				<p>
					Picks {top.label} average <b>{ws(top.mean)}</b> career WS and become
					All-Stars {rate(top.allStar)} of the time
					{V.undrafted.n > 0 ? (
						<>
							; undrafted players who made it average{" "}
							<b>{ws(V.undrafted.mean)}</b>
						</>
					) : null}
					.
				</p>
			) : null}

			<h2>Career win shares by pick</h2>
			<SeriesChart
				rows={chartRows}
				series={SERIES}
				band={BAND}
				yFormat={yFormat}
				zero
				ariaLabel="Mean and median career win shares by overall pick"
				renderTooltip={(row) => (
					<>
						<b>Pick {row.x}</b> ({row.n} players)
						<br />
						Mean: {ws(row.mean ?? null)} WS
						<br />
						Median: {ws(row.median ?? null)} WS
						<br />
						Middle half: {ws(row.p25 ?? null)}-{ws(row.p75 ?? null)}
					</>
				)}
			/>

			<h2 className="mt-3">By pick range</h2>
			<p className="small text-body-secondary">
				Hit rates leave out players whose outcome is unknown rather than
				counting them as misses: "Starter" needs games started on file for the
				season, and "All-Star" is a no only after a season in which All-Stars
				were named. Hover a rate for the counts.
			</p>
			<DataTable
				cols={summaryCols("Picks")}
				defaultSort={[0, "asc"]}
				name="PickValueBands"
				rows={bandRows}
				small
			/>

			{V.eras.length > 0 ? (
				<>
					<h2 className="mt-3">By era</h2>
					<div className="table-responsive">
						<table className="table table-sm table-striped table-hover w-auto">
							<thead>
								<tr>
									<th>Picks</th>
									{V.eras.map((e) => (
										<th
											key={e.label}
											className="text-end"
											title={`${e.n} picks`}
										>
											{e.label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{V.bands.map((b, i) => (
									<tr key={b.label}>
										<td>{b.label}</td>
										{V.eras.map((e) => {
											const x = e.bands[i];
											return (
												<td key={e.label} className="text-end">
													{x && x.n > 0 ? (
														<span
															title={`${x.n} players, All-Star ${rate(x.allStar)}`}
														>
															{ws(x.mean)}
														</span>
													) : (
														"–"
													)}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="small text-body-secondary">
						Mean career win shares, by draft years.
					</p>
				</>
			) : null}

			<h2 className="mt-3">Every pick</h2>
			<DataTable
				cols={summaryCols("Pick")}
				defaultSort={[0, "asc"]}
				name="PickValueSlots"
				pagination={slotRows.length > 30}
				rows={slotRows}
				small
			/>
		</>
	);
};

const PickValueLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "Draft Pick Value", customMenu: frivolitiesMenu });
	return <HistoryLoading progress={progress} />;
};

const PickValue = (props: View<"pickValue">) => {
	if (props.loading) {
		return <PickValueLoading progress={props.progress} />;
	}
	return <PickValueLoaded {...props} />;
};

export default PickValue;
