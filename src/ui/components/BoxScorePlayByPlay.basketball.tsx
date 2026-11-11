// The play-by-play of a finished basketball game, from the events stored with its box score (game.pbp, see src/common/pbpFlavor/store.ts).
// The text is made by the same code the live view runs, so it reads exactly as it did live. Filters (scoring plays, a team, a player, a
// period) and a replay that steps through the game like the live view.
import clsx from "clsx";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import useLocalStorageState from "use-local-storage-state";
import { TeamLogoInline } from "./TeamLogoInline.tsx";
import { PlayPauseNext } from "./PlayPauseNext.tsx";
import processLiveGameEvents from "../util/processLiveGameEvents.basketball.tsx";
import {
	decodePlayByPlay,
	storedInitEvent,
} from "../../common/pbpFlavor/store.ts";
import { TEAM_NUMS_DISPLAY_ORDER } from "../util/boxScoreDisplayOrder.ts";
import { helpers } from "../util/helpers.ts";
import { getPeriodName } from "../../common/getPeriodName.ts";

type Entry = {
	key: number;
	text: ReactNode;
	t: 0 | 1 | undefined;
	textOnly: boolean;
	time: string | undefined;
	score: [number, number];
	// the team whose points changed the score on this line
	scored: 0 | 1 | undefined;
	period: number;
	pids: number[];
};

const STATS = [
	"min",
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
	"pm",
];

const zeroStats = () => Object.fromEntries(STATS.map((s) => [s, 0]));

// A fresh copy of the box score at tip-off, as the live view starts from
const makeStartingBoxScore = (boxScore: any) => ({
	gid: boxScore.gid,
	numPeriods: boxScore.numPeriods ?? 4,
	quarterLength: boxScore.quarterLength,
	quarter: "",
	time: "",
	teams: boxScore.teams.map((t: any) => ({
		tid: t.tid,
		region: t.region,
		name: t.name,
		abbrev: t.abbrev,
		...zeroStats(),
		ptsQtrs: [] as number[],
		players: t.players.map((p: any) => ({
			pid: p.pid,
			name: p.name,
			pos: p.pos,
			inGame: false,
			injury: { type: "Healthy", gamesRemaining: 0 },
			...zeroStats(),
		})),
	})),
});

const PID_KEYS = [
	"pid",
	"pidAst",
	"pidFoul",
	"pidDefense",
	"pidTov",
	"pidShooting",
	"pid2",
	"pidPass",
];

const pidsOf = (e: any): number[] => {
	if (!e) {
		return [];
	}
	const out: number[] = [];
	for (const key of PID_KEYS) {
		if (typeof e[key] === "number") {
			out.push(e[key]);
		}
	}
	for (const key of ["pids", "pidsOff"]) {
		if (Array.isArray(e[key])) {
			out.push(...e[key]);
		}
	}
	return out;
};

export const buildPlayByPlayEntries = (boxScore: any): Entry[] => {
	const { players, events, rivalry, game } = decodePlayByPlay(boxScore.pbp);
	const box: any = makeStartingBoxScore(boxScore);
	const queue: any[] = [
		storedInitEvent(players, boxScore.teams, rivalry, game),
		...events,
	];
	let overtimes = 0;
	let quarters: string[] = [];
	const entries: Entry[] = [];
	while (queue.length > 0) {
		const ptsKey = box.shootout ? "sPts" : "pts";
		const prev = [box.teams[0][ptsKey] ?? 0, box.teams[1][ptsKey] ?? 0];
		const out = processLiveGameEvents({
			events: queue,
			boxScore: box,
			overtimes,
			quarters,
		});
		overtimes = out.overtimes;
		quarters = out.quarters;
		if (out.text === undefined) {
			continue;
		}
		const ptsKey2 = box.shootout ? "sPts" : "pts";
		const score: [number, number] = [
			box.teams[0][ptsKey2] ?? 0,
			box.teams[1][ptsKey2] ?? 0,
		];
		const scored =
			score[0] !== prev[0] ? 0 : score[1] !== prev[1] ? 1 : undefined;
		entries.push({
			key: entries.length,
			text: out.text,
			t: out.t,
			textOnly: out.textOnly,
			time: box.elamTarget !== undefined ? undefined : box.time,
			score,
			scored,
			period: Math.max(1, box.teams[0].ptsQtrs.length),
			pids: pidsOf(out.event),
		});
	}
	return entries;
};

