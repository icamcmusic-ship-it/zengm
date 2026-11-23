import { useState } from "react";
import { OverlayTrigger, Popover } from "react-bootstrap";
import { dropdownOptions } from "../hooks/useDropdownOptions.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import type { View } from "../../common/types.ts";
import { POSITIONS, RATINGS } from "../../common/constants.ts";
import { wrappedMovOrDiff } from "../components/MovOrDiff.tsx";
import { wrappedTeamLogoAndName } from "../components/TeamLogoAndName.tsx";
import { bySport } from "../../common/sportFunctions.ts";
import { useLocal } from "../util/local.ts";
import { getCol } from "../../common/getCol.ts";
import { formatOdds } from "../components/SeasonOdds.tsx";
import PowerRankingsChart, { RankChange } from "./PowerRankingsChart.tsx";

const Other = ({
	actualShowHealthy,
	current,
	healthy,
}: {
	actualShowHealthy: boolean;
	current: number;
	healthy: number;
}) => {
	if (actualShowHealthy || current === healthy) {
		return <>{healthy}</>;
	}

	return (
		<>
			<span className={healthy > current ? "text-success" : "text-danger"}>
				{current}
			</span>
		</>
	);
};

const signed = (x: number) =>
	`${x >= 0 ? "+" : "\u2212"}${Math.abs(x).toFixed(1)}`;

