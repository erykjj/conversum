// sidebar.ts

import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon } from 'obsidian';
import { getBookName, decodeScriptures, isWholeBookReference } from './engine-wrapper';
import type ConversumPlugin from './main';
import { VIEW_TYPE_CONVERSUM_CONCORDANCE, BookGroup, ChapterGroup, ReferenceGroup, ReferenceIndexEntry } from './types';

export class ConcordanceView extends ItemView {
    plugin: ConversumPlugin;
    private container: HTMLElement;
    private searchInput: HTMLInputElement | null = null;
    private searchQuery: string = '';
    private expandedBooks: Set<number> = new Set();
    private expandedChapters: Set<string> = new Set();
    private bookGroups: BookGroup[] = [];
    private resultsContainer: HTMLElement | null = null;
    private searchTimeout: number | null = null;
    private totalRefs = 0;

    constructor(leaf: WorkspaceLeaf, plugin: ConversumPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.container = this.contentEl;
    }

    getViewType(): string {
        return VIEW_TYPE_CONVERSUM_CONCORDANCE;
    }

    getDisplayText(): string {
        return 'con[VER]sum Concordance';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen(): Promise<void> {
        this.container.empty();
        this.container.addClass('conversum-concordance');
        this.render();
    }

    async onClose(): Promise<void> {
        this.container.empty();
        if (this.searchTimeout) {
            window.clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
    }

    private normalizeForSearch(text: string): string {
        return text.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[.\s]+/g, '')
            .toLowerCase();
    }

    private updateClearButton(): void {
        const clearBtn = this.container.querySelector('.conversum-search-clear') as HTMLElement;
        if (clearBtn) {
            clearBtn.style.display = this.searchQuery ? 'block' : 'none';
        }
    }

    private formatReference(entry: ReferenceIndexEntry): string {
        const ranges: Array<[string, string]> = [[entry.startBcv, entry.endBcv]];
        const decoded = decodeScriptures(
            ranges,
            this.plugin.settings.outputLanguage,
            this.plugin.settings.nameFormat
        );
        return decoded && decoded.length > 0 && decoded[0] ? decoded[0] : `${entry.startBcv}-${entry.endBcv}`;
    }

    render(): void {
        this.container.empty();
        this.container.addClass('conversum-concordance');
        const toolbar = this.container.createDiv({ cls: 'conversum-concordance-toolbar' });
        const topRow = toolbar.createDiv({ cls: 'conversum-concordance-top-row' });
        const searchWrap = topRow.createDiv({ cls: 'conversum-search-wrap' });
        this.searchInput = searchWrap.createEl('input', {
            type: 'text',
            placeholder: 'Search references...',
            cls: 'conversum-search-input'
        });
        this.searchInput.value = this.searchQuery;
        this.searchInput.addEventListener('input', () => {
            this.searchQuery = this.searchInput!.value;
            if (this.searchTimeout) {
                window.clearTimeout(this.searchTimeout);
            }
            this.searchTimeout = window.setTimeout(() => {
                this.applySearch();
                this.updateClearButton();
            }, 300);
        });
        const clearBtn = searchWrap.createEl('button', {
            cls: 'conversum-search-clear'
        });
        clearBtn.setText('\u2715');
        clearBtn.style.display = this.searchQuery ? 'block' : 'none';
        clearBtn.addEventListener('click', () => {
            this.searchQuery = '';
            if (this.searchInput) {
                this.searchInput.value = '';
            }
            this.applySearch();
        });
        const data = this.plugin.indexer?.getData();
        const totalRefs = data ? Object.keys(data.references).length : 0;
        this.totalRefs = totalRefs;
        const countEl = topRow.createEl('span', {
            text: this.searchQuery ? `Filtered: 0 / ${totalRefs}` : `${totalRefs} references`,
            cls: 'conversum-count'
        });
        countEl.id = 'conversum-count';
        const exportBtn = topRow.createEl('button', {
            text: 'Export',
            cls: 'conversum-toolbar-btn'
        });
        setIcon(exportBtn, 'file-text');
        exportBtn.addEventListener('click', () => {
            void this.plugin.exportConcordance();
        });
        const collapseBtn = topRow.createEl('button', {
            text: '▲',
            cls: 'conversum-toolbar-btn'
        });
        collapseBtn.setAttribute('title', 'Collapse all');
        collapseBtn.addEventListener('click', () => {
            this.collapseAll();
        });
        topRow.createDiv({ cls: 'conversum-spacer' });
        this.resultsContainer = this.container.createDiv({ cls: 'conversum-results' });
        this.renderResults();
    }

    renderResults(): void {
        if (!this.resultsContainer) return;
        this.resultsContainer.empty();
        if (this.plugin.indexer?.isFormattingBusy()) {
            const formattingEl = this.resultsContainer.createDiv({ cls: 'conversum-formatting' });
            formattingEl.createEl('p', {
                text: '⏳ Formatting references...',
                cls: 'conversum-formatting-message'
            });
            formattingEl.createEl('p', {
                text: 'The concordance will appear once all references are formatted.',
                cls: 'conversum-formatting-submessage'
            });
            return;
        }
        const data = this.plugin.indexer?.getData();
        if (!data || Object.keys(data.references).length === 0) {
            this.resultsContainer.createEl('p', {
                text: 'No references found. Build the index first.',
                cls: 'conversum-empty'
            });
            return;
        }
        const grouped = this.plugin.indexer!.getGroupedReferences();
        this.bookGroups = [];
        for (const [bookId, chapterMap] of grouped) {
            const fullBookName = getBookName(bookId, this.plugin.settings.outputLanguage, 'full');
            const chapters: ChapterGroup[] = [];
            let bookTotalRefs = 0;
            let bookTotalFiles = new Set<string>();
            const sortedChapters = Array.from(chapterMap.keys()).sort((a, b) => {
                if (a === -1) return -1;
                if (b === -1) return 1;
                return a - b;
            });
            for (const chapter of sortedChapters) {
                const refs = chapterMap.get(chapter)!;
                const referenceGroups: ReferenceGroup[] = [];
                let chapterTotalRefs = 0;
                let chapterTotalFiles = new Set<string>();
                const sortedRefs = [...refs].sort((a, b) => {
                    const aStart = a[0].split('-')[0];
                    const bStart = b[0].split('-')[0];
                    return parseInt(aStart.substring(5, 8)) - parseInt(bStart.substring(5, 8));
                });
                for (const [key, entry, formatted] of sortedRefs) {
                    let displayText: string;
                    if (formatted) {
                        displayText = formatted;
                    } else {
                        displayText = this.formatReference(entry);
                    }
                    const filesWithCounts = this.plugin.getDatabase()?.getFilesWithCounts(key) || [];
                    const filesArray = filesWithCounts.map(f => ({
                        path: f.path,
                        occurrences: f.occurrences
                    }));
                    filesArray.sort((a, b) => a.path.localeCompare(b.path));
                    const refGroup: ReferenceGroup = {
                        referenceKey: key,
                        startVerse: entry.bcv.startVerse,
                        endVerse: entry.bcv.endVerse,
                        totalFiles: filesArray.length,
                        totalOccurrences: filesArray.reduce((sum, f) => sum + f.occurrences, 0),
                        files: filesArray,
                        expanded: true,
                        formattedText: displayText,
                        _searchText: displayText,
                        isWholeBook: isWholeBookReference(entry.startBcv, entry.endBcv)
                    };
                    referenceGroups.push(refGroup);
                    chapterTotalRefs++;
                    for (const file of filesArray) {
                        chapterTotalFiles.add(file.path);
                    }
                }
                if (referenceGroups.length > 0) {
                    chapters.push({
                        chapter,
                        totalReferences: chapterTotalRefs,
                        totalFiles: chapterTotalFiles.size,
                        references: referenceGroups,
                        expanded: this.expandedChapters.has(`${bookId}:${chapter}`)
                    });
                    bookTotalRefs += chapterTotalRefs;
                    for (const path of chapterTotalFiles) {
                        bookTotalFiles.add(path);
                    }
                }
            }
            if (chapters.length > 0) {
                this.bookGroups.push({
                    bookId,
                    bookName: fullBookName || `Book ${bookId}`,
                    totalReferences: bookTotalRefs,
                    totalFiles: bookTotalFiles.size,
                    chapters,
                    expanded: this.expandedBooks.has(bookId)
                });
            }
        }
        const countEl = this.container.querySelector('#conversum-count');
        if (countEl) {
            const totalRefs = data ? Object.keys(data.references).length : 0;
            const visibleCount = this.getVisibleCount();
            countEl.textContent = this.searchQuery ? `Filtered: ${visibleCount} / ${totalRefs}` : `${totalRefs} references`;
        }
        if (this.bookGroups.length === 0) {
            this.resultsContainer.createEl('p', {
                text: 'No references match your search.',
                cls: 'conversum-empty'
            });
            return;
        }
        this.buildView();
    }

    private getVisibleCount(): number {
        if (!this.searchQuery) return this.totalRefs;
        let count = 0;
        const query = this.normalizeForSearch(this.searchQuery);
        for (const book of this.bookGroups) {
            for (const chapter of book.chapters) {
                for (const ref of chapter.references) {
                    if (ref._searchText && this.normalizeForSearch(ref._searchText).includes(query)) {
                        count++;
                    }
                }
            }
        }
        return count;
    }

    private buildView(): void {
        if (!this.resultsContainer) return;
        for (const book of this.bookGroups) {
            const bookEl = this.resultsContainer.createDiv({ cls: 'conversum-book' });
            bookEl.dataset.bookId = String(book.bookId);
            (bookEl as any)._bookData = book;
            const header = bookEl.createDiv({ cls: 'conversum-book-header' });
            const toggle = header.createSpan({ cls: 'conversum-toggle' });
            toggle.textContent = book.expanded ? '▼' : '▶';
            const label = header.createSpan({ cls: 'conversum-book-label' });
            label.createSpan({ text: book.bookName, cls: 'conversum-book-name' });
            label.createSpan({ text: ` (${book.totalReferences} refs, ${book.totalFiles} files)`, cls: 'conversum-book-counts' });
            header.addEventListener('click', () => {
                this.toggleBook(book.bookId);
            });
            const chaptersContainer = bookEl.createDiv({ cls: 'conversum-chapters' });
            if (book.expanded) {
                chaptersContainer.removeClass('conversum-hidden');
            } else {
                chaptersContainer.addClass('conversum-hidden');
            }
            chaptersContainer.dataset.bookId = String(book.bookId);
            if (book.expanded) {
                this.buildChaptersForBook(chaptersContainer, book.bookId);
            }
        }
    }

    private buildChaptersForBook(container: HTMLElement, bookId: number): void {
        const book = this.bookGroups.find(b => b.bookId === bookId);
        if (!book) return;
        for (const chapter of book.chapters) {
            const chapterKey = `${bookId}:${chapter.chapter}`;
            const chapterEl = container.createDiv({ cls: 'conversum-chapter' });
            chapterEl.dataset.chapterKey = chapterKey;
            (chapterEl as any)._chapterData = chapter;
            const header = chapterEl.createDiv({ cls: 'conversum-chapter-header' });
            const toggle = header.createSpan({ cls: 'conversum-toggle' });
            toggle.textContent = chapter.expanded ? '▼' : '▶';
            const label = header.createSpan({ cls: 'conversum-chapter-label' });
            let chapterName: string;
            if (chapter.chapter === -1) {
                chapterName = 'Book';
            } else {
                chapterName = `Chapter ${chapter.chapter}`;
            }
            label.createSpan({ text: chapterName, cls: 'conversum-chapter-name' });
            label.createSpan({ text: ` (${chapter.totalReferences} refs, ${chapter.totalFiles} files)`, cls: 'conversum-chapter-counts' });
            header.addEventListener('click', () => {
                this.toggleChapter(bookId, chapter.chapter);
            });
            const refsContainer = chapterEl.createDiv({ cls: 'conversum-references' });
            if (chapter.expanded) {
                refsContainer.removeClass('conversum-hidden');
            } else {
                refsContainer.addClass('conversum-hidden');
            }
            refsContainer.dataset.chapterKey = chapterKey;
            if (chapter.expanded) {
                this.buildReferencesForChapter(refsContainer, chapter.references);
            }
        }
    }

    private toggleBook(bookId: number): void {
        const bookEl = this.resultsContainer?.querySelector(`.conversum-book[data-book-id="${bookId}"]`);
        if (!bookEl) return;
        const isExpanded = this.expandedBooks.has(bookId);
        if (isExpanded) {
            this.expandedBooks.delete(bookId);
            const chaptersContainer = bookEl.querySelector('.conversum-chapters') as HTMLElement;
            if (chaptersContainer) {
                chaptersContainer.addClass('conversum-hidden');
            }
            const toggle = bookEl.querySelector('.conversum-toggle') as HTMLElement;
            if (toggle) toggle.textContent = '▶';
        } else {
            this.expandedBooks.add(bookId);
            const chaptersContainer = bookEl.querySelector('.conversum-chapters') as HTMLElement;
            if (chaptersContainer) {
                chaptersContainer.removeClass('conversum-hidden');
                if (!chaptersContainer.hasChildNodes() || chaptersContainer.children.length === 0) {
                    this.buildChaptersForBook(chaptersContainer, bookId);
                }
            }
            const toggle = bookEl.querySelector('.conversum-toggle') as HTMLElement;
            if (toggle) toggle.textContent = '▼';
        }
    }

    private toggleChapter(bookId: number, chapter: number): void {
        const chapterKey = `${bookId}:${chapter}`;
        const chapterEl = this.resultsContainer?.querySelector(`.conversum-chapter[data-chapter-key="${chapterKey}"]`);
        if (!chapterEl) return;
        const isExpanded = this.expandedChapters.has(chapterKey);
        if (isExpanded) {
            this.expandedChapters.delete(chapterKey);
            const refsContainer = chapterEl.querySelector('.conversum-references') as HTMLElement;
            if (refsContainer) {
                refsContainer.addClass('conversum-hidden');
            }
            const toggle = chapterEl.querySelector('.conversum-toggle') as HTMLElement;
            if (toggle) toggle.textContent = '▶';
        } else {
            this.expandedChapters.add(chapterKey);
            const refsContainer = chapterEl.querySelector('.conversum-references') as HTMLElement;
            if (refsContainer) {
                refsContainer.removeClass('conversum-hidden');
                if (!refsContainer.hasChildNodes() || refsContainer.children.length === 0) {
                    const book = this.bookGroups.find(b => b.bookId === bookId);
                    if (book) {
                        const chapterData = book.chapters.find(c => c.chapter === chapter);
                        if (chapterData) {
                            this.buildReferencesForChapter(refsContainer, chapterData.references);
                        }
                    }
                }
            }
            const toggle = chapterEl.querySelector('.conversum-toggle') as HTMLElement;
            if (toggle) toggle.textContent = '▼';
        }
    }

    private buildReferencesForChapter(container: HTMLElement, references: ReferenceGroup[]): void {
        for (const ref of references) {
            if (this.searchQuery) {
                const searchText = ref._searchText || ref.formattedText || ref.referenceKey;
                if (!this.normalizeForSearch(searchText).includes(this.normalizeForSearch(this.searchQuery))) {
                    continue;
                }
            }
            const refEl = this.createReferenceElement(ref);
            container.appendChild(refEl);
        }
    }

    private createReferenceElement(ref: ReferenceGroup): HTMLElement {
        const refEl = this.container.createDiv();
        refEl.className = ref.isWholeBook ? 'conversum-reference' : 'conversum-reference';
        const displayText = ref.formattedText || ref.referenceKey;
        refEl.createSpan({ cls: 'conversum-ref-text', text: displayText });
        refEl.createSpan({ cls: 'conversum-ref-separator', text: ' — ' });
        const filesContainer = refEl.createDiv({ cls: 'conversum-files-inline' });
        for (let i = 0; i < ref.files.length; i++) {
            const file = ref.files[i];
            const unit = filesContainer.createSpan();
            const link = unit.createEl('a', {
                cls: 'conversum-file-link',
                text: file.path.replace(/\.md$/, '')
            });
            link.dataset.path = file.path;
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const path = (e.currentTarget as HTMLElement).dataset.path;
                if (path) {
                    const fileObj = this.app.vault.getAbstractFileByPath(path);
                    if (fileObj instanceof TFile) {
                        await this.app.workspace.openLinkText(path, '');
                    } else {
                        new Notice(`File not found: ${path}`);
                    }
                }
            });
            unit.createSpan({ cls: 'conversum-file-count', text: ' (' + file.occurrences + ')' });
            if (i < ref.files.length - 1) {
                unit.createSpan({ text: '; ' });
            }
        }
        return refEl;
    }

    private collapseAll(): void {
        this.expandedBooks.clear();
        this.expandedChapters.clear();
        if (this.resultsContainer) {
            const allBooks = this.resultsContainer.querySelectorAll('.conversum-book');
            for (const bookEl of allBooks) {
                const chaptersContainer = (bookEl as HTMLElement).querySelector('.conversum-chapters') as HTMLElement;
                if (chaptersContainer) {
                    chaptersContainer.addClass('conversum-hidden');
                }
                const toggle = (bookEl as HTMLElement).querySelector('.conversum-toggle') as HTMLElement;
                if (toggle) toggle.textContent = '▶';
            }
            const allChapters = this.resultsContainer.querySelectorAll('.conversum-chapter');
            for (const chapterEl of allChapters) {
                const refsContainer = (chapterEl as HTMLElement).querySelector('.conversum-references') as HTMLElement;
                if (refsContainer) {
                    refsContainer.addClass('conversum-hidden');
                }
                const toggle = (chapterEl as HTMLElement).querySelector('.conversum-toggle') as HTMLElement;
                if (toggle) toggle.textContent = '▶';
            }
        }
        const countEl = this.container.querySelector('#conversum-count');
        if (countEl) {
            countEl.textContent = `${this.totalRefs} references`;
        }
    }

    private applySearch(): void {
        if (!this.resultsContainer) return;
        if (!this.searchQuery) {
            for (const book of this.bookGroups) {
                const bookEl = this.resultsContainer.querySelector(`.conversum-book[data-book-id="${book.bookId}"]`) as HTMLElement;
                if (!bookEl) continue;
                bookEl.removeClass('conversum-hidden');
                const chaptersContainer = bookEl.querySelector('.conversum-chapters') as HTMLElement;
                if (chaptersContainer) {
                    const shouldShow = this.expandedBooks.has(book.bookId);
                    if (shouldShow) {
                        chaptersContainer.removeClass('conversum-hidden');
                    } else {
                        chaptersContainer.addClass('conversum-hidden');
                    }
                    const toggle = bookEl.querySelector('.conversum-toggle') as HTMLElement;
                    if (toggle) toggle.textContent = shouldShow ? '▼' : '▶';
                    for (const chapter of book.chapters) {
                        const chapterKey = `${book.bookId}:${chapter.chapter}`;
                        const chapterEl = chaptersContainer.querySelector(`.conversum-chapter[data-chapter-key="${chapterKey}"]`) as HTMLElement;
                        if (!chapterEl) continue;
                        const isExpanded = this.expandedChapters.has(chapterKey);
                        chapterEl.removeClass('conversum-hidden');
                        const refsContainer = chapterEl.querySelector('.conversum-references') as HTMLElement;
                        if (refsContainer) {
                            if (isExpanded) {
                                refsContainer.removeClass('conversum-hidden');
                                if (!refsContainer.hasChildNodes() || refsContainer.children.length === 0) {
                                    this.buildReferencesForChapter(refsContainer, chapter.references);
                                }
                            } else {
                                refsContainer.addClass('conversum-hidden');
                            }
                        }
                        const toggle2 = chapterEl.querySelector('.conversum-toggle') as HTMLElement;
                        if (toggle2) toggle2.textContent = isExpanded ? '▼' : '▶';
                    }
                }
            }
            const countEl = this.container.querySelector('#conversum-count');
            if (countEl) {
                countEl.textContent = `${this.totalRefs} references`;
            }
            return;
        }
        const query = this.normalizeForSearch(this.searchQuery);
        let visibleCount = 0;
        for (const book of this.bookGroups) {
            const bookEl = this.resultsContainer.querySelector(`.conversum-book[data-book-id="${book.bookId}"]`) as HTMLElement;
            if (!bookEl) continue;
            let bookHasMatch = false;
            const bookChaptersContainer = bookEl.querySelector('.conversum-chapters') as HTMLElement;
            if (!bookChaptersContainer || !bookChaptersContainer.hasChildNodes() || bookChaptersContainer.children.length === 0) {
                if (bookChaptersContainer) {
                    this.buildChaptersForBook(bookChaptersContainer, book.bookId);
                }
            }
            for (const chapter of book.chapters) {
                const chapterKey = `${book.bookId}:${chapter.chapter}`;
                const chapterEl = bookChaptersContainer?.querySelector(`.conversum-chapter[data-chapter-key="${chapterKey}"]`) as HTMLElement;
                let chapterHasMatch = false;
                const matchingRefs: ReferenceGroup[] = [];
                for (const ref of chapter.references) {
                    const searchText = ref._searchText || ref.formattedText || ref.referenceKey;
                    if (this.normalizeForSearch(searchText).includes(query)) {
                        chapterHasMatch = true;
                        matchingRefs.push(ref);
                        visibleCount++;
                    }
                }
                if (chapterHasMatch) {
                    bookHasMatch = true;
                    this.expandedChapters.add(chapterKey);
                    if (chapterEl) {
                        chapterEl.removeClass('conversum-hidden');
                        const refsContainer = chapterEl.querySelector('.conversum-references') as HTMLElement;
                        if (refsContainer) {
                            refsContainer.removeClass('conversum-hidden');
                            refsContainer.innerHTML = '';
                            for (const ref of matchingRefs) {
                                const refEl = this.createReferenceElement(ref);
                                refsContainer.appendChild(refEl);
                            }
                        }
                        const toggle = chapterEl.querySelector('.conversum-toggle') as HTMLElement;
                        if (toggle) toggle.textContent = '▼';
                    }
                } else {
                    this.expandedChapters.delete(chapterKey);
                    if (chapterEl) {
                        chapterEl.addClass('conversum-hidden');
                        const toggle = chapterEl.querySelector('.conversum-toggle') as HTMLElement;
                        if (toggle) toggle.textContent = '▶';
                    }
                }
            }
            if (bookHasMatch) {
                bookEl.removeClass('conversum-hidden');
                this.expandedBooks.add(book.bookId);
                if (bookChaptersContainer) {
                    bookChaptersContainer.removeClass('conversum-hidden');
                }
                const toggle = bookEl.querySelector('.conversum-toggle') as HTMLElement;
                if (toggle) toggle.textContent = '▼';
            } else {
                bookEl.addClass('conversum-hidden');
                this.expandedBooks.delete(book.bookId);
                if (bookChaptersContainer) {
                    bookChaptersContainer.addClass('conversum-hidden');
                }
                const toggle = bookEl.querySelector('.conversum-toggle') as HTMLElement;
                if (toggle) toggle.textContent = '▶';
            }
        }
        const countEl = this.container.querySelector('#conversum-count');
        if (countEl) {
            countEl.textContent = `Filtered: ${visibleCount} / ${this.totalRefs}`;
        }
    }

    refresh(): void {
        this.render();
    }

    showReference(referenceKey: string): void {
        const startBcv = referenceKey.split('-')[0];
        const bookId = parseInt(startBcv.substring(0, 2));
        const chapter = parseInt(startBcv.substring(2, 5));
        this.expandedBooks.add(bookId);
        this.expandedChapters.add(`${bookId}:${chapter}`);
        const data = this.plugin.indexer?.getData();
        if (data && data.references[referenceKey]) {
            const entry = data.references[referenceKey];
            const formatted = this.formatReference(entry);
            this.searchQuery = formatted;
            if (this.searchInput) {
                this.searchInput.value = this.searchQuery;
            }
        }
        this.renderResults();
    }
}