// related.ts

import { TFile, Notice } from 'obsidian';
import type ConversumPlugin from './main';
import { ReferenceIndexEntry } from './types';

export class RelatedNotesPopout {
    private plugin: ConversumPlugin;
    private popoutEl: HTMLElement | null = null;
    private currentReference: string | null = null;
    private closeTimeout: number | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private rightClickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(plugin: ConversumPlugin) {
        this.plugin = plugin;
    }

    show(referenceKey: string, formatted: string, x: number, y: number): void {
        this.forceClose();
        this.currentReference = referenceKey;
        this.render(formatted, x, y);
    }

    forceClose(): void {
        if (this.closeTimeout) {
            window.clearTimeout(this.closeTimeout);
            this.closeTimeout = null;
        }
        if (this.clickOutsideHandler) {
            activeDocument.removeEventListener('click', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
        if (this.escapeHandler) {
            activeDocument.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
        if (this.rightClickHandler) {
            activeDocument.removeEventListener('contextmenu', this.rightClickHandler);
            this.rightClickHandler = null;
        }
        if (this.popoutEl) {
            this.popoutEl.remove();
            this.popoutEl = null;
            this.currentReference = null;
        }
    }

    close(): void {
        if (this.closeTimeout) {
            window.clearTimeout(this.closeTimeout);
            this.closeTimeout = null;
        }
        this.closeTimeout = window.setTimeout(() => {
            this.forceClose();
        }, 200);
    }

    private render(formatted: string, x: number, y: number): void {
        this.forceClose();
        const data = this.plugin.indexer?.getData();
        if (!data || !this.currentReference) return;
        const fileOccurrences = new Map<string, number>();
        const refStartBcv = this.currentReference;
        const refEndBcv = this.currentReference;
        const refStartBook = parseInt(refStartBcv.substring(0, 2));
        const refStartChapter = parseInt(refStartBcv.substring(2, 5));
        const refStartVerse = parseInt(refStartBcv.substring(5, 8));
        const refEndVerse = parseInt(refEndBcv.substring(5, 8));
        for (const [, entry] of Object.entries(data.references)) {
            const entryStartBcv = entry.startBcv;
            const entryEndBcv = entry.endBcv;
            const entryStartBook = parseInt(entryStartBcv.substring(0, 2));
            const entryStartChapter = parseInt(entryStartBcv.substring(2, 5));
            const entryStartVerse = parseInt(entryStartBcv.substring(5, 8));
            const entryEndVerse = parseInt(entryEndBcv.substring(5, 8));
            const isContained = 
                entryStartBook === refStartBook &&
                entryStartChapter === refStartChapter &&
                entryStartVerse <= refStartVerse &&
                entryEndVerse >= refEndVerse;
            if (isContained) {
                for (const file of entry.files) {
                    const currentCount = fileOccurrences.get(file.path) || 0;
                    fileOccurrences.set(file.path, currentCount + file.occurrences);
                }
            }
        }
        if (fileOccurrences.size === 0) {
            new Notice(`No notes found for "${formatted}"`);
            return;
        }
        const allFiles = Array.from(fileOccurrences.entries()).map(([path, occurrences]) => ({
            path,
            occurrences
        }));
        allFiles.sort((a, b) => a.path.localeCompare(b.path));
        const currentFile = this.plugin.app.workspace.getActiveFile();
        const currentFilePath = currentFile ? currentFile.path : null;
        const otherFiles = allFiles.filter(f => f.path !== currentFilePath);
        const popout = activeDocument.createElement('div');
        popout.className = 'conversum-related-popout';
        let left = x + 20;
        let top = y + 10;
        const popoutWidth = 500;
        const popoutHeight = 220;
        const margin = 10;
        if (left + popoutWidth > window.innerWidth - margin) {
            left = window.innerWidth - popoutWidth - margin;
        }
        if (left < margin) {
            left = margin;
        }
        if (top + popoutHeight > window.innerHeight - margin) {
            top = window.innerHeight - popoutHeight - margin;
        }
        if (top < margin) {
            top = margin;
        }
        popout.style.left = left + 'px';
        popout.style.top = top + 'px';
        const header = popout.createDiv({ cls: 'conversum-related-popout-header' });
        header.createEl('span', { text: formatted, cls: 'conversum-related-popout-title' });
        const body = popout.createDiv({ cls: 'conversum-related-popout-body' });
        if (otherFiles.length === 0) {
            body.createEl('p', {
                text: 'This reference appears only in the current note.',
                cls: 'conversum-related-popout-empty'
            });
        } else {
            const fileList = body.createDiv({ cls: 'conversum-related-popout-files' });
            for (const file of otherFiles) {
                const fileEl = fileList.createDiv({ cls: 'conversum-related-popout-file' });
                const entryContainer = fileEl.createDiv({ cls: 'conversum-related-popout-entry' });
                const link = entryContainer.createEl('a', {
                    text: file.path,
                    cls: 'conversum-related-popout-link'
                });
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const fileObj = this.plugin.app.vault.getAbstractFileByPath(file.path);
                    if (fileObj instanceof TFile) {
                        await this.plugin.app.workspace.openLinkText(file.path, '', true);
                    } else {
                        new Notice(`File not found: ${file.path}`);
                    }
                });
                const countSpan = entryContainer.createEl('span', { 
                    cls: 'conversum-related-popout-count'
                });
                countSpan.textContent = '\u00A0(' + file.occurrences + ')';
            }
        }
        popout.addEventListener('mouseenter', () => {
            if (this.closeTimeout) {
                window.clearTimeout(this.closeTimeout);
                this.closeTimeout = null;
            }
        });
        popout.addEventListener('mouseleave', () => {
            this.close();
        });
        this.clickOutsideHandler = (e: MouseEvent) => {
            if (popout && !popout.contains(e.target as Node)) {
                this.forceClose();
            }
        };
        window.setTimeout(() => {
            if (this.clickOutsideHandler) {
                activeDocument.addEventListener('click', this.clickOutsideHandler);
            }
        }, 10);
        this.rightClickHandler = (e: MouseEvent) => {
            if (popout && !popout.contains(e.target as Node)) {
                this.forceClose();
            }
        };
        window.setTimeout(() => {
            if (this.rightClickHandler) {
                activeDocument.addEventListener('contextmenu', this.rightClickHandler);
            }
        }, 10);
        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.forceClose();
            }
        };
        activeDocument.addEventListener('keydown', this.escapeHandler);
        this.popoutEl = popout;
        activeDocument.body.appendChild(popout);
    }

    showWithEntries(
        referenceKey: string,
        formatted: string,
        entries: Array<[string, ReferenceIndexEntry]>,
        x: number,
        y: number
    ): void {
        this.forceClose();
        this.currentReference = referenceKey;
        this.renderWithEntries(formatted, entries, x, y);
    }

    private renderWithEntries(
        formatted: string,
        entries: Array<[string, ReferenceIndexEntry]>,
        x: number,
        y: number
    ): void {
        this.forceClose();
        if (!entries || entries.length === 0) {
            new Notice(`No notes found for "${formatted}"`);
            return;
        }
        const fileOccurrences = new Map<string, number>();
        for (const [, entry] of entries) {
            for (const file of entry.files) {
                const currentCount = fileOccurrences.get(file.path) || 0;
                fileOccurrences.set(file.path, currentCount + file.occurrences);
            }
        }
        if (fileOccurrences.size === 0) {
            new Notice(`No notes found for "${formatted}"`);
            return;
        }
        const allFiles = Array.from(fileOccurrences.entries()).map(([path, occurrences]) => ({
            path,
            occurrences
        }));
        allFiles.sort((a, b) => a.path.localeCompare(b.path));
        const currentFile = this.plugin.app.workspace.getActiveFile();
        const currentFilePath = currentFile ? currentFile.path : null;
        const otherFiles = allFiles.filter(f => f.path !== currentFilePath);
        const popout = activeDocument.createElement('div');
        popout.className = 'conversum-related-popout';
        let left = x + 20;
        let top = y + 10;
        const popoutWidth = 500;
        const popoutHeight = 220;
        const margin = 10;
        if (left + popoutWidth > window.innerWidth - margin) {
            left = window.innerWidth - popoutWidth - margin;
        }
        if (left < margin) {
            left = margin;
        }
        if (top + popoutHeight > window.innerHeight - margin) {
            top = window.innerHeight - popoutHeight - margin;
        }
        if (top < margin) {
            top = margin;
        }
        popout.style.left = left + 'px';
        popout.style.top = top + 'px';
        const header = popout.createDiv({ cls: 'conversum-related-popout-header' });
        header.createEl('span', { text: formatted, cls: 'conversum-related-popout-title' });
        const body = popout.createDiv({ cls: 'conversum-related-popout-body' });
        if (otherFiles.length === 0) {
            body.createEl('p', {
                text: 'This reference appears only in the current note.',
                cls: 'conversum-related-popout-empty'
            });
        } else {
            const fileList = body.createDiv({ cls: 'conversum-related-popout-files' });
            for (const file of otherFiles) {
                const fileEl = fileList.createDiv({ cls: 'conversum-related-popout-file' });
                const entryContainer = fileEl.createDiv({ cls: 'conversum-related-popout-entry' });
                const link = entryContainer.createEl('a', {
                    text: file.path,
                    cls: 'conversum-related-popout-link'
                });
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const fileObj = this.plugin.app.vault.getAbstractFileByPath(file.path);
                    if (fileObj instanceof TFile) {
                        await this.plugin.app.workspace.openLinkText(file.path, '', true);
                    } else {
                        new Notice(`File not found: ${file.path}`);
                    }
                });
                const countSpan = entryContainer.createEl('span', { 
                    cls: 'conversum-related-popout-count'
                });
                countSpan.textContent = '\u00A0(' + file.occurrences + ')';
            }
        }
        popout.addEventListener('mouseenter', () => {
            if (this.closeTimeout) {
                window.clearTimeout(this.closeTimeout);
                this.closeTimeout = null;
            }
        });
        popout.addEventListener('mouseleave', () => {
            this.close();
        });
        this.clickOutsideHandler = (e: MouseEvent) => {
            if (popout && !popout.contains(e.target as Node)) {
                this.forceClose();
            }
        };
        window.setTimeout(() => {
            if (this.clickOutsideHandler) {
                activeDocument.addEventListener('click', this.clickOutsideHandler);
            }
        }, 10);
        this.rightClickHandler = (e: MouseEvent) => {
            if (popout && !popout.contains(e.target as Node)) {
                this.forceClose();
            }
        };
        window.setTimeout(() => {
            if (this.rightClickHandler) {
                activeDocument.addEventListener('contextmenu', this.rightClickHandler);
            }
        }, 10);
        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.forceClose();
            }
        };
        activeDocument.addEventListener('keydown', this.escapeHandler);
        this.popoutEl = popout;
        activeDocument.body.appendChild(popout);
    }

    isVisible(): boolean {
        return this.popoutEl !== null;
    }

    getCurrentReference(): string | null {
        return this.currentReference;
    }
}