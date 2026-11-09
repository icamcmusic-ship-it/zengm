import { Fragment, type ChangeEvent, useState, useEffect } from "react";
import { RATINGS } from "../../../common/constants.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { getCol } from "../../../common/getCol.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { useLocal } from "../../util/local.ts";
import { useFeatureOn } from "../../util/nativeFeatures.ts";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";

const rowsStock = bySport<
	{
		[key: string]: string[];
	}[][]
>({
	baseball: [
		[
			{ "Physical/Hitting": ["hgt", "spd", "hpw", "con", "eye"] },
			{ Defense: ["gnd", "fly", "thr", "cat"] },
			{ Pitching: ["ppw", "ctl", "mov", "endu"] },
		],
	],
	basketball: [
		[
			{ Physical: ["hgt", "stre", "spd", "jmp", "endu"] },
			{ Shooting: ["ins", "dnk", "ft", "fg", "tp"] },
			{ Skill: ["oiq", "diq", "drb", "pss", "reb"] },
		],
	],
	football: [
		[
			{ Physical: ["hgt", "stre", "spd", "endu"] },
			{ Passing: ["thv", "thp", "tha"] },
			{ "Rush/Rec": ["elu", "rtr", "hnd", "bsc"] },
		],
		[
			{ Blocking: ["pbk", "rbk"] },
			{ Defense: ["pcv", "tck", "prs", "rns"] },
			{ Kicking: ["kpw", "kac", "ppw", "pac"] },
		],
	],
	hockey: [
		[
			{ Physical: ["hgt", "stre", "spd", "endu"] },
			{ Offense: ["oiq", "pss", "wst", "sst", "stk"] },
			{ Defense: ["diq", "chk", "blk", "fcf", "glk"] },
		],
	],
});

const rowsExpanded: {
	[key: string]: string[];
}[][] = [
	[
		{ Physical: ["hgt", "wng", "stre", "spd", "jmp", "endu"] },
		{ Shooting: ["ins", "dnk", "ft", "fg", "tp"] },
		{ Skill: ["oiq", "pdef", "idef", "drb", "pss", "reb"] },
	],
];

const RatingsForm = ({
	handleChange,
	pos,
	ratingsRow,
}: {
	handleChange: (
		type: string,
		field: string,
		event: ChangeEvent<HTMLInputElement>,
	) => void;
	pos: string;
	ratingsRow: any;
}) => {
	const { challengeNoRatings, godMode } = useLocal([
		"challengeNoRatings",
		"godMode",
	]);

	// Expanded ratings (the expandedRatings setting): wingspan with the physical ratings, perimeter and interior defense in place of
	// defensive IQ (their average, recomputed when either changes)
	const expandedOn = useFeatureOn("expandedRatings");
	const expanded =
		__SPORT === "basketball" &&
		expandedOn &&
		typeof ratingsRow.wng === "number" &&
		typeof ratingsRow.pdef === "number";
	const rows = expanded ? rowsExpanded : rowsStock;

	const [ovr, setOvr] = useState(ratingsRow.ovr);

	useEffect(() => {
		let mounted = true;
		(async () => {
			const boundedRatings = {
				...ratingsRow,
			};
			for (const key of RATINGS) {
				boundedRatings[key] = helpers.bound(boundedRatings[key], 0, 100);
			}
			for (const key of EXPANDED_RATINGS) {
				if (boundedRatings[key] !== undefined) {
					boundedRatings[key] = helpers.bound(boundedRatings[key], 0, 100);
				}
			}

			const newOvr = await toWorker("main", "ovr", {
				ratings: boundedRatings,
				pos,
			});
			if (mounted) {
				setOvr(newOvr);
			}
		})();

		return () => {
			mounted = false;
		};
	}, [pos, ratingsRow]);

	const hideRatings = !godMode && challengeNoRatings;

	const fuzzRating = (
		ratingsRow: any,
		rating: string,
		ratingOverride?: number,
	) => {
		if (hideRatings) {
			return "";
		}

		const raw = ratingOverride ?? ratingsRow[rating];

		return godMode || rating === "hgt" || rating === "wng"
			? raw
			: Math.round(helpers.bound(raw + ratingsRow.fuzz, 0, 100));
	};

	return (
		<>
			{rows.map((row, i) => {
				return (
					<Fragment key={i}>
						<p>
							Overall:{" "}
							{Number.isNaN(ovr) ? (
								<span className="text-danger">error</span>
							) : (
								fuzzRating(ratingsRow, "ovr", ovr)
							)}
						</p>
						<div className="row">
							{row.map((block, j) => {
								return (
									<div key={j} className="col-4">
										{Object.entries(block).map(([title, ratings]) => {
											return (
												<Fragment key={title}>
													<h3>{title}</h3>
													{ratings.map((rating) => {
														return (
															<div key={rating} className="mb-3">
																<label
																	className="form-label"
																	htmlFor={`customize-player-rating-${rating}`}
																>
																	{getCol(`rating:${rating}`).desc}
																</label>
																<input
																	type="text"
																	className="form-control"
																	id={`customize-player-rating-${rating}`}
																	onChange={(event) => {
																		handleChange("rating", rating, event);
																	}}
																	value={fuzzRating(ratingsRow, rating)}
																	disabled={!godMode}
																/>
															</div>
														);
													})}
												</Fragment>
											);
										})}
									</div>
								);
							})}
						</div>
					</Fragment>
				);
			})}

			<div className="form-check mb-3">
				<input
					className="form-check-input"
					onChange={(event) => {
						handleChange("rating", "locked", event);
					}}
					type="checkbox"
					checked={!!ratingsRow.locked}
					disabled={!godMode}
					id="checkLockRatings"
				/>
				<label className="form-check-label" htmlFor="checkLockRatings">
					Lock ratings (ratings will not change as player ages)
				</label>
			</div>
		</>
	);
};

export default RatingsForm;
