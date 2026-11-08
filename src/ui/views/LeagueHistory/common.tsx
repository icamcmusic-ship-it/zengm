import { areaY, defineChart, dot, lineY, ruleY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, type ReactNode } from "react";
import { helpers } from "../../util/helpers.ts";
import {
	LINE_CURVE,
	REFERENCE_LINE_DASHARRAY,
} from "../Message/OwnerMoodsChart.tsx";

// Shared bits of the league history pages (Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics, Home Court)

// Placeholder while the worker reads the league history for the first time
export const HistoryLoading = ({ progress }: { progress: string }) => (
	<div role="status" aria-live="polite" data-loading="league-history">
		<div className="d-flex align-items-center gap-2 mb-3 text-body-secondary">
			<div className="spinner-border spinner-border-sm" aria-hidden="true" />
			<span>
				{progress}… The first time takes a while for a big league, and it’s
				quick after that.
			</span>
		</div>
	</div>
);

export const PlayerLink = ({ pid, name }: { pid: number; name: string }) => (
	<a href={helpers.leagueUrl(["player", pid])}>{name || `Player ${pid}`}</a>
);

export const TeamSeasonLink = ({
	tid,
	abbrev,
	season,
	children,
}: {
	tid: number;
	abbrev: string;
	season: number;
	children?: ReactNode;
}) => (
	<a href={helpers.leagueUrl(["roster", `${abbrev}_${tid}`, season])}>
		{children ?? abbrev}
	</a>
);

export const TeamHistoryLink = ({
	tid,
	abbrev,
	children,
}: {
	tid: number;
	abbrev: string;
	children?: ReactNode;
}) => (
	<a href={helpers.leagueUrl(["team_history", `${abbrev}_${tid}`])}>
		{children ?? abbrev}
	</a>
);

// Unknown is a dash, never 0
export const pct = (x: number | null | undefined, digits = 1) =>
	x === null || x === undefined || !Number.isFinite(x)
		? "–"
		: `${(100 * x).toFixed(digits)}%`;

