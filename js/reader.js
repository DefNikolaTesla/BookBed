import { db, addBookmark, removeBookmark, addHighlight, removeHighlight, upsertReadingState } from "./db.js";
import { state } from "./store.js";
import { EpubEngine, READER_THEMES, HIGHLIGHT_STYLES } from "./epub-engine.js";
import { PdfEngine } from "./pdf-engine.js";
import { formatPercent, escapeHtml } from "./util.js";
import { toast } from "./toasts.js";
import { renderLibrary } from "./library.js";

const THEME_NAMES = { paper: "Paper", sepia: "Sepia", night: "Night", mint: "Mint" };

let engine = null;
let currentBook = null;
let bookmarks = [];
let highlights = [];
let phase = "loading";
let progress = { percentage: 0, cfi: null, page: null, label: "" };
let chromeTimer = null;
let chromeVisible = true;
let saveTimer = null;
let resumed = false;
let sliderSeeking = false;
let locationsPoll = null;

const $ = (id) => document.getElementById(id);

export function openReader(bookId) {
  window.__bookbedReaderOpen = true;
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;
  currentBook = book;
  phase = "loading";
  progress = { percentage: 0, cfi: null, page: null, label: "" };
  resumed = false;
  engine = null;
  bookmarks = [];
  highlights = [];
  if (locationsPoll) clearInterval(locationsPoll);
  locationsPoll = null;

  $("library-view").classList.add("hidden");
  $("reader-view").classList.remove("hidden");
  void import("./scene.js").then((m) => m.pauseScene());
  $("reader-title").textContent = book.title;
  $("reader-sub").textContent = book.author || (book.format === "pdf" ? "PDF document" : "EPUB book");
  $("reader-pos").textContent = "—";
  $("reader-pct").textContent = "0%";
  $("reader-slider").value = 0;
  updateSliderFill();
  showChrome();
  $("resume-bar").classList.add("hidden");
  $("selection-bar").classList.add("hidden");
  closeSheet();

  const stage = $("reader-stage");
  stage.innerHTML = "";
  const isEpub = book.format === "epub";
  $("reader-view").classList.toggle("rt-pdf", !isEpub);
  $("reader-view").classList.remove("rt-paper", "rt-sepia", "rt-night", "rt-mint");
  if (isEpub) $("reader-view").classList.add(`rt-${state.settings.readerTheme}`);

  const events = {
    onRelocate: ({ percentage, cfi, page, label }) => {
      progress = { percentage, cfi, page: page ?? null, label: label ?? "" };
      updateChrome();
      saveProgress();
      maybeShowResume();
    },
    onTapped: (zone) => {
      if (zone === "center") toggleChrome();
      else if (zone === "left") void engine?.prev();
      else void engine?.next();
    },
    onSelected: (cfi, text) => showSelectionBar(cfi, text),
    onReady: async () => {
      phase = "ready";
      await loadAnnotations();
      const eng = engine;
      if (eng && isEpub) {
        eng.applyAllHighlights(highlights);
        renderTocSheetContent(eng.getToc());
        startLocationsPoll(eng);
        const saved = state.states.get(currentBook.id);
        if (saved?.cfi && saved.percentage > 0.004 && saved.percentage < 0.996) {
          try {
            await eng.display(saved.cfi);
          } catch {
            /* ignore */
          }
        }
      } else if (eng && !isEpub) {
        const saved = state.states.get(currentBook.id);
        if (saved?.page && saved.page > 1) eng.displayPage(saved.page);
      }
      scheduleChromeHide();
    },
    onError: (err) => {
      console.error(err);
      phase = "error";
      toast({ title: "Couldn't open this book", description: String(err?.message ?? err), kind: "error" });
    },
  };

  void loadAnnotations();

  if (book.format === "epub") {
    engine = new EpubEngine(book.file, stage, { ...state.settings }, events);
  } else {
    engine = new PdfEngine(book.file, stage, events, state.settings.zoom ?? 1);
  }

  // keyboard
  window.addEventListener("keydown", onKey);
}

function onKey(e) {
  if ($("reader-view").classList.contains("hidden")) return;
  if (e.key === "ArrowRight") void engine?.next();
  else if (e.key === "ArrowLeft") void engine?.prev();
  else if (e.key === "Escape") {
    if (!$("sheet").classList.contains("hidden")) closeSheet();
    else closeReader();
  }
}

