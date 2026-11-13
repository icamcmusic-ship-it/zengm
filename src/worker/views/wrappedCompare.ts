import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView, keepType } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	getWrapped,
	getWrappedStatus,
	isBulkSimming,
	memoize,
	yieldToWorker,
	wrappedRatingsView,
	type Built,
} from "../util/wrappedData.ts";
import {
	matchCands,
	parseSide,
	sideLabel,
	sideSlidesAsync,
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
	// Whether the page is showing its placeholder, which it replaces once the league history is ready
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ inputs, updateEvents, prevInputs, prevOutput }) => {
		const featureOff = featureOffError("wrapped");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return { errorMessage: "Wrapped is only available for basketball." };
		}
		// While games are being simmed, leave the page as it is rather than rebuilding it every day
		if (
			prevInputs !== undefined &&
			!updateEvents.has("firstRun") &&
			prevOutput.loading !== true &&
			JSON.stringify(prevInputs) === JSON.stringify(inputs) &&
			isBulkSimming()
		) {
			return;
		}
		let built: Built;
		const changed =
			prevInputs === undefined ||
			JSON.stringify(prevInputs) !== JSON.stringify(inputs);
		if (changed || prevOutput.loading === true) {
			// Don't make the page wait for the league history to be read
			const st = getWrappedStatus(updateEvents.has("firstRun"));
			if (st.status === "loading") {
				return { loading: true as const, progress: st.progress };
			}
			if (st.status === "error") {
				return {
					errorMessage: `Could not read the league history: ${st.message}`,
				};
			}
			built = st.built;
		} else {
			built = await getWrapped();
		}
		// The ratings the slides may quote (none under the No Visible Player Ratings challenge, fuzzed otherwise)
		const ratingsView = wrappedRatingsView();
		const X = built.X.withRatings(ratingsView);
		const { a, b } = inputs;

		// Choices for the picker
		const seasons = X.seasons.filter((s) => X.lines(s).length > 0).reverse();
		const latest = seasons[0] ?? X.L.season;
		const teamOptions = X.teamsIn(latest)
			.map((t) => ({
				tid: t.tid,
				label: `${t.region} ${t.name}`,
				abbrev: t.abbrev,
			}))
			.sort((x, y) => x.label.localeCompare(y.label));
		const playerOptions = [...X.L.players]
			.map((p) => ({ p, ws: X.career(p).ws }))
			.filter((x) => X.careerRows(x.p).length > 0)
			.sort((x, y) => y.ws - x.ws)
			.slice(0, 400)
			.map(({ p }) => ({
				pid: p.pid,
				label: p.name,
				seasons: [...new Set(X.careerRows(p).map((r) => r.season))].sort(
					(x, y) => y - x,
				),
			}));
		const base = {
			seasons,
			teamOptions,
			playerOptions,
			userTid: g.get("userTid"),
		};

		if (!a || !b) {
			return {
				...base,
				loading: false as const,
				error: undefined as string | undefined,
				compare: undefined,
			};
		}
		const error = validSides(X, a, b);
		if (error) {
			return { ...base, loading: false as const, error, compare: undefined };
		}

		// Each side's slides only depend on the snapshot and the side, so comparing again is cheap
		const slidesA = await memoize(
			built,
			`cmp|${ratingsView}|${sideSpec(a)}`,
			() => sideSlidesAsync(X, a, yieldToWorker),
		);
		const slidesB = await memoize(
			built,
			`cmp|${ratingsView}|${sideSpec(b)}`,
			() => sideSlidesAsync(X, b, yieldToWorker),
		);
		const m = matchCands(slidesA, slidesB);
		const both = m.both.slice(0, MAX_BOTH);
		const onlyA = m.onlyA.slice(0, MAX_ONLY);
		const onlyB = m.onlyB.slice(0, MAX_ONLY);
		const shown: Slide[] = [
			...both.flatMap((p) => [p.a, p.b]),
			...onlyA,
			...onlyB,
		];

		// Pictures for every player and team on the slides
		const pids = [
			...new Set(shown.map((s) => s.pid).filter((x) => x !== undefined)),
		];
		const playersRaw = await idb.merged.players.getAll({ pids });
		const faces: Record<
			number,
			{ face: any; imgURL: string; tid: number; season: number }
		> = {};
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
			{
				abbrev: string;
				region: string;
				name: string;
				colors: [string, string, string];
				imgURL?: string;
			}
		> = {};
		for (const s of shown) {
			const t =
				s.tid !== undefined ? X.teamAny(s.tid, s.season ?? latest) : undefined;
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
			loading: false as const,
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
