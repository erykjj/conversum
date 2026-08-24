// indexer.ts

import type { Vault, TFile } from 'obsidian';
import { IndexDatabase } from './database';
import { parseReferences, isEngineReady, decodeScriptures, resolveLanguage } from './engine-wrapper';
import type ConversumPlugin from './main';
import { ReferenceIndexEntry, FileCacheEntry, IndexProgress, ConversumData, NameFormat, ParsedReference } from './types';

export function getRangeKey(startBcv: string, endBcv: string): string {
    return `${startBcv}-${endBcv}`;
}

export function getStartBcvFromKey(key: string): string {
    return key.split('-')[0];
}

interface FileReference {
    startBcv: string;
    endBcv: string;
    bookId: number;
    chapter: number;
    startVerse: number;
    endVerse: number;
    endChapter?: number;
}

interface FrontmatterData {
    [key: string]: string;
}

export class ScriptureIndexer {
    private vault: Vault;
    private plugin: ConversumPlugin;
    private sourceLanguage: string;
    private outputLanguage: string;
    private nameFormat: NameFormat;
    private excludedFolders: string[];
    private pluginVersion: string;
    private db: IndexDatabase;
    private data: ConversumData;
    private progress: IndexProgress = {
        totalFiles: 0,
        processedFiles: 0,
        referencesFound: 0,
        uniqueReferences: 0,
        status: 'idle'
    };
    private isIndexing = false;
    private abortRequested = false;
    private isFormatting = false;
    private formattingAbortRequested = false;
    private formattingTimeout: number | null = null;
    private formattingBatchSize = 50;
    private formattingDelayMs = 200;

    constructor(
        vault: Vault,
        plugin: ConversumPlugin,
        sourceLanguage: string,
        outputLanguage: string,
        nameFormat: NameFormat,
        excludedFolders: string[],
        pluginVersion: string,
        db: IndexDatabase
    ) {
        this.vault = vault;
        this.plugin = plugin;
        this.sourceLanguage = sourceLanguage;
        this.outputLanguage = outputLanguage;
        this.nameFormat = nameFormat;
        this.excludedFolders = excludedFolders;
        this.pluginVersion = pluginVersion;
        this.db = db;
        this.data = db.getData();
    }

    public isIndexingBusy(): boolean {
        return this.isIndexing;
    }

    public getEmptyData(): ConversumData {
        return {
            version: this.pluginVersion,
            lastUpdated: 0,
            references: {},
            fileCache: {}
        };
    }

    public isExcluded(filePath: string): boolean {
        const configDir = this.plugin.app.vault.configDir;
        const hardcodedExclusions = ['_templates', '_attachments', configDir];
        for (const folder of hardcodedExclusions) {
            if (filePath.startsWith(folder + '/') || filePath === folder) {
                return true;
            }
        }
        for (const folder of this.excludedFolders) {
            if (filePath.startsWith(folder + '/') || filePath === folder) {
                return true;
            }
        }
        if (filePath.startsWith('Concordance-') && filePath.endsWith('.md')) {
            return true;
        }
        return false;
    }

