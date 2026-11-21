import { tabHostPageID } from "../../util/pageTabs.ts";
import clsx from "clsx";
import {
	Fragment,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import { helpers } from "../../util/helpers.ts";
import { localActions, useLocal } from "../../util/local.ts";
import {
	isMenuLinkFeatureOn,
	useFeatureSwitches,
} from "../../util/nativeFeatures.ts";
import type {
	MenuItemLink,
	MenuItemHeader,
	MenuItemText,
} from "../../../common/types.ts";
import CollapseArrow from "../CollapseArrow.tsx";
import { AnimatePresence, m } from "framer-motion";
import { VIDEO_ADS, VIDEO_AD_PADDING } from "../../../common/constants.ts";
import { menuItems } from "../../util/menuItems.tsx";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";
import { menuItemHiddenForLeagueType } from "../../util/collegeMode.ts";
import {
	addRecent,
	BADGE_PATHS,
	formatBadgeCount,
	MAX_RECENT,
	readRecent,
	type RecentPage,
	type SidebarBadgeKey,
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

// Titles of the side menu groups the user collapsed, remembered in this browser like sidebarOpen
const COLLAPSED_KEY = "sidebarCollapsedGroups";

const readCollapsed = (): string[] => {
	try {
		const parsed = JSON.parse(safeLocalStorage.getItem(COLLAPSED_KEY) ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter((title) => typeof title === "string")
			: [];
	} catch {
		return [];
	}
};

const writeCollapsed = (title: string, collapsed: boolean) => {
	try {
		const titles = readCollapsed().filter((other) => other !== title);
		if (collapsed) {
			titles.push(title);
		}
		safeLocalStorage.setItem(COLLAPSED_KEY, JSON.stringify(titles));
	} catch {}
};

const MenuGroup = ({
	children,
	title,
}: {
	children: ReactNode;
	title?: string;
}) => {
	const [open, setOpen] = useState(
		() => title === undefined || !readCollapsed().includes(title),
	);
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
						writeCollapsed(title, !newOpen);
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

// Whether a link is shown in the side menu. Non-reactive (League extras switches are read from the local state), so
// SideBar re-renders on a switch change with useFeatureSwitches
export const sideMenuLinkVisible = (
	menuItem: MenuItemLink,
	{ godMode, lid, leagueType }: VisibilityContext,
) =>
	!menuItem.commandPaletteOnly &&
	(lid === undefined ? !!menuItem.nonLeague : !!menuItem.league) &&
	(!menuItem.godMode || godMode) &&
	isMenuLinkFeatureOn(menuItem) &&
	!menuItemHiddenForLeagueType(menuItem, leagueType);

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

// Page the side menu highlights: the page itself when it has a visible item of its own (like Rumors or the Staff
// Report), otherwise the host page it is a tab of (util/pageTabs.ts), so exactly one place lights up
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

const MenuItem = ({
	badges,
	context,
	highlightPageID,
	menuItem,
	onMenuItemClick,
	pathname,
	root,
}: {
	badges: Partial<Record<SidebarBadgeKey, number>>;
	context: VisibilityContext;
	highlightPageID?: string;
	menuItem: MenuItemHeader | MenuItemLink | MenuItemText;
	onMenuItemClick: () => void;
	pathname?: string;
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

		const anchorProps = makeAnchorProps(menuItem, onMenuItemClick);
		const active = menuItem.active
			? menuItem.active(highlightPageID, pathname)
			: false;
		const className = clsx("nav-link", {
			active,
			"god-mode": menuItem.godMode,
		});
		const badgeKey = badgeKeyOf(menuItem);
		const badge = badgeKey ? badges[badgeKey] : undefined;

		const item = (
			<li className="nav-item">
				{anchorProps.href === undefined ? (
					// An action (Auto Play, Screenshot, ...) rather than a page: a real button, so it can be reached
					// with Tab and activated with Enter or Space
					<button
						type="button"
						className={clsx(className, "w-100 text-start")}
						onClick={anchorProps.onClick}
					>
						{getText(menuItem.text)}
					</button>
				) : (
					<a
						className={className}
						aria-current={active ? "page" : undefined}
						{...anchorProps}
					>
						{getText(menuItem.text)}
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
			</li>
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
					root={false}
				/>
			))
			.filter((element) => element !== null);

		if (children.length === 0) {
			return null;
		}

		return <MenuGroup title={menuItem.long}>{children}</MenuGroup>;
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

	const { godMode, leagueType, lid, sidebarOpen } = useLocal([
		"godMode",
		"leagueType",
		"lid",
		"sidebarOpen",
	]);

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
					{menuItems.map((menuItem, i) => (
						<Fragment key={i}>
							{i === firstHeaderIndex && lid !== undefined ? (
								<RecentlyVisited
									onMenuItemClick={onMenuItemClick}
									pages={recent}
								/>
							) : null}
							<MenuItem
								badges={badges}
								context={context}
								highlightPageID={highlightPageID}
								menuItem={menuItem}
								onMenuItemClick={onMenuItemClick}
								pathname={pathname}
								root
							/>
						</Fragment>
					))}
				</div>
			</nav>
		</>
	);
});
