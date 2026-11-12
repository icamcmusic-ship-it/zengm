import { OverlayTrigger, Popover } from "react-bootstrap";
import { useId } from "react";
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
	twoK?: string[];
	alsoClose?: string[];
	poorFit?: boolean;
};

// "Same build: 2-Way 3-Level Scorer, Iso Savant (+12 more)": the other NBA 2K build names this archetype stands for
export const twoKText = (names: string[] | undefined, max = 6) =>
	names && names.length > 0
		? `Same build in 2K: ${names.slice(0, max).join(", ")}${names.length > max ? ` (+${names.length - max} more)` : ""}`
		: undefined;

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

// What the build wants that he has: more of it than his own average, or less where the build wants less
const whyText = (w: { label: string; z: number; want: number }) =>
	`${w.want < 0 ? "Low " : ""}${w.want < 0 ? w.label.toLowerCase() : w.label}`;

export const ArchetypeWhy = ({
	info,
}: {
	info: Pick<
		ArchetypeLabelInfo,
		| "desc"
		| "why"
		| "tier"
		| "conf"
		| "season"
		| "live"
		| "twoK"
		| "alsoClose"
		| "poorFit"
	>;
}) => (
	<div className="archetype-popover">
		<p className="mb-2">{info.desc}</p>
		{info.twoK && info.twoK.length > 0 ? (
			<p className="mb-2 text-body-secondary" title={info.twoK.join(", ")}>
				{twoKText(info.twoK)}
			</p>
		) : null}
		{info.poorFit ? (
			<p className="mb-2 text-body-secondary">
				No build really has the shape of his ratings: this is the nearest one.
			</p>
		) : null}
		{info.why && info.why.length > 0 ? (
			<>
				<div className="fw-bold">Why</div>
				<ul className="mb-2 ps-3">
					{info.why.map((w) => (
						<li key={w.label}>{whyText(w)}</li>
					))}
				</ul>
			</>
		) : null}
		{info.alsoClose && info.alsoClose.length > 0 ? (
			<p className="mb-2">Also close to: {info.alsoClose.join(", ")}</p>
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

// The archetype's name with its group colour, and a click popover that says what it is and why he got it
export const ArchetypeLabel = ({ info }: { info: ArchetypeLabelInfo }) => {
	const id = useId();
	return (
		<OverlayTrigger
			trigger={["hover", "focus", "click"]}
			placement="auto"
			rootClose
			overlay={
				<Popover id={id}>
					<Popover.Header as="h3">{info.label}</Popover.Header>
					<Popover.Body>
						<ArchetypeWhy info={info} />
					</Popover.Body>
				</Popover>
			}
		>
			<button
				type="button"
				className="archetype-label btn btn-link p-0 align-baseline"
			>
				<GroupDot group={info.group} />
				{info.label}
			</button>
		</OverlayTrigger>
	);
};
