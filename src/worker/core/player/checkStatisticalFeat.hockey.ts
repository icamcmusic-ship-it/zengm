import type { GamePlayer } from "../../../common/types.ts";

const checkStatisticalFeat = (
	p: GamePlayer,
	_teamStat: unknown,
	{ factor: minFactor, playoffs }: { factor: number; playoffs: boolean },
) => {
	const FIVE = minFactor * 5;
	const FOUR = minFactor * 4;
	const THREE = minFactor * 3;

	const statArr: any = {};

	const goals = p.stat.evG + p.stat.ppG + p.stat.shG;
	const assists = p.stat.evA + p.stat.ppA + p.stat.shA;

	if (goals >= THREE) {
		statArr.goals = goals;
	}

	if (goals + assists >= FOUR) {
		statArr.goals = goals;
		statArr.assists = assists;
	}

	if (p.stat.so > 0) {
		statArr.shutouts = p.stat.so;
	}

	if (Object.keys(statArr).length > 0) {
		let score = goals + assists >= FIVE ? 20 : 10;
		if (playoffs) {
			score += 10;
		}

		return {
			feats: statArr,
			score,
		};
	}

	return {
		score: 0,
	};
};

export default checkStatisticalFeat;