export const signed = (x: number | null | undefined, digits = 1) =>
	x === null || x === undefined || !Number.isFinite(x)
		? "–"
		: `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

export const rate = (r: { hit: number; n: number }) =>
	r.n > 0 ? `${Math.round((100 * r.hit) / r.n)}%` : "–";

export const rateTitle = (r: { hit: number; n: number }, what: string) =>
	r.n > 0 ? `${r.hit} of ${r.n} ${what}` : "Unknown for every player here";

export const SERIES_COLORS = [
	"var(--bs-primary)",
	"var(--bs-danger)",
	"var(--bs-success)",
];

export type ChartRow = { x: number } & Record<string, number | null>;

// A line chart over seasons or pick numbers: up to three series, an optional shaded range and an optional reference line. Hovering a point of the first series shows the tooltip.
export const SeriesChart = ({
	rows,
	series,
	band,
	refY,
	yFormat,
	xLabel,
	ariaLabel,
	height = 260,
	zero,
	renderTooltip,
}: {
	rows: ChartRow[];
	series: { key: string; label: string; dashed?: boolean }[];
	band?: { lo: string; hi: string; label: string };
	refY?: number;
	yFormat: (y: number) => string;
	xLabel?: (x: number) => string;
	ariaLabel: string;
	height?: number;
	zero?: boolean;
	renderTooltip: (row: ChartRow) => ReactNode;
}) => {
	const definition = useMemo(() => {
		const ys: number[] = [];
		const keys = [
			...series.map((s) => s.key),
			...(band ? [band.lo, band.hi] : []),
		];
		for (const row of rows) {
			for (const key of keys) {
				const v = row[key];
				if (typeof v === "number" && Number.isFinite(v)) {
					ys.push(v);
				}
			}
		}
		if (refY !== undefined) {
			ys.push(refY);
		}
		let lo = ys.length > 0 ? Math.min(...ys) : 0;
		let hi = ys.length > 0 ? Math.max(...ys) : 1;
		if (zero) {
			lo = Math.min(0, lo);
		}
		if (lo === hi) {
			hi = lo + 1;
		}
		const pad = (hi - lo) * 0.05;
		const xs = rows.map((r) => r.x);
		const xMin = Math.min(...xs);
		const xMax = Math.max(...xs);

		const has = (key: string) => (row: ChartRow) =>
			typeof row[key] === "number" && Number.isFinite(row[key]);

		return defineChart({
			marks: [
				...(band
					? [
							decorative(
								areaY(
									rows.filter((r) => has(band.lo)(r) && has(band.hi)(r)),
									{
										x: "x",
										y1: (r: ChartRow) => r[band.lo] as number,
										y2: (r: ChartRow) => r[band.hi] as number,
										fill: "var(--bs-secondary)",
										fillOpacity: 0.2,
									},
								),
							),
						]
					: []),
				...(refY !== undefined
					? [
							ruleY([refY], {
								stroke: "var(--bs-secondary)",
								strokeOpacity: 1,
								strokeDasharray: REFERENCE_LINE_DASHARRAY,
							}),
						]
					: []),
				...series.flatMap((s, i) => {
					const data = rows.filter(has(s.key));
					const color = SERIES_COLORS[i % SERIES_COLORS.length];
					const marks = [
						decorative(
							lineY(data, {
								x: "x",
								y: (r: ChartRow) => r[s.key] as number,
								stroke: color,
								strokeWidth: 2,
								strokeDasharray: s.dashed ? "4 3" : undefined,
								curve: LINE_CURVE,
							}),
						),
					];
					if (i === 0) {
						return [
							...marks,
							dot(data, {
								x: "x",
								y: (r: ChartRow) => r[s.key] as number,
								r: data.length > 60 ? 2 : 4,
								fill: "var(--bs-body-bg)",
								stroke: color,
								strokeWidth: 2,
								states: [
									{
										when: { focus: "primary" },
										style: { fill: color },
									},
								],
							}),
						];
					}
					return marks;
				}),
			],
			scales: {
				x: {
					scale: scaleLinear().domain(
						xMin === xMax ? [xMin - 1, xMax + 1] : [xMin, xMax],
					),
					axis: {
						ticks: {
							count: 6,
							size: 5,
							format: (x: number) =>
								Number.isInteger(x) ? (xLabel ? xLabel(x) : String(x)) : "",
						},
					},
				},
				y: {
					scale: scaleLinear().domain([
						zero && lo === 0 ? 0 : lo - pad,
						hi + pad,
					]),
					grid: true,
					axis: {
						ticks: {
							count: 5,
							size: 5,
							format: yFormat,
						},
					},
				},
			},
			focusRing: false,
			tooltip,
		});
	}, [rows, series, band, refY, yFormat, xLabel, zero]);

	return (
		<div className="position-relative" style={{ maxWidth: 760 }}>
			<Chart
				definition={definition}
				height={height}
				initialWidth={760}
				ariaLabel={ariaLabel}
				renderTooltipBody={({ points }) => {
					const row = points[0]?.datum as ChartRow | undefined;
					return row ? renderTooltip(row) : null;
				}}
			/>
			<ul className="list-inline small mb-2">
				{series.map((s, i) => (
					<li key={s.key} className="list-inline-item me-3">
						<span
							aria-hidden="true"
							style={{
								display: "inline-block",
								width: 18,
								borderTop: `2px ${s.dashed ? "dashed" : "solid"} ${SERIES_COLORS[i % SERIES_COLORS.length]}`,
								verticalAlign: "middle",
								marginRight: 4,
							}}
						/>
						{s.label}
					</li>
				))}
				{band ? (
					<li className="list-inline-item">
						<span
							aria-hidden="true"
							style={{
								display: "inline-block",
								width: 14,
								height: 10,
								background: "var(--bs-secondary)",
								opacity: 0.25,
								verticalAlign: "middle",
								marginRight: 4,
							}}
						/>
						{band.label}
					</li>
				) : null}
			</ul>
		</div>
	);
};
