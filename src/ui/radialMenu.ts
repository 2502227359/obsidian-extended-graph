import { Menu, MenuPositionDef } from "obsidian";
import { CSSBridge, FOLDER_KEY, FolderBlob, GraphInstances, GraphStateModal, LINK_KEY, TAG_KEY, t, textColor } from "../internal";

interface RadialMenuItem {
    id: string;
    title: string;
    icon: string;
    color: string;
    onClick?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    items?: RadialMenuItem[];
}

export class RadialMenu extends Menu {
    level: number
    radialSubmenus: Map<string, RadialMenu> = new Map();
    position?: { x: number, y: number };
    menuManager: RadialMenuManager;

    constructor(menuManager: RadialMenuManager, allItems: RadialMenuItem[], level: number, parentMenu?: RadialMenu) {
        super();

        this.menuManager = menuManager;
        this.level = level;
        this.parentMenu = parentMenu ?? null;

        this.dom.addClass("extended-graph-radial-menu");
        if (level > 0) {
            this.dom.addClass("mod-submenu");
            this.dom.style.setProperty("--submenu-level", level.toString());
        }

        this.setItems(allItems);
        this.setCentralItem();
    }

    override showAtMouseEvent(evt: MouseEvent): this {
        this.position = { x: evt.clientX, y: evt.clientY };
        return super.showAtMouseEvent(evt);
    }

    override showAtPosition(position: MenuPositionDef, doc?: Document): this {
        this.position = position;
        const menu = super.showAtPosition(position, doc);
        this.centerOn(position);
        return menu;
    }

    /**
     * The radial menu is anchored by its center (CSS translate(-50%, -50%)), so the
     * core viewport clamping (which assumes a top-left anchor) cannot be reused.
     * Clamp the center ourselves to keep the circle fully on screen.
     */
    private centerOn(position: MenuPositionDef): void {
        const win = this.dom.win;
        const halfWidth = this.dom.offsetWidth / 2;
        const halfHeight = this.dom.offsetHeight / 2;
        const x = Math.min(Math.max(position.x, halfWidth), win.innerWidth - halfWidth);
        const y = Math.min(Math.max(position.y, halfHeight), win.innerHeight - halfHeight);
        this.dom.style.left = x + "px";
        this.dom.style.top = y + "px";
        this.position = { x, y };
    }

    private onClick(item: RadialMenuItem) {
        if (item.items && item.items.length > 0) {
            this.showNestedMenu(item);
        } else if (item.onClick) {
            item.onClick();
        } else if (item.onMouseEnter) {
            // Hover-only sectors (links/folders/tags/property values) highlight the
            // related elements; clicking re-triggers that highlight, which also
            // makes them reachable on touch devices.
            item.onMouseEnter();
        }
    }

    private onMouseEnter(event: MouseEvent, item: RadialMenuItem) {
        const itemEl = event.targetNode as HTMLElement;
        const tooltip = createDiv("tooltip extended-graph-tooltip");
        tooltip.setText(item.title);
        this.dom.doc.body.appendChild(tooltip);
        const bbox = itemEl.getBoundingClientRect();
        tooltip.style.left = `${bbox.left + bbox.width * 0.5 + 10}px`;
        tooltip.style.top = `${event.clientY + 10}px`;
        if (item.onMouseEnter) {
            item.onMouseEnter();
        }
    }

    private onMouseLeave(event: MouseEvent, item: RadialMenuItem) {
        this.dom.doc.body.querySelectorAll(".tooltip.extended-graph-tooltip").forEach(el => el.detach());
        if (item.onMouseLeave) {
            item.onMouseLeave();
        }
    }

    private onClickCenter() {
        if (this.parentMenu) {
            this.switchWhithMenu(this.parentMenu as RadialMenu);
        }
        else {
            this.hide();
        }
    }

