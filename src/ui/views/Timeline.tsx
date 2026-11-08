import { MoreLinks } from "../components/MoreLinks.tsx";
import { useState } from "react";
import clsx from "clsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { realtimeUpdate } from "../util/realtimeUpdate.ts";
import {
	TIMELINE_KINDS,
	TIMELINE_KIND_LABELS,
	type TimelineKind,
} from "../../common/timeline.ts";
import { safeLocalStorage } from "../util/safeLocalStorage.ts";

const KIND_BADGE: Record<TimelineKind, string> = {
	champion: "text-bg-warning",
	award: "text-bg-primary",
	headline: "text-bg-dark",
	storyline: "text-bg-info",
	achievement: "text-bg-success",
	record: "text-bg-danger",
	trade: "text-bg-secondary",
	unretire: "text-bg-light border",
};

const STORAGE_KEY = "timelineKinds";

const loadKinds = (): Set<TimelineKind> => {
	try {
		const saved = safeLocalStorage.getItem(STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved) as string[];
			return new Set(
				parsed.filter((k): k is TimelineKind =>
					(TIMELINE_KINDS as readonly string[]).includes(k),
				),
			);
		}
	} catch {}
	return new Set(TIMELINE_KINDS);
};

const Timeline = ({
	disabled,
	from,
	seasons,
	storylinesLoading,
	teams,
	timeline,
	to,
	userTid,
}: View<"timeline">) => {
	useTitleBar({ title: "League Timeline" });

	const [kinds, setKinds] = useState(loadKinds);
	const [tid, setTid] = useState<number | "all">("all");
	const [search, setSearch] = useState("");

	const toggleKind = (kind: TimelineKind) => {
		const next = new Set(kinds);
		if (next.has(kind)) {
			next.delete(kind);
		} else {
			next.add(kind);
		}
		setKinds(next);
		try {
			safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
		} catch {}
	};

	const goTo = (newFrom: number, newTo: number) => {
		realtimeUpdate(
			[],
			helpers.leagueUrl([
				"timeline",
				Math.min(newFrom, newTo),
				Math.max(newFrom, newTo),
			]),
		);
	};

	const needle = search.trim().toLowerCase();
	const shown = timeline
		.map((row) => ({
			...row,
			items: row.items.filter(
				(item) =>
					kinds.has(item.kind) &&
					(tid === "all" || item.tids.includes(tid)) &&
					(needle === "" ||
						item.title.toLowerCase().includes(needle) ||
						(item.detail ?? "").toLowerCase().includes(needle)),
			),
		}))
		.filter((row) => row.items.length > 0);

	const counts: Partial<Record<TimelineKind, number>> = {};
	for (const row of timeline) {
		for (const item of row.items) {
			counts[item.kind] = (counts[item.kind] ?? 0) + 1;
		}
	}

	return (
		<>
			<MoreLinks type="league" page="timeline" />
			<p>
				The league's history season by season: champions, MVPs, newspaper front
				pages, the top storylines, achievements, records, the biggest trades and
				comebacks. Each entry links to where it comes from.
			</p>

			<div className="d-flex flex-wrap gap-2 align-items-end mb-2">
				<div>
					<label className="form-label mb-0 small" htmlFor="timeline-from">
						From
					</label>
					<select
						id="timeline-from"
						className="form-select form-select-sm"
						value={from}
						onChange={(event) => {
							goTo(Number.parseInt(event.target.value), to);
						}}
					>
						{seasons.map((season) => (
							<option key={season} value={season}>
								{season}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="form-label mb-0 small" htmlFor="timeline-to">
						To
					</label>
					<select
						id="timeline-to"
						className="form-select form-select-sm"
						value={to}
						onChange={(event) => {
							goTo(from, Number.parseInt(event.target.value));
						}}
					>
						{seasons.map((season) => (
							<option key={season} value={season}>
								{season}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="form-label mb-0 small" htmlFor="timeline-team">
						Team
					</label>
					<select
						id="timeline-team"
						className="form-select form-select-sm"
						value={tid}
						onChange={(event) => {
							const value = event.target.value;
							setTid(value === "all" ? "all" : Number.parseInt(value));
						}}
					>
						<option value="all">All teams</option>
						{teams.map((t) => (
							<option key={t.tid} value={t.tid}>
								{t.name}
								{t.tid === userTid ? " (yours)" : ""}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="form-label mb-0 small" htmlFor="timeline-search">
						Search
					</label>
					<input
						id="timeline-search"
						className="form-control form-control-sm"
						type="search"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
						}}
					/>
				</div>
				<button
					className="btn btn-sm btn-light-bordered"
					onClick={() => {
						const first = seasons.at(-1)!;
						goTo(first, seasons[0]!);
					}}
				>
					All seasons
				</button>
			</div>

			<div className="d-flex flex-wrap gap-1 mb-3" data-timeline-kinds>
				{TIMELINE_KINDS.map((kind) => (
					<button
						key={kind}
						type="button"
						className={clsx(
							"btn btn-sm",
							kinds.has(kind) ? "btn-primary" : "btn-outline-secondary",
						)}
						aria-pressed={kinds.has(kind)}
						onClick={() => {
							toggleKind(kind);
						}}
					>
						{TIMELINE_KIND_LABELS[kind]}
						{counts[kind] !== undefined ? ` (${counts[kind]})` : ""}
					</button>
				))}
			</div>

			{storylinesLoading ? (
				<p className="text-body-secondary small">
					Reading the league history for storylines… they will appear here when
					it's done.
				</p>
			) : null}
			{disabled.length > 0 ? (
				<p className="text-body-secondary small">
					Turned off in{" "}
					<a href={helpers.leagueUrl(["league_extras"])}>League Extras</a>, so
					not on the timeline: {disabled.join(", ")}.
				</p>
			) : null}

			{shown.length === 0 ? (
				<p>Nothing on the timeline for these filters.</p>
			) : (
				<div className="timeline">
					{shown.map((row) => (
						<div key={row.season} className="mb-4" data-timeline-season>
							<h2 className="h4 border-bottom pb-1">
								<a href={helpers.leagueUrl(["history", row.season])}>
									{row.season}
								</a>
							</h2>
							<ul className="list-unstyled mb-0">
								{row.items.map((item, i) => (
									<li key={i} className="d-flex gap-2 mb-1">
										<span
											className={clsx(
												"badge align-self-start mt-1",
												KIND_BADGE[item.kind],
											)}
											style={{ minWidth: 92 }}
										>
											{TIMELINE_KIND_LABELS[item.kind]}
										</span>
										<span>
											<a href={helpers.leagueUrl(item.url as any)}>
												{item.title}
											</a>
											{item.detail ? (
												<span className="text-body-secondary">
													{" "}
													· {item.detail}
												</span>
											) : null}
										</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</>
	);
};

export default Timeline;
