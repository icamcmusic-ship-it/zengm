import clsx from "clsx";
import FeatureLinks from "../../components/FeatureLinks.tsx";
import { RecordAndPlayoffs } from "../../components/RecordAndPlayoffs.tsx";
import type { View } from "../../../common/types.ts";
import { useState } from "react";
import { onEnterOrSpace } from "../../util/onEnterOrSpace.ts";

const ExpandableNote = ({ note }: { note: string | undefined }) => {
	const [expand, setExpand] = useState(false);

	if (!note) {
		return null;
	}

	const toggle = () => {
		setExpand(!expand);
	};

	// Would be nice to use a button rather than a div, but I couldn't get text-truncate to work there
	return (
		<div
			className={clsx("cursor-pointer", expand ? undefined : "text-truncate")}
			style={expand ? { whiteSpace: "pre-line" } : undefined}
			role="button"
			tabIndex={0}
			aria-expanded={expand}
			onClick={toggle}
			onKeyDown={onEnterOrSpace(toggle)}
		>
			{note}
		</div>
	);
};

const Seasons = ({
	history,
	userSeasons,
}: Pick<View<"teamHistory">, "history" | "userSeasons">) => {
	const userSeasonsSet = new Set(userSeasons);

	const numTeamNames = new Set(
		history.map((h) => h.name).filter((name) => name !== undefined),
	).size;

	let prevName = numTeamNames === 1 ? history[0]!.name : undefined;
	const historySeasons = history.map((h, i) => {
		const recordAndPlayoffs = (
			<RecordAndPlayoffs
				abbrev={h.abbrev}
				className={
					h.playoffRoundsWon === h.numPlayoffRounds ? "fw-bold" : undefined
				}
				lost={h.lost}
				otl={h.otl}
				roundsWonText={h.roundsWonText}
				season={h.season}
				tid={h.tid}
				tied={h.tied}
				won={h.won}
			/>
		);

		let newName;
		if (h.name && prevName !== h.name) {
			newName = h.name;
			// eslint-disable-next-line react-hooks/immutability -- https://github.com/react/react/issues/31569
			prevName = h.name;
		}

		// If a team was inactive for some number of seasons, add some vertical space in the gap
		const gap = i > 0 && h.season + 1 < history[i - 1]!.season;

		return (
			<div key={h.season} className={gap && !newName ? "mt-2" : undefined}>
				{newName ? (
					<h4 className={i > 0 ? "mt-2" : undefined}>{newName}</h4>
				) : null}
				<div>
					{userSeasonsSet.has(h.season) ? (
						<span
							className="table-info legend-square me-1"
							title="You were the GM"
						/>
					) : null}
					{recordAndPlayoffs}
					{__SPORT === "basketball" ? (
						<FeatureLinks
							className="ms-2 small"
							links={[
								{
									url: ["newspaper", `${h.abbrev}_${h.tid}`, h.season],
									text: "Newspaper",
								},
								{
									url: ["wrapped", "team", h.season, `${h.abbrev}_${h.tid}`],
									text: "Wrapped",
								},
								{
									url: ["storylines", "team", `${h.abbrev}_${h.tid}`, h.season],
									text: "Storylines",
								},
							]}
						/>
					) : null}
				</div>
				<ExpandableNote note={h.note} />
			</div>
		);
	});

	// Franchise reboots: every name the franchise has played under, oldest first. Records, history and rivalries stay with it.
	const eras: { name: string; first: number; last: number }[] = [];
	for (const h of history.toReversed()) {
		if (!h.name) {
			continue;
		}
		const cur = eras.at(-1);
		if (cur && cur.name === h.name) {
			cur.last = h.season;
		} else {
			eras.push({ name: h.name, first: h.season, last: h.season });
		}
	}

	return (
		<>
			{eras.length > 1 ? (
				<p className="mb-2" data-testid="team-history-formerly">
					<span className="fw-bold">Formerly: </span>
					{eras
						.slice(0, -1)
						.toReversed()
						.map(
							(e) =>
								`the ${e.name} (${e.first === e.last ? e.first : `${e.first}-${e.last}`})`,
						)
						.join(", ")}
					. Records, banners and rivalries carry over.
				</p>
			) : null}
			{historySeasons}
			{userSeasons.length > 0 ? (
				<p className="mt-2 text-body-secondary">
					Seasons when you were the GM are prefixed{" "}
					<span className="text-nowrap">
						with <span className="table-info legend-square" />
					</span>
				</p>
			) : null}
		</>
	);
};

export default Seasons;
