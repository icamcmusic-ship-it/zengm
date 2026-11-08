import { useState } from "react";
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
import { TraitBadges } from "../../components/PlayerTraits/TraitBadges.tsx";
import {
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
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
}: {
	challengeNoRatings: boolean;
	fantasyDraft: boolean;
	godMode: boolean;
	numWithCollegeStats: number;
	offset: number;
	players: View<"draftScouting">["seasons"][0]["players"];
	season: number;
}) => {
	const [showImportForm, setShowImportForm] = useState(false);
	const [showCollegeStats, setShowCollegeStats] = useState(false);
	const [status, setStatus] = useState<"exporting" | "loading" | undefined>();

	// Only once some prospect has been through "Regenerate ratings"
	const showBuild =
		!challengeNoRatings && players.some((p) => p.build !== undefined);

	// Only when the Player Traits setting is on (basketball)
	const showTraits = !challengeNoRatings && players.some((p) => p.traits);
	const [traitColumn, setTraitColumn] = useState<TraitKey | "">("");

	const cols = getCols(["#", "Name", "Pos", "Age", "Ovr", "Pot"]);
	if (showBuild) {
		cols.push({
			title: "Build",
			desc: "Build (archetype) from Regenerate ratings",
			sortType: "string",
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
					defaultWatch: p.watch,
					firstName: p.firstNameShort,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
				}),
				p.pos,
				p.age,
				!challengeNoRatings ? p.ovr : null,
				!challengeNoRatings ? p.pot : null,
				...(showBuild ? [p.build ?? ""] : []),
				...(showTraits
					? [
							traitColumn
								? (() => {
										const t = p.traits?.find((t) => t.key === traitColumn);
										return t
											? {
													value: `${t.exact ? "" : "~"}${t.estimate}`,
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
						{__SPORT === "basketball" ? (
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

			{showCollegeStats && __SPORT === "basketball" && !fantasyDraft ? (
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
						{TRAIT_KEYS.map((key) => (
							<option key={key} value={key}>
								{TRAIT_DEFINITIONS[key].name}
							</option>
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
