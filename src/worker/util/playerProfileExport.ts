// "Export profile": everything the player's profile pages show (Overview, Game Log, College/Overseas, Traits, Scouting), built from
// the same worker views the pages use, so the hidden information rules are the pages' own: scouted (fuzzed) ratings, hidden
// entirely under the "no visible ratings" challenge (but for retired players), trait readings as the Traits page shows them
// (ranges while unknown, never the hidden scores), the aging curve only once revealed, the scouting report as the user's scouts
// write it. The raw player never leaves the worker. See common/playerProfileExport.ts for the format.
import { PHASE_TEXT, PLAYER } from "../../common/constants.ts";
import { getCols } from "../../common/getCols.ts";
import { COMBINE_ROWS } from "../../common/combineRows.ts";
import {
	exportShowsRatings,
	formatHeight,
	type ExportTable,
} from "../../common/playerExport.ts";
import {
	PROFILE_EXPORT_FORMAT,
	PROFILE_EXPORT_SCHEMA_VERSION,
	PROFILE_SECTIONS,
	playerStatus,
	scrubRatings,
	stripHtml,
	type PlayerProfileExport,
	type ProfileFact,
	type ProfileSection,
	type ProfileSectionKey,
} from "../../common/playerProfileExport.ts";
import {
	TRAIT_CATEGORIES,
	traitStatusText,
} from "../../common/playerTraits/categories.ts";
import { TRAIT_DEFINITIONS } from "../../common/playerTraits/definitions.ts";
import { formatTraitReading } from "../../common/playerTraits/scouting.ts";
import type { Conditions } from "../../common/types.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { league } from "../core/index.ts";
import { getPreDraftAwards, getPreDraftStats } from "../../common/preDraft.ts";
import { featureOn } from "./nativeFeatures.ts";
import {
	getPlayerScoutingPage,
	scoutingExportFromPage,
	scoutingReportsOn,
} from "../core/scoutingReports/index.ts";
import playerView from "../views/player.ts";
import playerGameLogView from "../views/playerGameLog.ts";
import playerPreDraftView from "../views/playerPreDraft.ts";
import playerTraitsView from "../views/playerTraits.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import { getPlayersForExport } from "./playerExport.ts";

const runView = async (
	view: { load: (args: any) => unknown },
	inputs: Record<string, unknown>,
	conditions: Conditions,
): Promise<any> => {
	const out: any = await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: {},
		conditions,
	});
	if (!out || out.errorMessage) {
		return undefined;
	}
	return out;
};

const colTitle = (key: string) => {
	try {
		return getCols([`stat:${key}`])[0]!.title;
	} catch {
		return key;
	}
};

const cell = (value: unknown): string | number => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
	}
	if (value == null) {
		return "";
	}
	return String(value);
};

const money = (thousands: number) =>
	`$${(Math.round(thousands / 10) / 100).toFixed(2)}M`;

const fact = (label: string, value: unknown): ProfileFact[] =>
	value === undefined || value === null || value === ""
		? []
		: [{ label, value: String(value) }];

const section = (
	key: ProfileSectionKey,
	rest: Partial<Omit<ProfileSection, "key" | "title">> = {},
): ProfileSection => ({
	key,
	title: PROFILE_SECTIONS.find((s) => s.key === key)!.label,
	facts: [],
	lines: [],
	tables: [],
	...rest,
});

