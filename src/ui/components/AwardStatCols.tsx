// The Columns menu of the award tables (Award Races, Award History, Coach/Executive of the Year races): the user's choice of stat
// columns, saved in the league (an award's statCols setting, the same one Award Settings edits) through the worker.
import { useEffect, useState } from "react";
import { toWorker } from "../util/toWorker.ts";
import { showNotification } from "../util/showNotification.ts";
import { StatColsDropdown } from "./StatColsEditor.tsx";
import {
	AWARD_AUTOMATIC_TEXT,
	MAX_AWARD_STAT_COLS,
	awardStatColOptions,
	type AwardKeyStats,
} from "./AwardKeyStats.tsx";

const EVENT_NAME = "awardStatColsChange";

type ChangeDetail = {
	key: string;
	stats: string[] | undefined;
};

// The columns of a table whose choice is saved in the league: the saved choice from the worker, or a change made here (shown right
// away, and shared with other tables of the same award, like conference awards), or the automatic ones. persist saves a change and
// returns false when it could not be saved (then it is kept for this visit only)
export const useStatColsChoice = ({
	key,
	persist,
	saved,
	suggested,
}: {
	key: string;
	persist: (stats: string[] | undefined) => Promise<boolean | void>;
	saved: string[] | undefined;
	suggested: string[];
}) => {
	const [override, setOverride] = useState<
		{ stats: string[] | undefined } | undefined
	>();
	const [sessionOnly, setSessionOnly] = useState(false);

	// New data from the worker has the saved choice
	useEffect(() => {
		setOverride(undefined);
	}, [saved]);

	useEffect(() => {
		const listener = (event: Event) => {
			const detail = (event as CustomEvent<ChangeDetail>).detail;
			if (detail.key === key) {
				setOverride({ stats: detail.stats });
			}
		};
		window.addEventListener(EVENT_NAME, listener);
		return () => {
			window.removeEventListener(EVENT_NAME, listener);
		};
	}, [key]);

	const choice = override ? override.stats : saved;

	const save = async (stats: string[] | undefined) => {
		const normalized = stats && stats.length > 0 ? stats : undefined;
		window.dispatchEvent(
			new CustomEvent<ChangeDetail>(EVENT_NAME, {
				detail: { key, stats: normalized },
			}),
		);
		try {
			const ok = await persist(normalized);
			setSessionOnly(ok === false);
		} catch (error) {
			setSessionOnly(true);
			showNotification({
				type: "error",
				text: `Could not save the columns: ${error.message}`,
			});
		}
	};

	return {
		stats: choice ?? suggested,
		custom: choice !== undefined,
		sessionOnly,
		suggested,
		save,
	};
};

// The stat columns to show for an award: its statCols setting (validated by the worker), or the automatic key stats
export const useAwardStatCols = (
	shortName: string,
	keyStats: AwardKeyStats | undefined,
) =>
	useStatColsChoice({
		key: `award:${shortName}`,
		persist: async (stats) =>
			await toWorker("awardSettings", "saveAwardStatCols", {
				shortName,
				statCols: stats,
			}),
		saved: keyStats?.custom,
		suggested: keyStats?.suggested ?? [],
	});

// The Columns menu of an award table (Award Races, Award History)
export const AwardStatPicker = ({
	keyStats,
	statCols,
}: {
	keyStats: AwardKeyStats | undefined;
	statCols: ReturnType<typeof useAwardStatCols>;
}) => {
	if (!keyStats) {
		return null;
	}

	return (
		<StatColsDropdown
			automaticText={AWARD_AUTOMATIC_TEXT}
			custom={statCols.custom}
			max={MAX_AWARD_STAT_COLS}
			onChange={(stats) => {
				void statCols.save(stats);
			}}
			options={awardStatColOptions(keyStats)}
			sessionOnly={statCols.sessionOnly}
			suggested={statCols.suggested}
			value={statCols.custom ? statCols.stats : undefined}
		/>
	);
};
