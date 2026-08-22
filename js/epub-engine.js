const FONT_CSS = `
@font-face{font-family:'Lora';font-style:normal;font-weight:400;font-display:swap;src:url(%FONT_LORA_400%) format('woff2')}
@font-face{font-family:'Lora';font-style:normal;font-weight:700;font-display:swap;src:url(%FONT_LORA_700%) format('woff2')}
@font-face{font-family:'Lora';font-style:italic;font-weight:400;font-display:swap;src:url(%FONT_LORA_ITALIC%) format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url(%FONT_INTER_400%) format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:500;font-display:swap;src:url(%FONT_INTER_500%) format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:600;font-display:swap;src:url(%FONT_INTER_600%) format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url(%FONT_INTER_700%) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:swap;src:url(%FONT_MONO_400%) format('woff2')}
`;

export const READER_THEMES = {
  paper: { paper: "#f4efe6", ink: "#3d3428" },
  sepia: { paper: "#f1e3c3", ink: "#4a3a24" },
  night: { paper: "#101014", ink: "#b8b3a7" },
  mint: { paper: "#e2efe9", ink: "#1d3a30" },
};

export const HIGHLIGHT_STYLES = {
  yellow: { fill: "rgba(250, 204, 21, 0.42)", className: "rdr-hl rdr-hl-yellow" },
  green: { fill: "rgba(74, 222, 128, 0.40)", className: "rdr-hl rdr-hl-green" },
  blue: { fill: "rgba(96, 165, 250, 0.42)", className: "rdr-hl rdr-hl-blue" },
  pink: { fill: "rgba(249, 168, 212, 0.42)", className: "rdr-hl rdr-hl-pink" },
  red: { fill: "rgba(248, 113, 113, 0.42)", className: "rdr-hl rdr-hl-red" },
};

const FONT_FILES = [
  ["%FONT_LORA_400%", "fonts/lora-latin-400-normal.woff2"],
  ["%FONT_LORA_700%", "fonts/lora-latin-700-normal.woff2"],
  ["%FONT_LORA_ITALIC%", "fonts/lora-latin-400-italic.woff2"],
  ["%FONT_INTER_400%", "fonts/inter-latin-400-normal.woff2"],
  ["%FONT_INTER_500%", "fonts/inter-latin-500-normal.woff2"],
  ["%FONT_INTER_600%", "fonts/inter-latin-600-normal.woff2"],
  ["%FONT_INTER_700%", "fonts/inter-latin-700-normal.woff2"],
  ["%FONT_MONO_400%", "fonts/jetbrains-mono-latin-400-normal.woff2"],
];

let fontFaceCssPromise = null;
function loadFontFaceCss() {
  if (fontFaceCssPromise) return fontFaceCssPromise;
  fontFaceCssPromise = (async () => {
    let css = FONT_CSS;
    for (const [token, path] of FONT_FILES) {
      const res = await fetch(path);
      const buf = await res.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      css = css.replace(token, `data:font/woff2;base64,${b64}`);
    }
    return css;
  })();
  return fontFaceCssPromise;
}

function flattenToc(items) {
  const out = [];
  for (const item of items) {
    out.push(item);
    out.push(...flattenToc(item.subitems ?? []));
  }
  return out;
}

export class EpubEngine {
  constructor(file, container, settings, events) {
    this.file = file;
    this.container = container;
    this.settings = settings;
    this.events = events;
    this.book = null;
    this.rendition = null;
    this.disposed = false;
    this.resizeObserver = null;
    this.locationsReady = false;
    this.currentLocation = null;
    this.handleMessage = (e) => {
      const data = e.data;
      if (data?.source !== "bookbed") return;
      const contents = this.rendition?.getContents?.() ?? [];
      const list = Array.isArray(contents) ? contents : [contents];
      if (!list.some((c) => c.window === e.source)) return;
      if (data.type === "tap") this.events.onTapped(data.zone);
      else if (data.type === "swipe") this.events.onSwiped(data.direction);
    };
    void this.open();
  }

  async open() {
    try {
      this.book = ePub(this.file);
      await this.book.ready;
      await this.createRendition();
      await this.applySettings(this.settings);
      void this.generateLocations();
      await this.rendition.display();
      this.events.onReady();
    } catch (err) {
      this.events.onError(err);
    }
  }