function closeReader() {
  window.__bookbedReaderOpen = false;
  if (locationsPoll) clearInterval(locationsPoll);
  locationsPoll = null;
  window.removeEventListener("keydown", onKey);
  if (chromeTimer) clearTimeout(chromeTimer);
  try {
    engine?.destroy();
  } catch {
    /* ignore */
  }
  engine = null;
  currentBook = null;
  $("reader-view").classList.add("hidden");
  $("library-view").classList.remove("hidden");
  void import("./scene.js").then((m) => m.resumeScene());
  renderLibrary();
}

/* ---------- chrome ---------- */
function showChrome() {
  chromeVisible = true;
  $("reader-view").classList.remove("chrome-hidden");
}
function hideChrome() {
  chromeVisible = false;
  $("reader-view").classList.add("chrome-hidden");
}
function toggleChrome() {
  chromeVisible ? hideChrome() : showChrome();
  scheduleChromeHide();
}
function scheduleChromeHide() {
  if (chromeTimer) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => hideChrome(), 3200);
}

/* ---------- progress ---------- */
function updateChrome() {
  const pct = Math.round(progress.percentage * 100);
  $("reader-pct").textContent = `${pct}%`;
  const label =
    progress.label ||
    (progress.page ? `Page ${progress.page}` : "Location") ||
    "";
  $("reader-pos").textContent = label;
  if (!sliderSeeking) {
    $("reader-slider").value = Math.round(progress.percentage * 1000);
    updateSliderFill();
  }
  const total = engine?.numPages;
  if (total && progress.page) {
    $("reader-pos").textContent = `Page ${progress.page} / ${total}`;
  }
}

function updateSliderFill() {
  const slider = $("reader-slider");
  const pct = (slider.value / 1000) * 100;
  slider.style.setProperty("--fill", `${pct}%`);
}

function saveProgress() {
  if (!currentBook || phase !== "ready") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void upsertReadingState({
      bookId: currentBook.id,
      percentage: progress.percentage,
      cfi: progress.cfi,
      page: progress.page,
    });
    const s = state.states.get(currentBook.id) ?? {};
    s.percentage = progress.percentage;
    state.states.set(currentBook.id, s);
  }, 400);
}

function maybeShowResume() {
  if (resumed) return;
  const p = progress.percentage;
  if (p > 0.005 && p < 0.99 && currentBook) {
    resumed = true;
    const bar = $("resume-bar");
    bar.classList.remove("hidden");
    const pct = formatPercent(p);
    $("resume-text").textContent = `${pct} through “${currentBook.title}”`;
    $("resume-btn").onclick = () => {
      bar.classList.add("hidden");
      scheduleChromeHide();
    };
    $("restart-btn").onclick = () => {
      bar.classList.add("hidden");
      if (currentBook.format === "pdf") engine?.displayPage(1);
      else void engine?.display(undefined);
    };
  }
}

/* ---------- slider ---------- */
function initSlider() {
  const slider = $("reader-slider");
  slider.addEventListener("input", () => {
    sliderSeeking = true;
    updateSliderFill();
    showChrome();
  });
  slider.addEventListener("change", () => {
    sliderSeeking = false;
    const p = Number(slider.value) / 1000;
    const eng = engine;
    if (!eng) return;
    if (eng.isLocationsReady?.()) {
      const cfi = eng.cfiFromPercentage(p);
      if (cfi) void eng.display(cfi);
      else {
        progress.percentage = p;
        updateChrome();
      }
    } else if (eng instanceof PdfEngine) {
      const page = Math.max(1, Math.round(p * (eng.numPages - 1)) + 1);
      eng.displayPage(page);
    } else {
      toast({ title: "Indexing… try again in a moment" });
    }
    scheduleChromeHide();
  });
}

/* ---------- selection & highlights ---------- */
function showSelectionBar(cfi, text) {
  if (phase !== "ready") return;
  const bar = $("selection-bar");
  $("selection-text").textContent = text.trim().replace(/\s+/g, " ").slice(0, 90);
  bar.classList.remove("hidden");
  const chips = bar.querySelectorAll(".hl-chip");
  chips.forEach((chip) => {
    chip.classList.remove("selected");
    chip.onclick = async () => {
      const color = chip.dataset.color;
      chips.forEach((c) => c.classList.toggle("selected", c === chip));
      const id = await addHighlight(currentBook.id, { cfi, color, text: text.slice(0, 240) });
      highlights.push({ id, bookId: currentBook.id, cfi, color, text: text.slice(0, 240), createdAt: Date.now() });
      engine?.addHighlight(cfi, color);
      hideSelectionBar();
      renderHighlightsSheetContent();
      toast({ title: "Highlight added", kind: "success", duration: 1800 });
    };
  });
  $("selection-clear").onclick = () => hideSelectionBar();
}
function hideSelectionBar() {
  $("selection-bar").classList.add("hidden");
  engine?.clearSelection();
}

