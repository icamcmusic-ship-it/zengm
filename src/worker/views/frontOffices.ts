// AI GM personalities: every team's general manager, the GM carousel and the former GMs still on the market
import { GM_TRAIT_INFO, GM_TRAIT_KEYS } from "../../common/gmPersonality.ts";
import { userControlsTeam } from "../core/gm/index.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { formatGm, type FormattedGm } from "./gmShared.ts";

type Move = {
	season: number;
	type: "hired" | "fired" | "retired" | "left";
	tid: number;
	abbrev: string;
	gmid: number;
	name: string;
	// For hires: record and teams before
	previousTeams?: string[];
};

export default defineView({
	id: "frontOffices",
	load: async ({ updateEvents }) => {
		const off = featureOffError("gmPersonalities");
		if (off) {
			return off;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}

		const teamInfoCache = g.get("teamInfoCache");
		const abbrev = (tid: number) => teamInfoCache[tid]?.abbrev ?? "";
		const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);

		const rows: {
			tid: number;
			abbrev: string;
			region: string;
			name: string;
			colors: [string, string, string];
			user: boolean;
			gm: FormattedGm | undefined;
		}[] = [];
		const moves: Move[] = [];
		const market: FormattedGm[] = [];
		const season = g.get("season");

		for (const t of teams) {
			const user = userControlsTeam(t.tid);
			rows.push({
				tid: t.tid,
				abbrev: t.abbrev,
				region: t.region,
				name: t.name,
				colors: t.colors,
				user,
				gm: t.gm && !user ? await formatGm(t.gm, t.tid) : undefined,
			});

			for (const gm of [...(t.gm ? [t.gm] : []), ...(t.formerGms ?? [])]) {
				const name = `${gm.firstName} ${gm.lastName}`;
				for (const [i, tenure] of gm.tenures.entries()) {
					// The first GMs of a league weren't hired in a carousel
					if (!tenure.initial) {
						const before = gm.tenures.slice(0, i).map((x) => abbrev(x.tid));
						moves.push({
							// Hired in the offseason before his first season
							season: tenure.start - 1,
							type: "hired",
							tid: tenure.tid,
							abbrev: abbrev(tenure.tid),
							gmid: gm.gmid,
							name,
							previousTeams: before,
						});
					}
					if (tenure.end !== undefined && tenure.reason) {
						moves.push({
							season: tenure.end,
							type: tenure.reason,
							tid: tenure.tid,
							abbrev: abbrev(tenure.tid),
							gmid: gm.gmid,
							name,
						});
					}
				}
			}

			for (const gm of t.formerGms ?? []) {
				if (gm.retiredYear === undefined) {
					market.push(await formatGm(gm));
				}
			}
		}

		const carouselMoves = moves;
		const order = { fired: 0, retired: 1, left: 2, hired: 3 };
		carouselMoves.sort(
			(a, b) =>
				b.season - a.season ||
				order[a.type] - order[b.type] ||
				a.abbrev.localeCompare(b.abbrev),
		);

		market.sort((a, b) => (b.lastTeam?.end ?? 0) - (a.lastTeam?.end ?? 0));

		return {
			rows: rows.sort((a, b) => a.abbrev.localeCompare(b.abbrev)),
			moves: carouselMoves,
			market,
			season,
			traitKeys: [...GM_TRAIT_KEYS],
			traitInfo: GM_TRAIT_INFO,
			userTid: g.get("userTid"),
		};
	},
});