  async createRendition() {
    if (!this.book) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;

    this.rendition = this.book.renderTo(this.container, {
      width,
      height,
      flow: this.settings.flow,
      spread: "none",
      allowScriptedContent: false,
    });

    const fontsCss = await loadFontFaceCss();
    this.rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      if (!doc.getElementById("rdr-fonts")) {
        const style = doc.createElement("style");
        style.id = "rdr-fonts";
        style.textContent = fontsCss;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      if (!doc.getElementById("rdr-base")) {
        const style = doc.createElement("style");
        style.id = "rdr-base";
        style.textContent =
          "body{max-width:42em;margin:0 auto;overflow-wrap:break-word;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}";
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      try {
        this.injectTapHandler(contents);
      } catch {
        /* not critical */
      }
    });

    this.rendition.on("relocated", (loc) => {
      this.currentLocation = loc;
      this.events.onRelocate({
        percentage: loc.percentage ?? 0,
        cfi: loc.start.cfi,
        href: loc.start.href,
        label: this.getChapterLabel(),
      });
    });

    this.rendition.on("selected", (cfiRange, contents) => {
      try {
        const text = contents.window.getSelection()?.toString() ?? "";
        if (text.trim()) this.events.onSelected(cfiRange, text.trim());
      } catch {
        /* ignore */
      }
    });

    window.removeEventListener("message", this.handleMessage);
    window.addEventListener("message", this.handleMessage);

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w && h) this.rendition?.resize(w, h);
    });
    this.resizeObserver.observe(this.container);
  }

  injectTapHandler(contents) {
    const win = contents.window;
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let moved = false;
    let startX = 0;
    let startY = 0;

    const onDown = (e) => {
      const t = e.touches?.[0] ?? e;
      downX = t.clientX;
      downY = t.clientY;
      startX = t.clientX;
      startY = t.clientY;
      downT = performance.now();
      moved = false;
    };
    const onMove = (e) => {
      const t = e.touches?.[0] ?? e;
      if (Math.abs(t.clientX - downX) > 14 || Math.abs(t.clientY - downY) > 14)
        moved = true;
    };
    const onUp = (e) => {
      const t = e.changedTouches?.[0] ?? e;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const isSwipe = Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.2;

      if (isSwipe) {
        try {
          win.parent?.postMessage({ source: "bookbed", type: "swipe", direction: dx < 0 ? "left" : "right" }, "*");
        } catch {
          /* ignore */
        }
        return;
      }

      if (moved) return;
      if (performance.now() - downT > 420) return;
      const sel = win.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = e.target;
      if (target?.closest?.("a, button, input, select, textarea, [contenteditable]")) return;
      const w = win.innerWidth;
      const zone =
        t.clientX < w * 0.18 ? "left" : t.clientX > w * 0.82 ? "right" : "center";
      try {
        win.parent?.postMessage({ source: "bookbed", type: "tap", zone }, "*");
      } catch {
        /* ignore */
      }
    };

    win.document.addEventListener("touchstart", onDown, { passive: true });
    win.document.addEventListener("touchmove", onMove, { passive: false });
    win.document.addEventListener("touchend", onUp, { passive: true });
    win.document.addEventListener("touchcancel", () => {
      moved = true;
    });
    // Also support pointer events for non-touch devices
    win.document.addEventListener("pointerdown", onDown);
    win.document.addEventListener("pointermove", onMove);
    win.document.addEventListener("pointerup", onUp);
    win.document.addEventListener("pointercancel", () => {
      moved = true;
    });
  }

  async applySettings(settings) {
    this.settings = settings;
    if (!this.rendition) return;
    try {
      const themes = this.rendition.themes;
      for (const [name, palette] of Object.entries(READER_THEMES)) {
        try {
          themes.registerCss(name, `body{background:${palette.paper};color:${palette.ink}}`);
        } catch {
          /* already registered */
        }
      }
      themes.select(settings.readerTheme ?? "paper");
      themes.fontSize(`${settings.fontSize ?? 100}%`);

      const familyCss = {
        serif: "body { font-family: 'Lora', Georgia, 'Times New Roman', serif !important; }",
        sans: "body { font-family: 'Inter', system-ui, -apple-system, sans-serif !important; }",
        mono: "body { font-family: 'JetBrains Mono', ui-monospace, monospace !important; }",
      };
      const familyKey = `bookbed-${settings.fontFamily ?? "serif"}`;
      try {
        themes.registerCss(familyKey, familyCss[settings.fontFamily ?? "serif"]);
      } catch {
        /* ignore */
      }
      themes.select(familyKey);

      const marginEm = [0, 0.9, 1.8][settings.margins ?? 1] ?? 0.9;
      const lhCss = `body{line-height:${settings.lineHeight ?? 1.7};margin-left:${marginEm}em;margin-right:${marginEm}em;text-align:${
        settings.justify === false ? "left" : "justify"
      }}`;
      try {
        themes.registerCss("bookbed-typography", lhCss);
        themes.select("bookbed-typography");
      } catch {
        /* ignore */
      }

      // Pagination CSS for epub.js - required for paginated flow to work
      const paginationCss = settings.flow === "paginated" ? `
        html { overflow: hidden; }
        body { 
          columns: 1; 
          column-width: 100%; 
          column-gap: 0; 
          height: 100vh; 
          max-height: 100vh; 
          overflow: hidden; 
          box-sizing: border-box;
        }
      ` : `
        html { overflow: auto; }
        body { 
          columns: auto; 
          height: auto; 
          max-height: none; 
          overflow: visible; 
        }
      `;
      try {
        themes.registerCss("bookbed-pagination", paginationCss);
        themes.select("bookbed-pagination");
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  async setFlow(flow) {
    if (!this.book) return;
    const currentCfi = this.currentLocation?.start?.cfi;
    this.rendition?.destroy();
    this.rendition = null;
    this.settings.flow = flow;
    await this.createRendition();
    await this.applySettings(this.settings);
    await this.rendition.display(currentCfi);
  }

  async generateLocations() {
    try {
      if (this.disposed || !this.book) return;
      await this.book.locations.generate(1500);
      this.locationsReady = this.book.locations.isGenerated();
    } catch {
      this.locationsReady = false;
    }
  }

  isLocationsReady() {
    return this.locationsReady;
  }

  locationsCount() {
    return this.book?.locations?.length() ?? 0;
  }

  cfiFromPercentage(p) {
    try {
      if (!this.locationsReady) return null;
      return this.book.locations.cfiFromPercentage(clampPct(p));
    } catch {
      return null;
    }
  }

  percentageFromCfi(cfi) {
    try {
      if (!cfi) return null;
      const p = this.book.locations.percentageFromCfi(cfi);
      if (Number.isFinite(p)) return p;
    } catch {
      /* ignore */
    }
    return null;
  }

  getToc() {
    const mapItem = (item) => ({
      label: item.label,
      href: item.href,
      cfi: this.cfiFromHref(item.href) ?? "",
      children: item.subitems?.map(mapItem) ?? [],
    });
    return (this.book?.navigation?.toc ?? []).map(mapItem);
  }

  getChapterLabel() {
    const href = this.currentLocation?.start?.href;
    if (!href) return "";
    const flat = flattenToc(this.book?.navigation?.toc ?? []);
    return flat.find((n) => n.href === href)?.label ?? "";
  }

  cfiFromHref(href) {
    if (!this.book || !href) return null;
    try {
      if (typeof this.book.locations.cfiFromHref === "function") {
        const cfi = this.book.locations.cfiFromHref(href);
        if (cfi) return cfi;
      }
    } catch {
      /* fall through */
    }
    try {
      const item = this.book.spine?.items?.find((i) => i.href === href);
      if (item?.cfiBase) return item.cfiBase;
    } catch {
      /* ignore */
    }
    return null;
  }

  async next() {
    try {
      await this.rendition?.next();
    } catch {
      /* ignore */
    }
  }

  async prev() {
    try {
      await this.rendition?.prev();
    } catch {
      /* ignore */
    }
  }

  async display(cfi) {
    try {
      await this.rendition?.display(cfi);
    } catch {
      /* ignore */
    }
  }

  addHighlight(cfi, color) {
    if (!this.rendition) return;
    const s = HIGHLIGHT_STYLES[color] ?? HIGHLIGHT_STYLES.yellow;
    try {
      this.rendition.annotations.highlight(
        cfi,
        { source: "bookbed" },
        () => {},
        s.className,
        { fill: s.fill }
      );
    } catch {
      /* ignore */
    }
  }

  removeHighlight(cfi) {
    try {
      this.rendition?.annotations.remove(cfi);
    } catch {
      /* ignore */
    }
  }

  applyAllHighlights(highlights) {
    for (const h of highlights) this.addHighlight(h.cfi, h.color);
  }

  clearSelection() {
    try {
      const contents = this.rendition?.getContents?.() ?? [];
      const list = Array.isArray(contents) ? contents : [contents];
      for (const c of list) {
        const sel = c.window?.getSelection?.();
        if (sel) sel.removeAllRanges();
      }
    } catch {
      /* ignore */
    }
  }

  destroy() {
    this.disposed = true;
    window.removeEventListener("message", this.handleMessage);
    this.resizeObserver?.disconnect();
    try {
      this.rendition?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.book?.destroy();
    } catch {
      /* ignore */
    }
    this.container.innerHTML = "";
  }
}

function clampPct(p) {
  return Math.min(1, Math.max(0, p));
}