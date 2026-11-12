// College mode: the awards of a college league (docs/college-mode.md, Awards). They are ordinary award settings (Award Settings page), so
// the awards, history and player pages show them like any other award: national Player of the Year, Defensive Player of the Year, Freshman
// of the Year, the All-American teams, the conference players of the year and all-conference teams (group "conf"), and the championship
// game's Most Outstanding Player. Coach of the Year is chosen separately (college/awards.ts in the worker). Formulas are the pro ones scaled
// to a 30-game season.
import type {
	AwardSettingIndividual,
	AwardSettingTeam,
	AwardSettings,
} from "../types.ts";

const POY_FORMULA =
	"ewa / 8 + vorp / 12 + min(ws/max(teamWs,ws),0.8) / 10 + seasonFraction * winp";
const DEF_FORMULA =
	"dws/1.15 + seasonFraction * winp + seasonFraction * (blk / 4.1 + stl / 1.8)";

export const COLLEGE_AWARDS: AwardSettings = [
	{
		shortName: "POY",
		name: "Player of the Year",
		formula: POY_FORMULA,
		showStats: "offense",
		actAs: "mvp",
	} as AwardSettingIndividual,
	{
		shortName: "DPOY",
		name: "Defensive Player of the Year",
		formula: DEF_FORMULA,
		showStats: "defense",
	} as AwardSettingIndividual,
	{
		shortName: "FOY",
		name: "Freshman of the Year",
		formula: "ewa / 0.8 + vorp / 0.37 + seasonFraction * pts / 2",
		showStats: "offense",
		rookie: true,
		actAs: "roy",
	} as AwardSettingIndividual,
	{
		shortName: "MOP",
		name: "Most Outstanding Player",
		formula: "gmsc * (1 + 0.75*won)",
		showStats: "offense",
		statRange: -1,
	} as AwardSettingIndividual,
	{
		shortName: "CPOY",
		name: "Player of the Year",
		formula: POY_FORMULA,
		showStats: "offense",
		group: "conf",
	} as AwardSettingIndividual,
	{
		shortName: "AA",
		name: "All-American",
		formula: POY_FORMULA,
		showStats: "offense",
		numTeams: 3,
	} as AwardSettingTeam,
	{
		shortName: "ALC",
		name: "All-Conference",
		formula: POY_FORMULA,
		showStats: "offense",
		group: "conf",
		numTeams: 2,
	} as AwardSettingTeam,
	{
		shortName: "AF",
		name: "All-Freshman",
		formula: "ewa / 0.8 + vorp / 0.37 + seasonFraction * pts / 2",
		showStats: "offense",
		rookie: true,
		numTeams: 1,
	} as AwardSettingTeam,
];

// A college league made before the college awards (v1) still has the pro awards: use the college ones
export const getCollegeAwardSettings = (awards: AwardSettings) =>
	awards.some(
		(award) =>
			award.shortName === "MVP" && award.name === "Most Valuable Player",
	)
		? COLLEGE_AWARDS
		: awards;
