import { useState } from "react";
import type {
	DraftPickProtectionThen,
	PickConditionSpec,
} from "../../common/types.ts";
import { THEN_TEXT, parseRollover } from "../../common/draftPickConditions.ts";

// Inline editor for a draft pick condition in a trade (protection or swap rights). onChange(null) removes it.
export const PickConditionEditor = ({
	condition,
	onChange,
	allowSwap = true,
}: {
	condition?: PickConditionSpec;
	onChange: (spec: PickConditionSpec | null) => void | Promise<void>;
	allowSwap?: boolean;
}) => {
	const [open, setOpen] = useState(false);
	const [type, setType] = useState<"none" | "protection" | "swap">(
		condition?.type ?? "none",
	);
	const [top, setTop] = useState(
		condition?.type === "protection" ? String(condition.top) : "10",
	);
	const [rollover, setRollover] = useState(
		condition?.type === "protection" ? condition.rollover.join(", ") : "8",
	);
	const [then, setThen] = useState<DraftPickProtectionThen>(
		condition?.type === "protection" ? condition.then : "unprotected",
	);

	if (!open) {
		return (
			<button
				type="button"
				className="btn btn-link btn-sm p-0 ms-1 align-baseline pick-condition-edit"
				onClick={() => {
					setOpen(true);
				}}
			>
				{condition ? "edit condition" : "+ protection/swap"}
			</button>
		);
	}

	return (
		<form
			className="pick-condition-editor border rounded p-2 my-1 small"
			onSubmit={async (event) => {
				event.preventDefault();
				if (type === "none") {
					await onChange(null);
				} else if (type === "swap") {
					await onChange({ type: "swap" });
				} else {
					await onChange({
						type: "protection",
						top: Number.parseInt(top),
						rollover: parseRollover(rollover),
						then,
					});
				}
				setOpen(false);
			}}
		>
			<select
				className="form-select form-select-sm mb-1"
				value={type}
				onChange={(event) => {
					setType(event.target.value as any);
				}}
			>
				<option value="none">No condition</option>
				<option value="protection">Top-N protected</option>
				{allowSwap ? (
					<option value="swap">Swap rights only (not the pick)</option>
				) : null}
			</select>
			{type === "protection" ? (
				<>
					<div className="input-group input-group-sm mb-1">
						<span className="input-group-text">Top</span>
						<input
							type="number"
							className="form-control"
							min={1}
							value={top}
							onChange={(event) => {
								setTop(event.target.value);
							}}
						/>
						<span className="input-group-text">protected</span>
					</div>
					<div className="input-group input-group-sm mb-1">
						<span className="input-group-text">Then next years</span>
						<input
							type="text"
							className="form-control"
							placeholder="e.g. 8, 5"
							title="Protection in each following year if it stays protected, like 8, 5 for top 8 next year then top 5"
							value={rollover}
							onChange={(event) => {
								setRollover(event.target.value);
							}}
						/>
					</div>
					<div className="input-group input-group-sm mb-1">
						<span className="input-group-text">After that</span>
						<select
							className="form-select"
							value={then}
							onChange={(event) => {
								setThen(event.target.value as DraftPickProtectionThen);
							}}
						>
							{Object.entries(THEN_TEXT).map(([key, value]) => (
								<option key={key} value={key}>
									{value}
								</option>
							))}
						</select>
					</div>
				</>
			) : type === "swap" ? (
				<p className="text-body-secondary mb-1">
					The receiving team gets the right to swap its own pick in this round
					for this one, if this one is better. The pick itself stays.
				</p>
			) : null}
			<button type="submit" className="btn btn-primary btn-sm me-1">
				Save
			</button>
			<button
				type="button"
				className="btn btn-secondary btn-sm"
				onClick={() => {
					setOpen(false);
				}}
			>
				Cancel
			</button>
		</form>
	);
};
