import { OverlayTrigger, Popover } from "react-bootstrap";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArchetypeFeedbackModal } from "./ArchetypeFeedback.tsx";
import { GROUP_INFO, TIER_NAMES } from "../../../common/archetypes/index.ts";
import type { ArchetypeGroup, Tier } from "../../../common/archetypes/index.ts";

export type ArchetypeLabelInfo = {
	name: string;
	label: string;
	desc: string;
	group: ArchetypeGroup;
	tier?: Tier;
	conf?: number;
	season?: number;
	live?: boolean;
	why?: { label: string; z: number; want: number }[];
	// arch16: one short line citing what drove the pick (sub-ratings, play types, traits or ratings)
	whyText?: string;
	// archfb: the player (for "Doesn't fit?") and whether the label is the user's own pick
	pid?: number;
	user?: boolean;
};

export const GroupDot = ({ group }: { group: ArchetypeGroup }) => (
	<span
		className="archetype-dot"
		style={{
			display: "inline-block",
			width: "0.6em",
			height: "0.6em",
			borderRadius: "50%",
			marginRight: "0.4em",
			backgroundColor: GROUP_INFO[group].color,
		}}
		title={GROUP_INFO[group].label}
		aria-hidden
	/>
);

const coarsePointer = () =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(pointer: coarse)").matches;

// What the build wants that he has: more of it than his own average, or less where the build wants less
const whyText = (w: { label: string; z: number; want: number }) =>
	`${w.want < 0 ? "Low " : ""}${w.want < 0 ? w.label.toLowerCase() : w.label}`;

export const ArchetypeWhy = ({
	info,
}: {
	info: Pick<
		ArchetypeLabelInfo,
		"desc" | "why" | "whyText" | "tier" | "conf" | "season" | "live"
	>;
}) => (
	<div className="archetype-popover">
		<p className="mb-2">{info.desc}</p>
		{info.whyText ? (
			<p className="mb-2">
				<span className="fw-bold">Why:</span> {info.whyText}
			</p>
		) : info.why && info.why.length > 0 ? (
			<>
				<div className="fw-bold">Why</div>
				<ul className="mb-2 ps-3">
					{info.why.map((w) => (
						<li key={w.label}>{whyText(w)}</li>
					))}
				</ul>
			</>
		) : null}
		<div className="text-body-secondary">
			{info.tier ? `${TIER_NAMES[info.tier]} tier. ` : ""}
			{info.conf !== undefined ? `Confidence ${info.conf}%. ` : ""}
			{info.live
				? "Live reading: it is saved at the start of the next preseason."
				: info.season !== undefined
					? `Set in the ${info.season} preseason.`
					: ""}
		</div>
	</div>
);

// The archetype's name with its group colour, and a popover that says what it is and why he got it (hover previews
// it, click/tap/Enter pins it; fbfix). With `feedback` (and his pid), an always-visible "Doesn't fit?" button beside it
// and one in the popover (archfb)
export const ArchetypeLabel = ({
	info,
	feedback,
	suffix,
}: {
	info: ArchetypeLabelInfo;
	feedback?: boolean;
	// Shown right after the label (before the feedback button)
	suffix?: ReactNode;
}) => {
	const id = useId();
	const [show, setShow] = useState(false);
	// fbfix: hover previews the popover with a grace period so the pointer can move into it (the popover keeps itself open
	// while hovered); click/tap/Enter pins it open until a click outside or Esc
	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const cancelClose = () => {
		if (closeTimer.current !== undefined) {
			clearTimeout(closeTimer.current);
			closeTimer.current = undefined;
		}
	};
	const hoverOpen = () => {
		cancelClose();
		setOpen(true);
	};
	const hoverClose = () => {
		cancelClose();
		if (pinned) {
			return;
		}
		closeTimer.current = setTimeout(() => setOpen(false), 400);
	};
	const closeAll = () => {
		cancelClose();
		setPinned(false);
		setOpen(false);
	};
	useEffect(() => cancelClose, []);
	const openPicker = () => {
		closeAll();
		setShow(true);
	};
	const canFeedback = feedback && info.pid !== undefined;
	return (
		<>
			<OverlayTrigger
				trigger={[]}
				show={open}
				onToggle={(next) => {
					if (!next) {
						closeAll();
					}
				}}
				// Below (or above, when there is no room), never beside: beside, it covered the "Doesn't fit?" button
				placement="bottom"
				rootClose
				overlay={
					<Popover
						id={id}
						onMouseEnter={hoverOpen}
						onMouseLeave={hoverClose}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								closeAll();
							}
						}}
					>
						<Popover.Header as="h3">{info.label}</Popover.Header>
						<Popover.Body>
							<ArchetypeWhy info={info} />
							{canFeedback ? (
								<button
									type="button"
									className="btn btn-sm btn-outline-secondary mt-2 archetype-fb-popover-button"
									onClick={openPicker}
								>
									{info.user ? "Change or clear my pick" : "Doesn't fit?"}
								</button>
							) : null}
						</Popover.Body>
					</Popover>
				}
			>
				<button
					type="button"
					className="archetype-label btn btn-link p-0 align-baseline"
					aria-expanded={open}
					onMouseEnter={hoverOpen}
					onMouseLeave={hoverClose}
					onClick={() => {
						cancelClose();
						if (pinned) {
							closeAll();
						} else {
							setPinned(true);
							setOpen(true);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							closeAll();
						}
					}}
				>
					<GroupDot group={info.group} />
					{info.label}
				</button>
			</OverlayTrigger>
			{suffix}
			{canFeedback ? (
				<>
					{" "}
					<button
						type="button"
						className="btn btn-sm btn-outline-secondary py-0 px-2 align-baseline archetype-fb-button"
						// fbfix: a 44 px touch target on touch screens
						style={
							coarsePointer()
								? { minHeight: 44, minWidth: 44, verticalAlign: "middle" }
								: undefined
						}
						onClick={openPicker}
					>
						{info.user ? "Change my pick" : "Doesn't fit?"}
					</button>
					{show ? (
						<ArchetypeFeedbackModal
							pid={info.pid!}
							show={show}
							onHide={() => setShow(false)}
						/>
					) : null}
				</>
			) : null}
		</>
	);
};