    private setItems(items: RadialMenuItem[]) {
        const onClick = this.onClick.bind(this);
        const onMouseEnter = this.onMouseEnter.bind(this);
        const onMouseLeave = this.onMouseLeave.bind(this);

        // Sectors are 45° wedges; with more items than fit in a circle the step
        // shrinks so wedges never overlap (the wedge itself follows via
        // --sector-ratio in the clip-path).
        const count = items.length;
        const step = Math.min(45, 360 / count);
        const sectorRatio = Math.tan(step * Math.PI / 180);

        for (let i = 0; i < items.length; ++i) {
            const currentItem = items[i];
            this.addItem((item) => {
                const darkInterp = textColor(this.menuManager.instances.cssBridge.getThemeColor(currentItem.color), "dark", "light") === "dark" ? "100%" : "0%";
                item.dom.style.setProperty("--dark-text-interp", darkInterp);
                item.dom.style.setProperty("--color-rgb", `var(--color-${currentItem.color}-rgb)`);
                item.dom.style.setProperty("--sector-ratio", sectorRatio.toFixed(4));
                item.dom.style.setProperty("--rotation", `${((i - (count - 1) / 2) * step).toFixed(2)}deg`);

                item.setTitle(currentItem.title)
                    .setIcon(currentItem.icon)
                    .onClick(() => {
                        onClick(currentItem);
                    });

                item.dom.addEventListener('mouseenter', (event) => onMouseEnter(event, currentItem));
                item.dom.addEventListener('mouseleave', (event) => onMouseLeave(event, currentItem));

                const subitems = currentItem.items;
                if (subitems && subitems.length > 0) {
                    this.radialSubmenus.set(currentItem.id, new RadialMenu(this.menuManager, subitems, this.level + 1, this));
                }
            })
        }

        this.onMenuClick = function (e: MouseEvent) {
            var t = e.targetNode;
            if (t && t.instanceOf(Element) && (t.matchParent(".menu-item") || t.hasClass("menu-item"))) {
                return;
            }
            else {
                this.hide();
            }
        }
    }

    private setCentralItem() {
        const onClickCenter = this.onClickCenter.bind(this);
        this.addItem((item) => {
            item.dom.addClass("back");
            // The title is hidden by CSS when an icon is present, but it still
            // provides the aria-label; the hover tooltip uses the same text.
            const label = this.parentMenu ? t("controls.back") : t("controls.cancel");
            item.setTitle(label);
            item.dom.setAttribute("aria-label", label);
            if (this.level > 0) {
                item.setIcon("undo-2");
            }
            else {
                item.setIcon("x");
            }
            item.onClick(onClickCenter);
            this.attachTooltip(item.dom, label);
        });
    }

    /** Hover tooltip reusing the same mechanism as the sector items. */
    private attachTooltip(dom: HTMLElement, text: string): void {
        dom.addEventListener('mouseenter', (event) => {
            const tooltip = createDiv("tooltip extended-graph-tooltip");
            tooltip.setText(text);
            this.dom.doc.body.appendChild(tooltip);
            const bbox = dom.getBoundingClientRect();
            tooltip.style.left = `${bbox.left + bbox.width * 0.5 + 10}px`;
            tooltip.style.top = `${(event as MouseEvent).clientY + 10}px`;
        });
        dom.addEventListener('mouseleave', () => {
            this.dom.doc.body.querySelectorAll(".tooltip.extended-graph-tooltip").forEach(el => el.detach());
        });
    }

    private showNestedMenu(item: RadialMenuItem) {
        const submenu = this.radialSubmenus.get(item.id);
        if (!submenu) return;

        this.switchWhithMenu(submenu);
    }

    private switchWhithMenu(menu: RadialMenu) {
        if (!this.position) {
            const rect = this.dom.getBoundingClientRect();
            this.position = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }

        const parent = this.parentMenu;
        this.close();
        this.parentMenu = parent;
        this.menuManager.setCurrentMenu(menu);
        menu.showAtPosition({ x: this.position.x, y: this.position.y });
    }

    override close(): void {
        this.dom.doc.body.querySelectorAll(".tooltip.extended-graph-tooltip").forEach(el => el.detach());
        super.close();
    }
}

export class RadialMenuManager {
    instances: GraphInstances;
    nodeID: string;
    nodeType: string;

    menu: RadialMenu;
    allItems: RadialMenuItem[];

    constructor(instances: GraphInstances, node: string, type: string) {
        this.instances = instances;
        this.nodeID = node;
        this.nodeType = type;

        this.populateItems();
        this.menu = new RadialMenu(this, this.allItems, 0);
    }

    open(e: MouseEvent | null) {
        const node = this.instances.renderer.nodes.find(node => node.id === this.nodeID);
        if (node?.circle) {
            const canvasBound = this.instances.renderer.interactiveEl.getBoundingClientRect();
            const nodePos = node.circle.getGlobalPosition();
            this.menu.showAtPosition({
                x: (nodePos.x / window.devicePixelRatio + canvasBound.left),
                y: (nodePos.y / window.devicePixelRatio + canvasBound.top)
            });
            return;
        }
        else if (e) {
            this.menu.showAtPosition({ x: e.clientX, y: e.clientY });
        }
    }

