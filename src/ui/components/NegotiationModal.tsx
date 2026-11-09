import type { ContractTerms } from "../../common/types.ts";
import {
	describeContractTerms,
	getContractTermsFactor,
	GUARANTEE_LEVELS,
	normalizeContractTerms,
} from "../../common/contractTerms.ts";
import { Modal } from "./Modal.tsx";
import clsx from "clsx";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { helpers } from "../util/helpers.ts";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import { useLocal } from "../util/local.ts";
import { HelpPopover } from "../components/HelpPopover.tsx";
import { RatingsStatsPopover } from "../components/RatingsStatsPopover/index.tsx";
import { Mood } from "../components/Mood.tsx";
import { PlayerPicture } from "../components/PlayerPicture.tsx";
import { useRef, useState } from "react";
import type api from "../../worker/api/index.ts";
import { showSignUndo } from "./NegotiateButtons.tsx";

type NegotaitionModalProps = Exclude<
	Awaited<ReturnType<typeof api.main.getNegotiationProps>>,
	string
>;

const SignButton = ({
	p,
	amount,
	exp,
	disabledReason,
	onSuccess,
	terms,
}: {
	p: { name: string; pid: number };
	amount: number;
	exp: number;
	disabledReason: string | undefined;
	onSuccess: () => void;
	terms?: ContractTerms;
}) => {
	const button = (
		<button
			className={`btn ${disabledReason !== undefined ? "btn-secondary" : "btn-success"}`}
			disabled={disabledReason !== undefined}
			onClick={async () => {
				const response = await toWorker("main", "acceptContractNegotiation", {
					pid: p.pid,
					amount: Math.round(amount * 1000),
					exp,
					terms,
				});
				if (typeof response === "string") {
					showNotification({
						type: "error",
						text: response,
					});
				} else {
					onSuccess();
					showSignUndo({
						name: p.name,
						undoKey: response,
					});
				}
			}}
		>
			Sign
			<span className="d-none d-sm-inline"> contract</span>
		</button>
	);

	if (disabledReason === undefined) {
		return button;
	}

	// CSS/HTML hacks!
	// position-fixed is for https://stackoverflow.com/a/75264190/786644 https://github.com/react-bootstrap/react-bootstrap/issues/6563 otherwise the scrollback flicker appears/disappears on desktop when the react-bootstrap Tooltip is shown. However this breaks if you scroll, but this page doesn't need to scroll.
	// Wrapper div around button is because otherwise there is no hover over the disabled button and no tooltip is shown.
	return (
		<OverlayTrigger
			overlay={<Tooltip className="position-fixed">{disabledReason}</Tooltip>}
		>
			<div>{button}</div>
		</OverlayTrigger>
	);
};

const widthStyle = { maxWidth: 575 };

