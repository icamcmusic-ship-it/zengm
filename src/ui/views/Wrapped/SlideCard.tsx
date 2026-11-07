import clsx from "clsx";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";
import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";
import type { Slide } from "../../../common/wrapped/types.ts";

type Data = View<"wrapped">;

// Styles are in public/css/wrapped.scss. Sizes there are multiples of --wrapped-u, which index.tsx sets from the card's size.

const LAYOUTS = ["a", "b", "c", "d", "e"] as const;
const TRANSITIONS = ["fade", "slide", "zoom", "wipe", "tilt"] as const;

// Fallback colors for slides that aren't about one team come from the theme (see accents in index.tsx)
export const FALLBACK_ACCENTS = [
	"#0d6efd",
	"#6f42c1",
	"#d63384",
	"#fd7e14",
	"#198754",
	"#20c997",
];

const hash = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

const isHex = (c: string | undefined): c is string =>
	c !== undefined && /^#[\da-f]{6}$/i.test(c.trim());

const rgb = (hex: string): [number, number, number] => {
	const v = Number.parseInt(hex.slice(1), 16);
	return [v >> 16, (v >> 8) & 255, v & 255];
};

// Perceived brightness, 0..1
const lum = (hex: string) => {
	const [r, g, b] = rgb(hex);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

// WCAG relative luminance, for choosing readable text on a color
const relLum = (hex: string) => {
	const [r, g, b] = rgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Black or white text, whichever reads better on the color
const ink = (hex: string) => {
	const l = relLum(hex);
	return (l + 0.05) / (relLum("#111111") + 0.05) >=
		(1.05) / (l + 0.05)
		? "#111111"
		: "#ffffff";
};

export type SlideLook = {
	lay: (typeof LAYOUTS)[number];
	bg: number;
	tx: (typeof TRANSITIONS)[number];
	solid: boolean;
	vars: CSSProperties;
	rot: string;
};

// Darkest team color first, so white text reads well; a near-white second color is skipped
const teamColors = (slide: Slide, teams: Data["teams"]) => {
	const t = slide.tid !== undefined ? teams[`${slide.tid}`] : undefined;
	const cs = (t?.colors ?? []).filter(isHex);
	if (cs.length >= 2) {
		const sorted = [...cs].sort((a, b) => lum(a) - lum(b));
		const c1 = sorted[0]!;
		const c2 = sorted.slice(1).find((c) => lum(c) < 0.85) ?? c1;
		return [c1, c2] as [string, string];
	}
	return undefined;
};

// How a slide looks: its colors and the seeded layout, backdrop and transition. The colors become CSS variables on the card (so the buttons around the slide match it) and on the export host.
export const slideLook = (
	slide: Slide,
	teams: Data["teams"],
	index: number,
	accents: string[],
): SlideLook => {
	const h = hash(slide.id);
	const own = teamColors(slide, teams);
	const palette = accents.filter(isHex);
	const pal = palette.length >= 2 ? palette : FALLBACK_ACCENTS;
	const [c1, c2] = own ?? [
		pal[(h + index) % pal.length]!,
		pal[(h + index + 2) % pal.length]!,
	];
	let lay = LAYOUTS[h % LAYOUTS.length]!;
	if (slide.id === "intro") {
		lay = "a";
	} else if (slide.id === "summary") {
		lay = "c";
	}
	// Alternate washed and solid slides so a deck has rhythm
	const solid =
		slide.id === "intro" || slide.id === "summary"
			? slide.id === "intro"
			: (h >>> 3) % 100 < 42 && lum(c1) < 0.8;
	const inkColor = ink(c1);
	return {
		lay,
		bg: 1 + ((h >>> 5) % 5),
		tx: TRANSITIONS[(h >>> 7) % TRANSITIONS.length]!,
		solid,
		rot: `${(((h >>> 9) % 400) / 10 - 20).toFixed(1)}deg`,
		vars: {
			"--wrapped-c1": c1,
			"--wrapped-c1-rgb": rgb(c1).join(", "),
			"--wrapped-c2": c2,
			"--wrapped-c2-rgb": rgb(c2).join(", "),
			"--wrapped-ink": inkColor,
			"--wrapped-ink-rgb": rgb(inkColor).join(", "),
		} as CSSProperties,
	};
};

const prefersReducedMotion = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A big number that counts up when its slide opens. The final text is what's rendered at rest, and what an export sees.
const Count = ({ text, animate }: { text: string; animate: boolean }) => {
	const m = /^(\d[\d,]*)(?:\.(\d+))?$/.exec(text);
	const [shown, setShown] = useState(
		animate && m && !prefersReducedMotion() ? "0" : text,
	);

	useEffect(() => {
		if (!animate || !m || prefersReducedMotion()) {
			setShown(text);
			return;
		}
		const to = Number.parseFloat(m[1]!.replaceAll(",", "") + (m[2] ? `.${m[2]}` : ""));
		const dec = m[2]?.length ?? 0;
		const fmt = new Intl.NumberFormat("en-US", {
			minimumFractionDigits: dec,
			maximumFractionDigits: dec,
			useGrouping: m[1]!.includes(","),
		});
		const start = performance.now();
		const dur = 900;
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			const eased = 1 - (1 - t) ** 3;
			setShown(t >= 1 ? text : fmt.format(to * eased));
			if (t < 1) {
				raf = requestAnimationFrame(tick);
			}
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text, animate]);

	return (
		<span data-to={text} className="wrapped-count">
			{shown}
		</span>
	);
};

const TeamLogo = ({
	team,
	size,
}: {
	team: Data["teams"][string] | undefined;
	size?: "sm" | "md";
}) => {
	if (!team) {
		return null;
	}
	const [c1, , c3] = team.colors;
	return (
		<span className={clsx("wrapped-slide__logo", size && `wrapped-slide__logo--${size}`)}>
			{team.imgURL ? (
				<img alt="" src={team.imgURL} />
			) : (
				<span
					className="wrapped-slide__abbr"
					style={{
						background: isHex(c1) ? c1 : undefined,
						color: isHex(c1) ? ink(c1) : undefined,
						borderColor: c3,
					}}
				>
					{team.abbrev}
				</span>
			)}
		</span>
	);
};

const numeric = (v: string) => {
	if (!/^[+-]?[\d,]*\.?\d+%?$/.test(v.trim())) {
		return undefined;
	}
	const n = Number.parseFloat(v.replaceAll(",", ""));
	return Number.isFinite(n) ? n : undefined;
};

// "62-20" style records: the bar is the share of wins
const recordShare = (v: string) => {
	const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(v.trim());
	if (!m) {
		return undefined;
	}
	const w = Number(m[1]);
	const l = Number(m[2]) + Number(m[3] ?? 0);
	return w + l > 0 ? w / (w + l) : undefined;
};

// Does a list read as a ranking (best first or last, comparable numbers)? Then it gets rank badges and bars.
const rankingOf = (list: NonNullable<Slide["list"]>) => {
	if (list.length < 3) {
		return undefined;
	}
	const shares = list.map((r) => recordShare(r.value));
	if (shares.every((v) => v !== undefined)) {
		return { nums: shares as number[], max: 1, desc: true };
	}
	const vals = list.map((r) => numeric(r.value));
	if (vals.some((v) => v === undefined || v < 0)) {
		return undefined;
	}
	const nums = vals as number[];
	// Years and the like aren't amounts
	if (nums.every((v) => Number.isInteger(v) && v >= 1000 && v <= 3000)) {
		return undefined;
	}
	// Everyone tied: nothing to rank or compare
	if (nums.every((v) => v === nums[0])) {
		return undefined;
	}
	const desc = nums.every((v, i) => i === 0 || v <= nums[i - 1]!);
	const asc = nums.every((v, i) => i === 0 || v >= nums[i - 1]!);
	if (!desc && !asc) {
		return undefined;
	}
	const max = Math.max(...nums);
	return { nums, max, desc };
};

const headSize = (head: string) =>
	head.length > 78 ? "xs" : head.length > 44 ? "sm" : undefined;

const megaSize = (text: string) =>
	text.length > 6 ? "xl" : text.length > 4 ? "l" : undefined;

export const SlideCard = ({
	slide,
	index,
	count,
	look,
	faces,
	teams,
	unit,
	back,
	staticMode,
	foot,
	isLast,
	onRestart,
}: {
	slide: Slide;
	index: number;
	count: number;
	look: SlideLook;
	faces: Data["faces"];
	teams: Data["teams"];
	// The card's unit in px; the fit step runs again when it changes
	unit: number;
	// Going to an earlier slide plays the transition in reverse
	back?: boolean;
	// For the image export: no animations, a footer
	staticMode?: boolean;
	foot?: string;
	// The last slide of a deck offers watching again and picking another
	isLast?: boolean;
	onRestart?: () => void;
}) => {
	const slideRef = useRef<HTMLElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [rowLimit, setRowLimit] = useState<number | undefined>(undefined);

	const head = slide.head ?? slide.heads[0]!;
	const face = slide.pid !== undefined ? faces[slide.pid] : undefined;
	const team = slide.tid !== undefined ? teams[`${slide.tid}`] : undefined;
	const h = hash(`${slide.id}|v`);
	const said = [head, slide.kicker, ...slide.lines].join(" ");
	const showWho =
		slide.who !== undefined &&
		!said.includes(slide.who) &&
		!said.includes(slide.who.split(" ").at(-1)!);
	const isSummary = slide.id === "summary";
	const animate = !staticMode;

	// Shrink the slide's unit until its content fits, then drop list rows as a last resort
	useEffect(() => {
		setRowLimit(undefined);
	}, [unit]);
	useLayoutEffect(() => {
		const el = slideRef.current;
		const c = contentRef.current;
		if (!el || !c) {
			return;
		}
		const overflows = () => {
			const kids = [...c.children] as HTMLElement[];
			if (kids.length === 0) {
				return false;
			}
			const cs = getComputedStyle(c);
			const inner =
				c.clientHeight -
				Number.parseFloat(cs.paddingTop) -
				Number.parseFloat(cs.paddingBottom);
			const first = kids[0]!;
			const last = kids.at(-1)!;
			const used = last.offsetTop + last.offsetHeight - first.offsetTop;
			return (
				used > inner + 1 || kids.some((k) => k.scrollWidth > k.clientWidth + 1)
			);
		};
		for (const f of [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.57, 0.52]) {
			el.style.setProperty("--wrapped-fit", String(f));
			if (!overflows()) {
				return;
			}
		}
		const n = rowLimit ?? slide.list?.length ?? 0;
		if (n > 2) {
			setRowLimit(n - 1);
		}
	}, [slide, unit, rowLimit]);

	let picture: ReactNode = null;
	if (face && (face.imgURL || face.face)) {
		const ft = teams[`${face.tid}`];
		picture = (
			<div className="wrapped-slide__face">
				<PlayerPicture
					face={face.face}
					imgURL={face.imgURL}
					colors={ft?.colors}
				/>
			</div>
		);
	} else if (team) {
		picture = <TeamLogo team={team} />;
	}

	let n = 0;
	const inn = () => ({ "--i": n++ }) as CSSProperties;
	const cls = (c: string) => clsx(c, animate && "wrapped-in");

	const hero = slide.hero ? (
		<div
			className={clsx(
				"wrapped-slide__mega",
				megaSize(slide.hero.text) &&
					`wrapped-slide__mega--${megaSize(slide.hero.text)}`,
			)}
		>
			<Count text={slide.hero.text} animate={animate} />
			{slide.hero.unit ? <small>{slide.hero.unit}</small> : null}
		</div>
	) : null;
	const who = showWho ? (
		<div className="wrapped-slide__name">{slide.who}</div>
	) : null;

	let heroBlock: ReactNode = null;
	if (hero && picture && h % 2 === 0) {
		// Picture beside the number
		heroBlock = (
			<div className={cls("wrapped-slide__duo")} style={inn()}>
				{picture}
				<div className="wrapped-slide__hero-txt">
					{hero}
					{who}
				</div>
			</div>
		);
	} else if (hero) {
		// The number on its own line, the picture and name under it
		heroBlock = (
			<>
				<div className={cls("wrapped-slide__hero")} style={inn()}>
					{hero}
				</div>
				{picture || who ? (
					<div className={cls("wrapped-slide__duo")} style={inn()}>
						{picture}
						{who}
					</div>
				) : null}
			</>
		);
	} else if (picture) {
		heroBlock = (
			<div className={cls("wrapped-slide__duo")} style={inn()}>
				{picture}
				{who}
			</div>
		);
	} else if (who) {
		heroBlock = (
			<div className={cls("wrapped-slide__duo")} style={inn()}>
				{who}
			</div>
		);
	}

	const chips = slide.chips && slide.chips.length > 0 ? slide.chips : undefined;
	const list = slide.list?.slice(0, rowLimit);
	const ranking = slide.list ? rankingOf(slide.list) : undefined;
	const hasBody = !!(hero || picture || chips || list);

	const lines = slide.lines;
	let lineBlock: ReactNode = null;
	if (lines.length === 1) {
		lineBlock = hasBody ? (
			<p className={cls("wrapped-slide__sub")} style={inn()}>
				{lines[0]}
			</p>
		) : (
			<div className={cls("wrapped-slide__line")} style={inn()}>
				{lines[0]}
			</div>
		);
	} else if (lines.length > 1) {
		lineBlock = (
			<ul className={cls("wrapped-slide__facts")} style={inn()}>
				{lines.map((l, i) => (
					<li key={i}>{l}</li>
				))}
			</ul>
		);
	}

	const size = headSize(head);
	const body = (
		<>
			{slide.kicker ? (
				<div className={cls("wrapped-slide__kicker")} style={inn()}>
					{slide.kicker}
				</div>
			) : null}
			<h2
				className={cls(
					clsx("wrapped-slide__head", size && `wrapped-slide__head--${size}`),
				)}
				style={inn()}
			>
				{head}
			</h2>
			{heroBlock}
			{chips ? (
				isSummary ? (
					<div className={cls("wrapped-slide__tiles")} style={inn()}>
						{chips.map(([k, v]) => (
							<div className="wrapped-slide__tile" key={k}>
								<span>{k}</span>
								<b>{v}</b>
							</div>
						))}
					</div>
				) : (
					<div
						className={cls("wrapped-slide__chips")}
						style={{ ...inn(), "--n": Math.min(4, chips.length) } as CSSProperties}
					>
						{chips.map(([k, v]) => (
							<div className="wrapped-slide__chip" key={k}>
								<b>{v}</b>
								<span>{k}</span>
							</div>
						))}
					</div>
				)
			) : null}
			{list && list.length > 0 ? (
				<ol className="wrapped-slide__rows">
					{list.map((r, i) => {
						const t = r.tid !== undefined ? teams[`${r.tid}`] : undefined;
						const nameEl =
							r.pid !== undefined ? (
								<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>
							) : (
								r.name
							);
						const top = ranking !== undefined && i === 0;
						return (
							<li
								key={`${r.name}-${i}`}
								className={clsx(
									"wrapped-slide__row",
									animate && "wrapped-in",
									top && "is-top",
								)}
								style={{ "--i": i } as CSSProperties}
							>
								{ranking ? (
									<span className="wrapped-slide__rank">{i + 1}</span>
								) : null}
								{t ? <TeamLogo team={t} size="sm" /> : null}
								<span className="wrapped-slide__who">
									<span>{nameEl}</span>
									{r.sub ? <small>{r.sub}</small> : null}
									{ranking && ranking.max > 0 && list.length > 2 ? (
										<span className="wrapped-slide__bar" aria-hidden="true">
											<i
												style={{
													width: `${Math.max(4, (ranking.nums[i]! / ranking.max) * 100)}%`,
												}}
											/>
										</span>
									) : null}
								</span>
								<span
									className={clsx(
										"wrapped-slide__val",
										numeric(r.value) === undefined && "wrapped-slide__val--text",
									)}
								>
									{r.value}
								</span>
							</li>
						);
					})}
				</ol>
			) : null}
			{lineBlock}
			{slide.note ? (
				// A short note is a stamp on the slide, a longer one a quiet caption
				<div
					className={cls(
						slide.note.length <= 48 && hasBody
							? "wrapped-slide__stamp"
							: "wrapped-slide__gloss",
					)}
					style={inn()}
				>
					{slide.note}
				</div>
			) : null}
			{isLast ? (
				<div className={cls("wrapped-slide__links")} style={inn()}>
					<button type="button" onClick={onRestart}>
						Watch again
					</button>
					<a href={helpers.leagueUrl(["wrapped", "choose"])}>Another Wrapped</a>
				</div>
			) : null}
			{slide.pid !== undefined && !slide.list ? (
				<div className={cls("wrapped-slide__links")} style={inn()}>
					<a href={helpers.leagueUrl(["player", slide.pid])}>Player page</a>
				</div>
			) : null}
		</>
	);

	return (
		<section
			ref={slideRef}
			aria-roledescription="slide"
			aria-label={`${index + 1} of ${count}`}
			className={clsx(
				"wrapped-slide",
				`wrapped-slide--lay-${look.lay}`,
				`wrapped-slide--bg-${look.bg}`,
				`wrapped-slide--tx-${look.tx}`,
				`wrapped-slide--${slide.id}`,
				back && "wrapped-slide--back",
				staticMode && "wrapped-slide--static",
			)}
			style={{ "--wrapped-rot": look.rot } as CSSProperties}
		>
			<div className="wrapped-slide__deco" aria-hidden="true">
				<i className="wrapped-slide__d1" />
				<i className="wrapped-slide__d2" />
				<i className="wrapped-slide__d3" />
			</div>
			<div className="wrapped-slide__content" ref={contentRef}>
				{body}
			</div>
			<div className="wrapped-slide__foot">
				<span>{foot}</span>
				<span>
					{index + 1} / {count}
				</span>
			</div>
		</section>
	);
};
