import { useState } from "react";
import { DraftClassShape } from "../../components/DraftClassShape.tsx";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";
import { useFeatureOn } from "../../util/nativeFeatures.ts";
import { DataTable } from "../../components/DataTable/index.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { getCols } from "../../../common/getCols.ts";
import { RealCompCell } from "../../components/RealComps.tsx";
import type { View } from "../../../common/types.ts";
import { WEBSITE_ROOT } from "../../../common/constants.ts";
import { wrappedPlayerNameLabels } from "../../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../../components/DataTable/index.tsx";
import { downloadFile } from "../../util/downloadFile.ts";
import { LeagueFileUpload } from "../../components/LeagueFileUpload.tsx";
import { CollegeStats } from "./CollegeStats.tsx";
import { MEDICAL_SORT, MedicalGrade } from "../../components/MedicalGrade.tsx";
import { MEDICAL_EXPLANATION } from "../../../common/draftCombine.ts";
import { showNotification } from "../../util/showNotification.ts";
import {
	FlagsCell,
	RoomCell,
	flagsSortValue,
	roomSortValue,
} from "../../components/ScoutRoom.tsx";

type ScoutReport = NonNullable<
	View<"draftScouting">["seasons"][0]["players"][0]["scoutReport"]
>;

export const ScoutCell = ({
	pid,
	report,
	remaining,
}: {
	pid: number;
	report: ScoutReport;
	remaining: number | undefined;
}) => {
	const badge =
		report.confidence === "Low"
			? "text-bg-secondary"
			: report.confidence === "Medium"
				? "text-bg-info"
				: "text-bg-success";
	const scout = async (type: "scout" | "workout") => {
		const { error } = await toWorker("main", "scoutProspect", { pid, type });
		if (error) {
			showNotification({ type: "error", text: error });
		}
	};
	return (
		<span className="text-nowrap">
			<span className={`badge ${badge} fw-normal me-1`}>
				{report.confidence}
			</span>
			{report.ovr[0]}-{report.ovr[1]} / {report.pot[0]}-{report.pot[1]}
			{remaining !== undefined ? (
				<>
					{" "}
					<button
						className="btn btn-light-bordered btn-xs"
						disabled={remaining < 1}
						title="Assign a scout (1 point)"
						onClick={() => scout("scout")}
					>
						Scout
					</button>{" "}
					<button
						className="btn btn-light-bordered btn-xs"
						disabled={remaining < 3}
						title="Attend a workout (3 points)"
						onClick={() => scout("workout")}
					>
						Workout
					</button>
				</>
			) : null}
		</span>
	);
};
import { TraitBadges } from "../../components/PlayerTraits/TraitBadges.tsx";
import { formatTraitReading } from "../../../common/playerTraits/index.ts";
import {
	TRAIT_DEFINITIONS,
	TRAIT_CATEGORIES,
	isTraitKey,
	type TraitKey,
} from "../../../common/playerTraits/index.ts";

