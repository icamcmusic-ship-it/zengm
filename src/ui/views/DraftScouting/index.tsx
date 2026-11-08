import { useState } from "react";
import { useFeatureOn } from "../../util/nativeFeatures.ts";
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
	const regeneratorOn = useFeatureOn("ratingsRegenerator");
	const [selectedOffset, setSelectedOffset] = useState(0);
	const collegeStatsOn = useFeatureOn("collegeStats");
	const draftBoardOn = useFeatureOn("draftBoard");
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

	const activeOffset =
		selectedOffset < seasonsToDisplay.length ? selectedOffset : 0;

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
					prospect's ratings.
					{draftBoardOn ? (
						<>
							{" "}
							Rank prospects on your{" "}
							<a href={helpers.leagueUrl(["draft_board"])}>Draft Board</a>.
						</>
					) : null}
				</p>
			) : null}

			{regeneratorOn ? (
				<RegenerateRatingsButton seasons={seasons.map((info) => info.season)} />
			) : null}
			{!fantasyDraft && (regeneratorOn || collegeStatsOn) ? (
				<AllClassesPanel
					seasons={seasons.map((info) => info.season)}
					showStats={collegeStatsOn}
					showRatings={regeneratorOn}
				/>
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

			{seasonsToDisplay.length > 1 ? (
				<ul className="nav nav-tabs mb-3 d-xxl-none">
					{seasonsToDisplay.map((info, offset) => (
						<li className="nav-item" key={info.season}>
							<button
								type="button"
								className={`nav-link${offset === activeOffset ? " active" : ""}`}
								onClick={() => {
									setSelectedOffset(offset);
								}}
							>
								{info.season}
							</button>
						</li>
					))}
				</ul>
			) : null}

			<div className="row">
				{seasonsToDisplay.map((info, offset) => {
					// Narrower than xxl, the classes are tabs (each table needs the full width); side by side above that
					return (
						<div
							key={info.season}
							className={`col-xxl-4${offset === activeOffset ? "" : " d-none d-xxl-block"}`}
						>
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
