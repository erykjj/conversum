# con[VER]sum Security and Privacy

If you are concerned about the "Scorecard" review or the "Caution" warning on the [Obsidian Community plugins page](https://community.obsidian.md/plugins/conversum), here is some information to ease your mind.

---

## Network Use

No network requests are made. No telemetry, tracking, or third-party services are used.

---

## Privacy

No personal data is collected, stored, or transmitted.

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