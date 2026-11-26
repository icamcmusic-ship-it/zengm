import { MoreLinks } from "../components/MoreLinks.tsx";
import { RetiredPlayers } from "../components/RetiredPlayers.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { useLocal } from "../util/local.ts";
import { helpers } from "../util/helpers.ts";
import React from "react";
import { showStatsByType } from "../../common/awards.ts";
import { getCol } from "../../common/getCol.ts";
import {
	keyStatTitle,
	type AwardKeyStats,
} from "../components/AwardKeyStats.tsx";
import {
	AwardStatPicker,
	useAwardStatCols,
} from "../components/AwardStatCols.tsx";

type ActualProps = Exclude<
	View<"history">,
	{ invalidSeason: true; season: number }
>;

const NO_WINNER = "No winner";

type AnyAward =
	| ActualProps["awards"]["individualAwards"][number]
	| ActualProps["awards"]["teamAwards"][number];

const awardKeyStats = (award: AnyAward) =>
	(award as { keyStats?: AwardKeyStats }).keyStats;

// The Columns menu alone (playoff awards, which have no heading)
const AwardStatPickerFor = ({ award }: { award: AnyAward }) => {
	const keyStats = awardKeyStats(award);
	const statCols = useAwardStatCols(award.shortName, keyStats);
	return <AwardStatPicker keyStats={keyStats} statCols={statCols} />;
};

// An award's heading with its Columns menu: pick the stats the recap shows for its winners. The choice is the award's statCols
// setting, shared with Award Races, Award History and Award Settings
const AwardHeading = ({
	award,
	children,
}: {
	award: AnyAward;
	children: React.ReactNode;
}) => {
	const keyStats = awardKeyStats(award);
	const statCols = useAwardStatCols(award.shortName, keyStats);
	return (
		<h2 className="d-flex align-items-center gap-2">
			<span>{children}</span>
			<span className="fs-6 fw-normal">
				<AwardStatPicker keyStats={keyStats} statCols={statCols} />
			</span>
		</h2>
	);
};

const Winner = ({
	award,
	indentStats,
	p,
	season,
	userTid,
}: {
	award: AnyAward;
	indentStats?: boolean;
	p:
		| ActualProps["awards"]["individualAwards"][number]["winner"]
		| { pid?: undefined; pos?: string };
	season: number;
	userTid: number;
}) => {
	const fixedStats = showStatsByType[award.showStats];
	if (!fixedStats) {
		throw new Error("Invalid showStats");
	}
	// Award key stats: the award's chosen columns (its statCols setting), or the ones its formula suggests, as on Award Races and
	// Award History
	// (a change in a Columns menu shows right away)
	const keyStats = awardKeyStats(award);
	const statCols = useAwardStatCols(award.shortName, keyStats);
	const stats: string[] =
		keyStats && statCols.stats.length > 0 ? statCols.stats : fixedStats;

	if (!p) {
		return null;
	}

	if (p.pid === undefined) {
		return (
			<div>
				{p.pos} {NO_WINNER}
				<br />
				<br />
			</div>
		);
	}

	return (
		<>
			<div>
				<span className={p.stats.tid === userTid ? "table-info" : undefined}>
					{p.pos}{" "}
					<b>
						<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
					</b>{" "}
					(
					<a
						href={helpers.leagueUrl([
							"roster",
							`${p.stats.abbrev}_${p.stats.tid}`,
							season,
						])}
					>
						{p.stats.abbrev}
					</a>
					)
				</span>
			</div>
			<div className={indentStats ? "ms-3" : undefined}>
				{stats
					.filter(
						(stat) =>
							(p.statOverrides as Record<string, unknown> | undefined)?.[
								stat
							] !== undefined ||
							(p.stats as Record<string, unknown>)[stat] !== undefined,
					)
					.map((stat) => {
						const value =
							(p.statOverrides as Record<string, unknown> | undefined)?.[
								stat
							] ?? (p.stats as Record<string, unknown>)[stat];
						const shown =
							typeof value === "number"
								? helpers.roundStat(value, stat)
								: String(value);
						if (stat === "keyStats") {
							return shown;
						}
						return `${shown} ${keyStats ? keyStatTitle(stat, keyStats) : getCol(`stat:${stat}`).title}`;
					})
					.join(", ")}
			</div>
		</>
	);
};

