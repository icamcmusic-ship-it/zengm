import type { CSSProperties } from "react";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";
import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";
import type { Slide } from "../../../common/wrapped/types.ts";

type Data = Extract<View<"wrapped">, { loading: false }>;

// Gradient colors for slides that aren't about one team
const PALETTE: [string, string][] = [
	["#4b2a99", "#d6336c"],
	["#0b7285", "#2b8a3e"],
	["#c2255c", "#f08c00"],
	["#1864ab", "#5f3dc4"],
	["#2b8a3e", "#e67700"],
	["#862e9c", "#1c7ed6"],
];

const textColor = (hex: string) => {
	const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
	if (!m) {
		return "#fff";
	}
	const v = Number.parseInt(m[1]!, 16);
	const lum =
		(0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
	return lum > 0.6 ? "#111" : "#fff";
};

const lum = (hex: string) => {
	const v = Number.parseInt(hex.slice(1), 16);
	return (
		(0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255
	);
};

// Darkest team color first, so white text reads well; a near-white second color is skipped
export const slideColors = (slide: Slide, teams: Data["teams"], i: number) => {
	const t = slide.tid !== undefined ? teams[`${slide.tid}`] : undefined;
	const cs = (t?.colors ?? []).filter((c) => /^#[\da-f]{6}$/i.test(c));
	if (cs.length >= 2) {
		const sorted = [...cs].sort((a, b) => lum(a) - lum(b));
		const c1 = sorted[0]!;
		const c2 = sorted.slice(1).find((c) => lum(c) < 0.85) ?? c1;
		if (lum(c1) < 0.6) {
			return [c1, c2] as [string, string];
		}
	}
	return PALETTE[i % PALETTE.length]!;
};

export const SlideCard = ({
	slide,
	index,
	faces,
	teams,
}: {
	slide: Slide;
	index: number;
	faces: Data["faces"];
	teams: Data["teams"];
}) => {
	const [c1, c2] = slideColors(slide, teams, index);
	const fg = textColor(c1);
	const style: CSSProperties = {
		background: `linear-gradient(150deg, ${c1} 0%, ${c1} 40%, ${c2} 140%)`,
		color: fg,
		borderRadius: 16,
		minHeight: 480,
		maxWidth: 520,
		textShadow: fg === "#fff" ? "0 1px 3px rgba(0,0,0,0.45)" : undefined,
		overflow: "hidden",
	};
	const linkStyle: CSSProperties = { color: fg, textDecoration: "underline" };
	const face = slide.pid !== undefined ? faces[slide.pid] : undefined;
	const team = slide.tid !== undefined ? teams[`${slide.tid}`] : undefined;
	const head = slide.head ?? slide.heads[0]!;
	const said = [head, slide.kicker, ...slide.lines].join(" ");
	const showWho =
		slide.who !== undefined &&
		!said.includes(slide.who) &&
		!said.includes(slide.who.split(" ").at(-1)!);
	const headSize =
		head.length > 60 ? "1.35rem" : head.length > 36 ? "1.65rem" : "2rem";

	let picture = null;
	if (face && (face.imgURL || face.face)) {
		const ft = teams[`${face.tid}`];
		picture = (
			<div style={{ width: 96, height: 144, flexShrink: 0 }}>
				<PlayerPicture
					face={face.face}
					imgURL={face.imgURL}
					colors={ft?.colors}
				/>
			</div>
		);
	} else if (team?.imgURL) {
		picture = (
			<img
				alt=""
				src={team.imgURL}
				style={{ maxWidth: 96, maxHeight: 96, flexShrink: 0 }}
			/>
		);
	}

	return (
		<div className="p-4 d-flex flex-column mx-auto wrapped-slide" style={style}>
			<div
				className="text-uppercase fw-bold small"
				style={{ letterSpacing: "0.08em", opacity: 0.85 }}
			>
				{slide.kicker}
			</div>
			<h2
				className="fw-bold mt-2 mb-3"
				style={{ fontSize: headSize, lineHeight: 1.15 }}
			>
				{head}
			</h2>
			{showWho ? (
				<div className="fs-5 mb-2 mt-n2" style={{ opacity: 0.9 }}>
					{slide.who}
				</div>
			) : null}
			{slide.hero || picture ? (
				<div className="d-flex align-items-center gap-3 mb-3">
					{picture}
					{slide.hero ? (
						<div>
							<div
								className="fw-bold"
								style={{
									fontSize: slide.hero.text.length > 6 ? "3rem" : "4.5rem",
									lineHeight: 1,
								}}
							>
								{slide.hero.text}
							</div>
							{slide.hero.unit ? (
								<div className="fs-5" style={{ opacity: 0.9 }}>
									{slide.hero.unit}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
			{slide.chips && slide.chips.length > 0 ? (
				<div className="d-flex flex-wrap gap-2 mb-3">
					{slide.chips.map(([k, v]) => (
						<span
							key={k}
							className="px-2 py-1 rounded"
							style={{
								background: "rgba(0,0,0,0.25)",
								textShadow: "none",
								color: "#fff",
							}}
						>
							<span style={{ opacity: 0.8 }}>{k}</span> <b>{v}</b>
						</span>
					))}
				</div>
			) : null}
			{slide.list && slide.list.length > 0 ? (
				<table className="mb-3 w-100" style={{ color: fg }}>
					<tbody>
						{slide.list.map((r, i) => (
							<tr
								key={i}
								style={{ borderBottom: "1px solid rgba(255,255,255,0.2)" }}
							>
								<td className="py-1 pe-2">
									{r.pid !== undefined ? (
										<a
											href={helpers.leagueUrl(["player", r.pid])}
											style={linkStyle}
										>
											{r.name}
										</a>
									) : (
										r.name
									)}
									{r.sub ? (
										<div className="small" style={{ opacity: 0.8 }}>
											{r.sub}
										</div>
									) : null}
								</td>
								<td className="py-1 text-end fw-bold">{r.value}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
			{slide.lines.length > 0 ? (
				<ul className="ps-3 mb-2">
					{slide.lines.map((l, i) => (
						<li key={i}>{l}</li>
					))}
				</ul>
			) : null}
			<div className="mt-auto">
				{slide.note ? (
					<div className="small" style={{ opacity: 0.8 }}>
						{slide.note}
					</div>
				) : null}
				{slide.pid !== undefined && !slide.list ? (
					<a
						className="small"
						href={helpers.leagueUrl(["player", slide.pid])}
						style={linkStyle}
					>
						Player page
					</a>
				) : null}
			</div>
		</div>
	);
};
