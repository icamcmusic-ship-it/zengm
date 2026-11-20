// Commercial Deals & Ownership (League Extra): sponsorship/local TV deals and offers, the owner's type, revenue sharing, and the season
// P&L with cash reconciliation on Team Finances. Formulas: common/commercial.ts, data from worker/core/commercial and the view
import { useState } from "react";
import type { DealKind, DealStyle } from "../../../common/commercial.ts";
import type { View } from "../../../common/types.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";
import { helpers } from "../../util/helpers.ts";
import { showNotification } from "../../util/showNotification.ts";
import { toWorker } from "../../util/toWorker.ts";

export type CommercialInfo = NonNullable<View<"teamFinances">["commercial"]>;
export type PnlInfo = NonNullable<View<"teamFinances">["pnl"]>;

const money = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M", 1);

export const Commercial = ({
	info,
	own,
	disabled,
}: {
	info: CommercialInfo;
	own: boolean;
	disabled: boolean;
}) => {
	const [choosing, setChoosing] = useState(false);

	const choose = async (kind: DealKind, style: DealStyle) => {
		setChoosing(true);
		const error = await toWorker("main", "chooseCommercialOffer", {
			kind,
			style,
		});
		setChoosing(false);
		if (error) {
			showNotification({ type: "error", text: error });
		} else {
			showNotification({ type: "success", text: "Deal signed." });
		}
	};

	return (
		<div className="mb-3">
			<h2>
				Commercial deals & ownership{" "}
				<HelpPopover title="Commercial deals & ownership">
					<p>
						Sponsorship and local TV are multi-year deals. Their value depends
						on market size, recent success, star power (hype and population) and
						your facilities. In the regular season they replace the per-game
						sponsorship and local TV revenue; playoff games still earn those as
						usual.
					</p>
					<p>
						When a deal expires you get three offers: a long fixed deal (safe,
						but it doesn't grow with the salary cap), a standard one, and a
						one-season performance deal with a bonus that grows with your
						winning percentage. If you don't choose, the standard one is signed
						at the first regular season game.
					</p>
					<p>
						Revenue sharing: at the end of the regular season each team pays{" "}
						{info.sharePct}% of its local revenue into a pool, paid out{" "}
						{info.shareMode === "smallMarkets"
							? "weighted toward small markets"
							: "equally"}
						.
					</p>
				</HelpPopover>
			</h2>
			<div className="row">
				<div className="col-md-7">
					<table className="table table-sm table-nonfluid">
						<thead>
							<tr>
								<th>Deal</th>
								<th>Partner</th>
								<th>Per season</th>
								<th>Seasons</th>
							</tr>
						</thead>
						<tbody>
							{info.deals.map(({ kind, name, deal }) => (
								<tr key={kind}>
									<td>{name}</td>
									{deal ? (
										<>
											<td>
												{deal.partner} ({info.styles[deal.style].name})
											</td>
											<td>
												{money(deal.annual)}
												{deal.bonus > 0 ? ` + up to ${money(deal.bonus)}` : ""}
											</td>
											<td>
												{deal.startSeason}–{deal.startSeason + deal.years - 1}
											</td>
										</>
									) : (
										<td colSpan={3}>No deal yet</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
					{info.deals
						.filter((d) => d.offers.length > 0)
						.map(({ kind, name, offers }) => (
							<div key={kind}>
								<h3>{name} offers</h3>
								<table className="table table-sm table-nonfluid">
									<tbody>
										{offers.map((offer) => (
											<tr key={offer.style}>
												<td>
													<b>{info.styles[offer.style].name}</b> from{" "}
													{offer.partner}
													<br />
													<span className="text-body-secondary">
														{info.styles[offer.style].description}
													</span>
												</td>
												<td>
													{money(offer.annual)}
													{offer.bonus > 0
														? ` + up to ${money(offer.bonus)}`
														: ""}{" "}
													× {offer.years}
												</td>
												<td>
													{own ? (
														<button
															type="button"
															className="btn btn-sm btn-secondary"
															disabled={disabled || choosing}
															onClick={() => choose(kind, offer.style)}
														>
															Sign
														</button>
													) : null}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						))}
				</div>
				<div className="col-md-5">
					<h3>Owner</h3>
					<p>
						<b>{info.owner.name}</b>
						{info.owner.since !== undefined
							? `, since ${info.owner.since}`
							: ""}
						: {info.owner.description}
					</p>
					{info.owner.pendingSale ? (
						<p className="text-warning">
							The team is being sold. The new owner (
							{info.owner.pendingSale.name}) takes over in the{" "}
							{info.owner.pendingSale.season} preseason.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};

export const SeasonPnl = ({ pnl }: { pnl: PnlInfo }) => {
	const [index, setIndex] = useState(0);
	const row = pnl[index];
	if (!row) {
		return null;
	}
	const line = ([label, value]: [string, number]) =>
		value !== 0 ? (
			<tr key={label}>
				<td>{label}</td>
				<td className="text-end">{money(value)}</td>
			</tr>
		) : null;
	const diff =
		row.prevCashEnd !== undefined ? row.cashStart - row.prevCashEnd : 0;

	return (
		<div className="mb-3">
			<h2>
				Season P&L{" "}
				<select
					className="form-select form-select-sm d-inline-block w-auto"
					value={index}
					onChange={(event) => {
						setIndex(Number.parseInt(event.target.value));
					}}
				>
					{pnl.map((r, i) => (
						<option key={r.season} value={i}>
							{r.season}
						</option>
					))}
				</select>
			</h2>
			<div className="d-flex flex-wrap gap-4">
				<table className="table table-sm table-nonfluid">
					<thead>
						<tr>
							<th colSpan={2}>Revenue</th>
						</tr>
					</thead>
					<tbody>
						{row.revenues.map(line)}
						<tr className="fw-bold">
							<td>Total revenue</td>
							<td className="text-end">{money(row.revenue)}</td>
						</tr>
					</tbody>
				</table>
				<table className="table table-sm table-nonfluid">
					<thead>
						<tr>
							<th colSpan={2}>Expenses</th>
						</tr>
					</thead>
					<tbody>
						{row.expenses.map(line)}
						<tr className="fw-bold">
							<td>Total expenses</td>
							<td className="text-end">{money(row.expense)}</td>
						</tr>
					</tbody>
				</table>
				<table className="table table-sm table-nonfluid">
					<thead>
						<tr>
							<th colSpan={2}>Cash</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Cash at start</td>
							<td className="text-end">{money(row.cashStart)}</td>
						</tr>
						<tr>
							<td>+ Profit</td>
							<td className="text-end">{money(row.profit)}</td>
						</tr>
						<tr>
							<td>− Owner distributions</td>
							<td className="text-end">{money(row.distributions)}</td>
						</tr>
						<tr className="fw-bold">
							<td>Cash at end</td>
							<td className="text-end">{money(row.cashEnd)}</td>
						</tr>
						{row.prevCashEnd !== undefined && Math.abs(diff) >= 1 ? (
							<tr className="text-body-secondary">
								<td>Adjustments outside the books</td>
								<td className="text-end">{money(diff)}</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
};