const NegotiationHeader = ({
	capSpace,
	challengeNoRatings,
	currentContract,
	extension,
	payroll,
	p,
	resigning,
	salaryCap,
	salaryCapType,
	t,
}: Pick<
	NegotaitionModalProps,
	| "currentContract"
	| "extension"
	| "capSpace"
	| "challengeNoRatings"
	| "payroll"
	| "p"
	| "resigning"
	| "salaryCap"
	| "salaryCapType"
	| "t"
>) => {
	const { gender } = useLocal(["gender"]);

	let message;
	if (salaryCapType === "soft") {
		if (resigning) {
			message = (
				<>
					You are allowed to go over the salary cap when re-signing players.{" "}
					<b>
						If you do not come to an agreement here, {p.name} will become a free
						agent.
					</b>{" "}
					{helpers.pronoun(gender, "He")} will then be able to sign with any
					team, and you won't be able to go over the salary cap to sign{" "}
					{helpers.pronoun(gender, "him")} unless{" "}
					{helpers.pronoun(gender, "he")}'s asking for a minimum contract.
				</>
			);
		} else {
			message =
				"You are not allowed to go over the salary cap to sign free agents, unless it's for a minimum contract.";
		}
	} else if (salaryCapType === "hard") {
		message =
			"You are not allowed to go over the salary cap to sign players, unless it's for a minimum contract.";
	}

	return (
		<>
			<div className="d-flex gap-2 mb-3" style={widthStyle}>
				<div
					style={{
						height: 90,
						width: 60,
						marginTop: p.imgURL ? 0 : -10,
					}}
					className="flex-shrink-0 d-flex justify-content-center align-items-center"
				>
					<PlayerPicture
						face={p.face}
						imgURL={p.imgURL}
						colors={t.colors}
						jersey={t.jersey}
						lazy
					/>
				</div>
				<div className="d-flex flex-column justify-content-end">
					<div className="d-flex flex-wrap gap-2">
						<h1 className="mb-0 text-nowrap">
							<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
						</h1>
						<div className="d-flex align-items-center">
							<Mood defaultType="user" p={p} />
							<RatingsStatsPopover pid={p.pid} defaultWatch={p.watch} />
						</div>
					</div>
					<div>
						{p.age} years old
						{!challengeNoRatings
							? `; Overall: ${p.ratings.ovr}; Potential: ${p.ratings.pot}`
							: null}
					</div>
					<div>
						{extension
							? `Extension (current contract: ${currentContract ? `${helpers.formatCurrency(currentContract.amount, "M")} thru ${currentContract.exp}` : "none"})`
							: resigning
								? "Re-signing"
								: "Free Agent"}
						{message ? (
							<HelpPopover className="ms-1">{message}</HelpPopover>
						) : null}
					</div>
				</div>
				<div className="ms-auto d-none d-sm-flex flex-column justify-content-end align-items-end text-nowrap">
					{salaryCapType !== "none" ? (
						<>
							<div>Salary Cap: {helpers.formatCurrency(salaryCap, "M")}</div>
							<div>Payroll: {helpers.formatCurrency(payroll, "M")}</div>
							<div>Cap Space: {helpers.formatCurrency(capSpace, "M")}</div>
						</>
					) : (
						<div>Payroll: {helpers.formatCurrency(payroll, "M")}</div>
					)}
				</div>
			</div>
		</>
	);
};

const ContractTermsControls = ({
	terms,
	setTerms,
}: {
	terms: ContractTerms;
	setTerms: (terms: ContractTerms) => void;
}) => {
	return (
		<div className="d-flex flex-wrap gap-2 mb-2" style={widthStyle}>
			<div className="input-group input-group-sm" style={{ width: "auto" }}>
				<span className="input-group-text">Option</span>
				<select
					className="form-select"
					value={terms.option ?? "none"}
					onChange={(event) => {
						const value = event.target.value;
						setTerms({
							...terms,
							option:
								value === "player" || value === "team" ? value : undefined,
						});
					}}
				>
					<option value="none">None</option>
					<option value="player">Player option (-5%)</option>
					<option value="team">Team option (+10%)</option>
				</select>
			</div>
			<div className="input-group input-group-sm" style={{ width: "auto" }}>
				<span className="input-group-text">Guaranteed after year 1</span>
				<select
					className="form-select"
					value={terms.guaranteed ?? 1}
					onChange={(event) => {
						const value = Number.parseFloat(event.target.value);
						setTerms({
							...terms,
							guaranteed: value < 1 ? value : undefined,
						});
					}}
				>
					{GUARANTEE_LEVELS.map((level) => (
						<option key={level} value={level}>
							{Math.round(level * 100)}%
							{level < 1 ? ` (+${Math.round(20 * (1 - level))}%)` : ""}
						</option>
					))}
				</select>
			</div>
			<HelpPopover>
				An option is on the final season. With a player option, he decides
				whether to stay for that season, so he'll take a bit less. With a team
				option, you decide, so he wants more. If you release a player, you only
				owe the guaranteed part of seasons after the current one. Options and
				guarantees only apply to contracts of at least 2 years.
			</HelpPopover>
		</div>
	);
};

