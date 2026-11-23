import { tabHostPageID } from "../../util/pageTabs.ts";
import clsx from "clsx";
import {
	Fragment,
	memo,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { helpers } from "../../util/helpers.ts";
import { localActions, useLocal } from "../../util/local.ts";
import { useFeatureSwitches } from "../../util/nativeFeatures.ts";
import type {
	MenuItemLink,
	MenuItemHeader,
	MenuItemText,
} from "../../../common/types.ts";
import CollapseArrow from "../CollapseArrow.tsx";
import { AnimatePresence, m } from "framer-motion";
import { VIDEO_ADS, VIDEO_AD_PADDING } from "../../../common/constants.ts";
import { menuItems, menuLinkKey, nowShortcuts } from "../../util/menuItems.tsx";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";
import {
	commandPaletteLinkAvailable,
	matchesMenuFilter,
	menuLinkAvailable,
} from "../../util/menuFilter.ts";
import {
	addRecent,
	BADGE_PATHS,
	formatBadgeCount,
	isGroupCollapsed,
	MAX_RECENT,
	readFavorites,
	readRecent,
	type RecentPage,
	type SidebarBadgeKey,
	toggleFavorite,
	writeGroupCollapsed,
} from "../../util/sidebarExtras.ts";
import useSidebarBadges from "../../hooks/useSidebarBadges.ts";

export const getText = (
	text: MenuItemLink["text"],
): Exclude<ReactNode, null | undefined | number | boolean> => {
	if (typeof text === "object" && "side" in text) {
		return text.side;
	}

	return text;
};

const MenuGroup = ({
	children,
	collapsedByDefault = false,
	containsActive = false,
	title,
}: {
	children: ReactNode;
	collapsedByDefault?: boolean;
	// Holds the page being viewed: opened, so the highlighted item is never hidden in a collapsed group
	containsActive?: boolean;
	title?: string;
}) => {
	const [open, setOpen] = useState(
		() =>
			title === undefined ||
			containsActive ||
			!isGroupCollapsed(title, collapsedByDefault),
	);
	useEffect(() => {
		if (containsActive) {
			setOpen(true);
		}
	}, [containsActive]);
	const id = useId();

	return (
		<>
			{title ? (
				<button
					className="btn sidebar-heading"
					aria-expanded={open}
					aria-controls={id}
					onClick={(event) => {
						event.preventDefault();
						const newOpen = !open;
						writeGroupCollapsed(title, !newOpen);
						setOpen(newOpen);
					}}
				>
					<CollapseArrow open={open} /> {title}
				</button>
			) : null}
			<AnimatePresence initial={false}>
				{open ? (
					<m.ul
						className="nav flex-column flex-nowrap overflow-hidden"
						id={id}
						initial="collapsed"
						animate="open"
						exit="collapsed"
						variants={{
							open: { opacity: 1, height: "auto" },
							collapsed: { opacity: 0, height: 0 },
						}}
						transition={{
							duration: 0.3,
							type: "tween",
						}}
					>
						{children}
					</m.ul>
				) : null}
			</AnimatePresence>
		</>
	);
};

export const makeAnchorProps = (
	menuItem: MenuItemLink,
	onMenuItemClick: () => void,
	closeBeforeOnClickResolves?: boolean,
): {
	onClick: () => void;
	href?: string;
	target?: string;
} => {
	let href;
	let target;

	if (typeof menuItem.path === "string") {
		href = menuItem.path;

		if (menuItem.path.startsWith("http")) {
			target = "_blank";
		}
	} else if (menuItem.path !== undefined) {
		href = helpers.leagueUrl(menuItem.path);
	}

	const onClick = async () => {
		if (menuItem.onClick) {
			if (closeBeforeOnClickResolves) {
				onMenuItemClick();
			}

			// Don't close menu if response is false
			const response = await menuItem.onClick();

			if (response !== false && !closeBeforeOnClickResolves) {
				onMenuItemClick();
			}
		} else {
			onMenuItemClick();
		}
	};

	return {
		onClick,
		href,
		target,
	};
};

type VisibilityContext = {
	godMode: boolean;
	lid?: number;
	leagueType: string | undefined;
};

const menuContext = ({ godMode, lid, leagueType }: VisibilityContext) => ({
	godMode,
	inLeague: lid !== undefined,
	leagueType,
});

// Whether a link is shown in the side menu (same rules as the command palette, util/menuFilter.ts). Non-reactive
// (League extras switches are read from the local state), so SideBar re-renders on a switch change with
// useFeatureSwitches
export const sideMenuLinkVisible = (
	menuItem: MenuItemLink,
	context: VisibilityContext,
) =>
	!menuItem.commandPaletteOnly &&
	menuLinkAvailable(menuItem, menuContext(context));

const visibleSideMenuLinks = (context: VisibilityContext) => {
	const links: MenuItemLink[] = [];
	for (const item of menuItems) {
		if (item.type === "link") {
			if (sideMenuLinkVisible(item, context)) {
				links.push(item);
			}
		} else if (
			!item.commandPaletteOnly &&
			(context.lid === undefined ? item.nonLeague : item.league)
		) {
			for (const child of item.children) {
				if (child.type === "link" && sideMenuLinkVisible(child, context)) {
					links.push(child);
				}
			}
		}
	}
	return links;
};

// Page the side menu highlights: the page itself when it has a visible item of its own (like Rumors or League
// Extras), otherwise the host page it is a tab of (util/pageTabs.ts), so exactly one place lights up
export const sideMenuHighlightPageID = (
	pageID: string | undefined,
	pathname: string | undefined,
	context: VisibilityContext,
) => {
	const own = visibleSideMenuLinks(context).some((link) =>
		link.active?.(pageID, pathname),
	);
	return own ? pageID : (tabHostPageID(pageID) ?? pageID);
};

// Badge of a side menu link (News Feed, Trade Offers, Newspaper), if it has new items
const badgeKeyOf = (menuItem: MenuItemLink): SidebarBadgeKey | undefined =>
	Array.isArray(menuItem.path) && typeof menuItem.path[0] === "string"
		? BADGE_PATHS[menuItem.path[0]]
		: undefined;

// The page a visit is recorded as in "Recently visited": a side menu page of its own (not the dashboard), with its label
export const recentPageFor = (
	pageID: string | undefined,
	pathname: string | undefined,
	context: VisibilityContext,
): RecentPage | undefined => {
	if (!pathname || !pageID || pageID === "leagueDashboard") {
		return;
	}
	const link = visibleSideMenuLinks(context).find((link2) =>
		link2.active?.(pageID, pathname),
	);
	const label = link ? getText(link.text) : undefined;
	if (typeof label !== "string") {
		return;
	}
	return { path: pathname, label };
};

// Side menu links (not the command palette ones) by key, with their group, for Favorites
const sideLinks = new Map<string, { group: string; link: MenuItemLink }>();
const textCounts = new Map<unknown, number>();
for (const item of menuItems) {
	if (item.commandPaletteOnly) {
		continue;
	}
	const group = item.type === "header" ? item.long : "";
	for (const link of item.type === "header" ? item.children : [item]) {
		if (link.type === "link" && !link.commandPaletteOnly) {
			const key = menuLinkKey(link);
			if (key !== undefined && !sideLinks.has(key)) {
				sideLinks.set(key, { group, link });
			}
			const text = getText(link.text);
			textCounts.set(text, (textCounts.get(text) ?? 0) + 1);
		}
	}
}

// Label of a link outside its group (Favorites, Now): "Finances" is in League and Team, so it says which one
export const shortcutLabel = (link: MenuItemLink, group?: string) => {
	const text = getText(link.text);
	if (typeof text === "string" && (textCounts.get(text) ?? 0) > 1) {
		const group2 =
			group ??
			menuItems.find(
				(item): item is MenuItemHeader =>
					item.type === "header" && item.children.includes(link),
			)?.long;
		if (group2) {
			return `${group2} ${text}`;
		}
	}
	return text;
};

// Pinned links that are shown here, in the order they were pinned
export const visibleFavorites = (
	favorites: readonly string[],
	context: VisibilityContext,
) =>
	favorites.flatMap((key) => {
		const entry = sideLinks.get(key);
		return entry && sideMenuLinkVisible(entry.link, context)
			? [{ ...entry, key }]
			: [];
	});

// Links of the "Now" group in this phase that are available here
export const visibleNowShortcuts = (
	phase: Parameters<typeof nowShortcuts>[0],
	context: VisibilityContext,
) =>
	context.lid === undefined
		? []
		: nowShortcuts(phase).filter((link) =>
				menuLinkAvailable(link, menuContext(context)),
			);

// Links matching the filter box, by group (the command palette's links and the side menu's)
export const filterMenuLinks = (query: string, context: VisibilityContext) => {
	const groups: { category: string; links: MenuItemLink[] }[] = [];
	const seen = new Set<string>();
	for (const item of menuItems) {
		const category = item.type === "header" ? item.long : "";
		const links: MenuItemLink[] = [];
		for (const link of item.type === "header" ? item.children : [item]) {
			if (link.type !== "link") {
				continue;
			}
			const available =
				commandPaletteLinkAvailable(link, menuContext(context)) ||
				(item.type === "link" && sideMenuLinkVisible(link, context));
			const text = getText(link.text);
			if (
				!available ||
				typeof text !== "string" ||
				!matchesMenuFilter(query, category, text)
			) {
				continue;
			}
			// Once per page (Dashboard is both a top link and a League command)
			const key = menuLinkKey(link) ?? text;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			links.push(link);
		}
		const last = groups.at(-1);
		if (links.length === 0) {
			continue;
		}
		// Top links (Dashboard, ...) are one group with no name
		if (last && last.category === category) {
			last.links.push(...links);
		} else {
			groups.push({ category, links });
		}
	}
	return groups;
};

const PinButton = ({
	label,
	onToggle,
	pinned,
}: {
	label: ReactNode;
	onToggle: () => void;
	pinned: boolean;
}) => {
	const description =
		typeof label === "string"
			? pinned
				? `Unpin ${label} from Favorites`
				: `Pin ${label} to Favorites`
			: pinned
				? "Unpin from Favorites"
				: "Pin to Favorites";
	return (
		<button
			type="button"
			className={clsx("sidebar-pin", { pinned })}
			aria-label={description}
			aria-pressed={pinned}
			title={description}
			data-testid="sidebar-pin"
			onClick={(event) => {
				event.preventDefault();
				onToggle();
			}}
		>
			<span
				className={clsx(
					"glyphicon",
					pinned ? "glyphicon-star" : "glyphicon-star-empty",
				)}
				aria-hidden="true"
			/>
		</button>
	);
};

type Pins = {
	favorites: readonly string[];
	onToggle: (key: string) => void;
};

const LinkItem = ({
	active = false,
	badge,
	label,
	menuItem,
	onMenuItemClick,
	pins,
	onKeyDown,
	testID,
}: {
	active?: boolean;
	badge?: number;
	label?: ReactNode;
	menuItem: MenuItemLink;
	onMenuItemClick: () => void;
	pins?: Pins;
	onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
	testID?: string;
}) => {
	const anchorProps = makeAnchorProps(menuItem, onMenuItemClick);
	const className = clsx("nav-link", {
		active,
		"god-mode": menuItem.godMode,
	});
	const text = label ?? getText(menuItem.text);
	const key = pins ? menuLinkKey(menuItem) : undefined;

	return (
		<li className={clsx("nav-item", { "sidebar-pinnable": key })}>
			{anchorProps.href === undefined ? (
				// An action (Auto Play, Screenshot, ...) rather than a page: a real button, so it can be reached
				// with Tab and activated with Enter or Space
				<button
					type="button"
					className={clsx(className, "w-100 text-start")}
					data-testid={testID}
					onClick={anchorProps.onClick}
					onKeyDown={onKeyDown}
				>
					{text}
				</button>
			) : (
				<a
					className={className}
					aria-current={active ? "page" : undefined}
					data-testid={testID}
					{...anchorProps}
					href={anchorProps.href}
					onKeyDown={onKeyDown}
				>
					{text}
					{badge !== undefined ? (
						<span
							className="badge rounded-pill text-bg-danger ms-1"
							data-testid="sidebar-badge"
							title={`${badge} new since your last visit`}
						>
							{formatBadgeCount(badge)}
							<span className="visually-hidden"> new</span>
						</span>
					) : null}
				</a>
			)}
			{pins && key !== undefined ? (
				<PinButton
					label={text}
					pinned={pins.favorites.includes(key)}
					onToggle={() => pins.onToggle(key)}
				/>
			) : null}
		</li>
	);
};

const RecentlyVisited = ({
	onMenuItemClick,
	pages,
}: {
	onMenuItemClick: () => void;
	pages: RecentPage[];
}) => {
	if (pages.length === 0) {
		return null;
	}
	return (
		<MenuGroup title="Recently visited">
			{pages.map((page) => (
				<li className="nav-item" key={page.path}>
					<a
						className="nav-link"
						data-testid="sidebar-recent"
						href={page.path}
						onClick={onMenuItemClick}
					>
						{page.label}
					</a>
				</li>
			))}
		</MenuGroup>
	);
};

// Filter box results: every matching link, under its group's name. Arrow keys move between them, and up from the
// first one goes back to the box
const FilterResults = ({
	context,
	id,
	inputRef,
	onMenuItemClick,
	query,
	resultsRef,
}: {
	context: VisibilityContext;
	id: string;
	inputRef: RefObject<HTMLInputElement | null>;
	onMenuItemClick: () => void;
	query: string;
	resultsRef: RefObject<HTMLDivElement | null>;
}) => {
	const groups = filterMenuLinks(query, context);

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}
		const links = [
			...(resultsRef.current?.querySelectorAll<HTMLElement>(".nav-link") ?? []),
		];
		const index = links.indexOf(document.activeElement as HTMLElement);
		if (index < 0) {
			return;
		}
		event.preventDefault();
		if (event.key === "ArrowDown") {
			links[Math.min(index + 1, links.length - 1)]!.focus();
		} else if (index === 0) {
			inputRef.current?.focus();
		} else {
			links[index - 1]!.focus();
		}
	};

	return (
		<div id={id} ref={resultsRef} data-testid="sidebar-filter-results">
			{groups.length === 0 ? (
				<p
					className="sidebar-filter-empty text-body-secondary mb-0"
					role="status"
				>
					No matches
				</p>
			) : null}
			{groups.map(({ category, links }, i) => (
				<Fragment key={i}>
					{category ? (
						<div className="sidebar-heading sidebar-heading-static">
							{category}
						</div>
					) : null}
					<ul className="nav flex-column flex-nowrap">
						{links.map((link, j) => (
							<LinkItem
								key={j}
								menuItem={link}
								onKeyDown={onKeyDown}
								onMenuItemClick={onMenuItemClick}
							/>
						))}
					</ul>
				</Fragment>
			))}
		</div>
	);
};

