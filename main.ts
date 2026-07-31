// main.ts

import { Plugin, Notice, Menu, TFile, TAbstractFile, Editor, EditorPosition, MarkdownView } from 'obsidian';
import { IndexDatabase } from './database';
import { initEngine, isEngineReady, getAvailableLanguages, parseReferences, getBookName, decodeScriptures, prewarmEngines, clearEnginePool } from './engine-wrapper';
import { ScriptureIndexer } from './indexer';
import { RelatedNotesPopout } from './related';
import { ConversumSettingTab } from './settings';
import { ConcordanceView } from './sidebar';
import { ConversumSettings, DEFAULT_SETTINGS, VIEW_TYPE_CONVERSUM_CONCORDANCE, IndexProgress, ReferenceIndexEntry } from './types';

export default class ConversumPlugin extends Plugin {
    settings!: ConversumSettings;
    indexer: ScriptureIndexer | null = null;
    private db: IndexDatabase | null = null;
    private rebuildTimeout: number | null = null;
    private fileWatcherEnabled = false;
    private relatedPopout: RelatedNotesPopout | null = null;
    private isStartupComplete = false;
    public settingsTab: ConversumSettingTab | null = null;

    public getDatabase(): IndexDatabase | null {
        return this.db;
    }

    async onload(): Promise<void> {
        await this.loadSettings();

        try {
            await initEngine();
            // console.log('con[VER]sum: Engine initialized'); // DEBUG
        } catch (e) {
            console.error('con[VER]sum: Failed to initialize engine:', e);
            new Notice('con[VER]sum: Failed to initialize engine.');
        }
        prewarmEngines(this.settings.sourceLanguage, this.settings.outputLanguage);

        this.db = new IndexDatabase(this);
        await this.db.init();
        this.initIndexer();

        this.registerView(VIEW_TYPE_CONVERSUM_CONCORDANCE, (leaf) => new ConcordanceView(leaf, this));
        this.relatedPopout = new RelatedNotesPopout(this);

        this.settingsTab = new ConversumSettingTab(this.app, this);
        this.addSettingTab(this.settingsTab);

        this.addCommands();
        this.registerEvents();
        this.addRibbonIcon('book-open', 'con[VER]sum Concordance', () => {
            void this.openConcordanceView();
        });

        await this.handleStartup();

        if (this.settings.autoIndex) {
            this.startFileWatcher();
        }
        this.isStartupComplete = true;
        // console.log('con[VER]sum: Plugin loaded'); // DEBUG
    }

    onunload(): void {
        this.stopFileWatcher();
        if (this.rebuildTimeout) {
            window.clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = null;
        }
        if (this.relatedPopout) {
            this.relatedPopout.forceClose();
            this.relatedPopout = null;
        }
        clearEnginePool();
        if (this.db) {
            void this.db.close().then(() => {
                this.db = null;
            });
        }
        // console.log('con[VER]sum: Plugin unloaded'); // DEBUG
    }

    private transformForcedReferences(text: string): string {
        if (!text.includes('{{')) return text;
        return text.replace(/\{\{(.+?)\}\}/g, (_match, inner) => {
            const cleaned = inner.replace(/\*\*/g, '').replace(/\*/g, '');
            return '⟪⟪' + cleaned + '⟫⟫';
        });
    }

    public getUnformattedCount(): number {
        return this.db?.getUnformattedCount() || 0;
    }

    public isFormattingBusy(): boolean {
        return this.indexer?.isFormattingBusy() || false;
    }

    // ============================================================
    // STARTUP FLOW
    // ============================================================

