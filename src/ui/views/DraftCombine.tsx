import { DataTable } from "../components/DataTable/index.tsx";
import type { Col } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import {
	COMBINE_COLUMNS,
	COMBINE_COLUMN_BY_KEY,
	type CombineKey,
} from "../../common/draftCombine.ts";

type Prospect = View<"draftCombine">["players"][number];

const valueOf = (p: Prospect, key: CombineKey): number | undefined =>
	key in p.measurements
		? p.measurements[key as keyof Prospect["measurements"]]
		: p.drills?.[key as keyof NonNullable<Prospect["drills"]>];

const SKIP_TEXT = {
	injured: "Skipped the drills (injured)",
	topProspect: "Skipped the drills (top prospect)",
	personal: "Skipped the drills",
} as const;

const NameLink = ({ p }: { p: Prospect }) => (
	<a href={helpers.leagueUrl(["player", p.pid])}>
		{p.firstName} {p.lastName}
	</a>
);

const LEADER_KEYS: CombineKey[] = [
	"wingspan",
	"standingReach",
	"maxVert",
	"standingVert",
	"laneAgility",
	"shuttle",
	"sprint",
	"bench",
	"spotUp",
	"offDribble",
	"freeThrows",
	"handLength",
];

const Leaders = ({ players }: { players: Prospect[] }) => {
	return (
		<div className="row g-2 mb-3">
			{LEADER_KEYS.map((key) => {
				const col = COMBINE_COLUMN_BY_KEY[key];
				const top = players
					.filter((p) => p.ranks[key] !== undefined)
					.sort((a, b) => a.ranks[key]!.rank - b.ranks[key]!.rank)
					.slice(0, 3);
				if (top.length === 0) {
					return null;
				}
				return (
					<div key={key} className="col-12 col-sm-6 col-lg-4 col-xl-3">
						<div className="card h-100">
							<div className="card-body p-2">
								<div className="fw-bold small text-body-secondary">
									{col.name}
								</div>
								<ol className="mb-0 ps-3 small">
									{top.map((p) => (
										<li key={p.pid}>
											<NameLink p={p} />{" "}
											<span className="fw-bold">
												{col.format(valueOf(p, key)!)}
											</span>
										</li>
									))}
								</ol>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
};

// Standouts and disappointments by the average percentile of the agility, speed and leaping drills
const Standouts = ({ players }: { players: Prospect[] }) => {
	const tested = players.filter((p) => p.athletic !== undefined);
	if (tested.length < 6) {
		return null;
	}
	const sorted = [...tested].sort(
		(a, b) => b.athletic! - a.athletic! || a.pid - b.pid,
	);
	const best = (p: Prospect) => {
		let out: { key: CombineKey; pct: number } | undefined;
		for (const [key, r] of Object.entries(p.ranks)) {
			const col = COMBINE_COLUMN_BY_KEY[key as CombineKey];
			if (col.group === "measurement" || !r) {
				continue;
			}
			if (!out || r.pct > out.pct) {
				out = { key: key as CombineKey, pct: r.pct };
			}
		}
		return out;
	};
	const worst = (p: Prospect) => {
		let out: { key: CombineKey; pct: number } | undefined;
		for (const [key, r] of Object.entries(p.ranks)) {
			const col = COMBINE_COLUMN_BY_KEY[key as CombineKey];
			if (col.group === "measurement" || !r) {
				continue;
			}
			if (!out || r.pct < out.pct) {
				out = { key: key as CombineKey, pct: r.pct };
			}
		}
		return out;
	};
	const list = (ps: Prospect[], good: boolean) => (
		<ul className="list-unstyled mb-0">
			{ps.map((p) => {
				const x = good ? best(p) : worst(p);
				const col = x ? COMBINE_COLUMN_BY_KEY[x.key] : undefined;
				const v = x ? valueOf(p, x.key) : undefined;
				return (
					<li key={p.pid} className="mb-1">
						<NameLink p={p} />{" "}
						<span className="text-body-secondary">{p.pos}</span>{" "}
						<span
							className={good ? "text-success fw-bold" : "text-danger fw-bold"}
						>
							{p.athletic}
						</span>
						{col && v !== undefined ? (
							<div className="small text-body-secondary">
								{good ? "Best" : "Worst"}: {col.name.toLowerCase()}{" "}
								{col.format(v)} ({helpers.ordinal(p.ranks[x!.key]!.rank)})
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
	return (
		<div className="row g-3 mb-3">
			<div className="col-12 col-md-6">
				<h3>Standouts</h3>
				{list(sorted.slice(0, 5), true)}
			</div>
			<div className="col-12 col-md-6">
				<h3>Disappointments</h3>
				{list(sorted.slice(-5).reverse(), false)}
			</div>
		</div>
	);
};

const DraftCombine = ({
	held,
	numProspects,
	players,
	season,
	upcoming,
}: View<"draftCombine">) => {
	useTitleBar({
		title: `${season} Draft Combine`,
		dropdown: {
			view: "draftCombine",
			fields: [{ key: "season", options: { type: "seasons" }, value: season }],
		},
	});

	if (!held) {
		return (
			<p>
				{upcoming
					? `The ${season} draft combine is held at the start of the draft lottery phase, after the playoffs. ${numProspects} prospects are in the class right now; about the top 1.25 per draft pick will be invited.`
					: `No combine was held for the ${season} draft class.`}
			</p>
		);
	}
	if (players.length === 0) {
		return <p>No prospects were measured at the {season} draft combine.</p>;
	}

	const numSkipped = players.filter((p) => !p.drills).length;
	const showDraft = players.some((p) => p.draft);

	const cols: Col[] = [
		{ title: "Name", sortType: "name" },
		{ title: "Pos" },
		{ title: "Age", sortType: "number" },
		...(showDraft
			? [
					{
						title: "Pick",
						desc: "Draft pick",
						sortType: "number",
					} as Col,
				]
			: []),
		...COMBINE_COLUMNS.map(
			(c): Col => ({
				title: c.short,
				desc: c.lowerBetter ? `${c.name} (lower is better)` : c.name,
				sortType: "number",
				sortSequence: c.lowerBetter ? ["asc", "desc"] : ["desc", "asc"],
			}),
		),
		{
			title: "Ath",
			desc: "Athletic score: average percentile in the lane agility, shuttle, sprint and vertical jumps",
			sortType: "number",
			sortSequence: ["desc", "asc"],
		},
	];

	const rows = players.map((p) => ({
		key: p.pid,
		data: [
			{
				value: <NameLink p={p} />,
				sortValue: `${p.lastName} ${p.firstName}`,
				searchValue: `${p.firstName} ${p.lastName}`,
			},
			p.pos,
			p.age,
			...(showDraft
				? [
						p.draft
							? {
									value: `${p.draft.round}-${p.draft.pick} ${p.draft.abbrev}`,
									sortValue: 1000 * p.draft.round + p.draft.pick,
								}
							: { value: "", sortValue: 99999 },
					]
				: []),
			...COMBINE_COLUMNS.map((c) => {
				const v = valueOf(p, c.key);
				const r = p.ranks[c.key];
				if (v === undefined) {
					return {
						value: (
							<span
								className="text-body-secondary"
								title={p.skipped ? SKIP_TEXT[p.skipped] : undefined}
							>
								DNP
							</span>
						),
						sortValue: null,
					};
				}
				const hi = !c.neutral && r && r.n >= 10 && r.rank <= 5;
				const lo = !c.neutral && r && r.n >= 10 && r.rank > r.n - 5;
				return {
					value: c.format(v),
					sortValue: v,
					classNames: hi ? "table-success" : lo ? "table-danger" : undefined,
				};
			}),
			p.athletic ?? null,
		],
	}));

	return (
		<>
			<p>
				{players.length} prospects measured at the {season} draft combine
				{numSkipped > 0
					? `, ${numSkipped} of them skipped the drills (DNP)`
					: ""}
				. Green and red cells are the top and bottom 5 of each test. Shooting
				drills are makes out of the attempts.
			</p>
			<Standouts players={players} />
			<h3>Top performers</h3>
			<Leaders players={players} />
			<DataTable
				cols={cols}
				defaultSort={[COMBINE_COLUMNS.length + (showDraft ? 4 : 3), "desc"]}
				name="DraftCombine"
				rows={rows}
				pagination={false}
			/>
		</>
	);
};

export default DraftCombine;
