# con[VER]sum Security and Privacy

If you are concerned about the "Scorecard" review or the "Caution" warning on the [Obsidian Community plugins page](https://community.obsidian.md/plugins/conversum), here is some information to ease your mind.

---

## Network Use

No network requests are made. No telemetry, tracking, or third-party services are used.

The plugin includes two embedded WebAssembly modules (scripture parsing engine and SQLite database). Both are loaded locally from the plugin file and do not make network requests.

---

## Privacy

No personal data is collected, stored, or transmitted.

---

## File Access

The plugin reads and parses your Markdown files to build a scripture concordance. This is required for the plugin to function.

### What the plugin does:
- **Enumerates files** - Scans the vault to find all Markdown files
- **Reads and parses file content** - Detects Bible references in each file when indexing is enabled
- **Writes files** - Only when you use the Export function to create a concordance file
- **Writes to the plugin's own data directory** - The concordance index is stored locally in the plugin folder within the vault's `.obsidian` directory

### What the plugin does not do:
- Modify or delete your files
- Access files outside your vault
- Transmit file content anywhere (no network requests)
- Store file content outside the local index database

All file operations are strictly local. Parsing and indexing occur entirely in your browser and no data ever leaves your device.

---

## WASM Modules

This plugin includes two WebAssembly (WASM) binaries: a scripture parsing engine (Rust) and an SQLite database (SQL.js). Both are **embedded** in the plugin file and are not loaded from any external source. The parsing engine is based on my [linkture](https://github.com/erykjj/linkture) project.

They:
- Do not make any network requests
- Do not access the file system directly (file access is done through Obsidian's API)
- Do not read or modify DOM directly

---

## TypeScript Warnings

The plugin source contains some TypeScript strictness warnings inherent to JavaScript interop (e.g., `JSON.parse` returning `any`, WASM module type casting). **These warnings are cosmetic and do not affect functionality or security**. All data is validated before use.
```