async function loadAnnotations() {
  if (!currentBook) return;
  const [bm, hl] = await Promise.all([
    db.bookmarks.where("bookId").equals(currentBook.id).toArray(),
    db.highlights.where("bookId").equals(currentBook.id).toArray(),
  ]);
  bookmarks = bm;
  highlights = hl;
  updateBookmarkButton();
  renderBookmarksSheetContent();
  renderHighlightsSheetContent();
}

/* ---------- bookmarks ---------- */
function updateBookmarkButton() {
  const btn = $("reader-bookmark-btn");
  const active = bookmarks.some((b) => b.cfi && b.cfi === progress.cfi) || bookmarks.some((b) => b.page && b.page === progress.page);
  btn.classList.toggle("active", active);
}

/* ---------- sheets ---------- */
function openSheet(html) {
  const sheet = $("sheet");
  sheet.innerHTML = html;
  sheet.classList.remove("hidden");
  $("sheet-backdrop").classList.remove("hidden");
}
function closeSheet() {
  $("sheet").classList.add("hidden");
  $("sheet-backdrop").classList.add("hidden");
}
function initSheets() {
  $("sheet-backdrop").addEventListener("click", closeSheet);

  $("reader-back").addEventListener("click", closeReader);

  $("reader-settings-btn").addEventListener("click", () => {
    openSheet(settingsSheetHtml());
    bindSettingsSheet();
    scheduleChromeHide();
  });

  $("reader-toc-btn").addEventListener("click", () => {
    openSheet(tocSheetHtml());
    if (currentBook?.format === "epub") {
      bindTocSheet(engine?.getToc() ?? []);
    } else {
      renderPdfToc();
    }
    scheduleChromeHide();
  });

  $("reader-bookmark-btn").addEventListener("click", toggleBookmark);

  const moreBtn = $("reader-more-btn");
  const moreMenu = $("reader-more-menu");
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle("hidden");
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#reader-more-wrap")) moreMenu.classList.add("hidden");
  });
  moreMenu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      moreMenu.classList.add("hidden");
      if (btn.dataset.sheet === "bookmarks") {
        openSheet(bookmarksSheetHtml());
        renderBookmarksSheetContent();
      } else {
        openSheet(highlightsSheetHtml());
        renderHighlightsSheetContent();
      }
      scheduleChromeHide();
    });
  });
}

function toggleBookmark() {
  if (!currentBook || phase !== "ready") return;
  const isPdf = currentBook.format === "pdf";
  const existing = bookmarks.find((b) =>
    isPdf ? b.page === progress.page : b.cfi === progress.cfi
  );
  if (existing) {
    void removeBookmark(existing.id);
    bookmarks = bookmarks.filter((b) => b.id !== existing.id);
    toast({ title: "Bookmark removed", duration: 1600 });
  } else {
    void addBookmark(currentBook.id, {
      cfi: progress.cfi,
      page: progress.page,
      label: isPdf ? `Page ${progress.page}` : progress.label || "Bookmark",
    }).then((id) => {
      bookmarks.push({
        id,
        bookId: currentBook.id,
        cfi: progress.cfi,
        page: progress.page,
        label: isPdf ? `Page ${progress.page}` : progress.label || "Bookmark",
        createdAt: Date.now(),
      });
      renderBookmarksSheetContent();
      toast({ title: "Bookmark added", kind: "success", duration: 1600 });
    });
  }
  updateBookmarkButton();
}

