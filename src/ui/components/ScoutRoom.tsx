// Scout Consensus & Flags: the scouts' room (consensus, spread, outliers) and the red/green flags, in tables and on the Scouting page
import type {
	ProspectRoom,
	ProspectRoomSummary,
} from "../../worker/core/scoutingReports/room.ts";

const LABEL_CLASS: Record<string, string> = {
	Agree: "text-bg-success",
	Mixed: "text-bg-info",
	Split: "text-bg-warning",
	"One look": "text-bg-secondary",
};

export const SpreadBadge = ({ label }: { label: string | undefined }) =>
	label ? (
		<span
			className={`badge ${LABEL_CLASS[label] ?? "text-bg-secondary"} fw-normal`}
		>
			{label}
		</span>
	) : null;

const roomTitle = (room: ProspectRoomSummary) =>
	[
		`${room.n} ${room.n === 1 ? "scout has" : "scouts have"} seen him.`,
		room.summary ?? "",
		...room.outliers,
	]
		.filter(Boolean)
		.join("\n");

// Sort value for tables: the consensus slot (ties: the more agreed room first)
export const roomSortValue = (room: ProspectRoomSummary | undefined) =>
	(room?.consensusSlot ?? 9999) + Math.min(0.9, (room?.spread ?? 0) / 10);

export const RoomCell = ({ room }: { room: ProspectRoomSummary | undefined }) =>
	room && room.n > 0 ? (
		<span
			className="text-nowrap"
			title={roomTitle(room)}
			data-testid="scout-room-cell"
		>
			No. {room.consensusSlot} <SpreadBadge label={room.label} />
			{room.outliers.length > 0 ? (
				<span className="text-body-secondary ms-1">*</span>
			) : null}
			{room.slotRange && room.n > 1 && room.label !== "Agree" ? (
				<div className="small text-body-secondary">
					{room.slotRange[0]}-{room.slotRange[1]}
				</div>
			) : null}
		</span>
	) : null;

type Flag = ProspectRoomSummary["flags"][number];

const flagLine = (f: Flag) =>
	`${f.tone === "red" ? "▼" : "▲"} ${f.text}: ${f.why}`;

export const flagsSortValue = (flags: Flag[] | undefined) =>
	(flags ?? []).reduce((a, f) => a + (f.tone === "green" ? 1 : -1), 0);

export const FlagsCell = ({ flags }: { flags: Flag[] | undefined }) => {
	if (!flags || flags.length === 0) {
		return null;
	}
	const green = flags.filter((f) => f.tone === "green").length;
	const red = flags.length - green;
	return (
		<span
			className="text-nowrap"
			title={flags.map(flagLine).join("\n")}
			data-testid="scout-flags-cell"
		>
			{green > 0 ? <span className="text-success me-1">▲{green}</span> : null}
			{red > 0 ? <span className="text-danger">▼{red}</span> : null}
		</span>
	);
};

export const FlagChips = ({ flags }: { flags: Flag[] }) =>
	flags.length > 0 ? (
		<div className="d-flex flex-wrap gap-1 mb-2" data-testid="scout-flag-chips">
			{flags.map((f) => (
				<span
					key={f.text}
					className={`badge fw-normal ${f.tone === "red" ? "text-bg-danger" : "text-bg-success"}${f.hint ? " opacity-75" : ""}`}
					title={f.why}
				>
					{f.tone === "red" ? "▼" : "▲"} {f.text}
				</span>
			))}
		</div>
	) : null;

// The Scouting page's section: every scout who has seen him, his grade and his reason
export const ScoutRoomTable = ({
	room,
}: {
	room: NonNullable<ProspectRoom["room"]>;
}) => (
	<div data-testid="scout-room">
		<div className="mb-1">
			<b>Consensus:</b> {room.consensusText} (No. {room.consensusSlot} in his
			class) <SpreadBadge label={room.label} />
		</div>
		<div className="small text-body-secondary mb-2">{room.summary}</div>
		{room.outliers.map((line) => (
			<div key={line} className="small fw-bold">
				{line}
			</div>
		))}
		<div className="table-responsive">
			<table className="table table-sm table-striped small mb-0">
				<thead>
					<tr>
						<th>Scout</th>
						<th title="Where his grade would put him in this class">Slot</th>
						<th>Why</th>
					</tr>
				</thead>
				<tbody>
					{room.grades.map((x) => (
						<tr key={x.scoutId}>
							<td className="text-nowrap">
								{x.name}
								<div className="text-body-secondary">
									{x.title}
									{x.familiar ? ", covers his region" : ""}
								</div>
							</td>
							<td
								className={
									x.outlier === "high"
										? "text-success fw-bold"
										: x.outlier === "low"
											? "text-danger fw-bold"
											: undefined
								}
							>
								No. {x.slot}
							</td>
							<td>{x.reason}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	</div>
);
