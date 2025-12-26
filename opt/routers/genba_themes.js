// /opt/tshare-api/routes/genba_themes.js
import express from "express";
import { FILES, readJson, writeJsonAtomic, nowJstIso, safeText } from "../scripts/common_genba.js";

const router = express.Router();

// 取得
router.get("/themes", async (_req, res) => {
  const q = await readJson(FILES.QUEUE, []);
  res.json({ status: "ok", items: q });
});

// 追加
router.post("/themes", async (req, res) => {
  const theme = safeText(req.body?.theme || "");
  if (!theme) return res.status(400).json({ status: "ng", message: "theme is required" });

  const q = await readJson(FILES.QUEUE, []);
  q.push({
    id: `t_${Date.now()}`,
    theme,
    createdAtJST: nowJstIso(),
  });
  await writeJsonAtomic(FILES.QUEUE, q);

  res.json({ status: "ok", queued: true, size: q.length });
});

// 1件削除（id指定）
router.delete("/themes/:id", async (req, res) => {
  const id = safeText(req.params?.id || "");
  if (!id) return res.status(400).json({ status: "ng", message: "id is required" });

  const q = await readJson(FILES.QUEUE, []);
  const before = q.length;
  const next = q.filter((x) => x?.id !== id);

  if (next.length === before) {
    return res.status(404).json({ status: "ng", message: "not found" });
  }

  await writeJsonAtomic(FILES.QUEUE, next);
  res.json({ status: "ok", deleted: true, size: next.length });
});

// 全削除
router.delete("/themes", async (_req, res) => {
  await writeJsonAtomic(FILES.QUEUE, []);
  res.json({ status: "ok", cleared: true, size: 0 });
});

export default router;
