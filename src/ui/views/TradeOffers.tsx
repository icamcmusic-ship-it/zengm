import { useState } from "react";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { ActionButton } from "../components/ActionButton.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { useLocal } from "../util/local.ts";
import { PHASE } from "../../common/constants.ts";
import type { View } from "../../common/types.ts";
import { SummaryTeam } from "./Trade/Summary.tsx";
import { Offer } from "./TradingBlock/index.tsx";

const SOURCE_TEXT = {
	tradingBlock: "Trading block",
	unsolicited: "Unsolicited",
	requested: "You asked",
} as const;

const VALUE_HINT = {
	good: { text: "Looks good for you", className: "text-success" },
	fair: { text: "Roughly fair", className: "text-body-secondary" },
	costly: { text: "Favors them", className: "text-danger" },
} as const;

const RequestOffers = ({
	blockPids,
	userPicks,
	userPlayers,
}: Pick<View<"tradeOffers">, "blockPids" | "userPicks" | "userPlayers">) => {
	const [pids, setPids] = useState<number[]>([]);
	const [dpids, setDpids] = useState<number[]>([]);
	const [processing, setProcessing] = useState(false);
	const [message, setMessage] = useState<string | undefined>();

	const toggle = (list: number[], id: number) =>
		list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

	return (
		<div className="card mb-4" style={{ maxWidth: 700 }}>
			<div className="card-body">
				<h3 className="card-title">Request offers</h3>
				<p className="text-body-secondary">
					Pick players or picks and ask AI teams what they'd give. The best
					answers show up below as offers.
				</p>
				<div className="d-flex flex-wrap gap-2 mb-2">
					{userPlayers.map((p) => (
						<button
							key={p.pid}
							type="button"
							className={`btn btn-sm ${pids.includes(p.pid) ? "btn-primary" : "btn-light-bordered"}`}
							onClick={() => {
								setPids(toggle(pids, p.pid));
							}}
						>
							{p.name} <span className="opacity-75">{p.pos}</span>
							{blockPids.includes(p.pid) ? " (block)" : null}
						</button>
					))}
				</div>
				{userPicks.length > 0 ? (
					<div className="d-flex flex-wrap gap-2 mb-3">
						{userPicks.map((dp) => (
							<button
								key={dp.dpid}
								type="button"
								className={`btn btn-sm ${dpids.includes(dp.dpid) ? "btn-primary" : "btn-light-bordered"}`}
								onClick={() => {
									setDpids(toggle(dpids, dp.dpid));
								}}
							>
								{dp.desc}
							</button>
						))}
					</div>
				) : null}
				<ActionButton
					disabled={pids.length === 0 && dpids.length === 0}
					processing={processing}
					processingText="Asking around"
					onClick={async () => {
						setProcessing(true);
						setMessage(undefined);
						const count = await toWorker("main", "requestAiTradeOffers", {
							pids,
							dpids,
						});
						setProcessing(false);
						setPids([]);
						setDpids([]);
						setMessage(
							count === 0
								? "No team made an offer."
								: `${count} team${count === 1 ? "" : "s"} made an offer.`,
						);
					}}
				>
					Request offers
				</ActionButton>
				{message ? <span className="ms-3">{message}</span> : null}
			</div>
		</div>
	);
};