const periodLabel = (period: number, numPeriods: number) => {
	if (period <= numPeriods) {
		return `${helpers.ordinal(period)} ${getPeriodName(numPeriods)}`;
	}
	const ot = period - numPeriods;
	return ot === 1 ? "Overtime" : `${helpers.ordinal(ot)} overtime`;
};

const periodShort = (period: number, numPeriods: number) => {
	if (period <= numPeriods) {
		return `${getPeriodName(numPeriods, true)}${period}`;
	}
	const ot = period - numPeriods;
	return ot === 1 ? "OT" : `${ot}OT`;
};

const speedToMs = (speed: number) => 4000 / 1.2 ** speed;

const Score = ({ entry }: { entry: Entry }) => {
	return (
		<span className="text-nowrap">
			{TEAM_NUMS_DISPLAY_ORDER.map((t2, i) => (
				<Fragment key={t2}>
					{i > 0 ? "-" : null}
					{t2 === entry.scored ? (
						<b>{entry.score[t2]}</b>
					) : (
						<span className="text-body-secondary">{entry.score[t2]}</span>
					)}
				</Fragment>
			))}
		</span>
	);
};

const Row = ({
	boxScore,
	colors,
	entry,
}: {
	boxScore: any;
	colors: [string, string];
	entry: Entry;
}) => {
	const team = entry.t === undefined ? undefined : boxScore.teams[entry.t];
	return (
		<div
			className={clsx(
				"d-flex py-1 ps-2",
				entry.textOnly ? "fw-bold" : undefined,
			)}
			style={{
				borderLeft: `4px solid ${entry.t === undefined ? "transparent" : colors[entry.t]}`,
			}}
		>
			{team ? (
				<TeamLogoInline
					alt={team.abbrev}
					className="flex-shrink-0 mt-1"
					imgURL={team.imgURL}
					imgURLSmall={team.imgURLSmall}
					includePlaceholderIfNoLogo
				/>
			) : null}
			<div
				className={clsx(
					"flex-grow-1 align-self-center me-1",
					team ? "ms-2" : undefined,
				)}
				style={{ minWidth: 0 }}
			>
				{!entry.textOnly ? (
					<div className="d-flex small">
						{entry.time ? (
							<div className="text-body-secondary me-auto">{entry.time}</div>
						) : (
							<div className="me-auto" />
						)}
						<Score entry={entry} />
					</div>
				) : null}
				{entry.text}
			</div>
		</div>
	);
};

type Filters = {
	kind: "all" | "scoring";
	team: "all" | "0" | "1";
	player: string;
	period: string;
};

const DEFAULT_FILTERS: Filters = {
	kind: "all",
	team: "all",
	player: "all",
	period: "all",
};

const matches = (entry: Entry, filters: Filters) => {
	if (filters.kind === "scoring" && entry.scored === undefined) {
		return false;
	}
	if (filters.team !== "all") {
		// a team's plays: its own, and its points
		const t = Number(filters.team);
		if (entry.t !== t && entry.scored !== t) {
			return false;
		}
	}
	if (
		filters.player !== "all" &&
		!entry.pids.includes(Number(filters.player))
	) {
		return false;
	}
	if (filters.period !== "all" && entry.period !== Number(filters.period)) {
		return false;
	}
	return true;
};