    private populateItems() {
        this.allItems = [
            {
                id: 'info',
                title: t("plugin.info"),
                icon: 'info',
                color: 'blue',
                onClick: this.onShowInfo.bind(this)
            },
            {
                id: 'pin',
                title: t("plugin.pin"),
                icon: this.instances.nodesSet.isNodePinned(this.nodeID) ? 'pin-off' : 'pin',
                color: 'red',
                onClick: this.onPin.bind(this)
            },
        ];


        if (this.instances.type === "localgraph" && (this.nodeType === "" || this.nodeType === "focused")) {
            this.allItems.push({
                id: 'relations', title: "查看与中心关联", icon: 'list-tree', color: 'cyan',
                onClick: () => this.instances.graphEventsDispatcher.inputsManager.showRelations(this.nodeID),
            });
            this.addBranchItems();
        }

        if (this.instances.settings.enableFeatures[this.instances.type]['links'] && (this.getInteractivesTypes(LINK_KEY)?.size ?? 0) > 0) {
            this.allItems.push({
                id: 'links',
                title: t("plugin.links"),
                icon: 'link',
                color: 'orange',
                onMouseEnter: (() => this.onShowInteractive(LINK_KEY)),
                onMouseLeave: this.clearInteractivesList.bind(this),
            });
        }


        if (this.instances.settings.enableFeatures[this.instances.type]['folders'] && (this.getInteractivesTypes(FOLDER_KEY)?.size ?? 0) > 0) {
            this.allItems.push({
                id: 'folders',
                title: t("plugin.folders"),
                icon: 'folder',
                color: 'green',
                onMouseEnter: (() => this.onShowInteractive(FOLDER_KEY)),
                onMouseLeave: this.clearInteractivesList.bind(this),
            });
        }

        // File node
        if (this.nodeType === "" || this.nodeType === "focused") {
            if (this.instances.settings.enableFeatures[this.instances.type]['tags'] && (this.getInteractivesTypes(TAG_KEY)?.size ?? 0) > 0) {
                this.allItems.push({
                    id: 'tags',
                    title: t("plugin.tags"),
                    icon: 'tags',
                    color: 'pink',
                    onMouseEnter: (() => this.onShowInteractive(TAG_KEY)),
                    onMouseLeave: this.clearInteractivesList.bind(this),
                });
            }


            if (this.instances.settings.enableFeatures[this.instances.type]['properties']) {
                const propertiesItem: RadialMenuItem = {
                    id: 'properties',
                    title: t("plugin.properties"),
                    icon: 'archive',
                    color: 'purple',
                    items: []
                };

                const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
                let i = 0;
                for (const [prop, enable] of Object.entries(this.instances.settings.additionalProperties)) {
                    if (enable[this.instances.type] && (this.getInteractivesTypes(prop)?.size ?? 0) > 0) {
                        const propertyItems: RadialMenuItem = {
                            id: prop,
                            title: prop,
                            icon: '',
                            color: colors[i % colors.length],
                            items: [],
                            onMouseEnter: (() => this.onShowInteractive(prop)),
                            onMouseLeave: this.clearInteractivesList.bind(this),
                        };
                        propertiesItem.items?.push(propertyItems);
                        ++i;
                    }
                }

                if (propertiesItem.items && propertiesItem.items.length > 0) {
                    this.allItems.push(propertiesItem);
                }
            }
        }

    }

    private addBranchItems(): void {
        const branches = this.instances.graphEventsDispatcher.branches;
        if (!branches) return;
        this.allItems.push({
            id: 'branches', title: "局部分支", icon: 'git-branch', color: 'purple',
            items: [
                {
                    id: 'branch-toggle', title: branches.expansions.anchors.has(this.nodeID) ? "收起这一层" : "展开一层",
                    icon: 'git-branch', color: 'purple', onClick: () => branches.toggleBranch(this.nodeID),
                },
                {
                    id: 'branch-clear', title: "收起所有手动分支", icon: 'fold-vertical', color: 'purple',
                    onClick: () => branches.clearManual(),
                },
                {
                    id: 'branch-sources', title: "切换来源关联", icon: 'book-open', color: 'purple',
                    onClick: () => branches.toggleSources(),
                },
            ],
        });
    }

