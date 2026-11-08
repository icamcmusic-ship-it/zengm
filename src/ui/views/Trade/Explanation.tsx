import { useFeatureOn } from "../../util/nativeFeatures.ts";
import { useState } from "react";
import clsx from "clsx";
import type {
	ExplanationTerm,
	TradeExplanation,
} from "../../../worker/core/trade/explain.ts";
import { helpers } from "../../util/helpers.ts";

const Term = ({ term }: { term: ExplanationTerm }) => {
	return (
		<li
			className={clsx({
				"text-success": term.effect === "good",
				"text-danger": term.effect === "bad",
			})}
		>
			{term.effect === "good" ? "+ " : term.effect === "bad" ? "− " : ""}
			{term.text}
		</li>
	);
};

// Why an AI team accepted, refused or countered a trade, built from the same terms the AI uses to value it
export const Explanation = ({
	explanation,
	defaultOpen = false,
}: {
	explanation: TradeExplanation;
	defaultOpen?: boolean;
}) => {
	const [open, setOpen] = useState(defaultOpen);
	const on = useFeatureOn("tradeExplain");
	if (!on) {
		return null;
	}

	const receive = explanation.assets.filter((a) => a.direction === "receive");
	const give = explanation.assets.filter((a) => a.direction === "give");

	return (
		<div className="trade-explanation small mt-1 text-start">
			<button
				className="btn btn-link btn-sm p-0"
				type="button"
				onClick={() => {
					setOpen((value) => !value);
				}}
			>
				{open ? "Hide" : "Why?"}{" "}
				<span className="text-body-secondary">
					({explanation.teamName}, {explanation.strategy})
				</span>
			</button>
			{open ? (
				<div className="mt-1">
					<div className="mb-1">{explanation.summary}</div>
					{[
						["They receive", receive],
						["They give up", give],
					].map(([title, assets]) =>
						(assets as typeof receive).length > 0 ? (
							<div key={title as string}>
								<b>{title as string}</b>
								{(assets as typeof receive).map((asset) => (
									<div
										key={`${asset.type}-${asset.pid ?? asset.dpid}`}
										className="mb-1"
									>
										{asset.type === "player" && asset.pid !== undefined ? (
											<a href={helpers.leagueUrl(["player", asset.pid])}>
												{asset.name}
											</a>
										) : (
											asset.name
										)}{" "}
										<span className="text-body-secondary">
											({asset.share}% of the value)
										</span>
										<ul className="list-unstyled ms-2 mb-0">
											{asset.terms.map((term, i) => (
												<Term key={i} term={term} />
											))}
										</ul>
									</div>
								))}
							</div>
						) : null,
					)}
					<b>Team</b>
					<ul className="list-unstyled ms-2 mb-0">
						{explanation.team.map((term, i) => (
							<Term key={i} term={term} />
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
};
