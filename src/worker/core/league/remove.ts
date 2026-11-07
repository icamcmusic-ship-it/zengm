import { deleteDB } from "@dumbmatter/idb";
import close from "./close.ts";
import { idb } from "../../db/index.ts";
import { g, logEvent } from "../../util/index.ts";
import { forgetLeague } from "../../util/wrappedPersist.ts";

const remove = async (lid: number) => {
	if (g.get("lid") === lid) {
		await close(true);
	}

	await idb.meta.delete("leagues", lid);
	// What was kept of the league for Wrapped and Storylines
	await forgetLeague(lid);
	await deleteDB(`league${lid}`, {
		blocked() {
			logEvent({
				type: "error",
				text: "Please close any other open tabs.",
				saveToDb: false,
			});
		},
	});
};

export default remove;
