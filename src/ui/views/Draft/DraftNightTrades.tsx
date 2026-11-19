import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal.tsx";
import { showUndoNotification } from "../../components/UndoNotification.tsx";
import { toWorker } from "../../util/toWorker.ts";

/**
 * Draft-night trades on the Draft page: the pick value chart (a modal) and the offers AI teams make for the user's next
 * pick, with Accept / Decline and a "Shop this pick" button. Everything is computed in the worker
 * (core/draft/draftNightTrades.ts), and accepting goes through the normal trade proposal.
 */

type Chart = Awaited<ReturnType<typeof loadChart>>;
const loadChart = () => toWorker("main", "getDraftPickValueChart", undefined);

type OffersInfo = Awaited<ReturnType<typeof loadOffers>>;
type Offer = OffersInfo["offers"][number];
const loadOffers = (shopDpid: number | undefined) =>
	toWorker("main", "getDraftNightOffers", shopDpid);

export const PickValueChartModal = ({
	show,
	onHide,
}: {
	show: boolean;
	onHide: () => void;
}) => {
	const [chart, setChart] = useState<Chart | undefined>();

	useEffect(() => {
		if (show) {
			setChart(undefined);
			void (async () => {
				setChart(await loadChart());
			})();
		}
	}, [show]);

	return (
		<Modal show={show} onHide={onHide} scrollable>
			<Modal.Header closeButton>Pick value chart</Modal.Header>
			<Modal.Body>
				<p>
					What every pick left in this draft is worth in trades, in points (a
					typical No. 1 pick is 1000). It comes from the prospects still on the
					board, so a deep class is worth more further down and a weak one less.
					AI teams price draft-night trades with it.
				</p>
				{!chart ? (
					"Loading..."
				) : chart.rows.length === 0 ? (
					<p>No picks left in this draft.</p>
				) : (
					<div className="table-responsive">
						<table className="table table-sm table-striped mb-0">
							<thead>
								<tr>
									<th>Pick</th>
									<th>Team</th>
									<th className="text-end">Value</th>
									<th
										className="text-end"
										title="The same pick in a typical draft class"
									>
										Typical class
									</th>
								</tr>
							</thead>
							<tbody>
								{chart.rows.map((row) => (
									<tr key={row.dpid}>
										<td>
											{row.overall} ({row.round}-{row.pick})
										</td>
										<td>
											{row.abbrev}
											{row.tid !== row.originalTid ? (
												<span className="text-body-secondary">
													{" "}
													(from {row.originalAbbrev})
												</span>
											) : null}
										</td>
										<td className="text-end">{row.points}</td>
										<td className="text-end text-body-secondary">
											{row.typicalPoints}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Modal.Body>
		</Modal>
	);
};

const AssetList = ({ assets }: { assets: Offer["userGives"] }) => (
	<>
		{assets.map((asset, i) => (
			<span key={asset.dpid}>
				{i > 0 ? ", " : ""}
				{asset.desc}{" "}
				<span className="text-body-secondary">
					({asset.estimate ? "about " : ""}
					{asset.points})
				</span>
			</span>
		))}
	</>
);

export const DraftNightOffers = ({ refreshKey }: { refreshKey: string }) => {
	const [info, setInfo] = useState<OffersInfo | undefined>();
	const [shopped, setShopped] = useState<Offer[] | undefined>();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setShopped(undefined);
		void (async () => {
			const output = await loadOffers(undefined);
			if (!cancelled) {
				setInfo(output);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	if (!info || info.userDpid === undefined || info.picksAway === undefined) {
		return null;
	}

	const keys = new Set(info.offers.map((offer) => offer.key));
	const offers = [
		...info.offers,
		...(shopped ?? []).filter((offer) => !keys.has(offer.key)),
	];

	const refresh = async () => {
		setInfo(await loadOffers(undefined));
	};

	return (
		<div className="card mb-3">
			<div className="card-body p-2">
				<div className="d-flex flex-wrap gap-2 align-items-center mb-1">
					<b>Draft-night offers</b>
					<span className="text-body-secondary">
						{info.picksAway === 0
							? "You're on the clock."
							: `Your next pick is ${info.picksAway} ${info.picksAway === 1 ? "pick" : "picks"} away.`}
					</span>
					<button
						className="btn btn-light-bordered btn-sm"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							setMessage(undefined);
							const output = await loadOffers(info.userDpid);
							setShopped(output.offers);
							if (output.offers.length === 0) {
								setMessage("Nobody wants to move up into this pick right now.");
							}
							setBusy(false);
						}}
					>
						Shop this pick
					</button>
				</div>
				{offers.length === 0 && !message ? (
					<div className="text-body-secondary">
						No offers for your pick right now.
					</div>
				) : null}
				{offers.map((offer) => (
					<div key={offer.key} className="border-top pt-1 mt-1">
						<div>{offer.text}</div>
						<div>
							<b>You give:</b> <AssetList assets={offer.userGives} />
							{offer.userGives.length > 1
								? ` = ${offer.userGivesPoints}`
								: null}
						</div>
						<div>
							<b>You get:</b> <AssetList assets={offer.userGets} />
							{offer.userGets.length > 1 ? ` = ${offer.userGetsPoints}` : null}
						</div>
						<div className="d-flex gap-2 mt-1">
							<button
								className="btn btn-primary btn-sm"
								disabled={busy}
								onClick={async () => {
									setBusy(true);
									const result = await toWorker(
										"main",
										"acceptDraftNightOffer",
										offer.teams,
									);
									if (result.accepted && result.undoKey !== undefined) {
										showUndoNotification({
											actionName: "trade",
											undoKey: result.undoKey,
											title: result.message,
										});
										setMessage(undefined);
									} else {
										setMessage(result.message ?? undefined);
									}
									setShopped(undefined);
									await refresh();
									setBusy(false);
								}}
							>
								Accept
							</button>
							<button
								className="btn btn-light-bordered btn-sm"
								disabled={busy}
								onClick={async () => {
									await toWorker("main", "declineDraftNightOffer", offer.key);
									setShopped((rows) =>
										rows?.filter((row) => row.key !== offer.key),
									);
									await refresh();
								}}
							>
								Decline
							</button>
						</div>
					</div>
				))}
				{message ? (
					<div className="mt-1 text-body-secondary">{message}</div>
				) : null}
				<div className="small text-body-secondary mt-1">
					Points are from the pick value chart. Future picks are a typical pick
					of their round.
				</div>
			</div>
		</div>
	);
};
