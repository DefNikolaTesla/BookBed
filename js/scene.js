import * as THREE from "./vendor/three.module.min.js";

let scene, camera, renderer;
let books = [];
let rafId = 0;
let running = false;
let pointerX = 0;
let pointerY = 0;

const BOOK_COLORS = [0x6366f1, 0xa855f7, 0x0ea5e9, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x06b6d4];

function isDark() {
  const t = document.body.dataset.theme || "system";
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function initScene() {
  const canvas = document.getElementById("scene");
  if (!canvas || !window.WebGLRenderingContext) return;

  scene = new THREE.Scene();
  const fov = 60;
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position.set(0, 0, 10);

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: window.innerWidth > 768,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const count = window.innerWidth < 640 ? 26 : 46;
  const geo = new THREE.BoxGeometry(0.34, 0.46, 0.12);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: BOOK_COLORS[i % BOOK_COLORS.length],
      transparent: true,
      opacity: 0.06 + Math.random() * 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 14,
      -2 - Math.random() * 6
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    mesh.userData = {
      speed: 0.1 + Math.random() * 0.35,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.2 + Math.random() * 0.4,
      spin: (Math.random() - 0.5) * 0.004,
    };
    scene.add(mesh);
    books.push(mesh);
  }

  window.addEventListener("pointermove", (e) => {
    pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
    pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  window.addEventListener("resize", onResize);
  run();
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function run() {
  if (running) return;
  running = true;
  const tick = () => {
    if (!running) return;
    const t = performance.now() / 1000;
    for (const b of books) {
      const u = b.userData;
      b.position.y += Math.sin(t * u.swaySpeed + u.sway) * 0.002 + u.speed * 0.004;
      b.rotation.x += u.spin * 0.3;
      b.rotation.y += u.spin;
      if (b.position.y > 8.5) {
        b.position.y = -8.5;
        b.position.x = (Math.random() - 0.5) * 22;
      }
    }
    camera.position.x += (pointerX * 0.6 - camera.position.x) * 0.03;
    camera.position.y += (-pointerY * 0.4 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, -3);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function stopScene() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

export function pauseScene() {
  stopScene();
}

export function resumeScene() {
  if (books.length) run();
}