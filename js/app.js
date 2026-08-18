import { initStore } from "./store.js";
import { initLibrary, resolvedTheme } from "./library.js";
import { initReader } from "./reader.js";
import { initScene } from "./scene.js";

async function applyTheme() {
  const t = resolvedTheme();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#0e1015" : "#4f46e5";
}

async function boot() {
  await initStore();
  applyTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if ((document.body.dataset.theme || "system") === "system") applyTheme();
    });
  initLibrary();
  initReader();
  const { renderLibrary } = await import("./library.js");
  renderLibrary();
  if (window.WebGLRenderingContext) initScene();
}

void boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("SW registration failed", err);
    });
  });
}