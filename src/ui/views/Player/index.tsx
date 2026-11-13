import {
	SubRatingsToggle,
	subRatingCells,
	subRatingCols,
	useSubRatingsView,
} from "../../components/SubRatingsToggle.tsx";
import { DataTable } from "../../components/DataTable/index.tsx";
import { DownloadPlayerButton } from "../../components/DownloadPlayers.tsx";
import Injuries from "./Injuries.tsx";
import InjuryHealth from "./InjuryHealth.tsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { SeasonIcons } from "../../components/SeasonIcons.tsx";
import TopStuff from "./TopStuff.tsx";
import { ContractMood } from "./ContractMood.tsx";
import { PlayerTraitsSummary } from "./Traits.tsx";
import { wrappedSalaryPayers } from "./SalaryPayers.tsx";
import { PLAYER } from "../../../common/constants.ts";
import { ProProjectionSection } from "../../components/ProProjection.tsx";
import { FaceHistory } from "./FaceHistory.tsx";
import HideableSection from "../../components/HideableSection.tsx";
import { StatsTable } from "./StatsTable.tsx";
import {
	getProfileDropdownOptions,
	getProfileUrl,
	highlightLeaderText,
	MaybeBold,
	SeasonLink,
} from "./common.tsx";
import { wrappedTeamAbbrevLink } from "../../components/TeamAbbrevLink.tsx";
import { wrappedCurrency } from "../../components/wrappedCurrency.ts";
import { groupAwards } from "../../util/groupAwards.ts";
import { InjuryIcon } from "../../components/InjuryIcon.tsx";
import { SkillsBlock } from "../../components/SkillsBlock.tsx";
import { SafeHtml } from "../../components/SafeHtml.tsx";
import { useLocal } from "../../util/local.ts";
import { wrappedSeasonAwards } from "./SeasonAwards.tsx";
import { last, orderBy } from "../../../common/utils.ts";
import { PreDraftSummary } from "./PreDraftSummary.tsx";
import { NitStats } from "./NitStats.tsx";
import {
	ScoutingSummaryLine,
	useScoutingOn,
} from "../../components/ScoutingReport/index.tsx";