const TradeOffers = ({
	blockPids,
	expiration,
	offers,
	userPicks,
	userPlayers,
}: View<"tradeOffers">) => {
	const {
		challengeNoRatings,
		challengeNoTrades,
		gameOver,
		phase,
		salaryCap,
		salaryCapType,
		spectator,
		teamInfoCache,
	} = useLocal([
		"challengeNoRatings",
		"challengeNoTrades",
		"gameOver",
		"phase",
		"salaryCap",
		"salaryCapType",
		"spectator",
		"teamInfoCache",
	]);

	const [result, setResult] = useState<
		{ accepted: boolean; message: string | null | undefined } | undefined
	>();

	const [accepting, setAccepting] = useState<number | undefined>();

	useTitleBar({ title: "Trade Offers" });

	if (spectator) {
		return <p>You're not allowed to make trades in spectator mode.</p>;
	}

	if (challengeNoTrades) {
		return (
			<div>
				<p className="alert alert-danger d-inline-block">
					<b>Challenge Mode:</b> You're not allowed to make trades.
				</p>
			</div>
		);
	}

	const tradingClosed =
		(phase >= PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.PLAYOFFS) ||
		phase === PHASE.FANTASY_DRAFT ||
		phase === PHASE.EXPANSION_DRAFT ||
		gameOver;

	return (
		<>
			<MoreLinks type="trade" page="trade_offers" />
			<p>
				Offers AI teams made to you, for players on your{" "}
				<a href={helpers.leagueUrl(["trading_block"])}>trading block</a> or
				anyone else they want. New offers arrive during the regular season
				(until the trade deadline) and the offseason. They expire after{" "}
				{expiration} days, when the phase changes, when a player or pick in the
				offer moves, or when the other team loses a player.
			</p>
			{tradingClosed ? (
				<p className="alert alert-warning d-inline-block">
					You're not allowed to make trades{" "}
					{phase === PHASE.AFTER_TRADE_DEADLINE
						? "after the trade deadline"
						: "now"}
					.
				</p>
			) : (
				<RequestOffers
					blockPids={blockPids}
					userPicks={userPicks}
					userPlayers={userPlayers}
				/>
			)}
			{result ? (
				<div
					className={`alert ${result.accepted ? "alert-success" : "alert-danger"} d-inline-block`}
				>
					{result.message}
				</div>
			) : null}
			{offers.length === 0 ? (
				<p className="text-body-secondary">No offers right now.</p>
			) : null}
			<div
				data-csv-table=""
				data-csv-name="Trade offers"
				data-csv-cols={JSON.stringify([
					"Team",
					"Source",
					"Value",
					"Expires",
					"Reason",
					"They give",
					"You give",
				])}
			>
				{offers.map((offer, i) => {
					const hint = VALUE_HINT[offer.valueHint];
					const assets = (j: number) => {
						const t = offer.summary.teams[j];
						return t
							? [
									...t.trade.map((p) => p.name),
									...t.picks.map((dp) => dp.desc),
								].join("; ")
							: "";
					};
					// teams[0] is the user's side of the summary
					const csvRow = JSON.stringify([
						teamInfoCache[offer.tid]?.abbrev ?? "",
						SOURCE_TEXT[offer.source],
						hint.text,
						offer.expiresIn === undefined
							? "When the phase changes"
							: `${offer.expiresIn} days`,
						offer.reason,
						assets(1),
						assets(0),
					]);
					return (
						<Offer
							key={offer.id}
							challengeNoRatings={challengeNoRatings}
							onNegotiate={async () => {
								await toWorker("actions", "tradeFor", {
									otherPickConditions: offer.pickConditions,
									userPickConditions: offer.pickConditionsUser,
									otherDpids: offer.dpids,
									otherPids: offer.pids,
									tid: offer.tid,
									userDpids: offer.dpidsUser,
									userPids: offer.pidsUser,
								});
							}}
							onRemove={async () => {
								await toWorker("main", "dismissAiTradeOffer", offer.id);
							}}
							removeTitle="Decline offer"
							actions={
								<>
									<ActionButton
										disabled={tradingClosed || accepting !== undefined}
										processing={accepting === offer.id}
										processingText="Accepting"
										onClick={async () => {
											setAccepting(offer.id);
											const res = await toWorker(
												"main",
												"acceptAiTradeOffer",
												offer.id,
											);
											setAccepting(undefined);
											setResult(res);
										}}
									>
										Accept
									</ActionButton>
									<button
										type="button"
										className="btn btn-light-bordered"
										onClick={async () => {
											await toWorker("main", "dismissAiTradeOffer", offer.id);
										}}
									>
										Decline
									</button>
								</>
							}
							salaryCap={salaryCap}
							salaryCapType={salaryCapType}
							teamInfo={teamInfoCache[offer.tid]!}
							hideTopTeamOvrs
							first={i === 0}
							{...offer}
						>
							<span hidden data-csv-row={csvRow} />
							<p className="mb-2">
								<span className="badge bg-secondary me-2">
									{SOURCE_TEXT[offer.source]}
								</span>
								<span className={`fw-bold me-2 ${hint.className}`}>
									{hint.text}
								</span>
								<span className="text-body-secondary">
									{offer.expiresIn === undefined
										? "Expires when the phase changes"
										: `Expires in ${offer.expiresIn} day${offer.expiresIn === 1 ? "" : "s"}`}
								</span>
							</p>
							<p className="mb-2 text-body-secondary">{offer.reason}</p>
							{/* Wraps on a phone, where the two sides side by side are wider than the screen */}
							<div className="d-flex flex-wrap column-gap-5 row-gap-2">
								{offer.summary.teams.map((t, j) => {
									return (
										<div key={j}>
											<SummaryTeam
												hideFinanceInfo
												showInlinePlayerInfo
												summary={offer.summary}
												t={t}
											/>
										</div>
									);
								})}
							</div>
						</Offer>
					);
				})}
			</div>
		</>
	);
};

export default TradeOffers;
