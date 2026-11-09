import { usePersistedOpen } from "../util/persistedOpen.ts";
// Game hype pieces shared by the dashboard card, the schedule badges, the Games to Watch page and the box score panel (basketball only)
import clsx from "clsx";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { HypeLite } from "../../common/hype/types.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { useFeatureOption } from "../util/nativeFeatures.ts";

const TOKEN = /\[\[p:(\d+)\|([^\]]*)]]/g;

// Text with [[p:pid|Name]] tokens, as links to the players
export const HypeText = ({ text }: { text: string }) => {
	const parts: ReactNode[] = [];
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		parts.push(
			text.slice(last, m.index),
			<a key={m.index} href={helpers.leagueUrl(["player", Number(m[1])])}>
				{m[2]}
			</a>,
		);
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

const heat = (score: number) =>
	score >= 90
		? "text-bg-danger"
		: score >= 75
			? "text-bg-warning"
			: score >= 60
				? "text-bg-primary"
				: score >= 45
					? "text-bg-secondary"
					: "border text-body-secondary";

export const HypeBadge = ({
	score,
	label,
	className,
	title,
}: {
	score: number;
	label: string;
	className?: string;
	title?: string;
}) => (
	<span
		className={clsx("badge fw-normal", heat(score), className)}
		title={title ?? `Hype ${score} out of 100`}
	>
		<b>{score}</b> {label}
	</span>
);

// Hype of games by gid, computed in the worker when needed. Keeps the previous answer while a new one loads.
export const useHypeGids = (gids: number[]) => {
	const [data, setData] = useState<Record<number, HypeLite>>({});
	// League extras: no hype on schedules and box scores when it's turned off
	const on = useFeatureOption<boolean>("featureHypeSchedule");
	const key = on ? gids.join(",") : "";
	useEffect(() => {
		if (!on || gids.length === 0) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const d = await toWorker("hype", "forGids", { gids });
				if (!cancelled) {
					setData(d);
				}
			} catch (error) {
				console.error(error);
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);
	return on ? data : {};
};

const verdictClass = (kind: string) =>
	kind === "lived" || kind === "exceeded"
		? "text-success"
		: kind === "fizzled"
			? "text-danger"
			: "text-body-secondary";

export const Reasons = ({
	reasons,
	max,
}: {
	reasons: HypeLite["reasons"];
	max?: number;
}) => (
	<ul className="mb-0 ps-3">
		{reasons.slice(0, max).map((r, i) => (
			<li
				key={i}
				className={r.pts < 0 ? "text-body-secondary" : undefined}
				title={`${r.pts > 0 ? "+" : ""}${r.pts} points`}
			>
				{r.pts < 0 ? (
					<span className="text-danger" aria-label="lowers the score">
						−{" "}
					</span>
				) : null}
				<HypeText text={r.text} />
			</li>
		))}
	</ul>
);

export const gameUrl = (h: HypeLite) => {
	const t = h.teams[0]!;
	return helpers.leagueUrl([
		"game_log",
		`${t.abbrev}_${t.tid}`,
		h.season,
		h.gid,
	]);
};

// One game: "AWAY (record) at HOME (record)", the badge, and the reasons
export const HypeGameRow = ({
	h,
	maxReasons = 3,
	showResult,
}: {
	h: HypeLite;
	maxReasons?: number;
	showResult?: boolean;
}) => {
	const [home, away] = h.teams;
	return (
		<div className="mb-3">
			<div className="d-flex flex-wrap align-items-baseline gap-2">
				<b>
					{away!.abbrev} at {home!.abbrev}
				</b>
				<span className="text-body-secondary">
					{away!.record} vs {home!.record}
				</span>
				<HypeBadge score={h.score} label={h.label} />
				{showResult && h.completed ? (
					<a href={gameUrl(h)} className="ms-auto">
						{away!.abbrev} {away!.pts}, {home!.abbrev} {home!.pts}
					</a>
				) : null}
			</div>
			{h.reasons.length > 0 ? (
				<Reasons reasons={h.reasons} max={maxReasons} />
			) : (
				<div className="text-body-secondary">Nothing special on paper.</div>
			)}
			{h.reasons.length > maxReasons ? (
				<details>
					<summary className="text-body-secondary small">
						{h.reasons.length - maxReasons} more
					</summary>
					<Reasons reasons={h.reasons.slice(maxReasons)} />
				</details>
			) : null}
			{showResult && h.verdict ? (
				<div className={clsx("small", verdictClass(h.verdict.kind))}>
					<HypeText text={h.verdict.text} />
				</div>
			) : null}
		</div>
	);
};

// A compact line under a game on the schedule: the badge and the top reason (for a finished game, the verdict), the rest on click
export const HypeLine = ({
	h,
	className,
}: {
	h: HypeLite | undefined;
	className?: string;
}) => {
	if (!h) {
		return null;
	}
	const top = h.reasons[0];
	return (
		<div className={clsx("hype-line", className)}>
			<details>
				<summary className="d-flex flex-wrap align-items-baseline gap-2">
					<HypeBadge score={h.score} label={h.label} />
					{h.completed && h.verdict ? (
						<span className={clsx("small", verdictClass(h.verdict.kind))}>
							<HypeText text={h.verdict.head} />
						</span>
					) : top ? (
						<span className="text-body-secondary small">
							<HypeText text={top.text} />
						</span>
					) : (
						<span className="text-body-secondary small">
							Nothing special on paper
						</span>
					)}
				</summary>
				<div className="small mt-1">
					{h.series ? <div className="mb-1">{h.series}</div> : null}
					<Reasons reasons={h.reasons} />
					{h.completed && h.verdict ? (
						<div className={clsx("mt-1", verdictClass(h.verdict.kind))}>
							<HypeText text={h.verdict.text} />
						</div>
					) : null}
				</div>
			</details>
		</div>
	);
};

// The panel under a box score: hype before the game and, for a finished game, whether it lived up to it
export const GameHype = ({ gid }: { gid: number }) => {
	const data = useHypeGids(__SPORT === "basketball" && gid >= 0 ? [gid] : []);
	const [open, toggle] = usePersistedOpen("gameHypeOpen", false);
	const h = data[gid];
	if (__SPORT !== "basketball" || !h) {
		return null;
	}
	return (
		<div className="card mt-3 mb-3">
			<div className="card-body">
				<h3 className="card-title h5 d-flex flex-wrap align-items-baseline gap-2 mb-0">
					<button
						type="button"
						className="btn btn-link p-0 text-reset text-decoration-none fw-bold"
						onClick={toggle}
						aria-expanded={open}
					>
						<span className="me-1">{open ? "▾" : "▸"}</span>
						Game hype
					</button>
					<HypeBadge
						score={h.score}
						label={h.label}
						title={`Pre-game hype ${h.score} out of 100`}
					/>
					{h.completed && h.post ? (
						<>
							<small className="text-body-secondary fs-6">game rating</small>
							<HypeBadge
								score={h.post.score}
								label={h.post.label}
								title={`Game rating ${h.post.score} out of 100`}
							/>
						</>
					) : (
						<small className="text-body-secondary fs-6">before tip-off</small>
					)}
				</h3>
				{open ? (
					<div className="mt-2">
						{h.series ? <p className="mb-2">{h.series}</p> : null}
						{h.reasons.length > 0 ? (
							<Reasons reasons={h.reasons} />
						) : (
							<p className="mb-0">Nothing special on paper going in.</p>
						)}
						{h.completed && h.post ? (
							<div className="mt-3">
								<div className="d-flex flex-wrap align-items-baseline gap-2">
									<b>How it played out</b>
									<HypeBadge
										score={h.post.score}
										label={h.post.label}
										title={`Game rating ${h.post.score} out of 100`}
									/>
								</div>
								{h.verdict ? (
									<p
										className={clsx(
											"mb-1 fw-bold",
											verdictClass(h.verdict.kind),
										)}
									>
										<HypeText text={h.verdict.text} />
									</p>
								) : null}
								{h.post.note ? (
									<p className="text-body-secondary mb-0">{h.post.note}</p>
								) : (
									<Reasons reasons={h.post.reasons} max={6} />
								)}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
};
