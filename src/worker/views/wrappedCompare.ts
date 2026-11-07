import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getWrappedIndex } from "../util/wrappedData.ts";
import {
	matchCands,
	parseSide,
	sideLabel,
	sideSlides,
	sideSpec,
	statRows,
	tally,
	validSides,
} from "../../common/wrapped/compare.ts";
import type { Slide } from "../../common/wrapped/types.ts";

const processInputs = (params: RouteParams<"wrappedCompare">) => {
	return {
		a: parseSide("a" in params ? params.a : undefined),
		b: parseSide("b" in params ? params.b : undefined),
	};
};

const MAX_ONLY = 8;
const MAX_BOTH = 14;

export default defineView({
	id: "wrappedCompare",
	processInputs,
	load: async ({ inputs, updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Wrapped is only available for basketball." };
		}
		const X = await getWrappedIndex(updateEvents);
		const { a, b } = inputs;

		// Choices for the picker
		const seasons = X.seasons.filter((s) => X.lines(s).length > 0).reverse();
		const latest = seasons[0] ?? X.L.season;
		const teamOptions = X.teamsIn(latest)
			.map((t) => ({ tid: t.tid, label: `${t.region} ${t.name}`, abbrev: t.abbrev }))
			.sort((x, y) => x.label.localeCompare(y.label));
		const playerOptions = [...X.L.players]
			.map((p) => ({ p, ws: X.career(p).ws }))
			.filter((x) => X.careerRows(x.p).length > 0)
			.sort((x, y) => y.ws - x.ws)
			.slice(0, 400)
			.map(({ p }) => ({
				pid: p.pid,
				label: p.name,
				seasons: [...new Set(X.careerRows(p).map((r) => r.season))].sort((x, y) => y - x),
			}));
		const base = {
			seasons,
			teamOptions,
			playerOptions,
			userTid: g.get("userTid"),
		};

		if (!a || !b) {
			return { ...base, error: undefined as string | undefined, compare: undefined };
		}
		const error = validSides(X, a, b);
		if (error) {
			return { ...base, error, compare: undefined };
		}

		const slidesA = sideSlides(X, a);
		const slidesB = sideSlides(X, b);
		const m = matchCands(slidesA, slidesB);
		const both = m.both.slice(0, MAX_BOTH);
		const onlyA = m.onlyA.slice(0, MAX_ONLY);
		const onlyB = m.onlyB.slice(0, MAX_ONLY);
		const shown: Slide[] = [...both.flatMap((p) => [p.a, p.b]), ...onlyA, ...onlyB];

		// Pictures for every player and team on the slides
		const pids = [...new Set(shown.map((s) => s.pid).filter((x) => x !== undefined))];
		const playersRaw = await idb.merged.players.getAll({ pids });
		const faces: Record<number, { face: any; imgURL: string; tid: number; season: number }> = {};
		for (const p of playersRaw) {
			const slide = shown.find((s) => s.pid === p.pid);
			faces[p.pid] = {
				face: p.face,
				imgURL: p.imgURL,
				tid: slide?.tid ?? p.tid,
				season: slide?.season ?? latest,
			};
		}
		const teams: Record<
			string,
			{ abbrev: string; region: string; name: string; colors: [string, string, string]; imgURL?: string }
		> = {};
		for (const s of shown) {
			const t = s.tid !== undefined ? X.teamAny(s.tid, s.season ?? latest) : undefined;
			if (t) {
				teams[`${t.tid}`] = {
					abbrev: t.abbrev,
					region: t.region,
					name: t.name,
					colors: t.colors,
					imgURL: t.imgURL,
				};
			}
		}

		return {
			...base,
			error: undefined as string | undefined,
			compare: {
				kind: a.k,
				a: { spec: sideSpec(a), label: sideLabel(X, a), side: a },
				b: { spec: sideSpec(b), label: sideLabel(X, b), side: b },
				rows: statRows(X, a, b),
				tally: tally(m),
				both,
				onlyA,
				onlyB,
				faces,
				teams,
			},
		};
	},
});
