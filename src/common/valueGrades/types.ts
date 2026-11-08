// Plain-data snapshot of a league that the Trade grader and Contract value engines read. The worker builds it from the database (see worker/util/valueData.ts), tests build it by hand. Basketball only: value is regular-season win shares (ows + dws).

// A pro regular-season or playoffs stats row. i is the row's index in the player's full p.stats array, which is what trade events point at (statsIndex). ws is null when the row has no win-share figure (old or imported data): unknown, never 0.
export type VRow = {
	i: number;
	season: number;
	tid: number;
	playoffs: boolean;
	gp: number | null;
	min: number;
	ws: number | null;
};

export type VTransaction = {
	type: string;
	tid: number;
	season: number;
	phase: number;
	eid?: number;
};

export type VContract = {
	type: string;
	eid?: number;
	start: number;
	amounts: number[];
	payments: { season: number; tid: number; amount: number }[];
	endedEarly?: {
		season: number;
		phase: number;
		reason: string;
		tid?: number;
	};
};

export type VPlayer = {
	pid: number;
	name: string;
	tid: number;
	retiredYear: number;
	bornYear: number;
	draft: {
		year: number;
		round: number;
		pick: number;
		tid: number;
		originalTid: number;
		dpid?: number;
	};
	// Pro rows only (pre-draft college rows are left out), oldest first
	rows: VRow[];
	transactions: VTransaction[];
	contracts: VContract[];
};

export type VPickAsset = {
	dpid: number;
	season: number | string;
	round: number;
	originalTid: number;
};
export type VPlayerAsset = {
	pid: number;
	name: string;
	statsIndex?: number;
};
export type VAsset = VPlayerAsset | VPickAsset;

// assets[i] is what tids[i] received
export type VTrade = {
	eid: number;
	season: number;
	phase: number;
	tids: [number, number];
	assets: [VAsset[], VAsset[]];
};

export type VTeamSeason = {
	tid: number;
	season: number;
	won: number;
	lost: number;
	// Won the title
	champ?: boolean;
};

export type VLeague = {
	season: number;
	phase: number;
	players: VPlayer[];
	trades: VTrade[];
	teamSeasons: VTeamSeason[];
};

export const isPickAsset = (a: VAsset): a is VPickAsset => "dpid" in a;
