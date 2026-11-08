import { useState } from "react";
import { toWorker } from "../../util/toWorker.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";

// injuryDepth setting: team-wide load management
const LoadManagementToggle = ({
	initialValue,
	tid,
}: {
	initialValue: boolean;
	tid: number;
}) => {
	const [value, setValue] = useState(initialValue);
	return (
		<div className="form-check mt-2">
			<input
				className="form-check-input"
				type="checkbox"
				id={`load-management-${tid}`}
				checked={value}
				onChange={async (event) => {
					const checked = event.target.checked;
					setValue(checked);
					await toWorker("main", "setLoadManagement", {
						tid,
						value: checked,
					});
				}}
			/>
			<label className="form-check-label" htmlFor={`load-management-${tid}`}>
				<b>Load management</b>
			</label>
			<HelpPopover className="ms-1" title="Load management">
				<p>
					Rest veterans (34+, or 31+ and injury prone) in your rotation on the
					second night of back-to-backs in the regular season, as long as you
					have at least 10 healthy players. Resting lowers their injury risk.
					You can also turn it on for individual players on their player pages.
				</p>
				<p>AI teams do this on their own.</p>
			</HelpPopover>
		</div>
	);
};

export default LoadManagementToggle;