const Player2 = ({
	bestPos,
	customMenu,
	events,
	faceHistory,
	feats,
	jerseyNumberInfos,
	leaders,
	player,
	playerTraits,
	randomDebutsForeverPids,
	ratings,
	retired,
	statTables,
	statSummary,
	teamColors,
	teamJersey,
	teamName,
	teamURL,
	valueIndex,
	willingToSign,
}: View<"player">) => {
	const { challengeNoRatings, season: currentSeason } = useLocal([
		"challengeNoRatings",
		"season",
	]);
	const showRatings = !challengeNoRatings || retired;
	// Sub-ratings in the ratings history (an optional view; rows that kept them, the last few seasons)
	const subView = useSubRatingsView("player");
	const traitsOn = useLocal(["playerTraits"]).playerTraits;
	const scoutingOn = useScoutingOn();
	const profileOptions = getProfileDropdownOptions(
		player,
		!!traitsOn,
		scoutingOn,
	);
	useTitleBar({
		title: player.name,
		customMenu,
		dropdown: profileOptions
			? {
					fields: [
						{
							key: "profile",
							options: profileOptions,
							value: "overview",
						},
					],
					urlOverride: ({ profile }) => {
						let gameLogSeason;
						if (player.stats.length > 0) {
							gameLogSeason = player.stats.at(-1)!.season;
						} else if (player.ratings.length > 0) {
							gameLogSeason = last(player.ratings).season;
						} else {
							gameLogSeason = currentSeason;
						}

						return getProfileUrl(String(profile), player.pid, gameLogSeason);
					},
				}
			: undefined,
	});

	const awardsGrouped = groupAwards(player.awards);

	let hasLeader = false;
	for (const row of Object.values(leaders)) {
		if (row && (row.attrs.has("age") || row.ratings.size > 0)) {
			hasLeader = true;
			break;
		}
	}

	const awardsBySeason = Map.groupBy(
		orderBy(
			player.awards.filter(
				(award) => award.type === undefined || award.type === "All-Star",
			),
			(award) => (award.type === undefined ? 0 : 1),
		),
		(award) => award.season,
	);

	return (
		<>
			<TopStuff
				bestPos={bestPos}
				currentSeason={currentSeason}
				jerseyNumberInfos={jerseyNumberInfos}
				player={player}
				randomDebutsForeverPids={randomDebutsForeverPids}
				retired={retired}
				showRatings={showRatings}
				statSummary={statSummary}
				teamColors={teamColors}
				teamJersey={teamJersey}
				teamName={teamName}
				teamURL={teamURL}
				willingToSign={willingToSign}
			/>

			<DownloadPlayerButton name={player.name} pid={player.pid} />

			{!retired ? <ContractMood pid={player.pid} refreshKey={player} /> : null}

			<PreDraftSummary player={player} />

			{player.tid === PLAYER.UNDRAFTED ? (
				<ProProjectionSection pid={player.pid} />
			) : null}

			{statTables.map(({ name, onlyShowIf, stats, superCols }) => (
				<StatsTable
					awardsBySeason={awardsBySeason}
					key={name}
					name={name}
					onlyShowIf={onlyShowIf}
					stats={stats}
					superCols={superCols}
					p={player}
					leaders={leaders}
				/>
			))}

			<NitStats player={player} />

			<HideableSection
				title="Ratings"
				description={hasLeader && showRatings ? highlightLeaderText : null}
			>
				<DataTable
					className="mb-3 datatable-negative-margin-top"
					cols={getCols([
						"Year",
						"Team",
						"Age",
						"Pos",
						"Ovr",
						"Pot",
						...ratings.map((rating) => `rating:${rating}`),
						...(subView.show ? subRatingCols() : []),
						"Skills",
						"Awards",
					])}
					defaultSort={[0, "asc"]}
					defaultStickyCols={2}
					hideAllControls
					name={subView.show ? "Player:RatingsSub" : "Player:Ratings"}
					rows={player.ratings.map((r, i) => {
						return {
							key: i,
							data: [
								{
									searchValue: r.season,
									sortValue: i,
									value: (
										<>
											<SeasonLink pid={player.pid} season={r.season} />{" "}
											<SeasonIcons season={r.season} awards={player.awards} />
											{r.injuryIndex !== undefined &&
											player.injuries[r.injuryIndex] ? (
												<InjuryIcon
													injury={{
														type: player.injuries[r.injuryIndex]!.type,
														gamesRemaining: -1,
													}}
												/>
											) : null}
										</>
									),
								},
								wrappedTeamAbbrevLink({
									abbrev: r.abbrev,
									season: r.season,
									tid: r.tid,
								}),
								<MaybeBold bold={leaders[r.season]?.attrs.has("age")}>
									{r.age}
								</MaybeBold>,
								r.pos,
								showRatings ? (
									<MaybeBold bold={leaders[r.season]?.ratings.has("ovr")}>
										{r.ovr}
									</MaybeBold>
								) : null,
								showRatings ? (
									<MaybeBold bold={leaders[r.season]?.ratings.has("pot")}>
										{r.pot}
									</MaybeBold>
								) : null,
								...ratings.map((rating) =>
									showRatings ? (
										<MaybeBold bold={leaders[r.season]?.ratings.has(rating)}>
											{r[rating]}
										</MaybeBold>
									) : null,
								),
								...(subView.show
									? subRatingCells((r as any).sub, showRatings)
									: []),
								<SkillsBlock
									className="skills-alone"
									skills={r.skills}
									badges={r.badges}
									sub={showRatings ? (r as any).sub : undefined}
								/>,
								wrappedSeasonAwards({
									awards: awardsBySeason.get(r.season),
									season: r.season,
								}),
							],
						};
					})}
				/>
				{showRatings ? <SubRatingsToggle view={subView} /> : null}
			</HideableSection>

			{playerTraits && showRatings ? (
				<PlayerTraitsSummary pid={player.pid} playerTraits={playerTraits} />
			) : null}

			{scoutingOn ? <ScoutingSummaryLine pid={player.pid} /> : null}

			<FaceHistory
				bornYear={player.born.year}
				colors={teamColors}
				faceHistory={faceHistory}
				jersey={teamJersey}
			/>

			<div className="row">
				<div className="col-6 col-md-3">
					<HideableSection title="Awards">
						{awardsGrouped.length > 0 ? (
							<table className="table table-nonfluid table-striped table-borderless table-sm player-awards">
								<tbody>
									{awardsGrouped.map((a, i) => {
										return (
											<tr key={i}>
												<td>
													{a.count > 1 ? `${a.count}x ` : null}
													{a.type} ({Object.values(a.seasons).flat().join(", ")}
													)
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						) : null}
						{awardsGrouped.length === 0 ? <p>None</p> : null}
					</HideableSection>
				</div>
				<div className="col-6 col-md-3">
					<HideableSection title="Salaries">
						<DataTable
							className="datatable-negative-margin-top mb-3"
							cols={getCols([
								"Year",
								"Team",
								"Amount",
								...(valueIndex && Object.keys(valueIndex).length > 0
									? [
											{
												title: "Value",
												desc: "Value index: win shares per dollar against the league rate that season (100 = average). See Contract Value",
												sortType: "number" as const,
											},
										]
									: []),
							])}
							defaultSort={[0, "asc"]}
							footer={{
								data: [
									"Total",
									null,
									helpers.formatCurrency(player.salariesTotal, "M"),
									...(valueIndex && Object.keys(valueIndex).length > 0
										? [null]
										: []),
								],
							}}
							hideAllControls
							name="Player:Salaries"
							rows={player.salaries.map((s, i) => {
								return {
									key: i,
									data: [
										{
											searchValue: s.season,
											sortValue: i,
											value: (
												<>
													<SeasonLink pid={player.pid} season={s.season} />{" "}
													<SeasonIcons
														season={s.season}
														awards={player.awards}
													/>
												</>
											),
										},
										wrappedSalaryPayers(s),
										wrappedCurrency(s.amount, "M"),
										...(valueIndex && Object.keys(valueIndex).length > 0
											? [
													valueIndex[s.season] !== undefined ? (
														<a
															href={helpers.leagueUrl([
																"contract_value",
																"seasons",
																"all",
																s.season,
															])}
															className={
																valueIndex[s.season]! >= 1
																	? "text-success"
																	: "text-danger"
															}
														>
															{Math.round(valueIndex[s.season]! * 100)}
														</a>
													) : null,
												]
											: []),
									],
									classNames:
										s.type === "current"
											? "fw-bold"
											: s.type === "future"
												? "fst-italic"
												: undefined,
								};
							})}
						/>
					</HideableSection>
				</div>
				<div className="col-md-6">
					<HideableSection title="Statistical Feats">
						<div
							className="small-scrollbar"
							style={{
								maxHeight: 500,
								overflowY: "auto",
							}}
						>
							{feats.map((e) => {
								return (
									<p key={e.eid}>
										<b>{e.season}</b>: <SafeHtml dirty={e.text} />
									</p>
								);
							})}
						</div>
						{feats.length === 0 ? <p>None</p> : null}
					</HideableSection>
				</div>
			</div>

			<div className="row" style={{ marginBottom: "-1rem" }}>
				<div className="col-md-6 col-lg-4">
					<HideableSection title="Injuries">
						<Injuries injuries={player.injuries} showRatings={showRatings} />
						<InjuryHealth info={player.healthInfo} pid={player.pid} />
					</HideableSection>
				</div>
				<div className="col-md-6 col-lg-8">
					<HideableSection title="Transactions">
						{events.map((e) => {
							return (
								<p key={e.eid}>
									<b>{e.season}</b>: <SafeHtml dirty={e.text} />
								</p>
							);
						})}
						{events.length === 0 ? <p>None</p> : null}
					</HideableSection>
				</div>
			</div>
		</>
	);
};

export default Player2;