/* ---------- settings sheet ---------- */
function settingsSheetHtml() {
  const s = state.settings;
  const themeBtns = Object.keys(THEME_NAMES)
    .map(
      (k) => `
      <button class="theme-chip ${s.readerTheme === k ? "active" : ""}" data-theme="${k}">
        <div class="theme-swatch" style="background:${READER_THEMES[k].paper};color:${READER_THEMES[k].ink}">
          <div style="width:34px;height:5px;border-radius:3px;background:${READER_THEMES[k].ink};margin:14px auto 0"></div>
          <div style="width:22px;height:3px;border-radius:2px;background:${READER_THEMES[k].ink};opacity:.6;margin:4px auto 0"></div>
        </div>
        <div class="theme-chip-label">${THEME_NAMES[k]}</div>
      </button>`
    )
    .join("");
  const fontBtns = [
    ["serif", "Serif", "serif"],
    ["sans", "Sans", "sans"],
    ["mono", "Mono", "mono"],
  ]
    .map(
      ([k, label, cls]) =>
        `<button class="font-chip ${cls} ${s.fontFamily === k ? "active" : ""}" data-font="${k}">${label}</button>`
    )
    .join("");
  const pdfOnly = currentBook?.format === "pdf" ? "" : "hidden";
  return `
    <div class="sheet-handle"></div>
    <div class="sheet-title">Reader settings</div>

    <div class="setting-row">
      <div class="setting-label">Theme</div>
      <div class="theme-chips">${themeBtns}</div>
    </div>

    <div class="setting-row">
      <div class="setting-label">Font</div>
      <div class="font-chips">${fontBtns}</div>
    </div>

    <div class="font-preview fp-${s.fontFamily}" id="font-preview" style="font-size:${s.fontSize * 0.16}px;line-height:${s.lineHeight ?? 1.7};text-align:${s.justify === false ? "left" : "justify"}">The quick brown fox jumps over the lazy dog. Reading feels better when every detail fits you.</div>

    <div class="setting-row">
      <div class="setting-label">Text size</div>
      <div class="slider-row">
        <input type="range" id="set-font-size" min="80" max="160" step="5" value="${s.fontSize}" />
        <span class="slider-val" id="font-size-val">${s.fontSize}%</span>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-label">Line spacing</div>
      <div class="slider-row">
        <input type="range" id="set-line-height" min="130" max="220" step="10" value="${Math.round((s.lineHeight ?? 1.7) * 100)}" />
        <span class="slider-val" id="line-height-val">${(s.lineHeight ?? 1.7).toFixed(1)}</span>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-label">Margins</div>
      <div class="chip-row">
        <button class="chip ${s.margins === 0 ? "active" : ""}" data-margin="0">Tight</button>
        <button class="chip ${s.margins === 1 ? "active" : ""}" data-margin="1">Normal</button>
        <button class="chip ${s.margins === 2 ? "active" : ""}" data-margin="2">Wide</button>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-label">Reading flow</div>
      <div class="segmented">
        <button class="${s.flow === "paginated" ? "active" : ""}" data-flow="paginated">Paged</button>
        <button class="${s.flow === "scrolled" ? "active" : ""}" data-flow="scrolled">Scrolled</button>
      </div>
    </div>

    <div class="toggle-row">
      <div class="setting-label">Justify text</div>
      <button class="switch ${s.justify === false ? "" : "on"}" id="set-justify" aria-label="Toggle justification"></button>
    </div>

    <div class="setting-row ${pdfOnly}">
      <div class="setting-label">Zoom</div>
      <div class="slider-row">
        <input type="range" id="set-zoom" min="60" max="250" step="5" value="${Math.round((state.settings.zoom ?? 1) * 100)}" />
        <span class="slider-val" id="zoom-val">${Math.round((state.settings.zoom ?? 1) * 100)}%</span>
      </div>
    </div>
  `;
}

