import { useState } from "react";
import clsx from "clsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import type { View } from "../../../common/types.ts";
import TopStuff from "../Player/TopStuff.tsx";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import { getCols } from "../../../common/getCols.ts";
import { DataTable } from "../../components/DataTable/index.tsx";
import HideableSection from "../../components/HideableSection.tsx";
import { CollegeSeasonSection } from "../Player/CollegeSeasonSection.tsx";
import { getProfileUrl, usePlayerProfileOptions } from "../Player/common.tsx";
import { last } from "../../../common/utils.ts";
import { SchoolBadge, Stars, StockChart } from "./parts.tsx";
import type { CombineResults } from "../../../common/collegeStats/profile.ts";

type PreDraft = NonNullable<View<"playerPreDraft">["preDraft"]>;

const STAT_TABS = ["Per Game", "Totals", "Advanced"] as const;

const StatsSection = ({ preDraft }: { preDraft: PreDraft }) => {
	const [tab, setTab] = useState<(typeof STAT_TABS)[number]>("Per Game");
	const table =
		tab === "Per Game"
			? preDraft.perGame
			: tab === "Totals"
				? preDraft.totals
				: preDraft.advanced;
	const stats =
		tab === "Advanced" ? preDraft.statsAdvanced : preDraft.statsPerGame;
	const statType = tab === "Totals" ? "totals" : undefined;
	const seasonsBySeason = new Map(preDraft.seasons.map((s) => [s.season, s]));

	if (table.rows.length === 0) {
		return null;
	}

	const cols = getCols([
		"Year",
		"Team",
		"Age",
		...stats.map((stat) => `stat:${stat}`),
	]);

	return (
		<HideableSection
			title="Stats"
			description="College, overseas and G League seasons before the draft. Not part of his pro career totals."
		>
			<DataTable
				className="mb-3"
				cols={cols}
				defaultSort={[0, "asc"]}
				defaultStickyCols={2}
				footer={
					table.career
						? {
								data: [
									"Career",
									null,
									null,
									...stats.map((stat) =>
										helpers.roundStat(
											table.career![stat],
											stat,
											statType === "totals",
										),
									),
								],
							}
						: undefined
				}
				hideAllControls
				name={`PlayerPreDraft:${tab}`}
				rows={table.rows.map((row, i) => {
					const info = seasonsBySeason.get(row.season);
					return {
						key: i,
						data: [
							{
								value: (
									<>
										{row.season}{" "}
										{info?.classYear ? (
											<span className="text-body-secondary">
												{info.classYear}
											</span>
										) : (
											<span className="badge text-bg-secondary fw-normal">
												{info?.label}
											</span>
										)}
									</>
								),
								sortValue: i,
								searchValue: row.season,
							},
							{
								value: (
									<span className="text-nowrap">
										<SchoolBadge name={info?.club ?? row.teamName} />{" "}
										{info?.club
											? `${info.club} (${info.leagueShort})`
											: row.teamName}
									</span>
								),
								sortValue: row.teamName,
								searchValue: row.teamName,
							},
							row.age,
							...stats.map((stat) =>
								helpers.roundStat(row[stat], stat, statType === "totals"),
							),
						],
					};
				})}
				title={
					<ul className="nav nav-tabs border-bottom-0">
						{STAT_TABS.map((t) => (
							<li className="nav-item" key={t}>
								<button
									className={clsx("nav-link", {
										active: tab === t,
										"border-bottom": tab === t,
									})}
									onClick={() => {
										setTab(t);
									}}
								>
									{t}
								</button>
							</li>
						))}
					</ul>
				}
			/>
		</HideableSection>
	);
};

