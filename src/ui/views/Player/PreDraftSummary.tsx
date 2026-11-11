import { getPreDraftLabel } from "../../../common/collegeStats/overseas.ts";
import type { View } from "../../../common/types.ts";
import { helpers } from "../../util/helpers.ts";
import { hasPreDraftInfo } from "./common.tsx";

/**
 * One line about where he played before the draft, with a link to his College/Overseas page, which has all of it.
 */
export const PreDraftSummary = ({
	player,
}: {
	player: View<"player">["player"];
}) => {
	if (!hasPreDraftInfo(player)) {
		return null;
	}

	const rows = player.preDraftStats;
	const lastRow = rows.at(-1) as Record<string, any> | undefined;
	const teams = [...new Set(rows.map((row) => row.teamName))];
	const summary = player.collegeSeason;
	const ncaa = summary?.ncaa;

	const parts: string[] = [];
	if (lastRow) {
		const label = getPreDraftLabel(lastRow.teamName);
		const first = rows[0]!.season;
		parts.push(
			`${label}: ${teams.join(", ")} (${rows.length} ${rows.length === 1 ? "season" : "seasons"}, ${first === lastRow.season ? first : `${first}-${lastRow.season}`})`,
			`${lastRow.season}: ${helpers.roundStat(lastRow.pts, "pts")} pts, ${helpers.roundStat(lastRow.trb, "trb")} reb, ${helpers.roundStat(lastRow.ast, "ast")} ast`,
		);
	}
	if (summary) {
		parts.push(
			`${summary.school} ${summary.w}-${summary.l}${ncaa ? `, ${ncaa === "Champion" ? "National Champion" : ncaa}` : summary.nit ? `, NIT ${summary.nit}` : ""}`,
		);
	}
	if (player.earlierHonors.length > 0) {
		parts.push(
			`${player.earlierHonors.length} ${player.earlierHonors.length === 1 ? "honor" : "honors"}`,
		);
	}

	return (
		<p className="mb-3" data-testid="pre-draft-summary">
			<b>Before the draft:</b> {parts.join(" · ")} ·{" "}
			<a href={helpers.leagueUrl(["player_pre_draft", player.pid])}>
				College/Overseas »
			</a>
		</p>
	);
};
