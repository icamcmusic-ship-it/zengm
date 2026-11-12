// Shared bits of the college mode pages (docs/college-mode.md)
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import type { ReactNode } from "react";

export type CollegeTeamNames = Record<
	number,
	{
		tid: number;
		abbrev: string;
		region: string;
		won: number;
		lost: number;
		conf: string;
	}
>;

export const SeasonSelect = ({
	page,
	season,
	seasons,
}: {
	page: string;
	season: number;
	seasons: number[];
}) => {
	if (seasons.length <= 1) {
		return null;
	}
	return (
		<select
			className="form-select form-select-sm d-inline-block mb-3"
			style={{ width: "auto" }}
			aria-label="Season"
			value={season}
			onChange={(event) => {
				realtimeUpdate(
					[],
					helpers.leagueUrl([page, event.target.value] as any),
				);
			}}
		>
			{seasons.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</select>
	);
};

export const TeamName = ({
	teams,
	tid,
	season,
	userTid,
	record,
	children,
}: {
	teams: CollegeTeamNames;
	tid: number;
	season: number;
	userTid?: number;
	record?: boolean;
	children?: ReactNode;
}) => {
	const t = teams[tid];
	if (!t) {
		return <span className="text-body-secondary">TBD</span>;
	}
	return (
		<>
			<a
				href={helpers.leagueUrl(["roster", `${t.abbrev}_${tid}`, season])}
				className={tid === userTid ? "fw-bold" : undefined}
			>
				{t.region}
			</a>
			{children}
			{record ? (
				<span className="text-body-secondary ms-1 small">
					{t.won}-{t.lost}
				</span>
			) : null}
		</>
	);
};

export const Stars = ({ stars }: { stars: number }) => (
	<span className="text-warning text-nowrap" title={`${stars} stars`}>
		{"★".repeat(stars)}
		<span className="text-body-tertiary">
			{"★".repeat(Math.max(0, 5 - stars))}
		</span>
	</span>
);

export const CLASS_NAMES = ["HS", "Fr", "So", "Jr", "Sr"];
