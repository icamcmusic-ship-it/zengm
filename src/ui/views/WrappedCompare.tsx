import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { realtimeUpdate } from "../util/realtimeUpdate.ts";
import type { View } from "../../common/types.ts";
import type { Side, SideKind } from "../../common/wrapped/compare.ts";
import { sideSpec } from "../../common/wrapped/compare.ts";
import type { Slide } from "../../common/wrapped/types.ts";
import { SlideCard } from "./Wrapped/SlideCard.tsx";

type Data = View<"wrappedCompare">;
type Cmp = NonNullable<Data["compare"]>;

const KINDS: [SideKind, string][] = [
	["p", "Players"],
	["t", "Teams"],
	["s", "Seasons"],
];

const go = (a: Side, b: Side) =>
	realtimeUpdate(
		[],
		helpers.leagueUrl(["wrapped", "compare", sideSpec(a), sideSpec(b)]),
	);

const PickSide = ({
	title,
	kind,
	side,
	setSide,
	data,
}: {
	title: string;
	kind: SideKind;
	side: Side;
	setSide: (s: Side) => void;
	data: Data;
}) => {
	const [filter, setFilter] = useState("");
	const { seasons, teamOptions, playerOptions } = data;
	if (kind === "s") {
		return (
			<div className="card card-body">
				<h2 className="h5">{title}</h2>
				<select
					className="form-select"
					aria-label={`${title} season`}
					value={side.season}
					onChange={(e) => setSide({ k: "s", season: Number(e.target.value) })}
				>
					{seasons.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
			</div>
		);
	}
	if (kind === "t") {
		return (
			<div className="card card-body">
				<h2 className="h5">{title}</h2>
				<select
					className="form-select mb-2"
					aria-label={`${title} team`}
					value={side.id ?? teamOptions[0]?.tid}
					onChange={(e) =>
						setSide({ k: "t", id: Number(e.target.value), season: side.season })
					}
				>
					{teamOptions.map((t) => (
						<option key={t.tid} value={t.tid}>
							{t.label}
						</option>
					))}
				</select>
				<select
					className="form-select"
					aria-label={`${title} season`}
					value={side.season}
					onChange={(e) =>
						setSide({ k: "t", id: side.id, season: Number(e.target.value) })
					}
				>
					{seasons.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
			</div>
		);
	}
	const f = filter.trim().toLowerCase();
	const shown = playerOptions
		.filter((p) => f === "" || p.label.toLowerCase().includes(f))
		.slice(0, 100);
	const cur = playerOptions.find((p) => p.pid === side.id);
	return (
		<div className="card card-body">
			<h2 className="h5">{title}</h2>
			<input
				className="form-control mb-2"
				type="search"
				placeholder="Find a player…"
				aria-label={`${title} player search`}
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
			/>
			<select
				className="form-select mb-2"
				aria-label={`${title} player`}
				value={side.id ?? ""}
				onChange={(e) => {
					const p = playerOptions.find((x) => x.pid === Number(e.target.value));
					if (p) {
						setSide({ k: "p", id: p.pid, season: p.seasons[0]! });
					}
				}}
			>
				{side.id === undefined ? <option value="">Pick a player</option> : null}
				{cur && !shown.includes(cur) ? (
					<option value={cur.pid}>{cur.label}</option>
				) : null}
				{shown.map((p) => (
					<option key={p.pid} value={p.pid}>
						{p.label}
					</option>
				))}
			</select>
			{cur ? (
				<select
					className="form-select"
					aria-label={`${title} season`}
					value={side.season}
					onChange={(e) =>
						setSide({ k: "p", id: side.id, season: Number(e.target.value) })
					}
				>
					{cur.seasons.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
			) : null}
		</div>
	);
};

const Picker = ({ data }: { data: Data }) => {
	const { seasons, teamOptions, playerOptions } = data;
	const [kind, setKind] = useState<SideKind>("p");
	const initial = (k: SideKind, i: number): Side => {
		const season = seasons[0] ?? 0;
		if (k === "s") {
			return { k, season: seasons[Math.min(i, seasons.length - 1)] ?? season };
		}
		if (k === "t") {
			return { k, id: teamOptions[Math.min(i, teamOptions.length - 1)]?.tid, season };
		}
		const p = playerOptions[Math.min(i, playerOptions.length - 1)];
		return { k, id: p?.pid, season: p?.seasons[0] ?? season };
	};
	const [sides, setSides] = useState<[Side, Side]>([initial("p", 0), initial("p", 1)]);
	const ready = sides.every((s) => s.k === "s" || s.id !== undefined);
	return (
		<>
			<ul className="nav nav-pills mb-3">
				{KINDS.map(([k, label]) => (
					<li className="nav-item" key={k}>
						<button
							type="button"
							className={`nav-link${k === kind ? " active" : ""}`}
							onClick={() => {
								setKind(k);
								setSides([initial(k, 0), initial(k, 1)]);
							}}
						>
							{label}
						</button>
					</li>
				))}
			</ul>
			<div className="row g-3 mb-3">
				{([0, 1] as const).map((i) => (
					<div className="col-md-6" key={`${kind}${i}`}>
						<PickSide
							title={i === 0 ? "First" : "Second"}
							kind={kind}
							side={sides[i]}
							setSide={(s) =>
								setSides((old) => (i === 0 ? [s, old[1]] : [old[0], s]))
							}
							data={data}
						/>
					</div>
				))}
			</div>
			<button
				type="button"
				className="btn btn-primary"
				disabled={!ready}
				onClick={() => go(sides[0], sides[1])}
			>
				Compare
			</button>
		</>
	);
};

const Pair = ({
	a,
	b,
	win,
	labelA,
	labelB,
	faces,
	teams,
}: {
	a: Slide;
	b: Slide;
	win: "a" | "b" | "even";
	labelA: string;
	labelB: string;
	faces: Cmp["faces"];
	teams: Cmp["teams"];
}) => {
	const note =
		win === "even"
			? "About even"
			: `${win === "a" ? labelA : labelB} stands out more`;
	return (
		<div className="mb-4" data-testid="compare-pair">
			<div className="d-flex align-items-baseline gap-2 mb-1">
				<h3 className="h6 mb-0 text-uppercase">{a.kicker}</h3>
				<span className="text-body-secondary small">{note}</span>
			</div>
			<div className="row g-3">
				{[a, b].map((s, i) => (
					<div className="col-md-6" key={i}>
						<div
							style={{
								outline:
									(win === "a" && i === 0) || (win === "b" && i === 1)
										? "3px solid var(--bs-warning)"
										: undefined,
								borderRadius: 16,
							}}
						>
							<SlideCard
								slide={s}
								index={i}
								faces={faces}
								teams={teams}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

const WrappedCompare = (props: Data) => {
	const c = props.compare;
	useTitleBar({
		title: c ? `${c.a.label} vs ${c.b.label}` : "Compare Wrapped",
	});
	const [showAll, setShowAll] = useState(false);
	return (
		<>
			<p>
				<a href={helpers.leagueUrl(["wrapped"])}>Wrapped</a> · Compare two
				players, two teams or two seasons side by side: the slides both have,
				the ones only one has, and a scoreboard.
			</p>
			{props.error ? (
				<p className="alert alert-warning" role="alert">
					{props.error}
				</p>
			) : null}
			{!c ? <Picker data={props} /> : null}
			{c ? (
				<>
					<div className="d-flex flex-wrap gap-2 mb-3">
						<a
							className="btn btn-light-bordered"
							href={helpers.leagueUrl(["wrapped", "compare"])}
						>
							Change
						</a>
						<button
							type="button"
							className="btn btn-light-bordered"
							onClick={() => go(c.b.side, c.a.side)}
						>
							Swap sides
						</button>
					</div>
					<p>
						<b>{c.a.label}</b> and <b>{c.b.label}</b> share{" "}
						{c.tally.both} slide topics: {c.tally.a} stand out more for{" "}
						{c.a.label}, {c.tally.b} for {c.b.label}, {c.tally.even} are even.{" "}
						{c.tally.onlyA > 0 || c.tally.onlyB > 0
							? `${c.tally.onlyA} are only for ${c.a.label}, ${c.tally.onlyB} only for ${c.b.label}.`
							: null}
					</p>
					<h2 className="h5">Scoreboard</h2>
					<div className="table-responsive mb-4">
						<table className="table table-sm" style={{ maxWidth: 720 }}>
							<thead>
								<tr>
									<th />
									<th className="text-end">{c.a.label}</th>
									<th className="text-end">{c.b.label}</th>
								</tr>
							</thead>
							<tbody>
								{c.rows.map((r) => (
									<tr key={r.label}>
										<td>{r.label}</td>
										<td
											className={`text-end${r.better === "a" ? " fw-bold" : ""}`}
										>
											{r.better === "a" ? "▸ " : ""}
											{r.a}
										</td>
										<td
											className={`text-end${r.better === "b" ? " fw-bold" : ""}`}
										>
											{r.better === "b" ? "▸ " : ""}
											{r.b}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{c.both.length > 0 ? (
						<>
							<h2 className="h5">Both have</h2>
							{c.both.slice(0, showAll ? undefined : 4).map((p) => (
								<Pair
									key={p.id}
									a={p.a}
									b={p.b}
									win={p.win}
									labelA={c.a.label}
									labelB={c.b.label}
									faces={c.faces}
									teams={c.teams}
								/>
							))}
							{!showAll && c.both.length > 4 ? (
								<button
									type="button"
									className="btn btn-secondary mb-4"
									onClick={() => setShowAll(true)}
								>
									Show {c.both.length - 4} more
								</button>
							) : null}
						</>
					) : null}
					{([
						[c.a.label, c.onlyA],
						[c.b.label, c.onlyB],
					] as const).map(([label, list]) =>
						list.length > 0 ? (
							<div key={label} className="mb-4">
								<h2 className="h5">Only {label}</h2>
								<div className="row g-3">
									{list.slice(0, showAll ? undefined : 2).map((s, i) => (
										<div className="col-md-6" key={s.id}>
											<SlideCard
												slide={s}
												index={i}
												faces={c.faces}
												teams={c.teams}
											/>
										</div>
									))}
								</div>
							</div>
						) : null,
					)}
				</>
			) : null}
		</>
	);
};

export default WrappedCompare;
