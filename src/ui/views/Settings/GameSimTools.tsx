// Settings > Tendencies (basketball): style sliders that move several tendency settings at once, and a preview that sims a few dozen
// games in the worker with the settings in the form (not saved) next to the saved ones.
import { useEffect, useRef, useState } from "react";
import type {
	GameSimPreviewStats,
	PreviewSettings,
} from "../../../worker/core/game/previewGameSim.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import type { State } from "./SettingsForm.tsx";
import {
	STYLE_SLIDERS,
	STYLE_SLIDER_SETTING_KEYS,
	type StyleSliderKey,
	type StyleSliderSettingKey,
	type StyleSliderValues,
	ZERO_SLIDERS,
	applyStyleSliders,
} from "./styleSliders.ts";

const PREVIEW_FLOAT_KEYS = [
	"pace",
	"threePointTendencyFactor",
	"threePointAccuracyFactor",
	"twoPointAccuracyFactor",
	"ftAccuracyFactor",
	"blockFactor",
	"stealFactor",
	"turnoverFactor",
	"orbFactor",
	"foulRateFactor",
	"assistFactor",
] as const;

const NUM_PREVIEW_GAMES = 50;

const parseNumber = (value: unknown) => {
	if (typeof value !== "string") {
		return Number.NaN;
	}
	return helpers.localeParseFloat(value);
};

// The tendency settings in the form, as numbers (throws on an invalid one, naming it)
const getPendingSettings = (state: State) => {
	const settings: PreviewSettings = {};
	for (const key of PREVIEW_FLOAT_KEYS) {
		const raw = (state as any)[key];
		if (raw === undefined) {
			continue;
		}
		const value = parseNumber(raw);
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`Invalid value for ${key}: "${raw}"`);
		}
		settings[key] = value;
	}
	const threePointers = (state as any).threePointers;
	if (threePointers !== undefined) {
		settings.threePointers = threePointers === "true";
	}
	return settings;
};

const STAT_ROWS: {
	key: keyof GameSimPreviewStats;
	name: string;
	format: (x: number) => string;
}[] = [
	{ key: "pace", name: "Pace", format: (x) => x.toFixed(1) },
	{ key: "pts", name: "Points per game", format: (x) => x.toFixed(1) },
	{
		key: "tpaRate",
		name: "3PA rate (3PA/FGA)",
		format: (x) => `${(100 * x).toFixed(1)}%`,
	},
	{ key: "efg", name: "eFG%", format: (x) => `${(100 * x).toFixed(1)}%` },
	{ key: "tovPct", name: "TOV%", format: (x) => `${(100 * x).toFixed(1)}%` },
	{ key: "orbPct", name: "ORB%", format: (x) => `${(100 * x).toFixed(1)}%` },
	{
		key: "ftRate",
		name: "FT rate (FTA/FGA)",
		format: (x) => `${(100 * x).toFixed(1)}%`,
	},
];

const formatDiff = (row: (typeof STAT_ROWS)[number], diff: number): string => {
	const isPct = row.key !== "pace" && row.key !== "pts";
	const value = isPct ? 100 * diff : diff;
	if (Math.abs(value) < 0.05) {
		return "0";
	}
	return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
};

