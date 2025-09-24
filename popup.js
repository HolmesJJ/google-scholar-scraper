// popup.js

const KEY = "scholar_db";
const $ = (id) => document.getElementById(id);
const setStatus = (txt) => {
  $("status").textContent = txt;
};

function isScholarAuthorUrl(u) {
  try {
    const url = new URL(u);
    const hostOk = /^scholar\.google\./.test(url.host);
    const pathOk = url.pathname.startsWith("/citations");
    const hasUser = url.search.includes("user=");
    return hostOk && pathOk && hasUser;
  } catch {
    return false;
  }
}

async function sendOrInject(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  if (!isScholarAuthorUrl(tab.url || "")) {
    throw new Error("Please open a Scholar author page (citations?user=...)");
  }
  setStatus("Scraping… (auto-loading all pages)");
  const res = await sendOrInject(tab.id, { type: "SCRAPE_SCHOLAR" });
  if (!res?.ok) throw new Error(res?.error || "Scrape failed");
  setStatus(`Scraped ${res.data.length} rows.`);
  return res.data;
}

// ---------- CSV 工具：统一列 & 规范 authors ----------
function toCsv(rows) {
  if (!rows || rows.length === 0) return "";

  // 统一所有行的列（取键的并集，保证老数据无 authors 也能导出）
  const headerSet = new Set();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));

  // 仅导出需要的列（示例：去掉 authors_raw）
  const headers = Array.from(headerSet).filter((h) => h !== "authors_raw");

  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const normalizeCell = (h, v) => {
    if (h === "authors") {
      // 数组 -> "A; B; C"
      if (Array.isArray(v)) return v.join("; ");
      return v || "";
    }
    return v ?? "";
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => escape(normalizeCell(h, r[h]))).join(",")
    ),
  ];
  return lines.join("\n");
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
    // 兼容 authors：把形如 "A; B; C" 的字符串恢复为数组
    if (obj.authors && typeof obj.authors === "string") {
      obj.authors = obj.authors
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    rows.push(obj);
  }
  return rows;
}

// ---------- 合并 ----------
function recordKey(r) {
  return [
    r.profile_user_id || "",
    (r.paper_title || "").toLowerCase(),
    r.year || "",
  ].join("||");
}

async function loadDb() {
  const o = await chrome.storage.local.get(KEY);
  return Array.isArray(o[KEY]) ? o[KEY] : [];
}

async function saveDb(rows) {
  await chrome.storage.local.set({ [KEY]: rows });
}

function mergeRows(oldRows, newRows) {
  const map = new Map(oldRows.map((r) => [recordKey(r), r]));
  for (const r of newRows) {
    const k = recordKey(r);
    if (map.has(k)) {
      const prev = map.get(k);
      const merged = {
        ...prev,
        ...r,
        citations: Math.max(
          Number(prev.citations || 0),
          Number(r.citations || 0)
        ),
        scraped_at: r.scraped_at,
      };
      map.set(k, merged);
    } else {
      map.set(k, r);
    }
  }
  return Array.from(map.values());
}

// ---------- 事件 ----------
$("btn-scan").addEventListener("click", async () => {
  try {
    setStatus("Working…");
    const fresh = await scrapeActiveTab();
    const db = await loadDb();
    const merged = mergeRows(db, fresh);
    await saveDb(merged);
    setStatus(`Updated database: +${fresh.length} (total ${merged.length})`);
  } catch (e) {
    setStatus("Error: " + e.message);
  }
});

$("btn-download").addEventListener("click", async () => {
  try {
    const db = await loadDb();
    if (db.length === 0) {
      setStatus("Nothing to download. Please Scan first.");
      return;
    }
    const csv = toCsv(db);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: "scholar_export.csv",
      saveAs: true,
    });
    setStatus("CSV downloaded.");
  } catch (e) {
    setStatus("Error: " + e.message);
  }
});

$("btn-import").addEventListener("click", async () => {
  try {
    const file = $("file-import").files?.[0];
    if (!file) {
      setStatus("Choose a CSV first.");
      return;
    }
    const text = await file.text();
    const rows = parseCsv(text);
    const db = await loadDb();
    const merged = mergeRows(db, rows);
    await saveDb(merged);
    setStatus(`Imported ${rows.length} rows. Total ${merged.length}.`);
  } catch (e) {
    setStatus("Error: " + e.message);
  }
});
