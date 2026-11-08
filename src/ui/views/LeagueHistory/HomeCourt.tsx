import { MoreLinks } from "../../components/MoreLinks.tsx";
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
	signed,
	type ChartRow,
} from "./common.tsx";

type Props = View<"homeCourt">;
type ListRow = Props["lists"]["bestHome"][number];

const rec = (w: number, l: number) => `${w}-${l}`;
const yFormat = (y: number) => `${y.toFixed(0)}%`;

const roundName = (back: number, numRounds: number) => {
	if (back === 0) {
		return "Finals";
	}
	if (back === 1 && numRounds > 2) {
		return "Semifinals";
	}
	return `${helpers.ordinal(numRounds - back)} round`;
};

const List = ({
	title,
	rows,
	show,
}: {
	title: string;
	rows: ListRow[];
	show: (r: ListRow) => string;
}) => (
	<div className="col-md-6 col-lg-4 mb-3">
		<h3>{title}</h3>
		{rows.length > 0 ? (
			<ol className="ps-4 mb-0">
				{rows.map((r) => (
					<li key={`${r.tid}-${r.season}`}>
						<TeamSeasonLink tid={r.tid} abbrev={r.abbrev} season={r.season}>
							{r.season} {r.name}
						</TeamSeasonLink>{" "}
						<span className="small text-body-secondary">{show(r)}</span>
					</li>
				))}
			</ol>
		) : (
			<p className="text-body-secondary">None yet.</p>
		)}
	</div>
);