const MenuItem = ({
	badges,
	context,
	highlightPageID,
	menuItem,
	onMenuItemClick,
	pathname,
	pins,
	root,
}: {
	badges: Partial<Record<SidebarBadgeKey, number>>;
	context: VisibilityContext;
	highlightPageID?: string;
	menuItem: MenuItemHeader | MenuItemLink | MenuItemText;
	onMenuItemClick: () => void;
	pathname?: string;
	pins: Pins;
	root: boolean;
}) => {
	const { lid } = context;

	if (menuItem.type === "text") {
		return null;
	}

	if (!menuItem.league && lid !== undefined) {
		return null;
	}

	if (!menuItem.nonLeague && lid === undefined) {
		return null;
	}

	if (menuItem.type === "link") {
		if (!sideMenuLinkVisible(menuItem, context)) {
			return null;
		}

		const active = menuItem.active
			? menuItem.active(highlightPageID, pathname)
			: false;
		const badgeKey = badgeKeyOf(menuItem);

		const item = (
			<LinkItem
				active={active}
				badge={badgeKey ? badges[badgeKey] : undefined}
				menuItem={menuItem}
				onMenuItemClick={onMenuItemClick}
				pins={pins}
			/>
		);
		return root ? <MenuGroup>{item}</MenuGroup> : item;
	}

	if (menuItem.type === "header") {
		if (menuItem.commandPaletteOnly) {
			return null;
		}

		const children = menuItem.children
			.map((child, i) => (
				<MenuItem
					badges={badges}
					context={context}
					highlightPageID={highlightPageID}
					key={i}
					menuItem={child}
					onMenuItemClick={onMenuItemClick}
					pathname={pathname}
					pins={pins}
					root={false}
				/>
			))
			.filter((element) => element !== null);

		if (
			children.length === 0 ||
			!menuItem.children.some(
				(child) => child.type === "link" && sideMenuLinkVisible(child, context),
			)
		) {
			return null;
		}

		const containsActive = menuItem.children.some(
			(child) =>
				child.type === "link" &&
				sideMenuLinkVisible(child, context) &&
				!!child.active?.(highlightPageID, pathname),
		);

		return (
			<MenuGroup
				collapsedByDefault={!!menuItem.collapsed}
				containsActive={containsActive}
				title={menuItem.long}
			>
				{children}
			</MenuGroup>
		);
	}
};

