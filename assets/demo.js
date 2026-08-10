/**
 * Demo landscape generator + thin helpers (engine owns live rendering).
 */
const LuminaDemo = (() => {
  function createLandscape() {
    const off = document.createElement("canvas");
    off.width = 1600;
    off.height = 1000;
    const g = off.getContext("2d");

    const sky = g.createLinearGradient(0, 0, 0, 520);
    sky.addColorStop(0, "#6a9ec4");
    sky.addColorStop(0.45, "#b8c9d4");
    sky.addColorStop(1, "#e8d5b5");
    g.fillStyle = sky;
    g.fillRect(0, 0, 1600, 520);

    const blow = g.createRadialGradient(980, 180, 20, 980, 180, 320);
    blow.addColorStop(0, "rgba(255,255,255,0.98)");
    blow.addColorStop(0.35, "rgba(255,248,230,0.85)");
    blow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = blow;
    g.fillRect(600, 0, 900, 400);

    cloud(g, 220, 140, 180, 0.35);
    cloud(g, 520, 90, 240, 0.25);
    cloud(g, 1100, 160, 200, 0.3);

    mountain(g, [0, 520, 280, 300, 520, 480, 720, 260, 980, 500, 1200, 310, 1600, 520], "#3d5248");
    mountain(g, [0, 560, 200, 400, 480, 540, 760, 360, 1100, 520, 1400, 390, 1600, 560], "#2f4038");

    const ground = g.createLinearGradient(0, 560, 0, 1000);
    ground.addColorStop(0, "#5a6b45");
    ground.addColorStop(1, "#2c3424");
    g.fillStyle = ground;
    g.fillRect(0, 560, 1600, 440);

    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 1600;
      const y = 620 + Math.random() * 340;
      g.fillStyle = `rgba(20,30,18,${0.15 + Math.random() * 0.35})`;
      g.fillRect(x, y, 2 + Math.random() * 4, 10 + Math.random() * 40);
    }
    return off;
  }

  function cloud(g, x, y, r, a) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.arc(x, y, r * 0.45, 0, Math.PI * 2);
    g.arc(x + r * 0.4, y - r * 0.1, r * 0.35, 0, Math.PI * 2);
    g.arc(x - r * 0.35, y + r * 0.05, r * 0.3, 0, Math.PI * 2);
    g.fill();
  }

  function mountain(g, pts, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fill();
  }

  return { createLandscape };
})();