    private async handleStartup(): Promise<void> {
        if (!this.indexer || !this.db) {
            return;
        }

        const data = this.db.getData();
        const hasValidData = data && 
            data.references && 
            Object.keys(data.references).length > 0;
        const rebuildStatus = this.settings.rebuildStatus || 'unknown';

        if (rebuildStatus === 'in_progress' || rebuildStatus === 'failed' || rebuildStatus === 'aborted') {
            new Notice('Previous index rebuild was incomplete. Rebuilding...');
            this.settings.rebuildStatus = 'in_progress';
            await this.saveSettings();
            this.app.workspace.onLayoutReady(async () => {
                await new Promise(resolve => window.setTimeout(resolve, 500));
                await this.syncIndexOnStartup();
            });
            return;
        }

        if (hasValidData && this.settings.autoIndex) {
            // console.log(`con[VER]sum: Loaded index with ${Object.keys(data.references).length} references from SQLite`); // DEBUG
            this.app.workspace.onLayoutReady(async () => {
                await this.syncIndexOnStartup();
            });
            return;
        }

        if (hasValidData && !this.settings.autoIndex) {
            this.refreshConcordanceView();
            this.refreshSettings();
            return;
        }

        if (!hasValidData && this.settings.autoIndex) {
            // console.log('con[VER]sum: No index data found, rebuilding...'); // DEBUG
            this.app.workspace.onLayoutReady(async () => {
                await this.rebuildIndex();
            });
            return;
        }

        if (!hasValidData && !this.settings.autoIndex) {
            // console.log('con[VER]sum: No index data found and auto-index is disabled. Waiting for user action.'); // DEBUG
            this.refreshConcordanceView();
            this.refreshSettings();
            return;
        }
    }