    setCurrentMenu(menu: RadialMenu) {
        this.clearInteractivesList();
        this.menu = menu;
    }

    private onShowInfo(): void {
        const modal = new GraphStateModal(this.instances);
        modal.setTarget('nodes', this.nodeID);
        modal.open();
    }

    private onPin(): void {
        if (this.instances.nodesSet.isNodePinned(this.nodeID)) {
            this.instances.graphEventsDispatcher.inputsManager.unpinNodeFromId(this.nodeID);
        }
        else {
            this.instances.graphEventsDispatcher.inputsManager.pinNodeFromId(this.nodeID);
        }
        this.menu.close();
    }

    private onShowInteractive(key: string): void {
        const manager = this.instances.interactiveManagers.get(key);
        if (!manager) return;

        const types = this.getInteractivesTypes(key);
        if (!types || types.size === 0) return;

        this.clearInteractivesList();
        const div = this.menu.dom.createDiv("interactives-list");

        for (const type of types) {
            const color = manager.getColor(type.id ?? type.text)

            const typeELement = div.createDiv("interactive-item");
            typeELement.textContent = type.text;
            typeELement.style.setProperty("--bg-color", CSSBridge.getCSSSplitRGB(color));
            typeELement.style.setProperty("--text-color", textColor(color));
            typeELement.toggleClass("is-hidden", !!type.id && !manager.isActive(type.id));
        }
    }

    private getInteractivesTypes(key: string): Set<{ text: string, id?: string }> | undefined {
        if (key === FOLDER_KEY) {
            return this.getFoldersInteractivesTypes();
        }
        else if (key === LINK_KEY) {
            return this.getLinksInteractivesTypes();
        }
        else {
            return this.getNodesInteractivesTypes(key);
        }
    }

    private getNodesInteractivesTypes(key: string): Set<{ text: string, id?: string }> | undefined {
        const extendedNode = this.instances.nodesSet.extendedElementsMap.get(this.nodeID);
        if (!extendedNode) return;
        const manager = this.instances.nodesSet.managers.get(key);
        if (!manager) return;

        let types = [...extendedNode.getTypes(key)].reduce((acc: { text: string, id?: string }[], type: string) => {
            if (!manager.isSentinel(type)) {
                acc.push({ text: type });
            }
            return acc;
        }, []);
        return new Set(types);
    }

    private getFoldersInteractivesTypes(): Set<{ text: string, id?: string }> | undefined {
        if (!this.instances.foldersSet) return;
        const manager = this.instances.foldersSet.managers.get(FOLDER_KEY);
        if (!manager) return;

        const extendedElements = [...this.instances.foldersSet.foldersMap.values()]
            .filter(folder => folder.nodes.find(node => node.id === this.nodeID));

        let types = extendedElements.reduce((acc: { text: string, id?: string }[], curr: FolderBlob) => {
            if (curr.path !== this.instances.settings.interactiveSettings[FOLDER_KEY].noneType) {
                acc.push({ text: curr.path });
            }
            return acc;
        }, []);

        return new Set(types);
    }

    private getLinksInteractivesTypes(): Set<{ text: string, id?: string }> | undefined {
        const manager = this.instances.linksSet.managers.get(LINK_KEY);
        if (!manager) return;

        const extendedElements = [...this.instances.linksSet.extendedElementsMap.values()]
            .filter(link => link.coreElement.source.id === this.nodeID || link.coreElement.target.id === this.nodeID);

        const typesCount: Record<string, { forward: number, reverse: number }> = {};
        for (const link of extendedElements) {
            const types = link.getTypes(LINK_KEY);
            for (const type of types) {
                if (!(type in typesCount)) {
                    typesCount[type] = { forward: 0, reverse: 0 };
                }
                if (this.nodeID === link.coreElement.source.id) {
                    typesCount[type].forward++;
                }
                if (this.nodeID === link.coreElement.target.id) {
                    typesCount[type].reverse++;
                }
            }
        }
        const types = Object.entries(typesCount).map(([type, counts]) => {
            return { text: `${type} (${counts.forward} →, ${counts.reverse} ←)`, id: type };
        });

        return new Set(types);
    }

    private clearInteractivesList(): void {
        this.menu.dom.querySelector(".interactives-list")?.detach();
    }
}