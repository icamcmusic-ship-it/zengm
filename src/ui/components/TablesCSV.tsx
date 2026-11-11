import { useEffect, useState } from "react";
import { Dropdown } from "react-bootstrap";
import { fileSafeName } from "../../common/playerExport.ts";
import { downloadFile } from "../util/downloadFile.ts";
import { findCustomTables, tableLabel, tableToCSV } from "../util/tableCSV.ts";

// The fork's pages with their own (non-DataTable) tables or card lists. On these pages a "Download CSV" menu lists every
// such table that is on screen.
export const NATIVE_CSV_PAGES: ReadonlySet<string> = new Set([
	"archetypes",
	"awardVote",
	"bestGames",
	"coach",
	"coaches",
	"frontOffices",
	"collegeOverseas",
	"contractValue",
	"draftBoard",
	"familyTrees",
	"homeCourt",
	"hype",
	"leagueAchievements",
	"leagueEconomics",
	"milestones",
	"mockDraft",
	"newspaper",
	"pickValue",
	"playerPreDraft",
	"playerTraits",
	"recordsBook",
	"redraft",
	"rivalries",
	"seriesRecaps",
	"skillBadges",
	"staff",
	"storylines",
	"timeline",
	"tradeGrader",
	"tradeMarket",
	"tradeOffers",
	"wrapped",
	"wrappedCompare",
]);

type Found = { label: string; el: Element };

export const TablesCSV = ({
	pageID,
	refreshKey,
}: {
	pageID: string | undefined;
	refreshKey: unknown;
}) => {
	const [tables, setTables] = useState<Found[]>([]);
	const enabled = pageID !== undefined && NATIVE_CSV_PAGES.has(pageID);

	useEffect(() => {
		if (!enabled) {
			setTables([]);
			return;
		}
		const root = document.getElementById("actual-actual-content");
		if (!root) {
			return;
		}
		let timeout: number | undefined;
		const scan = () => {
			const found = findCustomTables(root).map((el, i) => ({
				el,
				label: tableLabel(el, i),
			}));
			setTables((prev) =>
				prev.length === found.length &&
				prev.every(
					(t, i) => t.el === found[i]!.el && t.label === found[i]!.label,
				)
					? prev
					: found,
			);
		};
		scan();
		// Tabs, "show more" and season changes swap tables without a new page load
		const observer = new MutationObserver(() => {
			window.clearTimeout(timeout);
			timeout = window.setTimeout(scan, 300);
		});
		observer.observe(root, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			window.clearTimeout(timeout);
		};
	}, [enabled, refreshKey]);

	if (!enabled || tables.length === 0) {
		return null;
	}

	const download = ({ el, label }: Found) => {
		const page = pageID ?? "table";
		downloadFile(
			`${fileSafeName(`${page} ${label}`)}.csv`,
			tableToCSV(el),
			"text/csv",
		);
	};

	return (
		<div
			className="float-end ms-2 mb-1 position-relative"
			style={{ zIndex: 2 }}
			data-no-csv=""
		>
			<Dropdown align="end">
				<Dropdown.Toggle
					variant="outline-secondary"
					size="sm"
					id="tables-csv"
					title="Download a table on this page as a spreadsheet (CSV)"
				>
					Download CSV
				</Dropdown.Toggle>
				<Dropdown.Menu style={{ maxHeight: "60vh", overflowY: "auto" }}>
					{tables.map((t, i) => (
						<Dropdown.Item key={i} onClick={() => download(t)}>
							{t.label}
						</Dropdown.Item>
					))}
				</Dropdown.Menu>
			</Dropdown>
		</div>
	);
};
