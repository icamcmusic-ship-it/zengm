import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { showNotification } from "../util/showNotification.ts";
import type { View } from "../../common/types.ts";

type Props = View<"bracketChallenge">;
type Team = NonNullable<Props["first"][number]["away"]>;

const emptyPicks = (first: Props["first"], numRounds: number) =>
	Array.from({ length: numRounds }, (_, r) =>
		Array.from({ length: Math.max(1, first.length / 2 ** r) }, (_, j) =>
			// A bye is its team's automatic pick
			r === 0 && !first[j]!.away ? first[j]!.home.tid : -1,
		),
	);

// Drop picks later in the bracket that are no longer one of the two teams feeding their slot
const prune = (picks: number[][], first: Props["first"]) => {
	const out = picks.map((round) => [...round]);
	for (let r = 0; r < out.length; r++) {
		for (let j = 0; j < out[r]!.length; j++) {
			const options =
				r === 0
					? [first[j]!.home.tid, first[j]!.away?.tid]
					: [out[r - 1]![2 * j], out[r - 1]![2 * j + 1]];
			if (!options.includes(out[r]![j]!)) {
				out[r]![j] = r === 0 && !first[j]!.away ? first[j]!.home.tid : -1;
			}
		}
	}
	return out;
};

const BracketChallengeInner = ({
	done,
	entry,
	first,
	history,
	max,
	noBracket,
	roundNames,
	roundPoints,
	score,
	season,
	status,
	storylines,
	winners,
}: Props) => {
	useTitleBar({
		title: "Bracket Challenge",
		dropdown: {
			view: "bracketChallenge",
			fields: [{ key: "season", options: { type: "seasons" }, value: season }],
		},
	});
	const numRounds = roundNames.length;
	const [picks, setPicks] = useState<number[][]>(() =>
		entry ? entry.picks : emptyPicks(first, numRounds),
	);
	const [saving, setSaving] = useState(false);

	if (noBracket) {
		return (
			<>
				<p>
					Predict the whole bracket before the first round starts. Each correct
					pick scores {roundPoints[0] ?? 10} points in the first round, doubling
					every round.
				</p>
				<p>There is no bracket for {season} yet.</p>
				<History history={history} />
			</>
		);
	}

	const teamOf = new Map<number, Team>();
	for (const s of first) {
		teamOf.set(s.home.tid, s.home);
		if (s.away) {
			teamOf.set(s.away.tid, s.away);
		}
	}
	const label = (tid: number) => {
		const t = teamOf.get(tid);
		return t ? `${t.seed}. ${t.abbrev}` : "—";
	};
	const editable = status === "open";
	const shown = editable ? picks : (entry?.picks ?? []);

	const mark = (r: number, tid: number) => {
		if (editable || tid < 0) {
			return "";
		}
		if (r < done) {
			return winners[r]?.includes(tid)
				? "text-success fw-bold"
				: "text-danger text-decoration-line-through";
		}
		// Knocked out in a round already played
		for (let k = 0; k < Math.min(done, r); k++) {
			if (!winners[k]?.includes(tid)) {
				return "text-danger text-decoration-line-through";
			}
		}
		return "";
	};

	const choose = (r: number, j: number, tid: number) => {
		if (!editable || tid < 0) {
			return;
		}
		const next = picks.map((round) => [...round]);
		next[r]![j] = tid;
		setPicks(prune(next, first));
	};

	const complete = picks.every((round) => round.every((tid) => tid >= 0));

	const submit = async () => {
		setSaving(true);
		try {
			await toWorker("main", "submitBracketPicks", picks);
			showNotification({ type: "success", text: "Your bracket is in." });
		} catch (error) {
			showNotification({ type: "error", text: error.message });
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<p>
				Predict the whole bracket before the first round starts. Each correct
				pick scores{" "}
				{roundPoints
					.map((p, r) => `${p} in the ${roundNames[r]!.toLowerCase()}`)
					.join(", ")}{" "}
				({max} possible). Your score goes in the news after each round. See the{" "}
				<a href={helpers.leagueUrl(["playoffs", season])}>bracket</a> and the{" "}
				<a href={helpers.leagueUrl(["bracket_archive"])}>archive</a>.
			</p>
			{status === "waiting" ? (
				<p className="alert alert-info">
					Picks open once the play-in tournament is over.
				</p>
			) : status === "closed" && !entry ? (
				<p className="alert alert-secondary">
					Picks are closed for this bracket: they have to be in before the first
					round starts.
				</p>
			) : null}
			{score ? (
				<p className="fs-5" data-testid="bracket-score">
					<b>{score.total}</b> points
					{done < numRounds
						? ` so far (${score.maxSoFar} possible in the rounds played)`
						: ` of ${max}`}
					{score.points.length > 0
						? ` · ${score.points.map((p, r) => `${roundNames[r]}: ${p}`).join(", ")}`
						: ""}
				</p>
			) : null}

			{editable || entry ? (
				<div
					className="d-flex gap-3 overflow-auto mb-3"
					data-testid="bracket-challenge"
				>
					{roundNames.map((name, r) => (
						<div key={r} style={{ minWidth: 150 }}>
							<div className="fw-bold mb-2">
								{name}{" "}
								<span className="text-body-secondary small">
									({roundPoints[r]} pts)
								</span>
							</div>
							{(shown[r] ?? []).map((pick, j) => {
								const options =
									r === 0
										? [first[j]!.home.tid, first[j]!.away?.tid ?? -1]
										: [
												shown[r - 1]?.[2 * j] ?? -1,
												shown[r - 1]?.[2 * j + 1] ?? -1,
											];
								const s = r === 0 ? first[j]! : undefined;
								const key = s?.away ? `${s.home.tid}-${s.away.tid}` : undefined;
								return (
									<div key={j} className="border rounded p-1 mb-2 small">
										{options.map((tid, k) =>
											tid < 0 && !(r === 0 && k === 1 && !first[j]!.away) ? (
												<div key={k} className="text-body-secondary">
													—
												</div>
											) : r === 0 && k === 1 && !first[j]!.away ? (
												<div key={k} className="text-body-secondary">
													bye
												</div>
											) : (
												<button
													key={k}
													type="button"
													disabled={!editable}
													className={`btn btn-sm w-100 text-start mb-1 ${pick === tid ? "btn-primary" : "btn-light-bordered"} ${pick === tid ? mark(r, tid) : ""}`}
													onClick={() => choose(r, j, tid)}
												>
													{label(tid)}
												</button>
											),
										)}
										{key && storylines[key] ? (
											<div
												className="text-body-secondary"
												style={{ fontSize: "0.8em" }}
											>
												{storylines[key].join(" ")}
											</div>
										) : null}
									</div>
								);
							})}
						</div>
					))}
				</div>
			) : null}

			{editable ? (
				<button
					type="button"
					className="btn btn-success mb-3"
					disabled={!complete || saving}
					onClick={submit}
				>
					{entry ? "Update my bracket" : "Submit my bracket"}
				</button>
			) : null}

			<History history={history} />
		</>
	);
};

const History = ({ history }: { history: Props["history"] }) =>
	history.length > 0 ? (
		<>
			<h2>Past brackets</h2>
			<ul>
				{history.map((row) => (
					<li key={row.season}>
						<a href={helpers.leagueUrl(["bracket_challenge", row.season])}>
							{row.season}
						</a>
						: {row.points} points
					</li>
				))}
			</ul>
		</>
	) : null;

// Keyed by season, so switching seasons starts from that season's picks
const BracketChallenge = (props: Props) => (
	<BracketChallengeInner key={props.season} {...props} />
);

export default BracketChallenge;
