import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";
import type { BracketTeamInfo } from "./Bracket.tsx";

export type Props = View<"collegeOverseas">;
export type WithSeason = Extract<Props, { hasSeason: true }>;
export type TeamRow = WithSeason["teams"][number];

export const postseasonText = (t: TeamRow) => {
	if (t.ncaa) {
		return t.ncaa === "Champion"
			? `National Champion (${t.ncaaSeed})`
			: `NCAA ${t.ncaa} (${t.ncaaSeed})`;
	}
	if (t.nit) {
		return `NIT ${t.nit} (${t.nitSeed})`;
	}
	return "";
};

export const makeTeamInfo =
	(props: WithSeason) =>
	(team: number): BracketTeamInfo => {
		const t = props.teams[team]!;
		return {
			school: t.school,
			record: `${t.w}-${t.l}`,
			prospects: props.prospectsBySchool[t.school] ?? [],
		};
	};

export const HonorList = ({
	honors,
	filter,
	title,
}: {
	honors: WithSeason["honorWinners"];
	filter: RegExp;
	title: string;
}) => {
	const list = honors.filter((h) => filter.test(h.type));
	if (list.length === 0) {
		return null;
	}
	return (
		<>
			{title ? <h3>{title}</h3> : null}
			<ul className="list-unstyled">
				{list.map((h, i) => (
					<li key={i}>
						<a href={helpers.leagueUrl(["player", h.pid])}>{h.name}</a>:{" "}
						{h.type}
					</li>
				))}
			</ul>
		</>
	);
};
