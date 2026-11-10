import clsx from "clsx";
import { useState } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { Bracket, ProspectLinks } from "./Bracket.tsx";
import {
	HonorList,
	makeTeamInfo,
	postseasonText,
	type Props,
	type WithSeason,
} from "./common.tsx";
import { Nit } from "./Nit.tsx";
import { Polls } from "./Polls.tsx";
import { Selection } from "./Selection.tsx";

const TABS = [
	{ key: "standings", name: "Standings" },
	{ key: "ap", name: "AP Top 25" },
	{ key: "conference", name: "Conference Tournaments" },
	{ key: "selection", name: "Selection" },
	{ key: "ncaa", name: "March Madness" },
	{ key: "nit", name: "NIT" },
	{ key: "overseas", name: "Overseas" },
] as const;

const pct = (x: number | undefined) =>
	x === undefined ? "" : `${(100 * x).toFixed(1)}%`;

// The season's shape and what happened, in a few sentences
const SeasonSummary = (props: WithSeason) => {
	const [open, setOpen] = useState(false);
	const { headline, summary } = props.storyline;
	const shown = open ? summary : summary.slice(0, 2);
	return (
		<div className="alert alert-light border mb-3" data-testid="season-summary">
			<b>{headline}.</b> {shown.join(" ")}{" "}
			{summary.length > 2 ? (
				<button
					type="button"
					className="btn btn-link p-0 border-0 align-baseline"
					onClick={() => setOpen(!open)}
				>
					{open ? "Less" : "More"}
				</button>
			) : null}
		</div>
	);
};

