// 3) scripts/genba_generate_weekly.js（毎週生成：mini→5.2）
// ここで 2段構えを実行します。
// キューから1件取り出す
// manifest作成/読み込み
// 類似候補（タイトル/目次/要約）を数件だけ渡す
// draft（mini）JSON生成
// final（5.2）で校正＋HTML整形＋最終重複チェック
// /var/www/html/posts/genba/ に保存
// index.html のマーカー内の一覧を更新

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import {
  PATHS, FILES, MARKERS,
  readJson, writeJsonAtomic,
  readText, writeTextAtomic,
  nowJstIso, jstDate,
  slugifyJa, safeText, findBetweenMarkers,
} from "./common_genba.js";

// ====== モデル名は ENV で指定（ここは決め打ちしない） ======
const MODEL_DRAFT = process.env.GENBA_MODEL_DRAFT; // 例: "gpt-5-mini"
const MODEL_FINAL = process.env.GENBA_MODEL_FINAL; // 例: "gpt-5.2"
if (!MODEL_DRAFT || !MODEL_FINAL) {
  console.error("ENV required: GENBA_MODEL_DRAFT, GENBA_MODEL_FINAL");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====== JSONスキーマ（miniの下書き） ======
const DraftSchema = z.object({
  title: z.string().min(1),
  shortTitle: z.string().min(1),
  keywords: z.array(z.string()).min(3).max(12),
  toc: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  })).min(6).max(14),
  sections: z.array(z.object({
    id: z.string().min(1),
    heading: z.string().min(1),
    body: z.string().min(1),      // Markdown寄りの文章（HTMLじゃない）
    codeBlocks: z.array(z.object({
      lang: z.string().min(1),
      code: z.string().min(1),
      caption: z.string().optional(),
    })).max(6).default([]),
    cautions: z.array(z.string()).max(6).default([]),
  })).min(6).max(14),
  closing: z.string().min(1),
});

// ====== JSONスキーマ（5.2の最終成果物：HTML断片込み） ======
const FinalSchema = z.object({
  title: z.string().min(1),
  publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slug: z.string().min(1),
  keywords: z.array(z.string()).min(3).max(12),
  toc: z.array(z.object({ id: z.string(), label: z.string() })).min(6).max(14),
  sections: z.array(z.object({
    id: z.string(),
    heading: z.string(),
    bodyHtml: z.string().min(1),      // <br>など含むHTML断片
    codeBlocks: z.array(z.object({
      lang: z.string(),
      code: z.string(),
      caption: z.string().optional(),
    })).default([]),
    cautions: z.array(z.string()).default([]),
  })).min(6).max(14),
  closingHtml: z.string().min(1),
  qualityChecks: z.object({
    noDuplication: z.boolean(),
    dupReason: z.string().optional(),
    fixedPoints: z.array(z.string()).default([]),
  }),
});

// ====== 類似候補の選び方（軽量：キーワード一致っぽい） ======
function pickSimilar(manifest, theme, k = 3) {
  const t = safeText(theme).toLowerCase();
  const scored = manifest.map((it) => {
    const hay = safeText(`${it.title} ${it.summary} ${(it.toc || []).join(" ")}`).toLowerCase();
    let score = 0;
    for (const w of t.split(/\s+/)) if (w && hay.includes(w)) score += 1;
    return { it, score };
  }).sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score > 0).slice(0, k).map(x => x.it);
}