const TeamsSection = ({ preDraft }: { preDraft: PreDraft }) => {
	if (preDraft.seasons.length === 0) {
		return null;
	}
	const estimated = preDraft.seasons.some((s) => s.record.estimated);
	const hasNotes = preDraft.seasons.some((s) => s.notes.length > 0);
	return (
		<HideableSection
			title="Teams"
			description={
				estimated
					? "* Record estimated: no college season was simulated that year."
					: undefined
			}
		>
			<div className="table-responsive">
				<table
					className="table table-striped table-borderless table-sm table-nonfluid"
					data-testid="pre-draft-teams"
				>
					<thead>
						<tr>
							<th>Year</th>
							<th>Team</th>
							<th>Conf / League</th>
							<th>Head coach</th>
							<th>Record</th>
							<th>Postseason</th>
							<th title="Games played">G</th>
							<th title="Games started">GS</th>
							{hasNotes ? <th>Notes</th> : null}
						</tr>
					</thead>
					<tbody>
						{preDraft.seasons.map((s) => (
							<tr key={s.season}>
								<td className="text-nowrap">
									{s.season} {s.classYear ?? null}
								</td>
								<td className="text-nowrap">
									<SchoolBadge name={s.club ?? s.teamName} />{" "}
									{s.club ?? s.teamName}
								</td>
								<td className="text-nowrap">
									{s.conference ?? s.league}
									{s.confRank ? (
										<span className="text-body-secondary">
											{" "}
											({helpers.ordinal(s.confRank.rank)} of {s.confRank.size})
										</span>
									) : null}
								</td>
								<td className="text-nowrap">
									{s.coach.name}{" "}
									<span className="text-body-secondary">
										(since {s.coach.since})
									</span>
								</td>
								<td className="text-nowrap">
									{s.record.w}-{s.record.l}
									{s.record.confW !== undefined
										? ` (${s.record.confW}-${s.record.confL})`
										: null}
									{s.record.estimated ? "*" : null}
									{s.apRank !== undefined ? `, AP #${s.apRank}` : null}
								</td>
								<td>{s.ncaa ?? null}</td>
								<td>{s.status === "redshirt" ? "-" : s.gp}</td>
								<td>{s.status === "redshirt" ? "-" : s.gs}</td>
								{hasNotes ? (
									<td className="text-nowrap">{s.notes.join("; ")}</td>
								) : null}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</HideableSection>
	);
};

const pct = (a: number, b: number) =>
	b > 0 ? `${((100 * a) / b).toFixed(1)}` : "-";
const perGame = (x: number, gp: number) => (gp > 0 ? (x / gp).toFixed(1) : "-");

const SplitsSection = ({ preDraft }: { preDraft: PreDraft }) => {
	if (preDraft.splits.length === 0) {
		return null;
	}
	const estimated = preDraft.splits.some((row) => row.estimated);
	return (
		<HideableSection
			title={`${preDraft.summary?.season} splits`}
			description={
				estimated
					? "* Split estimated from his season totals and his team's schedule (stats generated before splits were kept)."
					: "Per game, by part of the season."
			}
		>
			<div className="table-responsive">
				<table
					className="table table-striped table-borderless table-sm table-nonfluid"
					data-testid="pre-draft-splits"
				>
					<thead>
						<tr>
							<th>Split</th>
							<th>W-L</th>
							<th>G</th>
							<th>MIN</th>
							<th>PTS</th>
							<th>TRB</th>
							<th>AST</th>
							<th>STL</th>
							<th>BLK</th>
							<th>TOV</th>
							<th>FG%</th>
							<th>3P%</th>
							<th>FT%</th>
						</tr>
					</thead>
					<tbody>
						{preDraft.splits.map((row) => {
							const l = row.line;
							return (
								<tr key={row.name}>
									<td className="text-nowrap">
										{row.name}
										{row.estimated ? "*" : null}
									</td>
									<td>
										{row.record ? `${row.record[0]}-${row.record[1]}` : null}
									</td>
									<td>{l.gp}</td>
									<td>{perGame(l.min, l.gp)}</td>
									<td>{perGame(l.pts, l.gp)}</td>
									<td>{perGame(l.orb + l.drb, l.gp)}</td>
									<td>{perGame(l.ast, l.gp)}</td>
									<td>{perGame(l.stl, l.gp)}</td>
									<td>{perGame(l.blk, l.gp)}</td>
									<td>{perGame(l.tov, l.gp)}</td>
									<td>{pct(l.fg, l.fga)}</td>
									<td>{pct(l.tp, l.tpa)}</td>
									<td>{pct(l.ft, l.fta)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</HideableSection>
	);
};

const HonorsSection = ({ preDraft }: { preDraft: PreDraft }) => {
	if (preDraft.honors.length === 0) {
		return null;
	}
	const bySeason = Map.groupBy(preDraft.honors, (honor) => honor.season);
	return (
		<HideableSection
			title="Honors"
			description="From before he was drafted, so not counted as pro awards."
		>
			<table className="table table-nonfluid table-striped table-borderless table-sm player-awards">
				<tbody>
					{[...bySeason].map(([season, honors]) => (
						<tr key={season}>
							<td className="fw-bold">{season}</td>
							<td>{honors.map((honor) => honor.type).join(", ")}</td>
						</tr>
					))}
				</tbody>
			</table>
		</HideableSection>
	);
};

const inches = (x: number) => {
	const ft = Math.floor(x / 12);
	const rest = x - 12 * ft;
	return `${ft}' ${Number.isInteger(rest) ? rest : rest.toFixed(2).replace(/0$/, "")}"`;
};

const COMBINE_ROWS: {
	key: keyof CombineResults;
	name: string;
	format: (x: number) => string;
}[] = [
	{ key: "heightNoShoes", name: "Height without shoes", format: inches },
	{ key: "heightShoes", name: "Height with shoes", format: inches },
	{ key: "weight", name: "Weight", format: (x) => `${x} lbs` },
	{ key: "wingspan", name: "Wingspan", format: inches },
	{ key: "standingReach", name: "Standing reach", format: inches },
	{ key: "standingVert", name: "Standing vertical", format: (x) => `${x}"` },
	{ key: "maxVert", name: "Max vertical", format: (x) => `${x}"` },
	{
		key: "laneAgility",
		name: "Lane agility",
		format: (x) => `${x.toFixed(2)} s`,
	},
	{ key: "shuttle", name: "Shuttle run", format: (x) => `${x.toFixed(2)} s` },
	{
		key: "sprint",
		name: "3/4 court sprint",
		format: (x) => `${x.toFixed(2)} s`,
	},
	{ key: "bench", name: "Bench press (185 lbs)", format: (x) => `${x} reps` },
];

const CombineSection = ({ preDraft }: { preDraft: PreDraft }) => {
	const combine = preDraft.combine;
	if (!combine) {
		return null;
	}
	return (
		<HideableSection
			title={`${preDraft.draftYear} Draft Combine`}
			description={`Rank and percentile among the ${combine.n} prospects of his draft class.${combine.wingspanRating ? "" : " Wingspan and reach are estimated from his height rating."}`}
		>
			<table
				className="table table-striped table-borderless table-sm table-nonfluid"
				data-testid="pre-draft-combine"
			>
				<thead>
					<tr>
						<th>Measurement</th>
						<th>Result</th>
						<th>Rank</th>
						<th style={{ minWidth: 120 }}>Percentile</th>
					</tr>
				</thead>
				<tbody>
					{COMBINE_ROWS.map(({ key, name, format }) => {
						const p = combine.percentiles[key];
						return (
							<tr key={key}>
								<td>{name}</td>
								<td className="text-nowrap">{format(combine.results[key])}</td>
								<td>
									{p.rank}/{p.n}
								</td>
								<td>
									<div className="d-flex align-items-center gap-2">
										<div
											className="progress flex-grow-1"
											style={{ height: 8, minWidth: 60 }}
										>
											<div
												className={clsx(
													"progress-bar",
													p.pct >= 75
														? "bg-success"
														: p.pct <= 25
															? "bg-danger"
															: "bg-secondary",
												)}
												style={{ width: `${Math.max(2, p.pct)}%` }}
											/>
										</div>
										<span style={{ width: 28 }}>{p.pct}</span>
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</HideableSection>
	);
};

const StockSection = ({ preDraft }: { preDraft: PreDraft }) => {
	if (preDraft.stock.length === 0) {
		return null;
	}
	return (
		<HideableSection
			title="Draft stock"
			description="Where mock drafts had him, from his first season to the draft."
		>
			<div className="row">
				<div className="col-lg-8 col-xl-6 mb-3">
					<StockChart points={preDraft.stock} numPicks={preDraft.numPicks} />
				</div>
				<div className="col-lg-4 col-xl-3">
					<table
						className="table table-striped table-borderless table-sm table-nonfluid"
						data-testid="pre-draft-stock"
					>
						<thead>
							<tr>
								<th>When</th>
								<th>Projected</th>
							</tr>
						</thead>
						<tbody>
							{preDraft.stock.map((point, i) => (
								<tr key={i}>
									<td className="text-nowrap">{point.label}</td>
									<td>
										{point.pick !== undefined ? `#${point.pick}` : "Undrafted"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</HideableSection>
	);
};

const CompsSection = ({ preDraft }: { preDraft: PreDraft }) => {
	return (
		<HideableSection
			title="Similar past prospects"
			description="Prospects from earlier draft classes in this league with the closest ratings, age and position at the draft, and how they turned out."
		>
			{preDraft.comps.length === 0 ? (
				<p>No earlier draft classes in this league to compare with yet.</p>
			) : (
				<div className="table-responsive">
					<table
						className="table table-striped table-borderless table-sm table-nonfluid"
						data-testid="pre-draft-comps"
					>
						<thead>
							<tr>
								<th>Name</th>
								<th title="Similarity score, 100 = identical">Sim</th>
								<th>Draft</th>
								<th>Pos</th>
								<th>Age</th>
								<th>Ovr/Pot at draft</th>
								<th>Pre-draft</th>
								<th>Pro seasons</th>
								<th>Peak ovr</th>
								<th>Career</th>
								<th>Honors</th>
							</tr>
						</thead>
						<tbody>
							{preDraft.comps.map((comp) => (
								<tr key={comp.pid}>
									<td className="text-nowrap">
										<a href={helpers.leagueUrl(["player_pre_draft", comp.pid])}>
											{comp.name}
										</a>
									</td>
									<td>{comp.similarity}</td>
									<td className="text-nowrap">
										{comp.draftYear}{" "}
										{comp.pick !== undefined
											? `#${comp.pick} ${comp.draftAbbrev}`
											: "undrafted"}
									</td>
									<td>{comp.pos}</td>
									<td>{comp.age}</td>
									<td>
										{comp.ovrAtDraft}/{comp.potAtDraft}
									</td>
									<td className="text-nowrap">{comp.school}</td>
									<td>{comp.proSeasons}</td>
									<td>{comp.peakOvr ?? "-"}</td>
									<td className="text-nowrap">
										{comp.career && comp.career.gp > 0
											? `${comp.career.gp} G, ${helpers.roundStat(comp.career.pts, "pts")} pts, ${helpers.roundStat(comp.career.trb, "trb")} reb, ${helpers.roundStat(comp.career.ast, "ast")} ast, ${helpers.roundStat(comp.career.ws, "ws")} WS`
											: "No games"}
									</td>
									<td className="text-nowrap">
										{[
											comp.mvp > 0 ? `${comp.mvp}x MVP` : undefined,
											comp.allStar > 0
												? `${comp.allStar}x All-Star`
												: undefined,
										]
											.filter(Boolean)
											.join(", ")}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</HideableSection>
	);
};

const RecruitingSection = ({ preDraft }: { preDraft: PreDraft }) => {
	const r = preDraft.recruiting;
	if (!r) {
		return null;
	}
	const others = r.offers.filter((name) => name !== r.committed);
	const more = r.offerCount - r.offers.length;
	return (
		<HideableSection
			title="Recruiting"
			description={`High school class of ${r.classOf}. Ranks are among the recruits of that class.`}
		>
			<dl
				className="mb-3"
				data-testid="pre-draft-recruiting-details"
				style={{ maxWidth: 900 }}
			>
				<div className="mb-1">
					<dt className="d-inline">Ranking: </dt>
					<dd className="d-inline">
						<Stars n={r.stars} />{" "}
						{r.nationalRank !== undefined
							? `#${r.nationalRank} nationally${r.posRank !== undefined ? `, #${r.posRank} ${r.pos}` : ""}`
							: "Not ranked by the recruiting services"}
					</dd>
				</div>
				<div className="mb-1">
					<dt className="d-inline">Composite rating: </dt>
					<dd className="d-inline">{r.composite.toFixed(4)}</dd>
				</div>
				<div className="mb-1">
					<dt className="d-inline">Signed with: </dt>
					<dd className="d-inline">
						<SchoolBadge name={r.committed} /> {r.committed}
						{r.jucoStart ? " (junior college)" : null},{" "}
						{r.signing === "early"
							? "early signing period (November)"
							: "late signing period (April)"}
						{r.reclassifiedFrom !== undefined
							? `, after reclassifying from the class of ${r.reclassifiedFrom}`
							: null}
					</dd>
				</div>
				<div className="mb-1">
					<dt className="d-inline">
						{r.offerCount} {r.offerCount === 1 ? "offer" : "offers"}:{" "}
					</dt>
					<dd className="d-inline">
						{others.length > 0
							? `${[r.committed, ...others].join(", ")}${more > 0 ? ` and ${more} more` : ""}`
							: r.committed}
					</dd>
				</div>
				{r.finalists.length > 1 ? (
					<div className="mb-1">
						<dt className="d-inline">Finalists: </dt>
						<dd className="d-inline">{r.finalists.join(", ")}</dd>
					</div>
				) : null}
				{r.allStar.length > 0 ? (
					<div className="mb-1">
						<dt className="d-inline">High school honors: </dt>
						<dd className="d-inline">{r.allStar.join(", ")}</dd>
					</div>
				) : null}
			</dl>
		</HideableSection>
	);
};

const ScoutingReportSection = ({ preDraft }: { preDraft: PreDraft }) => {
	const report = preDraft.scoutingReport;
	if (!report) {
		return null;
	}
	return (
		<HideableSection
			title="Scouting report"
			description={`Based on: ${report.basis.replace(/^./, (c) => c.toLowerCase())}`}
		>
			<div data-testid="pre-draft-scouting-report" style={{ maxWidth: 900 }}>
				<p className="mb-2">{report.summary}</p>
				<div className="row">
					{report.strengths.length > 0 ? (
						<div className="col-md-6">
							<div className="fw-bold text-success">Strengths</div>
							<ul className="ps-3 mb-2">
								{report.strengths.map((text, i) => (
									<li key={i}>{text}</li>
								))}
							</ul>
						</div>
					) : null}
					{report.weaknesses.length > 0 ? (
						<div className="col-md-6">
							<div className="fw-bold text-danger">Weaknesses</div>
							<ul className="ps-3 mb-2">
								{report.weaknesses.map((text, i) => (
									<li key={i}>{text}</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
				<p className="mb-3">
					<b>Projection:</b> {report.projection}
				</p>
			</div>
		</HideableSection>
	);
};

const OverviewCards = ({
	preDraft,
	pid,
}: {
	preDraft: PreDraft;
	pid: number;
}) => {
	const r = preDraft.recruiting;
	const lastSeason = preDraft.seasons.at(-1);
	return (
		<div className="d-flex flex-wrap gap-4 mb-3" data-testid="pre-draft-cards">
			<div>
				<div className="text-body-secondary small">Draft</div>
				{preDraft.draft ? (
					<div>
						{preDraft.draftYear} round {preDraft.draft.round}, pick{" "}
						{preDraft.draft.pick} (#{preDraft.draft.overall} overall) by{" "}
						<a
							href={helpers.leagueUrl([
								"roster",
								`${preDraft.draft.abbrev}_${preDraft.draft.tid}`,
								preDraft.draftYear,
							])}
						>
							{preDraft.draft.abbrev}
						</a>
					</div>
				) : preDraft.drafted ? (
					<div>Undrafted ({preDraft.draftYear})</div>
				) : (
					<div>
						{preDraft.draftYear} prospect
						{preDraft.projectedPick !== undefined
							? `, projected #${preDraft.projectedPick}`
							: ", projected undrafted"}{" "}
						(<a href={helpers.leagueUrl(["draft_scouting"])}>Draft Scouting</a>)
					</div>
				)}
			</div>
			{r ? (
				<div data-testid="pre-draft-recruiting">
					<div className="text-body-secondary small">
						High school recruit, class of {r.classOf}
					</div>
					<div>
						<Stars n={r.stars} />{" "}
						{r.nationalRank !== undefined
							? `#${r.nationalRank} national${r.posRank !== undefined ? `, #${r.posRank} ${r.pos}` : ""}`
							: `Unranked ${r.pos}`}
					</div>
				</div>
			) : null}
			{lastSeason ? (
				<div>
					<div className="text-body-secondary small">
						{lastSeason.label === "College" ? "School" : "Club"}
					</div>
					<div>
						<SchoolBadge name={lastSeason.club ?? lastSeason.teamName} />{" "}
						{lastSeason.club
							? `${lastSeason.club}, ${lastSeason.league}`
							: lastSeason.teamName}
						{lastSeason.conference ? ` (${lastSeason.conference})` : null}
					</div>
				</div>
			) : null}
			<div>
				<div className="text-body-secondary small">Draft class</div>
				<div>
					<a href={helpers.leagueUrl(["college_overseas", preDraft.draftYear])}>
						{preDraft.draftYear} college season
					</a>{" "}
					· <a href={helpers.leagueUrl(["player", pid])}>Overview</a>
				</div>
			</div>
		</div>
	);
};

const PlayerPreDraft = ({
	bestPos,
	customMenu,
	jerseyNumberInfos,
	player,
	preDraft,
	randomDebutsForeverPids,
	retired,
	statSummary,
	teamColors,
	teamJersey,
	teamName,
	teamURL,
	willingToSign,
}: View<"playerPreDraft">) => {
	const { challengeNoRatings, season: currentSeason } = useLocal([
		"challengeNoRatings",
		"season",
	]);
	const showRatings = !challengeNoRatings || retired;
	const profileOptions = usePlayerProfileOptions(player, "preDraft");

	useTitleBar({
		title: player.name,
		customMenu,
		dropdown: {
			fields: [
				{
					key: "profile",
					options: profileOptions,
					value: "preDraft",
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
		},
	});

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

			{!preDraft ? (
				<p data-testid="pre-draft-none">
					{__SPORT === "basketball"
						? "No college or overseas record before the draft."
						: "The College/Overseas page is only available in Basketball GM."}{" "}
					<a href={helpers.leagueUrl(["player", player.pid])}>
						Back to overview
					</a>
				</p>
			) : (
				<>
					<OverviewCards preDraft={preDraft} pid={player.pid} />
					{preDraft.story ? (
						<p
							className="alert alert-info py-2"
							data-testid="pre-draft-story"
							style={{ maxWidth: 900 }}
						>
							<b>{preDraft.story.title}.</b> {preDraft.story.text}
						</p>
					) : null}
					<ScoutingReportSection preDraft={preDraft} />
					<TeamsSection preDraft={preDraft} />
					<StatsSection preDraft={preDraft} />
					<div className="row">
						{preDraft.summary ? (
							<div className="col-12 col-xl-8">
								<CollegeSeasonSection summary={preDraft.summary} />
							</div>
						) : null}
						<div className="col-12 col-xl-4">
							<HonorsSection preDraft={preDraft} />
						</div>
					</div>
					<SplitsSection preDraft={preDraft} />
					<RecruitingSection preDraft={preDraft} />
					<CombineSection preDraft={preDraft} />
					<StockSection preDraft={preDraft} />
					<CompsSection preDraft={preDraft} />
				</>
			)}
		</>
	);
};

export default PlayerPreDraft;
