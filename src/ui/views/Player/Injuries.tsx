import { DataTable } from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";

const cols = getCols(
	["Year", "Type", "Games", "Games Missed", "Ovr Drop", "Pot Drop"],
	{
		Type: {
			width: "100%",
		},
	},
);

// Treatment, re-aggravations and setbacks of an injury on record
const notes = (injury: {
	aggravated?: number;
	treatment?: string;
	setbacks?: number;
}) =>
	[
		injury.treatment,
		injury.aggravated
			? `re-aggravated${injury.aggravated > 1 ? ` ${injury.aggravated}x` : ""}`
			: undefined,
		injury.setbacks
			? `${injury.setbacks} ${injury.setbacks === 1 ? "setback" : "setbacks"}`
			: undefined,
	]
		.filter(Boolean)
		.join(", ");

const Injuries = ({
	injuries,
	showRatings,
}: {
	injuries: {
		games: number;
		season: number;
		type: string;
		ovrDrop?: number;
		potDrop?: number;
		missed?: number;
		aggravated?: number;
		treatment?: string;
		setbacks?: number;
	}[];
	showRatings: boolean;
}) => {
	if (injuries === undefined || injuries.length === 0) {
		return <p>None</p>;
	}

	const totals: {
		games: number;
		missed: number | undefined;
		ovrDrop: number | undefined;
		potDrop: number | undefined;
	} = {
		games: 0,
		missed: undefined,
		ovrDrop: undefined,
		potDrop: undefined,
	};
	for (const injury of injuries) {
		totals.games += injury.games;
		if (injury.missed !== undefined) {
			totals.missed = (totals.missed ?? 0) + injury.missed;
		}
		if (injury.ovrDrop !== undefined) {
			if (totals.ovrDrop === undefined) {
				totals.ovrDrop = 0;
			}
			totals.ovrDrop += injury.ovrDrop;
		}
		if (injury.potDrop !== undefined) {
			if (totals.potDrop === undefined) {
				totals.potDrop = 0;
			}
			totals.potDrop += injury.potDrop;
		}
	}

	return (
		<DataTable
			className="datatable-negative-margin-top mb-3"
			cols={cols}
			defaultSort={[0, "asc"]}
			hideAllControls
			name="Player:Injuries"
			rows={injuries.map((injury, i) => {
				return {
					key: i,
					data: [
						{
							sortValue: i,
							value: injury.season,
						},
						{
							value: (
								<>
									{injury.type}
									{notes(injury) ? (
										<span className="text-body-secondary">
											{" "}
											({notes(injury)})
										</span>
									) : null}
								</>
							),
							searchValue: injury.type,
							sortValue: injury.type,
						},
						injury.games,
						injury.missed,
						showRatings ? injury.ovrDrop : null,
						showRatings ? injury.potDrop : null,
					],
				};
			})}
			footer={{
				data: [
					"Total",
					null,
					totals.games,
					totals.missed,
					showRatings ? totals.ovrDrop : null,
					showRatings ? totals.potDrop : null,
				],
			}}
		/>
	);
};

export default Injuries;