const Standings = (props: WithSeason) => {
	const [conf, setConf] = useState("");
	const conferences = props.conferences.filter(
		(c) => conf === "" || c.name === conf,
	);
	return (
		<>
			<select
				className="form-select mb-3"
				style={{ maxWidth: 260 }}
				value={conf}
				onChange={(event) => setConf(event.target.value)}
				aria-label="Conference"
			>
				<option value="">All conferences</option>
				{[...props.conferences]
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((c) => (
						<option key={c.name} value={c.name}>
							{c.name}
						</option>
					))}
			</select>
			<div className="row">
				{conferences.map((c) => (
					<div className="col-12 col-xl-6" key={c.name}>
						<h3>{c.name}</h3>
						<div className="table-responsive">
							<table className="table table-striped table-borderless table-sm table-nonfluid">
								<thead>
									<tr>
										<th>#</th>
										<th>Team</th>
										<th title="Conference record">Conf</th>
										<th title="Overall record">Ovr</th>
										<th title="Simple rating system">SRS</th>
										<th title="NET-style ranking on Selection Sunday">NET</th>
										<th>Conf Tourney</th>
										<th>Postseason</th>
										<th>Prospects</th>
									</tr>
								</thead>
								<tbody>
									{c.standings.map((team, i) => {
										const t = props.teams[team]!;
										return (
											<tr key={team}>
												<td>{i + 1}</td>
												<td className="text-nowrap">
													{t.apRank !== undefined ? (
														<span className="text-body-secondary small me-1">
															{t.apRank}
														</span>
													) : null}
													{t.school}
												</td>
												<td>
													{t.confW}-{t.confL}
												</td>
												<td>
													{t.w}-{t.l}
												</td>
												<td>{t.srs.toFixed(1)}</td>
												<td>{t.net.rank}</td>
												<td className="text-nowrap">
													{t.confTourney === "Champion" ? (
														<b>Champion</b>
													) : (
														t.confTourney
													)}
												</td>
												<td className="text-nowrap">{postseasonText(t)}</td>
												<td>
													<ProspectLinks
														prospects={props.prospectsBySchool[t.school] ?? []}
													/>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				))}
			</div>
		</>
	);
};

const ConferenceTournaments = (props: WithSeason) => {
	const sorted = [...props.conferences].sort(
		(a, b) =>
			b.standings.reduce((s, t) => s + props.teams[t]!.srs, 0) /
				b.standings.length -
			a.standings.reduce((s, t) => s + props.teams[t]!.srs, 0) /
				a.standings.length,
	);
	const [conf, setConf] = useState(sorted[0]!.name);
	const c = props.conferences.find((x) => x.name === conf) ?? sorted[0]!;
	const teamInfo = makeTeamInfo(props);
	const champ = props.teams[c.champion]!;
	return (
		<>
			<select
				className="form-select mb-3"
				style={{ maxWidth: 260 }}
				value={c.name}
				onChange={(event) => setConf(event.target.value)}
				aria-label="Conference"
			>
				{sorted.map((x) => (
					<option key={x.name} value={x.name}>
						{x.name} ({props.teams[x.champion]!.school})
					</option>
				))}
			</select>
			<p>
				<b>{champ.school}</b> won the {c.name} tournament and the automatic bid
				{champ.ncaaSeed !== undefined
					? ` (NCAA ${champ.ncaaSeed} seed, ${props.regions[champ.region!]})`
					: null}
				.
			</p>
			<HonorList
				honors={props.honorWinners}
				filter={new RegExp(`^(${c.name} Tournament MVP)$`)}
				title="Tournament MVP"
			/>
			<Bracket
				rounds={c.tourney}
				roundNames={c.tourney.map((_, r) => {
					const fromEnd = c.tourney.length - 1 - r;
					return fromEnd === 0
						? "Final"
						: fromEnd === 1
							? "Semifinals"
							: fromEnd === 2
								? "Quarterfinals"
								: `Round ${r + 1}`;
				})}
				teamInfo={teamInfo}
				showSeeds
			/>
		</>
	);
};

const MarchMadness = (props: WithSeason) => {
	const [view, setView] = useState<number>(-1);
	const teamInfo = makeTeamInfo(props);
	const { tournament } = props;
	const champ = props.teams[tournament.champion]!;
	const ffRounds = [tournament.finalFour, [tournament.final]];
	return (
		<>
			<div className="alert alert-light border mb-3">
				<b>National Champion:</b> {champ.school} ({champ.w}-{champ.l},{" "}
				{champ.ncaaSeed} seed, {props.regions[champ.region!]})
				<ProspectLinks
					prospects={props.prospectsBySchool[champ.school] ?? []}
					prefix=" — "
				/>
				<HonorList
					honors={props.honorWinners}
					filter={/Final Four Most Outstanding Player|All-Final Four/}
					title=""
				/>
			</div>
			<div
				className="btn-group mb-3 flex-wrap"
				role="group"
				aria-label="Bracket part"
			>
				{[
					{ key: -1, name: "Final Four" },
					...props.regions.map((name, i) => ({ key: i, name })),
					{ key: -2, name: "First Four" },
				].map(({ key, name }) => (
					<button
						key={key}
						type="button"
						className={clsx(
							"btn btn-sm",
							view === key ? "btn-primary" : "btn-light-bordered",
						)}
						onClick={() => setView(key)}
					>
						{name}
					</button>
				))}
			</div>
			{view === -1 ? (
				<Bracket
					rounds={ffRounds}
					roundNames={["Final Four", "Championship"]}
					teamInfo={teamInfo}
					showSeeds
					wide
				/>
			) : view === -2 ? (
				<Bracket
					rounds={[tournament.firstFour]}
					roundNames={tournament.firstFour.map(
						(game) => `${props.regions[game.region]} ${game.seed} seed`,
					)}
					gameLabels={tournament.firstFour.map(
						(game) => `${props.regions[game.region]} — ${game.seed} seed`,
					)}
					teamInfo={teamInfo}
					showSeeds
					wide
				/>
			) : (
				<>
					<h3>{props.regions[view]} Region</h3>
					<Bracket
						rounds={tournament.regions[view]!}
						roundNames={[
							"Round of 64",
							"Round of 32",
							"Sweet 16",
							"Elite Eight",
						]}
						teamInfo={teamInfo}
						showSeeds
					/>
				</>
			)}
		</>
	);
};

const Overseas = ({ overseas }: { overseas: Props["overseas"] }) => {
	if (overseas.length === 0) {
		return (
			<p>No prospects in this class played overseas or in the G League.</p>
		);
	}
	return (
		<div className="table-responsive">
			<table className="table table-striped table-borderless table-sm table-nonfluid">
				<thead>
					<tr>
						<th>Name</th>
						<th>Pos</th>
						<th>Age</th>
						<th>League</th>
						<th>GP</th>
						<th>MIN</th>
						<th>PTS</th>
						<th>TRB</th>
						<th>AST</th>
						<th>FG%</th>
						<th>3P%</th>
						<th>Honors</th>
					</tr>
				</thead>
				<tbody>
					{overseas.map((p) => (
						<tr key={p.pid}>
							<td className="text-nowrap">
								<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
								{p.draft ? (
									<span className="text-body-secondary small ms-1">
										{p.draft.round}-{p.draft.pick} {p.draft.abbrev}
									</span>
								) : null}
							</td>
							<td>{p.pos}</td>
							<td>{p.age}</td>
							<td className="text-nowrap">
								{p.league}
								{!p.overseas ? (
									<span className="badge bg-secondary ms-1">US</span>
								) : null}
							</td>
							<td>{p.gp}</td>
							<td>{p.min.toFixed(1)}</td>
							<td>{p.pts.toFixed(1)}</td>
							<td>{p.trb.toFixed(1)}</td>
							<td>{p.ast.toFixed(1)}</td>
							<td>{pct(p.fgp)}</td>
							<td>{pct(p.tpp)}</td>
							<td className="small">{p.allHonors.join(", ")}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

const CollegeOverseas = (props: Props) => {
	const { season, seasons, tab } = props;
	useTitleBar({ title: `${season} College/Overseas` });

	return (
		<>
			{seasons.length > 1 ? (
				<div className="btn-group mb-3 flex-wrap" aria-label="Draft year">
					{seasons.map((s) => (
						<a
							key={s}
							className={`btn btn-sm ${s === season ? "btn-primary" : "btn-light-bordered"}`}
							href={helpers.leagueUrl(["college_overseas", s, tab])}
						>
							{s}
						</a>
					))}
				</div>
			) : null}

			<ul className="nav nav-pills mb-3 flex-nowrap overflow-auto text-nowrap">
				{TABS.map((t) => (
					<li className="nav-item" key={t.key}>
						<a
							className={clsx("nav-link", { active: t.key === tab })}
							href={helpers.leagueUrl(["college_overseas", season, t.key])}
						>
							{t.name}
						</a>
					</li>
				))}
			</ul>

			{props.hasSeason && tab !== "overseas" ? (
				<SeasonSummary {...props} />
			) : null}

			{tab === "overseas" ? (
				<Overseas overseas={props.overseas} />
			) : !props.hasSeason ? (
				<p>
					There is no college season for the {season} draft class yet. It is
					made with the class's college stats: use the <i>College stats</i>{" "}
					button on{" "}
					<a href={helpers.leagueUrl(["draft_scouting"])}>Draft Scouting</a> (or
					the all classes panel), or turn on automatic pre-draft stats in League
					Extras.
				</p>
			) : tab === "standings" ? (
				<Standings {...props} />
			) : tab === "ap" ? (
				<Polls {...props} />
			) : tab === "conference" ? (
				<ConferenceTournaments {...props} />
			) : tab === "selection" ? (
				<Selection {...props} />
			) : tab === "nit" ? (
				<Nit {...props} />
			) : (
				<MarchMadness {...props} />
			)}
		</>
	);
};

export default CollegeOverseas;
