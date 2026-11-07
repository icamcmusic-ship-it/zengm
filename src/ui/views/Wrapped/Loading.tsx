import type { CSSProperties } from "react";

const PULSE = `
@keyframes wrapped-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
.wrapped-skeleton { animation: wrapped-pulse 1.4s ease-in-out infinite; background: var(--bs-secondary-bg); border-radius: 6px; }
@media (prefers-reduced-motion: reduce) { .wrapped-skeleton { animation: none; } }
`;

const Block = ({ style }: { style: CSSProperties }) => (
	<div className="wrapped-skeleton" style={style} />
);

// Shown at once while the league's history is read for Wrapped or Storylines, in the shape of what is coming. progress says what is being read.
export const WrappedLoading = ({
	progress,
	kind,
}: {
	progress: string;
	kind: "deck" | "stories";
}) => {
	return (
		<div role="status" aria-live="polite" data-loading="wrapped">
			<style>{PULSE}</style>
			<div className="d-flex align-items-center gap-2 mb-3 text-body-secondary">
				<div
					className="spinner-border spinner-border-sm"
					aria-hidden="true"
				></div>
				<span>
					{progress}… The first time takes a while for a big league, and it’s
					quick after that.
				</span>
			</div>
			{kind === "deck" ? (
				<div style={{ maxWidth: 520 }}>
					<div className="d-flex gap-1 mb-2">
						{Array.from({ length: 12 }, (_, i) => (
							<Block key={i} style={{ height: 6, flexGrow: 1 }} />
						))}
					</div>
					<Block style={{ height: 420, borderRadius: 16 }} />
					<div className="d-flex gap-2 mt-2">
						<Block style={{ height: 36, width: 90 }} />
						<Block style={{ height: 36, width: 70 }} />
					</div>
				</div>
			) : (
				<div className="row g-3">
					{Array.from({ length: 6 }, (_, i) => (
						<div className="col-12 col-lg-6" key={i}>
							<Block style={{ height: 140 }} />
						</div>
					))}
				</div>
			)}
		</div>
	);
};
