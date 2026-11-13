// Scouting Reports (League Extras): the pieces of a report shown around the game. The full page is views/PlayerScouting.tsx.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { OverlayTrigger, Popover } from "react-bootstrap";
import clsx from "clsx";
import { toWorker } from "../../util/toWorker.ts";
import { helpers } from "../../util/helpers.ts";
import { useFeatureOn, useFeatureOption } from "../../util/nativeFeatures.ts";
import { useIsCollege } from "../../util/collegeMode.ts";
import {
	GRADE_LETTERS,
	gradeColor,
	MAX_GRADE,
	RADAR_KEYS,
	SHORT_LABELS,
	type FullReport,
	type GradeRow,
	type ScoutHover,
} from "../../../common/scoutingReports/index.ts";

// The setting is on and this is not a college league
export const useScoutingOn = () => {
	const on = useFeatureOn("scoutingReports");
	const college = useIsCollege();
	return on && !college;
};

// The "Scouting Summaries on Lists" option: short summaries outside player pages (free agents, trades, draft hovers,
// playoff opponents). Off by default, then scouting reports are only on player pages. Reports only use what the user's
// scouts can see, so this respects the no visible ratings challenge too.
export const useScoutingListsOn = () => {
	const on = useScoutingOn();
	const lists = useFeatureOption<boolean>("scoutingListSummaries");
	return on && lists;
};

// A quick switch for the option, for page headers (saves the same setting as League Extras)
export const ScoutingListsToggle = ({ className }: { className?: string }) => {
	const on = useScoutingOn();
	const lists = useFeatureOption<boolean>("scoutingListSummaries");
	if (!on) {
		return null;
	}
	return (
		<div className={clsx("form-check form-switch", className)}>
			<input
				className="form-check-input"
				type="checkbox"
				id="scouting-list-summaries"
				checked={lists}
				data-testid="scouting-list-toggle"
				onChange={async () => {
					await toWorker("main", "updateGameAttributes", {
						scoutingListSummaries: !lists,
					});
				}}
			/>
			<label className="form-check-label" htmlFor="scouting-list-summaries">
				Show scouting summaries
			</label>
		</div>
	);
};

const letterIndex = (letter: string) =>
	Math.max(0, GRADE_LETTERS.indexOf(letter as (typeof GRADE_LETTERS)[number]));

// A letter grade (or range), colored
export const GradeBadge = ({
	lo,
	hi,
	grade,
	className,
	big,
}: {
	lo: number;
	hi: number;
	grade?: number;
	className?: string;
	big?: boolean;
}) => {
	const text =
		lo === hi
			? GRADE_LETTERS[lo]
			: `${GRADE_LETTERS[lo]} to ${GRADE_LETTERS[hi]}`;
	const color = gradeColor(grade ?? Math.round((lo + hi) / 2));
	return (
		<span
			className={clsx("badge text-nowrap", className)}
			style={{
				backgroundColor: color,
				color: "#fff",
				fontSize: big ? "1.4rem" : undefined,
				minWidth: big ? 56 : 34,
			}}
			data-grade={text}
		>
			{text}
		</span>
	);
};

const GradeText = ({ text }: { text: string }) => {
	const first = text.split(" to ")[0]!;
	const color = gradeColor(letterIndex(first));
	return (
		<b
			// --grade-color: lightened in the dark theme (dark.scss), where dark red/green text is hard to read
			style={{ color, "--grade-color": color } as CSSProperties}
			className="text-nowrap scout-grade-text"
		>
			{text}
		</b>
	);
};

