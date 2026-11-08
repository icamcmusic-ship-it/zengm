import { useMemo, useState, type ReactNode } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { DataTable } from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { WrappedLoading } from "../Wrapped/Loading.tsx";
import {
	RARITY_CLASS,
	RARITY_HINT,
	RARITY_LABEL,
	type Rarity,
	type Who,
} from "../../../common/leagueAchievements/labels.ts";
import type { LeagueAchievementItem } from "../../../worker/views/leagueAchievements.ts";

type LoadedData = Extract<View<"leagueAchievements">, { loading: false }>;

const RARITIES: Rarity[] = ["common", "rare", "legendary", "impossible"];
const STATUSES = ["all", "unlocked", "locked", "unavailable"] as const;
type Status = (typeof STATUSES)[number];

// A locked tier never reads 100%: floor, capped at 99 below the threshold
const pctOf = (p: number) => {
	const x = Math.max(0, Math.min(1, p || 0));
	return x >= 1 ? 100 : Math.min(99, Math.floor(x * 100));
};

export const RarityBadge = ({ rarity }: { rarity: Rarity }) => (
	<span
		className={`badge ${RARITY_CLASS[rarity]}`}
		title={`${RARITY_LABEL[rarity]}: ${RARITY_HINT[rarity]}`}
	>
		{RARITY_LABEL[rarity]}
	</span>
);

const ProgressBar = ({
	progress,
	label,
	small,
}: {
	progress: number;
	label: string;
	small?: boolean;
}) => {
	const pct = pctOf(progress);
	return (
		<div
			className="progress"
			role="progressbar"
			aria-label={`${label}: ${pct}%`}
			aria-valuenow={pct}
			aria-valuemin={0}
			aria-valuemax={100}
			style={{ height: small ? 6 : 10 }}
		>
			<div className="progress-bar" style={{ width: `${pct}%` }} />
		</div>
	);
};

const rosterUrl = (abbrev: string, tid: number, season: number | undefined) =>
	helpers.leagueUrl(
		season === undefined
			? ["roster", `${abbrev}_${tid}`]
			: ["roster", `${abbrev}_${tid}`, season],
	);

// "LeBron James (CLE) vs BOS, 2031, box score" with links
export const WhoLine = ({ who }: { who: Who | undefined }) => {
	if (!who) {
		return null;
	}
	const parts: ReactNode[] = [];
	if (who.pid !== undefined) {
		parts.push(
			<a key="p" href={helpers.leagueUrl(["player", who.pid])}>
				{who.name}
			</a>,
		);
	}
	if (who.pid2 !== undefined) {
		parts.push(
			<span key="p2">
				and <a href={helpers.leagueUrl(["player", who.pid2])}>{who.name2}</a>
			</span>,
		);
	}
	if (who.tid !== undefined && who.abbrev) {
		parts.push(
			<a
				key="t"
				href={rosterUrl(who.abbrev, who.tid, who.season)}
				title={who.team}
			>
				{who.pid === undefined ? who.team : who.abbrev}
			</a>,
		);
	}
	if (who.tid2 !== undefined && who.abbrev2) {
		parts.push(
			<span key="t2">
				vs{" "}
				<a href={rosterUrl(who.abbrev2, who.tid2, who.season)}>{who.abbrev2}</a>
			</span>,
		);
	}
	if (who.note) {
		parts.push(
			<span key="n" className="text-body-secondary">
				{who.note}
			</span>,
		);
	}
	if (who.season !== undefined) {
		parts.push(
			<a key="s" href={helpers.leagueUrl(["history", who.season])}>
				{who.season}
			</a>,
		);
	}
	if (who.gid !== undefined && who.tid !== undefined && who.abbrev) {
		parts.push(
			<a
				key="g"
				href={helpers.leagueUrl([
					"game_log",
					`${who.abbrev}_${who.tid}`,
					who.season!,
					who.gid,
				])}
			>
				box score
			</a>,
		);
	}
	return (
		<>
			{parts.map((x, i) => (
				<span key={i}>
					{i > 0 ? " · " : null}
					{x}
				</span>
			))}
		</>
	);
};

