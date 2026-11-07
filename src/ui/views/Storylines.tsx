import { Fragment, useMemo, useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { plainText } from "../../common/storylines/index.ts";
import { WrappedLoading } from "./Wrapped/Loading.tsx";

type LoadedProps = Extract<View<"storylines">, { loading: false }>;

const TOKEN = /\[\[([pt]):([^\]|]*)\|([^\]]*)]]/g;

// Text with [[p:pid|Name]] and [[t:tid:season|Name]] tokens, as links
const RichText = ({
	text,
	teams,
}: {
	text: string;
	teams: LoadedProps["teams"];
}) => {
	const parts = [];
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		parts.push(text.slice(last, m.index));
		const [, kind, ref, name] = m;
		if (kind === "p") {
			parts.push(
				<a key={m.index} href={helpers.leagueUrl(["player", Number(ref)])}>
					{name}
				</a>,
			);
		} else {
			const [tid, season] = ref!.split(":").map(Number);
			const abbrev = teams[tid!]?.abbrev ?? "";
			parts.push(
				<a
					key={m.index}
					href={helpers.leagueUrl(["roster", `${abbrev}_${tid}`, season!])}
				>
					{name}
				</a>,
			);
		}
		last = m.index + m[0].length;
	}
	parts.push(text.slice(last));
	return (
		<>
			{parts.map((p, i) => (
				<Fragment key={i}>{p}</Fragment>
			))}
		</>
	);
};

const PAGE = 30;

const StorylinesList = ({ stories, kinds, teams }: LoadedProps) => {
	useTitleBar({ title: "Storylines" });
	const [kind, setKind] = useState("all");
	const [search, setSearch] = useState("");
	const [shown, setShown] = useState(PAGE);
	const [sort, setSort] = useState<"score" | "season">("score");

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

	return (
		<>
			<p>
				Story arcs found in your league’s history: careers, dynasties, droughts,
				upsets and more. Everything comes from the league’s own records. See
				also <a href={helpers.leagueUrl(["wrapped"])}>Wrapped</a>.
			</p>
			<div className="d-flex flex-wrap gap-2 mb-3">
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
			{list.length === 0 ? (
				<p>No storylines yet. Play a few seasons and check back!</p>
			) : null}
			<div className="row g-3">
				{list.slice(0, shown).map((s) => {
					const t = s.tids[0] !== undefined ? teams[s.tids[0]] : undefined;
					return (
						<div className="col-12 col-lg-6" key={s.id}>
							<div
								className="card h-100"
								style={
									t ? { borderLeft: `5px solid ${t.colors[0]}` } : undefined
								}
							>
								<div className="card-body">
									<div className="d-flex justify-content-between small text-body-secondary mb-1">
										<span className="text-uppercase fw-bold">{s.kind}</span>
										<span>{s.season}</span>
									</div>
									<h3 className="card-title h5">{s.headline}</h3>
									<p className="card-text mb-2">
										<RichText text={s.body} teams={teams} />
									</p>
									<div className="d-flex flex-wrap gap-1">
										{s.evidence.map(([k, v]) => (
											<span
												key={k}
												className="badge text-bg-secondary fw-normal"
											>
												{k}: <b>{v}</b>
											</span>
										))}
									</div>
								</div>
							</div>
						</div>
					);
				})}
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
		</>
	);
};

// The league's history is read in the worker, which can take a while for a big league the first time. Until it's ready the page shows a placeholder.
const Storylines = (props: View<"storylines">) => {
	if (props.loading) {
		return <StorylinesLoading progress={props.progress} />;
	}
	return <StorylinesList {...props} />;
};

const StorylinesLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "Storylines" });
	return <WrappedLoading progress={progress} kind="stories" />;
};

export default Storylines;