function bindSettingsSheet() {
  const s = state.settings;
  const apply = (patch) => {
    void import("./store.js").then((m) => m.patchSettings(patch));
    const merged = { ...state.settings, ...patch };
    state.settings = merged;
    engine?.applySettings(merged);
    if (patch.flow && engine?.setFlow) {
      void (async () => {
        await engine.setFlow(patch.flow);
        engine.applyAllHighlights(highlights);
      })();
    }
  };

  $("sheet").querySelectorAll(".theme-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("sheet").querySelectorAll(".theme-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      $("reader-view").classList.remove("rt-paper", "rt-sepia", "rt-night", "rt-mint");
      $("reader-view").classList.add(`rt-${chip.dataset.theme}`);
      apply({ readerTheme: chip.dataset.theme });
    });
  });

  $("sheet").querySelectorAll(".font-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("sheet").querySelectorAll(".font-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      apply({ fontFamily: chip.dataset.font });
    });
  });

  const size = $("set-font-size");
  size.addEventListener("input", () => {
    $("font-size-val").textContent = `${size.value}%`;
    $("font-preview").style.fontSize = `${Number(size.value) * 0.16}px`;
    apply({ fontSize: Number(size.value) });
  });

  const lh = $("set-line-height");
  lh.addEventListener("input", () => {
    $("line-height-val").textContent = (Number(lh.value) / 100).toFixed(1);
    $("font-preview").style.lineHeight = String(Number(lh.value) / 100);
    apply({ lineHeight: Number(lh.value) / 100 });
  });

  $("sheet").querySelectorAll(".font-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("sheet").querySelectorAll(".font-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      $("font-preview").className = `font-preview fp-${chip.dataset.font}`;
      apply({ fontFamily: chip.dataset.font });
    });
  });

  $("sheet").querySelectorAll(".chip[data-margin]").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("sheet").querySelectorAll(".chip[data-margin]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      apply({ margins: Number(chip.dataset.margin) });
    });
  });

  $("sheet").querySelectorAll("[data-flow]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("sheet").querySelectorAll("[data-flow]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      apply({ flow: btn.dataset.flow });
    });
  });

  const justify = $("set-justify");
  justify.addEventListener("click", () => {
    const next = justify.classList.contains("on") ? false : true;
    justify.classList.toggle("on", next);
    $("font-preview").style.textAlign = next ? "justify" : "left";
    apply({ justify: next });
  });

  const zoom = $("set-zoom");
  if (zoom) {
    zoom.addEventListener("input", () => {
      $("zoom-val").textContent = `${zoom.value}%`;
      apply({ zoom: Number(zoom.value) / 100 });
      if (engine instanceof PdfEngine) engine.setZoom(Number(zoom.value) / 100);
    });
  }
}

/* ---------- toc sheet ---------- */
function tocSheetHtml() {
  return `
    <div class="sheet-handle"></div>
    <div class="sheet-title">Contents <span class="count" id="toc-count"></span></div>
    <div class="sheet-list" id="toc-list"></div>`;
}

function renderTocSheetContent(toc) {
  const list = $("toc-list");
  if (!list) return;
  list.innerHTML = "";
  $("toc-count").textContent = String(countToc(toc));
  const frag = document.createDocumentFragment();
  for (const entry of toc) frag.appendChild(tocItemEl(entry));
  list.appendChild(frag);
}

function tocItemEl(entry) {
  const div = document.createElement("div");
  div.className = `list-item ${!entry.cfi ? "no-cfi" : ""}`;
  const hasChildren = entry.children?.length > 0;
  div.innerHTML = `
    <span class="list-item-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    </span>
    <span class="list-item-text"><div class="list-item-title">${escapeHtml(entry.label)}</div></span>`;
  if (entry.cfi) {
    div.addEventListener("click", () => {
      closeSheet();
      void engine?.display(entry.cfi);
      scheduleChromeHide();
    });
  } else if (hasChildren) {
    div.style.cursor = "default";
  }
  if (hasChildren) {
    const nested = document.createElement("div");
    nested.className = "sheet-list toc-nested";
    for (const child of entry.children ?? []) nested.appendChild(tocItemEl(child));
    div.appendChild(nested);
  }
  return div;
}

function countToc(items) {
  return items.reduce((n, i) => n + 1 + countToc(i.children ?? []), 0);
}

function bindTocSheet(toc) {
  renderTocSheetContent(toc);
}

