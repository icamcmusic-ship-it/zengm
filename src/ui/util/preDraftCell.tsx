import clsx from "clsx";
import {
	draftedVsPreDraftText,
	stealOrReach,
} from "../../common/preDraftRanks.ts";

// Drafted players: his pre-draft rank, and how far from it he went (steals and reaches)
export const wrappedPreDraftVsPick = (
	overallPick: number,
	preDraftRank: number,
) => {
	const { diff, kind } = stealOrReach(overallPick, preDraftRank);
	return {
		value: (
			<span className="text-nowrap">
				#{preDraftRank}
				{kind ? (
					<span
						className={clsx(
							"ms-1 small",
							kind === "steal" ? "text-success" : "text-danger",
						)}
					>
						{diff > 0 ? `+${diff}` : diff}
					</span>
				) : null}
			</span>
		),
		sortValue: preDraftRank,
		searchValue: preDraftRank,
		title: `${draftedVsPreDraftText(overallPick, preDraftRank)}${kind ? ` (${kind})` : ""}`,
	};
};
