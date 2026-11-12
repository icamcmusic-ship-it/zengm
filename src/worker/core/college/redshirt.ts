// College mode: redshirts (docs/college-mode.md, Redshirts). A redshirted player practices with the team but does not play in games, and the
// season does not count against his four years of eligibility: p.redshirt is the season he sits out.
import type { Player } from "../../../common/types.ts";
import { g } from "../../util/index.ts";

export const isRedshirting = (p: Pick<Player, "tid"> & { redshirt?: number }) =>
	p.redshirt !== undefined && p.redshirt === g.get("season") && p.tid >= 0;
