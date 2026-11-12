import { parseRumorText } from "../../common/rumors/text.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";

// A rumor's text (or its outcome) with links to the players, teams and coaches in it
export const RumorText = ({ text }: { text: string }) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	return (
		<>
			{parseRumorText(text).map((segment, i) => {
				if (segment.type === "text") {
					return segment.text;
				}
				if (segment.type === "team" || segment.type === "gm") {
					const t = teamInfoCache[segment.tid];
					const name =
						segment.type === "gm"
							? segment.name
							: t
								? `${t.region} ${t.name}`
								: "???";
					return t ? (
						<a
							key={i}
							href={helpers.leagueUrl(["roster", `${t.abbrev}_${segment.tid}`])}
						>
							{name}
						</a>
					) : (
						name
					);
				}
				if (segment.type === "player") {
					return (
						<a key={i} href={helpers.leagueUrl(["player", segment.pid])}>
							{segment.name}
						</a>
					);
				}
				return (
					<a key={i} href={helpers.leagueUrl(["coach", segment.cid])}>
						{segment.name}
					</a>
				);
			})}
		</>
	);
};
