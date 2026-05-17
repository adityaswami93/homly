"use strict";
/**
 * Patches Baileys 7.x RC to fix three bugs that cause 100% QR/pairing failure:
 *
 * 1. passive: true  → passive: false  (validate-connection.js)
 *    WA treats passive=true as a listener connection and kills it with device_removed.
 *
 * 2. lidDbMigrated: false removed  (validate-connection.js)
 *    Undocumented field not in WA's protocol; causes server rejection.
 *
 * 3. await noise.finishInit()  → noise.finishInit()  (socket.js)
 *    Race condition: keep-alive fires before handshake state is committed.
 *
 * Source: https://github.com/openclaw/openclaw/issues/19907
 */

const fs = require("fs");
const path = require("path");

function patch(filePath, description, fn) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[patch-baileys] SKIP — file not found: ${filePath}`);
    return;
  }
  const original = fs.readFileSync(filePath, "utf8");
  const patched = fn(original);
  if (patched === original) {
    console.log(`[patch-baileys] already applied or not matched: ${description}`);
    return;
  }
  fs.writeFileSync(filePath, patched, "utf8");
  console.log(`[patch-baileys] OK — ${description}`);
}

const base = path.join(__dirname, "node_modules", "baileys", "lib");

// Patch 1 + 2: validate-connection.js
patch(
  path.join(base, "Utils", "validate-connection.js"),
  "passive:false + remove lidDbMigrated",
  (src) => src
    .replace(/\bpassive:\s*true\b/g, "passive: false")
    .replace(/\s*lidDbMigrated:\s*false,?/g, "")
);

// Patch 3: socket.js
patch(
  path.join(base, "Socket", "socket.js"),
  "remove await noise.finishInit()",
  (src) => src.replace(/\bawait\s+(noise\.finishInit\(\))/g, "$1")
);