    private async syncIndexOnStartup(): Promise<void> {
        if (!this.indexer || !this.db) {
            // console.log('con[VER]sum: Indexer or database not initialized, skipping sync'); // DEBUG
            return;
        }

        // console.log('con[VER]sum: Syncing index on startup...'); // DEBUG
        const allFiles = this.app.vault.getMarkdownFiles();
        const data = this.db.getData();
        if (!data || Object.keys(data.fileCache).length === 0) {
            // console.log('con[VER]sum: No existing index data, rebuilding...'); // DEBUG
            await this.rebuildIndex();
            return;
        }

        const fileCache = data.fileCache || {};
        const vaultPaths = new Set(allFiles.map(f => f.path));
        const filesToIndex: TFile[] = [];

        for (const file of allFiles) {
            if (this.indexer.isExcluded(file.path)) continue;
            const cached = fileCache[file.path];
            if (!cached) {
                filesToIndex.push(file);
            } else if (cached.lastModified !== file.stat.mtime) {
                filesToIndex.push(file);
            }
        }

        if (filesToIndex.length > 0) {
            // console.log(`con[VER]sum: Indexing ${filesToIndex.length} new/changed files...`); // DEBUG
            // let indexedCount = 0; // DEBUG
            for (const file of filesToIndex) {
                try {
                    await this.indexer.updateFile(file, true);
                    // indexedCount++; // DEBUG
                } catch {
                }
            }
            // console.log(`con[VER]sum: Indexed ${indexedCount} files`); // DEBUG
        }

        // console.log('con[VER]sum: Checking for deleted files...'); // DEBUG
        const freshData = this.db.getData();
        const freshFileCache = freshData.fileCache || {};
        let removedCount = 0;
        for (const cachedPath of Object.keys(freshFileCache)) {
            if (!vaultPaths.has(cachedPath)) {
                await this.indexer.removeFile(cachedPath);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            // console.log(`con[VER]sum: Removed ${removedCount} deleted files from index`); // DEBUG
        }

        const unformattedCount = this.db.getUnformattedCount();
        if (unformattedCount > 0) {
            // console.log(`con[VER]sum: ${unformattedCount} references need formatting, starting background process...`); // DEBUG
            this.indexer.startBackgroundFormatting();
        } else {
            // console.log('con[VER]sum: All references formatted'); // DEBUG
        }

        this.refreshConcordanceView();
        this.refreshSettings();
    }

    // ============================================================
    // SETTINGS
    // ============================================================

    async loadSettings(): Promise<void> {
        const savedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        if (savedData) {
            if (typeof savedData.sourceLanguage === 'string') {
                this.settings.sourceLanguage = savedData.sourceLanguage;
            }
            if (typeof savedData.outputLanguage === 'string') {
                this.settings.outputLanguage = savedData.outputLanguage;
            }
            if (savedData.nameFormat === 'full' || savedData.nameFormat === 'standard' || savedData.nameFormat === 'official') {
                this.settings.nameFormat = savedData.nameFormat;
            }
            if (typeof savedData.autoIndex === 'boolean') {
                this.settings.autoIndex = savedData.autoIndex;
            }
            if (Array.isArray(savedData.excludedFolders)) {
                this.settings.excludedFolders = savedData.excludedFolders;
            }
            if (typeof savedData.rebuildStatus === 'string') {
                this.settings.rebuildStatus = savedData.rebuildStatus;
            }
        } else {
            this.settings.autoIndex = false;
        }
    }

    async saveSettings(): Promise<void> {
        const dataToSave = {
            sourceLanguage: this.settings.sourceLanguage,
            outputLanguage: this.settings.outputLanguage,
            nameFormat: this.settings.nameFormat,
            autoIndex: this.settings.autoIndex,
            excludedFolders: this.settings.excludedFolders
        };
        await this.saveData(dataToSave);
    }

    // ============================================================
    // INDEXER
    // ============================================================

    private initIndexer(): void {
        if (!this.db) return;
        this.indexer = new ScriptureIndexer(
            this.app.vault,
            this,
            this.settings.sourceLanguage,
            this.settings.outputLanguage,
            this.settings.nameFormat,
            this.settings.excludedFolders,
            this.manifest.version,
            this.db
        );
    }

    updateIndexerSettings(): void {
        if (this.indexer) {
            this.indexer.updateSettings(
                this.settings.sourceLanguage,
                this.settings.outputLanguage,
                this.settings.nameFormat,
                this.settings.excludedFolders
            );
        }
    }

    async rebuildIndex(): Promise<void> {
        if (!this.indexer) {
            new Notice('Indexer not initialized');
            return;
        }

        if (this.indexer.isBusy()) {
            new Notice('Index rebuild already in progress');
            return;
        }

        if (!isEngineReady()) {
            new Notice('Engine not ready. Please try again.');
            return;
        }

        const notice = new Notice('Building concordance index...', 0);

        try {
            const progressCallback = (progress: IndexProgress) => {
                const percent = progress.totalFiles > 0 
                    ? Math.round((progress.processedFiles / progress.totalFiles) * 100) 
                    : 0;
                const fileInfo = progress.currentFile ? ` (${progress.currentFile})` : '';
                notice.setMessage(`Indexing: ${percent}% (${progress.processedFiles}/${progress.totalFiles} files${fileInfo}, ${progress.uniqueReferences} unique refs)`);
            };

            await this.indexer.rebuildIndex(progressCallback);
            const data = this.indexer.getData();
            notice.setMessage(`Index complete: ${data ? Object.keys(data.references).length : 0} unique references`);
            window.setTimeout(() => notice.hide(), 2000);
            this.refreshConcordanceView();
            this.refreshSettings();

        } catch {
            notice.setMessage('Index rebuild failed. See console for details.');
            window.setTimeout(() => notice.hide(), 3000);
        }
    }

    private formatReferenceOnTheFly(entry: ReferenceIndexEntry): string {
        const ranges: Array<[string, string]> = [[entry.startBcv, entry.endBcv]];
        const decoded = decodeScriptures(
            ranges,
            this.settings.outputLanguage,
            this.settings.nameFormat
        );
        return decoded && decoded.length > 0 && decoded[0] ? decoded[0] : `${entry.startBcv}-${entry.endBcv}`;
    }

    public async reformatAllReferences(): Promise<void> {
        if (!this.indexer) return;
        const data = this.indexer.getData();
        if (!data || Object.keys(data.references).length === 0) return;
        await this.indexer.clearFormatted();
        this.indexer.startBackgroundFormatting();
        this.refreshConcordanceView();
        this.refreshSettings();
    }

    // ============================================================
    // FILE WATCHER
    // ============================================================

    startFileWatcher(): void {
        if (this.fileWatcherEnabled) return;
        this.fileWatcherEnabled = true;
    }

    stopFileWatcher(): void {
        this.fileWatcherEnabled = false;
        if (this.rebuildTimeout) {
            window.clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = null;
        }
    }

    private scheduleIndexUpdate(file: TFile): void {
        if (!this.settings.autoIndex || !this.fileWatcherEnabled) return;
        if (!this.indexer) return;
        if (this.indexer.isIndexingBusy()) return;

        for (const folder of this.settings.excludedFolders) {
            if (file.path.startsWith(folder + '/') || file.path === folder) {
                return;
            }
        }

        if (this.rebuildTimeout) {
            window.clearTimeout(this.rebuildTimeout);
        }

        this.rebuildTimeout = window.setTimeout(async () => {
            this.rebuildTimeout = null;
            if (!this.indexer || this.indexer.isIndexingBusy()) return;
            try {
                await this.indexer.updateFile(file);
                this.refreshConcordanceView();
                this.refreshSettings();
            } catch {
            }
        }, 5000);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    private registerEvents(): void {
        this.registerEvent(
            this.app.vault.on('modify', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.scheduleIndexUpdate(file);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.app.workspace.layoutReady) {
                        this.scheduleIndexUpdate(file);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.indexer && this.isStartupComplete) {
                        void this.indexer.removeFile(oldPath);
                        this.scheduleIndexUpdate(file);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.indexer && this.isStartupComplete) {
                        void this.indexer.removeFile(file.path);
                        this.refreshConcordanceView();
                        this.refreshSettings();
                    }
                }
            })
        );

