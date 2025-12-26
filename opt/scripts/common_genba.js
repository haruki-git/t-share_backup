// 共通ユーティリティ群
// 現場で使える記事生成スクリプト群で共通利用

import fs from "fs/promises";
import path from "path";

export const PATHS = {
  WEB_ROOT: process.env.GENBA_WEB_ROOT || "/var/www/html",
  INDEX_HTML: process.env.GENBA_INDEX_HTML || "/var/www/html/index.html",
  POSTS_DIR: process.env.GENBA_POSTS_DIR || "/var/www/html/posts/genba",
  DATA_DIR: process.env.GENBA_DATA_DIR || "/opt/tshare-api/data",
};

export const FILES = {
  QUEUE: path.join(PATHS.DATA_DIR, "genba_queue.json"),
  MANIFEST: path.join(PATHS.DATA_DIR, "genba_manifest.json"),
};

export const MARKERS = {
  START: "<!-- GENBA_POSTS_START -->",
  END: "<!-- GENBA_POSTS_END -->",
};

export function nowJstIso() {
  const ms = Date.now() + 9 * 60 * 60 * 1000;
  return new Date(ms).toISOString().replace("Z", "+09:00");
}
export function jstDate() {
  return nowJstIso().slice(0, 10);
}

export async function readJson(file, fallback = []) {
  try {
    const s = await fs.readFile(file, "utf-8");
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, file);
}

export async function readText(file) {
  return await fs.readFile(file, "utf-8");
}

export async function writeTextAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, "utf-8");
  await fs.rename(tmp, file);
}

export function slugifyJa(title) {
  // 最低限：英数は残し、その他は-に寄せて短く
  const base = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || `genba-${Date.now()}`;
}

export function safeText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

// index.html の list-work から href="posts/....html" を抜く（簡易）
export function extractWorkPostHrefs(indexHtml) {
  const m = indexHtml.match(/<div id="list-work"[\s\S]*?<\/div>/);
  const block = m ? m[0] : indexHtml;
  const hrefs = [];
  const re = /href="(posts\/[^"]+?\.html)"/g;
  let x;
  while ((x = re.exec(block))) hrefs.push(x[1]);
  // 重複除去
  return [...new Set(hrefs)];
}

export function findBetweenMarkers(text, start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1 || e < s) return null;
  return { s, e };
}
