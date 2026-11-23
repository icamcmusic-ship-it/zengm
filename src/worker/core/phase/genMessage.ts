import { league } from "../index.ts";
import { idb } from "../../db/index.ts";
import g from "../../util/g.ts";
import helpers from "../../util/helpers.ts";
import local from "../../util/local.ts";
import type { OwnerMood } from "../../../common/types.ts";
import { COURT } from "../../../common/constants.ts";
import { isCollege } from "../college/isCollege.ts";
import { getFiringRule } from "../ownerOffice/owner.ts";
import { OWNER_REQUESTS } from "../../../common/ownerProfile.ts";

const moodTexts = ["Horrible!", "Bad.", "Pretty good.", "Good.", "Excellent!"];

const getMoodScore = (total: number, deltas: boolean = false) => {
	if (total >= (deltas ? 0.5 : 2)) {
		return 4;
	}

	if (total >= (deltas ? 0.25 : 1)) {
		return 3;
	}

	if (total >= 0) {
		return 2;
	}

	if (total > (deltas ? -0.25 : -0.5)) {
		return 1;
	}

	return 0;
};

export const genMessage = async (
	deltas: OwnerMood,
	cappedDeltas: OwnerMood,
) => {
	// If auto play seasons or multi team mode, no messages - keep in sync with updateOwnerMood
	if (
		local.autoPlayUntil ||
		g.get("spectator") ||
		g.get("userTids").length > 1
	) {
		return;
	}

	// No need for seasons before you GMed this team or more than 10 years old, but also make sure we always have g.get("season")
	const minSeason = Math.min(
		g.get("season"),
		Math.max(g.get("gracePeriodEnd") - 2, g.get("season") - 9),
	);
	const teamSeasons = await idb.merged.teamSeasons.getAll({
		tid: g.get("userTid"),
		seasons: [minSeason, g.get("season")],
	});
	const moods = teamSeasons.map((ts) => {
		return (
			ts.ownerMood ?? {
				money: 0,
				playoffs: 0,
				wins: 0,
			}
		);
	});

	let m = "";
	let fired = false;

	// Check for some challenge modes that can result in being fired
	if (g.get("challengeFiredLuxuryTax")) {
		const latestSeason = teamSeasons.at(-1);
		if (latestSeason && latestSeason.expenses.luxuryTax > 0) {
			m +=
				'<p>You paid the luxury tax with the "You\'re fired if you pay the luxury tax" challenge mode enabled!</p>';
			fired = true;
		}
	}
	if (g.get("challengeFiredMissPlayoffs")) {
		const latestSeason = teamSeasons.at(-1);
		if (latestSeason && latestSeason.playoffRoundsWon < 0) {
			m +=
				'<p>You missed the playoffs with the "You\'re fired if you miss the playoffs" challenge mode enabled!</p>';
			fired = true;
		}
	}

	// Owner's Office: the owner's patience sets the firing line (stock: -1) and, for a very patient owner, an extra season before he can
	// fire you (common/ownerProfile.ts)
	const firingRule = await getFiringRule();
	const canFire =
		g.get("season") >= g.get("gracePeriodEnd") + firingRule.graceBonus &&
		!g.get("godMode");

	// If challenge mode didn't trigger a firing, do normal stuff
	if (!fired) {
		const currentMood = moods.at(-1) ?? {
			money: 0,
			playoffs: 0,
			wins: 0,
		};
		const currentTotal =
			currentMood.wins + currentMood.playoffs + currentMood.money;
		fired = currentTotal <= firingRule.line && canFire;

		if (!fired) {
			let overall;

			if (g.get("season") < g.get("gracePeriodEnd")) {
				overall = "It's too early to judge you.";
			} else if (g.get("godMode")) {
				overall = "You're using God Mode, so who cares what I think?";
			} else {
				overall = moodTexts[getMoodScore(currentTotal)];
			}

			const deltasTotal = deltas.wins + deltas.playoffs + deltas.money;
			const deltasMoodScore = getMoodScore(deltasTotal, true);
			const cappedDeltasTotal =
				cappedDeltas.wins + cappedDeltas.playoffs + cappedDeltas.money;
			const cappedDeltasMoodScore = getMoodScore(cappedDeltasTotal, true); // Average the capped and uncapped scores, unless perfect

			const avgMoodScore =
				currentTotal >= 2.99
					? deltasMoodScore
					: Math.round((deltasMoodScore + cappedDeltasMoodScore) / 2);
			const thisYear = moodTexts[avgMoodScore];
			let text;

			if (currentTotal >= 0) {
				if (deltas.playoffs >= 0 && deltas.wins >= 0) {
					if (deltas.money < 0) {
						text = `Keep it up on the ${COURT}, but I need more money.`;
					} else {
						text = "Keep it up.";
					}
				} else {
					text = "Hopefully you'll win some more games next season.";

					if (deltas.money < 0) {
						text += " And try to make some more money too!";
					}
				}
			} else if (
				deltas.playoffs >= 0 &&
				deltas.wins >= 0 &&
				deltas.money >= 0
			) {
				text = "Keep it up.";
			} else if (deltas.playoffs < 0 && deltas.money < 0) {
				text = "Somehow you need to win more and make more money.";
			} else if (deltas.playoffs < 0) {
				text = "Win some more games next season.";
			} else if (deltas.money < 0) {
				text = "Be careful about losing too much money.";
			}

			if (g.get("season") >= g.get("gracePeriodEnd")) {
				if (
					currentTotal + deltas.money + deltas.playoffs + deltas.wins <
					firingRule.line
				) {
					text = "Another season like that and you're fired!";
				} else if (
					currentTotal + 2 * (deltas.money + deltas.playoffs + deltas.wins) <
					firingRule.line
				) {
					text = "A couple more seasons like that and you're fired!";
				}
			}

			m += `<p>This year: ${thisYear}</p><p>Overall: ${overall}</p>`;

			if (text) {
				m += `<p>${text}</p>`;
			}

			// Owner's Office: the budget meeting's goals (set in updateOwnerMood, never in college, which judges against the program's
			// expectations instead)
			const goalsResult = teamSeasons.at(-1)?.ownerGoals;
			if (goalsResult?.result && !isCollege()) {
				const r = goalsResult.result;
				const hit = (ok: boolean) => (ok ? "met" : "missed");
				const parts = [
					`wins ${hit(r.won >= goalsResult.winTarget)} (${r.won} of ${goalsResult.winTarget})`,
					`payroll ceiling ${hit(r.payroll <= goalsResult.maxPayroll)} (season payroll ${helpers.formatCurrency(r.payroll / 1000, "M")} vs ${helpers.formatCurrency(goalsResult.maxPayroll / 1000, "M")})`,
				];
				if (g.get("budget")) {
					parts.push(
						`profit target ${hit(r.profit >= goalsResult.profitTarget)} (${helpers.formatCurrency(r.profit, "M")} not counting project payments, vs ${helpers.formatCurrency(goalsResult.profitTarget, "M")})`,
					);
				}
				m += `<p>Budget meeting goals: ${parts.join(", ")}.</p>`;
			}

			// Owner's Office: how the owner's mid-season requests, ultimatums and mandates were settled
			const requests = teamSeasons.at(-1)?.ownerSeason?.requests ?? [];
			if (requests.length > 0 && !isCollege()) {
				const items = requests.map(
					(r) =>
						`${OWNER_REQUESTS[r.kind].title}: ${r.status === "met" ? "done" : r.status}${r.note ? ` (${r.note})` : ""}`,
				);
				m += `<p>My requests this season: ${items.join("; ")}. Details are on the <a href="${helpers.leagueUrl(["owner"])}">Owner</a> page.</p>`;
			}

			const prob = helpers.bound(currentTotal, 0, 3) / 3;
			const otherTeamsWantToHire = Math.random() < prob;

			await league.setGameAttributes({
				otherTeamsWantToHire,
			});
		} else {
			// Fired!
			if (
				currentMood.wins < 0 &&
				currentMood.playoffs < 0 &&
				currentMood.money < 0
			) {
				m += "<p>You've been an all-around disappointment. You're fired.</p>";
			} else if (
				currentMood.money < 0 &&
				currentMood.wins >= 0 &&
				currentMood.playoffs >= 0
			) {
				m +=
					"<p>You've won some games, but you're just not making me enough profit. It's not all about wins and losses, dollars matter too. You're fired.</p>";
			} else if (
				currentMood.money >= 0 &&
				currentMood.wins < 0 &&
				currentMood.playoffs < 0
			) {
				m += `<p>I like that you've made a nice profit for me, but you're not putting a competitive team on the ${COURT}. We need a new direction. You're fired.</p>`;
			} else {
				m += "<p>You're fired.</p>";
			}
		}
	}

	if (fired) {
		m += `<p>I hear a few other teams are looking for a new GM. <a href="${helpers.leagueUrl(
			["new_team"],
		)}">Take a look.</a> Please, go run one of those teams into the ground.</p>`;
		await league.setGameAttributes({
			gameOver: true,
		});
	}

	await idb.cache.messages.add({
		read: false,
		from: "The Owner",
		year: g.get("season"),
		text: m,
		subject: "Annual performance evaluation",
		tid: g.get("userTid"),
		ownerMoods: moods,
		ownerMoodSeasons: teamSeasons.map((ts) => ts.season),
	});
};
