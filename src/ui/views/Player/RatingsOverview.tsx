import { FATIGUE_POS } from "../../../common/constants.football.ts";
import { posRatings } from "../../../common/posRatings.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { ratingsGradientStyle } from "../../components/RatingsStatsPopover/ratingsGradientStyle.ts";
import { RatingWithChange } from "../../components/RatingWithChange.tsx";
import { Fragment, type ReactNode, useState } from "react";
import { subsOfBase } from "../../../common/subRatings.ts";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";

const SUBS_OPEN_KEY = "playerSubRatingsOpen";

export const RatingsOverview = ({
	ratings,
	season,
}: {
	ratings: any[];
	season?: number;
}) => {
	let currentSeason;
	if (season === undefined) {
		// Use latest season
		currentSeason = ratings.at(-1);
	} else {
		currentSeason =
			ratings.findLast((row) => row.season === season) ?? ratings.at(-1);
	}

	const lastSeason =
		ratings.findLast((row) => row.season === currentSeason.season - 1) ??
		currentSeason;

	// Expanded ratings (the expandedRatings setting): wingspan with the physical ratings, and the two defense ratings in place of
	// defensive IQ (their average)
	const expanded =
		typeof currentSeason.wng === "number" &&
		typeof currentSeason.pdef === "number";
	// Second step: catch-and-shoot/off-the-dribble after the jump shooting ratings, ball security after dribbling, and offensive/defensive
	// rebounding in place of rebounding (their average)
	// Sub-ratings (the subRatings setting): the base ratings, each expanding to show its sub-ratings. The expanded ratings that the subs
	// cover (the defense, rebounding and shooting splits, ball security) are shown through the subs.
	const hasSub = Array.isArray(currentSeason.sub);
	const expanded2 =
		expanded && typeof currentSeason.oreb === "number" && !hasSub;
	const lastSub: number[] | undefined = Array.isArray(lastSeason.sub)
		? lastSeason.sub
		: undefined;

	// Which bases are expanded: all of them (the header toggle, remembered) or one at a time (clicking a rating)
	const [allOpen, setAllOpen] = useState(
		() => safeLocalStorage.getItem(SUBS_OPEN_KEY) === "1",
	);
	const [open, setOpen] = useState<Set<string>>(() => new Set());
	const isOpen = (rating: string) => allOpen || open.has(rating);
	const toggle = (rating: string) => {
		setOpen((prev) => {
			const next = new Set(prev);
			if (next.has(rating)) {
				next.delete(rating);
			} else {
				next.add(rating);
			}
			return next;
		});
	};

	const columns = bySport<
		Record<
			string,
			{
				label: ReactNode;
				rating: string;
			}[]
		>[]
	>({
		baseball: [
			{
				Physical: [
					{
						label: "Height",
						rating: "hgt",
					},
					{
						label: "Speed",
						rating: "spd",
					},
				],
				Hitting: [
					{
						label: "Power",
						rating: "hpw",
					},
					{
						label: "Contact",
						rating: "con",
					},
					{
						label: "Eye",
						rating: "eye",
					},
				],
			},
			{
				Defense: [
					{
						label: "Ground Balls",
						rating: "gnd",
					},
					{
						label: "Fly Balls",
						rating: "fly",
					},
					{
						label: "Throwing",
						rating: "thr",
					},
					{
						label: "Catcher",
						rating: "cat",
					},
				],
			},
			{
				Pitching: [
					{
						label: "Power",
						rating: "ppw",
					},
					{
						label: "Control",
						rating: "ctl",
					},
					{
						label: "Movement",
						rating: "mov",
					},
					{
						label: "Endurance",
						rating: "endu",
					},
				],
			},
		],
		basketball: [
			{
				Physical: [
					{
						label: "Height",
						rating: "hgt",
					},
					...(expanded
						? [
								{
									label: "Wingspan",
									rating: "wng",
								},
							]
						: []),
					{
						label: "Strength",
						rating: "stre",
					},
					{
						label: "Speed",
						rating: "spd",
					},
					{
						label: "Jumping",
						rating: "jmp",
					},
					{
						label: "Endurance",
						rating: "endu",
					},
				],
			},
			{
				Shooting: [
					{
						label: "Inside",
						rating: "ins",
					},
					{
						label: (
							<>
								<span className="d-md-none">Layups</span>
								<span className="d-none d-md-inline">Dunks/Layups</span>
							</>
						),
						rating: "dnk",
					},
					{
						label: (
							<>
								<span className="d-md-none">FT</span>
								<span className="d-none d-md-inline">Free Throws</span>
							</>
						),
						rating: "ft",
					},
					{
						label: "Mid Range",
						rating: "fg",
					},
					{
						label: (
							<>
								<span className="d-md-none">3</span>
								<span className="d-none d-md-inline">Three</span> Pointers
							</>
						),
						rating: "tp",
					},
					...(expanded2
						? [
								{
									label: (
										<>
											<span className="d-md-none">C&amp;S</span>
											<span className="d-none d-md-inline">
												Catch &amp; Shoot
											</span>
										</>
									),
									rating: "csh",
								},
								{
									label: (
										<>
											<span className="d-md-none">Off Drb</span>
											<span className="d-none d-md-inline">Off Dribble</span>
										</>
									),
									rating: "dsh",
								},
							]
						: []),
				],
			},
			{
				Skill: [
					{
						label: (
							<>
								<span className="d-md-none">Off</span>
								<span className="d-none d-md-inline">Offensive</span> IQ
							</>
						),
						rating: "oiq",
					},
					...(expanded && !hasSub
						? [
								{
									label: (
										<>
											<span className="d-md-none">Per</span>
											<span className="d-none d-md-inline">Perimeter</span> D
										</>
									),
									rating: "pdef",
								},
								{
									label: (
										<>
											<span className="d-md-none">Int</span>
											<span className="d-none d-md-inline">Interior</span> D
										</>
									),
									rating: "idef",
								},
							]
						: [
								{
									label: hasSub ? (
										"Defense"
									) : (
										<>
											<span className="d-md-none">Def</span>
											<span className="d-none d-md-inline">Defensive</span> IQ
										</>
									),
									rating: "diq",
								},
							]),
					{
						label: "Dribbling",
						rating: "drb",
					},
					...(expanded2
						? [
								{
									label: (
										<>
											<span className="d-md-none">Ball Sec</span>
											<span className="d-none d-md-inline">Ball Security</span>
										</>
									),
									rating: "bsc",
								},
							]
						: []),
					{
						label: "Passing",
						rating: "pss",
					},
					...(expanded2
						? [
								{
									label: (
										<>
											<span className="d-md-none">O Reb</span>
											<span className="d-none d-md-inline">Off Rebounding</span>
										</>
									),
									rating: "oreb",
								},
								{
									label: (
										<>
											<span className="d-md-none">D Reb</span>
											<span className="d-none d-md-inline">Def Rebounding</span>
										</>
									),
									rating: "dreb",
								},
							]
						: [
								{
									label: (
										<>
											<span className="d-md-none">Reb</span>
											<span className="d-none d-md-inline">Rebounding</span>
										</>
									),
									rating: "reb",
								},
							]),
				],
			},
		],
		football: [
			{
				Physical: [
					{
						label: "Height",
						rating: "hgt",
					},
					{
						label: "Strength",
						rating: "stre",
					},
					{
						label: "Speed",
						rating: "spd",
					},
					{
						label: "Endurance",
						rating: "endu",
					},
				],
				Blocking: [
					{
						label: (
							<>
								Pass <span className="d-md-none">Block</span>
								<span className="d-none d-md-inline">Blocking</span>
							</>
						),
						rating: "pbk",
					},
					{
						label: (
							<>
								Run <span className="d-md-none">Block</span>
								<span className="d-none d-md-inline">Blocking</span>
							</>
						),
						rating: "rbk",
					},
				],
			},
			{
				Passing: [
					{
						label: "Vision",
						rating: "thv",
					},
					{
						label: "Power",
						rating: "thp",
					},
					{
						label: "Accuracy",
						rating: "tha",
					},
				],
				Defense: [
					{
						label: (
							<>
								Pass <span className="d-md-none">Cover</span>
								<span className="d-none d-md-inline">Coverage</span>
							</>
						),
						rating: "pcv",
					},
					{
						label: "Tackling",
						rating: "tck",
					},
					{
						label: (
							<>
								Pass <span className="d-md-none">Rush</span>
								<span className="d-none d-md-inline">Rushing</span>
							</>
						),
						rating: "prs",
					},
					{
						label: (
							<>
								Run <span className="d-md-none">Stop</span>
								<span className="d-none d-md-inline">Stopping</span>
							</>
						),
						rating: "rns",
					},
				],
			},
			{
				"Rushing/Receiving": [
					{
						label: (
							<>
								<span className="d-md-none">Elusive</span>
								<span className="d-none d-md-inline">Elusiveness</span>
							</>
						),
						rating: "elu",
					},
					{
						label: (
							<>
								<span className="d-md-none">Routes</span>
								<span className="d-none d-md-inline">Route Running</span>
							</>
						),
						rating: "rtr",
					},
					{
						label: "Hands",
						rating: "hnd",
					},
					{
						label: (
							<>
								Ball <span className="d-md-none">Sec</span>
								<span className="d-none d-md-inline">Security</span>
							</>
						),
						rating: "bsc",
					},
				],
				Kicking: [
					{
						label: (
							<>
								Kick <span className="d-md-none">Pow</span>
								<span className="d-none d-md-inline">Power</span>
							</>
						),
						rating: "kpw",
					},
					{
						label: (
							<>
								Kick <span className="d-md-none">Acc</span>
								<span className="d-none d-md-inline">Accuracy</span>
							</>
						),
						rating: "kac",
					},
					{
						label: (
							<>
								Punt <span className="d-md-none">Pow</span>
								<span className="d-none d-md-inline">Power</span>
							</>
						),
						rating: "ppw",
					},
					{
						label: (
							<>
								Punt <span className="d-md-none">Acc</span>
								<span className="d-none d-md-inline">Accuracy</span>
							</>
						),
						rating: "pac",
					},
				],
			},
		],
		hockey: [
			{
				Physical: [
					{
						label: "Height",
						rating: "hgt",
					},
					{
						label: "Strength",
						rating: "stre",
					},
					{
						label: "Speed",
						rating: "spd",
					},
					{
						label: "Endurance",
						rating: "endu",
					},
				],
			},
			{
				Offense: [
					{
						label: (
							<>
								<span className="d-md-none">Off</span>
								<span className="d-none d-md-inline">Offensive</span> IQ
							</>
						),
						rating: "oiq",
					},
					{
						label: "Passing",
						rating: "pss",
					},
					{
						label: "Wristshot",
						rating: "wst",
					},
					{
						label: "Slapshot",
						rating: "sst",
					},
					{
						label: (
							<>
								<span className="d-md-none">Stickhndl</span>
								<span className="d-none d-md-inline">Stickhandling</span>
							</>
						),
						rating: "stk",
					},
				],
			},
			{
				Defense: [
					{
						label: (
							<>
								<span className="d-md-none">Def</span>
								<span className="d-none d-md-inline">Defensive</span> IQ
							</>
						),
						rating: "diq",
					},
					{
						label: "Checking",
						rating: "chk",
					},
					{
						label: (
							<>
								<span className="d-none d-md-inline">Shot </span>
								Blocking
							</>
						),
						rating: "blk",
					},
					{
						label: "Faceoffs",
						rating: "fcf",
					},
					{
						label: (
							<>
								<span className="d-md-none">Goalie</span>
								<span className="d-none d-md-inline">Goalkeeping</span>
							</>
						),
						rating: "glk",
					},
				],
			},
		],
	});

	// Generic physical ratings not included in posRatings
	const toHighlightPhysical = bySport({
		baseball:
			currentSeason.pos === "SP" || currentSeason.pos === "RP"
				? []
				: ["hgt", "spd"],
		basketball: [],
		football: FATIGUE_POS.has(currentSeason.pos)
			? ["hgt", "stre", "spd", "endu"]
			: ["hgt", "stre", "spd"],
		hockey: currentSeason.pos === "G" ? [] : ["hgt", "stre", "spd", "endu"],
	});

	// For non-basketball sports, only highlight ratings that are relevant to position
	const toHighlight = new Set([
		...toHighlightPhysical,
		...posRatings(currentSeason.pos),
	]);

	return (
		<div className="ratings-overview">
			<div className="d-flex justify-content-between">
				<h2 className="me-3">
					Overall:{" "}
					<RatingWithChange change={currentSeason.ovr - lastSeason.ovr}>
						{currentSeason.ovr}
					</RatingWithChange>
				</h2>
				<h2>
					Potential:{" "}
					<RatingWithChange change={currentSeason.pot - lastSeason.pot}>
						{currentSeason.pot}
					</RatingWithChange>
				</h2>
			</div>
			{hasSub ? (
				<div className="small mb-1">
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => {
							const next = !allOpen;
							setAllOpen(next);
							setOpen(new Set());
							safeLocalStorage.setItem(SUBS_OPEN_KEY, next ? "1" : "0");
						}}
					>
						{allOpen ? "Hide sub-ratings" : "Show sub-ratings"}
					</button>
				</div>
			) : null}
			<div className="d-flex justify-content-between">
				{columns.map((column, i) => (
					<div key={i} className={i === 0 ? undefined : "ms-2 ms-sm-5"}>
						{Object.entries(column).map(([name, categories], j) => (
							<div key={name} className={j === 0 ? undefined : "mt-2"}>
								<div className="fw-bold">
									{name}
									<div
										className="ratings-overview-title-underline"
										style={{
											height: 2,
											width: "100%",
											marginTop: -4,
										}}
									/>
								</div>
								<table>
									<tbody>
										{categories.map(({ label, rating }, j) => {
											const highlightStyle = toHighlight.has(rating)
												? ratingsGradientStyle(currentSeason[rating])
												: undefined;
											const current = currentSeason[rating];
											const paddingTop = { paddingTop: 2 };
											const subs = hasSub ? subsOfBase(rating) : [];
											const canOpen = subs.length > 0;
											const opened = canOpen && isOpen(rating);
											return (
												<Fragment key={j}>
													<tr>
														<td className="px-0 pb-0" style={paddingTop}>
															<div className="flex-grow-1">
																<div className="d-flex">
																	{canOpen ? (
																		<span
																			className="sub-ratings-toggle"
																			role="button"
																			tabIndex={0}
																			title="Show sub-ratings"
																			onClick={() => toggle(rating)}
																			onKeyDown={(event) => {
																				if (
																					event.key === "Enter" ||
																					event.key === " "
																				) {
																					event.preventDefault();
																					toggle(rating);
																				}
																			}}
																		>
																			{label}
																			<span className="text-body-secondary">
																				{opened ? " ▾" : " ▸"}
																			</span>
																			:&nbsp;
																		</span>
																	) : (
																		<span>{label}:&nbsp;</span>
																	)}
																	<span className="ms-auto">{current}</span>
																</div>
																<div
																	style={{
																		...highlightStyle,
																		height: 2,
																		width: `${current < 50 ? 100 - current : current}%`,
																		marginTop: -4,
																	}}
																/>
															</div>
														</td>
														<td className="px-0 pb-0 ps-1" style={paddingTop}>
															<RatingWithChange
																change={current - lastSeason[rating]}
															/>
														</td>
													</tr>
													{opened
														? subs.map(({ i, def }) => {
																const v = currentSeason.sub[i];
																return (
																	<tr key={def.key} className="small">
																		<td className="px-0 pb-0 ps-1 ps-md-2">
																			<div
																				className="d-flex text-body-secondary"
																				title={def.description}
																			>
																				<span>
																					<span className="d-md-none">
																						{def.label}
																					</span>
																					<span className="d-none d-md-inline">
																						{def.name}
																					</span>
																					:&nbsp;
																				</span>
																				<span className="ms-auto">{v}</span>
																			</div>
																		</td>
																		<td className="px-0 pb-0 ps-1">
																			{lastSub ? (
																				<RatingWithChange
																					change={v - lastSub[i]!}
																				/>
																			) : null}
																		</td>
																	</tr>
																);
															})
														: null}
												</Fragment>
											);
										})}
									</tbody>
								</table>
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
};
