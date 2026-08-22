import * as THREE from "./vendor/three.module.min.js";

let scene, camera, renderer;
let bookGroup, coverMaterial, pageMaterial;
let rafId = 0;
let running = false;
let autoRotate = true;
let velocityX = 0;
let targetRotY = 0;
let targetRotX = 0.35;
let dragging = false;
let lastX = 0;
let lastY = 0;
let currentBook = null;
let currentCoverUrl = null;
let onClose = null;

const modal = () => document.getElementById("spotlight-modal");

export function openSpotlight(book, { getCoverUrl } = {}) {
  currentBook = book;
  const title = document.getElementById("spotlight-title");
  const author = document.getElementById("spotlight-author");
  title.textContent = book.title;
  author.textContent = book.author || (book.format === "pdf" ? "PDF document" : "EPUB book");

  modal().classList.remove("hidden");
  document.getElementById("library-view").style.filter = "blur(0)";

  ensureScene();
  buildBook(book, getCoverUrl);
  if (running) return;
  running = true;
  const tick = () => {
    if (!running) return;
    if (autoRotate && !dragging) {
      targetRotY += 0.004;
      velocityX = 0;
    } else if (dragging) {
      autoRotate = false;
      targetRotY += velocityX * 0.006;
      velocityX *= 0.92;
    }
    if (bookGroup) {
      bookGroup.rotation.y += (targetRotY - bookGroup.rotation.y) * 0.08;
      bookGroup.rotation.x += (targetRotX - bookGroup.rotation.x) * 0.08;
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function closeSpotlight() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }
  if (scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    scene = null;
  }
  if (currentCoverUrl) {
    URL.revokeObjectURL(currentCoverUrl);
    currentCoverUrl = null;
  }
  bookGroup = null;
  modal().classList.add("hidden");
  if (onClose) onClose();
  onClose = null;
}

function ensureScene() {
  const wrap = document.getElementById("spotlight-canvas-wrap");
  const canvas = document.getElementById("spotlight-canvas");

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  camera.position.set(0, 0.4, 7);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa78bfa, 0.7);
  rim.position.set(-3, -2, -4);
  scene.add(rim);

  // interactions
  const onPointerDown = (e) => {
    dragging = true;
    autoRotate = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    velocityX = e.clientX - lastX;
    targetRotY += (e.clientX - lastX) * 0.01;
    targetRotX = Math.max(-0.9, Math.min(0.9, targetRotX + (e.clientY - lastY) * 0.008));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = () => {
    dragging = false;
    setTimeout(() => (autoRotate = true), 2500);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  const ro = new ResizeObserver(() => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(wrap);

  onClose = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    ro.disconnect();
  };
}

function buildBook(book, getCoverUrl) {
  if (bookGroup) {
    scene.remove(bookGroup);
    bookGroup = null;
  }

  const geometry = new THREE.BoxGeometry(2.1, 3, 0.42);
  pageMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7f4ea,
    roughness: 0.85,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9d2c0,
    roughness: 0.9,
  });
  coverMaterial = new THREE.MeshStandardMaterial({
    color: 0x6d5bd0,
    roughness: 0.6,
    metalness: 0.15,
  });

  const materials = [
    edgeMaterial, // +x (page edge)
    edgeMaterial, // -x
    pageMaterial, // +y top
    pageMaterial, // -y bottom
    coverMaterial, // +z front
    coverMaterial, // -z back
  ];

  const url = getCoverUrl ? getCoverUrl(book) : null;
  if (url) {
    currentCoverUrl = url;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        coverMaterial.map = tex;
        coverMaterial.needsUpdate = true;
      },
      undefined,
      () => {
        /* keep fallback color */
      }
    );
  }

  bookGroup = new THREE.Mesh(geometry, materials);
  bookGroup.rotation.x = 0.35;
  bookGroup.position.y = 0.05;
  scene.add(bookGroup);
  targetRotY = 0;
}

function initSpotlight() {
  document.getElementById("spotlight-close").addEventListener("click", closeSpotlight);
  document.getElementById("spotlight-open-btn").addEventListener("click", () => {
    const book = currentBook;
    closeSpotlight();
    if (book) void import("./reader.js").then((m) => m.openReader(book.id));
  });
  modal().addEventListener("click", (e) => {
    if (e.target === modal()) closeSpotlight();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal().classList.contains("hidden")) closeSpotlight();
  });
}

initSpotlight();