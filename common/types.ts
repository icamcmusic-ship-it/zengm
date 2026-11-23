// This file is needed because the zod types are imported in both the node and web projects

import * as z from "zod";

const awardPlayerSchema = z.object({
	pid: z.number(),
	tid: z.number(),
	statOverrides: z
		.object({
			score: z.number(),
		})
		.catchall(z.union([z.number(), z.string()]))
		.optional(),
});

export type AwardPlayer = z.infer<typeof awardPlayerSchema>;

const awardInfoCommonSchema = z.object({
	shortName: z.string(),
	name: z.string(),
	formula: z.string(),
	formulaByPos: z.record(z.string(), z.string()).optional(),

	// undefined means regularSeason, number is index of finals where -1 is finals, -2 is semifinals, etc
	statRange: z
		.union([z.literal("playoffs"), z.literal("combined"), z.number()])
		.optional(),

	// undefined means league
	group: z
		.discriminatedUnion("type", [
			z.object({
				type: z.literal("conf"),
				cid: z.number(),
			}),
			z.object({
				type: z.literal("div"),
				did: z.number(),
			}),
			z.object({
				type: z.literal("playoffSeries"),
				tids: z.tuple([z.number(), z.number()]).readonly(),
			}),
		])
		.optional(),

	// What stats to show on Award Races and Season Summary?
	// Would be tricky to explicitly specify stats because (1) those 2 pages show different stuff; (2) it'd be very verbose; and (3) it'd be tricky to support playoff series awards where different stats are available
	showStats: z.enum([
		// baseball - defense would be nice, but don't want to deal with the arrays, and not actually needed in default awards
		"overall",
		"sp",
		"rp",
		"offense",
		"defense",
		// basketball
		"offense",
		"defense",
		// football
		"overall",
		"defense",
		"blocking",
		// hockey
		"overall",
		"defense",
		"goalkeeping",
	]),

	// Stat columns chosen by the user for Award Races, Award History and the season's History page, in order (Award Settings, or the
	// Columns menu on those pages). Missing or empty: the key stats picked automatically from the formula. Unknown keys are dropped
	// when shown (worker/core/awards/keyStats.ts)
	statCols: z.array(z.string()).optional(),

	// Filters
	bench: z.literal(true).optional(),
	mip: z.literal(true).optional(),
	rookie: z.literal(true).optional(),

	// Only given with Advanced Tracking Stats on (basketball)
	advStats: z.literal(true).optional(),
});

const awardInfoIndividualCommonSchema = z.object({
	numTeams: z.undefined().optional(),

	// Treat as "MVP" or "ROY" in UI and for FBGM OPOY
	actAs: z.enum(["mvp", "roy"]).optional(),
});

// How a team award's teams are filled by position (basketball): "none" positionless (best scores), "oneGuard" at least one true
// guard (PG, SG, G) per team, "gfc" 2 guards, 2 forwards and a center per team. Not set: an All-Defensive award follows the league's
// old Perimeter Defense option (perimeterDefenseAllDefensive), any other team award is positionless.
export const TEAM_SELECTIONS = ["none", "oneGuard", "gfc"] as const;
export type TeamSelection = (typeof TEAM_SELECTIONS)[number];

export const isTeamSelection = (value: unknown): value is TeamSelection =>
	(TEAM_SELECTIONS as readonly unknown[]).includes(value);

// An All-Defensive style team award (the default abbrev, or a team award showing defense stats)
export const isAllDefensiveAward = (award: {
	numTeams?: number;
	shortName: string;
	showStats: string;
}) =>
	award.numTeams !== undefined &&
	(award.shortName === "DEF" || award.showStats === "defense");

// Write the league-wide All-Defensive rule (the old perimeterDefenseAllDefensive option) into the All-Defensive awards that don't
// have their own teamSelection, so the rule travels with the awards when they are exported or imported
export const withAllDefensiveTeamSelection = <
	T extends {
		numTeams?: number;
		shortName: string;
		showStats: string;
		teamSelection?: TeamSelection;
	},
