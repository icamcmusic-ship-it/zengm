import { useEffect, useState } from "react";
import clsx from "clsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { PHASE } from "../../../common/constants.ts";
import type { View } from "../../../common/types.ts";
import type { MultiTeamAsset } from "../../../worker/core/trade/multiTeam.ts";
import type { TradeExplanation } from "../../../worker/core/trade/explain.ts";
import { Explanation } from "../Trade/Explanation.tsx";
import { ActionButton } from "../../components/ActionButton.tsx";
import { showUndoNotification } from "../../components/UndoNotification.tsx";
import { PlayerNameLabels } from "../../components/PlayerNameLabels.tsx";

type Evaluation = Awaited<
	ReturnType<
		typeof import("../../../worker/core/trade/multiTeam.ts").evaluateMulti
	>
>;

const assetKey = (type: "player" | "pick", id: number) => `${type}-${id}`;

// Pick where an asset goes: stays, or to one of the other teams
const DestinationSelect = ({
	disabled,
	fromTid,
	onChange,
	teams,
	value,
}: {
	disabled?: boolean;
	fromTid: number;
	onChange: (toTid: number | undefined) => void;
	teams: View<"tradeThree">["teams"];
	value: number | undefined;
}) => {
	return (
		<select
			className={clsx("form-select form-select-sm", {
				"border-primary": value !== undefined,
			})}
			disabled={disabled}
			style={{ width: 90 }}
			value={value ?? ""}
			onChange={(event) => {
				const v = event.currentTarget.value;
				onChange(v === "" ? undefined : Number.parseInt(v));
			}}
		>
			<option value="">Keep</option>
			{teams
				.filter((t) => t.tid !== fromTid)
				.map((t) => (
					<option key={t.tid} value={t.tid}>
						→ {t.abbrev}
					</option>
				))}
		</select>
	);
};

