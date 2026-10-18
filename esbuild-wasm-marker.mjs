import fs from 'node:fs';
import path from 'node:path';

const WASM_START = '/*WASM-START*/';
const WASM_END = '/*WASM-END*/';

export const wasmMarkerPlugin = {
    name: 'wasm-marker',
    setup(build) {
        build.onLoad({ filter: /engine_bg\.wasm$/ }, (args) => {
            const bytes = fs.readFileSync(args.path);
            const b64 = bytes.toString('base64');
            return {
                contents: `export default "${WASM_START}${b64}${WASM_END}";`,
                loader: 'js',
            };
        });
    },
};