// Bars for grades: one row per grade, the range shaded, the scout's call marked
export const GradeBars = ({
	grades,
	showLines = true,
}: {
	grades: GradeRow[];
	showLines?: boolean;
}) => {
	return (
		<div data-testid="scouting-grades">
			{grades.map((g) => {
				const left = (100 * g.lo) / MAX_GRADE;
				const width = Math.max(2, (100 * (g.hi - g.lo)) / MAX_GRADE);
				const mark = (100 * g.grade) / MAX_GRADE;
				return (
					<div
						key={g.key}
						className={clsx("mb-2", g.sub ? "ms-3" : undefined)}
						data-grade-key={g.key}
					>
						<div className="d-flex align-items-center gap-2">
							<div
								style={{ width: g.sub ? 118 : 134, flexShrink: 0 }}
								className={g.sub ? "small text-body-secondary" : "fw-bold"}
							>
								{g.label}
							</div>
							<div
								className="flex-grow-1 position-relative rounded"
								style={{
									height: 10,
									backgroundColor: "var(--bs-secondary-bg)",
									minWidth: 60,
								}}
							>
								<div
									className="position-absolute rounded"
									style={{
										left: `${left}%`,
										width: `${width}%`,
										top: 0,
										bottom: 0,
										backgroundColor: gradeColor(g.grade),
										opacity: 0.45,
									}}
								/>
								<div
									className="position-absolute rounded"
									style={{
										left: `calc(${mark}% - 3px)`,
										width: 6,
										top: -2,
										bottom: -2,
										backgroundColor: gradeColor(g.grade),
									}}
								/>
							</div>
							<div style={{ width: 78, flexShrink: 0 }} className="text-end">
								<GradeBadge lo={g.lo} hi={g.hi} grade={g.grade} />
							</div>
						</div>
						{showLines && g.line ? (
							<div
								className={clsx("small", g.sub ? "ms-0" : undefined)}
								style={{ marginLeft: g.sub ? 126 : 142 }}
							>
								{g.line}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
};

// Radar of the key grades (0 = F at the center, A+ at the edge)
export const GradeRadar = ({
	grades,
	size = 220,
	compare,
}: {
	grades: GradeRow[];
	size?: number;
	compare?: GradeRow[];
}) => {
	const keys = RADAR_KEYS;
	const c = size / 2;
	const r = size / 2 - 30;
	const point = (i: number, value: number) => {
		const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
		const d = r * (0.08 + (0.92 * value) / MAX_GRADE);
		return [c + d * Math.cos(angle), c + d * Math.sin(angle)] as const;
	};
	const poly = (list: GradeRow[]) =>
		keys
			.map((k, i) =>
				point(i, list.find((g) => g.key === k)?.grade ?? 0).join(","),
			)
			.join(" ");
	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			role="img"
			aria-label="Radar chart of key grades"
			data-testid="scouting-radar"
		>
			{[0.25, 0.5, 0.75, 1].map((f) => (
				<polygon
					key={f}
					points={keys
						.map((_, i) => point(i, f * MAX_GRADE).join(","))
						.join(" ")}
					fill="none"
					stroke="var(--bs-border-color)"
					strokeWidth={1}
				/>
			))}
			{keys.map((k, i) => {
				const [x, y] = point(i, MAX_GRADE);
				const [lx, ly] = point(i, MAX_GRADE * 1.2);
				return (
					<g key={k}>
						<line
							x1={c}
							y1={c}
							x2={x}
							y2={y}
							stroke="var(--bs-border-color)"
							strokeWidth={1}
						/>
						<text
							x={lx}
							y={ly}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={10}
							fill="currentColor"
						>
							{SHORT_LABELS[k]}
						</text>
					</g>
				);
			})}
			{compare ? (
				<polygon
					points={poly(compare)}
					fill="rgba(108,117,125,0.15)"
					stroke="#6c757d"
					strokeDasharray="4 3"
					strokeWidth={1.5}
				/>
			) : null}
			<polygon
				points={poly(grades)}
				fill="rgba(13,110,253,0.25)"
				stroke="#0d6efd"
				strokeWidth={2}
			/>
		</svg>
	);
};

const MIX_COLORS = ["#0d6efd", "#6f42c1", "#fd7e14", "#20c997"];

// Shot-type mix from his stats: one stacked bar
export const ShotMixChart = ({
	mix,
}: {
	mix: NonNullable<FullReport["shotMix"]>;
}) => {
	return (
		<div data-testid="scouting-shot-mix">
			<div className="d-flex rounded overflow-hidden" style={{ height: 18 }}>
				{mix.map((m, i) =>
					m.share > 0 ? (
						<div
							key={m.label}
							title={`${m.label}: ${m.share}% of shots`}
							style={{ width: `${m.share}%`, backgroundColor: MIX_COLORS[i] }}
						/>
					) : null,
				)}
			</div>
			<div className="d-flex flex-wrap gap-2 small mt-1">
				{mix.map((m, i) => (
					<span key={m.label} className="text-nowrap">
						<span
							className="d-inline-block rounded-circle me-1"
							style={{
								width: 8,
								height: 8,
								backgroundColor: MIX_COLORS[i],
							}}
						/>
						{m.label} {m.share}%
						{m.pct !== undefined ? (
							<span className="text-body-secondary"> ({m.pct}% FG)</span>
						) : null}
					</span>
				))}
			</div>
		</div>
	);
};

export const CompCards = ({
	comps,
}: {
	comps: FullReport["header"]["comps"];
}) => {
	if (comps.length === 0) {
		return null;
	}
	return (
		<div className="d-flex flex-wrap gap-2" data-testid="scouting-comps">
			{comps.map((c) => (
				<div
					key={c.pid}
					className="border rounded px-2 py-1"
					style={{ minWidth: 150, maxWidth: 260 }}
				>
					<a href={helpers.leagueUrl(["player", c.pid])} className="fw-bold">
						{c.name}
					</a>
					<div className="small text-body-secondary">{c.when}</div>
					<div className="small">{c.outcome}</div>
					<div className="small text-body-secondary">
						{c.similarity}% similar
					</div>
				</div>
			))}
		</div>
	);
};

// The short grades and bottom line, for hover cards
const HoverBody = ({ hover }: { hover: ScoutHover }) => (
	<div style={{ maxWidth: 300 }} data-testid="scouting-hover">
		<div className="d-flex justify-content-between align-items-center mb-1">
			<b>{hover.name}</b>
			<span>
				Overall <GradeText text={hover.overall} />
			</span>
		</div>
		<table className="table table-sm table-borderless mb-1 small">
			<tbody>
				{[0, 2, 4, 6].map((i) => (
					<tr key={i}>
						{hover.grades.slice(i, i + 2).map((g) => (
							<td key={g.key} className="py-0">
								{g.label} <GradeText text={g.grade} />
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
		<div className="small mb-1">{hover.range}</div>
		<div className="small">{hover.bottomLine}</div>
		<div className="small text-body-secondary mt-1">{hover.byline}</div>
	</div>
);

// A small "scout" icon with the report's grades and bottom line on hover (click on touch screens)
export const ScoutingHoverIcon = ({ pid }: { pid: number }) => {
	const on = useScoutingListsOn();
	const [hover, setHover] = useState<ScoutHover | undefined | null>(null);
	if (!on) {
		return null;
	}
	const load = async () => {
		if (hover === null) {
			setHover(await toWorker("scoutingReports", "getHover", pid));
		}
	};
	return (
		<OverlayTrigger
			trigger={window.mobile ? "click" : ["hover", "focus"]}
			placement="auto"
			rootClose
			onEnter={load}
			overlay={
				<Popover id={`scouting-hover-${pid}`}>
					<Popover.Body>
						{hover ? (
							<HoverBody hover={hover} />
						) : hover === undefined ? (
							"No report."
						) : (
							"Loading..."
						)}
					</Popover.Body>
				</Popover>
			}
		>
			<button
				type="button"
				className="btn btn-link btn-sm p-0 ms-1 align-baseline text-decoration-none"
				aria-label="Scouting report"
				title="Scouting report"
				data-testid="scouting-hover-icon"
				onMouseEnter={load}
				onFocus={load}
			>
				<span
					className="glyphicon glyphicon-search"
					style={{ fontSize: "0.8em" }}
				/>
			</button>
		</OverlayTrigger>
	);
};

// Blurbs for many players at once (trade window, free agents)
export const useScoutingBlurbs = (pids: number[]) => {
	const on = useScoutingListsOn();
	const key = pids.join(",");
	const [blurbs, setBlurbs] = useState<Record<number, string>>({});
	useEffect(() => {
		let cancelled = false;
		if (!on || key === "") {
			setBlurbs({});
			return;
		}
		(async () => {
			const result = await toWorker(
				"scoutingReports",
				"getBlurbs",
				key.split(",").map(Number),
			);
			if (!cancelled) {
				setBlurbs(result);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [on, key]);
	return on ? blurbs : {};
};

// The players in a trade, with what our scouts think of each
export const TradeScoutingBlurbs = ({
	players,
}: {
	players: { pid: number; name: string }[];
}) => {
	const blurbs = useScoutingBlurbs(players.map((p) => p.pid));
	if (players.length === 0 || Object.keys(blurbs).length === 0) {
		return null;
	}
	return (
		<div className="card mt-2" data-testid="trade-scouting-blurbs">
			<div className="card-body p-2">
				<div className="fw-bold mb-1">Our scouts on this deal</div>
				{players.map((p) =>
					blurbs[p.pid] ? (
						<div key={p.pid} className="small mb-1">
							<a href={helpers.leagueUrl(["player_scouting", p.pid])}>
								{p.name}
							</a>
							: {blurbs[p.pid]}
						</div>
					) : null,
				)}
			</div>
		</div>
	);
};

// One line on the player's Overview
export const ScoutingSummaryLine = ({ pid }: { pid: number }) => {
	const [summary, setSummary] = useState<
		{ overall: string; blurb: string; byline: string } | undefined
	>();
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const result = await toWorker("scoutingReports", "getSummary", pid);
			if (!cancelled) {
				setSummary(result);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [pid]);
	if (!summary) {
		return null;
	}
	return (
		<div className="mb-3" data-testid="scouting-summary">
			<h2 className="mb-1">Scouting</h2>
			<div>
				<GradeText text={summary.overall} /> {summary.blurb}{" "}
				<span className="text-body-secondary">({summary.byline})</span>{" "}
				<a href={helpers.leagueUrl(["player_scouting", pid])}>Full report »</a>
			</div>
		</div>
	);
};

type Opponent = Awaited<ReturnType<typeof getOpponentType>>;
// Only for the type
const getOpponentType = () =>
	toWorker("scoutingReports", "getOpponent", undefined);

// Playoffs: our staff's notes on the current opponent
export const OpponentScouting = ({ season }: { season: number }) => {
	const on = useScoutingListsOn();
	const [data, setData] = useState<Opponent | undefined>();
	useEffect(() => {
		let cancelled = false;
		if (!on) {
			return;
		}
		(async () => {
			const result = await toWorker("scoutingReports", "getOpponent", season);
			if (!cancelled) {
				setData(result);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [on, season]);
	if (!on || !data) {
		return null;
	}
	return (
		<div
			className="card mb-3"
			style={{ maxWidth: 900 }}
			data-testid="opponent-scouting"
		>
			<div className="card-body">
				<h3 className="card-title">
					Scouting the{" "}
					<a
						href={helpers.leagueUrl([
							"roster",
							`${data.opponent.abbrev}_${data.opponent.tid}`,
							season,
						])}
					>
						{data.opponent.name}
					</a>
				</h3>
				<div className="small text-body-secondary mb-2">{data.byline}</div>
				<ul className="mb-2">
					{data.keys.map((k) => (
						<li key={k}>{k}</li>
					))}
				</ul>
				<div className="row g-2">
					{data.players.map((p) => (
						<div key={p.pid} className="col-12 col-md-6">
							<div className="border rounded p-2 h-100">
								<a
									href={helpers.leagueUrl(["player_scouting", p.pid])}
									className="fw-bold"
								>
									{p.name}
								</a>{" "}
								<span className="text-body-secondary">{p.pos}</span>
								<div className="small">{p.how}</div>
								<div className="small">
									<b>Defend him:</b> {p.defend}
								</div>
								<div className="small text-body-secondary">{p.keyGrades}</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export const ReportSection = ({
	title,
	children,
	testid,
}: {
	title: string;
	children: ReactNode;
	testid?: string;
}) => (
	<div className="mb-3" data-testid={testid}>
		<h3 className="mb-1">{title}</h3>
		{children}
	</div>
);
