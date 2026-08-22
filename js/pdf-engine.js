const pdfjs = await import("./vendor/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = "./js/vendor/pdf.worker.min.mjs";

export class PdfEngine {
  constructor(file, container, events, zoom = 1) {
    this.file = file;
    this.container = container;
    this.events = events;
    this.zoom = zoom;
    this.disposed = false;
    this.doc = null;
    this.viewport = null;
    this.pageEls = [];
    this.observer = null;
    this.currentPage = 1;
    this.rendered = new Set();
    this.rafId = 0;
    void this.open();
  }

  get numPages() {
    return this.doc?.numPages ?? 0;
  }

  async open() {
    try {
      this.doc = await pdfjs.getDocument({ data: this.file }).promise;
      if (this.disposed) return;
      this.buildPages();
      this.events.onReady();
    } catch (err) {
      this.events.onError(err);
    }
  }

  buildPages() {
    if (this.viewport) {
      this.viewport.remove();
      this.viewport = null;
    }
    this.rendered.clear();
    this.pageEls = [];

    const vp = document.createElement("div");
    vp.className = "pdf-viewport";
    const pages = document.createElement("div");
    pages.className = "pdf-pages";
    vp.appendChild(pages);
    this.container.appendChild(vp);
    this.viewport = vp;

    for (let i = 1; i <= this.doc.numPages; i++) {
      const slot = document.createElement("div");
      slot.className = "pdf-page-slot";
      slot.dataset.page = String(i);
      const canvas = document.createElement("canvas");
      slot.appendChild(canvas);
      const num = document.createElement("span");
      num.className = "pdf-page-num";
      num.textContent = String(i);
      slot.appendChild(num);
      pages.appendChild(slot);
      this.pageEls.push(slot);
    }

    const onScroll = () => this.scheduleCheckScroll();
    vp.addEventListener("scroll", onScroll, { passive: true });
    this.onScroll = onScroll;

    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void this.renderPage(Number(entry.target.dataset.page));
        }
      },
      { root: vp, rootMargin: "1000px 0px" }
    );
    for (const el of this.pageEls) this.observer.observe(el);
  }

  async renderPage(n) {
    if (!this.doc || this.rendered.has(n)) return;
    const el = this.pageEls[n - 1];
    if (!el) return;
    this.rendered.add(n);
    try {
      const page = await this.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = (this.zoom * el.clientWidth) / base.width;
      const viewport = page.getViewport({ scale });
      el.style.width = `${viewport.width}px`;
      const canvas = el.querySelector("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport,
      }).promise;
    } catch {
      this.rendered.delete(n);
    }
  }

  setZoom(zoom) {
    if (zoom === this.zoom) return;
    const page = this.currentPage;
    this.zoom = zoom;
    this.buildPages();
    this.scheduleCheckScroll();
    if (page) this.displayPage(page);
  }

  displayPage(n) {
    const el = this.pageEls[n - 1];
    if (!el || !this.viewport) return;
    this.viewport.scrollTo({
      top: el.offsetTop - this.viewport.offsetTop - 10,
      behavior: "smooth",
    });
  }

  scheduleCheckScroll() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.checkScroll();
    });
  }

  checkScroll() {
    if (!this.viewport) return;
    const vp = this.viewport;
    const center = vp.scrollTop + vp.clientHeight / 2;
    let page = 1;
    for (let i = 0; i < this.pageEls.length; i++) {
      const el = this.pageEls[i];
      if (el.offsetTop <= center) page = i + 1;
      else break;
    }
    if (page !== this.currentPage) {
      this.currentPage = page;
      const total = Math.max(1, this.doc.numPages - 1);
      this.events.onRelocate({
        percentage: (page - 1) / total,
        page,
      });
    }
  }

  destroy() {
    this.disposed = true;
    this.observer?.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    try {
      this.doc?.cleanup();
    } catch {
      /* ignore */
    }
    this.container.innerHTML = "";
  }
}
