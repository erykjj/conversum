// types.ts

export interface ConversumSettings {
    sourceLanguage: string;
    outputLanguage: string;
    nameFormat: 'full' | 'standard' | 'official';
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