// types.ts

export interface ConversumSettings {
    sourceLanguage: string;
    outputLanguage: string;
    nameFormat: NameFormat;
    autoIndex: boolean;
    excludedFolders: string[];
    rebuildStatus?: 'unknown' | 'complete' | 'in_progress' | 'failed' | 'aborted';
}

export const DEFAULT_SETTINGS: ConversumSettings = {
    sourceLanguage: 'en',
    outputLanguage: 'en',
    nameFormat: 'full',
    autoIndex: true,
    excludedFolders: [],
    rebuildStatus: 'unknown'
};

export interface ReferenceIndexEntry {
    startBcv: string;
    endBcv: string;
    bcv: {
        bookId: number;
        chapter: number;
        startVerse: number;
        endVerse: number;
        endChapter?: number;
    };
    files: {
        path: string;
        occurrences: number;
    }[];
    totalOccurrences: number;
}

export interface FileCacheEntry {
    hash: string;
    references: string[];
    lastModified: number;
}

export interface ConversumData {
    version: string;
    lastUpdated: number;
    references: {
        [rangeKey: string]: ReferenceIndexEntry;
    };
    fileCache: {
        [filePath: string]: FileCacheEntry;
    };
}

export const VIEW_TYPE_CONVERSUM_CONCORDANCE = 'conversum-concordance-view';

export interface BookGroup {
    bookId: number;
    bookName: string;
    totalReferences: number;
    totalFiles: number;
    chapters: ChapterGroup[];
    expanded?: boolean;
}

export interface ChapterGroup {
    chapter: number;
    totalReferences: number;
    totalFiles: number;
    references: ReferenceGroup[];
    expanded?: boolean;
}

export interface ReferenceGroup {
    referenceKey: string;
    startVerse: number;
    endVerse: number;
    totalFiles: number;
    totalOccurrences: number;
    files: FileRef[];
    expanded?: boolean;
    formattedText?: string;
    _searchText?: string;
    isWholeBook?: boolean;
}

export interface FileRef {
    path: string;
    occurrences: number;
}

export interface IndexProgress {
    totalFiles: number;
    processedFiles: number;
    currentFile?: string;
    referencesFound: number;
    uniqueReferences: number;
    status: 'idle' | 'scanning' | 'processing' | 'saving' | 'complete' | 'error';
}

export interface LanguageInfo {
    code: string;
    vernacularName: string;
    englishName: string;
    suffix: string;
}

// ──────────────────────────────────────────────
// Engine (WASM) Types
// ──────────────────────────────────────────────

export type NameFormat = 'full' | 'standard' | 'official';

export type ParsedReference = [
    string,          // matched scripture text
    number,          // start position (char index)
    number,          // end position (char index)
    string[][]       // array of [startBcv, endBcv] pairs
];

export interface TravertureEngineInstance {
    parse(sourceLang: string, outputLang: string, nameFormat: NameFormat, capitalize: boolean, text: string): string;
    parse_with_markers(text: string): string;
    decode_scriptures(encodedJson: string): string;
    verify_integrity(hash: number): boolean;
    debug_integrity_hash(): number;
}

export interface TravertureEngineStatic {
    new(sourceLang: string, outputLang: string, nameFormat: NameFormat, capitalize: boolean): TravertureEngineInstance;
    get_chapter_count(bookId: number): number;
    get_verse_count(bookId: number, chapter: number): number;
    get_available_languages(): string;
    get_lang_suffix(langCode: string): string;
    get_book_name(bookNumber: number, langCode: string, format: NameFormat, capitalize: boolean): string;
    get_lang_symbol(langCode: string): string;
    get_version(): string;
    get_asl_metadata_url(bookNumber: number, chapter: number): string;
}

export interface TravertureEngineModule {
    TravertureEngine: TravertureEngineStatic;
    default(options: { module_or_path: unknown }): Promise<void>;
}