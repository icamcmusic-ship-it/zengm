import { useEffect, useEffectEvent, useState } from "react";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";
import clsx from "clsx";
import { FORK_FACE_PARTS } from "../../../common/faceParts.ts";

// The fork's own parts (common/faceParts.ts) are not in the facesjs editor, so they are set here
const FORK_FEATURES = [...new Set(FORK_FACE_PARTS.map((part) => part.feature))];

export const Face = ({
	face,
	faceCount,
	onChange,
	randomizeFace,
}: {
	face: string;
	faceCount: number;
	onChange: (face: string) => void;
	randomizeFace: () => void;
}) => {
	let parsedFace;
	try {
		parsedFace = JSON.parse(face);
	} catch {}

	const faceHash = parsedFace ? btoa(JSON.stringify(parsedFace)) : "";

	const onFaceChange = useEffectEvent(onChange);

	useEffect(() => {
		const listener = (event: MessageEvent) => {
			// key check is to handle the case where the user opens an editor, switches to another player, and opens another editor. So there are two editors open for two different players - we need to tell which one this is. Can't use pid alone because new players don't have a pid yet!
			if (event.data.type === "facesjs" && event.data.key === faceCount) {
				onFaceChange(JSON.stringify(event.data.value));
				event.source?.postMessage(
					{
						type: "facesjs",
						action: "close",
					},
					// @ts-expect-error
					"*",
				);
			}
		};
		window.addEventListener("message", listener);

		return () => {
			window.removeEventListener("message", listener);
		};
	}, [faceCount]);

	const [editJson, setEditJson] = useState(false);

	return (
		<div className="d-flex gap-3">
			<div style={{ height: 225, width: 150 }}>
				{parsedFace ? <PlayerPicture face={parsedFace} /> : "Invalid JSON"}
			</div>
			<div className="flex-grow-1">
				<div
					className={clsx(
						"d-flex gap-2",
						editJson ? undefined : "mt-4 flex-column align-items-start",
					)}
				>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => {
							// Need button rather than link because "open in new tab" seems to interfere with setting window.opener in the new window, even with rel="opener"
							window.open(
								`${__NODE_ENV === "development" ? "http://localhost:5173" : "https://zengm.com"}/facesjs/editor/#${faceCount},${faceHash}`,
								`_blank`,
							);
						}}
					>
						Face editor
					</button>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={randomizeFace}
					>
						Randomize
					</button>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => {
							setEditJson((value) => !value);
						}}
					>
						Edit raw JSON
					</button>
				</div>
				{parsedFace ? (
					<details className="mt-2">
						<summary>Fork parts</summary>
						<div className="d-flex flex-wrap gap-2 mt-1">
							{FORK_FEATURES.map((feature) => {
								const current = parsedFace[feature]?.id;
								const ids = FORK_FACE_PARTS.filter(
									(part) => part.feature === feature,
								).map((part) => part.id);
								return (
									<label key={feature} className="small">
										{feature}
										<select
											className="form-select form-select-sm"
											value={ids.includes(current) ? current : ""}
											onChange={(event) => {
												if (event.target.value === "") {
													return;
												}
												onChange(
													JSON.stringify({
														...parsedFace,
														[feature]: {
															...parsedFace[feature],
															id: event.target.value,
														},
													}),
												);
											}}
										>
											<option value="">{current ?? "-"}</option>
											{ids.map((id) => (
												<option key={id} value={id}>
													{id}
												</option>
											))}
										</select>
									</label>
								);
							})}
						</div>
					</details>
				) : null}
				{editJson ? (
					<textarea
						className="form-control mt-2"
						onChange={(event) => {
							onChange(event.target.value);
						}}
						rows={10}
						value={face}
					/>
				) : null}
			</div>
		</div>
	);
};