const DraftClass = ({
	challengeNoRatings,
	fantasyDraft,
	frozenRanks,
	godMode,
	numWithCollegeStats,
	offset,
	players,
	season,
	shape,
	scoutingRemaining,
}: {
	shape?: View<"draftScouting">["seasons"][0]["shape"];
	scoutingRemaining?: number;
	challengeNoRatings: boolean;
	fantasyDraft: boolean;
	frozenRanks: boolean;
	godMode: boolean;
	numWithCollegeStats: number;
	offset: number;
	players: View<"draftScouting">["seasons"][0]["players"];
	season: number;
}) => {
	const collegeStatsOn = useFeatureOn("collegeStats");
	const [showImportForm, setShowImportForm] = useState(false);
	const [showCollegeStats, setShowCollegeStats] = useState(false);
	const [status, setStatus] = useState<"exporting" | "loading" | undefined>();

	// Derived from each prospect's ratings, so it follows any regeneration
	const showArchetype =
		__SPORT === "basketball" &&
		!challengeNoRatings &&
		players.some((p) => p.archetype !== undefined);

	// Only when the Player Traits setting is on (basketball)
	const showTraits = !challengeNoRatings && players.some((p) => p.traits);
	const [traitColumn, setTraitColumn] = useState<TraitKey | "">("");

	// Expanded ratings (the expandedRatings setting): wingspan and the other expanded ratings, as the scouts see them
	const showExpanded =
		__SPORT === "basketball" &&
		!challengeNoRatings &&
		players.some((p) => p.expanded !== undefined);

	// Prospects from a linked college league show their school
	const showSchool = players.some((p) => p.linkedSchool !== undefined);

	const cols = getCols([
		"#",
		"Name",
		"Pos",
		"Age",
		"Ovr",
		"Pot",
		...(showExpanded ? EXPANDED_RATINGS.map((key) => `rating:${key}`) : []),
	]);
	// Frozen Pre-draft Ranks setting: once the class's draft has started, its ranks stay the ones it had then
	if (frozenRanks) {
		cols[0] = {
			title: "Pre",
			desc: "Pre-draft rank: his rank on your scouts' list when the draft started. It doesn't change as players are picked.",
			sortType: "number",
		};
	}
	if (showSchool) {
		cols.push({
			title: "School",
			desc: "His school in the linked college league",
			sortType: "string",
		});
	}
	if (showArchetype) {
		cols.push({
			title: "Archetype",
			desc: "Archetype derived from the prospect's ratings",
			sortType: "string",
		});
	}
	// Sub-ratings (the subRatings setting): his standout and weakest sub-rating relative to its rating, as the scouts see them
	const showSubs =
		__SPORT === "basketball" &&
		!challengeNoRatings &&
		players.some((p) => p.subHighlights !== undefined);
	if (showSubs) {
		cols.push(
			{
				title: "Standout",
				desc: "His best sub-rating relative to its rating (the gap in brackets), as your scouts see it",
				sortType: "number",
				sortSequence: ["desc", "asc"],
			},
			{
				title: "Weakness",
				desc: "His weakest sub-rating relative to its rating (the gap in brackets), as your scouts see it",
				sortType: "number",
				sortSequence: ["asc", "desc"],
			},
		);
	}
	// Real Player Comps: the top comp, all three in the tooltip
	const showComps =
		!challengeNoRatings && players.some((p) => p.comps !== undefined);
	if (showComps) {
		cols.push({
			title: "Comp",
			desc: "The real NBA player he plays like most, at about his age, from his ratings as your scouts see them. Hover for the top three and what they became.",
			sortType: "string",
		});
	}
	const showScouting =
		!challengeNoRatings &&
		!fantasyDraft &&
		players.some((p) => p.scoutReport !== undefined);
	if (showScouting) {
		cols.push({
			title: "Scout report",
			desc: "Ovr and pot ranges from your scouts, with their confidence. Assign a scout (1 point) or attend a workout (3 points) to narrow them. Scouting notes are on each player's page.",
			sortType: "number",
		});
	}
	// Pre-Draft Injuries & Combine Medicals: once the class's combine was held
	const showMedical = players.some((p) => p.medical !== undefined);
	if (showMedical) {
		cols.push({
			title: "Med",
			desc: `${MEDICAL_EXPLANATION} Only prospects invited to the combine have one.`,
			sortType: "number",
			sortSequence: ["desc", "asc"],
		});
	}
	// Scout Consensus & Flags
	const showRoom = !fantasyDraft && players.some((p) => p.room !== undefined);
	if (showRoom) {
		cols.push(
			{
				title: "Scouts",
				desc: "Your scouts' consensus (where the average of their grades slots him in this class) and how much they disagree: Agree, Mixed or Split (a wide split means less is known about him). * marks an outlier. Hover for details, each scout's grade is on his Scouting page.",
				sortType: "number",
			},
			{
				title: "Flags",
				desc: "Red and green flags from his traits, pre-draft record and ratings. Hover to read them. Hidden traits only show up as unconfirmed hints.",
				sortType: "number",
				sortSequence: ["desc", "asc"],
			},
		);
	}
	if (showTraits) {
		if (traitColumn) {
			// One trait as a sortable number, instead of the badges
			cols.push(...getCols([`trait:${traitColumn}`]));
		} else {
			cols.push({
				title: "Traits",
				desc: "Notable player traits as far as your scouts can tell. A ? means an estimate, see the player page for the range.",
				sortType: "number",
				sortSequence: ["desc", "asc"],
			});
		}
	}

	// Age-adjusted production from his pre-draft stats (basketball)
	const showProduction = players.some((p) => p.production !== undefined);
	if (showProduction) {
		cols.push({
			title: "AgeProd",
			desc: "Age-adjusted production: schedule-adjusted game score per 40 minutes of his last two pre-draft seasons, plus 1.8 for each year he was younger than 20.5. A 19-year-old's numbers count more than a 22-year-old's.",
			sortType: "number",
			sortSequence: ["desc", "asc"],
		});
	}

	const rows: DataTableRow<"player">[] = players.map((p) => {
		return {
			key: p.pid,
			metadata: {
				type: "player",
				pid: p.pid,
				season,
				playoffs: "regularSeason",
			},
			data: [
				p.rank,
				wrappedPlayerNameLabels({
					pid: p.pid,
					season,
					skills: p.skills,
					badges: p.badges,
					defaultWatch: p.watch,
					firstName: p.firstNameShort,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
				}),
				p.pos,
				p.age,
				!challengeNoRatings ? p.ovr : null,
				!challengeNoRatings ? p.pot : null,
				...(showExpanded
					? EXPANDED_RATINGS.map((key) => p.expanded?.[key] ?? null)
					: []),
				...(showSchool ? [p.linkedSchool ?? ""] : []),
				...(showArchetype ? [p.archetype ?? ""] : []),
				...(showSubs
					? ([p.subHighlights?.best, p.subHighlights?.worst] as const).map(
							(h) =>
								h
									? {
											sortValue: h.off,
											searchValue: h.name,
											value: (
												<span className="text-nowrap">
													{h.name} {h.value}{" "}
													<span className="text-body-secondary">
														({h.off > 0 ? "+" : ""}
														{h.off})
													</span>
												</span>
											),
										}
									: null,
						)
					: []),
				...(showComps
					? [
							p.comps && p.comps.length > 0
								? {
										value: <RealCompCell comps={p.comps} />,
										searchValue: p.comps.map((c) => c.name).join(" "),
										sortValue: p.comps[0]!.name,
									}
								: null,
						]
					: []),
				...(showScouting && p.scoutReport
					? [
							{
								sortValue:
									p.scoutReport.numScouts + 3 * p.scoutReport.numWorkouts,
								value: (
									<ScoutCell
										pid={p.pid}
										report={p.scoutReport}
										remaining={scoutingRemaining}
									/>
								),
							},
						]
					: []),
				...(showMedical
					? [
							p.medical
								? {
										value: (
											<MedicalGrade
												grade={p.medical.grade}
												reason={p.medical.reason}
											/>
										),
										sortValue: MEDICAL_SORT[p.medical.grade],
										searchValue: p.medical.reason,
									}
								: null,
						]
					: []),
				...(showRoom
					? [
							{
								sortValue: roomSortValue(p.room),
								searchValue: p.room?.label ?? "",
								value: <RoomCell room={p.room} />,
							},
							{
								sortValue: flagsSortValue(p.room?.flags),
								searchValue: (p.room?.flags ?? []).map((f) => f.text).join(" "),
								value: <FlagsCell flags={p.room?.flags} />,
							},
						]
					: []),
				...(showTraits
					? [
							traitColumn
								? (() => {
										const t = p.traits?.find((t) => t.key === traitColumn);
										return t
											? {
													value: formatTraitReading(t),
													sortValue: t.estimate,
												}
											: null;
									})()
								: p.traits
									? {
											value: <TraitBadges traits={p.traits} max={1} />,
											sortValue: p.traits.reduce(
												(sum, t) => sum + Math.abs(t.estimate - 50),
												0,
											),
										}
									: null,
						]
					: []),
				...(showProduction
					? [p.production !== undefined ? p.production.toFixed(1) : null]
					: []),
			],
		};
	});

	return (
		<>
			<h2>{season}</h2>
			{shape ? <DraftClassShape shape={shape} /> : null}

			{fantasyDraft ? (
				<div className="mb-3 text-warning">
					You cannot import/export future draft classes during a fantasy draft
				</div>
			) : (
				<div className="d-flex flex-wrap gap-1 mb-3">
					<div className="btn-group me-auto">
						<button
							className="btn btn-light-bordered btn-xs"
							onClick={() => setShowImportForm((val) => !val)}
						>
							Import
						</button>
						{collegeStatsOn ? (
							<button
								className="btn btn-light-bordered btn-xs"
								onClick={() => setShowCollegeStats((val) => !val)}
							>
								College stats
							</button>
						) : null}
						<button
							className="btn btn-light-bordered btn-xs"
							disabled={status === "exporting" || status === "loading"}
							onClick={async () => {
								setStatus("exporting");

								const { filename, json } = await toWorker(
									"main",
									"exportDraftClass",
									{ season },
								);
								downloadFile(filename, json, "application/json");

								setStatus(undefined);
							}}
						>
							Export
						</button>
						{godMode ? (
							<button
								className="btn btn-outline-god-mode btn-xs"
								disabled={status === "exporting" || status === "loading"}
								onClick={async () => {
									setStatus("loading");

									await toWorker("main", "regenerateDraftClass", season);

									setStatus(undefined);
								}}
							>
								Regenerate
							</button>
						) : null}
					</div>
					{players.length > 1 ? (
						<a
							className="text-nowrap ms-auto"
							href={helpers.leagueUrl([
								"compare_players",
								players
									.slice(0, 5)
									.map((p) => `${p.pid}-${season}-r`)
									.join(","),
							])}
						>
							Compare top {Math.min(5, players.length)}{" "}
							{helpers.plural("prospect", players.length)}
						</a>
					) : null}
				</div>
			)}

			{showCollegeStats && collegeStatsOn && !fantasyDraft ? (
				<CollegeStats
					numPlayers={players.length}
					numWithCollegeStats={numWithCollegeStats}
					season={season}
				/>
			) : null}

			{showImportForm ? (
				<div>
					<p>
						To replace this draft class with players from a{" "}
						<a
							href={`https://${WEBSITE_ROOT}/manual/customization/draft-class/`}
							target="_blank"
						>
							custom draft class file
						</a>
						, select the file below.
					</p>
					<LeagueFileUpload
						disabled={status === "exporting"}
						includePlayersInBasicInfo
						onLoading={() => {
							setStatus("loading");
						}}
						onDone={async (output) => {
							if (output instanceof Error) {
								return;
							}

							await toWorker("main", "handleUploadedDraftClass", {
								uploadedFile: output.basicInfo,
								draftYear: season,
							});

							setShowImportForm(false);
							setStatus(undefined);
						}}
					/>
					<p />
				</div>
			) : null}

			{showTraits ? (
				<div className="mb-2">
					<select
						className="form-select form-select-sm w-auto"
						aria-label="Show trait column"
						value={traitColumn}
						onChange={(event) => {
							const value = event.target.value;
							setTraitColumn(isTraitKey(value) ? value : "");
						}}
					>
						<option value="">Trait column: none</option>
						{TRAIT_CATEGORIES.map((category) => (
							<optgroup key={category.key} label={category.name}>
								{category.traits.map((key) => (
									<option key={key} value={key}>
										{TRAIT_DEFINITIONS[key].name}
									</option>
								))}
							</optgroup>
						))}
					</select>
				</div>
			) : null}

			<DataTable
				cols={cols}
				defaultSort={[0, "asc"]}
				name={`DraftScouting:${offset}${showRoom ? ":room" : ""}${showTraits ? ":traits" : ""}${traitColumn ? ":col" : ""}`}
				rows={rows}
			/>
		</>
	);
};

export default DraftClass;
