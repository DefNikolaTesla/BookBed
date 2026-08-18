import { initStore } from "./store.js";
import { initLibrary, resolvedTheme } from "./library.js";
import { initReader } from "./reader.js";
import { initScene } from "./scene.js";
import { toast } from "./toasts.js";

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

/* ---------- PWA install ---------- */
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let deferredPrompt = null;

function initInstallButton() {
  const btn = document.getElementById("install-btn");
  if (!btn || isStandalone) return;

  const hide = () => btn.classList.add("hidden");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome !== "accepted") hide();
    } else if (isIOS) {
      toast({
        title: "Install BookBed on iPhone",
        description: "Tap Share  then  “Add to Home Screen” — BookBed will open fullscreen like a native app.",
        duration: 6500,
      });
    }
  });

  window.addEventListener("appinstalled", hide);
  if (isIOS) btn.classList.remove("hidden");
}

initInstallButton();