function renderHtmlPage(finalObj) {
  // あなたのテンプレ寄せ（外枠固定）
  const { title, publishedDate, toc, sections, closingHtml } = finalObj;

  const tocHtml = toc.map(x => `<li><a href="#${x.id}">${escapeHtml(x.label)}</a></li>`).join("\n        ");

  const sectionsHtml = sections.map(sec => {
    const codeHtml = (sec.codeBlocks || []).map(cb => {
      const cap = cb.caption ? `<div style="font-size:0.9em;opacity:.8;margin:6px 0;">${escapeHtml(cb.caption)}</div>` : "";
      return `
      ${cap}
      <pre><code>${escapeHtml(cb.code)}</code></pre>
      `.trim();
    }).join("\n");

    const cautionsHtml = (sec.cautions || []).length
      ? `
      <div style="border:1px solid #f2c; border-radius:10px; padding:10px; margin:10px 0;">
        <b>注意</b>
        <ul>
          ${(sec.cautions || []).map(c => `<li>${escapeHtml(c)}</li>`).join("")}
        </ul>
      </div>
      `.trim()
      : "";

    return `
      <h3 id="${escapeHtml(sec.id)}">${escapeHtml(sec.heading)}</h3>
      ${cautionsHtml}
      <p>${sec.bodyHtml}</p>
      ${codeHtml}
    `.trim();
  }).join("\n\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <nav><a href="/index.html">Home</a></nav>
  </header>

  <main>
    <article>
      <p><small>投稿日：${escapeHtml(publishedDate)}</small></p>

      <h3>目次</h3>
      <ul>
        ${tocHtml}
      </ul>
      <br>

      ${sectionsHtml}

      <hr>
      <div>${closingHtml}</div>
    </article>
  </main>

  <footer><p>c 2025 hi</p></footer>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// index.html のマーカー内を「自動生成記事一覧」で上書き
async function updateIndexGenbaList(newItems) {
  const indexHtml = await readText(PATHS.INDEX_HTML);
  const pos = findBetweenMarkers(indexHtml, MARKERS.START, MARKERS.END);
  if (!pos) throw new Error("GENBA markers not found in index.html");

  const listHtml = newItems.map(it =>
    `    <li><a href="${it.href}">${escapeHtml(it.title)}</a> (${it.date})</li>`
  ).join("\n");

  const before = indexHtml.slice(0, pos.s + MARKERS.START.length);
  const after  = indexHtml.slice(pos.e);

  const merged = `${before}\n${listHtml}\n    ${after}`;
  await writeTextAtomic(PATHS.INDEX_HTML, merged);
}

async function popQueue() {
  const q = await readJson(FILES.QUEUE, []);
  if (!q.length) return { item: null, rest: q };
  const [item, ...rest] = q;
  await writeJsonAtomic(FILES.QUEUE, rest);
  return { item, rest };
}

async function main() {
  // 0) manifest更新（毎回）
  const { default: _ } = await import("./genba_build_manifest.js"); // 実行目的（副作用）
  const manifest = await readJson(FILES.MANIFEST, []);

  // 1) テーマを1件取り出す（なければ終了）
  const { item } = await popQueue();
  if (!item) {
    console.log("[genba] queue empty. skip.");
    return;
  }
  const theme = safeText(item.theme);
  const similar = pickSimilar(manifest, theme, 3);

  // 2) mini：下書きJSON生成
  const draftPrompt = `
あなたはIT初心者向けの「現場で使える」記事を書きます。
テーマ: ${theme}

条件:
- Windows/PowerShell/Excel/基本Linux/ネットワーク基礎 など「現場で実用的」寄り
- 初心者が詰まる点を先回りして説明
- 危険操作（削除/上書き等）は必ず注意を書く
- 既存記事と内容が丸かぶりしないように「切り口」を変える

既存記事（要約・目次）:
${similar.map((x, i) => `(${i+1}) ${x.title}\n- summary: ${x.summary}\n- toc: ${(x.toc||[]).join(" / ")}`).join("\n\n")}

出力はスキーマに必ず従ってください。文章はMarkdown寄りでOK（HTMLは書かない）。
`.trim();

  const draft = await client.responses.parse({
    model: MODEL_DRAFT,
    input: draftPrompt,
    text: { format: zodTextFormat(DraftSchema, "draft") },
  });

  const draftObj = draft.output_parsed;

  // 3) 5.2：校正＋HTML整形＋最終重複チェック
  const finalPrompt = `
あなたは校正者兼、HTML整形担当です。以下の下書きを「記事として公開できる品質」に仕上げます。

下書き(JSON):
${JSON.stringify(draftObj)}

必須:
- 初心者向けのやさしい日本語（です/ます）
- 目次リンクが成立する id を使う（英数とハイフン推奨）
- bodyHtml は <br> を適切に使い、<p>外枠はレンダラが付ける前提で「中身」として自然にする
- <header> に <nav><a href="/index.html">Home</a></nav> を必ず入れる
- <header>内に <h1> と <nav><a href="/index.html">Home</a></nav> を入れる（既存記事と同じ）
- 最終重複チェック: 既存記事と切り口/内容が被るなら noDuplication=false とし、dupReason に理由を書く（この場合、内容を変えて書き直して noDuplication=true にしても良い）

既存記事（比較対象）:
${similar.map((x, i) => `(${i+1}) ${x.title}\n- summary: ${x.summary}\n- toc: ${(x.toc||[]).join(" / ")}`).join("\n\n")}

publishedDate は JST の今日（${jstDate()}）を使う。
slug は "YYYY-MM-DD_..." の形式を推奨。
`.trim();

  const finalRes = await client.responses.parse({
    model: MODEL_FINAL,
    input: finalPrompt,
    text: { format: zodTextFormat(FinalSchema, "final") },
  });

  const finalObj = finalRes.output_parsed;

  if (!finalObj.qualityChecks?.noDuplication) {
    console.error("[genba] duplication flagged:", finalObj.qualityChecks?.dupReason || "");
    // とりあえず今回は止める（暴走防止）
    return;
  }

  // 4) HTML保存
  const fileName = `${finalObj.slug}.html`;
  const outPath = path.join(PATHS.POSTS_DIR, fileName);

  const html = renderHtmlPage(finalObj);
  await fs.writeFile(outPath, html, "utf-8");
  console.log("[genba] wrote:", outPath);

  // 5) manifestに追加（auto）
  const rel = path.relative(PATHS.WEB_ROOT, outPath).replaceAll(path.sep, "/");
  const url = "/" + rel;

  const newManifest = [
    ...manifest,
    {
      source: "auto",
      title: finalObj.title,
      publishedAt: finalObj.publishedDate,
      url,
      filePath: outPath,
      toc: finalObj.toc.map(x => x.label),
      summary: safeText(draftObj.sections?.[0]?.body || "").slice(0, 360),
      updatedAtJST: nowJstIso(),
    }
  ];
  await writeJsonAtomic(FILES.MANIFEST, newManifest);

  // 6) index.html マーカー内を自動生成記事で更新（autoだけ）
  const autos = newManifest
    .filter(x => x.source === "auto")
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 200)
    .map(x => ({
      href: x.url.replace(/^\//, ""), // index.html から相対リンクとして扱うなら / を外す
      title: x.title,
      date: x.publishedAt || "",
    }));

  await updateIndexGenbaList(autos);
  console.log("[genba] index.html updated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
