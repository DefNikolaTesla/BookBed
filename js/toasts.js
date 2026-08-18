export function toast({ title, description, kind = "info", duration = 3200 }) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="toast-title">${title}</div>${
    description ? `<div class="toast-desc">${description}</div>` : ""
  }`;
  host.appendChild(el);
  const remove = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  };
  el.addEventListener("click", remove);
  setTimeout(remove, duration);
  return el;
}

export function confirmDialog({ title, description, confirmLabel = "Delete", onConfirm }) {
  const host = document.getElementById("sheet");
  const backdrop = document.getElementById("sheet-backdrop");
  host.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">${title}</div>
    <p style="color:var(--ink-soft);font-size:14px;line-height:1.55;margin-bottom:22px">${description}</p>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" id="cf-cancel">Cancel</button>
      <button class="btn btn-primary" style="flex:1;background:#e5484d;box-shadow:none" id="cf-ok">${confirmLabel}</button>
    </div>`;
  host.classList.remove("hidden");
  backdrop.classList.remove("hidden");
  const close = () => {
    host.classList.add("hidden");
    backdrop.classList.add("hidden");
    document.body.classList.remove("reader-sheet-open");
  };
  host.querySelector("#cf-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", close, { once: true });
  host.querySelector("#cf-ok").addEventListener("click", () => {
    close();
    onConfirm();
  });
}
