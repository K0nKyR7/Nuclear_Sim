/**
 * Высокопроизводительный самописец SCADA / ЭЛТ-осциллограф трендов БЩУ
 * Реалистичная миллиметровая сетка, люминесцентный след каналов и цифровые шкалы.
 */
class TelemetryChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.maxPoints = 200;
    this.history = [];
    this.needsResize = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => { this.needsResize = true; });
      if ('ResizeObserver' in window && this.canvas && this.canvas.parentElement) {
        try {
          new ResizeObserver(() => { this.needsResize = true; }).observe(this.canvas.parentElement);
        } catch (e) {}
      }
    }
    if (typeof ResizeObserver !== 'undefined' && this.canvas && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (!rect || rect.width <= 10 || rect.height <= 10) return;
    this.width = Math.round(rect.width);
    this.height = Math.round(rect.height);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.resetTransform ? this.ctx.resetTransform() : this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  pushPoint(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') return;
    const nth = typeof telemetry.relative_power_pct === 'number' ? telemetry.relative_power_pct : 100.0;
    const nel = typeof telemetry.electric_power_mw === 'number' ? telemetry.electric_power_mw / 10.0 : 100.0;
    const p1 = typeof telemetry.pressure_1k_mpa === 'number' ? (telemetry.pressure_1k_mpa / 20.0) * 100 : 78.5;
    const p2 = typeof telemetry.pressure_2k_mpa === 'number' ? (telemetry.pressure_2k_mpa / 10.0) * 100 : 62.7;
    const rod = typeof telemetry.rod_position_pct === 'number' ? telemetry.rod_position_pct : 85.0;
    const time = typeof telemetry.sim_time_s === 'number' ? telemetry.sim_time_s : 0.0;

    this.history.push({ time, nth, nel, p1, p2, rod });

    if (this.history.length > this.maxPoints) {
      this.history.shift();
    }
  }

  render() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    if (rect && rect.width > 20 && rect.height > 20) {
      const curW = Math.round(rect.width);
      const curH = Math.round(rect.height);
      if (curW !== this.width || curH !== this.height) {
        this.resize();
      }
    } else if (!this.width || !this.height || this.width <= 10 || this.height <= 10) {
      this.resize();
    }
    const w = this.width;
    const h = this.height;
    if (!w || !h || w <= 10 || h <= 10) return;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // 1. Осциллографическая миллиметровая сетка
    ctx.save();
    ctx.strokeStyle = '#141d27';
    ctx.lineWidth = 1;
    const stepMinor = Math.max(12, h / 20);
    for (let y = 0; y <= h; y += stepMinor) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Главные горизонтальные деления сетки
    ctx.strokeStyle = '#223244';
    ctx.lineWidth = 1.5;
    const stepMajorY = Math.max(25, h / 5);
    for (let y = 0; y <= h; y += stepMajorY) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Вертикальные деления сетки времени
    const stepX = Math.max(25, w / 8);
    for (let x = 0; x <= w; x += stepX) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Метки шкалы в стиле осциллографического ЭЛТ люминофора (0..100%)
    ctx.font = 'bold 8.5px Consolas, monospace';
    ctx.fillStyle = '#4b617a';
    ctx.textAlign = 'left';
    for (let p = 0; p <= 100; p += 25) {
      const y = h - (p / 120.0) * h;
      ctx.fillText(`${p}%`, 6, y - 3);
    }
    ctx.restore();

    if (this.history.length < 2) return;

    // Вспомогательная функция отрисовки трека с люминесцентным свечением
    const drawSeries = (key, color, lineWidth = 2) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      const n = this.history.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (this.maxPoints - 1)) * w;
        const val = this.history[i][key];
        const y = h - (val / 120.0) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    // Отрисовка технологических каналов:
    drawSeries('nth', '#38bdf8', 2.5); // Тепловая мощность
    drawSeries('nel', '#3b82f6', 2.0); // Электрическая мощность
    drawSeries('p1', '#ef4444', 1.8);  // Давление 1К
    drawSeries('p2', '#f59e0b', 1.8);  // Давление 2К
    drawSeries('rod', '#10b981', 1.5); // Положение ОР СУЗ
  }
}