const ItemRow = ({
	item,
	highlight,
}: {
	item: LeagueAchievementItem;
	highlight?: boolean;
}) => {
	const unlocked = item.state === "unlocked";
	return (
		<li
			className={`list-group-item league-ach-item${highlight ? " list-group-item-info" : ""}`}
			id={`ach-${item.id}`}
			data-state={item.state}
		>
			<div className="row g-2 align-items-center">
				<div className="col-12 col-md-7">
					<div className="d-flex flex-wrap align-items-center gap-2">
						<RarityBadge rarity={item.rarity} />
						<a
							className={`fw-bold${unlocked ? "" : " text-body"}`}
							href={helpers.leagueUrl(["league_achievements", "all", item.id])}
						>
							{item.name}
						</a>
						{unlocked ? (
							<span className="text-success" aria-label="Unlocked">
								<span className="glyphicon glyphicon-ok" /> Unlocked
								{item.count > 1 ? ` ×${item.count}` : ""}
							</span>
						) : null}
					</div>
					<div className={`small${unlocked ? "" : " text-body-secondary"}`}>
						{item.desc}
					</div>
				</div>
				<div className="col-12 col-md-5 small">
					{item.state === "unavailable" ? (
						<span className="text-body-secondary">
							Not tracked in this league: needs {item.need}
						</span>
					) : unlocked ? (
						<>
							<div>
								First: <WhoLine who={item.first} />
							</div>
							{item.next ? (
								<div className="mt-1">
									<div className="d-flex justify-content-between gap-2">
										<span className="text-body-secondary text-truncate">
											Next tier:{" "}
											<a
												href={helpers.leagueUrl([
													"league_achievements",
													"all",
													item.next.id,
												])}
											>
												{item.next.name}
											</a>
										</span>
										<span className="text-body-secondary">
											{item.next.best ? `${pctOf(item.next.progress)}%` : "–"}
										</span>
									</div>
									{item.next.best ? (
										<ProgressBar
											small
											progress={item.next.progress}
											label={`Progress toward ${item.next.name}`}
										/>
									) : null}
								</div>
							) : null}
						</>
					) : (
						<>
							<div className="d-flex justify-content-between gap-2">
								<span className="text-truncate">
									{item.best ? (
										<>Closest: {item.best}</>
									) : (
										<span className="text-body-secondary">
											Nothing qualifying yet
										</span>
									)}
								</span>
								<span className="text-body-secondary">
									{item.best ? `${pctOf(item.progress)}%` : null}
								</span>
							</div>
							{item.best ? (
								<>
									<ProgressBar
										progress={item.progress}
										label={`Progress toward ${item.name}`}
									/>
									<div className="text-body-secondary mt-1">
										<WhoLine who={item.bestWho} />
									</div>
								</>
							) : null}
						</>
					)}
				</div>
			</div>
		</li>
	);
};

