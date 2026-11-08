import clsx from "clsx";
import type { ReactNode } from "react";
import { OverlayTrigger, Popover } from "react-bootstrap";
import type { FormattedContract } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";

// Contract amount doesn't need exp, which may be undefined for a range of seasons
type ContractAmountPlayer = {
	draft: {
		year: number;
	};
	contract: Pick<FormattedContract, "amount" | "rookie" | "remainingSeasons">;
};

type ContractPlayer = ContractAmountPlayer & {
	contract: FormattedContract;
};

const useJustDrafted = (p: ContractAmountPlayer) => {
	const { phase, season } = useLocal(["phase", "season"]);

	return helpers.justDrafted(p, phase, season);
};

const NON_GUARANTEED_CONTRACT_TEXT =
	"Contracts for drafted players are not guaranteed until the regular season. If you release a drafted player before then, you pay nothing.";

// For a contract with different amounts in different seasons, since the amount shown is only this season's. Clicking it shows the amount in each remaining season.
const RemainingSeasons = ({
	children,
	remainingSeasons,
}: {
	children: ReactNode;
	remainingSeasons: NonNullable<FormattedContract["remainingSeasons"]>;
}) => {
	return (
		<OverlayTrigger
			trigger="click"
			placement="auto"
			overlay={
				<Popover>
					<Popover.Body>
						<ul className="list-unstyled mb-0">
							{remainingSeasons.map(({ season, amount }) => (
								<li
									key={season}
									className="d-flex justify-content-between gap-3"
								>
									<div>{season}</div>
									<div>{helpers.formatCurrency(amount, "M")}</div>
								</li>
							))}
						</ul>
					</Popover.Body>
				</Popover>
			}
			rootClose
		>
			<button
				className="btn btn-link p-0 border-0 align-baseline text-reset text-decoration-none"
				title="Different amounts in different seasons"
				type="button"
			>
				{children}*
			</button>
		</OverlayTrigger>
	);
};

export const ContractAmount = ({
	p,
	override,
}: {
	p: ContractAmountPlayer;
	override?: number;
}) => {
	const justDrafted = useJustDrafted(p);

	const amount = (
		<span
			className={justDrafted ? "fst-italic" : undefined}
			title={justDrafted ? NON_GUARANTEED_CONTRACT_TEXT : undefined}
		>
			{helpers.formatCurrency(override ?? p.contract.amount, "M")}
		</span>
	);

	if (override === undefined && p.contract.remainingSeasons) {
		return (
			<RemainingSeasons remainingSeasons={p.contract.remainingSeasons}>
				{amount}
			</RemainingSeasons>
		);
	}

	return amount;
};

// Text version of ContractAmount, for searching
const formatContractAmount = (p: ContractAmountPlayer, override?: number) => {
	const formatted = helpers.formatCurrency(override ?? p.contract.amount, "M");
	if (override === undefined && p.contract.remainingSeasons) {
		return `${formatted}*`;
	}
	return formatted;
};

export const wrappedContractAmount = (
	p: ContractAmountPlayer,
	override?: number,
) => {
	return {
		value: <ContractAmount p={p} override={override} />,
		sortValue: p.contract.amount,
		searchValue: formatContractAmount(p, override),
	};
};

export const ContractExp = ({
	p,
	override,
}: {
	p: ContractPlayer;
	override?: number;
}) => {
	const justDrafted = useJustDrafted(p);

	const { season } = useLocal(["season"]);
	const expiring = season === p.contract.exp;

	return (
		<span
			className={clsx({
				"fst-italic": justDrafted,
				"fw-bold": expiring,
			})}
			title={
				justDrafted
					? NON_GUARANTEED_CONTRACT_TEXT
					: expiring
						? "Expiring contract"
						: undefined
			}
		>
			{override ?? p.contract.exp}
			{override === undefined ? (
				<ContractTermsBadge terms={p.contract.terms} exp={p.contract.exp} />
			) : null}
		</span>
	);
};

// Small marker after the expiration year for an option or partial guarantee
export const ContractTermsBadge = ({
	terms,
	exp,
}: {
	terms: FormattedContract["terms"];
	exp: number | undefined;
}) => {
	if (!terms) {
		return null;
	}

	const label = [
		terms.option === "player" ? "PO" : terms.option === "team" ? "TO" : null,
		terms.guaranteed !== undefined
			? `${Math.round(terms.guaranteed * 100)}%G`
			: null,
	]
		.filter((x) => x !== null)
		.join(" ");
	const title = [
		terms.option
			? `${terms.option === "player" ? "Player" : "Team"} option on ${exp}`
			: null,
		terms.guaranteed !== undefined
			? `Seasons after the first are ${Math.round(terms.guaranteed * 100)}% guaranteed`
			: null,
	]
		.filter((x) => x !== null)
		.join(". ");

	return (
		<span
			className="badge text-bg-secondary ms-1 align-text-top"
			style={{ fontSize: "0.65em" }}
			title={title}
		>
			{label}
		</span>
	);
};

export const wrappedContractExp = (p: ContractPlayer, override?: number) => {
	const formatted = override ?? p.contract.exp;

	return {
		value: <ContractExp p={p} override={override} />,
		sortValue: formatted,
		searchValue: formatted,
	};
};

export const Contract = ({ p }: { p: ContractPlayer }) => {
	const justDrafted = useJustDrafted(p);

	return (
		<>
			<ContractAmount p={p} />
			<span
				className={justDrafted ? "fst-italic" : undefined}
				title={justDrafted ? NON_GUARANTEED_CONTRACT_TEXT : undefined}
			>
				{" "}
				thru{" "}
			</span>
			<ContractExp p={p} />
		</>
	);
};

export const wrappedContract = (p: ContractPlayer) => {
	return {
		value: <Contract p={p} />,
		sortValue: p.contract.amount,
		searchValue: `${formatContractAmount(p)} thru ${p.contract.exp}`,
	};
};
