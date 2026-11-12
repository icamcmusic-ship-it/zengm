// College mode: the NIT bracket (docs/college-mode.md)
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { Bracket, SeasonSelect, TeamName } from "./College/common.tsx";

const ROUND_NAMES = [
	"Championship",
	"Semifinals",
	"Quarterfinals",
	"Second Round",
	"First Round",
];

const CollegeNit = ({
	enabled,
	nit,
	season,
	seasons,
	teams,
	userTid,
}: View<"collegeNit">) => {
	useTitleBar({ title: "NIT" });

	return (
		<>
			<SeasonSelect page="college_nit" season={season} seasons={seasons} />
			{nit ? (
				<>
					{nit.champion !== undefined ? (
						<p className="fs-5" data-testid="nit-champion">
							NIT Champion:{" "}
							<TeamName
								teams={teams}
								tid={nit.champion}
								season={season}
								userTid={userTid}
							/>
						</p>
					) : null}
					<p>
						{nit.seeds.length} teams, the best not selected for the national
						tournament.
						{nit.autoBids.length > 0 ? (
							<>
								{" "}
								Automatic bids (regular season conference champions who lost
								their tournament):{" "}
								{nit.autoBids.map((tid, i) => (
									<span key={tid}>
										{i > 0 ? ", " : ""}
										<TeamName
											teams={teams}
											tid={tid}
											season={season}
											userTid={userTid}
										/>
									</span>
								))}
								.
							</>
						) : null}
					</p>
					<Bracket
						rounds={nit.rounds}
						roundName={(i) =>
							ROUND_NAMES[nit.rounds.length - 1 - i] ?? `Round ${i + 1}`
						}
						teams={teams}
						season={season}
						userTid={userTid}
					/>
				</>
			) : (
				<p>
					{enabled
						? "The NIT is played alongside the national tournament, by the best teams that were not selected. Its field is set on Selection Sunday."
						: "The NIT is off in this league (League Extras: College NIT)."}
				</p>
			)}
		</>
	);
};

export default CollegeNit;
