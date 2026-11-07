import clsx from "clsx";
import { getCol } from "../../../common/getCol.ts";
import type { RatingKey } from "../../../common/types.basketball.ts";

export const RATING_ORDER: RatingKey[] = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

export const ratingLabel = (key: RatingKey) => getCol(`rating:${key}`).title;
export const ratingDesc = (key: RatingKey) =>
	getCol(`rating:${key}`).desc ?? "";

export const Delta = ({ before, after }: { before: number; after: number }) => {
	const d = after - before;
	if (d === 0) {
		return <span className="text-body-secondary">0</span>;
	}
	return (
		<span className={d > 0 ? "text-success" : "text-danger"}>
			{d > 0 ? "+" : "−"}
			{Math.abs(d)}
		</span>
	);
};

// "tp +18, ins -12, drb -9": the biggest movers, for one table cell
export const ChangeSummary = ({
	ratings,
	max = 4,
}: {
	ratings: { key: RatingKey; before: number; after: number }[];
	max?: number;
}) => {
	const changed = ratings
		.filter((r) => r.before !== r.after)
		.sort(
			(a, b) =>
				Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
				a.key.localeCompare(b.key),
		);
	if (changed.length === 0) {
		return <span className="text-body-secondary">no change</span>;
	}
	return (
		<>
			{changed.slice(0, max).map((r, i) => (
				<span key={r.key} className="text-nowrap">
					{i > 0 ? " " : ""}
					{ratingLabel(r.key)} <Delta before={r.before} after={r.after} />
				</span>
			))}
			{changed.length > max ? (
				<span className="text-body-secondary"> +{changed.length - max}</span>
			) : null}
		</>
	);
};

// Every rating, before -> after, with the change coloured. Optionally with a lock per rating.
export const RatingsDiff = ({
	ratings,
	pinned,
	onTogglePin,
	hideLocks,
}: {
	ratings: { key: RatingKey; before: number; after: number }[];
	pinned?: RatingKey[];
	onTogglePin?: (key: RatingKey) => void;
	hideLocks?: boolean;
}) => {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
				gap: "0.25rem",
			}}
		>
			{ratings.map((r) => {
				const isPinned = pinned?.includes(r.key) ?? false;
				const changed = r.before !== r.after;
				return (
					<div
						key={r.key}
						className={clsx("border rounded text-center px-1 py-1", {
							"bg-body-tertiary": changed,
						})}
						title={ratingDesc(r.key)}
					>
						<div className="text-body-secondary small">
							{ratingLabel(r.key)}
						</div>
						<div className="text-nowrap">
							{r.before}
							<span className="text-body-secondary"> {"→"} </span>
							<b>{r.after}</b>
						</div>
						<div className="small">
							<Delta before={r.before} after={r.after} />
						</div>
						{!hideLocks && onTogglePin && r.key !== "hgt" ? (
							<div className="form-check form-switch d-flex justify-content-center m-0">
								<input
									className="form-check-input"
									type="checkbox"
									role="switch"
									checked={isPinned}
									onChange={() => onTogglePin(r.key)}
									aria-label={`Lock ${ratingDesc(r.key)}`}
									title={`Lock ${ratingDesc(r.key)} at ${r.before}`}
								/>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
};
