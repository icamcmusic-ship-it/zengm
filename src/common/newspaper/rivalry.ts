// Rivalry Stories setting: the "Rivalry watch" page of the paper, previews of upcoming marquee rivalry games and recaps of
// the season's big rivalry games. The text comes from common/rivalryStories/text.ts (results and box score stats only, no
// ratings), so it reads the same under the No Visible Player Ratings challenge.
import { Ctx, P } from "./ctx.ts";
import type { Article, Block, NPRivalryStory } from "./types.ts";

const KICKERS: Record<string, string> = {
	preview: "Preview",
	upset: "Upset",
	clincher: "Series clinched",
	heated: "Tempers",
	"big night": "Big night",
	classic: "Instant classic",
};

export const rivalryWatch = (c: Ctx, tid?: number): Article | undefined => {
	const facts = c.f.rivalry;
	if (!facts) {
		return undefined;
	}
	const mine = (s: NPRivalryStory) => tid === undefined || s.tids.includes(tid);
	const previews = facts.previews.filter(mine).slice(0, 2);
	const recaps = facts.recaps.filter(mine).slice(0, 4);
	if (previews.length === 0 && recaps.length === 0) {
		return undefined;
	}
	const lead = recaps[0] ?? previews[0]!;
	const body: Block[] = [];
	const add = (s: NPRivalryStory) => {
		body.push(
			{
				type: "sub",
				text: `${KICKERS[s.kind] ?? "Rivalry"}: ${s.head}`,
			},
			s.gid !== undefined && s.kind !== "preview"
				? P(c.gl(s.gid, s.tids[0], "Box score"), `. ${s.body}`)
				: P(s.body),
		);
	};
	for (const s of [...recaps, ...previews]) {
		add(s);
	}
	return {
		id: tid === undefined ? "rivalry-watch" : `rivalry-watch-${tid}`,
		type: "rivalry",
		size: "feature",
		kicker: "Rivalry watch",
		head: lead.head,
		byline: c.byline("features"),
		body,
	};
};