        // Context menu - editor mode
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor) => {
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);
                let hasReference = false;
                let matchedEntry: any = null;

                if (isEngineReady()) {
                    const activeFile = this.app.workspace.getActiveFile();
                    const sourceLang = this.getEffectiveSourceLanguage(activeFile);
                    const processedLine = this.transformForcedReferences(line);
                    const parsed = parseReferences(
                        processedLine,
                        sourceLang,
                        this.settings.outputLanguage,
                        this.settings.nameFormat
                    );

                    if (parsed && parsed.length > 0) {
                        const cursorCh = cursor.ch;
                        const isForced = line.includes('{{') && line.includes('}}');
                        for (const entry of parsed) {
                            let startPos = entry[1] as number;
                            let endPos = entry[2] as number;
                            if (isForced) {
                                startPos += 2;
                                endPos += 2;
                            }
                            if (cursorCh >= startPos && cursorCh < endPos) {
                                hasReference = true;
                                matchedEntry = entry;
                                break;
                            }
                        }
                    }
                }

                menu.addItem((item: any) => {
                    item.setTitle('con[VER]sum').setIcon('book-open');
                    const submenu = item.setSubmenu();
                    submenu.addItem((subItem: any) => {
                        subItem.setTitle('Open concordance').setIcon('book-open');
                        subItem.onClick(() => {
                            void this.openConcordanceView();
                        });
                    });
                    if (hasReference && matchedEntry) {
                        submenu.addItem((subItem: any) => {
                            subItem.setTitle('Find related notes').setIcon('link');
                            subItem.onClick(() => {
                                this.showRelatedNotesFromParsed([matchedEntry]);
                            });
                        });
                    }
                });
            })
        );

        // Context menu - reading mode
        this.registerDomEvent(activeDocument, 'contextmenu', (evt: MouseEvent) => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view || view.getMode() !== 'preview') return;
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile);
            let parsed: any[] | null = null;
            const selection = activeDocument.getSelection()?.toString() || '';
            if (selection) {
                const processedText = this.transformForcedReferences(selection);
                parsed = parseReferences(processedText, sourceLang, this.settings.outputLanguage, this.settings.nameFormat);
                if (parsed && parsed.length > 0) {
                    this.showReadingModeMenu(evt, parsed);
                    return;
                }
            }
            const element = activeDocument.elementFromPoint(evt.clientX, evt.clientY);
            if (!element) {
                this.showReadingModeMenu(evt, null);
                return;
            }
            const position = activeDocument.caretPositionFromPoint(evt.clientX, evt.clientY);
            let isAtEnd = false;
            if (position) {
                const container = position.offsetNode;
                const offset = position.offset;
                if (container && container.nodeType === Node.TEXT_NODE) {
                    const textNode = container as Text;
                    const text = textNode.textContent || '';
                    if (offset >= text.length) {
                        let nextSibling = textNode.nextSibling;
                        let hasTextAfter = false;
                        while (nextSibling) {
                            if (nextSibling.nodeType === Node.TEXT_NODE) {
                                const siblingText = (nextSibling as Text).textContent || '';
                                if (siblingText.trim().length > 0) {
                                    hasTextAfter = true;
                                    break;
                                }
                            } else if (nextSibling.nodeType === Node.ELEMENT_NODE) {
                                const elementText = (nextSibling as Element).textContent || '';
                                if (elementText.trim().length > 0) {
                                    hasTextAfter = true;
                                    break;
                                }
                            }
                            nextSibling = nextSibling.nextSibling;
                        }
                        if (!hasTextAfter) {
                            isAtEnd = true;
                        }
                    }
                }
            }
            if (isAtEnd) {
                this.showReadingModeMenu(evt, null);
                return;
            }
            let textToParse = '';
            const linkEl = element.closest('a');
            if (linkEl) {
                const dataBcv = linkEl.getAttribute('data-bcv');
                const linkText = linkEl.textContent || '';
                if (dataBcv) {
                    const displayText = linkEl.textContent || '';
                    const rangeKey = `${dataBcv}-${dataBcv}`;
                    const entry = this.indexer?.getReference(rangeKey);
                    if (entry) {
                        const refData = [[displayText, 0, displayText.length, [[dataBcv, dataBcv]]]];
                        this.showReadingModeMenu(evt, refData as any[]);
                    } else {
                        this.showReadingModeMenu(evt, null);
                    }
                    return;
                }
                const parent = linkEl.parentElement;
                if (parent) {
                    const parentText = parent.textContent || '';
                    const forceMatch = parentText.match(/\{\{(.+?)\}\}/);
                    if (forceMatch) {
                        textToParse = forceMatch[0];
                    } else {
                        textToParse = linkText;
                    }
                } else {
                    textToParse = linkText;
                }
            } else {
                if (position) {
                    const container = position.offsetNode;
                    if (container && container.nodeType === Node.TEXT_NODE) {
                        const textNode = container as Text;
                        const fullText = textNode.textContent || '';
                        const forceMatch = fullText.match(/\{\{(.+?)\}\}/);
                        if (forceMatch) {
                            textToParse = forceMatch[0];
                        } else {
                            textToParse = fullText;
                        }
                    }
                }
            }
            if (textToParse && !textToParse.includes('{{')) {
                const clickedText = textToParse.trim();
                if (clickedText.length === 0) {
                    const parentElement = element.closest('p, div, span, a');
                    if (parentElement) {
                        const fullText = parentElement.textContent || '';
                        const forceMatch = fullText.match(/\{\{(.+?)\}\}/);
                        if (forceMatch) {
                            textToParse = forceMatch[0];
                        }
                    }
                }
            }
            if (textToParse) {
                const processedText = this.transformForcedReferences(textToParse);
                const parsedResult = parseReferences(processedText, this.settings.sourceLanguage, this.settings.outputLanguage, this.settings.nameFormat);
                if (parsedResult && parsedResult.length > 0) {
                    const refText = parsedResult[0][0] as string;
                    const contextText = element.textContent || '';
                    const parentText = element.parentElement?.textContent || '';
                    const fullContext = parentText || contextText;
                    if (fullContext.includes(refText) || textToParse.includes(refText)) {
                        parsed = parsedResult;
                    }
                }
            }
            this.showReadingModeMenu(evt, parsed);
        });
    }

    private showReadingModeMenu(evt: MouseEvent, parsed: any[] | null): void {
        evt.preventDefault();
        evt.stopPropagation();
        const menu = new Menu();
        menu.addItem((item: any) => {
            item.setTitle('con[VER]sum').setIcon('book-open');
            const submenu = item.setSubmenu();
            submenu.addItem((subItem: any) => {
                subItem.setTitle('Open concordance').setIcon('book-open');
                subItem.onClick(() => {
                    void this.openConcordanceView();
                });
            });
            if (parsed && parsed.length > 0) {
                const position = activeDocument.caretPositionFromPoint(evt.clientX, evt.clientY);
                let isOnRef = false;
                if (position) {
                    const node = position.offsetNode;
                    const offset = position.offset;
                    if (node && node.nodeType === Node.TEXT_NODE) {
                        const text = (node as Text).textContent || '';
                        const refText = parsed[0][0] as string;
                        const cleanText = text.replace(/\{\{|\}\}/g, '');
                        if (cleanText.includes(refText)) {
                            const startIdx = cleanText.indexOf(refText);
                            const endIdx = startIdx + refText.length;
                            const beforeRef = text.substring(0, text.indexOf(refText));
                            const markerOffset = (beforeRef.match(/\{\{/g) || []).length * 2;
                            const cleanOffset = offset - markerOffset;
                            if (cleanOffset >= startIdx && cleanOffset < endIdx) {
                                isOnRef = true;
                            }
                        }
                    } else if (node && node.nodeType === Node.ELEMENT_NODE) {
                        const parent = node as Element;
                        const text = parent.textContent || '';
                        const refText = parsed[0][0] as string;
                        if (text.includes(refText)) {
                            isOnRef = true;
                        }
                    }
                }
                if (isOnRef) {
                    submenu.addItem((subItem: any) => {
                        subItem.setTitle('Find related notes').setIcon('link');
                        subItem.onClick(() => {
                            this.showRelatedNotesFromParsed(parsed);
                        });
                    });
                }
            }
        });
        menu.showAtPosition({ x: evt.clientX, y: evt.clientY - 70 });
    }

    // ============================================================
    // COMMANDS
    // ============================================================

    private addCommands(): void {
        this.addCommand({
            id: 'find-related-notes',
            name: 'Find related notes',
            icon: 'link',
            editorCallback: (editor: Editor) => {
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);
                this.findRelatedNotesAtCursor(editor, cursor, line);
            }
        });
        this.addCommand({
            id: 'open-concordance',
            name: 'Open concordance',
            icon: 'book-open',
            callback: () => void this.openConcordanceView()
        });
    }

    // ============================================================
    // VIEW MANAGEMENT
    // ============================================================

    async openConcordanceView(): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONVERSUM_CONCORDANCE)[0];
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (!rightLeaf) {
                new Notice('Could not create view');
                return;
            }
            await rightLeaf.setViewState({
                type: VIEW_TYPE_CONVERSUM_CONCORDANCE,
                active: true
            });
            leaf = rightLeaf;
        }
        await workspace.revealLeaf(leaf);
    }

    public refreshConcordanceView(): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONVERSUM_CONCORDANCE);
        for (const leaf of leaves) {
            const view = leaf.view as ConcordanceView;
            if (view && typeof view.refresh === 'function') {
                view.refresh();
            }
        }
    }

    public refreshSettings(): void {
        if (this.settingsTab) {
            if (this.settingsTab.containerEl && this.settingsTab.containerEl.children.length > 0) {
                this.settingsTab.display();
                return;
            }
        }
        const settingTabs = (this.app as any).setting?.tabContainer?.children;
        if (settingTabs) {
            for (const child of settingTabs) {
                if (child.textContent?.includes('con[VER]sum')) {
                    const tab = child;
                    if (tab && typeof tab.display === 'function') {
                        tab.display();
                    }
                    break;
                }
            }
        }
    }

    // ============================================================
    // EFFECTIVE SOURCE LANGUAGE
    // ============================================================

    private getEffectiveSourceLanguage(file: TFile | null): string {
        if (!file || !this.db) return this.settings.sourceLanguage;
        const language = this.db.getFileLanguage(file.path);
        return language || this.settings.sourceLanguage;
    }

    // ============================================================
    // FIND REFERENCE AT CURSOR
    // ============================================================

    private findReferenceAtPosition(line: string, position: number, sourceLang: string): { text: string; startBcv: string; endBcv: string } | null {
        if (!isEngineReady()) return null;
        const processedLine = this.transformForcedReferences(line);
        const parsed = parseReferences(
            processedLine,
            sourceLang,
            this.settings.outputLanguage,
            this.settings.nameFormat
        );
        if (!parsed || parsed.length === 0) {
            return null;
        }
        for (const entry of parsed) {
            const startPos = entry[1] as number;
            const endPos = entry[2] as number;
            const matchedText = entry[0] as string;
            const ranges = entry[3] as string[][];
            if (position >= startPos && position < endPos) {
                if (ranges && ranges.length > 0) {
                    return {
                        text: matchedText,
                        startBcv: ranges[0][0],
                        endBcv: ranges[0][1]
                    };
                }
            }
        }
        return null;
    }

    private showRelatedNotesFromParsed(parsed: any[], evt?: MouseEvent): void {
        if (!parsed || parsed.length === 0) {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile);
            const langName = getAvailableLanguages().find(l => l.language_code === sourceLang)?.language_name || sourceLang;
            new Notice(`No scripture reference found in ${langName}`);
            return;
        }
        
        const ranges = parsed[0][3] as string[][];
        if (!ranges || ranges.length === 0) {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile);
            const langName = getAvailableLanguages().find(l => l.language_code === sourceLang)?.language_name || sourceLang;
            new Notice(`No valid reference found in ${langName}`);
            return;
        }

        const startBcv = ranges[0][0];
        const endBcv = ranges[0][1];
        if (!startBcv || startBcv.length < 8) {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile);
            const langName = getAvailableLanguages().find(l => l.language_code === sourceLang)?.language_name || sourceLang;
            new Notice(`Invalid reference format in ${langName}`);
            return;
        }

        const matchingEntries = this.indexer?.findReferencesContainingRange(startBcv, endBcv) || [];
        if (matchingEntries.length === 0) {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile);
            const langName = getAvailableLanguages().find(l => l.language_code === sourceLang)?.language_name || sourceLang;
            new Notice(`No notes found for this reference in ${langName}`);
            return;
        }

        const firstEntry = matchingEntries[0][1];
        const formatted = this.formatReferenceOnTheFly(firstEntry);
        if (evt) {
            this.relatedPopout?.showWithEntries(startBcv, formatted, matchingEntries, evt.clientX, evt.clientY);
        } else {
            this.relatedPopout?.showWithEntries(startBcv, formatted, matchingEntries, window.innerWidth / 2 - 150, window.innerHeight / 2 - 100);
        }
    }

    private findRelatedNotesAtCursor(editor: Editor, cursor: EditorPosition, line: string): void {
        if (!isEngineReady()) {
            new Notice('Engine not ready');
            return;
        }
        if (!this.indexer) {
            new Notice('Indexer not initialized');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        const sourceLang = this.getEffectiveSourceLanguage(activeFile);
        const result = this.findReferenceAtPosition(line, cursor.ch, sourceLang);
        if (!result) {
            const wordMatch = line.substring(0, cursor.ch).match(/\S+$/);
            const nextWordMatch = line.substring(cursor.ch).match(/^\S+/);
            const word = wordMatch ? wordMatch[0] : (nextWordMatch ? nextWordMatch[0] : null);
            if (word) {
                new Notice(`"${word}" is not a scripture reference`);
            } else {
                new Notice('No scripture reference found at cursor');
            }
            return;
        }

        const { text: reference, startBcv, endBcv } = result;
        if (!startBcv || startBcv.length < 8) {
            new Notice('Invalid reference format');
            return;
        }
        const matchingEntries = this.indexer.findReferencesContainingRange(startBcv, endBcv);
        if (matchingEntries.length === 0) {
            const langName = getAvailableLanguages().find(l => l.code === sourceLang)?.vernacularName || sourceLang;
            new Notice(`No notes found for "${reference}" in ${langName}`);
            return;
        }

        const firstEntry = matchingEntries[0][1];
        const formatted = this.formatReferenceOnTheFly(firstEntry);
        let x = 0, y = 0;
        try {
            const editorView = (editor as any).cm?.view || (editor as any).cm;
            if (editorView && typeof editorView.coordsAtPos === 'function') {
                const pos = editorView.posAtCoords({ line: cursor.line, ch: cursor.ch });
                if (pos !== null && pos !== undefined) {
                    const coords = editorView.coordsAtPos(pos);
                    if (coords) {
                        x = coords.left || 0;
                        y = (coords.top || 0) + 25;
                    }
                }
            }
        } catch {
        }

        if (x === 0 && y === 0) {
            const activeEl = activeDocument.activeElement;
            if (activeEl) {
                const rect = activeEl.getBoundingClientRect();
                x = rect.left + 20;
                y = rect.top + 40;
            }
        }
        if (x === 0 && y === 0) {
            x = window.innerWidth / 2 - 150;
            y = window.innerHeight / 2 - 100;
        }
        this.relatedPopout?.showWithEntries(startBcv, formatted, matchingEntries, x, y);
    }

    // ============================================================
    // EXPORT
    // ============================================================

    async exportConcordance(): Promise<void> {
        if (!this.indexer) {
            new Notice('Indexer not initialized');
            return;
        }
        const data = this.indexer.getData();
        if (!data || Object.keys(data.references).length === 0) {
            new Notice('No references to export');
            return;
        }
        try {
            const content = this.generateConcordanceContent(data);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            const fileName = `Concordance-${timestamp}.md`;
            const filePath = `/${fileName}`;
            const file = await this.app.vault.create(filePath, content);
            await this.app.workspace.openLinkText(file.path, '');
            new Notice(`Concordance exported: ${fileName}`);
        } catch {
            new Notice('Export failed. See console for details.');
        }
    }

    private generateConcordanceContent(data: any): string {
        const lines: string[] = [];
        const vaultName = this.app.vault.getName();
        lines.push(`# ${vaultName} — Scripture Concordance`);
        lines.push('');
        lines.push(`Generated: ${new Date().toLocaleString()}`);
        lines.push(`Unique references: ${Object.keys(data.references).length}`);
        lines.push(`Files indexed: ${Object.keys(data.fileCache).length}`);
        lines.push('');
        lines.push('---');

        const grouped = this.indexer!.getGroupedReferences();
        for (const [bookId, chapterMap] of grouped) {
            const bookName = getBookName(
                bookId,
                this.settings.outputLanguage,
                'full'
            );
            lines.push(`## ${bookName || `Book ${bookId}`}`);
            lines.push('');
            const allRefs: Array<[string, ReferenceIndexEntry, string | null]> = [];
            for (const [, refs] of chapterMap) {
                for (const ref of refs) {
                    allRefs.push(ref);
                }
            }
            allRefs.sort((a, b) => {
                const aStart = a[0].split('-')[0];
                const bStart = b[0].split('-')[0];
                const aCh = parseInt(aStart.substring(2, 5));
                const bCh = parseInt(bStart.substring(2, 5));
                if (aCh !== bCh) return aCh - bCh;
                return parseInt(aStart.substring(5, 8)) - parseInt(bStart.substring(5, 8));
            });

            for (const [key, entry, formatted] of allRefs) {
                let formattedRef: string;
                if (formatted) {
                    formattedRef = formatted;
                } else {
                    const ranges: Array<[string, string]> = [[
                        `${String(entry.bcv.bookId).padStart(2, '0')}${String(entry.bcv.chapter).padStart(3, '0')}${String(entry.bcv.startVerse).padStart(3, '0')}`,
                        `${String(entry.bcv.bookId).padStart(2, '0')}${String(entry.bcv.endChapter !== undefined && entry.bcv.endChapter !== entry.bcv.chapter ? entry.bcv.endChapter : entry.bcv.chapter).padStart(3, '0')}${String(entry.bcv.endVerse).padStart(3, '0')}`
                    ]];
                    const decoded = decodeScriptures(
                        ranges,
                        this.settings.outputLanguage,
                        this.settings.nameFormat
                    );
                    formattedRef = decoded && decoded.length > 0 ? decoded[0] : `${entry.startBcv}-${entry.endBcv}`;
                }

                const filesWithCounts = this.db?.getFilesWithCounts(key) || [];
                const sortedFiles = filesWithCounts
                    .map(f => ({ path: f.path, occurrences: f.occurrences }))
                    .sort((a, b) => a.path.localeCompare(b.path));
                const fileEntries: string[] = [];
                for (const file of sortedFiles) {
                    const fileName = file.path.replace(/\.md$/, '');
                    fileEntries.push(`[[${fileName}]]\u2009(${file.occurrences})`);
                }
                lines.push(`**${formattedRef}** — ${fileEntries.join('; ')}`);
            }
            lines.push('');
            lines.push('---');
        }
        lines.push('---');
        lines.push('');
        lines.push(`*Generated by \`con[VER]sum v${this.manifest.version}\`*`);
        return lines.join('\n');
    }
}