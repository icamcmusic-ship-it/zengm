import { DataTable } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import type { View } from "../../common/types.ts";
import { PLAYER } from "../../common/constants.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";
import { wrappedCheckmarkOrCross } from "../components/CheckmarkOrCross.tsx";
import { useLocal } from "../util/local.ts";
import {
	gameTimeStatus,
	injuryEstimateRange,
	injuryOutlookText,
} from "../../common/injuryOutlook.ts";

const Injuries = ({ injuries, season, stats, team }: View<"injuries">) => {
	useTitleBar({
		title: "Injuries",
		dropdown: {
			fields: [
				{
					key: "team",
					options: {
						type: "teams",
						all: true,
						remainingPlayoffTeams: true,
						watch: true,
					},
					value: team,
				},
				{
					key: "season",
					options: { type: "seasons", current: true },
					value: season,
				},
			],
			view: "injuries",
		},
	});

	const {
		challengeNoRatings,
		godMode,
		season: currentSeason,
		userTid,
	} = useLocal(["challengeNoRatings", "godMode", "season", "userTid"]);

	const current = season === "current";

	const cols = getCols([
		"Name",
		"Pos",
		"Team",
		"Age",
		"Ovr",
		"Pot",
		...stats.map((stat) => `stat:${stat}`),
		"TypeInjury",
		"Games",
		"Games Missed",
		...(current ? ["Expected Return", "Playing Through?"] : []),
		"Ovr Drop",
		"Pot Drop",
	]);

	const numericSeason = typeof season === "number" ? season : currentSeason;

	const rows: DataTableRow<"player">[] = injuries.map((p, i) => {
		const showRatings = !challengeNoRatings || p.tid === PLAYER.RETIRED;

		return {
			key: season === "current" ? p.pid : i,
			metadata: {
				type: "player",
				pid: p.pid,
				season: numericSeason,
				playoffs: "regularSeason",
			},
			data: [
				wrappedPlayerNameLabels({
					pid: p.pid,
					season: typeof season === "number" ? season : undefined,
					skills: p.ratings.skills,
					badges: p.ratings.badges,
					defaultWatch: p.watch,
					firstName: p.firstName,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
					awards: p.awards,
					awardsSeason: numericSeason,
				}),
				p.ratings.pos,
				<a
					href={helpers.leagueUrl([
						"roster",
						`${p.stats.abbrev}_${p.stats.tid}`,
						season,
					])}
				>
					{p.stats.abbrev}
				</a>,
				p.age,
				showRatings ? p.ratings.ovr : null,
				showRatings ? p.ratings.pot : null,
				...stats.map((stat) => helpers.roundStat(p.stats[stat], stat)),
				{
					value: (
						<>
							{p.type}
							{p.treatment || p.aggravated ? (
								<span className="text-body-secondary">
									{" "}
									(
									{[
										p.treatment,
										p.aggravated
											? `re-aggravated${p.aggravated > 1 ? ` ${p.aggravated}x` : ""}`
											: undefined,
									]
										.filter(Boolean)
										.join(", ")}
									)
								</span>
							) : null}
						</>
					),
					searchValue: p.type,
					sortValue: p.type,
				},
				// Current injuries: the medical staff's outlook (common/injuryOutlook.ts), exact in God Mode. Past ones: the recorded length
				p.outlook
					? {
							value: (
								<>
									{injuryOutlookText(p.outlook)}
									{godMode &&
									(gameTimeStatus(p.outlook) ||
										injuryEstimateRange(p.outlook)) ? (
										<span className="text-body-secondary"> ({p.games})</span>
									) : null}
								</>
							),
							sortValue: p.games,
						}
					: p.games,
				p.missed,
				...(current
					? [
							{
								value: p.returnDay === undefined ? null : `Day ${p.returnDay}`,
								sortValue: p.returnDay ?? Infinity,
							},
							wrappedCheckmarkOrCross({
								hideCross: true,
								success: p.playingThrough,
							}),
						]
					: []),
				showRatings ? p.ovrDrop : null,
				showRatings ? p.potDrop : null,
			],
			classNames: {
				"table-danger": p.hof,
				"table-info": p.stats.tid === userTid,
			},
		};
	});

	return (
		<>
			<p>
				Players on your team are{" "}
				<span className="text-info">highlighted in blue</span>. Players in the
				Hall of Fame are <span className="text-danger">highlighted in red</span>
				.
			</p>
			{current ? (
				<p>
					Current injuries show the medical staff's estimate: a range for longer
					injuries (narrower with a bigger health budget), and questionable
					(plays half the time), doubtful (a quarter) or out for players a few
					games away. <i>Missed</i> is games his team has played without him.
				</p>
			) : null}

			{rows.length > 0 ? (
				<DataTable
					cols={cols}
					defaultSort={[cols.findIndex((col) => col.title === "Games"), "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="Injuries"
					pagination
					rows={rows}
				/>
			) : (
				<p>No injured players found.</p>
			)}
		</>
	);
};

export default Injuries;
