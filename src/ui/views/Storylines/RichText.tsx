import { Fragment } from "react";
import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";

const TOKEN = /\[\[([gpt]):([^\]|]*)\|([^\]]*)]]/g;

type LoadedData = Extract<View<"storylines">, { loading: false }>;

export type Teams = LoadedData["teams"];

// Text with [[p:pid|Name]], [[t:tid:season|Name]] and [[g:gid:tid:season|text]] tokens, as links
export const RichText = ({ text, teams }: { text: string; teams: Teams }) => {
	const parts = [];
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		parts.push(text.slice(last, m.index));
		const [, kind, ref, name] = m;
		if (kind === "p") {
			parts.push(
				<a key={m.index} href={helpers.leagueUrl(["player", Number(ref)])}>
					{name}
				</a>,
			);
		} else if (kind === "t") {
			const [tid, season] = ref!.split(":").map(Number);
			const abbrev = teams[tid!]?.abbrev ?? "";
			parts.push(
				<a
					key={m.index}
					href={helpers.leagueUrl(["roster", `${abbrev}_${tid}`, season!])}
				>
					{name}
				</a>,
			);
		} else {
			const [gid, tid, season] = ref!.split(":").map(Number);
			const abbrev = teams[tid!]?.abbrev ?? "";
			parts.push(
				<a
					key={m.index}
					href={helpers.leagueUrl([
						"game_log",
						`${abbrev}_${tid}`,
						season!,
						gid!,
					])}
				>
					{name}
				</a>,
			);
		}
		last = m.index + m[0].length;
	}
	parts.push(text.slice(last));
	return (
		<>
			{parts.map((p, i) => (
				<Fragment key={i}>{p}</Fragment>
			))}
		</>
	);
};
