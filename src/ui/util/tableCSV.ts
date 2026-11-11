// "Download CSV" for the fork's custom tables (not DataTable, which has its own "Download spreadsheet"). Reads the rendered
// table, so the file has exactly what the user sees: scouting fuzz, hidden traits and the no-ratings challenge are already
// applied by the page. See docs/native-features.md#downloads.
import { rectangularize, toCSV } from "../../common/playerExport.ts";

const isHidden = (el: Element) =>
	typeof (el as HTMLElement).getClientRects === "function" &&
	el.isConnected &&
	// jsdom has no layout: treat everything as visible there
	typeof navigator !== "undefined" &&
	!/jsdom/i.test(navigator.userAgent) &&
	el.getClientRects().length === 0;

// Text of a cell as shown: words of separate elements (name, then skill badges) get a space between them, a <select> gives
// its chosen option, buttons and hidden elements are left out
const collectText = (node: Node, parts: string[]) => {
	if (node.nodeType === 3) {
		parts.push(node.textContent ?? "");
		return;
	}
	if (node.nodeType !== 1) {
		return;
	}
	const el = node as Element;
	if (
		el.tagName === "BUTTON" ||
		el.tagName === "SCRIPT" ||
		el.tagName === "STYLE" ||
		isHidden(el)
	) {
		return;
	}
	if (el.tagName === "SELECT") {
		const select = el as HTMLSelectElement;
		parts.push(" ", select.selectedOptions[0]?.text ?? select.value, " ");
		return;
	}
	if (el.tagName === "INPUT") {
		const input = el as HTMLInputElement;
		if (
			input.type !== "checkbox" &&
			input.type !== "radio" &&
			input.type !== "hidden"
		) {
			parts.push(" ", input.value, " ");
		}
		return;
	}
	parts.push(" ");
	for (const child of Array.from(el.childNodes)) {
		collectText(child, parts);
	}
	parts.push(" ");
};

export const cellText = (el: Element) => {
	const explicit = el.getAttribute("data-csv");
	if (explicit !== null) {
		return explicit;
	}
	const parts: string[] = [];
	for (const child of Array.from(el.childNodes)) {
		collectText(child, parts);
	}
	return parts.join("").replaceAll(/\s+/g, " ").trim();
};

// Rows of a <table>, or of a card list marked up with data-csv-table / data-csv-row / data-csv-cell
export const tableToRows = (table: Element): string[][] => {
	const rows: string[][] = [];
	if (table.tagName === "TABLE") {
		for (const tr of Array.from((table as HTMLTableElement).rows)) {
			if (isHidden(tr) || tr.closest("[data-no-csv]")) {
				continue;
			}
			const row: string[] = [];
			for (const cell of Array.from(tr.cells)) {
				if (isHidden(cell)) {
					continue;
				}
				row.push(cellText(cell));
				const span = Number(cell.getAttribute("colspan") ?? 1);
				for (let i = 1; i < span; i++) {
					row.push("");
				}
			}
			if (row.some((value) => value !== "")) {
				rows.push(row);
			}
		}
	} else {
		// Card lists: data-csv-cols='["Season", ...]' on the container, and on each item either data-csv-row='[values]' or
		// data-csv-cell children
		const cols = table.getAttribute("data-csv-cols");
		if (cols) {
			rows.push(JSON.parse(cols));
		}
		for (const rowEl of Array.from(table.querySelectorAll("[data-csv-row]"))) {
			const values = rowEl.getAttribute("data-csv-row");
			rows.push(
				values
					? (JSON.parse(values) as unknown[]).map((v) => String(v ?? ""))
					: Array.from(rowEl.querySelectorAll("[data-csv-cell]")).map(cellText),
			);
		}
	}
	return rectangularize(rows);
};

export const tableToCSV = (table: Element) => toCSV(tableToRows(table));

// A name for the file and the menu: data-csv-name, the caption, or the closest heading before it
export const tableLabel = (table: Element, index: number) => {
	const named = table.getAttribute("data-csv-name");
	if (named) {
		return named;
	}
	const caption = table.querySelector("caption");
	if (caption?.textContent?.trim()) {
		return caption.textContent.trim();
	}
	let el: Element | null = table;
	while (el && el.id !== "actual-actual-content") {
		let prev = el.previousElementSibling;
		while (prev) {
			const heading = prev.matches("h1,h2,h3,h4,h5,.card-header")
				? prev
				: prev.querySelector("h1,h2,h3,h4,h5,.card-header");
			if (heading?.textContent?.trim()) {
				return heading.textContent.trim().slice(0, 60);
			}
			prev = prev.previousElementSibling;
		}
		el = el.parentElement;
	}
	return `Table ${index + 1}`;
};

// Custom tables in the page (DataTables and tables opted out with data-no-csv are skipped)
export const findCustomTables = (root: Element) =>
	Array.from(root.querySelectorAll("table, [data-csv-table]")).filter(
		(el) =>
			!el.hasAttribute("data-datatable") &&
			!el.closest("[data-no-csv]") &&
			!el.closest(".modal") &&
			!el.parentElement?.closest("table") &&
			tableToRows(el).length > 1,
	);
