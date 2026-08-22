import { db } from "./db.js";
import { uid, gradientFor, initialsFor, escapeHtml } from "./util.js";

export function isSupportedFile(file) {
  const idx = file.name.lastIndexOf(".");
  const ext = idx === -1 ? "" : file.name.slice(idx + 1).toLowerCase();
  if (ext === "epub" || ext === "pdf") return true;
  if (file.type === "application/epub+zip") return true;
  if (file.type === "application/pdf") return true;
  return false;
}

function titleFromFilename(name) {
  const idx = name.lastIndexOf(".");
  const base = idx === -1 ? name : name.slice(0, idx);
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || name;
}

export function makePlaceholderCover(title, author, format) {
  const gradient = gradientFor(title + (author ?? ""));
  const initials = initialsFor(title, author);
  const label = format === "pdf" ? "PDF" : "EPUB";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${gradient.split("(")[1].split(",")[0].trim()}"/>
      <stop offset="1" stop-color="${gradient.split(",").pop().replace(")", "").trim()}"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#g)"/>
  <rect x="18" y="18" width="264" height="414" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2" rx="8"/>
  <text x="150" y="215" text-anchor="middle" font-family="Georgia, serif" font-size="78" fill="rgba(255,255,255,0.95)" font-weight="bold">${escapeHtml(initials)}</text>
  <text x="150" y="396" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="rgba(255,255,255,0.9)" letter-spacing="6">${label}</text>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

async function parseEpubMetadata(arrayBuffer) {
  const book = ePub(arrayBuffer);
  await book.ready;
  const meta = book.packaging?.metadata ?? {};
  let cover = null;
  try {
    const url = book.coverUrl?.();
    if (url) {
      const res = await fetch(url);
      if (res.ok) cover = await res.blob();
    }
  } catch {
    /* no cover */
  }
  try {
    book.destroy();
  } catch {
    /* ignore */
  }
  return {
    title: meta.title || titleFromFilename("untitled"),
    author: meta.creator || "",
    cover,
  };
}

async function parsePdfMetadata(arrayBuffer) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let title = "";
  let author = "";
  let cover = null;
  try {
    const meta = await doc.getMetadata();
    title = meta.info?.Title || "";
    author = meta.info?.Author || "";
  } catch {
    /* ignore */
  }
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, 320 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob && blob.size > 200) cover = blob;
  } catch {
    /* ignore */
  }
  try {
    doc.cleanup();
  } catch {
    /* ignore */
  }
  return { title: title || "Untitled PDF", author, cover };
}

export async function importBookFile(file) {
  const idx = file.name.lastIndexOf(".");
  const ext = idx === -1 ? "" : file.name.slice(idx + 1).toLowerCase();
  const format =
    ext === "pdf" || file.type === "application/pdf" ? "pdf" : "epub";

  const arrayBuffer = await file.arrayBuffer();
  const meta =
    format === "epub"
      ? await parseEpubMetadata(arrayBuffer)
      : await parsePdfMetadata(arrayBuffer);

  const title = meta.title || titleFromFilename(file.name);
  const id = uid();
  const cover =
    meta.cover ??
    makePlaceholderCover(title, meta.author || file.name, format);

  const book = {
    id,
    title,
    author: meta.author,
    format,
    cover,
    file: arrayBuffer,
    addedAt: Date.now(),
    lastOpenedAt: 0,
  };
  await db.books.put(book);
  return book;
}