function renderPdfToc() {
  const list = $("toc-list");
  $("toc-count").textContent = String(engine?.numPages ?? 0);
  list.innerHTML = "";
  for (let i = 1; i <= (engine?.numPages ?? 0); i++) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span class="list-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5"/></svg>
      </span>
      <span class="list-item-text"><div class="list-item-title">Page ${i}</div></span>`;
    div.addEventListener("click", () => {
      closeSheet();
      engine?.displayPage(i);
      scheduleChromeHide();
    });
    list.appendChild(div);
  }
}

/* ---------- bookmarks & highlights sheets ---------- */
function bookmarksSheetHtml() {
  return `
    <div class="sheet-handle"></div>
    <div class="sheet-title">Bookmarks <span class="count">${bookmarks.length}</span></div>
    <div class="sheet-list" id="bm-list"></div>`;
}
function highlightsSheetHtml() {
  return `
    <div class="sheet-handle"></div>
    <div class="sheet-title">Highlights <span class="count">${highlights.length}</span></div>
    <div class="sheet-list" id="hl-list"></div>`;
}

function renderBookmarksSheetContent() {
  const list = $("bm-list");
  if (!list) return;
  list.innerHTML = "";
  if (!bookmarks.length) {
    list.innerHTML = `<div class="sheet-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      No bookmarks yet — tap the ribbon icon while reading.
    </div>`;
    return;
  }
  const sorted = [...bookmarks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const bm of sorted) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span class="list-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      </span>
      <span class="list-item-text">
        <div class="list-item-title">${escapeHtml(bm.label ?? (bm.page ? `Page ${bm.page}` : "Bookmark"))}</div>
        <div class="list-item-sub">${bm.page ? `Page ${bm.page}` : ""}</div>
      </span>
      <span class="list-item-actions">
        <button class="icon-btn" data-act="del" aria-label="Delete bookmark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </span>`;
    div.addEventListener("click", (e) => {
      if (e.target.closest("[data-act=del]")) return;
      closeSheet();
      if (bm.cfi) void engine?.display(bm.cfi);
      else if (bm.page) engine?.displayPage?.(bm.page);
      scheduleChromeHide();
    });
    div.querySelector("[data-act=del]").addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeBookmark(bm.id);
      bookmarks = bookmarks.filter((x) => x.id !== bm.id);
      renderBookmarksSheetContent();
      updateBookmarkButton();
    });
    list.appendChild(div);
  }
}

function renderHighlightsSheetContent() {
  const list = $("hl-list");
  if (!list) return;
  list.innerHTML = "";
  if (!highlights.length) {
    list.innerHTML = `<div class="sheet-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m11 9 4-4 4 4-4 4"/><path d="m15 5 4 4"/></svg>
      No highlights yet — select text while reading, then pick a color.
    </div>`;
    return;
  }
  const sorted = [...highlights].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const hl of sorted) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span class="hl-swatch" style="background:${HIGHLIGHT_STYLES[hl.color]?.fill ?? "rgba(250,204,21,.42)"}"></span>
      <span class="list-item-text">
        <div class="list-item-title">${escapeHtml(hl.text ?? "Highlight")}</div>
      </span>
      <span class="list-item-actions">
        <button class="icon-btn" data-act="del" aria-label="Delete highlight">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </span>`;
    div.addEventListener("click", (e) => {
      if (e.target.closest("[data-act=del]")) return;
      closeSheet();
      void engine?.display(hl.cfi);
      scheduleChromeHide();
    });
    div.querySelector("[data-act=del]").addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeHighlight(hl.id);
      highlights = highlights.filter((x) => x.id !== hl.id);
      engine?.removeHighlight(hl.cfi);
      renderHighlightsSheetContent();
    });
    list.appendChild(div);
  }
}

/* ---------- locations poll (epub slider seeking) ---------- */
function startLocationsPoll(eng) {
  if (locationsPoll) clearInterval(locationsPoll);
  locationsPoll = setInterval(() => {
    if (eng?.isLocationsReady?.()) {
      clearInterval(locationsPoll);
      locationsPoll = null;
      updateChrome();
    }
  }, 600);
}

/* ---------- swipe (paged epub) ---------- */
function initSwipe() {
  const stage = $("reader-stage");
  stage.addEventListener("click", () => {
    if (currentBook?.format !== "epub") toggleChrome();
  });
  let gesture = null;
  const onStart = (e) => {
    if (currentBook?.format !== "epub") return;
    if (state.settings.flow !== "paginated") return;
    const t = e.touches[0];
    gesture = { x: t.clientX, y: t.clientY, done: false };
  };
  const onMove = (e) => {
    if (!gesture || gesture.done) return;
    const t = e.touches[0];
    const dx = t.clientX - gesture.x;
    const dy = t.clientY - gesture.y;
    if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    gesture.done = true;
    e.preventDefault();
    void (dx < 0 ? engine?.next() : engine?.prev());
    scheduleChromeHide();
  };
  const onEnd = () => {
    gesture = null;
  };
  stage.addEventListener("touchstart", onStart, { passive: true });
  stage.addEventListener("touchmove", onMove, { passive: false });
  stage.addEventListener("touchend", onEnd);
  stage.addEventListener("touchcancel", onEnd);
}

export function initReader() {
  initSheets();
  initSlider();
  initSwipe();
}
