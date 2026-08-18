import { db, loadSettings, saveSettings } from "./db.js";

const listeners = new Set();

export const state = {
  settings: null,
  books: [],
  states: new Map(),
  search: "",
  sort: "recent",
  importing: false,
  ready: false,
};

function emit() {
  for (const fn of listeners) fn();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initStore() {
  state.settings = await loadSettings();
  const [books, states] = await Promise.all([
    db.books.toArray(),
    db.readingStates.toArray(),
  ]);
  state.books = books;
  state.states = new Map(states.map((s) => [s.bookId, s]));
  state.ready = true;
  emit();
}

export async function patchSettings(patch) {
  state.settings = await saveSettings(patch);
  emit();
}

export function setSearch(search) {
  state.search = search;
  emit();
}

export function setSort(sort) {
  state.sort = sort;
  emit();
}

export function getBook(id) {
  return state.books.find((b) => b.id === id);
}

export function getState(bookId) {
  return state.states.get(bookId);
}