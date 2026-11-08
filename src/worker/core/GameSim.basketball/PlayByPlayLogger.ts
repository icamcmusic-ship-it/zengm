import type { TeamNum } from "../../../common/types";
import { PlayByPlayLoggerBase } from "../GameSim/PlayByPlayLoggerBase.ts";

export type BlockType =
	| "blkAtRim"
	| "blkLowPost"
	| "blkMidRange"
	| "blkTp"
	| "blkTipIn"
	| "blkPutBack";
export type FgaType = "fgaAtRim" | "fgaLowPost" | "fgaMidRange" | "fgaPutBack";
export type FgMissType =
	| "missPutBack"
	| "missAtRim"
	| "missLowPost"
	| "missMidRange"
	| "missTp"
	| "missTipIn";
export type FgMakeNormalType = // fgAtRim/AndOne, ft,fgPutBack/AndOne excluded because they are handled separately
	| "fgLowPost"
	| "fgLowPostAndOne"
	| "fgMidRange"
	| "fgMidRangeAndOne"
	| "tp"
	| "tpAndOne"
	| "fgTipIn"
	| "fgTipInAndOne";

type FgMakeWithoutAstType = "fgPutBack" | "fgPutBackAndOne";
type FgMakeWithDefenderType = "fgAtRimAndOne" | "fgAtRim";
export type FgMakeType =
	| FgMakeNormalType
	| FgMakeWithoutAstType
	| FgMakeWithDefenderType;
type PlayByPlayEventInputScore =
	| {
			type: FgMakeWithDefenderType;
			t: TeamNum;
			pid: number;
			pidDefense: number;
			pidAst: number | undefined;
			clock: number;
			pidFoul: number | undefined;
	  }
	| {
			type: FgMakeNormalType;
			t: TeamNum;
			pid: number;
			pidAst: number | undefined;
			clock: number;
			pidFoul: number | undefined;
	  }
	| {
			type: FgMakeWithoutAstType;
			t: TeamNum;
			pid: number;
			clock: number;
			pidFoul: number | undefined;
	  }
	| {
			type: "ft";
			t: TeamNum;
			pid: number;
			clock: number;
			// The free throw of a technical foul (possession does not change)
			tech?: boolean;
	  };

type PlayByPlayEventInputNoScore =
	| {
			type:
				| BlockType
				| FgMissType
				| "pfNonShooting"
				| "drb"
				| "orb"
				| "foulOut"
				| "injury";
			t: TeamNum;
			pid: number;
			clock: number;
	  }
	| {
			type: "missFt";
			t: TeamNum;
			pid: number;
			clock: number;
			// The free throw of a technical foul (possession does not change)
			tech?: boolean;
	  }
	| {
			// A technical foul on a player (pid) or on the bench/coach (pid undefined). num is how many he has this game
			type: "techFoul";
			t: TeamNum;
			pid: number | undefined;
			num: number;
			clock: number;
	  }
	| {
			type: "flagrantFoul";
			t: TeamNum;
			pid: number;
			pidShooting: number;
			level: 1 | 2;
			clock: number;
	  }
	| {
			// A player (or, with pid undefined, the coach) is ejected
			type: "ejection";
			t: TeamNum;
			pid: number | undefined;
			reason: "flagrant2" | "flagrants" | "techs";
			clock: number;
	  }
	| {
			type: FgaType;
			t: TeamNum;
			pid: number;
			clock: number;
			// Seconds the possession had lasted when the play happened. Only used to word the play-by-play, never by the sim.
			poss?: number;
	  }
	| {
			type: "jumpBall";
			t: TeamNum;
			pid: number;
			pid2: number;
			clock: number;
	  }
	| {
			type: "fgaTp" | "fgaTpFake";
			t: TeamNum;
			pid: number;
			clock: number;
			desperation: boolean;
			poss?: number;
	  }
	| {
			type: "fgaTipIn";
			t: TeamNum;
			pid: number;
			clock: number;
			pidPass: number;
			poss?: number;
	  }
	| {
			type: "gameOver";
	  }
	| {
			type: "overtime";
			clock: number;
			period: number;
	  }
	| {
			type: "pfBonus" | "pfFG" | "pfTP";
			t: TeamNum;
			pid: number;
			pidShooting: number;
			clock: number;
	  }
	| {
			type: "period";
			clock: number;
			period: number;
	  }
	| {
			type: "stl";
			t: TeamNum;
			pid: number;
			pidTov: number;
			outOfBounds: boolean;
			clock: number;
			poss?: number;
	  }
	| {
			type: "sub";
			t: TeamNum;
			pids: number[];
			pidsOff: number[];
			clock: number;
	  }
	| {
			type: "tov";
			t: TeamNum;
			pid: number;
			outOfBounds: boolean;
			clock: number;
			poss?: number;
	  }
	| {
			type: "elamActive";
			target: number;
	  }
	| {
			type: "timeout";
			t: TeamNum;
			numLeft: number;
			advancesBall: boolean;
			clock: number;
	  }
	| {
			type: "endOfPeriod";
			t: TeamNum;
			reason: "runOutClock" | "noShot" | "intentionalFoul";
			clock: number;
	  }
	| {
			type: "outOfBounds";
			t: TeamNum;
			on: "offense" | "defense";
			clock: number;
	  }
	| {
			type: "shootoutStart";
			rounds: number;
			clock: number;
	  }
	| {
			type: "shootoutTeam";
			t: TeamNum;
			pid: number;
	  }
	| {
			type: "shootoutShot";
			t: TeamNum;
			pid: number;
			made: boolean;
	  }
	| {
			type: "shootoutTie";
	  }
	| {
			type: "timeouts";
			timeouts: [number, number];
	  };

