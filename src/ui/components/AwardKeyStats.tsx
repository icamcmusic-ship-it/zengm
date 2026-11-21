// Award Races, Award History and the season summary: the stat columns of an award. By default the key stats of its formula
// (worker/core/awards/keyStats.ts); the user can choose others, in order (the award's statCols setting, see AwardStatCols.tsx).
import { useState } from "react";
import { getCol } from "../../common/getCol.ts";
import { hasCol } from "../../common/getCols.ts";
import type { Col } from "./DataTable/index.tsx";
import type { AwardKeyStats } from "../../worker/core/awards/keyStats.ts";
import { helpers } from "../util/helpers.ts";
import { StatWithChange } from "./StatWithChange.tsx";
import type { StatColOption } from "./StatColsEditor.tsx";

export type { AwardKeyStats };

// Most columns a user can choose (MAX_STAT_COLS in worker/core/awards/keyStats.ts)
export const MAX_AWARD_STAT_COLS = 8;

export const keyStatTitle = (stat: string, keyStats?: AwardKeyStats) => {
	if (hasCol(`stat:${stat}`)) {
		return getCol(`stat:${stat}`).title;
	}
	return keyStats?.colInfo[stat]?.title ?? stat;
};

export const keyStatCol = (stat: string, keyStats?: AwardKeyStats): Col => {
	if (hasCol(`stat:${stat}`)) {
		return getCol(`stat:${stat}`);
	}
	const info = keyStats?.colInfo[stat];
	return {
		title: info?.title ?? stat,
		desc: info?.desc,
		sortSequence: ["desc", "asc"],
		sortType: "number",
	};
};

const formatShare = (share: number) => {
	const pct = Math.round(100 * share);
	return share > 0 && pct === 0 ? "<1%" : `${pct}%`;
};

// "Why these stats": the formula and how much each of its stats moves the score among the players shown
export const KeyStatsNote = ({
	keyStats,
	who,
}: {
	keyStats: AwardKeyStats | undefined;
	who: string;
}) => {
	const [open, setOpen] = useState(false);
	if (!keyStats) {
		return null;
	}

	const anyShare = keyStats.terms.some((term) => term.share > 0);

	return (
		<div className="small text-body-secondary">
			<button
				className="btn btn-link btn-sm p-0 align-baseline"
				type="button"
				onClick={() => {
					setOpen(!open);
				}}
			>
				Why these stats?
			</button>
			{open ? (
				<div className="mt-1">
					<div>
						Award formula
						{keyStats.byPos ? " (some positions use their own)" : ""}:{" "}
						<code>{keyStats.formula}</code>
					</div>
					{keyStats.terms.length === 0 ? (
						<div>
							The formula reads no stats, so the award's usual stats are shown.
						</div>
					) : anyShare ? (
						<div>
							How much each stat in the formula moves the score among {who}:{" "}
							{keyStats.terms
								.map(
									(term) =>
										`${keyStatTitle(term.stat, keyStats)} ${formatShare(term.share)}`,
								)
								.join(", ")}
							. The ones that matter most are shown as columns.
						</div>
					) : (
						<div>
							Stats in the formula:{" "}
							{keyStats.terms
								.map((term) => keyStatTitle(term.stat, keyStats))
								.join(", ")}
							. Once there are players to compare, the ones that matter most are
							shown first.
						</div>
					)}
				</div>
			) : null}
		</div>
	);
};

// Every stat an award can show, for the stat columns editor (formula stats flagged, with their share of the score's movement)
export const awardStatColOptions = (
	keyStats: AwardKeyStats,
): StatColOption[] => {
	const shares = new Map(keyStats.terms.map((term) => [term.stat, term.share]));
	return keyStats.available.map((stat) => {
		const col = keyStatCol(stat, keyStats);
		const share = shares.get(stat);
		return {
			key: stat,
			title: col.title,
			desc: col.desc,
			formula: share !== undefined,
			note:
				share !== undefined && share > 0
					? `${formatShare(share)} of the score's movement`
					: undefined,
		};
	});
};

export const AWARD_AUTOMATIC_TEXT =
	"The stats that move the award formula's score the most";

const isMissing = (value: unknown) =>
	value === undefined ||
	value === null ||
	(typeof value === "number" && !Number.isFinite(value));

// A stat cell: a dash when the stat is missing (like a stat that was not tracked in an old season), with the change from last
// season when prev is given (Most Improved Player)
export const keyStatCell = (value: unknown, stat: string, prev?: unknown) => {
	if (isMissing(value)) {
		return {
			value: "-",
			sortValue: null,
			searchValue: null,
		};
	}

	if (typeof value === "number") {
		if (typeof prev === "number" && Number.isFinite(prev)) {
			return {
				value: (
					<StatWithChange change={value - prev} stat={stat}>
						{value}
					</StatWithChange>
				),
				sortValue: value,
				searchValue: helpers.roundStat(value, stat),
			};
		}

		return {
			value: helpers.roundStat(value, stat),
			sortValue: value,
		};
	}

	return helpers.roundStat(value, stat);
};
