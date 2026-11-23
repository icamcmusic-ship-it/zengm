// One line on the player page from Hall of Fame Watch: his chance, or how his time on the ballot went
import type { View } from "../../../common/types.ts";
import { helpers } from "../../util/helpers.ts";

export const HofLine = ({
	hofWatch,
}: {
	hofWatch: View<"player">["hofWatch"];
}) => {
	if (!hofWatch) {
		return null;
	}
	const ratio = Math.round((100 * hofWatch.score) / hofWatch.threshold);
	const chance = `${Math.round(100 * hofWatch.chance)}%`;
	const link = (text: string) => (
		<a href={helpers.leagueUrl(["hall_of_fame_watch"])}>{text}</a>
	);
	let content;
	switch (hofWatch.status) {
		case "inducted":
			content = (
				<>
					Inducted into the{" "}
					<a href={helpers.leagueUrl(["hall_of_fame"])}>Hall of Fame</a>
					{hofWatch.inducted !== undefined ? ` in ${hofWatch.inducted}` : ""}
					{hofWatch.lastPct !== undefined && hofWatch.years !== undefined
						? ` (${hofWatch.years === 1 ? "first ballot" : `${helpers.ordinal(hofWatch.years)} year on the ballot`}, ${hofWatch.lastPct.toFixed(1)}%)`
						: ""}
					.
				</>
			);
			break;
		case "active": {
			// Nothing to say about players far from it
			if (hofWatch.chance < 0.01 && ratio < 30) {
				return null;
			}
			const projected = Math.round(
				(100 * hofWatch.projected) / hofWatch.threshold,
			);
			content = (
				<>
					{link("Hall of Fame Watch")}: {chance} chance (score {ratio} of 100,
					projected {projected}).
				</>
			);
			break;
		}
		case "waiting":
			content = (
				<>
					{link("Hall of Fame")}: on the ballot from {hofWatch.eligible} (score{" "}
					{ratio} of 100), {chance} chance.
				</>
			);
			break;
		case "ballot":
			content = (
				<>
					{link("Hall of Fame")} ballot: {hofWatch.lastPct?.toFixed(1)}% in his{" "}
					{helpers.ordinal(hofWatch.years ?? 1)} year (75% needed), {chance}{" "}
					chance.
				</>
			);
			break;
		case "fellOff":
			content = (
				<>
					Fell off the Hall of Fame ballot after {hofWatch.years}{" "}
					{helpers.plural("year", hofWatch.years ?? 1)} (last{" "}
					{hofWatch.lastPct?.toFixed(1)}%).
				</>
			);
			break;
		default:
			if (ratio < 50) {
				return null;
			}
			content = <>Not in the Hall of Fame (score {ratio} of 100).</>;
	}
	return (
		<p className="mb-3" data-testid="hof-line">
			{content}
		</p>
	);
};