type Props = {
	pageID?: string;
	pathname?: string;
};

// Sidebar open/close state is done with the DOM directly rather than by passing a prop down or using local.getState()
// because then performance of the menu is independent of any other React performance issues - basically it's a hack to
// make menu performance consistent even if there are other problems. Like on the Fantasy Draft page.
export const SideBar = memo(({ pageID, pathname }: Props) => {
	const [node, setNode] = useState<null | HTMLDivElement>(null);
	const [nodeFade, setNodeFade] = useState<null | HTMLDivElement>(null);

	const { godMode, leagueType, lid, phase, sidebarOpen } = useLocal([
		"godMode",
		"leagueType",
		"lid",
		"phase",
		"sidebarOpen",
	]);

	// Pinned links (Favorites), the same in every league of this browser
	const [favorites, setFavorites] = useState(readFavorites);
	const pins: Pins = {
		favorites,
		onToggle: (key) => {
			setFavorites(toggleFavorite(key));
		},
	};

	// Filter box: while something is typed, the menu is replaced by the matching links
	const [filter, setFilter] = useState("");
	const filterInputRef = useRef<HTMLInputElement>(null);
	const filterResultsRef = useRef<HTMLDivElement>(null);
	const filtering = filter.trim() !== "";
	const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			if (filter !== "") {
				event.preventDefault();
				event.stopPropagation();
				setFilter("");
			}
		} else if (event.key === "ArrowDown" || event.key === "Enter") {
			const first =
				filterResultsRef.current?.querySelector<HTMLElement>(".nav-link");
			if (first) {
				event.preventDefault();
				if (event.key === "Enter") {
					first.click();
				} else {
					first.focus();
				}
			}
		}
	};

	// Re-render when a League extras switch changes
	useFeatureSwitches();
	const context = { godMode, leagueType, lid };
	const highlightPageID = sideMenuHighlightPageID(pageID, pathname, context);

	const badges = useSidebarBadges(pageID);

	// Recently visited pages of this league, newest first, the current one left out
	const [recent, setRecent] = useState<RecentPage[]>([]);
	useEffect(() => {
		if (lid === undefined) {
			setRecent([]);
			return;
		}
		// The pathname prop is only passed in baseball (for its depth chart links), so read the address here
		const locationPath = pathname ?? document.location.pathname;
		const page = recentPageFor(pageID, locationPath, {
			godMode,
			leagueType,
			lid,
		});
		const list = page ? addRecent(lid, page) : readRecent(lid);
		setRecent(
			list.filter((other) => other.path !== locationPath).slice(0, MAX_RECENT),
		);
	}, [godMode, leagueType, lid, pageID, pathname]);
	const firstHeaderIndex = menuItems.findIndex(
		(item) => item.type === "header",
	);

	const getNode = useCallback((node2: HTMLDivElement) => {
		if (node2 !== null) {
			setNode(node2);
		}
	}, []);

	const getNodeFade = useCallback((node2: HTMLDivElement) => {
		if (node2 !== null) {
			setNodeFade(node2);
		}
	}, []);

	const close = useCallback(() => {
		// These are flat conditions while open is nested, by design - clean up everything!
		if (node) {
			node.classList.remove("sidebar-open");
		}

		if (nodeFade) {
			nodeFade.classList.add("sidebar-fade-closing");
		}

		setTimeout(() => {
			if (nodeFade) {
				nodeFade.classList.remove("sidebar-fade-open");
			}

			if (nodeFade) {
				nodeFade.classList.remove("sidebar-fade-closing");
			}

			if (document.body) {
				document.body.classList.remove("modal-open");
			}
		}, 300); // Keep time in sync with .sidebar-fade
	}, [node, nodeFade]);

	const open = useCallback(() => {
		if (node) {
			node.classList.add("sidebar-open");

			if (nodeFade) {
				nodeFade.classList.add("sidebar-fade-open");

				if (document.body) {
					if (document.body) {
						document.body.classList.add("modal-open");
					}
				}
			}
		}
	}, [node, nodeFade]);

	useEffect(() => {
		if (node) {
			const opening = node.classList.contains("sidebar-open");

			if (!sidebarOpen && opening) {
				close();
			} else if (sidebarOpen && !opening) {
				open();
			}
		}
	}, [close, node, open, sidebarOpen]);

	useEffect(() => {
		// Use one media query per cutoff. At the time of writing, there is only ever one, at 768px. This is more efficient than listening for the window resize event and updating every time it changes.
		const mediaQueryList = window.matchMedia("(min-width: 1200px)");

		const handle = (event: MediaQueryListEvent) => {
			// Call open/close even if sidebarOpen says it's open, cause sidebarOpen is not actually the source of truth!
			if (event.matches) {
				// Now we're xl or larger - open unless closed is saved value
				const saved = safeLocalStorage.getItem("sidebarOpen");
				if (saved === "false") {
					localActions.setSidebarOpen(false);
				} else {
					localActions.setSidebarOpen(true);
				}
			} else {
				// Now we're smaller than xl - hide the sidebar
				localActions.setSidebarOpen(false);
			}
		};

		mediaQueryList.addEventListener("change", handle);

		return () => {
			mediaQueryList.removeEventListener("change", handle);
		};
	}, [close, open]);

	const onMenuItemClick = useCallback(() => {
		// Only on mobile, close menu on click
		if (window.innerWidth < 1200) {
			localActions.setSidebarOpen(false);
		}
	}, []);

	const onFilterResultClick = useCallback(() => {
		setFilter("");
		onMenuItemClick();
	}, [onMenuItemClick]);

	const filterResultsID = useId();
	const nowLinks = visibleNowShortcuts(phase, context);
	const favoriteLinks = visibleFavorites(favorites, context);

	useEffect(() => {
		const closeHandler = () => {
			localActions.setSidebarOpen(false);
		};

		if (nodeFade) {
			nodeFade.addEventListener("click", closeHandler);
		}

		return () => {
			if (nodeFade) {
				nodeFade.removeEventListener("click", closeHandler);
			}
		};
	}, [nodeFade]);

	return (
		<>
			<div ref={getNodeFade} className="sidebar-fade" />
			<nav
				className="bg-light sidebar flex-shrink-0"
				id="sidebar"
				ref={getNode}
				aria-label="side navigation"
			>
				<div
					className="bg-light sidebar-inner small-scrollbar"
					style={
						VIDEO_ADS
							? {
									paddingBottom: VIDEO_AD_PADDING,
								}
							: undefined
					}
				>
					<div className="sidebar-filter" role="search">
						<input
							ref={filterInputRef}
							type="search"
							className="form-control form-control-sm"
							placeholder="Filter menu"
							aria-label="Filter menu"
							aria-controls={filtering ? filterResultsID : undefined}
							data-testid="sidebar-filter"
							value={filter}
							onChange={(event) => {
								setFilter(event.target.value);
							}}
							onKeyDown={onFilterKeyDown}
						/>
					</div>
					{filtering ? (
						<FilterResults
							context={context}
							id={filterResultsID}
							inputRef={filterInputRef}
							onMenuItemClick={onFilterResultClick}
							query={filter}
							resultsRef={filterResultsRef}
						/>
					) : (
						menuItems.map((menuItem, i) => (
							<Fragment key={i}>
								{i === firstHeaderIndex ? (
									<>
										{nowLinks.length > 0 ? (
											<MenuGroup title="Now">
												{nowLinks.map((link, j) => (
													<LinkItem
														key={j}
														label={shortcutLabel(link)}
														menuItem={link}
														onMenuItemClick={onMenuItemClick}
														testID="sidebar-now"
													/>
												))}
											</MenuGroup>
										) : null}
										{favoriteLinks.length > 0 ? (
											<MenuGroup title="Favorites">
												{favoriteLinks.map(({ group, key, link }) => (
													<LinkItem
														key={key}
														label={shortcutLabel(link, group)}
														menuItem={link}
														onMenuItemClick={onMenuItemClick}
														pins={pins}
														testID="sidebar-favorite"
													/>
												))}
											</MenuGroup>
										) : null}
										{lid !== undefined ? (
											<RecentlyVisited
												onMenuItemClick={onMenuItemClick}
												pages={recent}
											/>
										) : null}
									</>
								) : null}
								<MenuItem
									badges={badges}
									context={context}
									highlightPageID={highlightPageID}
									menuItem={menuItem}
									onMenuItemClick={onMenuItemClick}
									pathname={pathname}
									pins={pins}
									root
								/>
							</Fragment>
						))
					)}
				</div>
			</nav>
		</>
	);
});