// Which sections apply to him, for the Export profile dialog (the export itself skips the same ones, with the same reasons)
export const getPlayerProfileExportSections = async (pid: number) => {
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const college = isCollege();
	const reasons: Partial<Record<ProfileSectionKey, string>> = {};
	if (p.tid === PLAYER.UNDRAFTED) {
		reasons.gameLog = "Draft prospect: no games yet.";
		reasons.contract = "Draft prospect: no contract yet.";
	}
	if (p.tid === PLAYER.RETIRED) {
		reasons.contract = "Retired.";
	} else if (college) {
		reasons.contract = "No contracts in college leagues.";
	}
	if (
		__SPORT !== "basketball" ||
		(getPreDraftStats(p).length === 0 &&
			getPreDraftAwards(p).length === 0 &&
			!(featureOn("collegeSeason") && p.collegeSeason?.summary))
	) {
		reasons.preDraft = "No college or overseas stats or honors.";
	}
	if (__SPORT !== "basketball" || !g.get("playerTraits")) {
		reasons.traits =
			__SPORT === "basketball"
				? "Player Traits is turned off."
				: "Player traits are only in Basketball GM.";
	}
	if (!scoutingReportsOn()) {
		reasons.scouting = college
			? "Scouting reports are not in college leagues."
			: __SPORT === "basketball"
				? "Scouting Reports is turned off."
				: "Scouting reports are only in Basketball GM.";
	}
	return PROFILE_SECTIONS.map(({ key, label }) => ({
		key,
		label,
		reason: reasons[key],
	}));
};

