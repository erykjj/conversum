# con[VER]sum Security and Privacy

## Security and Privacy

If you are concerned about the "Scorecard" review or the "Caution" warning on the [Obsidian Community plugins page](https://community.obsidian.md/plugins/conversum), see [SECURITY](https://github.com/erykjj/conversum?tab=security-ov-file).

---

## Network Use

No network requests are made. No telemetry, tracking, or third-party services are used.

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

### What the plugin does not do:
- Modify or delete your files
- Access files outside your vault
- Transmit file content anywhere (no network requests)
- Store file content

All file operations are strictly local. Parsing occurs entirely in your browser and no data ever leaves your device.

---

## WASM Module

This plugin includes a WebAssembly (WASM) binary compiled from Rust. The WASM module is **embedded** in the plugin file and is not loaded from any external source. It contains the scripture reference parsing engine; it finds and converts Bible references into structured BCV codes. It also contains book name data for all supported languages. It is based on my [linkture](https://github.com/erykjj/linkture) project.

The WASM module:
- Does not make any network requests
- Does not access the file system
- Does not read or modify DOM directly

---

## TypeScript Warnings

The plugin source contains TypeScript strictness warnings. These warnings are cosmetic and do not affect functionality or security.