import { newLeagueSalt } from "../../../common/leagueSalt.ts";
import g from "../../util/g.ts";
import logEvent from "../../util/logEvent.ts";
import setGameAttributes from "./setGameAttributes.ts";

// God Mode: a new league salt (api rerollLeagueSalt), recorded in leagueSaltHistory and the event log. Returns the old and new salts.
// leagueSaltHistory is optional with no default: unset until a league's first re-roll, and g.get throws on an unset key (sweep10)
const rerollSalt = async () => {
	const from = g.get("leagueSalt") ?? 0;
	let to = newLeagueSalt();
	while (to === from) {
		to = newLeagueSalt();
	}
	const prev = Object.hasOwn(g, "leagueSaltHistory")
		? (g.get("leagueSaltHistory") ?? [])
		: [];
	await setGameAttributes({
		leagueSalt: to,
		leagueSaltHistory: [
			...prev,
			{ season: g.get("season"), phase: g.get("phase"), from, to },
		],
	});
	// A saved event needs pids or tids (sweep10: without them the re-roll threw after saving the salt)
	await logEvent({
		type: "gameAttribute",
		text: `League salt re-rolled (${from} to ${to}): values derived from now on are different.`,
		tids: [],
		showNotification: false,
		score: 0,
	});
	return { from, to };
};

export default rerollSalt;
