import { useMemo, useState } from "react";
import useLocalStorageState from "use-local-storage-state";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import type { View } from "../../../common/types.ts";
import type { LeagueUrlParts } from "../../router/types.ts";
import { plainText } from "../../../common/storylines/index.ts";
import { StoryCard, type UIStory } from "./StoryCard.tsx";
import { WhyModal } from "./WhyModal.tsx";
import { WrappedLoading } from "../Wrapped/Loading.tsx";

type LoadedData = Extract<View<"storylines">, { loading: false }>;

const PAGE = 30;

// The page's own URL with a different season ("all" drops it), keeping the team, player or kind filter
const storylinesUrlParts = (
	filter: LoadedData["filter"],
	teams: LoadedData["teams"],
	season: string,
): LeagueUrlParts => {
	const withFilter = filter && filter.type !== "thread";
	const type = withFilter ? filter.type : "all";
	const id = !withFilter
		? "all"
		: filter.type === "team"
			? `${teams[Number(filter.id)]?.abbrev ?? ""}_${filter.id}`
			: filter.id;
	if (season !== "all") {
		return ["storylines", type, id, season];
	}
	return withFilter ? ["storylines", type, id] : ["storylines"];
};

// Followed threads are remembered per league in this browser
const useFollowed = () => {
	const { lid } = useLocal(["lid"]);
	const [followed, setFollowed] = useLocalStorageState<string[]>(
		`storylinesFollowed${lid}`,
		{ defaultValue: [] },
	);
	const toggle = (key: string) =>
		setFollowed(
			followed.includes(key)
				? followed.filter((k) => k !== key)
				: [...followed, key],
		);
	return { followed, toggle };
};

const FollowButton = ({
	threadKey,
	followed,
	toggle,
}: {
	threadKey: string;
	followed: string[];
	toggle: (key: string) => void;
}) => {
	const on = followed.includes(threadKey);
	return (
		<button
			type="button"
			className={
				on ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline-primary"
			}
			aria-pressed={on}
			onClick={() => toggle(threadKey)}
		>
			{on ? "Following" : "Follow"}
		</button>
	);
};

const ThreadView = ({
	data,
	onWhy,
	followed,
	toggle,
}: {
	data: LoadedData;
	onWhy: (s: UIStory) => void;
	followed: string[];
	toggle: (key: string) => void;
}) => {
	const thread = data.thread!;
	const byId = new Map(data.stories.map((s) => [s.id, s]));
	return (
		<>
			<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
				<FollowButton
					threadKey={thread.key}
					followed={followed}
					toggle={toggle}
				/>
				<span className="text-body-secondary">
					{thread.chapters.length} stories across {thread.seasons.length}{" "}
					seasons, {thread.from}
					{thread.to !== thread.from ? `–${thread.to}` : ""}
				</span>
			</div>
			<ol className="list-unstyled mb-0" data-thread={thread.key}>
				{thread.chapters.map((c, i) => {
					const s = byId.get(c.id);
					return s ? (
						<li key={c.id} className="d-flex gap-3 mb-3">
							<div className="text-center flex-shrink-0" style={{ width: 52 }}>
								<div className="fw-bold">{c.season}</div>
								<div
									className="mx-auto bg-secondary"
									style={{
										width: 2,
										height:
											i < thread.chapters.length - 1
												? "calc(100% - 1.5rem)"
												: 0,
									}}
								/>
							</div>
							<div className="flex-grow-1">
								<StoryCard
									story={s}
									teams={data.teams}
									onWhy={onWhy}
									phase={c.phase}
									hideThread
								/>
							</div>
						</li>
					) : null;
				})}
			</ol>
		</>
	);
};

