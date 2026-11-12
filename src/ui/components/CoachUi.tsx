// Shared pieces of the coaching pages (Coaching Staff, Coaches, Coach's notes, the coach page), so they look and read the same
import clsx from "clsx";
import type { FaceConfig } from "facesjs";
import type { ReactNode } from "react";
import {
	COACH_TERMS,
	hotSeatColor,
	ratingColor,
	ratingWord,
	type CoachTerm,
} from "../../common/staffText.ts";
import { COACH_RATING_NAMES } from "../../common/staff.ts";
import type { CoachRatings } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { HelpPopover } from "./HelpPopover.tsx";
import { StaffFace } from "./StaffFace.tsx";

// The "What does this mean?" popover for a concept
export const TermHelp = ({ term }: { term: CoachTerm }) => (
	<HelpPopover title={COACH_TERMS[term].title} className="ms-1">
		{COACH_TERMS[term].text}
	</HelpPopover>
);

// A concept's name with its help popover
export const Term = ({
	children,
	term,
}: {
	children?: ReactNode;
	term: CoachTerm;
}) => (
	<span className="text-nowrap">
		{children ?? COACH_TERMS[term].title}
		<TermHelp term={term} />
	</span>
);

export const CoachPortrait = ({
	age,
	colors,
	face,
	seed,
	width,
}: {
	age?: number;
	colors?: [string, string, string];
	face?: FaceConfig;
	seed?: number | string;
	width: number;
}) => (
	<div
		className="coach-portrait flex-shrink-0"
		style={{ width, height: width * 1.5 }}
	>
		{face ? (
			<StaffFace face={face} colors={colors} age={age} seed={seed} />
		) : null}
	</div>
);

// A labeled 0-100 meter: the name (with help), the number, a word for it and a bar
export const Meter = ({
	color,
	label,
	max = 100,
	note,
	testId,
	value,
	valueText,
	word,
}: {
	color?: string;
	label: ReactNode;
	max?: number;
	note?: ReactNode;
	testId?: string;
	value: number;
	valueText?: string;
	word?: string;
}) => {
	const pct = Math.max(0, Math.min(100, (100 * value) / max));
	return (
		<div className="coach-meter mb-2" data-testid={testId}>
			<div className="d-flex justify-content-between align-items-baseline gap-2">
				<span className="text-body-secondary">{label}</span>
				<span className="text-end">
					<b>{valueText ?? value}</b>
					{word ? <span className="ms-1">· {word}</span> : null}
				</span>
			</div>
			<div
				className="progress"
				style={{ height: 8 }}
				role="progressbar"
				aria-valuenow={Math.round(pct)}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div
					className={`progress-bar bg-${color ?? ratingColor(pct)}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			{note ? (
				<div className="small text-body-secondary mt-1">{note}</div>
			) : null}
		</div>
	);
};

const RATING_KEYS: (keyof CoachRatings)[] = ["dev", "off", "def", "mot"];

// The four ratings as words and small bars (not just numbers)
export const RatingBars = ({
	highlight,
	ratings,
}: {
	highlight?: keyof CoachRatings;
	ratings: CoachRatings;
}) => (
	<table className="table table-sm table-borderless mb-0 coach-rating-bars">
		<tbody>
			{RATING_KEYS.map((key) => (
				<tr key={key} className={clsx({ "fw-bold": key === highlight })}>
					<td className="py-0 ps-0 text-body-secondary">
						{COACH_RATING_NAMES[key]}
					</td>
					<td className="py-0 text-end">{ratings[key]}</td>
					<td className="py-0" style={{ width: "34%", minWidth: 50 }}>
						<div className="progress" style={{ height: 6, marginTop: 7 }}>
							<div
								className={`progress-bar bg-${ratingColor(ratings[key])}`}
								style={{ width: `${ratings[key]}%` }}
							/>
						</div>
					</td>
					<td className="py-0 pe-0 text-nowrap">{ratingWord(ratings[key])}</td>
				</tr>
			))}
		</tbody>
	</table>
);

export const GradeBadge = ({ value }: { value: number }) => (
	<span className={`badge text-bg-${ratingColor(value)}`}>
		{ratingWord(value)}
	</span>
);

export const HotSeatBadge = ({ text }: { text: string }) =>
	text ? (
		<span className={`badge text-bg-${hotSeatColor(text)}`}>{text}</span>
	) : null;

export const coachUrl = (cid: number) => helpers.leagueUrl(["coach", cid]);

export const CoachLink = ({ cid, name }: { cid: number; name: string }) => (
	<a href={coachUrl(cid)}>{name}</a>
);

export const formatSalary = (amount: number) =>
	helpers.formatCurrency(amount / 1000, "M");

export const recordText = (c: {
	headSeasons: number;
	headWon: number;
	headLost: number;
	titles: number;
}) =>
	c.headSeasons > 0
		? `${c.headWon}-${c.headLost}${c.titles > 0 ? `, ${c.titles} title${c.titles > 1 ? "s" : ""}` : ""}`
		: "No seasons as a head coach";

// The message shown on the coach pages when Coaching Systems is off
export const SystemsOffNote = () => (
	<div className="alert alert-secondary py-2" data-testid="coach-systems-off">
		<b>Coaching Systems are off in this league.</b> Coaches have ratings, a
		style and contracts, but no offense or defense systems, scheme fit,
		reputation or job security. You can turn them on in League Settings → League
		Extras → Game Simulation → Coaching Systems.
	</div>
);
