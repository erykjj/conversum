// engine-wrapper.ts

import * as wasmModule from './engine.js';
import wasmBinary from './engine_bg.wasm';

let engineInitialized = false;

const enginePool = new Map<string, any>();

function getEngineKey(language: string, format: 'full' | 'standard' | 'official'): string {
    return `${language}|${format}`;
}

export async function initEngine(): Promise<void> {
    if (engineInitialized) return;
    
    try {
        await wasmModule.default({ module_or_path: wasmBinary });
        engineInitialized = true;
    } catch (e) {
        console.error('con[VER]sum: Failed to initialize WASM engine:', e);
        throw e;
    }
}

function getOrCreateEngine(
    language: string,
    format: 'full' | 'standard' | 'official' = 'full'
): any | null {
    if (!engineInitialized) {
        console.error('con[VER]sum: Engine not initialized');
        return null;
    }
    const key = getEngineKey(language, format);
    if (enginePool.has(key)) {
        return enginePool.get(key);
    }
    try {
        const engine = new wasmModule.TravertureEngine(language, language, format, false);
        enginePool.set(key, engine);
        return engine;
    } catch {
        return null;
    }
}

export function prewarmEngines(sourceLanguage: string, outputLanguage: string): void {
    if (!engineInitialized) return;
    getOrCreateEngine(sourceLanguage, 'full');
    getOrCreateEngine(outputLanguage, 'full');
    getOrCreateEngine(outputLanguage, 'standard');
    getOrCreateEngine(outputLanguage, 'official');
}

export function clearEnginePool(): void {
    enginePool.clear();
}

export function getEnginePoolSize(): number {
    return enginePool.size;
}

function getParsingEngine(sourceLanguage: string): any | null {
    return getOrCreateEngine(sourceLanguage, 'full');
}

function getDecodingEngine(
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full'
): any | null {
    return getOrCreateEngine(outputLanguage, nameFormat);
}

export function isEngineReady(): boolean {
    return engineInitialized;
}

export function getChapterCount(bookId: number): number {
    if (!engineInitialized) {
        return 0;
    }
    try {
        return wasmModule.TravertureEngine.get_chapter_count(bookId);
    } catch {
        return 0;
    }
}

export function getVerseCount(bookId: number, chapter: number): number {
    if (!engineInitialized) {
        return 0;
    }
    try {
        return wasmModule.TravertureEngine.get_verse_count(bookId, chapter);
    } catch {
        return 1;
    }
}

export function isWholeBookReference(startBcv: string, endBcv: string): boolean {
    const bookId = parseInt(startBcv.substring(0, 2));
    const startChapter = parseInt(startBcv.substring(2, 5));
    const startVerse = parseInt(startBcv.substring(5, 8));
    const endChapter = parseInt(endBcv.substring(2, 5));
    const endVerse = parseInt(endBcv.substring(5, 8));
    if (startChapter !== 1 || startVerse !== 1) return false;
    const lastChapter = getChapterCount(bookId);
    if (lastChapter === 0) return false;
    if (endChapter !== lastChapter) return false;
    const lastVerse = getVerseCount(bookId, lastChapter);
    return endVerse === lastVerse;
}

export function getBookName(
    bookNumber: number,
    langCode: string,
    format: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): string {
    if (!engineInitialized) {
        return '';
    }
    try {
        return wasmModule.TravertureEngine.get_book_name(bookNumber, langCode, format, capitalize);
    } catch {
        return '';
    }
}

export function getLangSymbol(langCode: string): string {
    if (!engineInitialized) {
        return 'E';
    }
    try {
        return wasmModule.TravertureEngine.get_lang_symbol(langCode);
    } catch {
        return 'E';
    }
}

export function getAvailableLanguages(): any[] {
    if (!engineInitialized) {
        return [];
    }
    
    try {
        const json = wasmModule.TravertureEngine.get_available_languages();
        const parsed = JSON.parse(json);
        return parsed
            .filter((lang: any) => lang.code !== 'ase' && lang.language_code !== 'ase')
            .map((lang: any) => ({
                language_code: lang.language_code || lang.code,
                language_symbol: lang.language_symbol || lang.symbol,
                language_name: lang.language_name || lang.vernacularName || lang.languageName,
                english_name: lang.english_name || lang.englishName,
                code: lang.language_code || lang.code,
                symbol: lang.language_symbol || lang.symbol,
                vernacularName: lang.language_name || lang.vernacularName || lang.languageName,
                englishName: lang.english_name || lang.englishName
            }));
    } catch {
        return [];
    }
}

export function resolveLanguage(input: string): string | null {
    const languages = getAvailableLanguages();
    if (languages.length === 0) return null;
    if (!input || typeof input !== 'string') return null;
    const cleanInput = input.trim().replace(/^["']|["']$/g, '').toLowerCase();
    for (const lang of languages) {
        if (lang.language_code && lang.language_code.toLowerCase() === cleanInput) {
            return lang.language_code;
        }
        if (lang.language_symbol && lang.language_symbol.toLowerCase() === cleanInput) {
            return lang.language_code;
        }
        if (lang.language_name && lang.language_name.toLowerCase() === cleanInput) {
            return lang.language_code;
        }
        if (lang.english_name && lang.english_name.toLowerCase() === cleanInput) {
            return lang.language_code;
        }
    }
    return null;
}

export function parseReferences(
    text: string,
    sourceLanguage: string,
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): any[] | null {
    const resolvedSource = resolveLanguage(sourceLanguage) || sourceLanguage;
    const engine = getParsingEngine(resolvedSource);
    if (!engine) return null;
    try {
        const result = engine.parse(resolvedSource, outputLanguage, nameFormat, capitalize, text);
        return JSON.parse(result);
    } catch {
        return null;
    }
}

export function decodeScriptures(
    ranges: Array<[string, string]>,
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full'
): string[] | null {
    const resolvedOutput = resolveLanguage(outputLanguage) || outputLanguage;
    const engine = getDecodingEngine(resolvedOutput, nameFormat);
    if (!engine) return null;
    try {
        const json = JSON.stringify(ranges);
        const result = engine.decode_scriptures(json);
        return JSON.parse(result);
    } catch (e) {
        console.error('con[VER]sum: Failed to decode scriptures:', e);
        return null;
    }
}

export function getEngineVersion(): string {
    if (!engineInitialized) {
        return 'Engine not initialized';
    }
    try {
        return wasmModule.TravertureEngine.get_version();
    } catch {
        return 'Unknown';
    }
}