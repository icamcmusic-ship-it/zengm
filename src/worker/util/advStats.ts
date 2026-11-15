import { registerGlobal } from "../../common/registerGlobal.ts";
import { bySport } from "../../common/sportFunctions.ts";
import advStatsBaseball from "./advStats.baseball.ts";
import advStatsBasketball from "./advStats.basketball.ts";
import advStatsFootball from "./advStats.football.ts";
import advStatsHockey from "./advStats.hockey.ts";
import { setAdvStatsCompute, runAdvStats } from "./advStatsFlush.ts";

export { advStatsAfterDay, advStatsRunCount } from "./advStatsFlush.ts";

setAdvStatsCompute(() =>
	bySport({
		baseball: advStatsBaseball,
		basketball: advStatsBasketball,
		football: advStatsFootball,
		hockey: advStatsHockey,
	})(),
);

export const advStats = () => runAdvStats();

registerGlobal({ advStats });
