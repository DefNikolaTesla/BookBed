const Dexie = window.Dexie;

export const db = new Dexie("bookbed");
db.version(1).stores({
  books: "id, title, author, format, addedAt, lastOpenedAt",
  readingStates: "bookId, updatedAt",
  bookmarks: "++id, bookId, cfi, page",
  highlights: "++id, bookId, cfi, color, createdAt",
  settings: "key",
});

export const DEFAULT_SETTINGS = {
  appTheme: "system",
  readerTheme: "paper",
  fontFamily: "serif",
  fontSize: 100,
  lineHeight: 1.7,
  margins: 1,
  justify: true,
  flow: "paginated",
  zoom: 1,
};

export async function loadSettings() {
  try {
    const row = await db.table("settings").get("main");
    if (!row) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...row.value };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const merged = { ...current, ...patch };
  await db.table("settings").put({ key: "main", value: merged });
  return merged;
}

export async function upsertReadingState(state) {
  await db.readingStates.put({
    bookId: state.bookId,
    percentage: state.percentage,
    cfi: state.cfi,
    page: state.page,
    updatedAt: Date.now(),
  });
}

export async function addBookmark(bookId, { cfi, page, label }) {
  return db.bookmarks.add({
    bookId,
    cfi: cfi ?? null,
    page: page ?? null,
    label: label ?? null,
    createdAt: Date.now(),
  });
}

export async function removeBookmark(id) {
  await db.bookmarks.delete(id);
}

export async function addHighlight(bookId, { cfi, color, text }) {
  return db.highlights.add({
    bookId,
    cfi,
    color,
    text,
    createdAt: Date.now(),
  });
}

export async function removeHighlight(id) {
  await db.highlights.delete(id);
}

export async function removeBook(bookId) {
  await db.transaction(
    "rw",
    db.books,
    db.readingStates,
    db.bookmarks,
    db.highlights,
    async () => {
      await db.books.delete(bookId);
      await db.readingStates.where("bookId").equals(bookId).delete();
      await db.bookmarks.where("bookId").equals(bookId).delete();
      await db.highlights.where("bookId").equals(bookId).delete();
    }
  );
}

export async function getReadingState(bookId) {
  return db.readingStates.get(bookId);
}
