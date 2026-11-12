// College mode (docs/college-mode.md): New League → College. A short form: level, school, name, season. Everything else is the college preset.
import { useMemo, useState } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { toWorker } from "../../util/toWorker.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { showNotification } from "../../util/showNotification.ts";
import {
	COLLEGE_LEVEL_INFO,
	COLLEGE_LEVELS,
	getCollegeLeagueTeams,
	getCollegeTournamentSize,
	type CollegeLevel,
} from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import type { View } from "../../../common/types.ts";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";

const NewCollegeLeague = (props: View<"newLeague">) => {
	useTitleBar({ title: "New College League", hideNewWindow: true });

	const [level, setLevel] = useState<CollegeLevel>("power");
	const [name, setName] = useState(props.name);
	const [season, setSeason] = useState(String(new Date().getFullYear()));
	const [creating, setCreating] = useState(false);
	const { teams, confs, divs } = useMemo(
		() => getCollegeLeagueTeams(level),
		[level],
	);
	const [school, setSchool] = useState(
		() => safeLocalStorage.getItem("prevCollegeSchool") ?? "Duke",
	);
	const tid = Math.max(
		0,
		teams.findIndex((t) => t.region === school),
	);
	const selected = teams[tid]!;

	const byConf = confs.map((conf) => ({
		conf,
		teams: teams
			.filter((t) => t.cid === conf.cid)
			.sort((a, b) => b.prestige - a.prestige),
	}));

	const create = async () => {
		setCreating(true);
		try {
			safeLocalStorage.setItem("prevCollegeSchool", selected.region);
			const settings = {
				...props.defaultSettings,
				...getCollegeSettings(level),
			};
			const lid = await toWorker("main", "createLeague", {
				name,
				tid,
				file: undefined,
				url: undefined,
				keptKeys: [],
				shuffleRosters: false,
				importLid: undefined,
				getLeagueOptions: undefined,
				startingSeasonFromInput: season,
				confs,
				divs,
				teamsFromInput: teams.map((t) => ({
					tid: t.tid,
					cid: t.cid,
					did: t.did,
					region: t.region,
					name: t.name,
					abbrev: t.abbrev,
					pop: t.pop,
					popRank: 1,
					colors: t.colors,
				})),
				settings: settings as any,
				fromFile: {
					gameAttributes: undefined,
					maxGid: undefined,
					hasRookieContracts: true,
					startingSeason: undefined,
					teams: undefined,
					version: undefined,
				},
				leagueCreationID: "college",
			});
			realtimeUpdate([], `/l/${lid}`);
		} catch (error) {
			setCreating(false);
			console.log(error);
			showNotification({
				type: "error",
				text: error.message,
				persistent: true,
			});
		}
	};

	return (
		<div style={{ maxWidth: 720 }}>
			<p>
				Coach a college program instead of running a pro team. You recruit high
				school players, lose them to graduation, the pros and the transfer
				portal, and play for your conference title and the national tournament.
				There are no contracts, trades, salaries or free agents; everything runs
				automatically unless you want to step in on the Recruiting page.
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<div className="mb-3">
					<label className="form-label" htmlFor="college-name">
						League name
					</label>
					<input
						id="college-name"
						className="form-control"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="mb-3">
					<label className="form-label" htmlFor="college-season">
						Season
					</label>
					<input
						id="college-season"
						className="form-control"
						style={{ maxWidth: 120 }}
						inputMode="numeric"
						value={season}
						onChange={(event) => setSeason(event.target.value)}
					/>
				</div>
				<fieldset className="mb-3">
					<legend className="form-label fs-6">Which schools</legend>
					{COLLEGE_LEVELS.map((key) => {
						const info = COLLEGE_LEVEL_INFO[key];
						const n = getCollegeLeagueTeams(key).teams.length;
						return (
							<div className="form-check" key={key}>
								<input
									className="form-check-input"
									type="radio"
									name="college-level"
									id={`college-level-${key}`}
									checked={level === key}
									onChange={() => setLevel(key)}
								/>
								<label
									className="form-check-label"
									htmlFor={`college-level-${key}`}
								>
									<b>{info.name}</b> ({n} schools, {getCollegeTournamentSize(n)}
									-team tournament)
									<div className="text-body-secondary small">
										{info.description}
									</div>
								</label>
							</div>
						);
					})}
				</fieldset>
				<div className="mb-3">
					<label className="form-label" htmlFor="college-school">
						Your school
					</label>
					<select
						id="college-school"
						className="form-select"
						value={selected.region}
						onChange={(event) => setSchool(event.target.value)}
					>
						{byConf.map(({ conf, teams }) => (
							<optgroup key={conf.cid} label={conf.name}>
								{teams.map((t) => (
									<option key={t.tid} value={t.region}>
										{t.region} (prestige {Math.round(t.prestige)})
									</option>
								))}
							</optgroup>
						))}
					</select>
					<div className="form-text">
						{selected.region} {selected.name}, {selected.conference}. Prestige
						decides who wants to play for you and what is expected of you.
					</div>
				</div>
				<button
					type="submit"
					className="btn btn-primary btn-lg"
					disabled={creating}
				>
					{creating ? "Creating..." : "Create College League"}
				</button>
			</form>
		</div>
	);
};

export default NewCollegeLeague;
