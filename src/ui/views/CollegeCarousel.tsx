// College mode: the coaching carousel and conference realignment (docs/college-mode.md)
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { SeasonSelect, TeamName } from "./College/common.tsx";

const TYPE_TEXT = {
	hired: "Hired",
	fired: "Fired",
	left: "Left",
	retired: "Retired",
};

const CollegeCarousel = ({
	canRespond,
	confNames,
	offers,
	offersOpen,
	prestige,
	realignment,
	rows,
	season,
	seasons,
	staffOn,
	teams,
	userTid,
	you,
}: View<"collegeCarousel">) => {
	useTitleBar({ title: "Coaching Carousel" });
	const [message, setMessage] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);

	const respond = async (tid: number, accept: boolean) => {
		if (
			accept &&
			!window.confirm(
				`Leave ${teams[userTid]?.region ?? "your school"} for ${teams[tid]?.region ?? "this school"}? You will coach your new school from now on.`,
			)
		) {
			return;
		}
		setBusy(true);
		const error = await toWorker("main", "collegeRespondToOffer", {
			tid,
			accept,
		});
		setBusy(false);
		setMessage(error ?? undefined);
	};

	const poached = rows.filter(
		(r) => r.type === "hired" && r.fromTid !== undefined,
	);

	return (
		<>
			<SeasonSelect page="college_carousel" season={season} seasons={seasons} />
			{!staffOn ? (
				<p>
					The coaching carousel needs the Coaching Staff setting, which is off
					in this league.
				</p>
			) : null}

			{you ? (
				<div className="card mb-3" style={{ maxWidth: 640 }}>
					<div className="card-body">
						<h2 className="card-title fs-5 mb-2">Your job</h2>
						<p className="mb-1">
							You are{" "}
							<a href={helpers.leagueUrl(["coach", you.cid])}>{you.name}</a>{" "}
							(age {you.age}), head coach of{" "}
							<TeamName teams={teams} tid={userTid} season={season} />
							{you.prestige !== undefined ? ` (prestige ${you.prestige})` : ""}.
						</p>
						<p className="mb-1">
							Reputation: <b>{you.reputationLabel}</b> ({you.reputation}). Hot
							seat: <b>{you.hotSeat}</b>. {you.seasons} season
							{you.seasons === 1 ? "" : "s"} as a head coach at {you.schools}{" "}
							school{you.schools === 1 ? "" : "s"}.
						</p>
						<p className="text-body-secondary small mb-0">
							When the season is over, schools with an open job that are bigger
							than yours may offer it to you if your results beat what your
							program is expected to do. Offers stay open until the Departures
							phase. Lose too much against expectations and you can be fired.
						</p>
					</div>
				</div>
			) : null}

			{offersOpen || offers.length > 0 ? (
				<>
					<h2 className="fs-5">Job offers</h2>
					{message ? (
						<div className="alert alert-warning py-1" role="alert">
							{message}
						</div>
					) : null}
					{offers.length === 0 ? (
						<p>No offers this offseason.</p>
					) : (
						<div className="table-responsive mb-3">
							<table
								className="table table-sm table-striped align-middle"
								data-testid="coach-offers"
							>
								<thead>
									<tr>
										<th>School</th>
										<th>Conference</th>
										<th className="text-end">Prestige</th>
										<th className="text-end">Last season</th>
										<th className="text-end">Years</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{offers.map((o) => (
										<tr key={o.tid}>
											<td className="text-nowrap">
												<TeamName teams={teams} tid={o.tid} season={season} />
											</td>
											<td>{teams[o.tid]?.conf}</td>
											<td className="text-end">{o.prestige}</td>
											<td className="text-end">
												{o.won}-{o.lost}
											</td>
											<td className="text-end">{o.years}</td>
											<td className="text-nowrap">
												<button
													type="button"
													className="btn btn-sm btn-success me-1"
													disabled={!canRespond || busy}
													onClick={() => respond(o.tid, true)}
												>
													Accept
												</button>
												<button
													type="button"
													className="btn btn-sm btn-light-bordered"
													disabled={!canRespond || busy}
													onClick={() => respond(o.tid, false)}
												>
													Decline
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</>
			) : null}

			<h2 className="fs-5">Head coaching moves, {season}</h2>
			{rows.length === 0 ? (
				<p>
					No moves yet. The carousel turns when the season is over (after the
					national tournament).
				</p>
			) : (
				<>
					{poached.length > 0 ? (
						<p className="text-body-secondary">
							{poached.length} head coach{poached.length === 1 ? "" : "es"}{" "}
							moved up to a bigger program.
						</p>
					) : null}
					<div className="table-responsive mb-3">
						<table
							className="table table-sm table-striped align-middle"
							data-testid="coach-moves"
						>
							<thead>
								<tr>
									<th>Coach</th>
									<th>Move</th>
									<th>School</th>
									<th>From</th>
									<th className="text-end">Prestige</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r, i) => (
									<tr key={i}>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["coach", r.cid])}>{r.name}</a>
										</td>
										<td>{TYPE_TEXT[r.type]}</td>
										<td className="text-nowrap">
											<TeamName
												teams={teams}
												tid={r.tid}
												season={season}
												userTid={userTid}
											/>
										</td>
										<td className="text-nowrap">
											{r.fromTid !== undefined ? (
												<TeamName
													teams={teams}
													tid={r.fromTid}
													season={season}
													userTid={userTid}
												/>
											) : null}
										</td>
										<td className="text-end">{prestige[r.tid]}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}

			<h2 className="fs-5">Conference realignment, {season}</h2>
			{realignment.length === 0 ? (
				<p>No school changed conferences after this season.</p>
			) : (
				<div className="table-responsive">
					<table
						className="table table-sm table-striped align-middle"
						data-testid="realignment"
					>
						<thead>
							<tr>
								<th>School</th>
								<th>From</th>
								<th>To</th>
								<th>Why</th>
							</tr>
						</thead>
						<tbody>
							{realignment.map((m) => (
								<tr key={m.tid}>
									<td className="text-nowrap">
										<TeamName
											teams={teams}
											tid={m.tid}
											season={season}
											userTid={userTid}
										/>
									</td>
									<td>{confNames[m.from]}</td>
									<td>{confNames[m.to]}</td>
									<td>
										{m.reason === "upgrade"
											? "Moved up to a stronger conference"
											: "Filled an opening"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
};

export default CollegeCarousel;
