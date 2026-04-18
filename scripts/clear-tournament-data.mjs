#!/usr/bin/env node
// Run with Node only (npm run clear-tournaments). Do not paste this file into Supabase SQL Editor — use clear-tournament-data.sql there.
/**
 * Deletes all tournament rows and all matches with format = 'tournament'
 * (including match_participants / match_events via FK cascades).
 *
 * Usage:
 *   node scripts/clear-tournament-data.mjs --yes
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env.local then .env
 * (same as the Vite app). Requires delete policies on these tables (your schema allows public delete).
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFiles() {
  const out = {};
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  }
  return out;
}

const args = new Set(process.argv.slice(2));
if (!args.has("--yes")) {
  console.error("Refusing to run without --yes (this permanently deletes tournament data).");
  console.error("Run: node scripts/clear-tournament-data.mjs --yes");
  process.exit(1);
}

const env = { ...process.env, ...loadEnvFiles() };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment or .env / .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const NIL = "00000000-0000-0000-0000-000000000000";

async function main() {
  const { count: tBefore, error: eCountT } = await supabase
    .from("tournaments")
    .select("*", { count: "exact", head: true });
  if (eCountT) throw eCountT;

  const { count: mBefore, error: eCountM } = await supabase
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("format", "tournament");
  if (eCountM) throw eCountM;

  console.log(`Deleting ~${tBefore ?? "?"} tournament(s) and ~${mBefore ?? "?"} tournament match row(s)...`);

  const { error: eDelT } = await supabase.from("tournaments").delete().neq("id", NIL);
  if (eDelT) throw eDelT;

  const { error: eDelM } = await supabase.from("matches").delete().eq("format", "tournament");
  if (eDelM) throw eDelM;

  const { count: tAfter } = await supabase.from("tournaments").select("*", { count: "exact", head: true });
  const { count: mAfter } = await supabase
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("format", "tournament");

  console.log("Done. Remaining tournaments:", tAfter ?? 0, "| remaining tournament matches:", mAfter ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
