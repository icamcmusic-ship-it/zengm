// College mode: conference tournament brackets (docs/college-mode.md)
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { Bracket, SeasonSelect, TeamName } from "./College/common.tsx";
import { confRoundName } from "../../common/collegeStats/ncaa.ts";

const CollegeConfTournaments = ({
	season,
	seasons,
	teams,
	tournaments,
	userCid,
	userTid,
}: View<"collegeConfTournaments">) => {
	useTitleBar({ title: "Conference Tournaments" });
	const [cid, setCid] = useState<number | undefined>(undefined);
	const current =
		tournaments.find((t) => t.cid === (cid ?? userCid)) ?? tournaments[0];

	return (
		<>
			<SeasonSelect
				page="college_conf_tournaments"
				season={season}
				seasons={seasons}
			/>
			{tournaments.length === 0 ? (
				<p>
					The conference tournaments start when the regular season is over.
					Every team plays in its conference's tournament (the top seeds get
					byes) and the champion gets an automatic bid to the national
					tournament.
				</p>
			) : (
				<>
					<select
						className="form-select mb-3"
						style={{ width: "auto", maxWidth: "100%" }}
						aria-label="Conference"
						value={current?.cid}
						onChange={(event) => setCid(Number(event.target.value))}
					>
						{tournaments.map((t) => (
							<option key={t.cid} value={t.cid}>
								{t.name}
								{t.champion !== undefined
									? ` (champion: ${teams[t.champion]?.region})`
									: ""}
							</option>
						))}
					</select>
					{current ? (
						<>
							{current.champion !== undefined ? (
								<p className="fs-5">
									Champion:{" "}
									<TeamName
										teams={teams}
										tid={current.champion}
										season={season}
										userTid={userTid}
									/>
								</p>
							) : null}
							<Bracket
								rounds={current.rounds}
								roundName={(i) => confRoundName(i, current.rounds.length)}
								teams={teams}
								season={season}
								userTid={userTid}
							/>
						</>
					) : null}
				</>
			)}
		</>
	);
};

export default CollegeConfTournaments;