type PlayByPlayEventInput =
	| PlayByPlayEventInputScore
	| PlayByPlayEventInputNoScore;

// Only add period to scoring events, since they are used for scoringSummary
type PlayByPlayEventScore = PlayByPlayEventInputScore & { period: number };

export type PlayByPlayEventOutput =
	| PlayByPlayEventScore
	| PlayByPlayEventInputNoScore;

const scoringTypes: Set<PlayByPlayEventInput["type"]> = new Set([
	"fgAtRim",
	"fgAtRimAndOne",
	"fgLowPost",
	"fgLowPostAndOne",
	"fgMidRange",
	"fgMidRangeAndOne",
	"ft",
	"tp",
	"tpAndOne",
] satisfies PlayByPlayEventInputScore["type"][]);

const isScoringPlay = (
	event: PlayByPlayEventInput,
): event is PlayByPlayEventInputScore => {
	return scoringTypes.has(event.type);
};

// The stats a stored play-by-play needs (the running box score of the text). The others (minutes, shot zones, gp) are only logged for the live view
export const STORED_STATS = new Set([
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"ba",
	"pf",
	"pts",
	"gs",
	"sPts",
	"sAtt",
]);

// Clocks are logged to the hundredth of a second, so that a stored play-by-play (src/common/pbpStore.basketball.ts) holds exactly what the
// live view saw
const round2 = (x: number) =>
	Number.isFinite(x) ? Math.round(x * 100) / 100 : x;

class BasketballPlayByPlayLogger extends PlayByPlayLoggerBase<PlayByPlayEventOutput> {
	private period = 1;

	// false when the events are only logged to be stored with the box score (no live view): then only the stats the text needs are logged
	live: boolean;

	constructor(active: boolean, live: boolean = active) {
		super(active);
		this.live = live;
	}

	override logStat(
		t: TeamNum,
		pid: number | undefined | null,
		s: string,
		amt: number,
	) {
		if (!this.live && !STORED_STATS.has(s)) {
			return;
		}
		super.logStat(t, pid, s, amt);
	}

	logEvent(event: PlayByPlayEventInput) {
		if (!this.active) {
			return;
		}

		const anyEvent = event as any;
		if (typeof anyEvent.clock === "number" || typeof anyEvent.poss === "number") {
			event = { ...event };
			const e2 = event as any;
			if (typeof e2.clock === "number") {
				e2.clock = round2(e2.clock);
			}
			if (typeof e2.poss === "number") {
				e2.poss = round2(e2.poss);
			}
		}

		if (event.type === "period" || event.type === "overtime") {
			this.period = event.period;
		}

		if (isScoringPlay(event)) {
			this.playByPlay.push({
				...event,
				period: this.period,
			});
		} else {
			this.playByPlay.push(event);
		}
	}
}

export default BasketballPlayByPlayLogger;
