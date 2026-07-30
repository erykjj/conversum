/* tslint:disable */
/* eslint-disable */

export class TravertureEngine {
    free(): void;
    [Symbol.dispose](): void;
    decode_scriptures(encoded_json: string): string;
    /**
     * Returns the URL to fetch ASL video metadata for a given book and chapter
     */
    static get_asl_metadata_url(book_number: number, chapter: number): string;
    /**
     * Returns a sorted JSON array of {code, vernacularName, englishName} for all available scripture languages
     */
    static get_available_languages(): string;
    /**
     * Look up a book name by book number, language, and format.
     * format: "full", "standard", or "official"
     * Returns the book name in the target language, optionally capitalized.
     */
    static get_book_name(book_number: number, lang_code: string, format: string, capitalize: boolean): string;
    static get_chapter_count(book_id: number): number;
    /**
     * Returns the suffix for a given language code
     */
    static get_lang_suffix(lang_code: string): string;
    /**
     * Returns the language symbol (e.g. "E", "S", "X") for a given language code
     */
    static get_lang_symbol(lang_code: string): string;
    /**
     * Get the number of verses in a specific chapter of a book
     */
    static get_verse_count(book_id: number, chapter: number): number;
    static get_version(): string;
    constructor(source_lang: string, output_lang: string, name_format: string, capitalize: boolean);
    parse(source_lang: string, output_lang: string, name_format: string, capitalize: boolean, text: string): string;
    parse_with_markers(text: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_travertureengine_free: (a: number, b: number) => void;
    readonly travertureengine_decode_scriptures: (a: number, b: number, c: number) => [number, number];
    readonly travertureengine_get_asl_metadata_url: (a: number, b: number) => [number, number];
    readonly travertureengine_get_available_languages: () => [number, number];
    readonly travertureengine_get_book_name: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly travertureengine_get_chapter_count: (a: number) => number;
    readonly travertureengine_get_lang_suffix: (a: number, b: number) => [number, number];
    readonly travertureengine_get_lang_symbol: (a: number, b: number) => [number, number];
    readonly travertureengine_get_verse_count: (a: number, b: number) => number;
    readonly travertureengine_get_version: () => [number, number];
    readonly travertureengine_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly travertureengine_parse: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly travertureengine_parse_with_markers: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
