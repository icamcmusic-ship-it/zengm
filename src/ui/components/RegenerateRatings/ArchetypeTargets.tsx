import { useState } from "react";
import { GROUP_INFO, GROUPS } from "../../../common/archetypes/index.ts";
import type { ArchetypeGroup } from "../../../common/archetypes/index.ts";

export type ArchetypeTargetInfo = {
	id: string;
	name: string;
	group: ArchetypeGroup;
	desc: string;
	min: number;
	max: number;
	rare: boolean;
};

// Archetypes a prospect with this hgt rating can be aimed at (the gate with a little room)
export const eligibleArchetypes = (list: ArchetypeTargetInfo[], hgt: number) =>
	list.filter((a) => hgt >= a.min - 3 && hgt <= a.max + 3);

// <optgroup>s of archetypes, for a select
export const ArchetypeOptions = ({ list }: { list: ArchetypeTargetInfo[] }) => (
	<>
		{GROUPS.map((g) => {
			const items = list.filter((a) => a.group === g);
			return items.length > 0 ? (
				<optgroup key={g} label={GROUP_INFO[g].label}>
					{items.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</optgroup>
			) : null;
		})}
	</>
);

// Class level: the archetypes a draft class is aimed at. Empty leaves the class to the builds.
export const ArchetypePoolPicker = ({
	list,
	value,
	onChange,
}: {
	list: ArchetypeTargetInfo[];
	value: string[];
	onChange: (ids: string[]) => void;
}) => {
	const [open, setOpen] = useState(value.length > 0);
	const picked = new Set(value);
	return (
		<div className="mb-3" data-testid="archetype-pool">
			<div className="d-flex align-items-center gap-2">
				<span className="form-label mb-0">Class archetypes</span>
				<button
					type="button"
					className="btn btn-sm btn-link p-0"
					onClick={() => setOpen((v) => !v)}
				>
					{open
						? "Hide"
						: value.length > 0
							? `${value.length} chosen`
							: "Choose"}
				</button>
				{value.length > 0 ? (
					<button
						type="button"
						className="btn btn-sm btn-link p-0"
						onClick={() => onChange([])}
					>
						Clear
					</button>
				) : null}
			</div>
			<div className="form-text mt-0">
				{value.length === 0
					? "Aim the class at specific archetypes (a year of Rim Protectors). Empty draws from the builds as before."
					: "Prospects are aimed at these where their height allows, least used first."}
			</div>
			{open ? (
				<div
					className="border rounded p-2 mt-1"
					style={{ maxHeight: "16rem", overflowY: "auto" }}
				>
					{GROUPS.map((g) => (
						<div key={g} className="mb-2">
							<div className="fw-bold">{GROUP_INFO[g].label}</div>
							<div className="d-flex flex-wrap gap-x-3 column-gap-3">
								{list
									.filter((a) => a.group === g)
									.map((a) => (
										<label
											key={a.id}
											className="form-check-label text-nowrap"
											title={a.desc}
										>
											<input
												type="checkbox"
												className="form-check-input me-1"
												checked={picked.has(a.id)}
												onChange={(event) => {
													const next = new Set(picked);
													if (event.target.checked) {
														next.add(a.id);
													} else {
														next.delete(a.id);
													}
													onChange(
														list.filter((x) => next.has(x.id)).map((x) => x.id),
													);
												}}
											/>
											{a.name}
										</label>
									))}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
};