const PlayByPlayInner = ({ boxScore }: { boxScore: any }) => {
	const entries = useMemo(() => {
		try {
			return buildPlayByPlayEntries(boxScore);
		} catch (error) {
			console.error(error);
			return undefined;
		}
	}, [boxScore]);

	const [filters, setFilters] = useState(DEFAULT_FILTERS);
	const [replay, setReplay] = useState<
		{ idx: number; paused: boolean } | undefined
	>();
	const [speed, setSpeed] = useLocalStorageState("live-game-speed", {
		defaultValue: "7",
	});

	const numEntries = entries?.length ?? 0;

	useEffect(() => {
		if (!replay || replay.paused) {
			return;
		}
		if (replay.idx >= numEntries - 1) {
			setReplay((r) => (r ? { ...r, paused: true } : r));
			return;
		}
		const id = setTimeout(
			() => {
				setReplay((r) => (r ? { ...r, idx: r.idx + 1 } : r));
			},
			speedToMs(Number.parseInt(speed)),
		);
		return () => {
			clearTimeout(id);
		};
	}, [replay, numEntries, speed]);

	const onPlay = useCallback(() => {
		setReplay((r) => (r ? { ...r, paused: false } : r));
	}, []);
	const onPause = useCallback(() => {
		setReplay((r) => (r ? { ...r, paused: true } : r));
	}, []);
	const onNext = useCallback(() => {
		setReplay((r) =>
			r ? { ...r, idx: Math.min(numEntries - 1, r.idx + 1) } : r,
		);
	}, [numEntries]);

	if (!entries) {
		return (
			<p className="text-danger">
				The play-by-play of this game could not be read.
			</p>
		);
	}

	const numPeriods = boxScore.numPeriods ?? 4;
	const periods = [...new Set(entries.map((e) => e.period))];
	const colors: [string, string] = [
		boxScore.teams[0].colors?.[0] ?? "#888",
		boxScore.teams[1].colors?.[0] ?? "#888",
	];
	if (colors[0] === colors[1]) {
		colors[1] = boxScore.teams[1].colors?.[1] ?? colors[1];
	}

	// Moves the replay ahead to the first play that stop accepts, looking at each play and the one after it
	const fastForwardTo = (
		stop: (e: Entry, next: Entry | undefined) => boolean,
	) => {
		setReplay((r) => {
			if (!r) {
				return r;
			}
			let idx = r.idx + 1;
			while (
				idx < entries.length - 1 &&
				!stop(entries[idx]!, entries[idx + 1])
			) {
				idx += 1;
			}
			return { ...r, idx: Math.min(idx, entries.length - 1) };
		});
	};

	let shown: Entry[];
	let current: Entry | undefined;
	if (replay) {
		current = entries[replay.idx];
		shown = entries
			.slice(0, replay.idx + 1)
			.filter((e) => matches(e, filters))
			.reverse();
	} else {
		shown = entries.filter((e) => matches(e, filters));
	}

	const select = (
		label: string,
		value: string,
		onChange: (value: string) => void,
		options: ReactNode,
	) => (
		<select
			aria-label={label}
			className="form-select form-select-sm w-auto"
			value={value}
			onChange={(event) => {
				onChange(event.target.value);
			}}
		>
			{options}
		</select>
	);

	return (
		<div>
			<div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
				{select(
					"Plays",
					filters.kind,
					(kind) => {
						setFilters({ ...filters, kind: kind as Filters["kind"] });
					},
					<>
						<option value="all">All plays</option>
						<option value="scoring">Scoring plays</option>
					</>,
				)}
				{select(
					"Team",
					filters.team,
					(team) => {
						setFilters({ ...filters, team: team as Filters["team"] });
					},
					<>
						<option value="all">Both teams</option>
						{TEAM_NUMS_DISPLAY_ORDER.map((t) => (
							<option key={t} value={String(t)}>
								{boxScore.teams[t].abbrev}
							</option>
						))}
					</>,
				)}
				{select(
					"Player",
					filters.player,
					(player) => {
						setFilters({ ...filters, player });
					},
					<>
						<option value="all">All players</option>
						{TEAM_NUMS_DISPLAY_ORDER.map((t) => (
							<optgroup key={t} label={boxScore.teams[t].abbrev}>
								{boxScore.teams[t].players
									.filter((p: any) => p.min > 0)
									.map((p: any) => (
										<option key={p.pid} value={String(p.pid)}>
											{p.name}
										</option>
									))}
							</optgroup>
						))}
					</>,
				)}
				{select(
					"Period",
					filters.period,
					(period) => {
						setFilters({ ...filters, period });
					},
					<>
						<option value="all">Whole game</option>
						{periods.map((period) => (
							<option key={period} value={String(period)}>
								{periodLabel(period, numPeriods)}
							</option>
						))}
					</>,
				)}
				{filters !== DEFAULT_FILTERS ? (
					<button
						className="btn btn-link btn-sm p-0"
						onClick={() => {
							setFilters(DEFAULT_FILTERS);
						}}
					>
						Reset
					</button>
				) : null}
				<div className="ms-auto">
					{replay ? (
						<button
							className="btn btn-secondary btn-sm"
							onClick={() => {
								setReplay(undefined);
							}}
						>
							Show all
						</button>
					) : (
						<button
							className="btn btn-primary btn-sm"
							onClick={() => {
								setReplay({ idx: 0, paused: false });
							}}
						>
							Replay
						</button>
					)}
				</div>
			</div>

			{replay && current ? (
				<div className="d-flex flex-wrap align-items-center gap-2 mb-2 p-2 rounded bg-body-tertiary">
					<div className="fw-bold me-auto">
						{TEAM_NUMS_DISPLAY_ORDER.map((t, i) => (
							<Fragment key={t}>
								{i > 0 ? " - " : null}
								<span
									className="d-inline-block me-1"
									style={{
										width: 10,
										height: 10,
										backgroundColor: colors[t],
										borderRadius: 2,
									}}
								/>
								{boxScore.teams[t].abbrev} {current.score[t]}
							</Fragment>
						))}
						<span className="text-body-secondary fw-normal ms-2">
							{periodShort(current.period, numPeriods)}
							{current.time ? ` ${current.time}` : null}
						</span>
					</div>
					<PlayPauseNext
						disabled={replay.idx >= entries.length - 1}
						fastForwardAlignRight
						fastForwards={[
							{
								label: "Next score",
								keyboardShortcut: "g",
								onClick: () => {
									fastForwardTo((e) => e.scored !== undefined);
								},
							},
							{
								label: `End of ${getPeriodName(numPeriods)}`,
								keyboardShortcut: "q",
								onClick: () => {
									fastForwardTo((e, next) => next?.period !== e.period);
								},
							},
						]}
						onPlay={onPlay}
						onPause={onPause}
						onNext={onNext}
						paused={replay.paused}
						titlePlay="Resume replay"
						titlePause="Pause replay"
						titleNext="Show next play"
					/>
					<input
						type="range"
						className="form-range"
						style={{ width: 100 }}
						min="1"
						max="33"
						step="1"
						value={speed}
						onChange={(event) => {
							setSpeed(event.target.value);
						}}
						title="Speed"
					/>
				</div>
			) : null}

			{shown.length === 0 ? (
				<p className="text-body-secondary">No plays match.</p>
			) : null}
			<div className="d-flex flex-column gap-1">
				{shown.map((entry, i) => {
					const prev = shown[i - 1];
					const header =
						!replay &&
						filters.period === "all" &&
						(i === 0 || prev!.period !== entry.period);
					return (
						<Fragment key={entry.key}>
							{header ? (
								<h3 className={clsx("h6 mb-0", i > 0 ? "mt-3" : undefined)}>
									{periodLabel(entry.period, numPeriods)}
								</h3>
							) : null}
							<Row boxScore={boxScore} colors={colors} entry={entry} />
						</Fragment>
					);
				})}
			</div>
		</div>
	);
};

export const BoxScorePlayByPlay = ({ boxScore }: { boxScore: any }) => {
	// (a new game starts over: filters and replay)
	return <PlayByPlayInner key={boxScore.gid} boxScore={boxScore} />;
};