const Negotiation = ({
	contractOptions,
	contractTermsEnabled,
	close,
	p,
}: Pick<
	NegotaitionModalProps,
	"contractOptions" | "contractTermsEnabled" | "p"
> & {
	close: () => void;
}) => {
	const [terms, setTerms] = useState<ContractTerms>({});
	const { minContract } = useLocal(["minContract"]);
	return (
		<>
			{contractTermsEnabled ? (
				<ContractTermsControls terms={terms} setTerms={setTerms} />
			) : null}
			<div className="list-group" style={widthStyle}>
				{contractOptions.map((contractRaw, i) => {
					const rowTerms = contractTermsEnabled
						? normalizeContractTerms(terms, contractRaw.years)
						: undefined;
					// Without terms, keep the exact amount, since rounding it could turn a minimum contract (like $1.157M) into slightly more than the minimum, which can't be signed over the cap. With terms, round to the nearest $10k, but never below the minimum.
					const termsFactor = getContractTermsFactor(
						rowTerms,
						contractRaw.years,
					);
					const contract = {
						...contractRaw,
						amount:
							termsFactor === 1
								? contractRaw.amount
								: Math.max(
										minContract / 1000,
										Math.round(contractRaw.amount * termsFactor * 100) / 100,
									),
					};
					return (
						<div
							key={i}
							className={clsx("d-flex align-items-center list-group-item", {
								"list-group-item-success": contract.smallestAmount,
							})}
						>
							<div className="flex-grow-1">
								<b>{helpers.formatCurrency(contract.amount, "M")}</b>/year for{" "}
								{contract.years} {helpers.plural("year", contract.years)}{" "}
								(through {contract.exp})
								{rowTerms ? (
									<div className="small text-body-secondary">
										{describeContractTerms(rowTerms, contract.exp)}
									</div>
								) : null}
							</div>

							<SignButton
								p={p}
								amount={contract.amount}
								exp={contract.exp}
								disabledReason={contract.disabledReason}
								onSuccess={close}
								terms={rowTerms}
							/>
						</div>
					);
				})}
			</div>
		</>
	);
};

export const NegotiationModal = ({
	close,
	negotiationProps,
	show,
}: {
	close: () => void;
	negotiationProps: NegotaitionModalProps | undefined;
	show: boolean;
}) => {
	return (
		<Modal show={show} onHide={close}>
			<Modal.Body>
				<button
					type="button"
					className="btn-close"
					aria-label="Close"
					onClick={close}
					style={{
						position: "absolute",
						top: 16,
						right: 16,
					}}
				></button>
				{negotiationProps ? (
					<>
						<NegotiationHeader {...negotiationProps} />
						<Negotiation {...negotiationProps} close={close} />
					</>
				) : null}
			</Modal.Body>
		</Modal>
	);
};

export const useNegotiaionModal = () => {
	const [state, setState] = useState<
		| {
				status: "loaded";
				props: NegotaitionModalProps;
				show: boolean;
		  }
		| {
				status: "init";
		  }
	>({
		status: "init",
	});

	const show = state.status === "loaded" && state.show;

	const loadingPid = useRef<number | undefined>(undefined);

	const props = {
		close: () => {
			if (show) {
				setState((state) => {
					if (state.status === "loaded") {
						return { ...state, show: false };
					}

					return state;
				});
			}
		},
		negotiationProps: state.status === "loaded" ? state.props : undefined,
		show,
	};

	return {
		negotiate: async (pid: number) => {
			loadingPid.current = pid;

			const newProps = await toWorker("main", "getNegotiationProps", pid);

			if (loadingPid.current !== pid) {
				// Must have clicked another button
				return;
			}

			if (typeof newProps === "string") {
				showNotification({
					type: "error",
					text: newProps,
				});
			} else {
				setState({
					status: "loaded",
					props: newProps,
					show: true,
				});
			}
		},
		props,
	};
};
