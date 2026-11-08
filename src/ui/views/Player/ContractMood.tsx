import { useEffect, useState } from "react";
import { PHASE_TEXT } from "../../../common/constants.ts";
import { optionLabel } from "../../../common/contractTerms.ts";
import type { MoodSnapshot } from "../../../common/types.ts";
import type api from "../../../worker/api/index.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";
import {
	NegotiationModal,
	useNegotiaionModal,
} from "../../components/NegotiationModal.tsx";
import { helpers } from "../../util/helpers.ts";
import { showNotification } from "../../util/showNotification.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";

type PanelData = NonNullable<
	Awaited<ReturnType<typeof api.main.getPlayerContractPanel>>
>;

const COMPONENT_LABELS: Record<keyof MoodSnapshot["components"], string> = {
	marketSize: "Market size",
	facilities: "Facilities",
	teamPerformance: "Team performance",
	hype: "Hype",
	loyalty: "Loyalty",
	trades: "Trades",
	playingTime: "Playing time",
	rookieContract: "Rookie contract",
	difficulty: "Difficulty",
	relatives: "Relatives",
};

// Tiny line chart, values plotted left to right. A dashed line marks 0.
export const Sparkline = ({
	values,
	width = 120,
	height = 28,
	title,
}: {
	values: number[];
	width?: number;
	height?: number;
	title?: string;
}) => {
	if (values.length === 0) {
		return null;
	}
	const min = Math.min(0, ...values);
	const max = Math.max(0, ...values);
	const range = max - min || 1;
	const pad = 3;
	const x = (i: number) =>
		values.length === 1
			? width / 2
			: pad + (i * (width - 2 * pad)) / (values.length - 1);
	const y = (v: number) => pad + ((max - v) * (height - 2 * pad)) / range;
	const last = values.at(-1)!;
	const color =
		last > 0
			? "var(--bs-success)"
			: last < 0
				? "var(--bs-danger)"
				: "var(--bs-secondary)";

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={title}
		>
			{title ? <title>{title}</title> : null}
			<line
				x1={pad}
				x2={width - pad}
				y1={y(0)}
				y2={y(0)}
				stroke="var(--bs-secondary)"
				strokeDasharray="2 2"
				strokeWidth={1}
			/>
			<polyline
				fill="none"
				stroke={color}
				strokeWidth={1.5}
				points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
			/>
			<circle cx={x(values.length - 1)} cy={y(last)} r={2.5} fill={color} />
		</svg>
	);
};

const formatProb = (prob: number) =>
	prob > 0.99 && prob < 1
		? ">99%"
		: prob < 0.01 && prob > 0
			? "<1%"
			: `${Math.round(prob * 100)}%`;