const TradeThree = ({
	challengeNoRatings,
	teamOptions,
	teams,
}: View<"tradeThree">) => {
	useTitleBar({ title: "Three-Team Trade" });

	const { gameOver, godMode, phase, spectator, challengeNoTrades, userTid } =
		useLocal([
			"gameOver",
			"godMode",
			"phase",
			"spectator",
			"challengeNoTrades",
			"userTid",
		]);

	const tids = teams.map((t) => t.tid);
	const tidsKey = tids.join("-");

	const [assets, setAssets] = useState<MultiTeamAsset[]>([]);
	const [evaluation, setEvaluation] = useState<Evaluation | undefined>();
	const [result, setResult] = useState<
		| {
				accepted: boolean;
				message: string;
				explanations: TradeExplanation[];
		  }
		| undefined
	>();
	const [forceTrade, setForceTrade] = useState(false);
	const [proposing, setProposing] = useState(false);

	// Reset when teams change, or when assets are no longer on the team they're coming from
	const [prevTidsKey, setPrevTidsKey] = useState(tidsKey);
	if (prevTidsKey !== tidsKey) {
		setPrevTidsKey(tidsKey);
		setAssets([]);
		setResult(undefined);
	}

	const validAssets = assets.filter((asset) => {
		const t = teams.find((t) => t.tid === asset.fromTid);
		if (!t || !tids.includes(asset.toTid)) {
			return false;
		}
		return asset.type === "player"
			? t.players.some((p) => p.pid === asset.id)
			: t.picks.some((dp) => dp.dpid === asset.id);
	});
	if (validAssets.length !== assets.length) {
		setAssets(validAssets);
	}

	const multiTeamTrade = { tids, assets: validAssets };
	const tradeKey = JSON.stringify(multiTeamTrade);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const evaluation = await toWorker(
				"main",
				"evaluateMultiTeamTrade",
				JSON.parse(tradeKey),
			);
			if (!cancelled) {
				setEvaluation(evaluation);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [tradeKey]);

	const setDestination = (
		type: "player" | "pick",
		id: number,
		fromTid: number,
		toTid: number | undefined,
	) => {
		setResult(undefined);
		setAssets((prev) => {
			const others = prev.filter(
				(asset) => assetKey(asset.type, asset.id) !== assetKey(type, id),
			);
			if (toTid === undefined) {
				return others;
			}
			return [...others, { type, id, fromTid, toTid }];
		});
	};

	const destinationOf = (type: "player" | "pick", id: number) =>
		validAssets.find((asset) => asset.type === type && asset.id === id)?.toTid;

	const changeTeam = (index: 1 | 2, tid: number) => {
		const otherTids = [tids[1], tids[2]];
		otherTids[index - 1] = tid;
		if (otherTids[0] === otherTids[1]) {
			return;
		}
		realtimeUpdate([], helpers.leagueUrl(["trade_three", otherTids.join("-")]));
	};

	const noTradingAllowed =
		(phase >= PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.PLAYOFFS) ||
		phase === PHASE.FANTASY_DRAFT ||
		phase === PHASE.EXPANSION_DRAFT ||
		gameOver ||
		spectator ||
		challengeNoTrades;

	const propose = async () => {
		setProposing(true);
		const response = await toWorker("main", "proposeMultiTeamTrade", {
			forceTrade,
			multiTeamTrade,
		});
		setProposing(false);
		setResult(response);
		if (response.accepted) {
			setAssets([]);
		}
		if (response.undoKey !== undefined) {
			showUndoNotification({
				actionName: "trade",
				undoKey: response.undoKey,
				title: <>You made a three-team trade</>,
			});
		}
	};

	const explanations = result?.explanations ?? evaluation?.explanations ?? [];

	return (
		<>
			<p>
				Build a trade between your team and two AI teams. Use the menu next to
				each player or pick to send it to another team. Every AI team has to
				like what it gets, and the usual salary cap rules apply to each team.
				For a regular trade, use the{" "}
				<a href={helpers.leagueUrl(["trade"])}>Trade</a> page.
			</p>

			<div className="d-flex flex-wrap gap-2 mb-3">
				{([1, 2] as const).map((index) => (
					<select
						key={index}
						className="form-select"
						style={{ maxWidth: 300 }}
						value={tids[index]}
						onChange={(event) => {
							changeTeam(index, Number.parseInt(event.currentTarget.value));
						}}
					>
						{teamOptions
							.filter((t) => t.tid === tids[index] || !tids.includes(t.tid))
							.map((t) => (
								<option key={t.tid} value={t.tid}>
									{t.name}
								</option>
							))}
					</select>
				))}
			</div>

			<div className="row">
				{teams.map((t) => (
					<div key={t.tid} className="col-lg-4 mb-3">
						<h2>
							{t.name}{" "}
							<span className="text-body-secondary fs-6">
								{t.tid === userTid ? "(you)" : `(${t.strategy})`}
							</span>
						</h2>
						<div className="table-responsive">
							<table className="table table-sm table-striped table-hover mb-2">
								<thead>
									<tr>
										<th>Name</th>
										<th>Pos</th>
										<th>Age</th>
										{!challengeNoRatings ? <th>Ovr</th> : null}
										<th>Contract</th>
										<th>Send</th>
									</tr>
								</thead>
								<tbody>
									{t.players.map((p) => (
										<tr
											key={p.pid}
											className={clsx({
												"table-info":
													destinationOf("player", p.pid) !== undefined,
											})}
										>
											<td>
												<PlayerNameLabels
													pid={p.pid}
													injury={p.injury}
													jerseyNumber={p.jerseyNumber}
													skills={p.ratings.skills}
													firstName={p.firstName}
													firstNameShort={p.firstNameShort}
													lastName={p.lastName}
												/>
											</td>
											<td>{p.ratings.pos}</td>
											<td>{p.age}</td>
											{!challengeNoRatings ? <td>{p.ratings.ovr}</td> : null}
											<td>
												{helpers.formatCurrency(p.contract.amount, "M")} thru{" "}
												{p.contract.exp}
											</td>
											<td>
												<DestinationSelect
													disabled={p.untradable}
													fromTid={t.tid}
													teams={teams}
													value={destinationOf("player", p.pid)}
													onChange={(toTid) => {
														setDestination("player", p.pid, t.tid, toTid);
													}}
												/>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<table className="table table-sm mb-0">
							<tbody>
								{t.picks.map((dp) => (
									<tr
										key={dp.dpid}
										className={clsx({
											"table-info":
												destinationOf("pick", dp.dpid) !== undefined,
										})}
									>
										<td>{dp.desc}</td>
										<td style={{ width: 100 }}>
											<DestinationSelect
												fromTid={t.tid}
												teams={teams}
												value={destinationOf("pick", dp.dpid)}
												onChange={(toTid) => {
													setDestination("pick", dp.dpid, t.tid, toTid);
												}}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				))}
			</div>

			<h2>Summary</h2>
			{evaluation ? (
				<div className="row">
					{evaluation.summary.teams.map((t) => (
						<div key={t.tid} className="col-lg-4 mb-3">
							<h3 className="h5">{t.name}</h3>
							<div>
								<b>Receives:</b>{" "}
								{t.receive.length === 0
									? "nothing"
									: t.receive
											.map(
												(a) =>
													`${a.name} (from ${teams.find((t2) => t2.tid === a.otherTid)?.abbrev})`,
											)
											.join(", ")}
							</div>
							<div>
								<b>Gives:</b>{" "}
								{t.give.length === 0
									? "nothing"
									: t.give
											.map(
												(a) =>
													`${a.name} (to ${teams.find((t2) => t2.tid === a.otherTid)?.abbrev})`,
											)
											.join(", ")}
							</div>
							<div className="text-body-secondary">
								Payroll: {helpers.formatCurrency(t.payrollBefore, "M")} →{" "}
								{helpers.formatCurrency(t.payrollAfter, "M")}
								{!challengeNoRatings ? (
									<>
										, team ovr: {t.ovrBefore} → {t.ovrAfter}
									</>
								) : null}
								, roster: {t.rosterAfter}
							</div>
						</div>
					))}
				</div>
			) : null}

			{evaluation && evaluation.summary.warnings.length > 0 ? (
				<div className="alert alert-danger">
					{evaluation.summary.warnings.map((warning, i) => (
						<div key={i}>{warning}</div>
					))}
				</div>
			) : null}

			{validAssets.length > 0 && explanations.length > 0 ? (
				<div className="mb-3">
					{explanations.map((explanation) => (
						<div key={explanation.tid}>
							<span
								className={clsx(
									"fw-bold",
									explanation.accepts ? "text-success" : "text-danger",
								)}
							>
								{explanation.teamName}: {explanation.accepts ? "in" : "not yet"}
							</span>{" "}
							<Explanation explanation={explanation} />
						</div>
					))}
				</div>
			) : null}

			{result ? (
				<div
					className={clsx(
						"alert",
						result.accepted ? "alert-success" : "alert-info",
					)}
				>
					{result.message}
				</div>
			) : null}

			{noTradingAllowed ? (
				<p className="alert alert-danger d-inline-block">
					You're not allowed to make trades now.
				</p>
			) : (
				<div className="d-flex gap-2 align-items-center">
					<ActionButton
						disabled={
							proposing ||
							validAssets.length === 0 ||
							(!evaluation?.summary.enablePropose && !forceTrade)
						}
						onClick={propose}
						processing={proposing}
					>
						Propose trade
					</ActionButton>
					<button
						className="btn btn-secondary"
						onClick={() => {
							setAssets([]);
							setResult(undefined);
						}}
					>
						Clear
					</button>
					{godMode ? (
						<label className="god-mode god-mode-text mb-0 ms-2">
							<input
								className="form-check-input me-1"
								type="checkbox"
								onChange={() => {
									setForceTrade((value) => !value);
								}}
								checked={forceTrade}
							/>
							Force Trade
						</label>
					) : null}
				</div>
			)}
		</>
	);
};

export default TradeThree;