// What drives a team's rank: its score parts next to the league average, and the strength shared with the playoff and title odds
const RankWhy = ({
	challengeNoRatings,
	t,
}: {
	challengeNoRatings: boolean;
	t: View<"powerRankings">["teams"][number];
}) => {
	const why = t.powerRankings.why;
	const rank = (
		<>
			{t.powerRankings.rank}
			<RankChange change={t.rankChange} />
		</>
	);
	if (!why) {
		return rank;
	}
	const popover = (
		<Popover id={`power-why-${t.tid}`}>
			<Popover.Header as="h3">
				Why #{t.powerRankings.rank}: {t.seasonAttrs.abbrev}
			</Popover.Header>
			<Popover.Body>
				<p className="mb-2">{why.text}</p>
				{why.parts.length > 0 ? (
					<table className="table table-sm table-borderless mb-2">
						<tbody>
							{why.parts.map((part) => (
								<tr key={part.key}>
									<td className="ps-0">
										{helpers.upperCaseFirstLetter(part.label)}
									</td>
									<td
										className={`text-end pe-0 ${part.value >= 0 ? "text-success" : "text-danger"}`}
									>
										{signed(part.value)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : null}
				<div className="text-body-secondary small">
					Points of power score vs the league average.
					{!challengeNoRatings ? (
						<>
							{" "}
							Strength {signed(t.powerRankings.strength)} points per game, the
							same measure behind the playoff and title odds.
						</>
					) : null}
				</div>
			</Popover.Body>
		</Popover>
	);
	return (
		<OverlayTrigger
			trigger={["hover", "focus"]}
			placement="right"
			overlay={popover}
		>
			<button
				type="button"
				className="btn btn-link p-0 border-0 align-baseline text-reset"
				style={{ cursor: "help", textDecoration: "underline dotted" }}
			>
				{rank}
			</button>
		</OverlayTrigger>
	);
};

const PowerRankings = ({
	seasonOdds,
	confs,
	divs,
	playoffs,
	season,
	teams,
	ties,
	otl,
}: View<"powerRankings">) => {
	useTitleBar({
		title: "Power Rankings",
		dropdown: {
			view: "powerRankings",
			fields: [
				{ key: "season", options: { type: "seasons" }, value: season },
				...(__SPORT === "basketball"
					? [
							{
								key: "playoffs",
								options: dropdownOptions.playoffs,
								value: playoffs,
							} as const,
						]
					: []),
			],
		},
	});

	const {
		challengeNoRatings,
		season: currentSeason,
		userTid,
	} = useLocal(["challengeNoRatings", "season", "userTid"]);

	const [showHealthy, setShowHealthy] = useState(true);
	const actualShowHealthy = showHealthy || currentSeason !== season;

	const [allOtherKeys, otherKeysTitle, otherKeysPrefix] = bySport({
		baseball: [
			POSITIONS.filter((pos) => pos !== "DH"),
			"Position Ranks",
			"pos",
		],
		basketball: [RATINGS, "Rating Ranks", "rating"],
		football: [
			POSITIONS.filter((pos) => pos !== "KR" && pos !== "PR"),
			"Position Ranks",
			"pos",
		],
		hockey: [POSITIONS, "Position Ranks", "pos"],
	});

	// No Visible Ratings challenge: no rating/position rank columns, they'd leak the hidden ratings
	const otherKeys: string[] = challengeNoRatings ? [] : allOtherKeys;

	const superCols = [
		{
			title: "",
			colspan: 4,
		},
		{
			title: "Team Rating",
			colspan: 2,
		},
		{
			title: "",
			colspan: 5 + (ties ? 1 : 0) + (otl ? 1 : 0) + (seasonOdds ? 2 : 0),
		},
		{
			title: (
				<>
					{otherKeysTitle}
					{currentSeason === season ? (
						<button
							type="button"
							className="btn btn-link p-0 border-0 align-baseline fw-bold ms-2"
							onClick={() => {
								setShowHealthy((val) => !val);
							}}
						>
							{showHealthy ? "(Show with injuries)" : "(Show without injuries)"}
						</button>
					) : null}
				</>
			),
			colspan: otherKeys.length,
		},
	].filter((superCol) => superCol.colspan > 0);

	const colNames = [
		"#",
		"Team",
		"Conference",
		"Division",
		"Current",
		"Healthy",
		"W",
		"L",
		...(otl ? ["OTL"] : []),
		...(ties ? ["T"] : []),
		"L10",
		`stat:${__SPORT === "basketball" ? "mov" : "diff"}`,
		"AvgAge",
		...otherKeys.map((key) => `${otherKeysPrefix}:${key}`),
	];

	const cols = getCols(colNames);

	if (__SPORT === "basketball") {
		for (const [colName, col] of Iterator.zip([colNames, cols], {
			mode: "strict",
		})) {
			if (colName.startsWith("rating:")) {
				col.sortSequence = ["asc", "desc"];
			}
		}
	}

	// Monte Carlo odds, after AvgAge (see worker/core/seasonOdds)
	if (seasonOdds) {
		const index = colNames.indexOf("AvgAge") + 1;
		cols.splice(
			index,
			0,
			{
				...getCol("Win%", { desc: "Chance to make the playoffs" }),
				title: "Playoffs",
			},
			{
				...getCol("Win%", { desc: "Chance to win the title" }),
				title: "Title",
			},
		);
	}

	const rows = teams.map((t) => {
		const conf = confs.find((conf) => conf.cid === t.seasonAttrs.cid);
		const div = divs.find((div) => div.did === t.seasonAttrs.did);

		return {
			key: t.tid,
			data: [
				{
					value: <RankWhy challengeNoRatings={!!challengeNoRatings} t={t} />,
					sortValue: t.powerRankings.rank,
					searchValue: t.powerRankings.rank,
				},
				wrappedTeamLogoAndName(
					t,
					helpers.leagueUrl([
						"roster",
						`${t.seasonAttrs.abbrev}_${t.tid}`,
						season,
					]),
				),
				conf ? conf.name.replace(" Conference", "") : null,
				div ? div.name : null,
				!challengeNoRatings ? (
					t.powerRankings.ovr !== t.powerRankings.ovrCurrent ? (
						<span className="text-danger">{t.powerRankings.ovrCurrent}</span>
					) : (
						t.powerRankings.ovrCurrent
					)
				) : null,
				!challengeNoRatings ? t.powerRankings.ovr : null,
				t.seasonAttrs.won,
				t.seasonAttrs.lost,
				...(otl ? [t.seasonAttrs.otl] : []),
				...(ties ? [t.seasonAttrs.tied] : []),
				t.seasonAttrs.lastTen,
				wrappedMovOrDiff(
					__SPORT === "basketball"
						? {
								pts: t.stats.pts * t.stats.gp,
								oppPts: t.stats.oppPts * t.stats.gp,
								gp: t.stats.gp,
							}
						: t.stats,
					__SPORT === "basketball" ? "mov" : "diff",
				),
				t.powerRankings.avgAge?.toFixed(1),
				...(seasonOdds
					? [
							{
								value: formatOdds(seasonOdds[t.tid]?.playoffs ?? 0),
								sortValue: seasonOdds[t.tid]?.playoffs ?? 0,
							},
							{
								value: formatOdds(seasonOdds[t.tid]?.title ?? 0),
								sortValue: seasonOdds[t.tid]?.title ?? 0,
							},
						]
					: []),
				...otherKeys.map((key) => ({
					value: (
						<Other
							actualShowHealthy={actualShowHealthy}
							current={t.powerRankings.otherCurrent[key]!}
							healthy={t.powerRankings.other[key]!}
						/>
					),
					searchValue: actualShowHealthy
						? t.powerRankings.other[key]
						: t.powerRankings.otherCurrent[key],
					sortValue: actualShowHealthy
						? t.powerRankings.other[key]
						: t.powerRankings.otherCurrent[key],
				})),
			],
			classNames: {
				"table-info": t.tid === userTid,
			},
		};
	});

	return (
		<>
			<p>
				The power ranking is a combination of recent performance, margin of
				victory, and team rating. Team rating is based only on the ratings of
				players on each team. Margin and team rating are blended into one
				strength measure (margin counts more as games are played), the same one
				the playoff and title odds use. Hover a rank to see what drives it.
			</p>
			{playoffs === "playoffs" && __SPORT === "basketball" ? (
				<p>
					In the playoffs, rotations get shorter and players play harder, so
					some teams get higher or lower ratings.
				</p>
			) : null}

			<PowerRankingsChart teams={teams} userTid={userTid} />

			<DataTable
				cols={cols}
				defaultSort={[0, "asc"]}
				defaultStickyCols={2}
				name="PowerRankings"
				nonfluid
				rows={rows}
				superCols={superCols}
			/>
		</>
	);
};

export default PowerRankings;