>(
	awards: T[],
	legacy: unknown,
): T[] => {
	if (!isTeamSelection(legacy)) {
		return awards;
	}
	return awards.map((award) =>
		award.teamSelection === undefined && isAllDefensiveAward(award)
			? { ...award, teamSelection: legacy }
			: award,
	);
};

const awardInfoTeamCommonSchema = z.object({
	numTeams: z.number().gte(1),
	teamSelection: z.enum(TEAM_SELECTIONS).optional(),
});

const awardInfoIndividualSchema = awardInfoCommonSchema
	.extend(awardInfoIndividualCommonSchema.shape)
	.extend({
		// Individual award - top 5 are saved, although we may have fewer slots than that in an upgraded league
		winner: z.array(
			z.union([
				awardPlayerSchema.extend({
					opoyOverride: z.literal(true).optional(),
				}),
				awardPlayerSchema.extend({
					pid: z.undefined().optional(),
					tid: z.undefined().optional(),
				}),
			]),
		),

		// Special QB stuff for OPOY award - not in Common because we don't need to persist this in Player objects, we only need it here for state (GameAttributesLeague) and history (Awards)
		opoyFormula: z.string().optional(),
	});

const awardInfoTeamSchema = awardInfoCommonSchema
	.extend(awardInfoTeamCommonSchema.shape)
	.extend({
		// Team award
		winner: z.array(
			z.array(
				z.union([
					awardPlayerSchema.extend({
						// pos is defined if TEAM_AWARD_INFO.byPos
						pos: z.string().optional(),
					}),

					// This would be if it can't find enough players at one position - either an empty object, or one containg only pos if TEAM_AWARD_INFO.byPos
					awardPlayerSchema.extend({
						pid: z.undefined().optional(),
						tid: z.undefined().optional(),
						pos: z.string().optional(),
					}),
				]),
			),
		),
	});

const awardSettingIndividualSchema = awardInfoIndividualSchema
	.omit({
		group: true,
		winner: true,
	})
	.extend({
		group: z.enum(["conf", "div"]).optional(),
	});

const awardSettingTeamSchema = awardInfoTeamSchema
	.omit({
		group: true,
		winner: true,
	})
	.extend({
		group: z.enum(["conf", "div"]).optional(),
	});

export const awardSettingsSchema = z
	.array(z.union([awardSettingIndividualSchema, awardSettingTeamSchema]))
	.superRefine((awards, ctx) => {
		const seen = new Set<string>();

		for (const [i, award] of awards.entries()) {
			const { shortName } = award;

			const addIssue = (message: string) => {
				ctx.addIssue({
					code: "custom",
					path: [i],
					message,
				});
			};

			if (seen.has(shortName)) {
				addIssue("Duplicate abbrev - award abbrevs must be unique");
			}
			if (award.numTeams !== undefined && typeof award.statRange === "number") {
				addIssue("Playoff series awards cannot be individual awards");
			}
			if (award.mip && typeof award.statRange === "number") {
				addIssue("Playoff series awards cannot be Most Improved Player awards");
			}
			if (award.numTeams === undefined && award.opoyFormula !== undefined) {
				const banWith = ["actAs", "rookie", "bench", "mip"] as const;
				for (const key of banWith) {
					if (award[key]) {
						addIssue(`opoyFormula and ${key} cannot both be defined`);
					}
				}
			}

			seen.add(shortName);
		}
	});

export type AwardInfoCommon = z.infer<typeof awardInfoCommonSchema>;
export type AwardInfoIndividual = z.infer<typeof awardInfoIndividualSchema>;
export type AwardInfoTeam = z.infer<typeof awardInfoTeamSchema>;
export type AwardSettingIndividual = z.infer<
	typeof awardSettingIndividualSchema
>;
export type AwardSettingTeam = z.infer<typeof awardSettingTeamSchema>;
export type AwardSettings = z.infer<typeof awardSettingsSchema>;

