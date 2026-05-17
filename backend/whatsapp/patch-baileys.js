import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let patched = 0;
let skipped = 0;

function tryPatch(filePath, description, replacements) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-baileys] NOT FOUND: ${filePath}`);
    skipped++;
    return;
  }
  let src = fs.readFileSync(filePath, "utf8");
  let out = src;
  for (const [pattern, replacement, label] of replacements) {
    const before = out;
    out = out.replace(pattern, replacement);
    if (out === before) {
      console.log(`[patch-baileys] NO MATCH for "${label}" in ${path.basename(filePath)}`);
    } else {
      console.log(`[patch-baileys] PATCHED "${label}" in ${path.basename(filePath)}`);
      patched++;
    }
  }
  if (out !== src) {
    fs.writeFileSync(filePath, out, "utf8");
  }
}

// Try both possible install locations (baileys and @whiskeysockets/baileys)
const candidates = [
  path.join(__dirname, "node_modules", "baileys", "lib"),
  path.join(__dirname, "node_modules", "@whiskeysockets", "baileys", "lib"),
];

for (const base of candidates) {
  if (!fs.existsSync(base)) {
    console.log(`[patch-baileys] base not found: ${base}`);
    continue;
  }
  console.log(`[patch-baileys] patching: ${base}`);

  tryPatch(
    path.join(base, "Utils", "validate-connection.js"),
    "validate-connection.js",
    [
      // Bug 1: passive:true → passive:false  (handles any whitespace around colon)
      [/passive\s*:\s*true/g, "passive: false", "passive:true→false"],
      // Bug 2: lidDbMigrated field — handle with/without trailing comma
      [/,?\s*lidDbMigrated\s*:\s*false\s*,?/g, "", "remove lidDbMigrated"],
    ]
  );

  tryPatch(
    path.join(base, "Socket", "socket.js"),
    "socket.js",
    [
      // Bug 3: remove await before noise.finishInit()
      [/\bawait\s+(noise\.finishInit\(\))/g, "$1", "await noise.finishInit"],
    ]
  );
}

console.log(`[patch-baileys] done — ${patched} replacement(s) applied, ${skipped} file(s) not found`);