    private extractFrontmatter(content: string): FrontmatterData | null {
        if (!content.startsWith('---')) return null;
        const endIndex = content.indexOf('---', 3);
        if (endIndex === -1) return null;
        const frontmatterText = content.substring(3, endIndex).trim();
        const result: FrontmatterData = {};
        for (const line of frontmatterText.split('\n')) {
            const match = line.match(/^([^:]+):\s*(.+)$/);
            if (match) {
                const key = match[1].trim().toLowerCase();
                let value = match[2].trim();
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.slice(1, -1);
                }
                result[key] = value;
            }
        }
        return result;
    }

    private getFileLanguage(content: string): string | null {
        const frontmatter = this.extractFrontmatter(content);
        if (!frontmatter) return null;
        const language = frontmatter['language'];
        if (!language || typeof language !== 'string') return null;
        const raw = language.trim();
        return resolveLanguage(raw);
    }

    private stripFrontmatter(content: string): string {
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                return content.substring(endIndex + 3);
            }
        }
        return content;
    }

    private parseFileReferences(content: string): FileReference[] {
        const result: FileReference[] = [];
        if (!isEngineReady()) {
            return result;
        }

        const contentWithoutFrontmatter = this.stripFrontmatter(content);
        let fileLanguage = this.sourceLanguage;
        const frontmatterLang = this.getFileLanguage(content);
        if (frontmatterLang) {
            fileLanguage = frontmatterLang;
        }

        let processedContent = contentWithoutFrontmatter;
        if (processedContent.includes('{{')) {
            processedContent = processedContent.replace(/\{\{(.+?)\}\}/g, (_match, inner: string) => {
                const cleaned = inner.replace(/\*\*/g, '').replace(/\*/g, '');
                return '⟪⟪' + cleaned + '⟫⟫';
            });
        }

        try {
            const parsed = parseReferences(
                processedContent,
                fileLanguage,
                this.outputLanguage,
                this.nameFormat
            );
            if (!parsed) return result;
            for (const entry of parsed) {
                const ranges = entry[3];
                if (!ranges || ranges.length === 0) continue;
                for (const range of ranges) {
                    const startBcv = range[0];
                    const endBcv = range[1];
                    if (!startBcv || startBcv.length < 8) continue;
                    if (!endBcv || endBcv.length < 8) continue;
                    const bookId = parseInt(startBcv.substring(0, 2));
                    const chapter = parseInt(startBcv.substring(2, 5));
                    const startVerse = parseInt(startBcv.substring(5, 8));
                    const endVerse = parseInt(endBcv.substring(5, 8));
                    const endChapter = parseInt(endBcv.substring(2, 5));
                    result.push({ 
                        startBcv, 
                        endBcv, 
                        bookId, 
                        chapter, 
                        startVerse,
                        endVerse,
                        endChapter
                    });
                }
            }
        } catch {
            // Parsing failed - no references found
        }
        return result;
    }

    // ============================================================
    // FORMATTING
    // ============================================================

    async clearFormatted(): Promise<void> {
        this.abortFormatting();
        try {
            this.db.beginTransaction();
            this.db.clearFormattedReferences();
            await this.db.commitTransaction();
        } catch (e) {
            this.db.rollbackTransaction();
            throw e;
        }
    }

    abortFormatting(): void {
        this.formattingAbortRequested = true;
        if (this.formattingTimeout) {
            window.clearTimeout(this.formattingTimeout);
            this.formattingTimeout = null;
        }
        this.isFormatting = false;
    }

    startBackgroundFormatting(): void {
        if (this.isFormatting) {
            this.abortFormatting();
            window.setTimeout(() => {
                this.startBackgroundFormatting();
            }, 50);
            return;
        }
        if (this.isIndexing) {
            window.setTimeout(() => {
                this.startBackgroundFormatting();
            }, 5000);
            return;
        }
        const unformattedCount = this.db.getUnformattedCount();
        if (unformattedCount === 0) {
            this.plugin.refreshSettings();
            return;
        }
        this.isFormatting = true;
        this.formattingAbortRequested = false;
        this.plugin.refreshSettings();
        this.formattingTimeout = window.setTimeout(() => {
            void this.formatBatch();
        }, 100);
    }

    private async formatBatch(): Promise<void> {
        if (this.formattingAbortRequested) {
            this.isFormatting = false;
            this.plugin.refreshSettings();
            return;
        }
        const rangeKeys = this.db.getUnformattedRangeKeys(this.formattingBatchSize);
        if (rangeKeys.length === 0) {
            this.isFormatting = false;
            this.plugin.refreshConcordanceView();
            this.plugin.refreshSettings();
            return;
        }
        try {
            this.db.beginTransaction();
            for (const rangeKey of rangeKeys) {
                if (this.formattingAbortRequested) break;
                try {
                    const data = this.db.getOccurrenceData(rangeKey);
                    if (!data) {
                        continue;
                    }
                    const ranges: Array<[string, string]> = [[
                        `${String(data.bookId).padStart(2, '0')}${String(data.chapter).padStart(3, '0')}${String(data.startVerse).padStart(3, '0')}`,
                        `${String(data.bookId).padStart(2, '0')}${String(data.endChapter !== undefined && data.endChapter !== data.chapter ? data.endChapter : data.chapter).padStart(3, '0')}${String(data.endVerse).padStart(3, '0')}`
                    ]];
                    const decoded = decodeScriptures(
                        ranges,
                        this.outputLanguage,
                        this.nameFormat
                    );
                    const formatted = decoded && decoded.length > 0 ? decoded[0] : `${data.startBcv}-${data.endBcv}`;
                    this.db.updateFormatted(rangeKey, formatted);
                } catch {
                    // Skip failed formatting
                }
            }
            if (!this.formattingAbortRequested) {
                await this.db.commitTransaction();
            } else {
                this.db.rollbackTransaction();
                this.isFormatting = false;
                this.plugin.refreshSettings();
                return;
            }
            this.plugin.refreshSettings();
            this.formattingTimeout = window.setTimeout(() => {
                void this.formatBatch();
            }, this.formattingDelayMs);
        } catch {
            this.db.rollbackTransaction();
            this.isFormatting = false;
            this.plugin.refreshSettings();
        }
    }

    isFormattingBusy(): boolean {
        return this.isFormatting;
    }

    // ============================================================
    // INDEXING
    // ============================================================

    async rebuildIndex(onProgress?: (progress: IndexProgress) => void): Promise<ConversumData> {
        if (this.isIndexing) {
            console.warn('con[VER]sum: Indexing already in progress');
            return this.data;
        }
        this.isIndexing = true;
        this.abortRequested = false;
        this.progress.status = 'scanning';
        this.progress.processedFiles = 0;
        this.progress.referencesFound = 0;
        this.progress.uniqueReferences = 0;
        try {
            this.plugin.settings.rebuildStatus = 'in_progress';
            await this.plugin.saveSettings();
        } catch {
            // Save failed - continue anyway
        }
        try {
            const files = this.vault.getMarkdownFiles();
            const filteredFiles = files.filter((f: TFile) => !this.isExcluded(f.path));
            this.progress.totalFiles = filteredFiles.length;
            this.progress.status = 'processing';
            onProgress?.(this.progress);
            this.db.beginTransaction();
            try {
                this.db.clearAllData();
                const newData = this.getEmptyData();
                this.data = newData;
                this.db.setData(newData);
                await this.db.commitTransaction();
            } catch (e) {
                this.db.rollbackTransaction();
                throw e;
            }
            this.db.beginTransaction();
            const referenceMap = new Map<string, ReferenceIndexEntry>();
            const fileCache: { [filePath: string]: FileCacheEntry } = {};
            const uniqueRefs = new Set<string>();
            let processedCount = 0;
            for (const file of filteredFiles) {
                if (this.abortRequested) {
                    this.db.rollbackTransaction();
                    this.progress.status = 'idle';
                    this.isIndexing = false;
                    return this.data;
                }
                this.progress.currentFile = file.path;
                try {
                    const content = await this.vault.read(file);
                    const fileLanguage = this.getFileLanguage(content);
                    const occurrences = this.parseFileReferences(content);
                    const fileRefs: string[] = [];
                    if (occurrences.length > 0) {
                        for (const occ of occurrences) {
                            const key = getRangeKey(occ.startBcv, occ.endBcv);
                            fileRefs.push(key);
                            this.progress.referencesFound++;
                            uniqueRefs.add(key);
                            this.db.insertOccurrence(
                                key,
                                file.path,
                                occ.startBcv,
                                occ.endBcv,
                                occ.bookId,
                                occ.chapter,
                                occ.startVerse,
                                occ.endVerse,
                                occ.endChapter
                            );
                            if (referenceMap.has(key)) {
                                const entry = referenceMap.get(key)!;
                                const existingFile = entry.files.find((f) => f.path === file.path);
                                if (existingFile) {
                                    existingFile.occurrences++;
                                } else {
                                    entry.files.push({ path: file.path, occurrences: 1 });
                                }
                                entry.totalOccurrences++;
                            } else {
                                referenceMap.set(key, {
                                    startBcv: occ.startBcv,
                                    endBcv: occ.endBcv,
                                    bcv: {
                                        bookId: occ.bookId,
                                        chapter: occ.chapter,
                                        startVerse: occ.startVerse,
                                        endVerse: occ.endVerse,
                                        endChapter: occ.endChapter
                                    },
                                    files: [{ path: file.path, occurrences: 1 }],
                                    totalOccurrences: 1
                                });
                                this.progress.uniqueReferences++;
                            }
                        }
                    }
                    this.db.upsertFileIndex(file.path, file.stat.mtime, fileLanguage);
                    fileCache[file.path] = {
                        hash: '',
                        references: fileRefs,
                        lastModified: file.stat.mtime
                    };
                } catch (e) {
                    console.error(`con[VER]sum: Error processing ${file.path}:`, e);
                }
                processedCount++;
                this.progress.processedFiles = processedCount;
                this.progress.uniqueReferences = uniqueRefs.size;
                onProgress?.(this.progress);
            }
            const newData = this.getEmptyData();
            newData.references = Object.fromEntries(referenceMap);
            newData.fileCache = fileCache;
            newData.lastUpdated = Date.now();
            newData.version = this.pluginVersion;
            this.data = newData;
            this.db.setData(newData);
            await this.db.commitTransaction();
            this.db.beginTransaction();
            this.db.cleanupOrphans();
            await this.db.commitTransaction();
            try {
                this.plugin.settings.rebuildStatus = 'complete';
                await this.plugin.saveSettings();
            } catch {
                // Save failed - index is still built
            }
            this.progress.status = 'complete';
            this.progress.currentFile = undefined;
            onProgress?.(this.progress);
            this.startBackgroundFormatting();
            return this.data;
        } catch (e) {
            this.db.rollbackTransaction();
            try {
                this.plugin.settings.rebuildStatus = 'failed';
                await this.plugin.saveSettings();
            } catch {
                // Save failed
            }
            this.progress.status = 'error';
            console.error('con[VER]sum: Index rebuild failed:', e);
            throw e;
        } finally {
            this.isIndexing = false;
        }
    }

    async updateFile(file: TFile, skipFormatting: boolean = false): Promise<void> {
        if (this.isExcluded(file.path)) return;
        if (this.isIndexing) {
            return;
        }
        try {
            const content = await this.vault.read(file);
            const cached = this.data.fileCache[file.path];
            if (cached && cached.lastModified === file.stat.mtime) {
                return;
            }
            const fileLanguage = this.getFileLanguage(content);
            this.isIndexing = true;
            this.db.beginTransaction();
            try {
                if (cached) {
                    for (const key of cached.references) {
                        const entry = this.data.references[key];
                        if (entry) {
                            const idx = entry.files.findIndex((f) => f.path === file.path);
                            if (idx !== -1) {
                                entry.files.splice(idx, 1);
                                entry.totalOccurrences -= 1;
                            }
                            if (entry.files.length === 0) {
                                delete this.data.references[key];
                            }
                        }
                    }
                }
                this.db.deleteFileReferences(file.path);
                const occurrences = this.parseFileReferences(content);
                const fileRefs: string[] = [];
                for (const occ of occurrences) {
                    const key = getRangeKey(occ.startBcv, occ.endBcv);
                    fileRefs.push(key);
                    this.db.insertOccurrence(
                        key,
                        file.path,
                        occ.startBcv,
                        occ.endBcv,
                        occ.bookId,
                        occ.chapter,
                        occ.startVerse,
                        occ.endVerse,
                        occ.endChapter
                    );
                    if (this.data.references[key]) {
                        const entry = this.data.references[key];
                        const existingFile = entry.files.find((f) => f.path === file.path);
                        if (existingFile) {
                            existingFile.occurrences++;
                        } else {
                            entry.files.push({ path: file.path, occurrences: 1 });
                        }
                        entry.totalOccurrences++;
                    } else {
                        this.data.references[key] = {
                            startBcv: occ.startBcv,
                            endBcv: occ.endBcv,
                            bcv: {
                                bookId: occ.bookId,
                                chapter: occ.chapter,
                                startVerse: occ.startVerse,
                                endVerse: occ.endVerse,
                                endChapter: occ.endChapter
                            },
                            files: [{ path: file.path, occurrences: 1 }],
                            totalOccurrences: 1
                        };
                    }
                }
                this.db.upsertFileIndex(file.path, file.stat.mtime, fileLanguage);
                this.data.fileCache[file.path] = {
                    hash: '',
                    references: fileRefs,
                    lastModified: file.stat.mtime
                };
                this.data.lastUpdated = Date.now();
                this.db.setData(this.data);
                await this.db.commitTransaction();
                this.db.beginTransaction();
                this.db.cleanupOrphans();
                await this.db.commitTransaction();
                if (occurrences.length > 0 && !skipFormatting) {
                    this.startBackgroundFormatting();
                }
            } catch (e) {
                this.db.rollbackTransaction();
                throw e;
            } finally {
                this.isIndexing = false;
            }
        } catch {
            // File read failed - skip
        }
    }

    async removeFile(filePath: string): Promise<void> {
        if (this.isIndexing) {
            return;
        }
        try {
            const cached = this.data.fileCache[filePath];
            if (!cached) {
                const fileIndex = this.db.getFileIndex(filePath);
                if (!fileIndex) return;
            }
            this.db.beginTransaction();
            if (cached) {
                for (const key of cached.references) {
                    const entry = this.data.references[key];
                    if (entry) {
                        const idx = entry.files.findIndex((f) => f.path === filePath);
                        if (idx !== -1) {
                            entry.files.splice(idx, 1);
                            entry.totalOccurrences -= 1;
                        }
                        if (entry.files.length === 0) {
                            delete this.data.references[key];
                        }
                    }
                }
            }
            delete this.data.fileCache[filePath];
            this.data.lastUpdated = Date.now();
            this.db.setData(this.data);
            this.db.deleteFileReferences(filePath);
            this.db.cleanupOrphans();
            await this.db.commitTransaction();
        } catch (e) {
            this.db.rollbackTransaction();
            console.error(`con[VER]sum: Failed to remove file ${filePath}:`, e);
        }
    }

    async rebuildAllHTML(): Promise<void> {
        const rangeKeys = this.db.getAllRangeKeys();
        this.db.beginTransaction();
        try {
            for (const rangeKey of rangeKeys) {
                try {
                    this.db.getFormatted(rangeKey);
                } catch {
                    // Skip
                }
            }
            await this.db.commitTransaction();
        } catch (e) {
            this.db.rollbackTransaction();
            throw e;
        }
    }

    // ============================================================
    // GETTERS / SETTERS
    // ============================================================

    getData(): ConversumData {
        return this.data;
    }

    setData(data: ConversumData): void {
        this.data = data;
        this.db.setData(data);
    }

    getProgress(): IndexProgress {
        return { ...this.progress };
    }

    isBusy(): boolean {
        return this.isIndexing || this.isFormatting;
    }

    abort(): void {
        this.abortRequested = true;
        this.abortFormatting();
    }

    updateSettings(
        sourceLanguage: string,
        outputLanguage: string,
        nameFormat: NameFormat,
        excludedFolders: string[]
    ): void {
        const outputChanged = this.outputLanguage !== outputLanguage || this.nameFormat !== nameFormat;
        this.sourceLanguage = sourceLanguage;
        this.outputLanguage = outputLanguage;
        this.nameFormat = nameFormat;
        this.excludedFolders = excludedFolders;
        if (outputChanged) {
            void this.clearFormatted().then(() => {
                this.startBackgroundFormatting();
            });
        }
    }

    // ============================================================
    // QUERY OPERATIONS
    // ============================================================

    getSortedReferences(): Array<[string, ReferenceIndexEntry]> {
        const entries = Object.entries(this.data.references);
        entries.sort((a, b) => {
            const aStart = a[0].split('-')[0];
            const bStart = b[0].split('-')[0];
            const aBook = parseInt(aStart.substring(0, 2));
            const bBook = parseInt(bStart.substring(0, 2));
            if (aBook !== bBook) return aBook - bBook;
            const aCh = parseInt(aStart.substring(2, 5));
            const bCh = parseInt(bStart.substring(2, 5));
            if (aCh !== bCh) return aCh - bCh;
            return parseInt(aStart.substring(5, 8)) - parseInt(bStart.substring(5, 8));
        });
        return entries;
    }

    getGroupedReferences(): Map<number, Map<number, Array<[string, ReferenceIndexEntry, string | null]>>> {
        return this.db.getGroupedReferences();
    }

    getReference(rangeKey: string): ReferenceIndexEntry | null {
        if (!rangeKey) return null;
        const normalized = rangeKey.replace(/[‑–—]/g, '-');
        if (this.data.references[normalized]) {
            return this.data.references[normalized];
        }
        const startBcv = normalized.split('-')[0];
        for (const [, entry] of Object.entries(this.data.references)) {
            if (entry.startBcv === startBcv) {
                return entry;
            }
        }
        return null;
    }

    findReferenceByStartBcv(startBcv: string, endBcv: string): ReferenceIndexEntry | null {
        return this.db.findReferenceByStartBcv(startBcv, endBcv);
    }

    searchReferences(query: string): Array<[string, ReferenceIndexEntry]> {
        return this.db.searchReferences(query);
    }

    findReferencesContainingRange(
        startBcv: string,
        endBcv: string
    ): Array<[string, ReferenceIndexEntry]> {
        return this.db.findReferencesContainingRange(startBcv, endBcv);
    }
}