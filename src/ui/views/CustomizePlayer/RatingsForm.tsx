import { Fragment, type ChangeEvent, useState, useEffect } from "react";
import { RATINGS } from "../../../common/constants.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { getCol } from "../../../common/getCol.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { useLocal } from "../../util/local.ts";
import { useFeatureOn } from "../../util/nativeFeatures.ts";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";
import { subsOfBase } from "../../../common/subRatings.ts";

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

// Second step: catch-and-shoot/off-the-dribble with the shooting ratings (fg and tp follow their sum), ball security after
// dribbling, offensive/defensive rebounding in place of rebounding (their average)
const rowsExpanded2: {
	[key: string]: string[];
}[][] = [
	[
		{ Physical: ["hgt", "wng", "stre", "spd", "jmp", "endu"] },
		{ Shooting: ["ins", "dnk", "ft", "fg", "tp", "csh", "dsh"] },
		{
			Skill: ["oiq", "pdef", "idef", "drb", "bsc", "pss", "oreb", "dreb"],
		},
	],
];

// Sub-ratings (the subRatings setting): the base ratings, each with its sub-ratings under it (editing a sub recomputes its base, editing a
// base moves its subs), and wingspan with expanded ratings (the other expanded ratings follow the subs)
const rowsSub = (expanded: boolean): { [key: string]: string[] }[][] => [
	[
		{
			Physical: expanded
				? ["hgt", "wng", "stre", "spd", "jmp", "endu"]
				: ["hgt", "stre", "spd", "jmp", "endu"],
		},
		{ Shooting: ["ins", "dnk", "ft", "fg", "tp"] },
		{ Skill: ["oiq", "diq", "drb", "pss", "reb"] },
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
	const subOn = useFeatureOn("subRatings");
	const subs =
		__SPORT === "basketball" &&
		subOn &&
		Array.isArray(ratingsRow.sub) &&
		ratingsRow.sub.length > 0;
	const rows = subs
		? rowsSub(expanded)
		: expanded
			? typeof ratingsRow.oreb === "number"
				? rowsExpanded2
				: rowsExpanded
			: rowsStock;

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
																{subs && subsOfBase(rating).length > 0 ? (
																	<div className="d-flex flex-wrap gap-1 mt-1 ms-2">
																		{subsOfBase(rating).map(({ i, def }) => (
																			<div key={def.key} style={{ width: 68 }}>
																				<label
																					className="form-label small text-body-secondary mb-0"
																					htmlFor={`customize-player-sub-${def.key}`}
																					title={def.description}
																				>
																					{def.name}
																				</label>
																				<input
																					type="text"
																					className="form-control form-control-sm"
																					id={`customize-player-sub-${def.key}`}
																					onChange={(event) => {
																						handleChange(
																							"subRating",
																							String(i),
																							event,
																						);
																					}}
																					value={
																						hideRatings
																							? ""
																							: godMode
																								? ratingsRow.sub[i]
																								: Math.round(
																										helpers.bound(
																											Number(
																												ratingsRow.sub[i],
																											) + ratingsRow.fuzz,
																											0,
																											100,
																										),
																									)
																					}
																					disabled={!godMode}
																				/>
																			</div>
																		))}
																	</div>
																) : null}
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