const HomeCourt = ({
	box,
	eras,
	lists,
	po,
	seasons,
	series,
	teamInfos,
	teams,
	total,
}: Props) => {
	useTitleBar({ title: "Home Court", customMenu: frivolitiesMenu });

	const withSplits = seasons.filter((s) => s.p !== null);
	const chartRows = useMemo(
		() =>
			seasons
				.filter((s) => s.p !== null || s.box)
				.map((s): ChartRow => ({
					x: s.season,
					splits: s.p === null ? null : 100 * s.p,
					box: s.box ? (100 * s.box.hw) / s.box.g : null,
				})),
		[seasons],
	);
	const chartSeries = useMemo(
		() =>
			box.g > 0
				? [
						{ key: "splits", label: "Home win% (standings)" },
						{ key: "box", label: "Home win% (box scores)", dashed: true },
					]
				: [{ key: "splits", label: "Home win% (standings)" }],
		[box.g],
	);

	if (withSplits.length === 0 && box.g === 0 && series.n === 0) {
		return (
			<p>No games have been played yet, so home court can't be measured.</p>
		);
	}

	const eraCols = getCols([
		{ title: "Era", sortType: "number" },
		{ title: "Home Record", sortType: "number" },
		{ title: "Home Win%", sortType: "number" },
	]);
	const eraRows: DataTableRow[] = [...eras].reverse().map((e) => ({
		key: e.decade,
		data: [
			{
				value: e.from === e.to ? `${e.from}` : `${e.from}-${e.to}`,
				sortValue: e.from,
			},
			{ value: rec(e.hw, e.hl), sortValue: e.hw },
			{ value: pct(e.p), sortValue: e.p },
		],
	}));

	const seasonCols = getCols([
		{ title: "Season", sortType: "number" },
		{ title: "Home Win%", sortType: "number" },
		{
			title: "Home Margin",
			desc: "Average home scoring margin in the box scores on file",
			sortType: "number",
		},
		{
			title: "Playoff Home Win%",
			desc: "Home win% in the playoff box scores on file",
			sortType: "number",
		},
		{
			title: "Series",
			desc: "Playoff series won by the side with home court",
			sortType: "number",
		},
	]);
	const seasonRows: DataTableRow[] = [...seasons].reverse().map((s) => ({
		key: s.season,
		data: [
			s.season,
			{ value: pct(s.p), sortValue: s.p },
			{
				value: s.box ? signed(s.box.margin) : "–",
				sortValue: s.box?.margin ?? null,
			},
			{
				value: s.po ? pct(s.po.hw / s.po.g) : "–",
				sortValue: s.po ? s.po.hw / s.po.g : null,
			},
			{
				value: s.series.n > 0 ? `${s.series.won} of ${s.series.n}` : "–",
				sortValue: s.series.n > 0 ? s.series.won / s.series.n : null,
			},
		],
	}));

	const maxHome = Math.max(0, ...teams.map((t) => t.hw + t.hl));
	const minHome = Math.min(150, Math.max(20, Math.round(0.5 * maxHome)));
	const qualified = teams.filter((t) => t.hw + t.hl >= minHome);
	const teamCols = getCols([
		{ title: "Team", sortType: "string" },
		{ title: "Home", desc: "Home win%", sortType: "number" },
		{ title: "Road", desc: "Road win%", sortType: "number" },
		{
			title: "Gap",
			desc: "Home win% minus road win%, in points",
			sortType: "number",
		},
		{ title: "Seasons", sortType: "number" },
	]);
	const teamRows: DataTableRow[] = qualified.map((t) => {
		const info = teamInfos[t.tid];
		return {
			key: t.tid,
			data: [
				{
					value: info ? (
						<TeamHistoryLink tid={t.tid} abbrev={info.abbrev}>
							{info.region} {info.name}
						</TeamHistoryLink>
					) : (
						t.tid
					),
					sortValue: info ? `${info.region} ${info.name}` : "",
				},
				{
					value: <span title={rec(t.hw, t.hl)}>{pct(t.homeP)}</span>,
					sortValue: t.homeP,
				},
				{
					value: <span title={rec(t.aw, t.al)}>{pct(t.roadP)}</span>,
					sortValue: t.roadP,
				},
				{
					value: signed(t.gap === null ? null : 100 * t.gap),
					sortValue: t.gap,
				},
				t.seasons,
			],
		};
	});

	const numRounds = series.byRound.length;

	return (
		<>
			<MoreLinks type="finances" page="frivolities/home_court" />
			<p>
				What playing at home is worth: by season, by era, by team and in the
				playoffs. Regular season records come from the standings; margins come
				from the box scores still on file (neutral site games and ties left
				out). More:{" "}
				<a href={helpers.leagueUrl(["team_records"])}>Team Records</a>
			</p>

			<div className="row row-cols-2 row-cols-md-4 g-2 mb-3">
				<div className="col">
					<div className="border rounded p-2 h-100">
						<div className="small text-body-secondary">Home teams won</div>
						<div className="fs-5 fw-bold">{pct(total.p)}</div>
						<div className="small">
							{helpers.numberWithCommas(total.hw + total.hl)} games,{" "}
							{withSplits.length} season{withSplits.length === 1 ? "" : "s"}
						</div>
					</div>
				</div>
				{box.g > 0 ? (
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Home scoring margin
							</div>
							<div className="fs-5 fw-bold">{signed(box.margin)} pts</div>
							<div className="small">
								{helpers.numberWithCommas(box.g)} box scores
							</div>
						</div>
					</div>
				) : null}
				{po.g > 0 ? (
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Playoff home games
							</div>
							<div className="fs-5 fw-bold">{pct(po.hw / po.g)}</div>
							<div className="small">
								{helpers.numberWithCommas(po.g)} games, margin{" "}
								{signed(po.margin)}
							</div>
						</div>
					</div>
				) : null}
				{series.n > 0 ? (
					<div className="col">
						<div className="border rounded p-2 h-100">
							<div className="small text-body-secondary">
								Home court won the series
							</div>
							<div className="fs-5 fw-bold">{pct(series.won / series.n)}</div>
							<div className="small">{series.n} playoff series</div>
						</div>
					</div>
				) : null}
			</div>

			{chartRows.length > 1 ? (
				<>
					<h2>Home win% by season</h2>
					<SeriesChart
						rows={chartRows}
						series={chartSeries}
						refY={50}
						yFormat={yFormat}
						ariaLabel="Home win percentage by season"
						renderTooltip={(row) => (
							<>
								<b>{row.x}</b>
								<br />
								Standings:{" "}
								{row.splits === null ? "–" : `${row.splits!.toFixed(1)}%`}
								{box.g > 0 ? (
									<>
										<br />
										Box scores:{" "}
										{row.box === null ? "–" : `${row.box!.toFixed(1)}%`}
									</>
								) : null}
							</>
						)}
					/>
				</>
			) : null}

			{withSplits.length > 0 ? (
				<div className="row">
					<div className="col-md-5">
						<h2>By era</h2>
						<DataTable
							cols={eraCols}
							defaultSort={[0, "desc"]}
							name="HomeCourtEras"
							rows={eraRows}
							small
						/>
					</div>
					<div className="col-md-7">
						<h2>Seasons</h2>
						<DataTable
							cols={seasonCols}
							defaultSort={[0, "desc"]}
							name="HomeCourtSeasons"
							pagination={seasonRows.length > 15}
							rows={seasonRows}
							small
						/>
					</div>
				</div>
			) : null}

			{teamRows.length > 0 ? (
				<>
					<h2 className="mt-3">Teams, all time</h2>
					<p className="small text-body-secondary">
						Teams with {minHome}+ home games.
					</p>
					<DataTable
						cols={teamCols}
						defaultSort={[1, "desc"]}
						name="HomeCourtTeams"
						pagination={teamRows.length > 40}
						rows={teamRows}
						small
					/>
				</>
			) : null}

			<div className="row mt-3">
				<List
					title="Best home seasons"
					rows={lists.bestHome}
					show={(r) => `${rec(r.hw, r.hl)} at home`}
				/>
				<List
					title="Best road seasons"
					rows={lists.bestRoad}
					show={(r) => `${rec(r.aw, r.al)} on the road`}
				/>
				<List
					title="Biggest home/road gap"
					rows={lists.biggestGap}
					show={(r) => `${rec(r.hw, r.hl)} home, ${rec(r.aw, r.al)} road`}
				/>
				<List
					title="Worst home seasons"
					rows={lists.worstHome}
					show={(r) => `${rec(r.hw, r.hl)} at home`}
				/>
				<List
					title="Worst road seasons"
					rows={lists.worstRoad}
					show={(r) => `${rec(r.aw, r.al)} on the road`}
				/>
				{lists.betterOnRoad.length > 0 ? (
					<List
						title="Better on the road"
						rows={lists.betterOnRoad}
						show={(r) => `${rec(r.hw, r.hl)} home, ${rec(r.aw, r.al)} road`}
					/>
				) : null}
			</div>

			{series.n > 0 ? (
				<>
					<h2 className="mt-3">Playoffs: does home court win the series?</h2>
					<div className="table-responsive">
						<table className="table table-sm table-striped w-auto">
							<thead>
								<tr>
									<th>Round</th>
									<th className="text-end">Series</th>
									<th className="text-end">Home court won</th>
								</tr>
							</thead>
							<tbody>
								{[...series.byRound].reverse().map((r) => (
									<tr key={r.back}>
										<td>{roundName(r.back, numRounds)}</td>
										<td className="text-end">{r.n}</td>
										<td className="text-end">{pct(r.won / r.n)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="small text-body-secondary">
						Rounds are counted back from the finals, so brackets of different
						sizes line up.
					</p>
				</>
			) : null}
		</>
	);
};

export default HomeCourt;
