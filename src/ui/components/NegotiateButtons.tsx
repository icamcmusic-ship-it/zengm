import type { SigningAdvice } from "../../worker/core/contract/capExceptions.ts";
import { describeCapException } from "../../common/capExceptions.ts";
import { helpers } from "../util/helpers.ts";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import { showUndoNotification } from "./UndoNotification.tsx";

export const showSignUndo = ({
	name,
	undoKey,
}: {
	name: string;
	undoKey: number;
}) => {
	showUndoNotification({
		actionName: "signing",
		undoKey,
		title: `You signed ${name}`,
	});
};

// season is just needed during re-signing, because it's used to make sure drafted players in hard cap leagues always
// are willing to sign.
export const NegotiateButtons = ({
	canGoOverCap,
	capSpace,
	exceptionAmount = 0,
	disabled,
	minContract,
	onNegotiate,
	spectator,
	p,
	willingToNegotiate,
	signingAdvice,
}: {
	canGoOverCap?: boolean;
	capSpace: number;
	// Largest salary (in millions) that can be signed over the cap with a salary cap exception (setting), 0 if none
	exceptionAmount?: number;
	disabled?: boolean;
	minContract: number;
	onNegotiate: () => void;
	spectator: boolean;
	p: {
		pid: number;
		firstName: string;
		lastName: string;
		contract: { exp: number };
		mood: { user: { contractAmount: number } };
	};
	willingToNegotiate: boolean;
	// Salary cap exceptions (setting): he asks for more years than the exception that covers him allows (Free Agents page)
	signingAdvice?: SigningAdvice;
}) => {
	if (spectator) {
		return null;
	}

	if (!willingToNegotiate) {
		return "Refuses!";
	}

	const shorter = signingAdvice?.type === "shorter" ? signingAdvice : undefined;
	const contractAmount = shorter ? shorter.amount : p.mood.user.contractAmount;
	const contractExp = shorter ? shorter.exp : p.contract.exp;

	const signDisabled =
		!canGoOverCap &&
		(!!disabled ||
			signingAdvice?.type === "tooLong" ||
			(contractAmount / 1000 > capSpace + 1 / 1000 &&
				contractAmount / 1000 > (minContract + 1) / 1000 &&
				contractAmount / 1000 > exceptionAmount));
	const signTitle = shorter
		? `He asks for ${shorter.askedYears} years, but your ${describeCapException(shorter.exception)} allows up to ${shorter.maxYears}. Sign him for ${shorter.maxYears} ${helpers.plural("year", shorter.maxYears)} at ${helpers.formatCurrency(shorter.amount / 1000, "M")}/year (through ${shorter.exp}).`
		: signingAdvice?.type === "tooLong"
			? signingAdvice.reason
			: undefined;
	return (
		<>
			<button
				className="btn btn-light-bordered btn-xs"
				disabled={!!disabled}
				onClick={onNegotiate}
			>
				Negotiate
			</button>
			<button
				className="btn btn-light-bordered btn-xs text-nowrap"
				disabled={signDisabled}
				title={signTitle}
				data-testid={
					signingAdvice ? `sign-advice-${signingAdvice.type}` : undefined
				}
				onClick={async () => {
					const response = await toWorker("main", "acceptContractNegotiation", {
						pid: p.pid,
						amount: contractAmount,
						exp: contractExp,
					});

					if (typeof response === "string") {
						showNotification({
							type: "error",
							text: response,
						});
					} else {
						showSignUndo({
							name: `${p.firstName} ${p.lastName}`,
							undoKey: response,
						});
					}
				}}
			>
				{shorter ? `Sign ${shorter.maxYears}y` : "Sign"}
			</button>
		</>
	);
};
