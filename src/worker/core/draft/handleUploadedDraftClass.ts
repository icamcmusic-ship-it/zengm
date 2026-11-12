// A draft class from a file (the Draft Scouting page's import) or from a linked college league (draft/linkedCollege.ts): replaces the
// class of draftYear, then tops it off with generated prospects if it is short
import { PLAYER } from "../../../common/constants.ts";
import { gameAttributesArrayToObject } from "../../../common/gameAttributesArrayToObject.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, toUI } from "../../util/index.ts";
import { draft, finances, player } from "../index.ts";

const handleUploadedDraftClass = async ({
	uploadedFile,
	draftYear,
}: {
	uploadedFile: any;
	draftYear: number;
}) => {
	// Find season from uploaded file, for age adjusting
	let uploadedSeason: number | undefined;

	if (uploadedFile.gameAttributes) {
		if (Array.isArray(uploadedFile.gameAttributes)) {
			uploadedFile.gameAttributes = gameAttributesArrayToObject(
				uploadedFile.gameAttributes,
			);
		}

		if (uploadedFile.gameAttributes.season !== undefined) {
			uploadedSeason = uploadedFile.gameAttributes.season;
		}
	}

	if (Object.hasOwn(uploadedFile, "startingSeason")) {
		uploadedSeason = uploadedFile.startingSeason;
	}

	// Get all players from uploaded files
	let players: any[] = uploadedFile.players;

	// Filter out any that are not draft prospects
	players = players.filter((p) => p.tid === PLAYER.UNDRAFTED);

	// Handle draft format change in version 33, where PLAYER.UNDRAFTED has multiple draft classes
	if (uploadedFile.version !== undefined && uploadedFile.version >= 33) {
		let filtered = players.filter(
			(p) =>
				p.draft === undefined ||
				p.draft.year === undefined ||
				p.draft.year === "" ||
				p.draft.year === uploadedSeason,
		);

		if (filtered.length === 0) {
			// Try the next season, in case draft already happened
			filtered = players.filter(
				(p) =>
					uploadedSeason !== undefined && p.draft.year === uploadedSeason + 1,
			);
		}

		players = filtered;
	}

	// Get scouting rank, which is used in a couple places below
	const scoutingLevel = await finances.getLevelLastThree("scouting", {
		tid: g.get("userTid"),
	});

	// Delete old players from draft class
	const oldPlayers = await idb.cache.players.indexGetAll(
		"playersByDraftYearRetiredYear",
		[[draftYear], [draftYear, Infinity]],
	);

	const toRemove = [];
	for (const p of oldPlayers) {
		if (p.tid === PLAYER.UNDRAFTED) {
			toRemove.push(p.pid);
		}
	}
	await player.remove(toRemove);

	// Add new players to database
	const addedPlayers = [];
	const newPidsByOldPid = new Map<number, number>();
	for (const p of players) {
		const oldPid = p.pid;

		// Adjust age and seasons
		p.ratings[0].season = draftYear;

		const noDraftProperty = !p.draft;
		if (noDraftProperty) {
			// For college basketball imports
			p.draft = {
				round: 0,
				pick: 0,
				tid: -1,
				originalTid: -1,
				year: draftYear,
				pot: 0,
				ovr: 0,
				skills: [],
			};
		}

		if (uploadedSeason !== undefined) {
			p.born.year = draftYear - (uploadedSeason - p.born.year);
		} else if (noDraftProperty) {
			// Hopefully never happens
			p.born.year = draftYear - 19;
		}

		delete p.numPlayersTradedAwayNormalized;
		p.numDaysFreeAgent = 0;
		p.gamesUntilTradable = 0;
		p.ptModifier = 1;

		// Keep pre-draft (college) stats rows and honors, shifted to the draft year being imported. There is no pro experience for a prospect, so rows are all DOES_NOT_EXIST. Anything else about the stats is dropped, because they can't be pro stats.
		player.prepareUploadedProspectPreDraft(p, {
			draftYear,
			fileSeason: uploadedSeason,
		});

		// Make sure player object is fully defined
		const p2 = await player.augmentPartialPlayer(
			p,
			scoutingLevel,
			uploadedFile.version,
		);
		p2.draft.year = draftYear;
		last(p2.ratings).season = draftYear;
		p2.tid = PLAYER.UNDRAFTED;

		if (Object.hasOwn(p2, "pid")) {
			// @ts-expect-error
			delete p2.pid;
		}

		await player.updateValues(p2);

		await idb.cache.players.add(p2);

		addedPlayers.push(p2);
		if (typeof oldPid === "number") {
			newPidsByOldPid.set(oldPid, p2.pid);
		}
	}

	// pids are different after importing, so relatives can only be kept if they were imported too
	for (const p of addedPlayers) {
		if (p.relatives.length === 0) {
			continue;
		}

		const relatives = [];
		for (const relative of p.relatives) {
			const pid = newPidsByOldPid.get(relative.pid);
			if (pid !== undefined) {
				relatives.push({
					...relative,
					pid,
				});
			}
		}

		if (relatives.length > 0) {
			p.relatives = relatives;
			await idb.cache.players.put(p);
		}
	}

	// "Top off" the draft class if not enough players imported
	await draft.genPlayers(draftYear, scoutingLevel);

	await toUI("realtimeUpdate", [["playerMovement"]]);
};

export default handleUploadedDraftClass;
