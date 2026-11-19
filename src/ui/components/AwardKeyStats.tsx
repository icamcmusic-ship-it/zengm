// Award Races and Award History: the stat columns of an award. By default the key stats of its formula (worker/core/awards/keyStats.ts),
// and the user can pick others. The choice is saved in this browser per sport and award, and shared by both pages.
import { useEffect, useState } from "react";
import { Modal } from "./Modal.tsx";
import { getCol } from "../../common/getCol.ts";
import { hasCol } from "../../common/getCols.ts";
import type { Col } from "./DataTable/index.tsx";
import { safeLocalStorage } from "../util/safeLocalStorage.ts";
import type { AwardKeyStats } from "../../worker/core/awards/keyStats.ts";
import { helpers } from "../util/helpers.ts";
import { StatWithChange } from "./StatWithChange.tsx";

export type { AwardKeyStats };

const storageKey = (shortName: string) =>
	`awardStatCols:${__SPORT}:${shortName}`;

const EVENT_NAME = "awardStatColsChange";

const readSaved = (shortName: string) => {
	const raw = safeLocalStorage.getItem(storageKey(shortName));
	if (raw === null) {
		return;
	}
	try {
		const parsed = JSON.parse(raw);
		if (
			Array.isArray(parsed) &&
			parsed.every((stat) => typeof stat === "string")
		) {
			return parsed as string[];
		}
	} catch {}
};

// The stat columns to show for an award: the user's saved choice, or the suggested key stats
export const useAwardStatCols = (
	shortName: string,
	keyStats: AwardKeyStats | undefined,
	enabled: boolean = true,
) => {
	const [saved, setSaved] = useState(() =>
		enabled ? readSaved(shortName) : undefined,
	);

	useEffect(() => {
		if (!enabled) {
			setSaved(undefined);
			return;
		}
		setSaved(readSaved(shortName));

		// Several tables can show the same award (conference awards), keep them in sync
		const listener = (event: Event) => {
			if ((event as CustomEvent).detail === shortName) {
				setSaved(readSaved(shortName));
			}
		};
		window.addEventListener(EVENT_NAME, listener);
		return () => {
			window.removeEventListener(EVENT_NAME, listener);
		};
	}, [enabled, shortName]);

	const suggested = keyStats?.suggested ?? [];

	const save = (stats: string[] | undefined) => {
		if (stats === undefined) {
			safeLocalStorage.removeItem(storageKey(shortName));
		} else {
			safeLocalStorage.setItem(storageKey(shortName), JSON.stringify(stats));
		}
		setSaved(stats);
		window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: shortName }));
	};

	return {
		stats: saved ?? suggested,
		custom: saved !== undefined,
		suggested,
		save,
	};
};

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

export const AwardStatPicker = ({
	awardName,
	keyStats,
	statCols,
}: {
	awardName: string;
	keyStats: AwardKeyStats | undefined;
	statCols: ReturnType<typeof useAwardStatCols>;
}) => {
	const [show, setShow] = useState(false);
	const [search, setSearch] = useState("");

	if (!keyStats) {
		return null;
	}

	const shares = new Map(keyStats.terms.map((term) => [term.stat, term.share]));
	const selected = new Set(statCols.stats);

	const toggle = (stat: string) => {
		const stats = selected.has(stat)
			? statCols.stats.filter((x) => x !== stat)
			: [...statCols.stats, stat];
		statCols.save(stats);
	};

	const formulaStats = keyStats.terms
		.map((term) => term.stat)
		.filter((stat) => keyStats.available.includes(stat));
	const formulaSet = new Set(formulaStats);

	const searchLower = search.trim().toLowerCase();
	const otherStats = keyStats.available.filter((stat) => {
		if (formulaSet.has(stat)) {
			return false;
		}
		if (searchLower === "") {
			return true;
		}
		const col = keyStatCol(stat, keyStats);
		return (
			stat.toLowerCase().includes(searchLower) ||
			col.title.toLowerCase().includes(searchLower) ||
			(col.desc ?? "").toLowerCase().includes(searchLower)
		);
	});

	const renderCheckbox = (stat: string) => {
		const col = keyStatCol(stat, keyStats);
		const share = shares.get(stat);
		const id = `award-stat-${stat}`;
		return (
			<div className="form-check" key={stat}>
				<input
					className="form-check-input"
					type="checkbox"
					id={id}
					checked={selected.has(stat)}
					onChange={() => {
						toggle(stat);
					}}
				/>
				<label className="form-check-label" htmlFor={id}>
					{col.title}
					{col.desc !== undefined && col.desc !== col.title ? (
						<span className="text-body-secondary"> - {col.desc}</span>
					) : null}
					{share !== undefined && share > 0 ? (
						<span className="text-body-secondary">
							{" "}
							({formatShare(share)} of the score's movement)
						</span>
					) : null}
				</label>
			</div>
		);
	};

	return (
		<>
			<button
				className="btn btn-sm btn-light-bordered"
				type="button"
				onClick={() => {
					setShow(true);
				}}
				title="Choose which stats to show for this award"
			>
				Stats{statCols.custom ? "*" : ""}
			</button>
			<Modal
				show={show}
				onHide={() => {
					setShow(false);
				}}
				scrollable
			>
				<Modal.Header closeButton>Stats for {awardName}</Modal.Header>
				<Modal.Body>
					<p className="text-body-secondary">
						{statCols.custom
							? "You picked these stats. Your choice is saved in this browser for this award, on Award Races and Award History."
							: "These are the stats suggested from the award formula. Check or uncheck any stat to make your own list."}
					</p>
					{formulaStats.length > 0 ? (
						<>
							<h3 className="h6">In the award formula</h3>
							<div className="mb-3">{formulaStats.map(renderCheckbox)}</div>
						</>
					) : null}
					<h3 className="h6">All stats</h3>
					<input
						className="form-control form-control-sm mb-2"
						type="search"
						placeholder="Search stats"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
						}}
					/>
					{otherStats.map(renderCheckbox)}
				</Modal.Body>
				<Modal.Footer>
					<button
						className="btn btn-secondary"
						type="button"
						disabled={!statCols.custom}
						onClick={() => {
							statCols.save(undefined);
						}}
					>
						Reset to suggested
					</button>
					<button
						className="btn btn-primary"
						type="button"
						onClick={() => {
							setShow(false);
						}}
					>
						Done
					</button>
				</Modal.Footer>
			</Modal>
		</>
	);
};

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
