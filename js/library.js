import { db, removeBook, upsertReadingState } from "./db.js";
import { state, subscribe, setSearch, setSort } from "./store.js";
import { importBookFile, isSupportedFile } from "./import.js";
import { formatPercent, escapeHtml } from "./util.js";
import { toast, confirmDialog } from "./toasts.js";
import { openSpotlight } from "./spotlight.js";

const coverUrls = new Map();

export function getCoverUrl(book) {
  if (coverUrls.has(book.id)) return coverUrls.get(book.id);
  const url = URL.createObjectURL(book.cover ?? new Blob());
  coverUrls.set(book.id, url);
  return url;
}

function releaseCoverUrl(id) {
  const url = coverUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    coverUrls.delete(id);
  }
}

function sortBooks(books) {
  const q = state.search.trim().toLowerCase();
  let list = books;
  if (q) {
    list = list.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        (b.author ?? "").toLowerCase().includes(q)
    );
  }
  const s = [...list];
  switch (state.sort) {
    case "title":
      s.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "author":
      s.sort((a, b) => (a.author ?? "").localeCompare(b.author ?? ""));
      break;
    case "progress": {
      const pct = (b) => state.states.get(b.id)?.percentage ?? 0;
      s.sort((a, b) => pct(b) - pct(a));
      break;
    }
    default:
      s.sort((a, b) => b.addedAt - a.addedAt);
  }
  return s;
}

export function renderLibrary() {
  const grid = document.getElementById("book-grid");
  const empty = document.getElementById("empty-state");
  const books = sortBooks(state.books);

  empty.classList.toggle("hidden", books.length > 0 || state.search);
  grid.innerHTML = "";
  if (!books.length) {
    const title = document.getElementById("empty-title");
    const desc = document.getElementById("empty-desc");
    if (state.search) {
      title.textContent = "No matches found";
      desc.textContent = `Nothing matches "${state.search}". Try a different title or author.`;
    } else {
      title.textContent = "Your library is empty";
      desc.textContent = "Import EPUB or PDF books to start reading — they stay on your device, even offline.";
    }
    if (!state.search && state.ready) {
      const hint = document.getElementById("empty-hint-extra");
      if (hint) hint.remove();
    }
    return;
  }

  renderContinueRow();

  const frag = document.createDocumentFragment();
  books.forEach((book, i) => {
    const s = state.states.get(book.id);
    const pct = s?.percentage ?? 0;
    const card = document.createElement("div");
    card.className = "book-card";
    card.style.setProperty("--i", Math.min(i, 14));
    card.tabIndex = 0;
    card.dataset.id = book.id;

    card.innerHTML = `
      <div class="book-cover-wrap">
        <span class="cover-skeleton"></span>
        <img class="book-cover loading" alt="" />
        <span class="cover-shine"></span>
        <span class="cover-gloss"></span>
        <span class="format-badge">${book.format.toUpperCase()}</span>
        ${pct > 0 ? `<span class="progress-pill">${formatPercent(pct)}</span>` : ""}
        <button class="card-menu-btn" aria-label="Book options">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="card-menu hidden">
          <button data-action="open">Open book</button>
          <button data-action="spotlight">3D preview</button>
          <button data-action="finished">Mark finished</button>
          <button data-action="reset">Reset progress</button>
          <button data-action="delete" class="danger">Remove from library</button>
        </div>
      </div>
      <div class="book-meta">
        <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
        ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ""}
        <div class="book-progress"><span style="width:${Math.round(pct * 100)}%"></span></div>
      </div>`;

    const img = card.querySelector(".book-cover");
    img.src = getCoverUrl(book);
    img.onload = () => {
      img.classList.remove("loading");
      card.querySelector(".cover-skeleton")?.remove();
    };
    if (img.complete) img.onload?.();

    // 3D tilt
    const wrap = card.querySelector(".book-cover-wrap");
    card.addEventListener("pointermove", (e) => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      wrap.style.setProperty("--ry", `${x * 16}deg`);
      wrap.style.setProperty("--rx", `${-y * 14}deg`);
    });
    card.addEventListener("pointerleave", () => {
      wrap.style.setProperty("--ry", "0deg");
      wrap.style.setProperty("--rx", "0deg");
    });

    // menu
    const menuBtn = card.querySelector(".card-menu-btn");
    const menu = card.querySelector(".card-menu");
    const closeMenu = (e) => {
      if (menu.classList.contains("hidden")) return;
      if (e.target.closest(".card-menu")) return;
      menu.classList.add("hidden");
      document.removeEventListener("pointerdown", closeMenu);
    };
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
      document.addEventListener("pointerdown", closeMenu);
    });
    menu.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        menu.classList.add("hidden");
        await handleCardAction(book, btn.dataset.action);
      });
    });

    // open
    const open = () => {
      void db.books.update(book.id, { lastOpenedAt: Date.now() });
      void openSpotlight(book, { getCoverUrl });
    };
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-menu, .card-menu-btn")) return;
      open();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });

    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function renderContinueRow() {
  const row = document.getElementById("continue-row");
  const scroll = document.getElementById("continue-scroll");
  const inProgress = state.books
    .map((b) => ({ book: b, pct: state.states.get(b.id)?.percentage ?? 0 }))
    .filter((x) => x.pct > 0 && x.pct < 1)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
  row.classList.toggle("hidden", inProgress.length === 0 || !!state.search.trim());
  scroll.innerHTML = "";
  for (const { book, pct } of inProgress) {
    const el = document.createElement("div");
    el.className = "continue-card";
    el.innerHTML = `
      <div class="continue-cover">
        <img alt="" />
        <span class="progress-pill">${formatPercent(pct)}</span>
      </div>
      <div class="continue-bar"><i style="width:${Math.round(pct * 100)}%"></i></div>
      <div class="continue-name">${escapeHtml(book.title)}</div>`;
    const img = el.querySelector("img");
    img.src = getCoverUrl(book);
    img.onload = () => {
      const p = el.querySelector(".continue-cover");
      const sk = p.querySelector(".cover-skeleton");
      if (sk) sk.remove();
    };
    el.addEventListener("click", async () => {
      const { openReader } = await import("./reader.js");
      openReader(book.id);
    });
    scroll.appendChild(el);
  }
}

