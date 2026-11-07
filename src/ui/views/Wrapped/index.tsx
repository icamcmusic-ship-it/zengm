import clsx from "clsx";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { Modal } from "../../components/Modal.tsx";
import type { TitleBarDropdownField } from "../../components/Dropdown.tsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";
import { showNotification } from "../../util/showNotification.ts";
import type { View } from "../../../common/types.ts";
import { clampCount, DECK_MAX } from "../../../common/wrapped/deck.ts";
import { planItems } from "../../../common/wrapped/items.ts";
import type { Slide, WrappedMode } from "../../../common/wrapped/types.ts";
import { DeckOptions } from "./DeckOptions.tsx";
import { useDeckPrefs, useQuizAnswers } from "./deckState.ts";
import {
	SlideCard,
	slideLook,
	readAccents,
	FALLBACK_ACCENTS,
} from "./SlideCard.tsx";
import { WrappedLoading } from "./Loading.tsx";

type LoadedProps = Extract<View<"wrapped">, { loading: false }>;

const COUNT_KEY = "wrappedSlideCount";
const AUTOPLAY_KEY = "wrappedAutoplay";

// How long a slide stays up when it plays by itself
const DWELL = 8;
// The image export is drawn from a 360x640 card, at 3x: 1080x1920
const EXPORT_W = 360;
const EXPORT_H = 640;
const EXPORT_SCALE = 3;

const MODES: [WrappedMode, string][] = [
	["season", "Season"],
	["team", "Team"],
	["player", "Player"],
	["all", "All-time"],
];

const prefersReducedMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

const teamUrlPart = (
	teamOptions: LoadedProps["teamOptions"],
	t: number | undefined,
) => {
	const o = teamOptions.find((x) => x.tid === t);
	return o ? `${o.abbrev}_${o.tid}` : undefined;
};

// ---- the chooser: /wrapped/choose ------------------------------------------------------------------------

const Chooser = ({
	seasons,
	teamOptions,
	playerOptions,
}: LoadedProps) => {
	useTitleBar({ title: "Pick a Wrapped" });
	const [query, setQuery] = useState("");
	const season = seasons[0] ?? 0;

	const q = query.trim().toLowerCase();
	const hits =
		q === ""
			? playerOptions.slice(0, 6)
			: playerOptions.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8);

	const card = (title: string, text: string, body: ReactNode) => (
		<div className="card wrapped-choose__card">
			<div className="wrapped-choose__stripe" />
			<div className="card-body">
				<h2 className="card-title h5">{title}</h2>
				<p className="text-body-secondary mb-3">{text}</p>
				{body}
			</div>
		</div>
	);

	return (
		<div className="wrapped-choose">
			<p className="text-body-secondary">
				A tap-through story of a season, a team, a player or the whole league.
			</p>
			<div className="wrapped-choose__grid">
				{card(
					"A season",
					"The champions, the races and the nights nobody saw coming.",
					<div className="wrapped-choose__chips">
						{seasons.map((s, i) => (
							<a
								key={s}
								className={clsx(
									"btn wrapped-choose__chip",
									i === 0 ? "btn-light-bordered-primary" : "btn-light-bordered",
								)}
								href={url("season", s)}
							>
								{s}
							</a>
						))}
					</div>,
				)}
				{card(
					"A team",
					"One team's year: record, stars, big wins.",
					<select
						className="form-select"
						aria-label="Pick a team"
						defaultValue=""
						onChange={(e) => {
							const part = teamUrlPart(teamOptions, Number(e.target.value));
							if (part) {
								realtimeUpdate([], url("team", season, part));
							}
						}}
					>
						<option value="" disabled>
							Pick a team…
						</option>
						{teamOptions.map((t) => (
							<option key={t.tid} value={t.tid}>
								{t.label}
							</option>
						))}
					</select>,
				)}
				{card(
					"A player",
					"One player's season, slide by slide.",
					<>
						<input
							type="search"
							className="form-control"
							placeholder="Search players…"
							aria-label="Search for a player"
							autoComplete="off"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						<div className="list-group list-group-flush wrapped-choose__results mt-2">
							{hits.map((p) => (
								<a
									key={p.pid}
									className="list-group-item list-group-item-action d-flex justify-content-between"
									href={url("player", season, p.pid)}
								>
									<span>{p.label}</span>
									<span className="text-body-secondary">{p.abbrev}</span>
								</a>
							))}
							{hits.length === 0 ? (
								<div className="list-group-item text-body-secondary">
									No player found.
								</div>
							) : null}
						</div>
					</>,
				)}
				{card(
					"Compare",
					"Two players, two teams or two seasons, side by side.",
					<a
						className="btn btn-light-bordered"
						href={helpers.leagueUrl(["wrapped", "compare"])}
					>
						Compare two
					</a>,
				)}
				{card(
					"All-time",
					"Every season of this league in one story.",
					<a className="btn btn-primary" href={url("all", season)}>
						All-time Wrapped
					</a>,
				)}
			</div>
		</div>
	);
};

