// Jersey numbers by team: the best player to wear each number for each franchise, every retired number with what its honoree did in it, and the numbers that look due to be retired.
//
// The number comes from each regular season stats row. A row without one is unknown, never a number: it is counted in unknownRows and left out. Value is the sport's career value stat (win shares in basketball) summed over the rows in that number with that team.

export type JNRow = {
	season: number;
	tid: number;
	number: string | undefined;
	gp: number;
	value: number;
};

export type JNPlayer = {
	pid: number;
	name: string;
	hof: boolean;
	// Current tid (negative for retired, free agent, ...)
	tid: number;
	allStarSeasons: number[];
	// Regular season pro rows
	rows: JNRow[];
};

export type JNRetired = {
	number: string;
	seasonRetired: number;
	pid?: number;
	text: string;
};

export type JNTeam = { tid: number; retired: JNRetired[] };

export type JNStint = {
	pid: number;
	number: string;
	tid: number;
	value: number;
	gp: number;
	seasons: number;
	first: number;
	last: number;
};

export type JNHonor = {
	tid: number;
	number: string;
	pid: number | null;
	name: string;
	seasonRetired: number;
	// Did the honoree wear the number for this team in the stats on file? null if he isn't a player in the league
	wore: boolean | null;
	value: number | null;
	seasons: number | null;
};

export type JNCandidate = {
	tid: number;
	pid: number;
	number: string;
	value: number;
	seasons: number;
	first: number;
	last: number;
	allStar: number;
	hof: boolean;
	active: boolean;
	// Still on this team
	stillHere: boolean;
};

export type JNTeamNumber = {
	number: string;
	wearers: number;
	seasons: number;
	retired: boolean;
	top: JNStint[];
};