const Summary = ({ data }: { data: LoadedData }) => {
	const s = data.summary;
	return (
		<div className="row g-2 mb-3" data-summary>
			<div className="col-12 col-sm-6 col-lg-4">
				<div className="card h-100">
					<div className="card-body py-2">
						<div className="text-body-secondary small">Unlocked</div>
						<div className="fs-4 fw-bold">
							{s.unlocked}{" "}
							<span className="fs-6 fw-normal text-body-secondary">
								of {s.possible}
							</span>
						</div>
						<ProgressBar
							progress={s.possible ? s.unlocked / s.possible : 0}
							label="Unlocked"
						/>
						{s.unavailable > 0 ? (
							<div className="small text-body-secondary mt-1">
								{s.unavailable} more need data this league doesn’t keep
							</div>
						) : null}
					</div>
				</div>
			</div>
			<div className="col-12 col-sm-6 col-lg-8">
				<div className="card h-100">
					<div className="card-body py-2">
						<div className="row g-2">
							{RARITIES.map((r) => {
								const b = s.byRarity[r];
								const possible = b.total - b.unavailable;
								return (
									<div className="col-6 col-lg-3" key={r}>
										<RarityBadge rarity={r} />
										<div className="fw-bold">
											{b.unlocked}{" "}
											<span className="fw-normal text-body-secondary small">
												/ {possible}
											</span>
										</div>
										<ProgressBar
											small
											progress={possible ? b.unlocked / possible : 0}
											label={`${RARITY_LABEL[r]} unlocked`}
										/>
									</div>
								);
							})}
						</div>
						<div className="small text-body-secondary mt-2">
							Counting the league’s own seasons from {data.own}. Rarity is
							calibrated on real NBA history.
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

const Tabs = ({ tab }: { tab: LoadedData["tab"] }) => {
	const tabs: [LoadedData["tab"], string][] = [
		["all", "Catalogue"],
		["closest", "Closest to unlocking"],
		["franchise", "By franchise"],
		["recent", "Recent"],
	];
	return (
		<ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto text-nowrap">
			{tabs.map(([key, label]) => (
				<li className="nav-item" key={key}>
					<a
						className={`nav-link${tab === key ? " active" : ""}`}
						aria-current={tab === key ? "page" : undefined}
						href={helpers.leagueUrl(
							key === "all"
								? ["league_achievements"]
								: ["league_achievements", key],
						)}
					>
						{label}
					</a>
				</li>
			))}
		</ul>
	);
};

type Filters = {
	topic: string;
	rarity: Rarity | "all";
	status: Status;
	q: string;
};

const FilterBar = ({
	filters,
	setFilters,
	topics,
	showStatus,
}: {
	filters: Filters;
	setFilters: (f: Filters) => void;
	topics: [string, string][];
	showStatus: boolean;
}) => (
	<div className="row g-2 mb-3" role="search">
		<div className="col-6 col-md-3">
			<select
				className="form-select form-select-sm"
				aria-label="Topic"
				value={filters.topic}
				onChange={(e) => setFilters({ ...filters, topic: e.target.value })}
			>
				<option value="all">All topics</option>
				{topics.map(([key, label]) => (
					<option key={key} value={key}>
						{label}
					</option>
				))}
			</select>
		</div>
		<div className="col-6 col-md-2">
			<select
				className="form-select form-select-sm"
				aria-label="Rarity"
				value={filters.rarity}
				onChange={(e) =>
					setFilters({ ...filters, rarity: e.target.value as Rarity | "all" })
				}
			>
				<option value="all">All rarities</option>
				{RARITIES.map((r) => (
					<option key={r} value={r}>
						{RARITY_LABEL[r]}
					</option>
				))}
			</select>
		</div>
		{showStatus ? (
			<div className="col-6 col-md-2">
				<select
					className="form-select form-select-sm"
					aria-label="Status"
					value={filters.status}
					onChange={(e) =>
						setFilters({ ...filters, status: e.target.value as Status })
					}
				>
					<option value="all">Any status</option>
					<option value="unlocked">Unlocked</option>
					<option value="locked">Locked</option>
					<option value="unavailable">Not tracked</option>
				</select>
			</div>
		) : null}
		<div className={showStatus ? "col-6 col-md-5" : "col-12 col-md-7"}>
			<input
				type="search"
				className="form-control form-control-sm"
				placeholder="Search achievements"
				aria-label="Search achievements"
				value={filters.q}
				onChange={(e) => setFilters({ ...filters, q: e.target.value })}
			/>
		</div>
	</div>
);

const matches = (item: LeagueAchievementItem, f: Filters) => {
	if (f.topic !== "all" && item.topic !== f.topic) {
		return false;
	}
	if (f.rarity !== "all" && item.rarity !== f.rarity) {
		return false;
	}
	if (f.status !== "all" && item.state !== f.status) {
		return false;
	}
	if (f.q) {
		const q = f.q.toLowerCase();
		if (
			!item.name.toLowerCase().includes(q) &&
			!item.desc.toLowerCase().includes(q) &&
			!(item.first?.name ?? "").toLowerCase().includes(q)
		) {
			return false;
		}
	}
	return true;
};

const Catalogue = ({
	data,
	filters,
}: {
	data: LoadedData;
	filters: Filters;
}) => {
	const byTopic = useMemo(() => {
		const m = new Map<string, LeagueAchievementItem[]>();
		for (const item of data.items) {
			if (!matches(item, filters)) {
				continue;
			}
			let a = m.get(item.topic);
			if (!a) {
				a = [];
				m.set(item.topic, a);
			}
			a.push(item);
		}
		return m;
	}, [data.items, filters]);

	const total = [...byTopic.values()].reduce((n, a) => n + a.length, 0);
	if (total === 0) {
		return <p>No achievements match these filters.</p>;
	}
	return (
		<>
			<p className="text-body-secondary small">
				{total} achievement{total === 1 ? "" : "s"}
			</p>
			{data.topics.map(([key, label]) => {
				const list = byTopic.get(key);
				if (!list) {
					return null;
				}
				const unlocked = list.filter((x) => x.state === "unlocked").length;
				return (
					<section key={key} className="mb-4" data-topic={key}>
						<h2 className="h4 d-flex align-items-baseline gap-2">
							{label}
							<span className="fs-6 fw-normal text-body-secondary">
								{unlocked} / {list.length} unlocked
							</span>
						</h2>
						<ul className="list-group">
							{list.map((item) => (
								<ItemRow key={item.id} item={item} />
							))}
						</ul>
					</section>
				);
			})}
		</>
	);
};

// One achievement and the other tiers of its metric, from a link (toast, news feed, next tier)
const Focus = ({ data, id }: { data: LoadedData; id: string }) => {
	const item = data.items.find((x) => x.id === id);
	if (!item) {
		return null;
	}
	const ladder = data.items.filter((x) => x.metric === item.metric);
	return (
		<div className="mb-4" data-focus={id}>
			<h2 className="h4">
				{ladder.length > 1 ? "All tiers of this achievement" : "Achievement"}
			</h2>
			<ul className="list-group">
				{ladder.map((x) => (
					<ItemRow key={x.id} item={x} highlight={x.id === id} />
				))}
			</ul>
			<a
				className="d-inline-block mt-2"
				href={helpers.leagueUrl(["league_achievements"])}
			>
				» Whole catalogue
			</a>
		</div>
	);
};

const Closest = ({ data, filters }: { data: LoadedData; filters: Filters }) => {
	const byId = useMemo(
		() => new Map(data.items.map((x) => [x.id, x])),
		[data.items],
	);
	const list = data.closest
		.map((id) => byId.get(id)!)
		.filter((x) => x && matches(x, { ...filters, status: "all" }))
		.slice(0, 40);
	return (
		<>
			<p className="text-body-secondary">
				The locked tiers the league has come nearest to, one per achievement
				ladder.
			</p>
			{list.length === 0 ? (
				<p>Nothing is close yet. Play some games!</p>
			) : (
				<ul className="list-group">
					{list.map((item) => (
						<ItemRow key={item.id} item={item} />
					))}
				</ul>
			)}
		</>
	);
};

const Franchises = ({ data }: { data: LoadedData }) => {
	const cols = getCols([
		"Team",
		{ title: "Total", sortType: "number", desc: "Achievements unlocked" },
		...RARITIES.map((r) => ({
			title: RARITY_LABEL[r],
			sortType: "number" as const,
			desc: `${RARITY_LABEL[r]} achievements unlocked`,
		})),
	]);
	const rows = data.franchises.map((f) => ({
		key: f.tid,
		data: [
			{
				value: (
					<a
						href={helpers.leagueUrl([
							"league_achievements",
							"franchise",
							f.abbrev,
						])}
					>
						{f.name}
					</a>
				),
				sortValue: f.name,
				searchValue: f.name,
			},
			f.total,
			...RARITIES.map((r) => f.byRarity[r]),
		],
		classNames: {
			"table-info": f.tid === data.franchise?.tid,
		},
	}));
	const sel = data.franchise;
	const byId = new Map(data.items.map((x) => [x.id, x]));
	return (
		<div className="row g-3">
			<div className="col-12 col-xl-5">
				<p className="text-body-secondary">
					Each unlock counts for the team it happened for. League-wide counts
					belong to no one team.
				</p>
				<DataTable
					cols={cols}
					defaultSort={[1, "desc"]}
					name="LeagueAchievementsFranchises"
					rows={rows}
					small
				/>
			</div>
			<div className="col-12 col-xl-7">
				{sel ? (
					<>
						<h2 className="h4">{sel.name}</h2>
						{sel.items.length === 0 ? (
							<p>No achievements unlocked yet.</p>
						) : (
							<ul className="list-group" data-franchise={sel.abbrev}>
								{sel.items.map((x) => {
									const item = byId.get(x.id);
									if (!item) {
										return null;
									}
									return (
										<li className="list-group-item" key={x.id}>
											<div className="d-flex flex-wrap align-items-center gap-2">
												<RarityBadge rarity={item.rarity} />
												<a
													className="fw-bold"
													href={helpers.leagueUrl([
														"league_achievements",
														"all",
														item.id,
													])}
												>
													{item.name}
												</a>
												{x.n > 1 ? (
													<span className="text-body-secondary">×{x.n}</span>
												) : null}
											</div>
											<div className="small">{item.desc}</div>
											<div className="small text-body-secondary">
												First: <WhoLine who={x.first} />
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</>
				) : null}
			</div>
		</div>
	);
};

const Recent = ({ data }: { data: LoadedData }) => {
	const byId = new Map(data.items.map((x) => [x.id, x]));
	if (data.recent.length === 0) {
		return (
			<p>
				Nothing announced yet. Achievements unlocked from now on show up here as
				you play.
			</p>
		);
	}
	return (
		<ul className="list-group">
			{data.recent.map((e, i) => {
				const item = byId.get(e.id);
				if (!item) {
					return null;
				}
				return (
					<li className="list-group-item" key={`${e.id}-${i}`}>
						<div className="d-flex flex-wrap align-items-center gap-2">
							<RarityBadge rarity={item.rarity} />
							<a
								className="fw-bold"
								href={helpers.leagueUrl([
									"league_achievements",
									"all",
									item.id,
								])}
							>
								{item.name}
							</a>
							<span className="small text-body-secondary">
								{e.quiet ? "already unlocked when tracking began" : e.season}
							</span>
						</div>
						<div className="small">{item.desc}</div>
						{e.who ? (
							<div className="small text-body-secondary">{e.who}</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
};

const LeagueAchievementsPage = (data: LoadedData) => {
	useTitleBar({ title: "League Achievements" });
	const [filters, setFilters] = useState<Filters>({
		topic: "all",
		rarity: "all",
		status: "all",
		q: "",
	});

	return (
		<>
			<p>
				Achievements this league has unlocked, from single-game lines to
				dynasties. They unlock as you play; a notification says when. These are
				separate from your <a href="/achievements">account achievements</a>.
			</p>
			<Summary data={data} />
			<Tabs tab={data.tab} />
			{data.tab === "all" && data.id ? (
				<Focus data={data} id={data.id} />
			) : null}
			{data.tab === "all" || data.tab === "closest" ? (
				<FilterBar
					filters={filters}
					setFilters={setFilters}
					topics={data.topics}
					showStatus={data.tab === "all"}
				/>
			) : null}
			{data.tab === "all" ? (
				<Catalogue data={data} filters={filters} />
			) : data.tab === "closest" ? (
				<Closest data={data} filters={filters} />
			) : data.tab === "franchise" ? (
				<Franchises data={data} />
			) : (
				<Recent data={data} />
			)}
		</>
	);
};

const LeagueAchievementsLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "League Achievements" });
	return <WrappedLoading progress={progress} kind="stories" />;
};

const LeagueAchievements = (props: View<"leagueAchievements">) => {
	if (props.loading) {
		return <LeagueAchievementsLoading progress={props.progress} />;
	}
	return <LeagueAchievementsPage {...props} />;
};

export default LeagueAchievements;
