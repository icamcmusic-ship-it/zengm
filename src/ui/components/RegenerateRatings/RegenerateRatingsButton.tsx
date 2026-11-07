import { useState } from "react";
import { bySport } from "../../../common/sportFunctions.ts";
import { RegenerateRatingsModal } from "./RegenerateRatingsModal.tsx";

// A button on the Draft Scouting page. Basketball only. Everything it opens lives in this folder.
export const RegenerateRatingsButton = ({ seasons }: { seasons: number[] }) => {
	const [show, setShow] = useState(false);

	const supported = bySport({
		baseball: false,
		basketball: true,
		football: false,
		hockey: false,
	});

	if (!supported || seasons.length === 0) {
		return null;
	}

	return (
		<>
			<div className="mb-3">
				<button
					type="button"
					className="btn btn-light-bordered"
					onClick={() => setShow(true)}
					title="Rebuild prospects into varied, specialized builds without changing anyone's overall, potential or height"
				>
					Regenerate ratings
				</button>
			</div>
			{show ? (
				<RegenerateRatingsModal
					seasons={seasons}
					show={show}
					onHide={() => setShow(false)}
				/>
			) : null}
		</>
	);
};