const StorylinesList = (data: LoadedData) => {
	const {
		stories,
		kinds,
		kindSlugs,
		teams,
		filter,
		threads,
		totalStories,
		season,
		seasons,
	} = data;
	useTitleBar({
		title: filter?.type === "thread" ? "Storyline thread" : "Storylines",
	});
	const { followed, toggle } = useFollowed();
	const [kind, setKind] = useState("all");
	const [tab, setTab] = useState<"stories" | "threads">("stories");
	const [search, setSearch] = useState("");
	const [shown, setShown] = useState(PAGE);
	const [sort, setSort] = useState<"score" | "season">("score");
	const [why, setWhy] = useState<UIStory | undefined>();

	const counts = useMemo(() => {
		const c = new Map<string, number>();
		for (const s of stories) {
			c.set(s.kind, (c.get(s.kind) ?? 0) + 1);
		}
		return c;
	}, [stories]);

	const list = useMemo(() => {
		const q = search.trim().toLowerCase();
		const out = stories.filter(
			(s) =>
				(kind === "all" || s.kind === kind) &&
				(q === "" ||
					plainText(`${s.headline} ${s.body}`).toLowerCase().includes(q)),
		);
		if (sort === "season") {
			out.sort((a, b) => b.season - a.season || b.score - a.score);
		}
		return out;
	}, [stories, kind, search, sort]);

	const sortedThreads = useMemo(() => {
		const q = search.trim().toLowerCase();
		return threads
			.filter((t) => q === "" || t.title.toLowerCase().includes(q))
			.sort(
				(a, b) =>
					Number(followed.includes(b.key)) - Number(followed.includes(a.key)),
			);
	}, [threads, followed, search]);

	const whyModal = (
		<WhyModal
			storyId={why?.id}
			headline={why?.headline ?? ""}
			teams={teams}
			onHide={() => setWhy(undefined)}
		/>
	);

	const banner = filter ? (
		<div className="alert alert-info d-flex flex-wrap align-items-center gap-2 py-2">
			<span>
				Showing storylines for <b>{filter.label}</b>.
			</span>
			<a href={helpers.leagueUrl(["storylines"])}>Show all storylines</a>
		</div>
	) : null;

	if (filter?.type === "thread" && data.thread) {
		return (
			<>
				<h2 className="h4">{data.thread.title}</h2>
				<p>
					<a href={helpers.leagueUrl(["storylines"])}>All storylines</a>
				</p>
				<ThreadView
					data={data}
					onWhy={setWhy}
					followed={followed}
					toggle={toggle}
				/>
				{whyModal}
			</>
		);
	}

	return (
		<>
			<p>
				Story arcs found in your league’s history: careers, dynasties, droughts,
				upsets and more. Everything comes from the league’s own records. See
				also <a href={helpers.leagueUrl(["wrapped"])}>Wrapped</a>.
			</p>
			{banner}
			<ul className="nav nav-tabs mb-3">
				{(["stories", "threads"] as const).map((t) => (
					<li className="nav-item" key={t}>
						<button
							type="button"
							className={`nav-link${tab === t ? " active" : ""}`}
							onClick={() => setTab(t)}
						>
							{t === "stories"
								? `Stories (${totalStories})`
								: `Threads (${threads.length})`}
						</button>
					</li>
				))}
			</ul>
			<div className="d-flex flex-wrap gap-2 mb-3">
				{tab === "stories" ? (
					<>
						<select
							className="form-select form-select-sm"
							style={{ width: "auto" }}
							value={season ?? "all"}
							aria-label="Season"
							onChange={(e) => {
								realtimeUpdate(
									[],
									helpers.leagueUrl(
										storylinesUrlParts(filter, teams, e.target.value),
									),
								);
							}}
						>
							<option value="all">All seasons</option>
							{[...seasons].reverse().map((y) => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
						<select
							className="form-select form-select-sm"
							style={{ width: "auto", maxWidth: "100%" }}
							value={kind}
							aria-label="Kind"
							onChange={(e) => {
								setKind(e.target.value);
								setShown(PAGE);
							}}
						>
							<option value="all">All kinds ({stories.length})</option>
							{kinds
								.filter((k) => counts.has(k))
								.map((k) => (
									<option key={k} value={k}>
										{k} ({counts.get(k)})
									</option>
								))}
						</select>
						<select
							className="form-select form-select-sm"
							style={{ width: "auto" }}
							value={sort}
							aria-label="Sort"
							onChange={(e) => setSort(e.target.value as "score" | "season")}
						>
							<option value="score">Biggest stories first</option>
							<option value="season">Most recent first</option>
						</select>
					</>
				) : null}
				<input
					type="search"
					className="form-control form-control-sm"
					style={{ width: 200, maxWidth: "100%" }}
					placeholder="Search"
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						setShown(PAGE);
					}}
				/>
			</div>
			{tab === "stories" ? (
				<>
					{list.length === 0 ? (
						<p>
							{season !== undefined
								? `No stories for ${season} yet.`
								: "No storylines yet. Play a few seasons and check back!"}
						</p>
					) : null}
					<div className="row g-3">
						{list.slice(0, shown).map((s) => (
							<div className="col-12 col-lg-6" key={s.id}>
								<StoryCard story={s} teams={teams} onWhy={setWhy} />
							</div>
						))}
					</div>
					{list.length > shown ? (
						<button
							type="button"
							className="btn btn-secondary mt-3"
							onClick={() => setShown((x) => x + PAGE)}
						>
							Show more ({list.length - shown} left)
						</button>
					) : null}
					{!filter && kind !== "all" && kindSlugs[kind] ? (
						<p className="mt-3">
							<a
								href={helpers.leagueUrl([
									"storylines",
									"kind",
									kindSlugs[kind]!,
								])}
							>
								Every {kind} story
							</a>
						</p>
					) : null}
				</>
			) : (
				<>
					{sortedThreads.length === 0 ? (
						<p>
							No threads yet. A thread needs stories about the same player or
							team in two or more seasons.
						</p>
					) : null}
					<div className="list-group">
						{sortedThreads.slice(0, shown).map((t) => (
							<div
								key={t.key}
								className="list-group-item d-flex flex-wrap align-items-center gap-2"
							>
								<a
									className="fw-bold"
									href={helpers.leagueUrl(["storylines", "thread", t.key])}
								>
									{t.title}
								</a>
								<span className="text-body-secondary small">
									{t.chapters} stories, {t.from}
									{t.to !== t.from ? `–${t.to}` : ""}
								</span>
								<span className="ms-auto">
									<FollowButton
										threadKey={t.key}
										followed={followed}
										toggle={toggle}
									/>
								</span>
							</div>
						))}
					</div>
					{sortedThreads.length > shown ? (
						<button
							type="button"
							className="btn btn-secondary mt-3"
							onClick={() => setShown((x) => x + PAGE)}
						>
							Show more ({sortedThreads.length - shown} left)
						</button>
					) : null}
				</>
			)}
			{whyModal}
		</>
	);
};

// The league's history is read in the worker, which can take a while for a big league the first time. Until it's ready the page shows a placeholder.
const StorylinesLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "Storylines" });
	return <WrappedLoading progress={progress} kind="stories" />;
};

const Storylines = (props: View<"storylines">) => {
	if (props.loading) {
		return <StorylinesLoading progress={props.progress} />;
	}
	return <StorylinesList {...props} />;
};

export default Storylines;