// ---- a deck ------------------------------------------------------------------------------------------------------

const Deck = (props: LoadedProps) => {
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

	const fields: TitleBarDropdownField<"mode" | "season" | "team" | "player">[] =
		[
			{
				key: "mode",
				options: MODES.map(([key, label]) => ({ key, label })),
				value: mode,
			},
		];
	if (mode !== "all") {
		fields.push({
			key: "season",
			options: seasons.map((s) => ({ key: s, label: String(s) })),
			value: season,
			buttons: "reverse",
		});
	}
	if (mode === "team" && tid !== undefined) {
		fields.push({
			key: "team",
			options: teamOptions.map((t) => ({
				key: t.tid,
				label: t.label,
				urlPart: `${t.abbrev}_${t.tid}`,
			})),
			value: tid,
		});
	}
	if (mode === "player" && pid !== undefined) {
		fields.push({
			key: "player",
			options: playerOptions.map((p) => ({
				key: p.pid,
				label: `${p.label} (${p.abbrev})`,
			})),
			value: pid,
		});
	}
	useTitleBar({
		title,
		dropdown: {
			fields,
			urlOverride: (v) => {
				const m = v.mode as WrappedMode;
				const s = v.season === undefined ? season : v.season;
				if (m === "all") {
					return ["wrapped", "all"];
				}
				if (m === "season") {
					return ["wrapped", "season", s];
				}
				if (m === "team") {
					return v.team === undefined || mode !== "team"
						? ["wrapped", "team", s]
						: ["wrapped", "team", s, v.team];
				}
				return v.player === undefined || mode !== "player"
					? ["wrapped", "player", s]
					: ["wrapped", "player", s, v.player];
			},
		},
	});

	const [count, setCount] = useState(() =>
		clampCount(safeLocalStorage.getItem(COUNT_KEY) ?? undefined, mode),
	);
	const [autoplay, setAutoplay] = useState(
		() => safeLocalStorage.getItem(AUTOPLAY_KEY) === "1",
	);
	const [showSettings, setShowSettings] = useState(false);
	const [exporting, setExporting] = useState<Slide | undefined>(undefined);
	const [reduced, setReduced] = useState(false);
	const prefs = useDeckPrefs();
	const getAnswer = useQuizAnswers();
	const slides = useMemo(
		() => planItems(cands, mode, count, seed, prefs),
		[cands, mode, count, seed, prefs],
	);
	const [i, setI] = useState(0);
	const back = useRef(false);
	const touchX = useRef<number | undefined>(undefined);
	const stageRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState<{ w: number; h: number } | undefined>();
	const [accents, setAccents] = useState(FALLBACK_ACCENTS);

	// New deck: back to the first slide
	useEffect(() => {
		setI(0);
		back.current = false;
	}, [seed, prefs.quiz, prefs.noSpoil]);

	useEffect(() => {
		setAccents(readAccents());
		setReduced(prefersReducedMotion());
	}, []);

	// The card: a 9:16 story card that fills the screen's height on a desktop, and the full width of the screen on a phone
	useLayoutEffect(() => {
		const measure = () => {
			const stage = stageRef.current;
			if (!stage) {
				return;
			}
			const phone = window.innerWidth < 576;
			const top = stage.getBoundingClientRect().top + window.scrollY;
			const pad = phone ? 0 : 32;
			const stageW = stage.clientWidth - pad;
			const avail = window.innerHeight - top - pad - (phone ? 4 : 12);
			let w;
			let h;
			if (phone) {
				w = stageW;
				h = Math.min(Math.max(avail, 420), w * 2.1);
			} else {
				h = Math.min(Math.max(avail, 460), 860);
				w = Math.min(Math.round((h * 9) / 16), stageW);
				h = Math.round((w * 16) / 9);
			}
			setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
		};
		measure();
		window.addEventListener("resize", measure);
		// The title bar and notifications above the card settle after the first render
		const observer = new ResizeObserver(measure);
		observer.observe(document.body);
		return () => {
			window.removeEventListener("resize", measure);
			observer.disconnect();
		};
	}, []);

	const cur = Math.min(i, slides.length - 1);
	const go = useCallback(
		(d: number) => {
			back.current = d < 0;
			setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)));
		},
		[slides.length],
	);
	const jump = (j: number) => {
		back.current = j < cur;
		setI(j);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (
				showSettings ||
				e.altKey ||
				e.ctrlKey ||
				e.metaKey ||
				(t &&
					(t.tagName === "INPUT" ||
						t.tagName === "SELECT" ||
						t.tagName === "TEXTAREA"))
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
	}, [go, showSettings]);

	// A quiz question waits for its answer
	const waiting = !!slides[cur]?.quiz && !getAnswer(seed, slides[cur]!.id);
	const playing =
		autoplay && !reduced && !showSettings && !waiting && cur < slides.length - 1;
	useEffect(() => {
		if (!playing) {
			return;
		}
		const timer = setTimeout(() => go(1), DWELL * 1000);
		return () => clearTimeout(timer);
	}, [playing, cur, go]);

	const unit = size ? Math.min(size.w / 100, (size.h * 0.5625) / 100) : 3.3;
	const slide = slides[cur];
	const look = useMemo(
		() => (slide ? slideLook(slide, teams, cur, accents) : undefined),
		[slide, teams, cur, accents],
	);

	// Save or copy the slide as a 1080x1920 image. It's drawn from a copy of the slide at a fixed size, off screen, so every device gives the same picture.
	const makeImage = async (action: "save" | "copy") => {
		if (!slide || exporting) {
			return;
		}
		setExporting(slide);
		try {
			// Two frames so the copy is laid out, then its pictures
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const host = hostRef.current;
			if (!host) {
				return;
			}
			await Promise.all(
				[...host.querySelectorAll("img")].map((img) =>
					img.complete
						? undefined
						: new Promise((r) => {
								img.onload = r;
								img.onerror = r;
							}),
				),
			);
			const { default: html2canvas } = await import("html2canvas");
			const canvas = await html2canvas(host, {
				backgroundColor: null,
				scale: EXPORT_SCALE,
				useCORS: true,
				width: EXPORT_W,
				height: EXPORT_H,
				onclone: (_doc, el) => {
					el.style.left = "0";
					el.style.top = "0";
				},
			});
			const blob = await new Promise<Blob | null>((r) =>
				canvas.toBlob(r, "image/png"),
			);
			if (!blob) {
				throw new Error("No image");
			}
			if (action === "copy") {
				await navigator.clipboard.write([
					new ClipboardItem({ "image/png": blob }),
				]);
				showNotification({
					type: "info",
					text: "Copied the slide as an image.",
				});
			} else {
				const objectUrl = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.download = `wrapped-${mode}-${season}-${cur + 1}.png`;
				a.href = objectUrl;
				a.click();
				setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
			}
		} catch (error) {
			console.error(error);
			showNotification({
				type: "error",
				text: "Couldn't make an image of this slide.",
			});
		} finally {
			setExporting(undefined);
		}
	};
	const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard;

	const exportLook = exporting
		? slideLook(exporting, teams, cur, accents)
		: undefined;

	const cardStyle: CSSProperties = {
		...look?.vars,
		width: size?.w,
		height: size?.h,
		"--wrapped-u": `${unit}px`,
		"--wrapped-dwell": `${DWELL}s`,
	} as CSSProperties;

	return (
		<>
			{soFar ? (
				<p className="text-body-secondary wrapped-note">
					This season isn’t over yet, so the deck covers it so far. Awards and
					the playoffs show up once they’re decided.
				</p>
			) : null}

			{slide && look ? (
				<div className="wrapped-stage" ref={stageRef}>
					<div
						className={clsx(
							"wrapped-card",
							look.solid && "wrapped-card--solid",
							!playing && "wrapped-card--paused",
						)}
						style={cardStyle}
						role="region"
						aria-roledescription="carousel"
						aria-label={title}
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
					>
						{/* Tapping the slide moves on, for touch screens; the arrow keys and the buttons do the same for everyone else */}
						{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
						<div
							className="wrapped-view"
							onClick={(e) => {
								const t = e.target as HTMLElement;
								if (
									t.closest("a, button") ||
									(window.getSelection()?.toString() ?? "") !== ""
								) {
									return;
								}
								const r = e.currentTarget.getBoundingClientRect();
								go(e.clientX - r.left < r.width * 0.3 ? -1 : 1);
							}}
						>
							<SlideCard
								key={slide.id}
								slide={slide}
								index={cur}
								count={slides.length}
								look={look}
								faces={faces}
								teams={teams}
								quiz={{ deck: seed, all: slides }}
								unit={unit}
								back={back.current}
								isLast={cur === slides.length - 1}
								onRestart={() => jump(0)}
							/>
						</div>

						<div className="wrapped-progress" role="group" aria-label="Slides">
							{slides.map((s, j) => (
								<button
									key={s.id}
									type="button"
									className={clsx(
										"wrapped-progress__seg",
										j < cur && "is-done",
										j === cur && (playing ? "is-playing" : "is-now"),
									)}
									title={s.kicker}
									aria-label={`Slide ${j + 1}: ${s.kicker}`}
									aria-current={j === cur ? "true" : undefined}
									onClick={() => jump(j)}
								>
									<i />
								</button>
							))}
						</div>
						<div className="wrapped-top">
							<span className="wrapped-top__t">
								<span className="wrapped-top__title">{title}</span>
								<span className="wrapped-top__n">
									{cur + 1} / {slides.length}
								</span>
							</span>
							<div className="wrapped-top__b">
								{reduced ? null : (
									<button
										type="button"
										className={clsx(
											"btn wrapped-btn wrapped-btn--icon",
											autoplay && "is-on",
										)}
										aria-pressed={autoplay}
										aria-label={autoplay ? "Pause" : "Play automatically"}
										title={autoplay ? "Pause" : "Play automatically"}
										onClick={() => {
											const on = !autoplay;
											setAutoplay(on);
											safeLocalStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
										}}
									>
										<span
											className={clsx(
												"glyphicon",
												autoplay ? "glyphicon-pause" : "glyphicon-play",
											)}
											aria-hidden="true"
										/>
									</button>
								)}
								<button
									type="button"
									className="btn wrapped-btn wrapped-btn--icon"
									aria-label="Settings"
									title="Settings"
									onClick={() => setShowSettings(true)}
								>
									<span aria-hidden="true">{"⚙︎"}</span>
								</button>
							</div>
						</div>
						<div className="wrapped-tools">
							<button
								type="button"
								className="btn wrapped-btn wrapped-btn--nav"
								disabled={cur === 0}
								aria-label="Previous slide"
								onClick={() => go(-1)}
							>
								<span
									className="glyphicon glyphicon-menu-left"
									aria-hidden="true"
								/>
							</button>
							<button
								type="button"
								className="btn wrapped-btn"
								disabled={!!exporting}
								title="Save this slide as a 1080×1920 image"
								onClick={() => makeImage("save")}
							>
								<span
									className="glyphicon glyphicon-download-alt"
									aria-hidden="true"
								/>
								<span className="wrapped-btn__long">Save image</span>
								<span className="wrapped-btn__short">Save</span>
							</button>
							{canCopy ? (
								<button
									type="button"
									className="btn wrapped-btn"
									disabled={!!exporting}
									title="Copy this slide as an image"
									onClick={() => makeImage("copy")}
								>
									<span
										className="glyphicon glyphicon-camera"
										aria-hidden="true"
									/>
									<span className="wrapped-btn__long">Copy image</span>
									<span className="wrapped-btn__short">Copy</span>
								</button>
							) : null}
							<button
								type="button"
								className="btn wrapped-btn wrapped-btn--nav"
								disabled={cur === slides.length - 1}
								aria-label="Next slide"
								onClick={() => go(1)}
							>
								<span
									className="glyphicon glyphicon-menu-right"
									aria-hidden="true"
								/>
							</button>
						</div>
					</div>
				</div>
			) : (
				<p>Nothing to show yet. Play some games first!</p>
			)}

			{exporting && exportLook ? (
				<div
					ref={hostRef}
					className={clsx(
						"wrapped-export-host",
						exportLook.solid && "wrapped-export-host--solid",
					)}
					style={
						{
							...exportLook.vars,
							"--wrapped-u": `${EXPORT_W / 100}px`,
						} as CSSProperties
					}
					aria-hidden="true"
				>
					<SlideCard
						slide={exporting}
						index={cur}
						count={slides.length}
						look={exportLook}
						faces={faces}
						teams={teams}
						quiz={{ deck: seed, all: slides }}
						unit={EXPORT_W / 100}
						staticMode
						foot={title}
					/>
				</div>
			) : null}

			<p className="mt-3 text-body-secondary">
				<a href={helpers.leagueUrl(["wrapped", "choose"])}>Another Wrapped</a>
				{" · "}
				<a href={helpers.leagueUrl(["wrapped", "compare"])}>Compare two</a>
				{" · "}
				<a href={helpers.leagueUrl(["storylines"])}>Storylines</a>
				<span className="d-none d-md-inline">
					{" · Use ← and → to move between slides."}
				</span>
			</p>

			<Modal show={showSettings} onHide={() => setShowSettings(false)} centered>
				<Modal.Header closeButton>
					<Modal.Title>Wrapped settings</Modal.Title>
				</Modal.Header>
				<Modal.Body>
					<div className="mb-3">
						<label className="form-label" htmlFor="wrapped-count">
							Slides
						</label>
						<select
							id="wrapped-count"
							className="form-select"
							value={count}
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
						<div className="form-text">
							The best ones for this deck, never padded with weak slides.
						</div>
					</div>
					{reduced ? null : (
						<div className="form-check form-switch mb-3">
							<input
								className="form-check-input"
								type="checkbox"
								role="switch"
								id="wrapped-autoplay"
								checked={autoplay}
								onChange={(e) => {
									setAutoplay(e.target.checked);
									safeLocalStorage.setItem(
										AUTOPLAY_KEY,
										e.target.checked ? "1" : "0",
									);
								}}
							/>
							<label className="form-check-label" htmlFor="wrapped-autoplay">
								Play automatically
								<div className="form-text mt-0">
									Moves on every {DWELL} seconds, like a story.
								</div>
							</label>
						</div>
					)}
					<DeckOptions showSpoil={mode !== "all" && !soFar} />
					<div className="d-grid gap-2">
						<a
							className="btn btn-light-bordered"
							href={helpers.leagueUrl(["wrapped", "compare"])}
						>
							Compare two players, teams or seasons
						</a>
						<a
							className="btn btn-light-bordered"
							href={helpers.leagueUrl(["wrapped", "choose"])}
						>
							Pick another Wrapped
						</a>
					</div>
				</Modal.Body>
				<Modal.Footer>
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => setShowSettings(false)}
					>
						Done
					</button>
				</Modal.Footer>
			</Modal>
		</>
	);
};

// The league's history is read in the worker, which can take a while for a big league the first time. Until it's ready the page shows a placeholder.
const WrappedLoadingPage = ({
	progress,
	mode,
}: {
	progress: string;
	mode: WrappedMode;
}) => {
	useTitleBar({ title: mode === "all" ? "All-Time Wrapped" : "Wrapped" });
	return <WrappedLoading progress={progress} kind="deck" />;
};

const Wrapped = (props: View<"wrapped">) => {
	if (props.loading) {
		return <WrappedLoadingPage progress={props.progress} mode={props.mode} />;
	}
	if (props.choose) {
		return <Chooser {...props} />;
	}
	return <Deck {...props} />;
};

export default Wrapped;
