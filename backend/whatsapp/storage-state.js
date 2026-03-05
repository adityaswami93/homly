const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BUCKET    = "whatsapp-auth";
const LOCAL_DIR = "./auth_state";

async function ensureBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === BUCKET);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET, { public: false });
      console.log(`Created storage bucket: ${BUCKET}`);
    }
  } catch (e) {
    console.error("Failed to ensure bucket:", e.message);
  }
}

async function downloadAuthState() {
  try {
    if (!fs.existsSync(LOCAL_DIR)) {
      fs.mkdirSync(LOCAL_DIR, { recursive: true });
    }

    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list("auth_state");

    if (error || !files || files.length === 0) {
      console.log("No auth state found in storage — fresh start");
      return;
    }

    console.log(`Downloading ${files.length} auth state files...`);
    for (const file of files) {
      const { data, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(`auth_state/${file.name}`);

      if (dlErr || !data) {
        console.error(`Failed to download ${file.name}:`, dlErr?.message);
        continue;
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(path.join(LOCAL_DIR, file.name), buffer);
    }
    console.log("Auth state restored from storage");
  } catch (e) {
    console.error("Failed to download auth state:", e.message);
  }
}

async function uploadAuthState() {
  try {
    if (!fs.existsSync(LOCAL_DIR)) return;

    const files = fs.readdirSync(LOCAL_DIR);
    for (const file of files) {
      const filePath = path.join(LOCAL_DIR, file);
      const stat     = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const buffer   = fs.readFileSync(filePath);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`auth_state/${file}`, buffer, {
          upsert:       true,
          contentType:  "application/octet-stream",
        });

      if (error) {
        console.error(`Failed to upload ${file}:`, error.message);
      }
    }
  } catch (e) {
    console.error("Failed to upload auth state:", e.message);
  }
}

module.exports = { ensureBucket, downloadAuthState, uploadAuthState };
