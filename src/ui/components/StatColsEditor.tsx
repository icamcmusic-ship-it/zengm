// Choosing the stat columns of an award: Automatic (picked from the formula) or Custom (a searchable list of the stats the award can
// show, in order, with up/down and a maximum). Used by Award Settings and the Columns menu of Award Races and Award History.
import { useId, useState } from "react";
import { Dropdown } from "react-bootstrap";

export type StatColOption = {
	key: string;
	title: string;
	desc?: string;

	// Shown after the description, like the stat's share of the formula
	note?: string;

	// In the award formula: listed first
	formula?: boolean;
};

export const StatColsEditor = ({
	automaticText,
	disabled,
	max,
	onChange,
	options,
	suggested,
	value,
}: {
	// What Automatic means for this award
	automaticText: string;
	disabled?: boolean;
	max: number;
	onChange: (value: string[] | undefined) => void;
	options: StatColOption[];

	// The automatic choice, shown under Automatic and the starting point of Custom
	suggested: string[];

	// undefined: automatic
	value: string[] | undefined;
}) => {
	const [search, setSearch] = useState("");
	const radioName = useId();
	const searchId = useId();

	const byKey = new Map(options.map((option) => [option.key, option]));
	const titleOf = (key: string) => byKey.get(key)?.title ?? key;
	const custom = value !== undefined;

	const move = (i: number, direction: -1 | 1) => {
		if (!value) {
			return;
		}
		const j = i + direction;
		if (j < 0 || j >= value.length) {
			return;
		}
		const newValue = [...value];
		newValue[i] = value[j]!;
		newValue[j] = value[i]!;
		onChange(newValue);
	};

	const selected = new Set(value ?? []);
	const searchLower = search.trim().toLowerCase();
	const addable = options
		.filter((option) => {
			if (selected.has(option.key)) {
				return false;
			}
			if (searchLower === "") {
				return true;
			}
			return (
				option.key.toLowerCase().includes(searchLower) ||
				option.title.toLowerCase().includes(searchLower) ||
				(option.desc ?? "").toLowerCase().includes(searchLower)
			);
		})
		.sort((a, b) => Number(!!b.formula) - Number(!!a.formula));
	const full = (value?.length ?? 0) >= max;

	return (
		<div>
			<div className="d-flex flex-wrap gap-3">
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name={radioName}
						id={`${radioName}-auto`}
						checked={!custom}
						disabled={disabled}
						onChange={() => {
							onChange(undefined);
						}}
					/>
					<label className="form-check-label" htmlFor={`${radioName}-auto`}>
						Automatic
					</label>
				</div>
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name={radioName}
						id={`${radioName}-custom`}
						checked={custom}
						disabled={disabled}
						onChange={() => {
							onChange(suggested.slice(0, max));
						}}
					/>
					<label className="form-check-label" htmlFor={`${radioName}-custom`}>
						Custom
					</label>
				</div>
			</div>
			{!custom ? (
				<div className="small text-body-secondary mt-1">
					{automaticText}
					{suggested.length > 0
						? `: ${suggested.map(titleOf).join(", ")}`
						: null}
				</div>
			) : (
				<>
					{value.length === 0 ? (
						<div className="small text-body-secondary mt-1">
							No stats picked yet, so the automatic ones are shown.
						</div>
					) : (
						<ol className="list-unstyled mt-2 mb-2">
							{value.map((key, i) => (
								<li key={key} className="d-flex align-items-center gap-1 mb-1">
									<span className="flex-grow-1 text-truncate" title={key}>
										{i + 1}. {titleOf(key)}
									</span>
									<button
										type="button"
										className="btn btn-sm btn-light-bordered py-0"
										aria-label={`Move ${titleOf(key)} up`}
										title="Move up"
										disabled={disabled || i === 0}
										onClick={() => {
											move(i, -1);
										}}
									>
										<span className="glyphicon glyphicon-arrow-up" />
									</button>
									<button
										type="button"
										className="btn btn-sm btn-light-bordered py-0"
										aria-label={`Move ${titleOf(key)} down`}
										title="Move down"
										disabled={disabled || i === value.length - 1}
										onClick={() => {
											move(i, 1);
										}}
									>
										<span className="glyphicon glyphicon-arrow-down" />
									</button>
									<button
										type="button"
										className="btn-close ms-1"
										aria-label={`Remove ${titleOf(key)}`}
										title="Remove"
										disabled={disabled}
										onClick={() => {
											onChange(value.filter((x) => x !== key));
										}}
									/>
								</li>
							))}
						</ol>
					)}
					<label className="visually-hidden" htmlFor={searchId}>
						Search stats
					</label>
					<input
						id={searchId}
						className="form-control form-control-sm mb-1"
						type="search"
						placeholder={full ? `At most ${max} stats` : "Search stats to add"}
						value={search}
						disabled={disabled}
						onChange={(event) => {
							setSearch(event.target.value);
						}}
					/>
					<div style={{ maxHeight: 200, overflowY: "auto" }}>
						{addable.map((option) => (
							<button
								key={option.key}
								type="button"
								className="btn btn-link btn-sm d-block text-start text-decoration-none p-0 mb-1 w-100"
								disabled={disabled || full}
								onClick={() => {
									onChange([...value, option.key]);
								}}
							>
								+ {option.title}
								{option.formula ? (
									<span className="badge bg-secondary ms-1">formula</span>
								) : null}
								{option.desc !== undefined && option.desc !== option.title ? (
									<span className="text-body-secondary"> - {option.desc}</span>
								) : null}
								{option.note !== undefined ? (
									<span className="text-body-secondary"> ({option.note})</span>
								) : null}
							</button>
						))}
						{addable.length === 0 ? (
							<div className="small text-body-secondary">No other stats.</div>
						) : null}
					</div>
					<button
						type="button"
						className="btn btn-sm btn-secondary mt-2"
						disabled={disabled}
						onClick={() => {
							onChange(undefined);
						}}
					>
						Reset to automatic
					</button>
				</>
			)}
		</div>
	);
};

// A small "Columns" menu with the editor, for a table's title bar
export const StatColsDropdown = ({
	custom,
	sessionOnly,
	...props
}: Parameters<typeof StatColsEditor>[0] & {
	// Marks the button when a custom choice is in use
	custom: boolean;

	// The choice could not be saved in the league, so it only lasts for this visit
	sessionOnly?: boolean;
}) => {
	return (
		<Dropdown autoClose="outside">
			<Dropdown.Toggle
				variant="light-bordered"
				size="sm"
				title="Choose which stats are shown for this award"
			>
				Columns{custom ? "*" : ""}
			</Dropdown.Toggle>
			<Dropdown.Menu className="p-2" style={{ width: 320, maxWidth: "90vw" }}>
				<StatColsEditor {...props} />
				<div className="small text-body-secondary mt-2">
					{sessionOnly
						? "This award is not in the league's award settings, so this choice is only kept until you leave the page."
						: "Saved in this league's award settings (Award Settings, Stats shown)."}
				</div>
			</Dropdown.Menu>
		</Dropdown>
	);
};