const Teams = ({
	award,
	season,
	userTid,
}: {
	award: ActualProps["awards"]["teamAwards"][number];
	season: number;
	userTid: number;
}) => {
	const multipleTeams = award.winner.length > 1;

	return (
		<>
			{multipleTeams ? (
				<AwardHeading award={award}>{award.name}</AwardHeading>
			) : null}
			{award.winner.map((t, i) => {
				if (t.length === 0) {
					return null;
				}

				return (
					<div key={i} className="mb-3">
						{multipleTeams ? (
							<h3>{helpers.ordinal(i + 1)} team</h3>
						) : (
							<AwardHeading award={award}>{award.name} team</AwardHeading>
						)}
						{t.map((p, i) => {
							return (
								<div key={i}>
									{p ? (
										<Winner
											award={award}
											indentStats
											p={p}
											season={season}
											userTid={userTid}
										/>
									) : null}
								</div>
							);
						})}
					</div>
				);
			})}
		</>
	);
};

const splitTeamAwards = <T extends { numTeams: number }>(teamAwards: T[]) => {
	let sum = 0;
	for (const row of teamAwards) {
		sum += row.numTeams;
	}
	const target = Math.ceil(sum);
	const teamAwards1: T[] = [];
	const teamAwards2: T[] = [];

	let sum2 = 0;
	for (const row of teamAwards) {
		sum2 += row.numTeams;
		if (teamAwards1.length === 0 || sum2 <= target / 2) {
			teamAwards1.push(row);
		} else {
			teamAwards2.push(row);
		}
	}

	return { teamAwards1, teamAwards2 };
};

