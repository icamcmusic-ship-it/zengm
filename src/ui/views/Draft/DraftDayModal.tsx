import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal.tsx";
import { toWorker } from "../../util/toWorker.ts";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import type { TradeTeams } from "../../../common/types.ts";

type Info = Awaited<ReturnType<typeof loadInfo>>;

const loadInfo = (otherTid: number | undefined) =>
	toWorker("main", "getDraftDayInfo", otherTid);

/**
 * Draft-day trades and AI team boards, as a quick modal on the Draft page. Uses the normal trade API (createTrade, tradeCounterOffer, proposeTrade), so the same AI valuation and rules apply as on the Trade page.
 */
export const DraftDayModal = ({
	show,
	onHide,
}: {
	show: boolean;
	onHide: () => void;
}) => {
	const [otherTid, setOtherTid] = useState<number | undefined>();
	const [info, setInfo] = useState<Info | undefined>();
	const [message, setMessage] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);

	const refresh = async (tid: number | undefined) => {
		const output = await loadInfo(tid);
		setInfo(output);
		if (tid === undefined && output.trade) {
			setOtherTid(output.trade.teams[1].tid);
		}
	};

	useEffect(() => {
		if (show) {
			setMessage(undefined);
			void refresh(otherTid);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [show]);

	const tradeInfo = info?.trade;
	const teams = tradeInfo?.teams;

	const setTeams = async (newTeams: TradeTeams) => {
		setBusy(true);
		await toWorker("main", "createTrade", newTeams);
		await refresh(newTeams[1].tid);
		setBusy(false);
	};

	const toggle = (side: 0 | 1, kind: "pids" | "dpids", id: number) => {
		if (!teams) {
			return;
		}
		const newTeams = helpers.deepCopy(teams);
		const list = newTeams[side][kind];
		newTeams[side][kind] = list.includes(id)
			? list.filter((x) => x !== id)
			: [...list, id];
		void setTeams(newTeams);
	};

	const board = info?.boards.find((b) => b.tid === otherTid);

	const assets = (side: 0 | 1) => {
		const a = side === 0 ? tradeInfo?.user : tradeInfo?.other;
		if (!a || !teams) {
			return null;
		}
		return (
			<div style={{ maxHeight: 260, overflowY: "auto" }}>
				{a.picks.map((dp) => (
					<div className="form-check" key={`dp${dp.dpid}`}>
						<input
							className="form-check-input"
							type="checkbox"
							id={`dd-dp-${dp.dpid}`}
							checked={teams[side].dpids.includes(dp.dpid)}
							disabled={busy}
							onChange={() => toggle(side, "dpids", dp.dpid)}
						/>
						<label
							className={`form-check-label${dp.current ? " fw-bold" : ""}`}
							htmlFor={`dd-dp-${dp.dpid}`}
						>
							{dp.desc}
						</label>
					</div>
				))}
				{a.players.map((p) => (
					<div className="form-check" key={`p${p.pid}`}>
						<input
							className="form-check-input"
							type="checkbox"
							id={`dd-p-${p.pid}`}
							checked={teams[side].pids.includes(p.pid)}
							disabled={busy || p.untradable}
							onChange={() => toggle(side, "pids", p.pid)}
						/>
						<label className="form-check-label" htmlFor={`dd-p-${p.pid}`}>
							{p.name}, {p.pos}
							{challengeNoRatings ? null : ` ${p.ovr}/${p.pot}`}
						</label>
					</div>
				))}
			</div>
		);
	};

	return (
		<Modal show={show} onHide={onHide} size="lg" scrollable>
			<Modal.Header closeButton>Draft-day trades and team boards</Modal.Header>
			<Modal.Body>
				{!info ? (
					"Loading..."
				) : (
					<>
						<div className="d-flex gap-2 align-items-center mb-2">
							<label htmlFor="dd-team">Team</label>
							<select
								id="dd-team"
								className="form-select form-select-sm w-auto"
								value={otherTid ?? ""}
								onChange={async (event) => {
									const tid = Number.parseInt(event.target.value);
									setOtherTid(tid);
									setMessage(undefined);
									await refresh(tid);
								}}
							>
								{info.boards.map((b) => (
									<option key={b.tid} value={b.tid}>
										{b.abbrev} - {b.name}
										{b.currentPicks.length > 0
											? ` (picks ${b.currentPicks.join(", ")})`
											: ""}
									</option>
								))}
							</select>
						</div>

						{board ? (
							<div className="mb-3">
								<div>
									<b>Strategy:</b> {board.strategy}
									{board.needs.length > 0 ? (
										<>
											{" "}
											<b>Needs:</b> {board.needs.join(", ")}
										</>
									) : null}
								</div>
								<div>
									<b>Their board:</b>{" "}
									{board.board.map((p, i) => (
										<span key={p.pid}>
											{i > 0 ? ", " : ""}
											{i + 1}.{" "}
											<a href={helpers.leagueUrl(["player", p.pid])}>
												{p.name}
											</a>{" "}
											({p.pos})
										</span>
									))}
								</div>
							</div>
						) : null}

						<div className="row">
							<div className="col-6">
								<h3>You give</h3>
								{assets(0)}
							</div>
							<div className="col-6">
								<h3>You get</h3>
								{assets(1)}
							</div>
						</div>

						{tradeInfo?.warning ? (
							<div className="text-danger mt-2">{tradeInfo.warning}</div>
						) : null}
						{message ? (
							<div className="alert alert-info mt-2">{message}</div>
						) : null}
					</>
				)}
			</Modal.Body>
			<Modal.Footer>
				<button
					className="btn btn-secondary"
					disabled={busy || !teams}
					onClick={async () => {
						setBusy(true);
						const { message } = await toWorker(
							"main",
							"tradeCounterOffer",
							undefined,
						);
						setMessage(message);
						await refresh(otherTid);
						setBusy(false);
					}}
				>
					What would make this work?
				</button>
				<button
					className="btn btn-primary"
					disabled={
						busy ||
						!teams ||
						!!tradeInfo?.warning ||
						teams[0].pids.length +
							teams[0].dpids.length +
							teams[1].pids.length +
							teams[1].dpids.length ===
							0
					}
					onClick={async () => {
						setBusy(true);
						const output = await toWorker("main", "proposeTrade", false);
						setMessage(output.message ?? undefined);
						await refresh(otherTid);
						setBusy(false);
					}}
				>
					Propose trade
				</button>
			</Modal.Footer>
		</Modal>
	);
};
