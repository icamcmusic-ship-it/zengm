import { useState } from "react";
import DraftClass from "./DraftClass.tsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import type { View } from "../../../common/types.ts";
import { MoreLinks } from "../../components/MoreLinks.tsx";
import { useLocal } from "../../util/local.ts";
import { helpers } from "../../util/helpers.ts";
import { AllClassesPanel } from "../../components/RegenerateRatings/AllClassesPanel.tsx";
import { RegenerateRatingsButton } from "../../components/RegenerateRatings/RegenerateRatingsButton.tsx";

const PAGE_SIZE = 3;

const DraftScouting = ({
	fantasyDraft,
	seasons,
	scoutingStatus,
}: View<"draftScouting">) => {
	const { challengeNoRatings, draftType, godMode } = useLocal([
		"challengeNoRatings",
		"draftType",
		"godMode",
	]);

	const noDraft = draftType === "freeAgents";

	useTitleBar({ title: !noDraft ? "Draft Scouting" : "Upcoming Prospects" });

	const [page, setPage] = useState(0);

	if (seasons.length <= PAGE_SIZE && page !== 0) {
		setPage(0);
	}

	const pagination = seasons.length > PAGE_SIZE;
	const maxPage = Math.ceil(seasons.length / PAGE_SIZE) - 1;
	const enablePrevious = pagination && page > 0;
	const enableNext = pagination && page < maxPage;

	let seasonsToDisplay;
	if (pagination) {
		const indexStart = page * PAGE_SIZE;
		const indexEnd = indexStart + PAGE_SIZE;
		seasonsToDisplay = seasons.slice(indexStart, indexEnd);
	} else {
		seasonsToDisplay = seasons;
	}

	return (
		<>
			<MoreLinks type="draft" page="draft_scouting" draftType={draftType} />

			<p>
				The ratings shown are your scouts' projections for what the players'
				ratings will be when they enter the {!noDraft ? "draft" : "league"}. The
				further in the future, the more uncertainty there is in their estimates.
			</p>

			{scoutingStatus ? (
				<p>
					<b>Scouting points:</b> {scoutingStatus.remaining} of{" "}
					{scoutingStatus.total} left this season (from your scouting budget).
					Assign a scout (1 point) or attend a workout (3 points) to narrow a
					prospect's ratings. Rank prospects on your{" "}
					<a href={helpers.leagueUrl(["draft_board"])}>Draft Board</a>.
				</p>
			) : null}

			<RegenerateRatingsButton seasons={seasons.map((info) => info.season)} />
			{!fantasyDraft ? (
				<AllClassesPanel seasons={seasons.map((info) => info.season)} />
			) : null}

			{pagination ? (
				<div className="d-flex flex-row-reverse">
					<div className="btn-group">
						<button
							className="btn btn-light-bordered"
							disabled={!enablePrevious}
							onClick={() => {
								setPage((page) => page - 1);
							}}
						>
							Previous
						</button>
						<button
							className="btn btn-light-bordered"
							disabled={!enableNext}
							onClick={() => {
								setPage((page) => page + 1);
							}}
						>
							Next
						</button>
					</div>
				</div>
			) : null}

			<div className="row">
				{seasonsToDisplay.map((info, offset) => {
					return (
						<div key={info.season} className="col-md-4 col-sm-6">
							<DraftClass
								challengeNoRatings={challengeNoRatings}
								fantasyDraft={fantasyDraft}
								godMode={godMode}
								numWithCollegeStats={info.numWithCollegeStats}
								offset={offset}
								players={info.players}
								season={info.season}
								scoutingRemaining={scoutingStatus?.remaining}
							/>
						</div>
					);
				})}
			</div>
		</>
	);
};

export default DraftScouting;
