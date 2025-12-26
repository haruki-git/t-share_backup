(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function ensureDmp() {
    if (typeof diff_match_patch === "undefined") {
      throw new Error("diff-match-patch が読み込まれていません。scriptタグを確認してください。");
    }
    return new diff_match_patch();
  }

  function renderDiff(a, b) {
    const dmp = ensureDmp();
    const diffs = dmp.diff_main(a, b);
    dmp.diff_cleanupSemantic(diffs);

    // dmp.diff_prettyHtml は <ins> <del> を含むHTMLを返す（ハイライトはCSSで）
    return dmp.diff_prettyHtml(diffs);
  }

  function onCompare() {
    const a = $("textA").value ?? "";
    const b = $("textB").value ?? "";
    const result = $("diffResult");

    if (!a && !b) {
      result.innerHTML = "<span class='muted'>A/Bにテキストを入れてください。</span>";
      return;
    }

    try {
      const html = renderDiff(a, b);
      result.innerHTML = html;
    } catch (e) {
      result.innerHTML = `<span class="muted">エラー: ${String(e.message || e)}</span>`;
    }
  }

  function onSwap() {
    const a = $("textA").value;
    $("textA").value = $("textB").value;
    $("textB").value = a;
    onCompare();
  }

  function onClear() {
    $("textA").value = "";
    $("textB").value = "";
    $("diffResult").innerHTML = "<span class='muted'>ここに差分が表示されます。</span>";
  }

  // 初期化
  window.addEventListener("DOMContentLoaded", () => {
    $("btnCompare").addEventListener("click", onCompare);
    $("btnSwap").addEventListener("click", onSwap);
    $("btnClearCompare").addEventListener("click", onClear);

    // 初期メッセージ
    $("diffResult").innerHTML = "<span class='muted'>ここに差分が表示されます。</span>";
  });
})();