const History = (props: View<"history">) => {
	const { invalidSeason, season } = props;

	useTitleBar({
		title: "Season Summary",
		jumpTo: true,
		jumpToSeason: season,
		dropdown: {
			fields: [
				{
					key: "season",
					options: { type: "seasons", completedOnly: true },
					value: season,
				},
			],
			view: "history",
		},
	});
	const { userTid } = useLocal(["userTid"]);

	if (invalidSeason) {
		return (
			<>
				<h2>Error</h2>
				<p>Invalid season.</p>
			</>
		);
	}

	const {
		awards,
		champ,
		coachExecAwards,
		college,
		confs,
		retiredPlayers,
		retiredStat,
	} = props;

	const { teamAwards1, teamAwards2 } = splitTeamAwards(awards.teamAwards);

	const groupedIndividualAwardsPlayoffs = Object.values(
		Object.groupBy(awards.individualAwardsPlayoffs, (award) => award.shortName),
	);

	const bestRecordConfs = Array.from(awards.bestRecordConfs.entries());

	return (
		<>
			<MoreLinks type="awards" page="history" season={season} />

			<div className="row">
				<div className="col-md-3 col-sm-4 col-12">
					<div className="row">
						<div className="col-sm-12 col-6">
							<h2>{college ? "National Champions" : "League Champs"}</h2>
							{champ ? (
								<div>
									<div className="mb-3">
										<span
											className={
												champ.tid === userTid ? "table-info" : undefined
											}
										>
											<b>
												<a
													href={helpers.leagueUrl([
														"roster",
														`${champ.seasonAttrs.abbrev}_${champ.tid}`,
														season,
													])}
												>
													{champ.seasonAttrs.region} {champ.seasonAttrs.name}
												</a>
											</b>
										</span>
										<br />
										<a href={helpers.leagueUrl(["playoffs", season])}>
											{college ? "Tournament bracket" : "Playoff bracket"}
										</a>
									</div>
									{groupedIndividualAwardsPlayoffs.map((groupedAwards, i) => {
										const firstAward = groupedAwards?.[0];
										if (!firstAward) {
											return;
										}
										return (
											<React.Fragment key={i}>
												<div className="mb-3">
													{helpers.plural(
														firstAward.name,
														groupedAwards.length,
													)}
													: <AwardStatPickerFor award={firstAward} />
													{groupedAwards.map((award, i) => {
														return award.winner ? (
															<Winner
																key={i}
																award={award}
																p={award.winner}
																season={awards.season}
																userTid={userTid}
															/>
														) : (
															NO_WINNER
														);
													})}
												</div>
											</React.Fragment>
										);
									})}
								</div>
							) : (
								<div className="mb-3">{NO_WINNER}</div>
							)}
							<h2>{college ? "Regular Season Champions" : "Best Record"}</h2>
							{bestRecordConfs.map(([cid, t]) =>
								t ? (
									<div key={cid} className="mb-3">
										{bestRecordConfs.length === 1 ? null : (
											<div>{confs[cid]?.name}:</div>
										)}
										<span
											className={t.tid === userTid ? "table-info" : undefined}
										>
											<a
												href={helpers.leagueUrl([
													"roster",
													`${t.seasonAttrs.abbrev}_${t.tid}`,
													season,
												])}
											>
												{t.seasonAttrs.region} {t.seasonAttrs.name}
											</a>{" "}
											({helpers.formatRecord(t.seasonAttrs)})
										</span>
										<br />
									</div>
								) : null,
							)}
						</div>
						<div className="col-sm-12 col-6">
							{college ? (
								<>
									{college.nitChampion ? (
										<>
											<h2>NIT Champion</h2>
											<div
												className={`mb-3${college.nitChampion.tid === userTid ? " table-info" : ""}`}
											>
												<a
													href={helpers.leagueUrl([
														"roster",
														`${college.nitChampion.abbrev}_${college.nitChampion.tid}`,
														season,
													])}
												>
													{college.nitChampion.region}
												</a>{" "}
												(
												<a href={helpers.leagueUrl(["college_nit", season])}>
													bracket
												</a>
												)
											</div>
										</>
									) : null}
								</>
							) : null}
							{awards.individualAwards.map((award, i) => {
								return (
									<React.Fragment key={i}>
										<AwardHeading award={award}>{award.name}</AwardHeading>
										<div className="mb-3">
											{award.winner ? (
												<Winner
													award={award}
													p={award.winner}
													season={awards.season}
													userTid={userTid}
												/>
											) : (
												NO_WINNER
											)}
										</div>
									</React.Fragment>
								);
							})}
							{coachExecAwards.showCoy ? (
								<>
									<h2>Coach of the Year</h2>
									<div className="mb-3">
										{coachExecAwards.coy ? (
											<span
												className={
													coachExecAwards.coy.tid === userTid
														? "table-info"
														: undefined
												}
											>
												<a
													href={helpers.leagueUrl([
														"coach",
														coachExecAwards.coy.cid,
													])}
												>
													{coachExecAwards.coy.name}
												</a>{" "}
												(
												<a
													href={helpers.leagueUrl([
														"roster",
														`${coachExecAwards.coy.abbrev}_${coachExecAwards.coy.tid}`,
														season,
													])}
												>
													{coachExecAwards.coy.region}
												</a>
												)
											</span>
										) : (
											NO_WINNER
										)}
									</div>
								</>
							) : null}
							{coachExecAwards.showEoy ? (
								<>
									<h2>Executive of the Year</h2>
									<div className="mb-3">
										{coachExecAwards.eoy ? (
											<span
												className={
													coachExecAwards.eoy.user ||
													coachExecAwards.eoy.tid === userTid
														? "table-info"
														: undefined
												}
											>
												{coachExecAwards.eoy.gmid !== undefined ? (
													<a href={helpers.leagueUrl(["front_offices"])}>
														{coachExecAwards.eoy.name}
													</a>
												) : (
													coachExecAwards.eoy.name
												)}{" "}
												(
												<a
													href={helpers.leagueUrl([
														"roster",
														`${coachExecAwards.eoy.abbrev}_${coachExecAwards.eoy.tid}`,
														season,
													])}
												>
													{coachExecAwards.eoy.region}
												</a>
												)
											</span>
										) : (
											NO_WINNER
										)}
									</div>
								</>
							) : null}
						</div>
					</div>
				</div>
				<div className="col-xl-2 col-md-3 col-sm-4 col-6">
					{teamAwards1.map((award, i) => {
						return (
							<Teams
								key={i}
								award={award}
								season={awards.season}
								userTid={userTid}
							/>
						);
					})}
				</div>
				<div className="col-xl-2 col-md-3 col-sm-4 col-6">
					{teamAwards2.map((award, i) => {
						return (
							<Teams
								key={i}
								award={award}
								season={awards.season}
								userTid={userTid}
							/>
						);
					})}
				</div>
				<div className="col-xl-5 col-md-3 col-sm-12">
					<RetiredPlayers
						retiredPlayers={retiredPlayers}
						retiredStat={retiredStat}
						season={season}
						userTid={userTid}
					/>
				</div>
			</div>
		</>
	);
};

export default History;
