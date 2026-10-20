// engine-wrapper.ts

// @ts-ignore
import * as wasmModuleUntyped from './engine.js';
import wasmBinary from './engine_bg.wasm';
import { App } from 'obsidian';
import { TravertureEngineInstance, TravertureEngineModule, NameFormat, ParsedReference } from './types';

const WASM_START = '/*WASM-START*/';
const WASM_END = '/*WASM-END*/';
const H_START = 2166136261;
const H_END = 16777619;
const wasmModule = wasmModuleUntyped as unknown as TravertureEngineModule;
const enginePool = new Map<string, TravertureEngineInstance>();

let engineInitialized = false;
let inrefensEnabled = false;
let engineId = 0;

function getEngineKey(language: string, format: NameFormat): string {
    return `${language}|${format}`;
}

function stripTrailingCommentsAndBlanks(text: string): string {
    let end = text.length;
    for (;;) {
        while (end > 0) {
            const c = text.charCodeAt(end - 1);
            if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D || c === 0x0C || c === 0x0B) {
                end--;
            } else {
                break;
            }
        }
        if (end >= 4 && text.charCodeAt(end - 1) === 0x2F /* / */ && text.charCodeAt(end - 2) === 0x2A /* * */) {
            const open = text.lastIndexOf('/*', end - 2);
            if (open !== -1 && !text.slice(open + 2, end - 2).includes('*/')) {
                end = open;
                continue;
            }
        }
        const lastNl = text.lastIndexOf('\n', end - 1);
        const lineStart = lastNl + 1;
        if (end - lineStart >= 2 && text.charCodeAt(lineStart) === 0x2F && text.charCodeAt(lineStart + 1) === 0x2F) {
            end = lineStart;
            continue;
        }
        break;
    }
    return text.slice(0, end);
}

export async function initEngine(app: App, inrefens: boolean): Promise<void> {
    if (engineInitialized) return;
    inrefensEnabled = inrefens;

    const configDir = app.vault.configDir;
    let mainJsText = await app.vault.adapter.read(`${configDir}/plugins/conversum/main.js`);
    mainJsText = stripTrailingCommentsAndBlanks(mainJsText);
    const start = mainJsText.indexOf(WASM_START);
    if (start === -1) throw new Error('engine: WASM-START marker not found');
    const end = mainJsText.indexOf(WASM_END, start);
    if (end === -1) throw new Error('engine: WASM-END marker not found');
    const stripped = mainJsText.slice(0, start) + mainJsText.slice(end + WASM_END.length);
    const bytes = new TextEncoder().encode(stripped);
    let h = H_START;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, H_END) >>> 0;
    }
    engineId = h >>> 0;

    const wsIdx = wasmBinary.indexOf(WASM_START);
    const weIdx = wasmBinary.indexOf(WASM_END, wsIdx);
    if (wsIdx === -1 || weIdx === -1) throw new Error('engine: wasm markers not found in bundle');
    const b64 = wasmBinary.slice(wsIdx + WASM_START.length, weIdx);
    const wasmBin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await wasmModule.default({ module_or_path: wasmBin });
    engineInitialized = true;

    try {
        const probe = new wasmModule.TravertureEngine(
            'en', 'en', 'full', false, inrefensEnabled, engineId
        );
        enginePool.set(getEngineKey('en', 'full'), probe);
    } catch (e) {
        engineInitialized = false;
        throw e;
    }
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
        const engine = new wasmModule.TravertureEngine(language, language, format, false, inrefensEnabled, engineId);
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