export const GameSimPreview = ({
	disabled,
	state,
}: {
	disabled: boolean;
	state: State;
}) => {
	const [status, setStatus] = useState<
		| { type: "idle" }
		| { type: "loading" }
		| { type: "error"; message: string }
		| {
				type: "done";
				current: GameSimPreviewStats;
				pending: GameSimPreviewStats;
		  }
	>({ type: "idle" });

	const runPreview = async () => {
		let settings;
		try {
			settings = getPendingSettings(state);
		} catch (error) {
			setStatus({ type: "error", message: (error as Error).message });
			return;
		}
		setStatus({ type: "loading" });
		const result = await toWorker("main", "previewGameSim", {
			numGames: NUM_PREVIEW_GAMES,
			settings,
		});
		if ("error" in result) {
			setStatus({ type: "error", message: result.error });
		} else {
			setStatus({ type: "done", ...result });
		}
	};

	return (
		<div className="mb-3">
			<button
				type="button"
				className="btn btn-secondary"
				disabled={disabled || status.type === "loading"}
				onClick={runPreview}
			>
				{status.type === "loading" ? "Simulating..." : "Preview"}
			</button>
			<span className="text-body-secondary ms-2">
				Sims {NUM_PREVIEW_GAMES} games between your league's teams with the
				tendency settings in this form (not saved), next to your current saved
				settings. Same matchups and random seed for both, so differences come
				from the settings.
			</span>
			{status.type === "error" ? (
				<div className="text-danger mt-2">{status.message}</div>
			) : null}
			{status.type === "done" ? (
				<div className="table-responsive mt-2" style={{ maxWidth: 520 }}>
					<table className="table table-sm table-striped mb-0">
						<thead>
							<tr>
								<th>Per team per game</th>
								<th className="text-end">Current</th>
								<th className="text-end">Pending</th>
								<th className="text-end">Change</th>
							</tr>
						</thead>
						<tbody>
							{STAT_ROWS.map((row) => (
								<tr key={row.key}>
									<td>{row.name}</td>
									<td className="text-end">
										{row.format(status.current[row.key])}
									</td>
									<td className="text-end">
										{row.format(status.pending[row.key])}
									</td>
									<td className="text-end">
										{formatDiff(
											row,
											status.pending[row.key] - status.current[row.key],
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<div className="text-body-secondary small">
						{status.pending.games} games each. Small samples: differences under
						~1 possession or ~1% are mostly noise.
					</div>
				</div>
			) : null}
		</div>
	);
};

const readBase = (state: State) => {
	const base = {} as Record<StyleSliderSettingKey, number>;
	for (const key of STYLE_SLIDER_SETTING_KEYS) {
		const value = parseNumber((state as any)[key]);
		if (!Number.isFinite(value)) {
			return undefined;
		}
		base[key] = value;
	}
	return base;
};

export const StyleSliders = ({
	disabled,
	setState,
	state,
}: {
	disabled: boolean;
	setState: (arg: (prevState: State) => State) => void;
	state: State;
}) => {
	const [values, setValues] = useState<StyleSliderValues>(ZERO_SLIDERS);
	const base = useRef<Record<StyleSliderSettingKey, number> | undefined>(
		undefined,
	);
	// What the sliders last wrote, to notice when a setting was changed some other way (typed in, a preset)
	const written = useRef<Record<string, string> | undefined>(undefined);

	useEffect(() => {
		if (!written.current) {
			return;
		}
		for (const key of STYLE_SLIDER_SETTING_KEYS) {
			if ((state as any)[key] !== written.current[key]) {
				// Start over from the new values
				written.current = undefined;
				base.current = undefined;
				setValues(ZERO_SLIDERS);
				return;
			}
		}
	}, [state]);

	const onChange = (key: StyleSliderKey, value: number) => {
		if (!base.current) {
			base.current = readBase(state);
			if (!base.current) {
				return;
			}
		}
		const newValues = { ...values, [key]: value };
		setValues(newValues);
		const applied = applyStyleSliders(base.current, newValues);
		const strings: Record<string, string> = {};
		for (const [k, v] of Object.entries(applied)) {
			strings[k] = String(v);
		}
		written.current = strings;
		setState((prevState) => ({
			...prevState,
			...strings,
		}));
	};

	return (
		<div className="mb-3" style={{ maxWidth: 900 }}>
			<div className="row">
				{STYLE_SLIDERS.map((slider) => (
					<div key={slider.key} className="col-md-4 mb-2">
						<label
							className="form-label fw-bold mb-0"
							htmlFor={`style-slider-${slider.key}`}
						>
							{slider.name}{" "}
							<span className="text-body-secondary fw-normal">
								{values[slider.key] > 0 ? "+" : ""}
								{Math.round(values[slider.key] * 100)}
							</span>
						</label>
						<input
							id={`style-slider-${slider.key}`}
							type="range"
							className="form-range"
							min={-1}
							max={1}
							step={0.05}
							value={values[slider.key]}
							disabled={disabled}
							onChange={(event) => {
								onChange(slider.key, Number.parseFloat(event.target.value));
							}}
						/>
						<div className="d-flex justify-content-between small text-body-secondary">
							<span>{slider.low}</span>
							<span>{slider.high}</span>
						</div>
						<div className="small text-body-secondary">
							At +100:{" "}
							{Object.entries(slider.weights)
								.map(
									([key, weight]) =>
										`${key} ×${(1 + weight).toFixed(2).replace(/0$/, "")}`,
								)
								.join(", ")}
						</div>
					</div>
				))}
			</div>
			<div className="small text-body-secondary">
				Each slider multiplies the settings it lists by 1 + weight × slider (at
				-100, the opposite), on top of the values in the form when the sliders
				were all at 0. Editing one of these settings directly or picking a
				preset resets the sliders to 0.
			</div>
		</div>
	);
};
