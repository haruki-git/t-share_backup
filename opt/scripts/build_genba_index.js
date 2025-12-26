// /opt/tshare-api/scripts/build_genba_index.js
import fs from "fs";
import path from "path";

const OUT_DIR = "/var/www/html/posts/genba";
const OUT_FILE = path.join(OUT_DIR, "index.html");

// 手書き記事も混ぜる（/posts/genba/ から見た相対）
const MANUAL_ITEMS = [
  { href: "../win_command_file.html", title: "PowerShellコマンド：テキスト系ファイルの操作", date: "2025-11-27" },
  { href: "../win_command.html",      title: "PowerShellコマンド：フォルダの操作",        date: "2025-11-25" },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function extractTitle(html) {
  const h1 = (html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .trim();
  const title = (html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? "").trim();
  return h1 || title || "(no title)";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateFromFilename(filename) {
  const m = filename.match(/^genba_(\d{4}-\d{2}-\d{2})_\d+\.html$/);
  return m ? m[1] : "";
}

function main() {
  ensureDir(OUT_DIR);

  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => f !== "index.html");

  const autoItems = files.map((f) => {
    const p = path.join(OUT_DIR, f);
    const html = fs.readFileSync(p, "utf-8");
    const title = extractTitle(html);
    const date = dateFromFilename(f) || "";
    const st = fs.statSync(p);
    return {
      href: f,
      title,
      date,
      mtime: st.mtimeMs,
      kind: "auto",
    };
  });

  const manualItems = MANUAL_ITEMS.map((it) => ({
    href: it.href,
    title: it.title,
    date: it.date || "",
    mtime: Date.parse(it.date) || 0,
    kind: "manual",
  }));

  const items = [...autoItems, ...manualItems].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return b.mtime - a.mtime;
  });

const bodyList =
  items.length === 0
    ? `<p>まだ記事がありません。</p>`
    : (() => {
        const lis = items
          .map((it) => {
            const date = it.date || "";
            const title = it.title || "";
            return `  <li data-date="${escapeHtml(date)}" data-title="${escapeHtml(title)}" data-mtime="${String(
              it.mtime ?? 0
            )}">
    <a href="${escapeHtml(it.href)}">${escapeHtml(title)}</a>${date ? ` (${escapeHtml(date)})` : ""}
  </li>`;
          })
          .join("\n");

        return `
<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0;">
  <span class="badge">並び替え</span>
  <select id="sortArticles" class="input" style="width:auto;">
    <option value="dateDesc">新しい順</option>
    <option value="dateAsc">古い順</option>
    <option value="titleAsc">タイトル A→Z</option>
    <option value="titleDesc">タイトル Z→A</option>
  </select>
</div>

<ul id="articleList">
${lis}
</ul>

<script>
(() => {
  const sel = document.getElementById("sortArticles");
  const list = document.getElementById("articleList");

  const getDate = (li) => li.dataset.date || "";
  const getTitle = (li) => li.dataset.title || li.textContent || "";
  const getMtime = (li) => Number(li.dataset.mtime || 0);

  function cmpDate(a, b, dir) {
_hook: {
    const da = getDate(a), db = getDate(b);
    if (da && db) return dir * da.localeCompare(db); // YYYY-MM-DD なので文字比較でOK
    if (da && !db) return -1;
    if (!da && db) return  1;
    return dir * (getMtime(a) - getMtime(b)); // dateが無いときはmtime
  }
  }

  function sortAndRender(mode) {
    const items = Array.from(list.querySelectorAll("li"));

    items.sort((a, b) => {
      switch (mode) {
        case "dateAsc":  return cmpDate(a, b, +1);
        case "dateDesc": return cmpDate(a, b, -1);
        case "titleAsc": return getTitle(a).localeCompare(getTitle(b), "ja");
        case "titleDesc": return getTitle(b).localeCompare(getTitle(a), "ja");
        default: return 0;
      }
    });

    const frag = document.createDocumentFragment();
    items.forEach((li) => frag.appendChild(li)); // 既存ノードは移動する
    list.appendChild(frag);
  }

  sel.addEventListener("change", () => sortAndRender(sel.value));
  sortAndRender(sel.value); // 初期表示
})();
</script>
        `.trim();
      })();


  // ▼▼ キューUI（Homeの下あたりに配置）
  const queueUi = `
<section class="card" style="margin-top:16px;">
  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
    <span class="badge" id="queueCurrent">設定中のテーマ：読み込み中...</span>
  </div>

  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px;">
    <input id="themeInput" class="input" style="min-width:260px; flex:1;" placeholder="例：PCの便利機能(Windows)" />
    <button class="btn primary" id="btnAdd">追加</button>
    <button class="btn" id="btnClear">全削除</button>
    <button class="btn" id="btnReload">更新</button>
  </div>

  <div id="queueList" style="margin-top:10px;"></div>

  <p style="margin-top:10px; opacity:.8; font-size:.9em;">
    ※追加したテーマは、次回の自動生成で先頭から1件消費されます。
  </p>
</section>

<script>
(async () => {
  const $ = (id) => document.getElementById(id);

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
    if (!res.ok) {
      const msg = (data && data.message) ? data.message : (typeof data === "string" ? data : ("HTTP " + res.status));
      throw new Error(msg);
    }
    return data;
  }

  function renderQueue(items) {
    const current = items && items.length ? items[0].theme : "";
    $("queueCurrent").textContent = "設定中のテーマ：" + (current || "(なし)");

    const box = $("queueList");
    box.innerHTML = "";

    if (!items || items.length === 0) {
      const p = document.createElement("p");
      p.textContent = "キューは空です。";
      box.appendChild(p);
      return;
    }

    const ol = document.createElement("ol");
    ol.style.margin = "0";
    ol.style.paddingLeft = "1.2em";

    items.forEach((it, idx) => {
      const li = document.createElement("li");
      li.style.margin = "6px 0";

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.flexWrap = "wrap";
      row.style.alignItems = "center";

      const text = document.createElement("span");
      text.textContent = it.theme;

      const meta = document.createElement("span");
      meta.style.opacity = ".7";
      meta.style.fontSize = ".85em";
      meta.textContent = it.createdAtJST ? ("(" + it.createdAtJST + ")") : "";

      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "削除";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await fetchJson("/api/genba/themes/" + encodeURIComponent(it.id), { method: "DELETE" });
          await loadQueue();
        } catch (e) {
          alert("削除失敗: " + (e && e.message ? e.message : e));
        } finally {
          btn.disabled = false;
        }
      });

      // 先頭は「次に生成されるやつ」なので分かりやすく
      if (idx === 0) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "次に生成";
        row.appendChild(badge);
      }

      row.appendChild(text);
      if (meta.textContent) row.appendChild(meta);
      row.appendChild(btn);

      li.appendChild(row);
      ol.appendChild(li);
    });

    box.appendChild(ol);
  }

  async function loadQueue() {
    const data = await fetchJson("/api/genba/themes", { method: "GET" });
    renderQueue(data.items || []);
  }

  $("btnReload").addEventListener("click", () => loadQueue().catch(e => alert(e.message || e)));

  $("btnAdd").addEventListener("click", async () => {
    const v = $("themeInput").value.trim();
    if (!v) return alert("テーマを入力してください。");

    $("btnAdd").disabled = true;
    try {
      await fetchJson("/api/genba/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: v }),
      });
      $("themeInput").value = "";
      await loadQueue();
    } catch (e) {
      alert("追加失敗: " + (e && e.message ? e.message : e));
    } finally {
      $("btnAdd").disabled = false;
    }
  });

  $("btnClear").addEventListener("click", async () => {
    if (!confirm("キューを全削除します。よろしいですか？")) return;
    $("btnClear").disabled = true;
    try {
      await fetchJson("/api/genba/themes", { method: "DELETE" });
      await loadQueue();
    } catch (e) {
      alert("全削除失敗: " + (e && e.message ? e.message : e));
    } finally {
      $("btnClear").disabled = false;
    }
  });

  // 初回ロード
  try {
    await loadQueue();
  } catch (e) {
    $("queueCurrent").textContent = "設定中のテーマ：取得失敗";
    $("queueList").textContent = "APIに繋がりませんでした: " + (e.message || e);
  }
})();
</script>
`.trim();

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>現場で使える(土曜日に自動生成)</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header>
    <h1>現場で使える(土曜日に自動生成)</h1>
    <nav>
      <a href="/index.html">Home</a>
    </nav>
  </header>

  <main>
    ${queueUi}
    ${bodyList}
  </main>

  <footer>
    <p>c 2025 hi</p>
  </footer>
</body>
</html>
`;

  fs.writeFileSync(OUT_FILE, html, "utf-8");
  console.log("wrote:", OUT_FILE);
  console.log("count:", items.length);
}

main();
