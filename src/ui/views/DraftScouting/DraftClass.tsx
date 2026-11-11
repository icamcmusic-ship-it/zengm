import { useState } from "react";
import { DraftClassShape } from "../../components/DraftClassShape.tsx";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";
import { useFeatureOn } from "../../util/nativeFeatures.ts";
import { DataTable } from "../../components/DataTable/index.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { WEBSITE_ROOT } from "../../../common/constants.ts";
import { wrappedPlayerNameLabels } from "../../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../../components/DataTable/index.tsx";
import { downloadFile } from "../../util/downloadFile.ts";
import { LeagueFileUpload } from "../../components/LeagueFileUpload.tsx";
import { CollegeStats } from "./CollegeStats.tsx";
import { showNotification } from "../../util/showNotification.ts";

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
		<span className="text-nowrap" title={report.notes.join("\n")}>
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

	const cols = getCols([
		"#",
		"Name",
		"Pos",
		"Age",
		"Ovr",
		"Pot",
		...(showExpanded ? EXPANDED_RATINGS.map((key) => `rating:${key}`) : []),
	]);
	if (showArchetype) {
		cols.push({
			title: "Archetype",
			desc: "Archetype derived from the prospect's ratings",
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
			desc: "Ovr and pot ranges from your scouts, with their confidence. Assign a scout (1 point) or attend a workout (3 points) to narrow them. Hover for notes.",
			sortType: "number",
		});
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
				...(showArchetype ? [p.archetype ?? ""] : []),
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
				name={`DraftScouting:${offset}${showTraits ? ":traits" : ""}${traitColumn ? ":col" : ""}`}
				rows={rows}
			/>
		</>
	);
};

export default DraftClass;
