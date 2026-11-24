import type { ReactNode } from "react";
import { needsTitle, type Need } from "../../../common/archetypeFit.ts";

// "Fills a need" (Archetypes): a player whose archetype answers one of the user's roster composition warnings
export const FillsNeedBadge = ({ needs }: { needs: Need[] | undefined }) => {
	if (!needs || needs.length === 0) {
		return null;
	}
	return (
		<span
			className="badge text-bg-success ms-1"
			title={needsTitle(needs)}
			data-testid="fills-need-badge"
		>
			Fills a need
		</span>
	);
};

// The filter toggle: shown only while some player fills a need
export const FillsNeedToggle = ({
	className,
	count,
	on,
	onChange,
}: {
	className?: string;
	count: number;
	on: boolean;
	onChange: (on: boolean) => void;
}) => {
	if (count === 0 && !on) {
		return null;
	}
	return (
		<button
			type="button"
			className={`btn btn-sm ${on ? "btn-success" : "btn-light-bordered"} ${className ?? ""}`}
			onClick={() => onChange(!on)}
			title="Only players whose archetype answers one of your roster composition warnings (Roster page)"
			data-testid="fills-need-toggle"
		>
			Fills a need ({count})
		</button>
	);
};

// A name cell (wrappedPlayerNameLabels) with the badge after the name
export const withFillsNeed = <T extends { value: ReactNode }>(
	cell: T,
	needs: Need[] | undefined,
): T =>
	needs && needs.length > 0
		? {
				...cell,
				value: (
					<>
						{cell.value}
						<FillsNeedBadge needs={needs} />
					</>
				),
			}
		: cell;
