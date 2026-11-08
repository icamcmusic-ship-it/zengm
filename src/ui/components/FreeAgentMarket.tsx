import { OverlayTrigger, Popover } from "react-bootstrap";
import type {
	FreeAgentMarket,
	MarketTier,
} from "../../worker/core/freeAgents/market.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";

const TIER_TEXT: Record<MarketTier, string> = {
	topTarget: "Top target",
	backup: "Next in line",
	fallback: "Fallback option",
};

const formatProb = (prob: number) => {
	if (prob > 0 && prob < 0.01) {
		return "<1%";
	}
	return `${Math.round(prob * 100)}%`;
};

// Interested AI teams for a free agent, with a popover listing who's likely to sign him
export const FreeAgentMarketCell = ({
	market,
	userAsking,
}: {
	market: FreeAgentMarket | undefined;
	userAsking: number;
}) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	if (!market) {
		return null;
	}

	const label =
		market.numInterested === 0 ? (
			<span className="text-body-secondary">None</span>
		) : (
			<>
				{market.numInterested}{" "}
				<span className="text-body-secondary">
					({formatProb(market.probSignedNextDay)}/day)
				</span>
			</>
		);

	const likely =
		market.likelyTid !== undefined
			? teamInfoCache[market.likelyTid]
			: undefined;

	return (
		<OverlayTrigger
			trigger="click"
			placement="auto"
			rootClose
			overlay={
				<Popover>
					<Popover.Body>
						{market.numInterested === 0 ? (
							<p className="mb-0">
								No AI team has room for him or wants him right now.
							</p>
						) : (
							<>
								<p className="mb-2">
									AI teams would sign him at{" "}
									{helpers.formatCurrency(market.aiOffer / 1000, "M")}/year
									{userAsking !== market.aiOffer
										? `; he asks you for ${helpers.formatCurrency(userAsking / 1000, "M")}`
										: null}
									. About {formatProb(market.probSignedNextDay)} chance he signs
									elsewhere on the next day.
									{likely ? (
										<>
											{" "}
											Most likely: <b>{likely.region}</b>.
										</>
									) : null}
								</p>
								<table className="table table-sm mb-0">
									<thead>
										<tr>
											<th>Team</th>
											<th>Interest</th>
											<th title="Chance this team signs him on the next day">
												Per day
											</th>
										</tr>
									</thead>
									<tbody>
										{market.teams.map((t) => (
											<tr key={t.tid}>
												<td>{teamInfoCache[t.tid]?.abbrev}</td>
												<td>{TIER_TEXT[t.tier]}</td>
												<td>{formatProb(t.probPerDay)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</>
						)}
					</Popover.Body>
				</Popover>
			}
		>
			<button
				className="btn btn-link p-0 border-0 text-reset text-decoration-none text-nowrap"
				type="button"
			>
				{label}
			</button>
		</OverlayTrigger>
	);
};

export const wrappedFreeAgentMarket = (
	market: FreeAgentMarket | undefined,
	userAsking: number,
) => ({
	value: <FreeAgentMarketCell market={market} userAsking={userAsking} />,
	sortValue: market ? market.probSignedNextDay : -1,
	searchValue: market ? String(market.numInterested) : "",
});
