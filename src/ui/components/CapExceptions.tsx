import { CAP_EXCEPTIONS } from "../../common/capExceptions.ts";
import type { CapExceptionsSummary } from "../../worker/core/contract/capExceptions.ts";
import { helpers } from "../util/helpers.ts";
import { HelpPopover } from "./HelpPopover.tsx";

// Salary cap exceptions a team has left this league year (League Extras: Salary Cap Exceptions)
export const CapExceptions = ({
	capExceptions,
	className,
	own = true,
}: {
	capExceptions: CapExceptionsSummary;
	className?: string;
	// False on another team's page
	own?: boolean;
}) => {
	const { available, used, usedCapSpace } = capExceptions;
	return (
		<div className={className} data-testid="cap-exceptions">
			Salary cap exceptions:{" "}
			{available.length === 0 ? (
				<span className="text-body-secondary">none left</span>
			) : (
				available.map((exception, i) => (
					<span key={exception.type}>
						{i > 0 ? ", " : null}
						<b>
							{CAP_EXCEPTIONS[exception.type].shortName}{" "}
							{helpers.formatCurrency(exception.amount, "M")}
						</b>{" "}
						(up to {exception.maxYears}{" "}
						{helpers.plural("year", exception.maxYears)})
					</span>
				))
			)}
			{used.length > 0 ? (
				<span className="text-body-secondary">
					{" "}
					· used:{" "}
					{used
						.map(
							(use) =>
								`${CAP_EXCEPTIONS[use.type].shortName} (${use.name}, ${helpers.formatCurrency(use.amount, "M")})`,
						)
						.join(", ")}
				</span>
			) : null}{" "}
			<HelpPopover title="Salary Cap Exceptions">
				<p>
					{own ? "You" : "A team"} can go over the salary cap to sign one free
					agent a season with each exception. It happens automatically when a
					contract doesn't fit under the cap.
				</p>
				<ul className="ps-3">
					<li>
						<b>Mid-level:</b> up to{" "}
						{Math.round(CAP_EXCEPTIONS.nonTaxpayerMle.capFraction * 1000) / 10}%
						of the cap. Near or over the luxury tax it shrinks to the taxpayer
						mid-level (
						{Math.round(CAP_EXCEPTIONS.taxpayerMle.capFraction * 1000) / 10}
						%), and far over the tax there is none.
					</li>
					<li>
						<b>Bi-annual:</b> up to{" "}
						{Math.round(CAP_EXCEPTIONS.biAnnual.capFraction * 1000) / 10}% of
						the cap, every other season, not for taxpaying teams.
					</li>
					<li>
						<b>Room:</b> up to{" "}
						{Math.round(CAP_EXCEPTIONS.room.capFraction * 1000) / 10}% of the
						cap, instead of the others for a team that signed a free agent with
						cap space this season.
					</li>
				</ul>
				<p className="mb-0">
					{usedCapSpace
						? `${own ? "You" : "This team"} used cap space this season, so only the room exception applies. `
						: null}
					Exceptions reset when free agency starts. Minimum contracts and
					re-signing your own players never need one.
				</p>
			</HelpPopover>
		</div>
	);
};
