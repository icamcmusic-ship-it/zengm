// Face style gallery: every option of a face feature drawn side by side on a few sample faces (different skin and hair colours),
// to check how parts overlap. Includes the fork's own parts (common/faceParts.ts) and the setting that turns them on.
import { useState } from "react";
import { generate, type FaceConfig } from "facesjs";
import { Face } from "facesjs/react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import {
	builtinFacePartIds,
	FORK_FACE_PARTS,
	registerForkFaceParts,
	type FacePartFeature,
} from "../../common/faceParts.ts";
import { DEFAULT_JERSEY } from "../../common/constants.ts";

const FEATURES: FacePartFeature[] = [
	"hair",
	"hairBg",
	"head",
	"ear",
	"eye",
	"eyebrow",
	"nose",
	"mouth",
	"facialHair",
	"glasses",
	"accessories",
	"body",
	"eyeLine",
	"smileLine",
	"miscLine",
];

// Skin and hair colours of the sample faces (light to dark skin; black, brown, blond and red hair)
const SAMPLES: { skin: string; hair: string }[] = [
	{ skin: "#f2d6cb", hair: "#e9c67b" },
	{ skin: "#ddb7a0", hair: "#B55239" },
	{ skin: "#bb876f", hair: "#3D2314" },
	{ skin: "#7a4d3a", hair: "#272421" },
];

const makeSamples = (): FaceConfig[] =>
	SAMPLES.map(({ skin, hair }) => {
		const face = generate(
			{ jersey: { id: DEFAULT_JERSEY } },
			{ gender: "male" },
		);
		face.body.color = skin;
		face.hair.color = hair;
		face.accessories.id = "none";
		face.glasses.id = "none";
		return face;
	});

const withPart = (
	face: FaceConfig,
	feature: FacePartFeature,
	id: string,
): FaceConfig => ({
	...face,
	[feature]: { ...face[feature], id },
	// Show hair over a hairBg option, and no hat hiding a hair option
	...(feature === "hairBg" ? { hair: { ...face.hair, id: "short" } } : {}),
});

const FaceStyleGallery = () => {
	useTitleBar({ title: "Face Style Gallery" });

	// The gallery always shows the fork's parts, so they are registered while it is open (append-only, existing faces unchanged)
	useState(() => {
		registerForkFaceParts();
	});

	const [feature, setFeature] = useState<FacePartFeature>("hair");
	const [samples, setSamples] = useState(makeSamples);

	const builtin = builtinFacePartIds(feature);
	const fork = FORK_FACE_PARTS.filter((part) => part.feature === feature).map(
		(part) => part.id,
	);

	const renderOption = (id: string, isFork: boolean) => (
		<div key={id} className="border rounded p-1" style={{ width: 4 * 64 + 16 }}>
			<div className="text-center small">
				{id}
				{isFork ? <span className="badge bg-info ms-1">fork</span> : null}
			</div>
			<div className="d-flex">
				{samples.map((face, i) => (
					<div key={i} style={{ width: 64 }}>
						<Face
							face={withPart(face, feature, id)}
							ignoreDisplayErrors
							lazy
							style={{ aspectRatio: "2/3" }}
						/>
					</div>
				))}
			</div>
		</div>
	);

	return (
		<>
			<p>
				Every option of a face feature on {SAMPLES.length} sample faces, to
				check how parts overlap. Parts marked <i>fork</i> are this fork's own
				additions; they are only added after facesjs' own options and never
				replace one. New male players get them mixed in at random when League
				Extras → Fork Face Parts is on (off by default). In a player's face
				editor (Customize Player), the Fork parts menu sets them by hand.
			</p>
			<div className="d-flex flex-wrap gap-2 mb-3">
				<div className="btn-group flex-wrap">
					{FEATURES.map((f) => (
						<button
							key={f}
							type="button"
							className={`btn btn-sm ${f === feature ? "btn-primary" : "btn-light-bordered"}`}
							onClick={() => setFeature(f)}
						>
							{f}
						</button>
					))}
				</div>
				<button
					type="button"
					className="btn btn-sm btn-secondary"
					onClick={() => setSamples(makeSamples())}
				>
					New sample faces
				</button>
			</div>
			<p className="text-body-secondary">
				{builtin.length} facesjs options
				{fork.length > 0 ? `, ${fork.length} fork options` : ""}
			</p>
			<div className="d-flex flex-wrap gap-2">
				{fork.map((id) => renderOption(id, true))}
				{builtin.map((id) => renderOption(id, false))}
			</div>
		</>
	);
};

export default FaceStyleGallery;