async function handleCardAction(book, action) {
  if (action === "open") {
    const { openReader } = await import("./reader.js");
    openReader(book.id);
    return;
  }
  if (action === "spotlight") {
    await openSpotlight(book, { getCoverUrl });
    return;
  }
  if (action === "finished") {
    await upsertReadingState({ bookId: book.id, percentage: 1, cfi: null, page: null });
    state.states.set(book.id, { bookId: book.id, percentage: 1 });
    toast({ title: "Marked as finished", kind: "success" });
    renderLibrary();
    return;
  }
  if (action === "reset") {
    await upsertReadingState({ bookId: book.id, percentage: 0, cfi: null, page: null });
    state.states.set(book.id, { bookId: book.id, percentage: 0 });
    toast({ title: "Progress reset" });
    renderLibrary();
    return;
  }
  if (action === "delete") {
    confirmDialog({
      title: "Remove book?",
      description: `"${book.title}" will be removed from your device. This can't be undone.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        await removeBook(book.id);
        releaseCoverUrl(book.id);
        state.books = state.books.filter((b) => b.id !== book.id);
        state.states.delete(book.id);
        toast({ title: "Book removed" });
        renderLibrary();
      },
    });
  }
}

/* ---------- import flow ---------- */
async function importFiles(files) {
  const list = [...files].filter(isSupportedFile);
  if (!list.length) {
    toast({
      title: "No supported files",
      description: "Please choose .epub or .pdf files.",
      kind: "error",
    });
    return;
  }
  if (state.importing) return;
  state.importing = true;
  const bar = document.getElementById("importing-bar");
  const text = document.getElementById("importing-text");
  bar.classList.remove("hidden");
  text.textContent = `Importing ${list.length} book${list.length > 1 ? "s" : ""}…`;

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < list.length; i++) {
    text.textContent = `Importing ${list[i].name} (${i + 1}/${list.length})…`;
    try {
      const book = await importBookFile(list[i]);
      state.books.push(book);
      ok++;
    } catch (err) {
      fail++;
      console.error("Import failed:", list[i].name, err);
    }
  }
  state.importing = false;
  bar.classList.add("hidden");
  renderLibrary();
  if (fail === 0) {
    toast({
      title: `${ok} book${ok > 1 ? "s" : ""} added to your library`,
      kind: "success",
    });
  } else {
    toast({
      title: `${ok} added, ${fail} failed`,
      description: "Unsupported or corrupted files were skipped.",
      kind: "error",
    });
  }
}

/* ---------- events & init ---------- */
export function initLibrary() {
  subscribe(renderLibrary);

  const fileInput = document.getElementById("file-input");
  const onPick = () => {
    if (fileInput.files?.length) void importFiles(fileInput.files);
    fileInput.value = "";
  };
  fileInput.addEventListener("change", onPick);

  for (const btnId of ["import-btn", "empty-import-btn"]) {
    document.getElementById(btnId).addEventListener("click", () => fileInput.click());
  }

  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  searchInput.addEventListener("input", () => {
    setSearch(searchInput.value);
    searchClear.classList.toggle("hidden", !searchInput.value);
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    setSearch("");
    searchClear.classList.add("hidden");
    searchInput.focus();
  });

  const sortMenuWrap = document.getElementById("sort-menu-wrap");
  const sortBtn = document.getElementById("sort-btn");
  const sortMenu = document.getElementById("sort-menu");
  sortBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !sortMenu.classList.contains("hidden");
    closeMenus();
    if (!open) {
      sortMenu.classList.remove("hidden");
      markSelected(sortMenu, state.sort);
    }
  });
  sortMenu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSort(btn.dataset.sort);
      sortMenu.classList.add("hidden");
    });
  });

  const appMenuWrap = document.getElementById("app-menu-wrap");
  const appMenuBtn = document.getElementById("app-menu-btn");
  const appMenu = document.getElementById("app-menu");
  appMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !appMenu.classList.contains("hidden");
    closeMenus();
    if (!open) {
      appMenu.classList.remove("hidden");
      markSelected(appMenu, state.settings.appTheme);
    }
  });
  appMenu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.body.dataset.theme = btn.dataset.appTheme;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = resolvedTheme() === "dark" ? "#0e1015" : "#4f46e5";
      void import("./store.js").then((m) => m.patchSettings({ appTheme: btn.dataset.appTheme }));
      appMenu.classList.add("hidden");
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!sortMenuWrap.contains(e.target) && !appMenuWrap.contains(e.target)) closeMenus();
  });

  function closeMenus() {
    sortMenu.classList.add("hidden");
    appMenu.classList.add("hidden");
  }
  function markSelected(menu, key) {
    menu.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("selected", b.dataset.sort === key || b.dataset.appTheme === key);
    });
  }

  // drag & drop
  const overlay = document.getElementById("drop-overlay");
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    overlay.classList.remove("hidden");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.add("hidden");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.add("hidden");
    if (e.dataTransfer?.files?.length) void importFiles(e.dataTransfer.files);
  });
}

export function resolvedTheme() {
  const t = document.body.dataset.theme || "system";
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}