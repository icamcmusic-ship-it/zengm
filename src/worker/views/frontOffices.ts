// AI GM personalities: every team's general manager, the GM carousel and the former GMs still on the market
import { GM_TRAIT_INFO, GM_TRAIT_KEYS } from "../../common/gmPersonality.ts";
import { onGmMarket, userOwnsTeam } from "../core/gm/index.ts";
import {
	GM_FINANCE_STYLES,
	GM_FINANCE_STYLE_KEYS,
} from "../../common/gmFinance.ts";
import type { Gm } from "../../common/types.ts";
import { gmFinanceEnabled, gmFinanceStyleOf } from "../core/gm/finance.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { formatGm, gmExpHidden, type FormattedGm } from "./gmShared.ts";

type Move = {
	// After this season (in the offseason before the next one), or during it (midSeason)
	season: number;
	midSeason?: boolean;
	type: "hired" | "fired" | "retired" | "left";
	tid: number;
	abbrev: string;
	gmid: number;
	name: string;
	// For hires: record and teams before
	previousTeams?: string[];
	// For hires: AI GM finance style name, when that's on
	finance?: string;
};

const financeName = (gm: Gm) => {
	const style = gmFinanceStyleOf(gm);
	return style ? GM_FINANCE_STYLES[style].adjective : undefined;
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
		// Contracted teams too: their GMs' history and the ones on the market (no row on the table)
		const teams = await idb.cache.teams.getAll();

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
			if (!t.disabled) {
				// The user's teams, even while auto play runs them (they have no GM)
				const user = userOwnsTeam(t.tid);
				rows.push({
					tid: t.tid,
					abbrev: t.abbrev,
					region: t.region,
					name: t.name,
					colors: t.colors,
					user,
					gm: t.gm && !user ? await formatGm(t.gm, t.tid) : undefined,
				});
			}

			for (const gm of [...(t.gm ? [t.gm] : []), ...(t.formerGms ?? [])]) {
				const name = `${gm.firstName} ${gm.lastName}`;
				for (const [i, tenure] of gm.tenures.entries()) {
					// The first GMs of a league weren't hired in a carousel
					if (!tenure.initial) {
						const before = gm.tenures.slice(0, i).map((x) => abbrev(x.tid));
						moves.push({
							// Hired in the offseason before his first season, or during it
							season: tenure.midSeason ? tenure.start : tenure.start - 1,
							midSeason: tenure.midSeason ? true : undefined,
							type: "hired",
							tid: tenure.tid,
							abbrev: abbrev(tenure.tid),
							gmid: gm.gmid,
							name,
							previousTeams: before,
							finance: financeName(gm),
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

			// The ones the next carousel can hire (the others retire then)
			for (const gm of t.formerGms ?? []) {
				if (onGmMarket(gm)) {
					market.push(await formatGm(gm));
				}
			}
		}

		const carouselMoves = moves;
		const order = { fired: 0, retired: 1, left: 2, hired: 3 };
		// Newest first: during a season comes after the offseason before it
		const when = (m: Move) => m.season + (m.midSeason ? 0.5 : 0);
		carouselMoves.sort(
			(a, b) =>
				when(b) - when(a) ||
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
			financeInfo: gmFinanceEnabled()
				? GM_FINANCE_STYLE_KEYS.map((key) => ({
						key,
						name: GM_FINANCE_STYLES[key].name,
						description: GM_FINANCE_STYLES[key].description,
					}))
				: undefined,
			userTid: g.get("userTid"),
			// No Visible Ratings challenge: no expectations column (they come from roster ratings)
			noRatings: gmExpHidden(),
		};
	},
});
