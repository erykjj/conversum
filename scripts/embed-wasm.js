const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const sqlWasmPath = path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
let sqlWasmBase64 = '';
if (fs.existsSync(sqlWasmPath)) {
    const sqlWasmBuffer = fs.readFileSync(sqlWasmPath);
    sqlWasmBase64 = sqlWasmBuffer.toString('base64');
    console.log(`✅ Loaded sql-wasm.wasm (${sqlWasmBuffer.length} bytes)`);
} else {
    console.error('❌ sql-wasm.wasm not found at:', sqlWasmPath);
    process.exit(1);
}
const output = `
// Auto-generated from sql-wasm.wasm
export const SQL_WASM_BASE64 = '${sqlWasmBase64}';
`;
const outputPath = path.join(__dirname, '../wasm-base64.ts');
fs.writeFileSync(outputPath, output);
console.log(`✅ Generated ${outputPath}`);