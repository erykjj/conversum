// engine-wrapper.ts

// @ts-ignore
import * as wasmModuleUntyped from './engine.js';
// @ts-ignore
import wasmBinary from './engine_bg.wasm';
import { App } from 'obsidian';
import { TravertureEngineInstance, TravertureEngineModule, NameFormat, ParsedReference } from './types';

const wasmModule = wasmModuleUntyped as unknown as TravertureEngineModule;

let engineInitialized = false;

const enginePool = new Map<string, TravertureEngineInstance>();

function getEngineKey(language: string, format: NameFormat): string {
    return `${language}|${format}`;
}

function fnv1a(text: string): number {
    const FNV_OFFSET = 2166136261;
    const FNV_PRIME = 16777619;
    let hash = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

function findOccurrence(text: string, marker: string): number {
    const first = text.indexOf(marker);
    if (first === -1) return -1;
    return text.indexOf(marker, first + 1);
}

async function checkHealth(app: App): Promise<number> {
    const adapter = app.vault.adapter;
    const configDir = app.vault.configDir;
    const mainJsPath = `${configDir}/plugins/conversum/main.js`;
    const mainJsContent = await adapter.read(mainJsPath);
    const startMarker = '.PluginSettingTab {';
    const hashLength = 5000;
    const startPos = findOccurrence(mainJsContent, startMarker);
    if (startPos === -1) {
        throw new Error('Integrity check FAILED!');
    }
    const integritySection = mainJsContent.substring(startPos, startPos + hashLength);
    const normalized = integritySection.replace(/\s+/g, '');
    return fnv1a(normalized);
}

export async function initEngine(app: App): Promise<void> {
    if (engineInitialized) return;
    const generatedHash = await checkHealth(app);
    await wasmModule.default({ module_or_path: wasmBinary });
    engineInitialized = true;
    const engine = new wasmModule.TravertureEngine('en', 'en', 'full', false);
    if (!engine.verify_integrity(generatedHash)) {
        engineInitialized = false;
        throw new Error('Integrity check FAILED!');
    }
    enginePool.set(getEngineKey('en', 'full'), engine);
}

function getOrCreateEngine(
    language: string,
    format: NameFormat = 'full'
): TravertureEngineInstance | null {
    if (!engineInitialized) {
        console.error('con[VER]sum: Engine not initialized');
        return null;
    }
    const key = getEngineKey(language, format);
    if (enginePool.has(key)) {
        return enginePool.get(key)!;
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

function getParsingEngine(sourceLanguage: string): TravertureEngineInstance | null {
    return getOrCreateEngine(sourceLanguage, 'full');
}

function getDecodingEngine(
    outputLanguage: string,
    nameFormat: NameFormat = 'full'
): TravertureEngineInstance | null {
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
    format: NameFormat = 'full',
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

export interface EngineLanguageInfo {
    language_code: string;
    language_symbol: string;
    language_name: string;
    english_name: string;
    code: string;
    symbol: string;
    vernacularName: string;
    englishName: string;
}

export function getAvailableLanguages(): EngineLanguageInfo[] {
    if (!engineInitialized) {
        return [];
    }
    
    try {
        const json = wasmModule.TravertureEngine.get_available_languages();
        const parsed = JSON.parse(json) as Array<{
            code?: string;
            language_code?: string;
            symbol?: string;
            language_symbol?: string;
            vernacularName?: string;
            language_name?: string;
            englishName?: string;
            english_name?: string;
        }>;
        return parsed
            .filter((lang) => lang.code !== 'ase' && lang.language_code !== 'ase')
            .map((lang) => ({
                language_code: lang.language_code || lang.code || '',
                language_symbol: lang.language_symbol || lang.symbol || '',
                language_name: lang.language_name || lang.vernacularName || '',
                english_name: lang.english_name || lang.englishName || '',
                code: lang.language_code || lang.code || '',
                symbol: lang.language_symbol || lang.symbol || '',
                vernacularName: lang.language_name || lang.vernacularName || '',
                englishName: lang.english_name || lang.englishName || ''
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
    nameFormat: NameFormat = 'full',
    capitalize: boolean = false
): ParsedReference[] | null {
    const resolvedSource = resolveLanguage(sourceLanguage) || sourceLanguage;
    const engine = getParsingEngine(resolvedSource);
    if (!engine) return null;
    try {
        const result = engine.parse(resolvedSource, outputLanguage, nameFormat, capitalize, text);
        return JSON.parse(result) as ParsedReference[];
    } catch {
        return null;
    }
}

export function decodeScriptures(
    ranges: Array<[string, string]>,
    outputLanguage: string,
    nameFormat: NameFormat = 'full'
): string[] | null {
    const resolvedOutput = resolveLanguage(outputLanguage) || outputLanguage;
    const engine = getDecodingEngine(resolvedOutput, nameFormat);
    if (!engine) return null;
    try {
        const json = JSON.stringify(ranges);
        const result = engine.decode_scriptures(json);
        return JSON.parse(result) as string[];
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