export const getPlayerProfileExport = async (
	{
		pid,
		sections: wanted,
	}: {
		pid: number;
		// Default: all of them
		sections?: ProfileSectionKey[];
	},
	conditions: Conditions = {},
): Promise<PlayerProfileExport | undefined> => {
	const pRaw = await idb.merged.players.get(pid);
	if (!pRaw) {
		return undefined;
	}
	const overview = await runView(playerView, { pid }, conditions);
	const [card] = await getPlayersForExport({ pids: [pid] });
	if (!overview || !card) {
		return undefined;
	}
	const p = overview.player;
	const want = new Set<ProfileSectionKey>(
		wanted ?? PROFILE_SECTIONS.map((s) => s.key),
	);
	const tid = pRaw.tid;
	const status = playerStatus(tid, PLAYER);
	const retired = tid === PLAYER.RETIRED;
	const prospect = tid === PLAYER.UNDRAFTED;
	const college = isCollege();
	const challengeNoRatings = !!g.get("challengeNoRatings");
	const showRatings = exportShowsRatings(
		challengeNoRatings,
		tid,
		PLAYER.RETIRED,
	);
	const traitsOn = __SPORT === "basketball" && !!g.get("playerTraits");
	const scoutingOn = scoutingReportsOn();
	const teamInfo = g.get("teamInfoCache");
	const userTid = g.get("userTid");

	const sections: PlayerProfileExport["sections"] = {};
	const skipped: PlayerProfileExport["skipped"] = [];
	const skip = (key: ProfileSectionKey, reason: string) => {
		if (want.has(key)) {
			skipped.push({ key, reason });
		}
	};
	const tablesOf = (name: string) =>
		card.tables.filter((t) => t.section === name);

	// Overview: bio, the current season's ratings and stat line (the PDF draws the card)
	if (want.has("overview")) {
		const draft = p.draft;
		sections.overview = section("overview", {
			facts: [
				...fact("Team", card.team),
				...fact("Position", card.pos),
				...fact("Age", p.age),
				...fact("Born", `${p.born.year}${p.born.loc ? `, ${p.born.loc}` : ""}`),
				...fact("Died", p.diedYear),
				...fact("Height", formatHeight(p.hgt)),
				...fact("Weight", `${p.weight} lbs`),
				...fact("College", p.college),
				...fact(
					"Draft",
					draft.round > 0
						? `${draft.year} round ${draft.round}, pick ${draft.pick}${card.draft.abbrev ? ` (${card.draft.abbrev})` : ""}`
						: draft.year > 0
							? `${draft.year}${prospect ? " (prospect)" : ", undrafted"}`
							: undefined,
				),
				...fact("Experience", retired || prospect ? undefined : p.experience),
				...fact("Jersey", p.jerseyNumber),
				...fact(
					"Contract",
					card.contract
						? `${money(card.contract.amount)}/yr thru ${card.contract.exp}`
						: undefined,
				),
				...fact("Injury", card.injury),
				...fact("Archetype", showRatings ? card.archetype : undefined),
				...fact(
					"Ovr / Pot",
					showRatings && card.ratings
						? `${card.ratings.ovr} / ${card.ratings.pot}`
						: undefined,
				),
				...fact("Skills", showRatings ? card.skills.join(" ") : undefined),
				...fact("Badges", showRatings ? card.badges.join(", ") : undefined),
			],
			lines: [
				...(card.seasonStats
					? [
							`${card.season}: ${Object.entries(card.seasonStats)
								.map(([k, v]) => `${k.toUpperCase()} ${v}`)
								.join(", ")}`,
						]
					: []),
				...(card.careerStats
					? [
							`Career: ${Object.entries(card.careerStats)
								.map(([k, v]) => `${k.toUpperCase()} ${v}`)
								.join(", ")}`,
						]
					: []),
				...(p.note ? [`Note: ${p.note}`] : []),
				...(p.relatives ?? []).map(
					(r: any) => `${r.type[0].toUpperCase()}${r.type.slice(1)}: ${r.name}`,
				),
				...(overview.feats ?? []).map(
					(f: any) => `Feat (${f.season}): ${stripHtml(f.text)}`,
				),
			],
			data: {
				seasonStats: card.seasonStats,
				careerStats: card.careerStats,
				ratings: showRatings ? card.ratings : undefined,
				skills: showRatings ? card.skills : undefined,
				badges: showRatings ? card.badges : undefined,
				archetype:
					showRatings && p.archetype
						? {
								id: p.archetype.id,
								name: p.archetype.name,
								label: p.archetype.label,
								season: p.archetype.season,
							}
						: undefined,
				relatives: p.relatives,
				note: p.note,
				feats: (overview.feats ?? []).map((f: any) => ({
					season: f.season,
					text: stripHtml(f.text),
				})),
				leaders: overview.leaders,
				valueIndex: overview.valueIndex,
				face: card.face,
				imgURL: card.imgURL,
			},
		});
	}

	// Ratings history (scouted)
	if (want.has("ratings")) {
		sections.ratings = showRatings
			? section("ratings", {
					note: retired
						? undefined
						: "As your scouts see them (scouting fuzz), not exact values.",
					facts: card.ratings
						? Object.entries(card.ratings).map(([k, v]) => ({
								label: k.toUpperCase(),
								value: String(v),
							}))
						: [],
					tables: tablesOf("Ratings history"),
					data: {
						current: card.ratings,
						history: p.ratings.map((r: any) => {
							const row: Record<string, unknown> = {};
							for (const key of [
								"season",
								"abbrev",
								"age",
								"pos",
								"ovr",
								"pot",
								...overview.ratings,
								"skills",
								"badges",
							]) {
								row[key] = r[key];
							}
							return row;
						}),
					},
				})
			: section("ratings", {
					note: "Hidden (no visible ratings challenge).",
				});
	}

	// Every stats table of the Overview, regular season and playoffs
	if (want.has("stats")) {
		const tables = tablesOf("Stats");
		sections.stats = section("stats", {
			note: tables.length === 0 ? "No games played yet." : undefined,
			tables,
		});
	}

	// Game Log: his most recent season with games, plus the seasons that have one
	if (want.has("gameLog")) {
		if (prospect) {
			skip("gameLog", "Draft prospect: no games yet.");
		} else {
			const seasons: number[] = Array.from(
				new Set<number>(
					p.stats
						.filter((row: any) => (row.gp ?? 0) > 0)
						.map((row: any) => row.season),
				),
			).sort((a, b) => b - a);
			const season = seasons[0] ?? g.get("season");
			const view = await runView(
				playerGameLogView,
				{ pid, season },
				conditions,
			);
			const games: any[] = view?.gameLog ?? [];
			const stats: string[] = view?.stats ?? [];
			const table: ExportTable | undefined =
				games.length > 0
					? {
							section: "Game log",
							title: `${season} game log`,
							cols: [
								"Gm",
								"Team",
								"Opp",
								"Result",
								...stats.map((s) => colTitle(s)),
							],
							rows: games.map((game, i) => [
								game.playoffs ? `PO ${i + 1}` : i + 1,
								game.abbrev,
								`${game.away ? "@" : "vs"} ${game.oppAbbrev}`,
								game.result,
								...stats.map((s) => cell(game.stats?.[s])),
							]),
						}
					: undefined;
			const won = games.filter((x) => String(x.result).startsWith("W")).length;
			sections.gameLog = section("gameLog", {
				note:
					games.length === 0
						? `No box scores saved for ${season} (old seasons' games are deleted, see League Settings).`
						: undefined,
				facts: [
					...fact("Season", season),
					...fact("Games", games.length),
					...fact(
						"Team record in his games",
						games.length > 0 ? `${won}-${games.length - won}` : undefined,
					),
					...fact(
						"Seasons with stats",
						seasons.length > 0 ? seasons.join(", ") : undefined,
					),
				],
				tables: table ? [table] : [],
				data: {
					season,
					seasonsWithStats: seasons,
					stats,
					games: games.map((game) => ({
						gid: game.gid,
						playoffs: !!game.playoffs,
						away: game.away,
						abbrev: game.abbrev,
						oppAbbrev: game.oppAbbrev,
						result: game.result,
						diff: game.diff,
						stats: game.stats,
						injury: game.injury?.type !== "Healthy" ? game.injury : undefined,
					})),
				},
			});
		}
	}

	// College/Overseas page
	if (want.has("preDraft")) {
		const tables = tablesOf("College/Overseas");
		const view =
			__SPORT === "basketball"
				? await runView(playerPreDraftView, { pid }, conditions)
				: undefined;
		const info = view?.preDraft;
		if (tables.length === 0 && !info) {
			skip("preDraft", "No college or overseas stats or honors.");
		} else {
			sections.preDraft = section("preDraft", {
				facts: [
					...fact("School", p.college),
					...fact("Draft year", info?.draftYear),
					...fact(
						"Drafted",
						info?.draft
							? `${info.draft.overall} overall (round ${info.draft.round}, pick ${info.draft.pick}${info.draft.abbrev ? `, ${info.draft.abbrev}` : ""})`
							: undefined,
					),
					...fact(
						"Projected pick",
						info?.projectedPick !== undefined
							? `${info.projectedPick} of ${info.numPicks}`
							: undefined,
					),
				],
				lines: info?.combine
					? COMBINE_ROWS.filter(
							(row) => typeof info.combine.results?.[row.key] === "number",
						).map((row) => {
							const pct = info.combine.percentiles?.[row.key]?.pct;
							return `Combine, ${row.name.toLowerCase()}: ${row.format(info.combine.results[row.key])}${typeof pct === "number" ? ` (${Math.round(pct)}th percentile)` : ""}`;
						})
					: [],
				tables: [
					...tables,
					...(info?.honors?.length &&
					!tables.some((t) => t.title.startsWith("Honors"))
						? [
								{
									section: "College/Overseas",
									title: "Honors",
									cols: ["Year", "Honor"],
									rows: info.honors.map((h: any) => [h.season, h.type]),
								},
							]
						: []),
				],
				data: info,
			});
		}
	}

	// Traits page: readings (ranges while unknown), what the known ones mean in games, history of the known ones
	if (want.has("traits")) {
		if (!traitsOn) {
			skip(
				"traits",
				__SPORT === "basketball"
					? "Player Traits is turned off."
					: "Player traits are only in Basketball GM.",
			);
		} else {
			const view = await runView(playerTraitsView, { pid }, conditions);
			const pt = view?.playerTraits;
			if (!pt) {
				skip("traits", "No trait readings.");
			} else {
				const readings = pt.traits.map((t: any) => {
					const category = TRAIT_CATEGORIES.find((c) =>
						(c.traits as readonly string[]).includes(t.key),
					);
					return {
						key: t.key,
						name:
							TRAIT_DEFINITIONS[t.key as keyof typeof TRAIT_DEFINITIONS]
								?.name ?? t.key,
						category: category?.name,
						reading: formatTraitReading(t),
						exact: t.exact,
						// Known traits have a number, unknown ones only the scouting range
						...(t.exact ? { score: t.estimate } : { low: t.low, high: t.high }),
						status: traitStatusText(t),
						effect: view.effects?.[t.key],
					};
				});
				const tables: ExportTable[] = [];
				for (const category of TRAIT_CATEGORIES) {
					const rows = readings
						.filter((r: any) => r.category === category.name)
						.map((r: any) => [
							r.name,
							r.reading,
							r.effect ? `${r.status}. In games: ${r.effect}` : r.status,
						]);
					if (category.key === "physical" && pt.agingCurve) {
						rows.push([
							"Aging curve",
							pt.agingCurve.name,
							pt.agingCurve.description,
						]);
					}
					if (rows.length > 0) {
						tables.push({
							section: "Traits",
							title: category.name,
							cols: ["Trait", "Reading", "Status"],
							rows,
						});
					}
				}
				const history: any[] = view.history ?? [];
				const keys: string[] = view.historyKeys ?? [];
				if (history.length > 0 && keys.length > 0) {
					tables.push({
						section: "Traits",
						title: "Known traits by season",
						cols: [
							"Year",
							...keys.map(
								(k) =>
									TRAIT_DEFINITIONS[k as keyof typeof TRAIT_DEFINITIONS]
										?.name ?? k,
							),
						],
						rows: history.map((row) => [
							row.season,
							...keys.map((k) => cell(row.scores?.[k] ?? row[k])),
						]),
					});
				}
				sections.traits = section("traits", {
					note: pt.isProspect
						? "Prospect: readings are scouting estimates."
						: undefined,
					tables,
					data: {
						readings,
						agingCurve: pt.agingCurve
							? {
									name: pt.agingCurve.name,
									description: pt.agingCurve.description,
								}
							: undefined,
						history,
					},
				});
			}
		}
	}

	// Scouting page: the report as the user's scouting department writes it
	let scoutingPage: PlayerProfileExport["scoutingPage"];
	if (want.has("scouting")) {
		if (!scoutingOn) {
			skip(
				"scouting",
				college
					? "Scouting reports are not in college leagues."
					: "Scouting Reports is turned off.",
			);
		} else {
			const page = await getPlayerScoutingPage(pid);
			if (!page) {
				skip("scouting", "No report.");
			} else {
				scoutingPage = scoutingExportFromPage(page, true);
				const { report } = page;
				sections.scouting = section("scouting", {
					facts: [
						...fact("Overall", scoutingPage.overall),
						...fact("Range", report.header.rangeLine),
						...fact("Confidence", report.header.confidence),
						...fact("By", scoutingPage.byline),
						...fact("Archetype", report.header.archetype),
					],
					lines: [report.bottomLine],
					tables: [
						{
							section: "Scouting",
							title: "Grades",
							cols: ["Category", "Grade", "Note"],
							rows: scoutingPage.grades.map((x) => [
								x.sub ? `  ${x.label}` : x.label,
								x.text,
								x.line,
							]),
						},
					],
					data: {
						report: {
							...report,
							// Internal: the takes are summarized by the grades above
							take: undefined,
							secondTake: undefined,
						},
						changelog: page.changelog,
						comparison: page.comparison,
						track: page.track,
						department: {
							quality: page.dept.quality,
							scouts: page.dept.scouts.map((s) => ({
								id: s.id,
								name: s.name,
								title: s.title,
								specialty: s.specialtyName,
								bias: s.biasName,
							})),
						},
					},
				});
			}
		}
	}

	// Awards and honors (Overview), retired jerseys
	if (want.has("awards")) {
		const awards = (p.awards ?? []).map((a: any) => ({
			season: a.season,
			type: `${a.groupPrefix ? `${a.groupPrefix} ` : ""}${a.type}`,
		}));
		const honors = p.earlierHonors ?? [];
		const jerseys = (overview.jerseyNumberInfos ?? []).map((j: any) => ({
			number: j.number,
			team: j.t ? `${j.t.region} ${j.t.name}` : "",
			start: j.start,
			end: j.end,
			retired: j.retiredIndex >= 0,
		}));
		sections.awards = section("awards", {
			note: awards.length + honors.length === 0 ? "No awards yet." : undefined,
			facts: [
				...fact("Awards", awards.length || undefined),
				...fact(
					"Hall of Fame",
					awards.some((a: any) => a.type === "Inducted into the Hall of Fame")
						? "Yes"
						: undefined,
				),
			],
			tables: [
				...(awards.length > 0
					? [
							{
								section: "Awards",
								title: "Awards",
								cols: ["Year", "Award"],
								rows: awards.map((a: any) => [a.season, a.type]),
							},
						]
					: []),
				...(honors.length > 0
					? [
							{
								section: "Awards",
								title: "Honors before the draft",
								cols: ["Year", "Honor"],
								rows: honors.map((h: any) => [h.season, h.type]),
							},
						]
					: []),
				...(jerseys.length > 0
					? [
							{
								section: "Awards",
								title: "Jersey numbers",
								cols: ["Number", "Team", "Seasons", "Retired"],
								rows: jerseys.map((j: any) => [
									j.number,
									j.team,
									j.start === j.end ? j.start : `${j.start}-${j.end}`,
									j.retired ? "Retired" : "",
								]),
							},
						]
					: []),
			],
			data: { awards, earlierHonors: honors, jerseyNumbers: jerseys },
		});
	}

	// Contract and mood (not for retired players, prospects or college leagues, like the Overview)
	if (want.has("contract")) {
		if (retired) {
			skip("contract", "Retired.");
		} else if (college) {
			skip("contract", "No contracts in college leagues.");
		} else if (prospect) {
			skip("contract", "Draft prospect: no contract yet.");
		} else {
			const mood = p.mood?.user;
			const salaries: any[] = p.salaries ?? [];
			sections.contract = section("contract", {
				facts: [
					...fact(
						tid === PLAYER.FREE_AGENT ? "Asking for" : "Contract",
						p.contract
							? `${money(Math.round(p.contract.amount * 1000))}/yr thru ${p.contract.exp}`
							: undefined,
					),
					...fact(
						"Willing to sign with you",
						tid === PLAYER.FREE_AGENT || tid === userTid
							? overview.willingToSign
								? "Yes"
								: "No"
							: undefined,
					),
					...fact(
						tid === userTid ? "Chance to re-sign" : "Chance he'd sign with you",
						mood ? `${Math.round(mood.probWilling * 100)}%` : undefined,
					),
					...fact(
						"Mood traits",
						mood?.traits?.length ? mood.traits.join(", ") : undefined,
					),
					...fact(
						"Career earnings",
						p.salariesTotal
							? money(Math.round(p.salariesTotal * 1000))
							: undefined,
					),
				],
				tables: [
					...(mood
						? [
								{
									section: "Contract",
									title: "Mood (toward your team)",
									cols: ["Component", "Value"],
									rows: Object.entries(mood.components ?? {})
										.filter(([, v]) => typeof v === "number" && v !== 0)
										.map(([k, v]) => [
											`${k[0]!.toUpperCase()}${k
												.slice(1)
												.replaceAll(/([A-Z])/g, " $1")
												.toLowerCase()}`,
											cell(v),
										]),
								},
							]
						: []),
					...(salaries.length > 0
						? [
								{
									section: "Contract",
									title: "Salaries",
									cols: ["Season", "Amount"],
									rows: salaries.map((s) => [
										s.season,
										money(Math.round(s.amount * 1000)),
									]),
								},
							]
						: []),
				].filter((t) => t.rows.length > 0),
				data: {
					contract: card.contract,
					salaries,
					salariesTotal: p.salariesTotal,
					mood: mood
						? {
								components: mood.components,
								traits: mood.traits,
								probWilling: mood.probWilling,
								willing: mood.willing,
								contractAmount: mood.contractAmount,
							}
						: undefined,
					willingToSign: overview.willingToSign,
					valueIndex: overview.valueIndex,
				},
			});
		}
	}

	// Transactions (draft, signings, trades, releases) from the Overview
	if (want.has("transactions")) {
		const events = (overview.events ?? []).map((e: any) => ({
			season: e.season,
			text: stripHtml(e.text),
		}));
		sections.transactions = section("transactions", {
			note: events.length === 0 ? "No transactions yet." : undefined,
			tables:
				events.length > 0
					? [
							{
								section: "Transactions",
								title: "Transactions",
								cols: ["Year", "Event"],
								rows: events.map((e: any) => [e.season, e.text]),
							},
						]
					: [],
			data: { events },
		});
	}

	// Injuries: current, history, the injury depth state
	if (want.has("injuries")) {
		const injuries: any[] = p.injuries ?? [];
		const health = p.healthInfo;
		sections.injuries = section("injuries", {
			note: injuries.length === 0 ? "No injuries." : undefined,
			facts: [
				...fact("Current", card.injury ?? "Healthy"),
				...fact("Injury prone", health?.injuryProne ? "Yes" : undefined),
				...fact(
					"Minutes restriction",
					health?.restrictGames
						? `${health.restrictGames} games (${Math.round(health.restrictionFactor * 100)}% of normal)`
						: undefined,
				),
			],
			tables: [
				...(injuries.length > 0
					? [
							{
								section: "Injuries",
								title: "Injury history",
								cols: ["Year", "Injury", "Games"],
								rows: injuries.map((i) => [i.season, i.type, i.games]),
							},
						]
					: []),
				...(health?.byBodyPart?.length
					? [
							{
								section: "Injuries",
								title: "By body part",
								cols: ["Body part", "Injuries", "Games", "Last"],
								rows: health.byBodyPart.map((b: any) => [
									b.bodyPart,
									b.count,
									b.games,
									b.lastSeason,
								]),
							},
						]
					: []),
			],
			data: { current: p.injury, history: injuries, health },
		});
	}

	// Under the no visible ratings challenge, nothing taken from the pages carries ratings (league leader in a rating, the
	// College/Overseas comparisons), like the pages hide them
	if (!showRatings) {
		for (const s of Object.values(sections)) {
			s.data = scrubRatings(s.data);
		}
	}

	const userTeam = teamInfo[userTid];
	const phase = g.get("phase");
	return {
		format: PROFILE_EXPORT_FORMAT,
		schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		generator: `${__SPORT === "basketball" ? "Basketball" : __SPORT} GM`,
		league: {
			lid: g.get("lid"),
			name: (await league.getName()) || `League ${g.get("lid")}`,
			sport: __SPORT,
			season: g.get("season"),
			phase,
			phaseName: (PHASE_TEXT as Record<number, string>)[phase] ?? String(phase),
			college,
			startingSeason: g.get("startingSeason"),
			userTeam: userTeam
				? {
						tid: userTid,
						abbrev: userTeam.abbrev,
						name: `${userTeam.region} ${userTeam.name}`,
					}
				: undefined,
		},
		visibility: {
			ratingsShown: showRatings,
			challengeNoRatings,
			playerTraits: traitsOn,
			scoutingReports: scoutingOn,
			note: showRatings
				? "Ratings, traits and scouting grades are as your scouts see them (not exact values), like the player pages."
				: "Ratings are hidden (no visible ratings challenge), like the player pages.",
		},
		player: {
			pid,
			name: p.name,
			status,
			tid,
			team: card.team,
			abbrev: card.abbrev,
			pos: card.pos,
			age: p.age,
			born: p.born,
			diedYear: p.diedYear,
			hgt: p.hgt,
			height: formatHeight(p.hgt),
			weight: p.weight,
			college: p.college || undefined,
			draft: card.draft,
			jerseyNumber: p.jerseyNumber,
			experience: p.experience,
		},
		skipped,
		sections,
		card: { ...card, tables: [], scouting: undefined },
		scoutingPage,
	};
};
