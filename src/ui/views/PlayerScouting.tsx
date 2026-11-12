import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import TopStuff from "./Player/TopStuff.tsx";
import { useLocal } from "../util/local.ts";
import { last } from "../../common/utils.ts";
import { helpers } from "../util/helpers.ts";
import { realtimeUpdate } from "../util/realtimeUpdate.ts";
import { playerProfileUrl, usePlayerProfileOptions } from "./Player/common.tsx";
import {
	CompCards,
	GradeBadge,
	GradeBars,
	GradeRadar,
	ReportSection,
	ShotMixChart,
} from "../components/ScoutingReport/index.tsx";

const PRINT_CSS = `@media print {
	body * { visibility: hidden !important; }
	.scouting-card, .scouting-card * { visibility: visible !important; }
	.scouting-card { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
	.scouting-no-print { display: none !important; }
}`;

const List = ({ items }: { items: string[] }) =>
	items.length > 0 ? (
		<ul className="mb-0 ps-3">
			{items.map((x, i) => (
				<li key={i}>{x}</li>
			))}
		</ul>
	) : (
		<div className="text-body-secondary">Nothing to note.</div>
	);

const PlayerScouting = ({
	bestPos,
	customMenu,
	jerseyNumberInfos,
	player,
	randomDebutsForeverPids,
	retired,
	scouting,
	scout,
	statSummary,
	teamColors,
	teamJersey,
	teamName,
	teamURL,
	willingToSign,
}: View<"playerScouting">) => {
	const { challengeNoRatings, season: currentSeason } = useLocal([
		"challengeNoRatings",
		"season",
	]);
	const showRatings = !challengeNoRatings || retired;
	const profileOptions = usePlayerProfileOptions(player, "scouting");

	useTitleBar({
		title: player.name,
		customMenu,
		dropdown: {
			fields: [{ key: "profile", options: profileOptions, value: "scouting" }],
			urlOverride: ({ profile }) => {
				const gameLogSeason =
					player.stats.at(-1)?.season ??
					(player.ratings.length > 0
						? last(player.ratings).season
						: currentSeason);
				return playerProfileUrl(profile as string, player.pid, gameLogSeason);
			},
		},
	});

	const { report, changelog, comparison, track, dept } = scouting;
	const h = report.header;
	const red = report.flags.filter((f) => f.tone === "red");
	const green = report.flags.filter((f) => f.tone === "green");

	return (
		<>
			<style>{PRINT_CSS}</style>
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

			<div className="d-flex flex-wrap gap-2 align-items-center mb-2 scouting-no-print">
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					onClick={() => window.print()}
				>
					Print scouting card
				</button>
				{dept.scouts.length > 1 ? (
					<select
						className="form-select form-select-sm"
						style={{ width: "auto" }}
						aria-label="Scout"
						value={scout ?? report.byline.lead.id}
						onChange={(event) => {
							realtimeUpdate(
								[],
								helpers.leagueUrl([
									"player_scouting",
									player.pid,
									event.target.value,
								]),
							);
						}}
					>
						{dept.scouts.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name} ({s.specialtyName.toLowerCase()})
							</option>
						))}
					</select>
				) : null}
				<a href={helpers.leagueUrl(["scouting_department"])}>
					Scouting department ({dept.quality.toLowerCase()})
				</a>
			</div>

			{/* The printable one-page card */}
			<div
				className="scouting-card border rounded p-3 mb-3"
				data-testid="scouting-card"
				style={{ maxWidth: 1000 }}
			>
				<div className="d-flex flex-wrap justify-content-between gap-2">
					<div>
						<h2 className="mb-0">
							{report.name}{" "}
							<span className="text-body-secondary fs-6">
								{scouting.pos}, {scouting.age} yo
							</span>
						</h2>
						{h.archetype ? <div className="fw-bold">{h.archetype}</div> : null}
						<div>{h.rangeLine}</div>
						<div className="small text-body-secondary">
							By {report.byline.lead.name}, {report.byline.lead.title}
							{report.byline.second
								? ` · second opinion: ${report.byline.second.name}`
								: ""}
						</div>
					</div>
					<div className="text-center">
						<div className="small text-body-secondary">Overall</div>
						<GradeBadge
							lo={report.overall.lo}
							hi={report.overall.hi}
							grade={report.overall.grade}
							big
						/>
						<div className="small mt-1">
							Confidence: <b>{h.confidence}</b>
						</div>
					</div>
				</div>
				<div className="small text-body-secondary mb-2">{h.confidenceNote}</div>
				<div className="row">
					<div className="col-12 col-lg-7">
						<div className="small text-body-secondary mb-1">
							{report.reference}
						</div>
						<GradeBars grades={report.grades} />
					</div>
					<div className="col-12 col-lg-5">
						<div className="d-flex justify-content-center">
							<GradeRadar
								grades={report.grades}
								compare={report.secondTake?.grades}
							/>
						</div>
						{report.secondTake ? (
							<div className="small text-body-secondary text-center mb-2">
								Dashed: {report.byline.second?.name}&apos;s take
							</div>
						) : null}
						{report.shotMix ? (
							<ReportSection title="Shot mix">
								<ShotMixChart mix={report.shotMix} />
							</ReportSection>
						) : null}
						{h.comps.length > 0 ? (
							<ReportSection
								title="Comparisons"
								testid="scouting-comps-section"
							>
								<div className="small mb-1">{h.comps[0]!.line}</div>
								<CompCards comps={h.comps} />
							</ReportSection>
						) : null}
					</div>
				</div>
				<ReportSection title="Bottom line" testid="scouting-bottom-line">
					<p className="mb-0">{report.bottomLine}</p>
				</ReportSection>
			</div>

			<div className="row" style={{ maxWidth: 1000 }}>
				<div className="col-12 col-md-6">
					{report.pro ? (
						<ReportSection title="Pro report" testid="scouting-pro">
							<div>
								<b>Role:</b> {report.pro.role}
							</div>
							<div>
								<b>Trend:</b> {report.pro.trendLine}
							</div>
							<div>
								<b>Ideal role:</b> {report.pro.idealRole}
							</div>
							{report.pro.contract ? (
								<div>
									<b>Contract:</b> {report.pro.contract}
								</div>
							) : null}
							<div>{report.pro.usage}</div>
						</ReportSection>
					) : null}
					{report.retro ? (
						<ReportSection title="Retrospective">{report.retro}</ReportSection>
					) : null}
					<ReportSection title="Offense">
						<List items={report.offense} />
					</ReportSection>
					<ReportSection title="Defense">
						<List items={report.defense} />
					</ReportSection>
					<ReportSection title="Physical profile">
						<List items={report.physical} />
						{report.combine ? (
							<div className="table-responsive mt-1">
								<table className="table table-sm table-borderless small mb-0 table-nonfluid">
									<tbody>
										{report.combine.map((c) => (
											<tr key={c.label}>
												<td>{c.label}</td>
												<td>{c.value}</td>
												<td className="text-body-secondary">{c.pct}th pct</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : null}
					</ReportSection>
				</div>
				<div className="col-12 col-md-6">
					<ReportSection title="Flags" testid="scouting-flags">
						{red.length + green.length === 0 ? (
							<div className="text-body-secondary">No flags.</div>
						) : null}
						{red.map((f) => (
							<div key={f.text} className="text-danger-emphasis">
								▼ {f.text}
							</div>
						))}
						{green.map((f) => (
							<div key={f.text} className="text-success-emphasis">
								▲ {f.text}
							</div>
						))}
					</ReportSection>
					{report.intangibles.length > 0 ? (
						<ReportSection title="Intangibles" testid="scouting-intangibles">
							<ul className="mb-0 ps-3">
								{report.intangibles.map((x) => (
									<li
										key={x.name}
										className={x.known ? undefined : "text-body-secondary"}
									>
										<b>{x.name}:</b> {x.text}
									</li>
								))}
							</ul>
						</ReportSection>
					) : null}
					{report.development.length > 0 ? (
						<ReportSection title="Development plan">
							<List items={report.development} />
						</ReportSection>
					) : null}
					{report.fit.length > 0 ? (
						<ReportSection title="Team fit">
							<List items={report.fit} />
						</ReportSection>
					) : null}
					{track ? (
						<ReportSection title="Track record" testid="scouting-track">
							<div>{track.text}</div>
							{track.scouts.length > 0 ? (
								<div className="small text-body-secondary">
									Scouts: {track.scouts.join(", ")}
								</div>
							) : null}
						</ReportSection>
					) : null}
				</div>
			</div>

			{comparison ? (
				<ReportSection title="Two scouts' takes" testid="scouting-compare">
					<div className="table-responsive" style={{ maxWidth: 600 }}>
						<table className="table table-sm table-striped small">
							<thead>
								<tr>
									<th />
									<th>{comparison.scouts[0]!.name}</th>
									<th>{comparison.scouts[1]!.name}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="fw-bold">Overall</td>
									<td>{comparison.overall[0]}</td>
									<td>{comparison.overall[1]}</td>
								</tr>
								{comparison.rows.map((r) => (
									<tr key={r.key}>
										<td>{r.label}</td>
										<td>{r.a}</td>
										<td
											className={
												r.diff > 0
													? "text-success"
													: r.diff < 0
														? "text-danger"
														: undefined
											}
										>
											{r.b}
										</td>
									</tr>
								))}
								<tr>
									<td className="fw-bold">Range</td>
									<td>{comparison.ranges[0]}</td>
									<td>{comparison.ranges[1]}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</ReportSection>
			) : null}

			<ReportSection title="Stock up / stock down" testid="scouting-changelog">
				{changelog.length === 0 ? (
					<div className="text-body-secondary">
						No grade changes on file yet. Snapshots are taken in the preseason,
						at the trade deadline, at the end of the regular season and before
						the draft.
					</div>
				) : (
					changelog.map((entry, i) => (
						<div key={i} className="mb-2">
							<b>
								{entry.season} {entry.label}
							</b>
							{entry.overall ? (
								<span
									className={
										entry.overall.up ? "text-success ms-2" : "text-danger ms-2"
									}
								>
									Overall {entry.overall.from} → {entry.overall.to}
								</span>
							) : null}
							<ul className="mb-0 ps-3">
								{entry.changes.map((c) => (
									<li
										key={c.key}
										className={
											c.up ? "text-success-emphasis" : "text-danger-emphasis"
										}
									>
										{c.text}
									</li>
								))}
							</ul>
						</div>
					))
				)}
			</ReportSection>
		</>
	);
};

export default PlayerScouting;
