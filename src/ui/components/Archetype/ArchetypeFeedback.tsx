// archfb: "Doesn't fit?" - the user picks the build that fits a player better. The pick becomes his label (until the user
// clears it) and tunes how similar players are read (worker/api/archetypes.ts, common/archetypes/tuning.ts). Build names
// and descriptions only: no numbers (the no-visible-ratings challenge).
import { useEffect, useMemo, useState } from "react";
import type {
	FeedbackBuild,
	FeedbackOptions,
} from "../../../worker/api/archetypes.ts";
import { Modal } from "../Modal.tsx";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { toWorker } from "../../util/toWorker.ts";

const NONE = "__none__";
const MAX_RESULTS = 12;

const BuildOption = ({
	b,
	checked,
	onChange,
	name,
}: {
	b: FeedbackBuild;
	checked: boolean;
	onChange: () => void;
	name: string;
}) => (
	<label className="d-flex gap-2 py-1 archetype-fb-option">
		<input
			type="radio"
			className="form-check-input flex-shrink-0 mt-1"
			name={name}
			checked={checked}
			onChange={onChange}
		/>
		<span>
			<span className="fw-bold">{b.name}</span>{" "}
			<span className="text-body-secondary">({b.family})</span>
			<br />
			<span className="small">{b.desc}</span>
		</span>
	</label>
);

export const ArchetypeFeedbackModal = ({
	pid,
	show,
	onHide,
}: {
	pid: number;
	show: boolean;
	onHide: () => void;
}) => {
	const [opts, setOpts] = useState<FeedbackOptions | undefined>();
	const [choice, setChoice] = useState<string | undefined>();
	const [better, setBetter] = useState(false);
	const [search, setSearch] = useState("");
	const [message, setMessage] = useState<string | undefined>();
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!show) {
			return;
		}
		let cancelled = false;
		setMessage(undefined);
		setChoice(undefined);
		setBetter(false);
		setSearch("");
		(async () => {
			const o = await toWorker("archetypes", "feedbackOptions", { pid });
			if (!cancelled) {
				setOpts(o);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [pid, show]);

	const results = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!opts || q === "") {
			return [];
		}
		return opts.all
			.filter((b) =>
				[b.name, ...b.aliases].some((n) => n.toLowerCase().includes(q)),
			)
			.slice(0, MAX_RESULTS);
	}, [opts, search]);

	const save = async () => {
		if (choice === undefined) {
			return;
		}
		setSaving(true);
		const res = await toWorker("archetypes", "feedbackSubmit", {
			pid,
			id: choice === NONE ? null : choice,
			better,
		});
		setSaving(false);
		setMessage(res.message);
		if (res.ok) {
			const o = await toWorker("archetypes", "feedbackOptions", { pid });
			setOpts(o);
			await realtimeUpdate(["playerMovement"]);
		}
	};

	const clear = async () => {
		setSaving(true);
		await toWorker("archetypes", "feedbackClear", { pid });
		setSaving(false);
		setMessage("Your pick was cleared: he is read as before.");
		const o = await toWorker("archetypes", "feedbackOptions", { pid });
		setOpts(o);
		await realtimeUpdate(["playerMovement"]);
	};

	const radioName = `archetype-fb-${pid}`;
	const userPickName = opts?.userPick
		? (opts.all.find((b) => b.id === opts.userPick)?.name ??
			opts.suggestions.find((b) => b.id === opts.userPick)?.name)
		: undefined;

	return (
		<Modal show={show} onHide={onHide} scrollable>
			<Modal.Header closeButton>
				<Modal.Title>Doesn't fit?</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{!opts ? (
					<p>Loading...</p>
				) : !opts.enabled ? (
					<p>Archetypes are off.</p>
				) : (
					<>
						{message ? (
							<div className="alert alert-success py-2" role="status">
								{message}
							</div>
						) : null}
						{opts.userPick ? (
							<div className="alert alert-secondary py-2 d-flex flex-wrap align-items-center gap-2">
								<span>
									You picked <b>{userPickName ?? "a build"}</b> for him.
								</span>
								<button
									type="button"
									className="btn btn-sm btn-outline-secondary"
									onClick={clear}
									disabled={saving}
								>
									Undo / clear my pick
								</button>
							</div>
						) : null}
						<p className="mb-2">
							The reading says <b>{opts.shown?.name}</b>. Which build fits him
							better?
						</p>
						<div className="mb-2">
							{opts.suggestions.map((b) => (
								<BuildOption
									key={b.id}
									b={b}
									name={radioName}
									checked={choice === b.id}
									onChange={() => setChoice(b.id)}
								/>
							))}
						</div>
						<input
							type="search"
							className="form-control mb-2"
							placeholder={`Search all ${opts.all.length} builds for his position`}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							aria-label="Search builds"
						/>
						{results.length > 0 ? (
							<div className="mb-2">
								{results.map((b) => (
									<BuildOption
										key={b.id}
										b={b}
										name={radioName}
										checked={choice === b.id}
										onChange={() => setChoice(b.id)}
									/>
								))}
							</div>
						) : search.trim() !== "" ? (
							<p className="text-body-secondary small">No build matches.</p>
						) : null}
						<label className="d-flex gap-2 py-1">
							<input
								type="radio"
								className="form-check-input mt-1"
								name={radioName}
								checked={choice === NONE}
								onChange={() => setChoice(NONE)}
							/>
							<span>None of these / I'm not sure</span>
						</label>
						<div className="form-check mt-2">
							<input
								type="checkbox"
								className="form-check-input"
								id={`${radioName}-better`}
								checked={better}
								disabled={choice === undefined || choice === NONE}
								onChange={(e) => setBetter(e.target.checked)}
							/>
							<label
								className="form-check-label"
								htmlFor={`${radioName}-better`}
							>
								This is a much better kind of player for him (optional)
							</label>
						</div>
					</>
				)}
			</Modal.Body>
			<Modal.Footer>
				<button type="button" className="btn btn-secondary" onClick={onHide}>
					Close
				</button>
				<button
					type="button"
					className="btn btn-primary"
					disabled={choice === undefined || saving || !opts?.enabled}
					onClick={save}
				>
					Save my pick
				</button>
			</Modal.Footer>
		</Modal>
	);
};
