// Staff Report digests (an inbox message before the draft and before free agency) and the frozen history of past reports.

import { PHASE } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import league from "../league/index.ts";
import { getStaffReport } from "./report.ts";
import {
	devBand,
	getBudgetRecs,
	getSeasonScorecard,
	getStaffHistory,
} from "./scorecard.ts";
import { userControls } from "./coaching.ts";
import {
	getContractAmount,
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import type { StaffReportHistoryEntry } from "../../../common/types.ts";

const MAX_HISTORY = 30;

type Report = NonNullable<Awaited<ReturnType<typeof getStaffReport>>>;

const recsOf = (report: Report) => {
	const out: { area: string; text: string }[] = [];
	const add = (
		area: string,
		rec: { id: string; title: string; text: string } | undefined,
	) => {
		if (rec && rec.id !== "none" && rec.title) {
			out.push({
				area,
				text: `${rec.title}${rec.text ? `: ${rec.text}` : ""}`,
			});
		}
	};
	add("Scouting", report.scouting?.rec);
	add("Development", report.development?.rec);
	add("Roster fit", report.fit.rec);
	add("Conditioning", report.conditioning.rec);
	return out;
};

const escape = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const saveEntry = async (entry: StaffReportHistoryEntry) => {
	const history = getStaffHistory().filter(
		(x) => !(x.season === entry.season && x.tid === entry.tid),
	);
	const prev = getStaffHistory().find(
		(x) => x.season === entry.season && x.tid === entry.tid,
	);
	await league.setGameAttributes({
		staffReportHistory: [
			...history,
			{ ...entry, digests: entry.digests ?? prev?.digests },
		]
			.sort((a, b) => a.season - b.season || a.tid - b.tid)
			.slice(-MAX_HISTORY),
	});
};

// After the playoffs: the season's report, frozen for the History tab
export const freezeStaffReport = async () => {
	const tid = g.get("userTid");
	const report = await getStaffReport();
	if (!report) {
		return;
	}
	const scorecard = await getSeasonScorecard(tid, g.get("season"));
	await saveEntry({
		season: g.get("season"),
		tid,
		scorecard,
		recommendations: recsOf(report),
	});
};

const markDigest = async (kind: string) => {
	const season = g.get("season");
	const tid = g.get("userTid");
	const history = getStaffHistory();
	const entry = history.find((x) => x.season === season && x.tid === tid);
	if (entry?.digests?.includes(kind)) {
		return false;
	}
	await saveEntry({
		season,
		tid,
		scorecard: entry?.scorecard,
		recommendations: entry?.recommendations ?? [],
		digests: [...(entry?.digests ?? []), kind],
	});
	return true;
};

const send = async (subject: string, html: string) => {
	await idb.cache.messages.add({
		read: false,
		from: "Your Staff",
		year: g.get("season"),
		text: html,
		subject,
		tid: g.get("userTid"),
	});
};

const reportLink = () =>
	`<a href="${helpers.leagueUrl(["staff_report"])}">Staff Report</a>`;

// Before the draft (the draft lottery phase): the board's top prospects, your picks, needs and the open recommendations
export const draftDigest = async () => {
	const tid = g.get("userTid");
	if (!userControls(tid) || !(await markDigest("draft"))) {
		return;
	}
	const report = await getStaffReport();
	if (!report) {
		return;
	}
	const season = g.get("season");
	const picks = (
		await idb.cache.draftPicks.indexGetAll("draftPicksByTid", tid)
	).filter((dp) => dp.season === season);
	const parts: string[] = [
		`<p>Here is where things stand before the ${season} draft. You have ${picks.length === 0 ? "no picks" : picks.length === 1 ? "1 pick" : `${picks.length} picks`} this year.</p>`,
	];
	const tops = report.scouting?.tops.slice(0, 5) ?? [];
	if (tops.length > 0) {
		parts.push(
			`<p><b>Top of our board:</b></p><ol>${tops.map((x) => `<li><a href="${helpers.leagueUrl(["player", x.pid])}">${escape(x.name)}</a> (${x.pos}, ${escape(x.region)}, ${x.looks} ${x.looks === 1 ? "look" : "looks"})</li>`).join("")}</ol>`,
		);
	}
	parts.push(
		`<p><b>Biggest need:</b> ${escape(report.fit.weakest.name)} (${escape(report.fit.weakest.band.toLowerCase())})${report.fit.needs.length > 0 ? `; positions: ${report.fit.needs.join(", ").toLowerCase()}` : ""}.</p>`,
	);
	const recs = recsOf(report);
	if (recs.length > 0) {
		parts.push(
			`<p><b>Open recommendations:</b></p><ul>${recs.map((r) => `<li>${escape(r.area)}: ${escape(r.text)}</li>`).join("")}</ul>`,
		);
	}
	parts.push(
		`<p>The full report is on the ${reportLink()} page, and the board on the <a href="${helpers.leagueUrl(["draft_board"])}">Draft Board</a>.</p>`,
	);
	await send(`Pre-draft digest (${season})`, parts.join(""));
};

// Before free agency (re-signing phase): expiring contracts, cap room, pro scouting's free agent targets, budget notes
export const freeAgencyDigest = async () => {
	const tid = g.get("userTid");
	if (!userControls(tid) || !(await markDigest("freeAgency"))) {
		return;
	}
	const report = await getStaffReport();
	if (!report) {
		return;
	}
	const season = g.get("season");
	const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
	const contractOf = (p: (typeof roster)[number]) => getCurrentContract(p);
	const expiring = roster.filter((p) => {
		const c = contractOf(p);
		return !c || getContractExp(c) <= season;
	});
	// What next season's roster is already owed
	const payroll = roster.reduce((sum, p) => {
		const c = contractOf(p);
		return sum + (c ? (getContractAmount(c, season + 1) ?? 0) : 0);
	}, 0);
	const cap = g.get("salaryCap");
	const parts: string[] = [
		`<p>Free agency opens after re-signings. ${expiring.length === 0 ? "None of your contracts expire." : `Expiring: ${expiring.map((p) => `<a href="${helpers.leagueUrl(["player", p.pid])}">${escape(`${p.firstName} ${p.lastName}`)}</a>`).join(", ")}.`}</p>`,
		`<p>Committed salary for next season: ${helpers.formatCurrency(payroll / 1000, "M")} against a cap of ${helpers.formatCurrency(cap / 1000, "M")}${g.get("salaryCapType") === "none" ? " (no cap)" : ""}.</p>`,
		`<p><b>Biggest need:</b> ${escape(report.fit.weakest.name)}${report.fit.needs.length > 0 ? ` (${report.fit.needs.join(", ").toLowerCase()})` : ""}.</p>`,
	];
	const scorecard = await getSeasonScorecard(tid, season);
	const budget = await getBudgetRecs(tid, scorecard);
	if (budget.length > 0) {
		parts.push(
			`<p><b>Budget:</b></p><ul>${budget.map((b) => `<li>${escape(b.title)}. ${escape(b.text)}</li>`).join("")}</ul><p>Budget items are set on the <a href="${helpers.leagueUrl(["team_finances"])}">Finances</a> page.</p>`,
		);
	}
	const band = g.get("challengeNoRatings") ? devBand(scorecard) : undefined;
	if (band) {
		parts.push(`<p>Development this season: ${band.toLowerCase()}.</p>`);
	}
	parts.push(
		`<p>Targets and the full scorecard are on the ${reportLink()} and <a href="${helpers.leagueUrl(["pro_scouting"])}">Pro Scouting</a> pages.</p>`,
	);
	await send(`Pre-free agency digest (${season})`, parts.join(""));
};

export const staffDigestsAfterNewPhase = async (phase: number) => {
	if (phase === PHASE.DRAFT_LOTTERY) {
		await freezeStaffReport();
		await draftDigest();
	} else if (phase === PHASE.RESIGN_PLAYERS) {
		await freeAgencyDigest();
	}
};
