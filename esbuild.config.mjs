import esbuild from 'esbuild';
import process from 'process';

const prod = process.argv[2] === 'production';

esbuild.build({
    entryPoints: ['main.ts'],
    bundle: true,
    external: ['obsidian'],
    format: 'cjs',
    target: 'es2020',
    outfile: 'main.js',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    loader: {
        '.wasm': 'binary'
    },
    logOverride: {
        'empty-import-meta': 'silent'
    }
}).catch(() => process.exit(1));