const MoodHistory = ({ history }: { history: MoodSnapshot[] }) => {
	if (history.length === 0) {
		return (
			<p className="text-body-secondary mb-0">
				No mood history yet. It's recorded at the trade deadline, at the end of
				the regular season and after the playoffs.
			</p>
		);
	}

	const keys = Object.keys(
		COMPONENT_LABELS,
	) as (keyof MoodSnapshot["components"])[];
	const shownKeys = keys.filter((key) =>
		history.some((row) => row.components[key] !== 0),
	);
	const first = history[0]!;
	const lastRow = history.at(-1)!;

	return (
		<>
			<div className="d-flex align-items-center gap-2 mb-1">
				<span>Overall</span>
				<Sparkline
					values={history.map((row) => row.sum)}
					width={160}
					title="Total mood over time"
				/>
				<span className="text-body-secondary small">
					{first.season} {PHASE_TEXT[first.phase]} to {lastRow.season}{" "}
					{PHASE_TEXT[lastRow.phase]}
				</span>
			</div>
			<table
				className="table table-sm table-borderless mb-0"
				style={{ width: "auto" }}
			>
				<tbody>
					{shownKeys.map((key) => (
						<tr key={key}>
							<td className="py-0">{COMPONENT_LABELS[key]}</td>
							<td className="py-0">
								<Sparkline
									values={history.map((row) => row.components[key])}
									width={100}
									height={18}
									title={COMPONENT_LABELS[key]}
								/>
							</td>
							<td className="py-0 text-end">
								{lastRow.components[key] > 0 ? "+" : ""}
								{lastRow.components[key]}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
};

const ContractDetails = ({
	data,
	onChange,
}: {
	data: PanelData;
	onChange: () => void;
}) => {
	const contract = data.contract;
	if (!contract) {
		return null;
	}

	const hasTerms =
		contract.option !== undefined ||
		contract.seasons.some((row) => row.guaranteed !== row.amount) ||
		contract.extensions.length > 0;

	return (
		<div className="mb-2">
			<table className="table table-sm mb-1" style={{ width: "auto" }}>
				<thead>
					<tr>
						<th>Season</th>
						<th>Salary</th>
						<th>Guaranteed</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{contract.seasons
						.filter((row) => row.season >= data.season)
						.map((row) => (
							<tr key={row.season}>
								<td>{row.season}</td>
								<td>{helpers.formatCurrency(row.amount / 1000, "M")}</td>
								<td>
									{row.guaranteed === row.amount
										? "Full"
										: helpers.formatCurrency(row.guaranteed / 1000, "M")}
								</td>
								<td>
									{row.option
										? `${optionLabel(row.option.type)}${row.option.decision ? ` (${row.option.decision})` : ""}`
										: contract.extensions.some(
													(ext) => ext.firstSeason === row.season,
											  )
											? "Extension starts"
											: null}
								</td>
							</tr>
						))}
				</tbody>
			</table>
			{contract.option?.decision === "declined" ? (
				<div className="small">
					{optionLabel(contract.option.type)} for {contract.option.season} was
					declined.
				</div>
			) : null}
			{contract.releaseCost && hasTerms ? (
				<div className="small">
					Releasing him now would cost{" "}
					{helpers.formatCurrency(contract.releaseCost.owed / 1000, "M")}
					{contract.releaseCost.owed !== contract.releaseCost.full
						? ` instead of ${helpers.formatCurrency(contract.releaseCost.full / 1000, "M")}, thanks to the partial guarantee or team option`
						: ""}
					.
				</div>
			) : null}
			{data.canDecideTeamOption ? (
				<div className="d-flex gap-2 mt-1">
					{(["exercised", "declined"] as const).map((decision) => (
						<button
							key={decision}
							className="btn btn-sm btn-light-bordered"
							onClick={async () => {
								const error = await toWorker("main", "decideTeamOption", {
									pid: data.pid,
									decision,
								});
								if (error) {
									showNotification({ type: "error", text: error });
								}
								onChange();
							}}
						>
							{decision === "exercised" ? "Exercise" : "Decline"} team option
						</button>
					))}
				</div>
			) : null}
		</div>
	);
};

export const ContractMood = ({
	pid,
	refreshKey,
}: {
	pid: number;
	refreshKey: unknown;
}) => {
	const [data, setData] = useState<PanelData | undefined>();
	const [counter, setCounter] = useState(0);
	const { spectator } = useLocal(["spectator"]);
	const negotiationModal = useNegotiaionModal();

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const result = await toWorker("main", "getPlayerContractPanel", pid);
			if (!cancelled) {
				setData(result);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [pid, refreshKey, counter]);

	if (!data) {
		return null;
	}

	const base = data.scenarios[0];

	return (
		<div className="mb-3">
			<h2>
				Contract &amp; Mood{" "}
				<HelpPopover>
					<p>
						The projections show how his willingness to re-sign would change if
						things changed. They hold everything else fixed, so they're a guide
						to what matters to him, not a promise.
					</p>
					<p>
						Mood history is recorded at the trade deadline, at the end of the
						regular season and after the playoffs.
					</p>
				</HelpPopover>
			</h2>
			{data.tradeRequest ? (
				<div className="alert alert-danger py-2">
					Requested a trade in {data.tradeRequest.season}. His trade value is
					lower until he's traded or his mood improves enough that he withdraws
					the request.
				</div>
			) : null}
			{data.holdout ? (
				<div className="alert alert-warning py-2">
					Holding out: has missed {data.holdout.gamesMissed}{" "}
					{helpers.plural("game", data.holdout.gamesMissed)}, about{" "}
					{data.holdout.gamesRemaining} more. An extension or a trade ends the
					holdout.
				</div>
			) : null}
			<div className="row">
				<div className="col-md-6 col-xl-4">
					<ContractDetails
						data={data}
						onChange={() => setCounter((x) => x + 1)}
					/>
					{data.extension ? (
						<div className="mb-2">
							{data.extension.demand ? (
								<>
									<div>
										Wants about{" "}
										<b>
											{helpers.formatCurrency(
												data.extension.demand.amount / 1000,
												"M",
											)}
										</b>
										/year through {data.extension.demand.exp} in an extension.
									</div>
									{!spectator ? (
										<button
											className="btn btn-sm btn-primary mt-1"
											disabled={!data.extension.demand.willing}
											title={
												data.extension.demand.willing
													? undefined
													: "He doesn't want to talk about an extension right now"
											}
											onClick={async () => {
												await negotiationModal.negotiate(data.pid);
											}}
										>
											{data.extension.demand.willing
												? "Negotiate extension"
												: "Not open to an extension"}
										</button>
									) : null}
								</>
							) : (
								<div className="small text-body-secondary">
									{data.extension.reason}
								</div>
							)}
						</div>
					) : null}
				</div>
				<div className="col-md-6 col-xl-4">
					<h3 className="h5">What would make him re-sign?</h3>
					<table className="table table-sm mb-2" style={{ width: "auto" }}>
						<thead>
							<tr>
								<th>Scenario</th>
								<th>Mood</th>
								<th>Willing to re-sign</th>
							</tr>
						</thead>
						<tbody>
							{data.scenarios.map((row) => {
								const diff =
									base && row !== base ? row.probWilling - base.probWilling : 0;
								return (
									<tr key={row.key}>
										<td>{row.label}</td>
										<td>
											{row.sum > 0 ? "+" : ""}
											{row.sum}
										</td>
										<td>
											{formatProb(row.probWilling)}
											{Math.abs(diff) >= 0.01 ? (
												<span
													className={
														diff > 0 ? "text-success ms-1" : "text-danger ms-1"
													}
												>
													({diff > 0 ? "+" : ""}
													{Math.round(diff * 100)})
												</span>
											) : null}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<div className="col-md-12 col-xl-4">
					<h3 className="h5">Mood history</h3>
					<MoodHistory history={data.moodHistory} />
				</div>
			</div>
			<NegotiationModal {...negotiationModal.props} />
		</div>
	);
};
