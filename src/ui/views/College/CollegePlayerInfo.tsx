// College mode: a player's class year, recruiting profile and how he left school, for the player page
import { classYearName } from "../../../common/college/constants.ts";
import type {
	PlayerCollegeExit,
	PlayerRecruit,
} from "../../../common/college/types.ts";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import { Stars } from "./common.tsx";

export const CollegePlayerInfo = ({
	player,
}: {
	player: {
		tid: number;
		classYear?: number;
		recruit?: PlayerRecruit;
		collegeExit?: PlayerCollegeExit;
	};
}) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const { classYear, collegeExit, recruit } = player;
	const exitTeam =
		collegeExit !== undefined ? teamInfoCache[collegeExit.tid] : undefined;
	return (
		<>
			{collegeExit ? (
				<>
					{collegeExit.type === "pro"
						? `Left ${exitTeam?.region ?? ""} for the pros in ${collegeExit.season}${
								collegeExit.pick !== undefined
									? ` (pick ${collegeExit.pick})`
									: ""
							}`
						: collegeExit.type === "graduated"
							? `Graduated from ${exitTeam?.region ?? ""} in ${collegeExit.season}`
							: `Left school in ${collegeExit.season}`}
					<br />
				</>
			) : classYear !== undefined ? (
				<>
					Class: {classYearName(classYear)}
					<br />
				</>
			) : null}
			{recruit ? (
				<>
					Recruit: <Stars stars={recruit.stars} />{" "}
					{recruit.walkOn ? (
						"walk-on"
					) : (
						<>
							No. {recruit.rank}
							{recruit.season !== undefined ? ` (${recruit.season})` : ""}
						</>
					)}
					{player.tid === -2 ? (
						<>
							{" "}
							(
							<a href={helpers.leagueUrl(["college_recruiting"])}>
								recruiting board
							</a>
							)
						</>
					) : null}
					<br />
				</>
			) : null}
		</>
	);
};
