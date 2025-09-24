// content.js — 只在 Scholar 作者页上工作

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

if (!/^scholar\.google\./.test(location.host)) {
  // 非 Scholar 页面，不注入逻辑
} else {
  async function clickShowMoreUntilDone(maxClicks = 200) {
    for (let i = 0; i < maxClicks; i++) {
      const btn = document.getElementById("gsc_bpf_more");
      if (!btn) break;
      if (btn.hasAttribute("disabled") || btn.classList.contains("gs_dis"))
        break;
      btn.click();
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
    }
  }

  const textOrNull = (el) => (el ? el.textContent.trim() : null);

  function getProfileUserIdFromUrl() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get("user") || null;
    } catch {
      return null;
    }
  }

  function scrapeProfileOnce() {
    const profile_name = textOrNull(document.getElementById("gsc_prf_in"));
    const affiliation = textOrNull(document.querySelector(".gsc_prf_il"));
    const profile_url = location.href;
    const profile_user_id = getProfileUserIdFromUrl();

    const rows = Array.from(document.querySelectorAll(".gsc_a_tr"));

    const items = rows.map((r) => {
      const titleA = r.querySelector(".gsc_a_at");
      const paper_title = titleA ? titleA.textContent.trim() : null;
      const paper_url = titleA ? titleA.href : null;

      // 第一行：作者；第二行：期刊/会议
      const gray = r.querySelectorAll(".gsc_a_t .gs_gray");
      const authors_raw = gray[0] ? gray[0].textContent.trim() : null;
      const journal = gray[1] ? gray[1].textContent.trim() : null;

      // 拆分作者：按逗号切分并去空格
      const authors = authors_raw
        ? authors_raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const yearTxt = textOrNull(r.querySelector(".gsc_a_y span"));
      const year = yearTxt ? Number(yearTxt) : null;

      const citesTxt = textOrNull(r.querySelector(".gsc_a_ac"));
      const citations = citesTxt && citesTxt !== "—" ? Number(citesTxt) : 0;

      return {
        profile_name,
        affiliation,
        profile_user_id,
        profile_url,
        paper_title,
        paper_url,
        authors_raw,
        authors, // 在 CSV 中会以 “; ” 连接
        journal,
        year,
        citations,
        scraped_at: new Date().toISOString(),
      };
    });

    return items;
  }

  async function runFullScrape() {
    await clickShowMoreUntilDone();
    return scrapeProfileOnce();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "SCRAPE_SCHOLAR") {
      runFullScrape()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });
}
