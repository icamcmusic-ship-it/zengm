import { useEffect, useMemo, useRef, useState } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";
import type { View } from "../../../common/types.ts";
import { clampCount, DECK_MAX } from "../../../common/wrapped/deck.ts";
import { planItems } from "../../../common/wrapped/items.ts";
import type { WrappedMode } from "../../../common/wrapped/types.ts";
import { DeckOptions } from "./DeckOptions.tsx";
import { useDeckPrefs } from "./deckState.ts";
import { SlideView } from "./SlideView.tsx";

const COUNT_KEY = "wrappedSlideCount";

const MODES: [WrappedMode, string][] = [
	["season", "Season"],
	["team", "Team"],
	["player", "Player"],
	["all", "All-time"],
];

const Wrapped = (props: View<"wrapped">) => {
	const {
		mode,
		season,
		tid,
		pid,
		cands,
		faces,
		teams,
		seasons,
		teamOptions,
		playerOptions,
		seed,
		title,
		soFar,
	} = props;

	useTitleBar({ title });

	const [count, setCount] = useState(() =>
		clampCount(safeLocalStorage.getItem(COUNT_KEY) ?? undefined, mode),
	);
	const prefs = useDeckPrefs();
	const slides = useMemo(
		() => planItems(cands, mode, count, seed, prefs),
		[cands, mode, count, seed, prefs],
	);
	const [i, setI] = useState(0);
	const slideRef = useRef<HTMLDivElement>(null);
	const touchX = useRef<number | undefined>(undefined);

	// New deck: back to the first slide
	useEffect(() => {
		setI(0);
	}, [seed, prefs.quiz, prefs.noSpoil]);

	const cur = Math.min(i, slides.length - 1);
	const go = (d: number) =>
		setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)));

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (
				t &&
				(t.tagName === "INPUT" ||
					t.tagName === "SELECT" ||
					t.tagName === "TEXTAREA")
			) {
				return;
			}
			if (e.key === "ArrowRight") {
				go(1);
			} else if (e.key === "ArrowLeft") {
				go(-1);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [slides.length]); // eslint-disable-line react-hooks/exhaustive-deps

	const url = (m: WrappedMode, s: number, id?: string | number) => {
		if (m === "all") {
			return helpers.leagueUrl(["wrapped", "all"]);
		}
		if (m === "season") {
			return helpers.leagueUrl(["wrapped", "season", s]);
		}
		return id !== undefined
			? helpers.leagueUrl(["wrapped", m, s, id])
			: helpers.leagueUrl(["wrapped", m, s]);
	};
	const teamId = (t: number | undefined) => {
		const o = teamOptions.find((x) => x.tid === t);
		return o ? `${o.abbrev}_${o.tid}` : undefined;
	};

	const saveImage = async () => {
		const el = slideRef.current?.querySelector<HTMLElement>(".wrapped-slide");
		if (!el) {
			return;
		}
		const { default: html2canvas } = await import("html2canvas");
		const canvas = await html2canvas(el, {
			backgroundColor: null,
			scale: 2,
			useCORS: true,
		});
		const a = document.createElement("a");
		a.download = `wrapped-${mode}-${season}-${cur + 1}.png`;
		a.href = canvas.toDataURL("image/png");
		a.click();
	};

	const slide = slides[cur];

	return (
		<>
			<ul className="nav nav-pills mb-2">
				{MODES.map(([m, label]) => (
					<li className="nav-item" key={m}>
						<a
							className={`nav-link${m === mode ? " active" : ""}`}
							href={url(
								m,
								season,
								m === "team"
									? teamId(tid ?? props.userTid)
									: m === "player"
										? pid
										: undefined,
							)}
						>
							{label}
						</a>
					</li>
				))}
			</ul>
			<div className="d-flex flex-wrap gap-2 mb-3">
				{mode !== "all" ? (
					<select
						className="form-select form-select-sm"
						style={{ width: "auto" }}
						value={season}
						aria-label="Season"
						onChange={(e) => {
							realtimeUpdate(
								[],
								url(
									mode,
									Number(e.target.value),
									mode === "team"
										? teamId(tid)
										: mode === "player"
											? pid
											: undefined,
								),
							);
						}}
					>
						{seasons.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				) : null}
				{mode === "team" ? (
					<select
						className="form-select form-select-sm"
						style={{ width: "auto", maxWidth: "100%" }}
						value={tid}
						aria-label="Team"
						onChange={(e) =>
							realtimeUpdate(
								[],
								url("team", season, teamId(Number(e.target.value))),
							)
						}
					>
						{teamOptions.map((t) => (
							<option key={t.tid} value={t.tid}>
								{t.label}
							</option>
						))}
					</select>
				) : null}
				{mode === "player" ? (
					<select
						className="form-select form-select-sm"
						style={{ width: "auto", maxWidth: "100%" }}
						value={pid}
						aria-label="Player"
						onChange={(e) =>
							realtimeUpdate([], url("player", season, Number(e.target.value)))
						}
					>
						{playerOptions.map((p) => (
							<option key={p.pid} value={p.pid}>
								{p.label} ({p.abbrev})
							</option>
						))}
					</select>
				) : null}
				<select
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					value={count}
					aria-label="Number of slides"
					onChange={(e) => {
						const n = clampCount(e.target.value, mode);
						setCount(n);
						safeLocalStorage.setItem(COUNT_KEY, String(n));
					}}
				>
					{[8, 12, 16, 20, 25, DECK_MAX].map((n) => (
						<option key={n} value={n}>
							Up to {n} slides
						</option>
					))}
				</select>
			</div>
			<DeckOptions showSpoil={mode !== "all" && !soFar} />
			{soFar ? (
				<p className="text-body-secondary">
					This season isn’t over yet, so the deck covers it so far. Awards and
					the playoffs show up once they’re decided.
				</p>
			) : null}

			{slide ? (
				<div
					ref={slideRef}
					onTouchStart={(e) => {
						touchX.current = e.touches[0]?.clientX;
					}}
					onTouchEnd={(e) => {
						const x0 = touchX.current;
						const x1 = e.changedTouches[0]?.clientX;
						if (
							x0 !== undefined &&
							x1 !== undefined &&
							Math.abs(x1 - x0) > 50
						) {
							go(x1 < x0 ? 1 : -1);
						}
					}}
					style={{ maxWidth: 520 }}
				>
					<div className="d-flex gap-1 mb-2" aria-label="Slides">
						{slides.map((s, j) => (
							<button
								key={s.id}
								type="button"
								className="border-0 p-0 flex-grow-1"
								style={{
									height: 6,
									borderRadius: 3,
									background:
										j <= cur ? "var(--bs-primary)" : "var(--bs-secondary-bg)",
								}}
								title={s.kicker}
								aria-label={`Slide ${j + 1}`}
								onClick={() => setI(j)}
							/>
						))}
					</div>
					<SlideView
						key={slide.id}
						slide={slide}
						index={cur}
						faces={faces}
						teams={teams}
						deck={seed}
						all={slides}
					/>
					<div className="d-flex align-items-center gap-2 mt-2">
						<button
							type="button"
							className="btn btn-secondary"
							disabled={cur === 0}
							onClick={() => go(-1)}
						>
							Previous
						</button>
						<span className="text-body-secondary">
							{cur + 1} / {slides.length}
						</span>
						<button
							type="button"
							className="btn btn-primary"
							disabled={cur === slides.length - 1}
							onClick={() => go(1)}
						>
							Next
						</button>
						<button
							type="button"
							className="btn btn-light-bordered ms-auto"
							onClick={saveImage}
						>
							Save image
						</button>
					</div>
				</div>
			) : (
				<p>Nothing to show yet. Play some games first!</p>
			)}
			<p className="mt-3">
				<a href={helpers.leagueUrl(["storylines"])}>Storylines</a> · Use ← and →
				to move between slides.
			</p>
		</>
	);
};

export default Wrapped;
