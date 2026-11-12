// Draft preview (the Scouting Reports setting): the upcoming class's top prospects as the user's scouts grade them. Nothing without the
// facts, so leagues without the setting print exactly what they did.
import { P } from "./ctx.ts";
import { addPage, arcPage, table } from "./kit.ts";
import type { NPDraftPreview } from "./types.ts";

type Row = NPDraftPreview["rows"][number];

addPage(
	arcPage<{ d: NPDraftPreview; top: Row; riser?: Row; faller?: Row }>({
		id: "draft-preview",
		section: "draft",
		kicker: "Draft preview",
		eds: ["midseason", "playoffs", "final"],
		beat: "draft",
		size: "feature",
		prep: (c) => {
			const d = c.f.draftPreview;
			if (!d || d.rows.length < 3) {
				return undefined;
			}
			const riser = d.rows
				.filter((x) => x.move > 0)
				.toSorted((a, b) => b.move - a.move)[0];
			const faller = d.rows
				.filter((x) => x.move < 0)
				.toSorted((a, b) => a.move - b.move)[0];
			return { d, top: d.rows[0]!, riser, faller };
		},
		photo: (x) => x.top.pid,
		arcs: [
			{
				id: "board",
				heads: (x) => [
					`Draft preview: ${x.top.name} tops the ${x.d.draftYear} board`,
					`Scouting the ${x.d.draftYear} class: it starts with ${x.top.name}`,
					`Our scouts' big board: ${x.top.name} at No. 1`,
				],
				build: (x, r, c) => [
					P(
						c.pl(x.top.pid, x.top.name),
						` (${x.top.pos}, ${x.top.age}${x.top.school ? `, ${x.top.school}` : ""}) grades out at ${x.top.overall}, `,
						r.pick([
							`with ${x.top.best.toLowerCase()} the standout tool. `,
							`and ${x.top.best.toLowerCase()} is the calling card. `,
						]),
						`${x.top.line} Floor: ${x.top.floor.toLowerCase()}; ceiling: ${x.top.ceiling.toLowerCase()}.`,
						x.top.comp ? ` The comparison in our files: ${x.top.comp}.` : "",
					),
					P(
						r.pick([
							`${x.d.scout}, who leads the work on this class, `,
							`According to ${x.d.scout}, who has seen most of them, `,
						]),
						r.pick([
							"says the next names on the board are close.",
							"thinks the gap after the top few is real.",
							"sees a lot of guesswork past the lottery.",
						]),
						x.riser
							? ` The riser: ${x.riser.name}, up since the first look.`
							: "",
						x.faller ? ` The faller: ${x.faller.name}.` : "",
					),
					table(
						["#", "Prospect", "Pos", "Grade", "Best tool", "Ceiling"],
						x.d.rows.map((row) => [
							[String(row.rank)],
							[c.pl(row.pid, row.name)],
							[row.pos],
							[row.overall],
							[row.best],
							[row.ceiling],
						]),
					),
				],
			},
		],
	}),
);