export type JerseyNumbersByTeam = {
	byTeam: Map<number, JNTeamNumber[]>;
	retired: JNHonor[];
	candidates: JNCandidate[];
	// Value an unretired stint needs to be a candidate: the median of what honorees produced in their number, clamped
	bar: number;
	knownRows: number;
	unknownRows: number;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

// "0" < "00" < "1" < ... < "99", anything else after
export const cmpNumber = (a: string, b: string) => {
	const na = /^\d+$/.test(a) ? Number(a) : Infinity;
	const nb = /^\d+$/.test(b) ? Number(b) : Infinity;
	if (na !== nb) {
		return na - nb;
	}
	if (a.length !== b.length) {
		return a.length - b.length;
	}
	return a < b ? -1 : a > b ? 1 : 0;
};

const byValue = (a: JNStint, b: JNStint) =>
	b.value - a.value || b.gp - a.gp || a.pid - b.pid;

export const buildJerseyNumbers = (
	players: JNPlayer[],
	teams: JNTeam[],
	{
		defaultBar,
		minBar,
		maxBar,
	}: { defaultBar: number; minBar: number; maxBar: number },
): JerseyNumbersByTeam => {
	const stints = new Map<string, JNStint & { seasonSet: Set<number> }>();
	let knownRows = 0;
	let unknownRows = 0;
	const playerByPid = new Map<number, JNPlayer>();
	for (const p of players) {
		playerByPid.set(p.pid, p);
		for (const r of p.rows) {
			if (r.tid < 0 || !(r.gp > 0)) {
				continue;
			}
			const number = r.number?.trim();
			if (number === undefined || number === "") {
				unknownRows += 1;
				continue;
			}
			knownRows += 1;
			const key = `${p.pid}|${number}|${r.tid}`;
			let x = stints.get(key);
			if (!x) {
				x = {
					pid: p.pid,
					number,
					tid: r.tid,
					value: 0,
					gp: 0,
					seasons: 0,
					first: r.season,
					last: r.season,
					seasonSet: new Set(),
				};
				stints.set(key, x);
			}
			if (Number.isFinite(r.value)) {
				x.value += r.value;
			}
			x.gp += r.gp;
			x.seasonSet.add(r.season);
			x.first = Math.min(x.first, r.season);
			x.last = Math.max(x.last, r.season);
		}
	}
	const stintList: JNStint[] = [];
	for (const { seasonSet, ...x } of stints.values()) {
		stintList.push({ ...x, value: round1(x.value), seasons: seasonSet.size });
	}

	const retiredSet = new Set<string>();
	const honoredPid = new Set<string>();
	const retired: JNHonor[] = [];
	for (const t of teams) {
		for (const j of t.retired) {
			const number = String(j.number).trim();
			if (number === "") {
				continue;
			}
			const p = j.pid !== undefined ? playerByPid.get(j.pid) : undefined;
			const x = p ? stints.get(`${p.pid}|${number}|${t.tid}`) : undefined;
			retired.push({
				tid: t.tid,
				number,
				pid: p ? p.pid : null,
				name: p ? p.name : j.text,
				seasonRetired: j.seasonRetired,
				wore: x ? true : p ? false : null,
				value: x ? round1(x.value) : null,
				seasons: x ? x.seasonSet.size : null,
			});
			retiredSet.add(`${t.tid}|${number}`);
			if (p) {
				honoredPid.add(`${t.tid}|${p.pid}`);
			}
		}
	}
	retired.sort(
		(a, b) =>
			a.tid - b.tid ||
			cmpNumber(a.number, b.number) ||
			a.seasonRetired - b.seasonRetired,
	);

	const byTeamTemp = new Map<number, Map<string, JNStint[]>>();
	for (const x of stintList) {
		let m = byTeamTemp.get(x.tid);
		if (!m) {
			m = new Map();
			byTeamTemp.set(x.tid, m);
		}
		let list = m.get(x.number);
		if (!list) {
			list = [];
			m.set(x.number, list);
		}
		list.push(x);
	}
	const byTeam = new Map<number, JNTeamNumber[]>();
	for (const [tid, m] of byTeamTemp) {
		const out: JNTeamNumber[] = [];
		for (const [number, list] of m) {
			list.sort(byValue);
			out.push({
				number,
				wearers: list.length,
				seasons: list.reduce((a, x) => a + x.seasons, 0),
				retired: retiredSet.has(`${tid}|${number}`),
				top: list.slice(0, 3),
			});
		}
		out.sort((a, b) => cmpNumber(a.number, b.number));
		byTeam.set(tid, out);
	}
	// Teams with retired numbers but no numbers on file still get an entry
	for (const t of teams) {
		if (!byTeam.has(t.tid)) {
			byTeam.set(t.tid, []);
		}
	}

	const honorValues = retired
		.filter((r) => r.value !== null && r.value > 0)
		.map((r) => r.value!)
		.sort((a, b) => a - b);
	const bar =
		honorValues.length >= 4
			? Math.min(
					maxBar,
					Math.max(
						minBar,
						round1(honorValues[Math.floor(honorValues.length / 2)]!),
					),
				)
			: defaultBar;

	const candidates: JNCandidate[] = [];
	for (const x of stintList) {
		if (
			x.value < bar ||
			x.seasons < 3 ||
			retiredSet.has(`${x.tid}|${x.number}`) ||
			honoredPid.has(`${x.tid}|${x.pid}`)
		) {
			continue;
		}
		const p = playerByPid.get(x.pid)!;
		// All-Star seasons in which this team was where he played the most games
		const mainTid = new Map<number, { tid: number; gp: number }>();
		for (const r of p.rows) {
			const cur = mainTid.get(r.season);
			if (!cur || r.gp > cur.gp) {
				mainTid.set(r.season, { tid: r.tid, gp: r.gp });
			}
		}
		let allStar = 0;
		for (const season of p.allStarSeasons) {
			if (mainTid.get(season)?.tid === x.tid) {
				allStar += 1;
			}
		}
		candidates.push({
			tid: x.tid,
			pid: x.pid,
			number: x.number,
			value: x.value,
			seasons: x.seasons,
			first: x.first,
			last: x.last,
			allStar,
			hof: p.hof,
			active: p.tid >= 0,
			stillHere: p.tid === x.tid,
		});
	}
	candidates.sort((a, b) => b.value - a.value || a.pid - b.pid);

	return { byTeam, retired, candidates, bar, knownRows, unknownRows };
};
