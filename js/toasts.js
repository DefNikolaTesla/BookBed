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
  const modal = document.getElementById("confirm-modal");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-desc").textContent = description ?? "";
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");
  okBtn.textContent = confirmLabel;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    document.getElementById("confirm-backdrop").onclick = null;
    document.removeEventListener("keydown", onKey);
  };
  cancelBtn.onclick = close;
  document.getElementById("confirm-backdrop").onclick = close;
  document.addEventListener("keydown", onKey);
  okBtn.onclick = () => {
    close();
    onConfirm();
  };
  okBtn.focus();
}