// Draft-and-stash (docs/native-features.md): the player page panel and the roster page section for players stashed overseas
import { useState } from "react";
import type {
	StashInfo,
	TeamStashView,
} from "../../worker/core/draftStash/index.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { showNotification } from "../util/showNotification.ts";

const STASH_EXPLANATION =
	"Stash overseas: he leaves your roster and keeps playing for his club abroad while you hold his rights. He takes no roster spot and no salary, develops each season, and his seasons abroad show with his college/overseas stats.";

const bringOverExplanation = (lapseSeason: number) =>
	`Bring over: he joins your roster and signs a contract (the rookie scale of his pick within a year of the draft, otherwise a contract at his market value), and you pay a buyout to his club if he has played there since the draft. Possible between the draft and the end of free agency (not in the preseason). If he is still abroad at the start of free agency in ${lapseSeason}, your rights lapse and he becomes a free agent.`;

const ROSTER_BRING_OVER_TEXT =
	"Bring over: he joins the roster and signs a contract (the rookie scale of his pick within a year of the draft, otherwise a contract at his market value), plus a buyout to his club if he has played there since the draft. Possible between the draft and the end of free agency (not in the preseason); rights lapse at the start of free agency in the season shown, and he becomes a free agent.";

const seasonsText = (n: number) => `${n} ${n === 1 ? "season" : "seasons"}`;

const useAction = () => {
	const [busy, setBusy] = useState(false);
	const run = async (
		name: "stashDraftPick" | "bringOverStashed",
		pid: number,
	) => {
		setBusy(true);
		try {
			const error = await toWorker("main", name, pid);
			if (error) {
				showNotification({
					type: "error",
					text: error,
				});
			}
		} finally {
			setBusy(false);
		}
	};
	return { busy, run };
};

const contractText = (
	info: Extract<NonNullable<StashInfo>, { type: "stashed" }>,
) =>
	`${helpers.formatCurrency(info.contract.amount, "M")}/yr through ${info.contract.exp}${
		info.contract.rookie ? " (rookie scale)" : ""
	}${
		info.buyout > 0
			? `, plus a ${helpers.formatCurrency(info.buyout, "M")} buyout`
			: ""
	}`;

export const StashPlayerPanel = ({
	info,
	pid,
}: {
	info: StashInfo;
	pid: number;
}) => {
	const { busy, run } = useAction();
	if (!info) {
		return null;
	}

	if (info.type === "canStash") {
		return (
			<div className="alert alert-info mb-3" style={{ maxWidth: 700 }}>
				<p className="mb-2">
					His last season before the draft was with a club overseas (
					{info.league}
					), so you can stash him there instead of signing him.
				</p>
				<p className="mb-2 text-body-secondary">{STASH_EXPLANATION}</p>
				<button
					className="btn btn-primary"
					disabled={busy || info.stashBlocked !== undefined}
					title={info.stashBlocked}
					onClick={() => run("stashDraftPick", pid)}
				>
					Stash overseas
				</button>
				{info.stashBlocked ? (
					<span className="ms-2 text-body-secondary">{info.stashBlocked}</span>
				) : null}
			</div>
		);
	}

	return (
		<div className="alert alert-secondary mb-3" style={{ maxWidth: 700 }}>
			<p className="mb-2">
				<span className="badge bg-secondary me-1">Stashed overseas</span>
				Playing for {info.league} since {info.season} (
				{seasonsText(info.seasonsAbroad)} abroad). Rights held by{" "}
				<a href={helpers.leagueUrl(["roster", `${info.abbrev}_${info.tid}`])}>
					{info.abbrev}
				</a>{" "}
				until free agency in {info.lapseSeason}.
			</p>
			{info.userCanAct ? (
				<>
					<p className="mb-2 text-body-secondary">
						{bringOverExplanation(info.lapseSeason)}
					</p>
					<button
						className="btn btn-primary"
						disabled={busy || info.bringOverBlocked !== undefined}
						title={info.bringOverBlocked}
						onClick={() => run("bringOverStashed", pid)}
					>
						Bring over
					</button>
					<span className="ms-2 text-body-secondary">
						{info.bringOverBlocked ?? `Would cost ${contractText(info)}.`}
					</span>
				</>
			) : null}
		</div>
	);
};

export const RosterStashSection = ({ stash }: { stash: TeamStashView }) => {
	const { busy, run } = useAction();
	if (!stash) {
		return null;
	}

	return (
		<div className="mt-3">
			<h2>Stashed overseas</h2>
			{stash.stashed.length > 0 ? (
				<>
					<p className="text-body-secondary">
						Draft picks playing abroad while the team holds their rights. They
						take no roster spot and no salary.
						{stash.userTeam ? ` ${ROSTER_BRING_OVER_TEXT}` : null}
					</p>
					<div className="table-responsive">
						<table className="table table-striped table-borderless table-sm">
							<thead>
								<tr>
									<th>Name</th>
									<th>Pos</th>
									<th>Age</th>
									<th>Ovr</th>
									<th>Pot</th>
									<th>Drafted</th>
									<th>Club league</th>
									<th>Seasons abroad</th>
									<th>Rights until</th>
									{stash.userTeam ? <th>Bring over</th> : null}
								</tr>
							</thead>
							<tbody>
								{stash.stashed.map((p) => (
									<tr key={p.pid}>
										<td>
											<a href={helpers.leagueUrl(["player", p.pid])}>
												{p.name}
											</a>
										</td>
										<td>{p.pos}</td>
										<td>{p.age}</td>
										<td>{p.ovr}</td>
										<td>{p.pot}</td>
										<td>
											{p.draft.year} round {p.draft.round}, pick {p.draft.pick}
										</td>
										<td>{p.league}</td>
										<td>{p.seasonsAbroad}</td>
										<td>FA {p.lapseSeason}</td>
										{stash.userTeam ? (
											<td>
												<button
													className="btn btn-sm btn-primary"
													disabled={busy || p.bringOverBlocked !== undefined}
													title={p.bringOverBlocked ?? contractText(p)}
													onClick={() => run("bringOverStashed", p.pid)}
												>
													Bring over
												</button>
												<div className="small text-body-secondary">
													{p.bringOverBlocked ?? contractText(p)}
												</div>
											</td>
										) : null}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
			{stash.canStash.length > 0 ? (
				<>
					<p className="text-body-secondary mb-2">{STASH_EXPLANATION}</p>
					<ul className="list-unstyled">
						{stash.canStash.map((p) => (
							<li key={p.pid} className="mb-1">
								<button
									className="btn btn-sm btn-light-bordered me-2"
									disabled={busy || p.blocked !== undefined}
									title={p.blocked}
									onClick={() => run("stashDraftPick", p.pid)}
								>
									Stash overseas
								</button>
								<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a> (
								{p.league})
								{p.blocked ? (
									<span className="ms-2 text-body-secondary">{p.blocked}</span>
								) : null}
							</li>
						))}
					</ul>
				</>
			) : null}
		</div>
	);
};