const playerAwardBuiltInBaseSchema = z.object({
	season: z.number(),
	type: z.undefined().optional(),
	name: z.string(),
	shortName: z.string(),
	index: z.number(), // Index in the list of awards for this season - this is just used in the UI some places for sorting
	rank: z.number(), // rank in individual award, team number in team award
	group: z
		.discriminatedUnion("type", [
			z.object({
				type: z.literal("conf"),
				cid: z.number(),
			}),
			z.object({
				type: z.literal("div"),
				did: z.number(),
			}),
		])
		.optional(),
});

const playerAwardBuiltInSchema = z.union([
	playerAwardBuiltInBaseSchema.extend(awardInfoIndividualCommonSchema.shape),
	playerAwardBuiltInBaseSchema.extend(awardInfoTeamCommonSchema.shape),
]);

const playerAwardSimpleSchema = z.object({
	season: z.number(),
	type: z.string(),
});

export const playerAwardSchema = z.union([
	playerAwardSimpleSchema,
	playerAwardBuiltInSchema,
]);

export type PlayerAwardBuiltIn = z.infer<typeof playerAwardBuiltInSchema>;
export type PlayerAwardSimple = z.infer<typeof playerAwardSimpleSchema>;
export type PlayerAward = z.infer<typeof playerAwardSchema>;

const awardSchema = z.union([awardInfoIndividualSchema, awardInfoTeamSchema]);

export const awardsSchema = z.object({
	season: z.number(),
	bestRecord: z.number(), // tid

	bestRecordConfs: z.record(z.number(), z.number()), // <cid, tid>
	bestRecordDivs: z.record(z.number(), z.number()), // <did, tid>

	awards: z.array(awardSchema),

	// League extras (Award Vote): the simulated media vote saved when the awards were given, see src/common/awardVote
	simVote: z
		.array(
			z.object({
				shortName: z.string(),
				name: z.string(),
				kind: z.enum(["mvp", "player", "team"]),
				voters: z.number(),
				points: z.array(z.number()),
				places: z.array(z.string()),
				rows: z.array(
					z.object({
						pid: z.number(),
						tid: z.number(),
						name: z.string(),
						rank: z.number(),
						votes: z.array(z.number()),
						first: z.number(),
						pts: z.number(),
						share: z.number(),
						narratives: z.array(z.string()),
						tm: z.number().optional(),
					}),
				),
			}),
		)
		.optional(),

	// Hall of Fame (src/worker/core/hallOfFame): this season's ballot (League Extras "Hall of Fame Ballot"), veterans committee class
	// and coaches and executives wing inductees
	hof: z
		.object({
			voters: z.number().optional(),
			ballot: z
				.array(
					z.object({
						pid: z.number(),
						name: z.string(),
						tid: z.number(),
						retiredYear: z.number(),
						year: z.number(),
						pct: z.number(),
						score: z.number(),
						threshold: z.number(),
						result: z.enum(["inducted", "dropped", "expired"]).optional(),
					}),
				)
				.optional(),
			veterans: z
				.array(
					z.object({
						pid: z.number(),
						name: z.string(),
						tid: z.number(),
						retiredYear: z.number(),
						score: z.number(),
						threshold: z.number(),
					}),
				)
				.optional(),
			wing: z
				.array(
					z.object({
						kind: z.enum(["coach", "gm"]),
						id: z.number(),
						name: z.string(),
						tid: z.number(),
						line: z.string(),
					}),
				)
				.optional(),
		})
		.optional(),

	// College Hall of Fame (college leagues, src/worker/core/hallOfFame/college.ts): this season's class, the coaches inducted and how
	// many candidates there were
	collegeHof: z
		.object({
			classSize: z.number(),
			candidates: z.number(),
			players: z.array(
				z.object({
					pid: z.number(),
					name: z.string(),
					tids: z.array(z.number()),
					firstSeason: z.number().optional(),
					lastSeason: z.number().optional(),
					exit: z.string().optional(),
					score: z.number(),
					line: z.string(),
				}),
			),
			coaches: z.array(
				z.object({
					cid: z.number(),
					name: z.string(),
					tid: z.number(),
					score: z.number(),
					line: z.string(),
				}),
			),
		})
		.optional(),
});

export type Award = z.infer<typeof awardSchema>;
export type Awards = z.infer<typeof awardsSchema>;
