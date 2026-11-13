import { useState } from "react";
import type { Col } from "./DataTable/index.tsx";
import {
	SUB_DEFS,
	SUB_TABLE_ORDER,
	subGroupOf,
} from "../../common/subRatings.ts";
import { useFeatureOn } from "../util/nativeFeatures.ts";
import { safeLocalStorage } from "../util/safeLocalStorage.ts";

// Sub-ratings in tables (the subRatings setting): an optional view, remembered per table, that adds a column for every sub-rating (in
// base order: defense's four, three-point's three, ...). Rows without sub-ratings (older seasons of retired players) show blanks.

const BASE_NAMES: Record<string, string> = {
	diq: "Defense",
	tp: "Three",
	ins: "Inside",
	dnk: "Dunks/Layups",
	fg: "Mid Range",
	reb: "Rebounding",
	drb: "Dribbling",
	pss: "Passing",
	spd: "Speed",
	jmp: "Jumping",
};

export const subRatingCols = (): Col[] =>
	SUB_TABLE_ORDER.map((i) => {
		const def = SUB_DEFS[i]!;
		const w = subGroupOf(def.base).w[subGroupOf(def.base).idx.indexOf(i)]!;
		return {
			title: def.label,
			desc: `${def.name} (${w}% of ${BASE_NAMES[def.base]}): ${def.description}`,
			sortSequence: ["desc", "asc"],
			sortType: "number",
		};
	});

export const subRatingCells = (
	sub: number[] | undefined,
	show: boolean = true,
): (number | null)[] =>
	SUB_TABLE_ORDER.map((i) => (show && sub ? (sub[i] ?? null) : null));

export const useSubRatingsView = (name: string) => {
	const featureOn = useFeatureOn("subRatings");
	const on = __SPORT === "basketball" && featureOn;
	const key = `subRatingsView:${name}`;
	const [show, setShow] = useState(() => safeLocalStorage.getItem(key) === "1");
	return {
		name,
		available: on,
		show: on && show,
		toggle: () => {
			const next = !show;
			setShow(next);
			safeLocalStorage.setItem(key, next ? "1" : "0");
		},
	};
};

export const SubRatingsToggle = ({
	view,
	className,
}: {
	view: ReturnType<typeof useSubRatingsView>;
	className?: string;
}) => {
	if (!view.available) {
		return null;
	}
	return (
		<div className={className ?? "form-check form-switch mb-2"}>
			<input
				className="form-check-input"
				type="checkbox"
				role="switch"
				id={`sub-ratings-toggle-${view.name}`}
				checked={view.show}
				onChange={view.toggle}
			/>
			<label
				className="form-check-label"
				htmlFor={`sub-ratings-toggle-${view.name}`}
			>
				Show sub-ratings
			</label>
		</div>
	);
};
