/**
 * Высокоточная интерактивная технологическая мнемосхема энергоблока ВВЭР-1000
 * Аутентичный технический разрез реактора ВВЭР-1000 (В-320) ГОСТ 2.053:
 * - Корпус высокого давления из кованой стали 15Х2НМФА (190 мм) с нержавеющей антикоррозионной наплавкой (8 мм)
 * - Сферическое днище с перфорированным эллиптическим днищем шахты (распределитель потока)
 * - Съемный верхний блок (крышка) с 54 массивными шпильками М140 и лесом приводов ШЭМ-3
 * - Шахта реактора и опускной кольцевой коридор (downcomer) с анимированной циркуляцией
 * - Выгородка активной зоны (нейтронный тепловой экран)
 * - 163 гексагональные ТВС с дистанционирующими решетками, твэлами и осевым градиентом температур (290°C -> 320°C)
 * - Черенковское лазурное свечение и тепловое свечение активной зоны, затухающее в вишневое при АЗ-5
 * - Жесткие кластеры поглощающих стержней СУЗ (ПС СУЗ), физически перемещающиеся по высоте активной зоны
 * - Изолированные трубопроводы ДУ-850 с бандажами, отводами и правильной трассировкой
 * - Компенсатор давления КД-1000 с ТЭНами, уровнем и форсункой впрыска
 * - Горизонтальный парогенератор ПГВ-1000М с вертикальными коллекторами 1К, горизонтальным трубным пучком,
 *   кипением, погруженным дырчатым листом (ПДЛ) и жалюзийными сепараторами
 * - Анимированные частицы циркуляции 1К, свежего пара и питательной воды (с насосом ПЭН)
 * - Турбоустановка К-1000-60/1500 (ЦВД, СПП, ЦНД) и генератор ТВВ-1000 в бирюзовой советской эмали
 * - Прецизионно выровненный насос ГЦН-195М с точным хитбоксом кликов
 */

// Полифилл для Canvas roundRect
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
    if (!radii) radii = 0;
    if (typeof radii === 'number') radii = [radii, radii, radii, radii];
    this.rect(x, y, w, h);
    return this;
  };
}

class PlantMimic {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.particles = [];
    this.steamBubbles = [];
    this.initParticles();
    this.state = null;
    this.animTime = 0;
    this.crtMode = 'color';
    this.viewMode = 'schematic';
    this.selectedAssemblyId = 82;
    this.hoveredAssemblyId = null;
    this.renderedAssemblies = [];
    this.renderedRcps = [];
    this.coreAssemblies = this.generateCoreAssemblies();

    window.addEventListener('resize', () => this.resize());
    if (typeof ResizeObserver !== 'undefined' && this.canvas && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    this.resize();

    // Интерактивные клики и наведение на оборудование
    if (this.canvas) {
      this.canvas.addEventListener('click', (e) => this.handleClick(e));
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }
  }

  generateCoreAssemblies() {
    const assemblies = [];
    const rawPoints = [];
    for (let r = -7; r <= 7; r++) {
      for (let q = -7; q <= 7; q++) {
        const d2 = q * q + q * r + r * r;
        if (d2 <= 43) {
          rawPoints.push({ q, r, d2 });
        }
      }
    }
    // Сортировка по строкам r, затем по колонкам q
    rawPoints.sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      return a.q - b.q;
    });

    rawPoints.forEach((pt, idx) => {
      const id = idx + 1;
      const rNorm = Math.sqrt(pt.d2 / 43.0);

      // Определение принадлежности к СУЗ (61 кластер СУЗ ВВЭР-1000)
      let suzGroup = 0;
      if (pt.d2 === 0 || pt.d2 === 7) suzGroup = 10; // Рабочая группа 10 (центр + кольцо 7)
      else if (pt.d2 === 13) suzGroup = 9;
      else if (pt.d2 === 19) suzGroup = 8;
      else if (pt.d2 === 21) suzGroup = 7;
      else if (pt.d2 === 28) suzGroup = 6;
      else if (pt.d2 === 31) suzGroup = 5;
      else if (pt.d2 === 3) suzGroup = 4;
      else if (pt.d2 === 12) suzGroup = 3;
      else if (pt.d2 === 37) suzGroup = 2;
      else if (pt.d2 === 39) suzGroup = 1;

      // Обогащение топлива ТВС-2М: 4.4%, 4.0%, 3.6%
      let enrichment = 4.4;
      if (rNorm > 0.72) enrichment = 4.0;
      if (rNorm > 0.88) enrichment = 3.6;

      // Среднее выгорание топлива в МВт·сут/кгU
      const burnup = 18.0 + (1.0 - rNorm) * 22.0 + ((id * 11) % 9) * 0.7;

      assemblies.push({
        id,
        q: pt.q,
        r: pt.r,
        d2: pt.d2,
        rNorm,
        suzGroup,
        enrichment,
        burnup: Math.round(burnup * 10) / 10
      });
    });

    return assemblies;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const w = (rect && rect.width > 20) ? rect.width : (this.canvas.clientWidth || 800);
    const h = (rect && rect.height > 20) ? rect.height : (this.canvas.clientHeight || 500);
    this.width = Math.round(w);
    this.height = Math.round(h);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.resetTransform ? this.ctx.resetTransform() : this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  initParticles() {
    // 1. Частицы горячей и холодной нитей 1-го контура (ДУ-850)
    for (let i = 0; i < 70; i++) {
      this.particles.push({
        t: Math.random(),
        loop: 'primary',
        speed: 0.18 + Math.random() * 0.08
      });
    }

    // 2. Частицы опускного движения в опускном кольцевом зазоре шахты реактора (downcomer)
    for (let i = 0; i < 30; i++) {
      this.particles.push({
        t: Math.random(),
        loop: 'downcomer',
        speed: 0.20 + Math.random() * 0.06
      });
    }

    // 3. Частицы восходящего движения через активную зону (ТВС)
    for (let i = 0; i < 35; i++) {
      this.particles.push({
        t: Math.random(),
        loop: 'core_flow',
        speed: 0.22 + Math.random() * 0.08
      });
    }

    // 4. Частицы свежего пара (ПГВ-1000М -> ЦВД)
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        t: Math.random(),
        loop: 'steam',
        speed: 0.35 + Math.random() * 0.15
      });
    }

    // 5. Частицы питательной воды (Конденсатор -> ПЭН -> ПГВ-1000М)
    for (let i = 0; i < 35; i++) {
      this.particles.push({
        t: Math.random(),
        loop: 'feedwater',
        speed: 0.22 + Math.random() * 0.08
      });
    }

    // 6. Пузырьки пузырькового кипения в межтрубном пространстве парогенератора
    for (let i = 0; i < 45; i++) {
      this.steamBubbles.push({
        x: Math.random(),
        y: Math.random(),
        r: 1.2 + Math.random() * 2.4,
        speed: 0.35 + Math.random() * 0.65
      });
    }
  }

  updateState(state) {
    this.state = state;
  }

  render(timestamp) {
    if (!this.canvas || !this.ctx) return;
    this.animTime = (timestamp || 0) * 0.001;
    const ctx = this.ctx;

    // Автоматическая подстройка размера под контейнер при изменении геометрии
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

    const w = this.width || 800;
    const h = this.height || 500;
    if (w <= 10 || h <= 10) return;

    // Сброс контекста к начальному состоянию для защиты от утечек матриц трансформации
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // 0. Инженерная координатная сетка мнемощита
    this.drawBackgroundGrid(w, h);

    // Номинальные параметры энергоблока при ожидании первого пакета телеметрии
    const defaultState = {
      state: 'POWER_OPERATION',
      relative_power_pct: 100.0,
      thermal_power_mw: 3000.0,
      electric_power_mw: 1000.0,
      residual_heat_mw: 0.0,
      reactivity_pcm: 0.0,
      period_s: 999.0,
      pressure_1k_mpa: 15.7,
      t_hot_c: 320.0,
      t_cold_c: 290.0,
      t_fuel_c: 650.0,
      flow_1k_kg_s: 18800.0,
      pz_level_m: 7.5,
      pz_heaters_kw: 800.0,
      pz_spray_active: false,
      pressure_2k_mpa: 6.27,
      sg_level_m: 2.45,
      steam_flow_kg_s: 1480.0,
      feedwater_flow_kg_s: 1480.0,
      turbine_rpm: 1500.0,
      condenser_vacuum_kpa: 96.0,
      rod_position_pct: 85.0,
      rcp_active_count: 4,
      feedwater_pumps_on: [true, true, false],
      t_sat_1k_c: 346.8,
      subcooling_margin_c: 26.8,
      boron_ppm: 550.0,
      saoz_active: false,
      saoz_flow_kg_s: 0.0,
      saoz_accum_pressure_mpa: 6.0,
      saoz_accum_level_pct: 100.0,
      bru_k_pct: 0.0,
      bru_a_pct: 0.0
    };

    // Полное слияние телеметрии с дефолтными значениями для гарантии числовых типов
    const s = Object.assign({}, defaultState);
    if (this.state && typeof this.state === 'object') {
      for (const [k, v] of Object.entries(this.state)) {
        if (v !== null && v !== undefined && !(typeof v === 'number' && isNaN(v))) {
          s[k] = v;
        }
      }
    }

    if (!this.state) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('СИСТЕМА СБОРА ДАННЫХ «ТЕМП» • ОЖИДАНИЕ ТЕЛЕМЕТРИИ БЩУ (ДЕМО-РЕЖИМ)', w - 16, 20);
      ctx.restore();
    }

    try {
      if (this.viewMode === 'core') {
        this.drawCoreCrossSection(w, h, s);
      } else {
        // Опорные координаты агрегатов технологической схемы
        const rx = w * 0.18;    // Реактор ВВЭР-1000
        const ry = h * 0.50;
        const rw = Math.max(140, Math.min(220, w * 0.15));
        const rh = Math.max(300, Math.min(480, h * 0.68));

        const pzx = w * 0.37;   // Компенсатор давления КД-1000
        const pzy = h * 0.26;
        const pzw = 56;
        const pzh = 130;

        const hotY = ry - rh * 0.16;
        const coldY = ry + rh * 0.16;

        const sgx = w * 0.56;   // Горизонтальный парогенератор ПГВ-1000М
        const sgy = ry;         // Соосно с контуром реактора
        const sgw = Math.max(160, Math.min(230, w * 0.18));
        const sgh = Math.max(160, Math.min(220, (coldY - hotY) + 56));

        const turbx = w * 0.81; // Турбоустановка К-1000-60/1500 + ТВВ-1000
        const turby = h * 0.32;

        const condx = w * 0.81; // Конденсатор
        const condy = h * 0.72;

        // 1. Трубопроводы 1-го контура (ДУ-850) с бандажированной изоляцией и линиями КД
        this.drawPrimaryLoopPiping(rx, ry, rw, rh, sgx, sgy, sgw, sgh, pzx, pzy, s);

        // 2. Детальный технический разрез корпуса реактора ВВЭР-1000
        this.drawRealisticReactor(rx, ry, rw, rh, s);

        // 3. Компенсатор давления КД-1000
        this.drawRealisticPressurizer(pzx, pzy, pzw, pzh, s);

        // 4. Горизонтальный парогенератор ПГВ-1000М
        this.drawRealisticSteamGenerator(sgx, sgy, sgw, sgh, rx, ry, rw, rh, s);

        // 5. Трубопроводы 2-го контура (Свежий пар и питательная вода с анимацией частиц)
        this.drawSecondaryPiping(sgx, sgy, sgw, sgh, turbx, turby, condx, condy, s);

        // 6. Турбогенераторная установка (ЦВД, СПП, ЦНД, ТВВ-1000)
        this.drawRealisticTurbineAndGenerator(turbx, turby, s);

        // 7. Конденсатор турбины
        this.drawRealisticCondenser(condx, condy, s);

        // 8. Насосное оборудование: ГЦН-195М (строго по оси coldY) и ПЭН
        this.drawRealisticPumps(rx, ry, rw, rh, sgx, sgy, sgw, condx, condy, s);

        // 9. Архитектура 4-х петель, САОЗ ГЕ-1..4 и арматура ГОСТ (БРУ-К, БРУ-А)
        this.drawFourLoopsAndSaoz(rx, ry, rw, rh, sgx, sgy, sgw, sgh, pzx, pzy, condx, condy, turbx, turby, s);
      }

      // 10. Наложение CRT растровых строк в режиме люминофора P31
      if (this.crtMode === 'p31') {
        this.drawCrtScanlines(w, h);
      }
    } catch (err) {
      console.error('[PlantMimic] Ошибка отрисовки мнемосхемы:', err);
    } finally {
      ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
  }

  drawBackgroundGrid(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#10161f';
    ctx.lineWidth = 1;
    const step = 36;

    ctx.beginPath();
    for (let x = 0; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Главные маркеры координат мнемосхемы
    ctx.strokeStyle = '#182230';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < w; x += step * 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step * 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Трубопроводы 1-го контура (ДУ-850) с аутентичной теплоизоляцией, стальными бандажами,
   * дыхательной линией КД (ДУ-350) и линией впрыска (ДУ-100).
   */
  drawPrimaryLoopPiping(rx, ry, rw, rh, sgx, sgy, sgw, sgh, pzx, pzy, s) {
    const ctx = this.ctx;
    const flowRel = Math.max(0.02, s.flow_1k_kg_s / 18800.0);

    const hotY = ry - rh * 0.16;
    const coldY = ry + rh * 0.16;

    const hotStartX = rx + rw * 0.5 - 4;
    const sgHotX = sgx - sgw * 0.25;

    const sgColdX = sgx + sgw * 0.25;
    const coldEndX = rx + rw * 0.5 - 4;
    const gcnX = (rx + rw * 0.5 + sgHotX) / 2 + 25;

    ctx.save();

    // 1. Горячая нить (ДУ-850) — Реактор -> Горячий коллектор ПГ
    // Внешняя изоляция с кожухом
    ctx.strokeStyle = '#2b3644';
    ctx.lineWidth = 22;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(hotStartX, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    // Алюминиевая защитная окожушка
    const hotInsGrad = ctx.createLinearGradient(0, hotY - 10, 0, hotY + 10);
    hotInsGrad.addColorStop(0, '#64748b');
    hotInsGrad.addColorStop(0.5, '#94a3b8');
    hotInsGrad.addColorStop(1, '#334155');
    ctx.strokeStyle = hotInsGrad;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(hotStartX, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    // Внутренний поток горячего теплоносителя (красный / перегретый багровый при отказе ГЦН)
    const isHeatBuildup = (s.rcp_active_count < 4) || (s.active_scenarios && s.active_scenarios.rcp1_trip) || (s.t_hot_c > 323);
    const hotCoreGrad = ctx.createLinearGradient(0, hotY - 6, 0, hotY + 6);
    if (isHeatBuildup) {
      const heatPulse = Math.sin(this.animTime * 3.5) * 0.12 + 0.88;
      hotCoreGrad.addColorStop(0, '#e11d48');
      hotCoreGrad.addColorStop(0.3, '#ff2222');
      hotCoreGrad.addColorStop(0.5, `rgba(255, 120, 120, ${heatPulse})`);
      hotCoreGrad.addColorStop(0.7, '#ff2222');
      hotCoreGrad.addColorStop(1, '#9f1239');
    } else {
      hotCoreGrad.addColorStop(0, '#b91c1c');
      hotCoreGrad.addColorStop(0.5, '#ef4444');
      hotCoreGrad.addColorStop(1, '#991b1b');
    }
    ctx.strokeStyle = hotCoreGrad;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(hotStartX, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    if (isHeatBuildup) {
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.lineWidth = 24;
      ctx.beginPath();
      ctx.moveTo(hotStartX, hotY);
      ctx.lineTo(sgHotX, hotY);
      ctx.stroke();
      ctx.restore();
    }

    // Бандажные кольца и стяжки на горячей нити
    ctx.fillStyle = '#cbd5e1';
    for (let bx = hotStartX + 18; bx < sgHotX - 10; bx += 26) {
      ctx.fillRect(bx, hotY - 11, 3, 22);
    }

    // 2. Дыхательная линия КД (ДУ-350) от горячей нити к низу КД
    const surgeX = pzx - 4;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(surgeX, hotY);
    ctx.lineTo(surgeX, pzy + 65);
    ctx.stroke();

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(surgeX, hotY);
    ctx.lineTo(surgeX, pzy + 65);
    ctx.stroke();

    // Бандажи на дыхательной линии
    ctx.fillStyle = '#cbd5e1';
    for (let sy = pzy + 75; sy < hotY - 10; sy += 18) {
      ctx.fillRect(surgeX - 5, sy, 10, 2.5);
    }

    // 3. Линия впрыска КД (ДУ-100) — от холодной нити прямо под КД в верхний паровой объем
    if (s.pz_spray_active) {
      const sprayX = pzx + 14;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sprayX, coldY);
      ctx.lineTo(sprayX, pzy - 52);
      ctx.lineTo(pzx + 8, pzy - 52);
      ctx.stroke();
      ctx.setLineDash([]);

      // Клапан впрыска КД по ГОСТ 2.785
      this.drawGostValve(sprayX, (coldY + pzy) / 2, 'control', s.pz_spray_active ? 'open' : 'closed', 'ВПРЫСК КД', null, true);
    }

    // 4. Холодная нить (ДУ-850) — Холодный коллектор ПГ -> ГЦН -> Реактор
    // Внешняя изоляция холодной нити
    ctx.strokeStyle = '#2b3644';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(coldEndX, coldY);
    ctx.stroke();

    const coldInsGrad = ctx.createLinearGradient(0, coldY - 10, 0, coldY + 10);
    coldInsGrad.addColorStop(0, '#475569');
    coldInsGrad.addColorStop(0.5, '#64748b');
    coldInsGrad.addColorStop(1, '#1e293b');
    ctx.strokeStyle = coldInsGrad;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(coldEndX, coldY);
    ctx.stroke();

    // Внутренний поток холодного теплоносителя (синий)
    const coldCoreGrad = ctx.createLinearGradient(0, coldY - 6, 0, coldY + 6);
    coldCoreGrad.addColorStop(0, '#1d4ed8');
    coldCoreGrad.addColorStop(0.5, '#3b82f6');
    coldCoreGrad.addColorStop(1, '#1e3a8a');
    ctx.strokeStyle = coldCoreGrad;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(coldEndX, coldY);
    ctx.stroke();

    // Бандажи на холодной нити
    ctx.fillStyle = '#cbd5e1';
    for (let bx = coldEndX + 18; bx < sgColdX - 10; bx += 26) {
      if (Math.abs(bx - gcnX) > 28) {
        ctx.fillRect(bx, coldY - 11, 3, 22);
      }
    }

    // 5. Анимированные частицы циркуляции в контуре ДУ-850
    // Скорость и плотность масштабируются от расхода теплоносителя; при 0 ГЦН — естественная циркуляция (~5% скорости)
    const nominalFlow = 18800.0;
    const actualFlow = (typeof s.flow_1k_kg_s === 'number' && !isNaN(s.flow_1k_kg_s)) ? s.flow_1k_kg_s : ((s.rcp_active_count != null ? s.rcp_active_count : 4) / 4) * nominalFlow;
    const relLoopFlow = Math.max(0.05, actualFlow / nominalFlow);
    const flowSpeedMult = (s.rcp_active_count === 0) ? 0.05 : relLoopFlow;

    const primParticles = this.particles.filter(p => p.loop === 'primary');
    const primDensity = (s.rcp_active_count === 0) ? 0.25 : Math.min(1.0, 0.25 + 0.75 * ((s.rcp_active_count != null ? s.rcp_active_count : 4) / 4));
    const activePrimCount = Math.max(4, Math.round(primParticles.length * primDensity));

    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < activePrimCount && i < primParticles.length; i++) {
      const p = primParticles[i];
      p.t = (p.t + p.speed * flowSpeedMult * 0.016) % 1.0;
      let px, py;
      if (p.t < 0.5) {
        // Горячая нить (слева направо: от реактора к коллектору ПГ)
        const f = p.t / 0.5;
        px = hotStartX + f * (sgHotX - hotStartX);
        py = hotY;
      } else {
        // Холодная нить (справа налево: от коллектора ПГ через ГЦН к реактору)
        const f = (p.t - 0.5) / 0.5;
        px = sgColdX - f * (sgColdX - coldEndX);
        py = coldY;
      }
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. АВАРИЯ: ТЕЧЬ 1 КОНТУРА (LOCA)
    const isLoca = (s.active_scenarios && s.active_scenarios.loca_leak) || (typeof s.loca_leak_rate_kg_s === 'number' && s.loca_leak_rate_kg_s > 0) || (s.state === 'LOCA');
    if (isLoca) {
      const breakX = (hotStartX + sgHotX) * 0.5;
      const breakY = hotY;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(breakX - 6, breakY - 5, 12, 10);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(breakX - 6, breakY - 5, 12, 10);

      // Вскипающая струя теплоносителя под давлением
      const jetTime = this.animTime * 25;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (let j = 0; j < 10; j++) {
        const jProgress = ((jetTime + j * 0.3) % 3.0) / 3.0;
        const jx = breakX + Math.sin(j * 1.7) * 12 * jProgress;
        const jy = breakY - jProgress * 42 - (j % 3) * 5;
        ctx.beginPath();
        ctx.arc(jx, jy, 2.5 + jProgress * 10, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(224, 242, 254, 0.45)';
      for (let c = 0; c < 4; c++) {
        const cx = breakX - 15 + Math.sin(this.animTime * 4 + c) * 18;
        const cy = breakY - 28 - c * 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 12 + c * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      this.drawDataTag(breakX, breakY - 56, 'АВАРИЯ: ТЕЧЬ 1К (LOCA)', '#ef4444');
    }

    // Технологические шильдики температур нитей (выровнены без наложения на ГЦН)
    const hotTagX = (hotStartX + gcnX) / 2 - 15;
    const coldTagX = (coldEndX + gcnX) / 2 - 15;
    this.drawDataTag(hotTagX, hotY - 22, `Tгор: ${s.t_hot_c.toFixed(1)}°C`, '#fca5a5');
    this.drawDataTag(coldTagX, coldY + 22, `Tхол: ${s.t_cold_c.toFixed(1)}°C`, '#93c5fd');

    ctx.restore();
  }

  /**
   * Корпус реактора ВВЭР-1000: аутентичный разрез высокого давления ГОСТ 2.053
   */
  drawRealisticReactor(x, y, w, h, s) {
    const ctx = this.ctx;
    const top = y - h / 2;
    const bottom = y + h / 2;
    const relP = Math.max(0.01, s.relative_power_pct / 100.0);

    ctx.save();

    // 1. ВНЕШНИЙ КОРПУС ИЗ КОВАНОЙ СТАЛИ 15Х2НМФА (Толщина стенки 190 мм)
    const wallThick = 16;
    const flangeY = top + h * 0.16;
    const bottomHeadY = bottom - h * 0.18;

    // Внешний контур корпуса со сферическим днищем
    const outerGrad = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
    outerGrad.addColorStop(0, '#101722');
    outerGrad.addColorStop(0.2, '#253446');
    outerGrad.addColorStop(0.5, '#3b4e64');
    outerGrad.addColorStop(0.8, '#243242');
    outerGrad.addColorStop(1, '#0c1219');

    ctx.fillStyle = outerGrad;
    ctx.strokeStyle = '#4a607a';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(x - w / 2, flangeY);
    ctx.lineTo(x - w / 2, bottomHeadY);
    // Плавное сферическое днище корпуса
    ctx.bezierCurveTo(x - w / 2, bottom + 5, x + w / 2, bottom + 5, x + w / 2, bottomHeadY);
    ctx.lineTo(x + w / 2, flangeY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Внутренняя антикоррозионная наплавка из нержавеющей стали 08Х18Н10Т (толщина 8 мм)
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + wallThick, flangeY);
    ctx.lineTo(x - w / 2 + wallThick, bottomHeadY);
    ctx.bezierCurveTo(
      x - w / 2 + wallThick, bottom - wallThick,
      x + w / 2 - wallThick, bottom - wallThick,
      x + w / 2 - wallThick, bottomHeadY
    );
    ctx.lineTo(x + w / 2 - wallThick, flangeY);
    ctx.stroke();

    // Сварные кольцевые швы №1, 2, 3 между коваными обечайками корпуса
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.8;
    const weldY1 = flangeY + (bottomHeadY - flangeY) * 0.33;
    const weldY2 = flangeY + (bottomHeadY - flangeY) * 0.66;
    [weldY1, weldY2].forEach(wy => {
      ctx.beginPath();
      ctx.moveTo(x - w / 2, wy);
      ctx.lineTo(x - w / 2 + wallThick, wy);
      ctx.moveTo(x + w / 2 - wallThick, wy);
      ctx.lineTo(x + w / 2, wy);
      ctx.stroke();
    });

    // 2. ГЛАВНЫЙ РАЗЪЕМ И МАССИВНЫЕ ШПИЛЬКИ М140 (54 шт)
    const flangeH = 18;
    const flangeW = w * 1.08;
    const flGrad = ctx.createLinearGradient(x - flangeW / 2, flangeY, x + flangeW / 2, flangeY);
    flGrad.addColorStop(0, '#1c2837');
    flGrad.addColorStop(0.5, '#435872');
    flGrad.addColorStop(1, '#151f2b');

    ctx.fillStyle = flGrad;
    ctx.strokeStyle = '#5a7391';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - flangeW / 2, flangeY - flangeH / 2, flangeW, flangeH, 4);
    ctx.fill();
    ctx.stroke();

    // Шпильки главного разъема с гайками М140
    ctx.fillStyle = '#cbd5e1';
    const numStuds = 9;
    for (let i = 0; i < numStuds; i++) {
      const sx = x - flangeW * 0.44 + i * (flangeW * 0.88 / (numStuds - 1));
      ctx.fillRect(sx - 3, flangeY - flangeH / 2 - 4, 6, flangeH + 8);
      // Гайка
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(sx - 4.5, flangeY - flangeH / 2 - 2, 9, 6);
      ctx.fillStyle = '#cbd5e1';
    }

    // 3. ВЕРХНИЙ БЛОК (Съемный сферический купол крышки реактора)
    const domeH = flangeY - top;
    const domeGrad = ctx.createRadialGradient(x, flangeY - 10, 5, x, flangeY - 10, w * 0.6);
    domeGrad.addColorStop(0, '#33465c');
    domeGrad.addColorStop(0.7, '#1b2635');
    domeGrad.addColorStop(1, '#0e151e');

    ctx.fillStyle = domeGrad;
    ctx.strokeStyle = '#4b637e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, flangeY - 4, w * 0.52, domeH * 0.85, 0, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Патрубки и чехлы ШЭМ-3 приводов СУЗ над куполом крышки
    const numDrives = 7;
    for (let i = 0; i < numDrives; i++) {
      const dx = x - w * 0.36 + i * (w * 0.72 / (numDrives - 1));
      const driveTop = top - 24;
      const driveBottom = flangeY - 12 - Math.sin((i / (numDrives - 1)) * Math.PI) * 14;

      // Чехол привода ШЭМ (труба)
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(dx, driveBottom);
      ctx.lineTo(dx, driveTop);
      ctx.stroke();

      // Катушки шагово-электромагнитного привода
      ctx.fillStyle = '#d97706';
      ctx.fillRect(dx - 3.5, driveTop + 8, 7, 12);

      // Головка чехла привода с датчиком положения
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(dx - 4, driveTop, 8, 5);
    }

    // 4. ШАХТА РЕАКТОРА И ОПУСКНОЙ КОРИДОР (Downcomer annulus)
    const barrelW = w * 0.78;
    const barrelTop = flangeY + 4;
    const barrelBottom = bottomHeadY + 10;

    // Стенка шахты реактора (нержавеющая сталь 08Х18Н10Т)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - barrelW / 2, barrelTop);
    ctx.lineTo(x - barrelW / 2, barrelBottom);
    // Перфорированное эллиптическое днище шахты (распределитель потока теплоносителя)
    ctx.bezierCurveTo(
      x - barrelW / 2, barrelBottom + 26,
      x + barrelW / 2, barrelBottom + 26,
      x + barrelW / 2, barrelBottom
    );
    ctx.lineTo(x + barrelW / 2, barrelTop);
    ctx.stroke();

    // Перфорация в днище шахты для равномерного распределения теплоносителя
    ctx.fillStyle = '#38bdf8';
    for (let ox = -barrelW * 0.35; ox <= barrelW * 0.35; ox += 14) {
      ctx.beginPath();
      ctx.arc(x + ox, barrelBottom + 16, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Анимация нисходящего потока в опускном кольцевом зазоре (Downcomer)
    const nominalFlow = 18800.0;
    const curFlow = (typeof s.flow_1k_kg_s === 'number' && !isNaN(s.flow_1k_kg_s)) ? s.flow_1k_kg_s : ((s.rcp_active_count != null ? s.rcp_active_count : 4) / 4) * nominalFlow;
    const flowRel = Math.max(0.05, curFlow / nominalFlow);
    const flowSpeedMult = (s.rcp_active_count === 0) ? 0.05 : flowRel;

    const leftDownX = (x - w / 2 + wallThick + x - barrelW / 2) / 2;
    const rightDownX = (x + w / 2 - wallThick + x + barrelW / 2) / 2;
    ctx.fillStyle = '#38bdf8';
    this.particles.filter(p => p.loop === 'downcomer').forEach(p => {
      p.t = (p.t + p.speed * flowSpeedMult * 0.018) % 1.0;
      const py = barrelTop + 30 + p.t * (barrelBottom - barrelTop - 25);
      ctx.beginPath();
      ctx.arc(leftDownX, py, 2.0, 0, Math.PI * 2);
      ctx.arc(rightDownX, py, 2.0, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. ВЫГОРОДКА И АКТИВНАЯ ЗОНА (163 ТВС)
    const coreW = barrelW * 0.76;
    const coreH = (barrelBottom - barrelTop) * 0.58;
    const coreY = flangeY + (barrelBottom - flangeY) * 0.55;
    const coreTop = coreY - coreH / 2;
    const coreBottom = coreY + coreH / 2;

    // Металлическая выгородка активной зоны (тепловой экран от нейтронов)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    ctx.strokeRect(x - coreW / 2 - 2, coreTop - 2, coreW + 4, coreH + 4);

    // ОСЕВОЙ ТЕПЛОВОЙ ГРАДИЕНТ (290°C внизу -> 320°C вверху) И ЧЕРЕНКОВСКОЕ СВЕЧЕНИЕ
    const isScrammed = (s.state === 'SCRAMMED');
    const glowGrad = ctx.createLinearGradient(0, coreBottom, 0, coreTop);
    if (isScrammed) {
      // При АЗ-5 черенковское свечение мгновенно гаснет, переходя в глубокое пульсирующее вишневое свечение остаточного энерговыделения
      const decayPulse = Math.sin(this.animTime * 1.8) * 0.12 + 0.88;
      glowGrad.addColorStop(0, `rgba(74, 10, 15, ${0.45 * decayPulse})`);
      glowGrad.addColorStop(0.5, `rgba(136, 19, 30, ${0.55 * decayPulse})`);
      glowGrad.addColorStop(1, `rgba(185, 28, 28, ${0.40 * decayPulse})`);
    } else {
      const pulse = Math.sin(this.animTime * 2.8) * 0.08;
      const alpha = Math.min(1.0, 0.35 + relP * 0.65 + pulse);
      // Внизу (вход) — холодный лазурный/синий цвет; вверху (выход) — горячий белый/янтарный
      glowGrad.addColorStop(0, `rgba(14, 165, 233, ${alpha * 0.7})`);
      glowGrad.addColorStop(0.45, `rgba(0, 229, 255, ${alpha * 0.85})`);
      glowGrad.addColorStop(0.85, `rgba(254, 240, 138, ${alpha * 0.9})`);
      glowGrad.addColorStop(1, `rgba(255, 255, 255, ${alpha * 0.95})`);
    }

    ctx.fillStyle = glowGrad;
    ctx.fillRect(x - coreW / 2, coreTop, coreW, coreH);

    // Анимация восходящего потока теплоносителя через активную зону
    ctx.fillStyle = '#ffffff';
    this.particles.filter(p => p.loop === 'core_flow').forEach(p => {
      p.t = (p.t + p.speed * flowSpeedMult * 0.02) % 1.0;
      const py = coreBottom - p.t * (coreBottom - coreTop);
      const px = x - coreW * 0.42 + (p.speed * 10 % 1.0) * coreW * 0.84;
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // 163 ГЕКСАГОНАЛЬНЫЕ СБОРКИ ТВС С ДИСТАНЦИОНИРУЮЩИМИ РЕШЕТКАМИ
    const assemblies = 9;
    const assW = coreW / assemblies;
    for (let i = 0; i < assemblies; i++) {
      const ax = x - coreW / 2 + i * assW;

      // Твэлы внутри ТВС (пучок стержней)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax + assW * 0.3, coreTop + 4);
      ctx.lineTo(ax + assW * 0.3, coreBottom - 4);
      ctx.moveTo(ax + assW * 0.7, coreTop + 4);
      ctx.lineTo(ax + assW * 0.7, coreBottom - 4);
      ctx.stroke();

      // Дистанционирующие решетки ТВС (7 шт по высоте активной зоны)
      ctx.fillStyle = '#475569';
      for (let g = 1; g <= 6; g++) {
        const gy = coreTop + g * (coreH / 7);
        ctx.fillRect(ax + 1, gy - 1.2, assW - 2, 2.4);
      }
    }

    // Опорная решетка ТВС (хвостовики) и головки с пружинными блоками
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x - coreW / 2, coreBottom - 3, coreW, 6);
    ctx.fillRect(x - coreW / 2, coreTop - 3, coreW, 6);

    // 6. ЖЕСТКИЕ КЛАСТЕРЫ ПОГЛОЩАЮЩИХ СТЕРЖНЕЙ СУЗ (ПС СУЗ)
    // Физическая длина поглотителя постоянна (~coreH). При перемещении вся конструкция транслируется целиком!
    let rodPos = Math.max(0, Math.min(1.0, s.rod_position_pct / 100.0));
    if (isScrammed) {
      rodPos = 0.0;
    }
    const rodLength = coreH * 0.94;
    // rodPos = 1 (100%) -> стержни извлечены в БЗТ над зоной (нижний край на coreTop - 2)
    // rodPos = 0 (0%)   -> стержни полностью погружены в зону (нижний край на coreBottom - 2)
    const rodShift = (1.0 - rodPos) * rodLength;
    const traverseY = (coreTop - 4) - rodLength + rodShift;
    const fingerBottomY = traverseY + rodLength;

    const numClusters = 5;
    for (let i = 0; i < numClusters; i++) {
      const rxPin = x - coreW * 0.35 + i * (coreW * 0.70 / (numClusters - 1));

      // Штанга привода ШЭМ-3 (движется вместе с траверсой)
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(rxPin, flangeY - 12);
      ctx.lineTo(rxPin, traverseY);
      ctx.stroke();

      // Траверса (крестовина подвески поглощающих стержней)
      ctx.fillStyle = '#64748b';
      ctx.fillRect(rxPin - 7, traverseY - 2, 14, 4);

      // Кластер поглощающих стержней постоянной длины (карбид бора В4С + титанат диспрозия)
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      ctx.rect(rxPin - 2.5, traverseY, 5, rodLength);
      ctx.fill();
      ctx.stroke();
    }

    // 7. БЛОК ЗАЩИТНЫХ ТРУБ (БЗТ) над активной зоной
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < numClusters; i++) {
      const bx = x - coreW * 0.35 + i * (coreW * 0.70 / (numClusters - 1));
      ctx.strokeRect(bx - 4, flangeY + 12, 8, coreTop - flangeY - 16);
    }

    // 8. ПАТРУБКИ ДУ-850 (Верхний горячий и нижний холодный)
    const hotNozzleY = y - h * 0.16;
    const coldNozzleY = y + h * 0.16;

    // Горячий патрубок (вправо)
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.fillRect(x + w / 2 - 6, hotNozzleY - 11, 18, 22);
    ctx.strokeRect(x + w / 2 - 6, hotNozzleY - 11, 18, 22);

    // Холодный патрубок (вправо)
    ctx.fillRect(x + w / 2 - 6, coldNozzleY - 11, 18, 22);
    ctx.strokeRect(x + w / 2 - 6, coldNozzleY - 11, 18, 22);

    // Табличка маркировки реактора KKS
    this.drawComponentTag(x, top - 32, '10YA01', 'ВВЭР-1000 (В-320)');

    // Телеметрия активной зоны
    this.drawDataTag(x, flangeY + 28, `СУЗ: ${s.rod_position_pct.toFixed(1)}%`, '#f8fafc');
    this.drawDataTag(x, bottom - 18, `Tтопл: ${s.t_fuel_c.toFixed(0)}°C`, '#38bdf8');

    ctx.restore();
  }

  /**
   * Компенсатор давления КД-1000 (10YP01)
   */
  drawRealisticPressurizer(x, y, w, h, s) {
    const ctx = this.ctx;
    const top = y - h / 2;

    ctx.save();

    // Корпус высокого давления с эллиптическими днищами
    const pzGrad = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
    pzGrad.addColorStop(0, '#16202c');
    pzGrad.addColorStop(0.3, '#2c3b4f');
    pzGrad.addColorStop(0.7, '#384b63');
    pzGrad.addColorStop(1, '#111822');

    ctx.fillStyle = pzGrad;
    ctx.strokeStyle = '#5a718c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, h, 20);
    ctx.fill();
    ctx.stroke();

    // Внутренняя водяная подушка по уровню (0..12 м)
    const levelFrac = Math.max(0.08, Math.min(0.92, s.pz_level_m / 12.0));
    const waterH = (h - 8) * levelFrac;
    const waterTop = top + h - 4 - waterH;

    const waterGrad = ctx.createLinearGradient(x, waterTop, x, top + h);
    waterGrad.addColorStop(0, 'rgba(56, 189, 248, 0.7)');
    waterGrad.addColorStop(0.5, 'rgba(14, 116, 144, 0.85)');
    waterGrad.addColorStop(1, 'rgba(3, 105, 161, 0.95)');

    ctx.fillStyle = waterGrad;
    ctx.beginPath();
    ctx.roundRect(x - w / 2 + 3, waterTop, w - 6, waterH, [0, 0, 16, 16]);
    ctx.fill();

    // Мениск и волны на поверхности воды
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 4, waterTop);
    ctx.lineTo(x + w / 2 - 4, waterTop);
    ctx.stroke();

    // Блок ТЭН (Электронагреватели в нижней части)
    if (s.pz_heaters_kw > 50) {
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const hy = top + h - 14 - i * 6;
        ctx.beginPath();
        ctx.moveTo(x - 16, hy);
        ctx.lineTo(x + 16, hy);
        ctx.stroke();
      }
      // Тепловое свечение нагревателей
      const heatGlow = ctx.createRadialGradient(x, top + h - 22, 2, x, top + h - 22, 26);
      heatGlow.addColorStop(0, 'rgba(249, 115, 22, 0.7)');
      heatGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = heatGlow;
      ctx.fillRect(x - w / 2 + 4, top + h - 38, w - 8, 34);
    }

    // Впрыск в паровой объем из форсунки сверху
    if (s.pz_spray_active) {
      ctx.fillStyle = '#bae6fd';
      for (let i = 0; i < 6; i++) {
        const sy = top + 16 + ((i * 7 + this.animTime * 60) % Math.max(10, waterTop - top - 18));
        ctx.fillRect(x - 10 + i * 4, sy, 2, 4);
      }
    }

    // ИПУ (Импульсно-предохранительные клапаны сверху)
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4, top);
    ctx.lineTo(x - 4, top - 24);
    ctx.moveTo(x + 4, top);
    ctx.lineTo(x + 4, top - 24);
    ctx.stroke();

    // Шильдик 10YP01 КД-1000: размещаем слева у плеча сосуда, исключая контакт с клапаном ИПУ КД
    this.drawComponentTag(x - 72, top + 15, '10YP01', 'КД-1000');

    // Цифровая телеметрия КД в защищённой плашке справа от дыхательного трубопровода
    const pzBadgeW = 76;
    const pzBadgeH = 26;
    const pzBadgeX = x + 14;
    const pzBadgeY = top + h + 6;
    ctx.fillStyle = 'rgba(10, 18, 30, 0.85)';
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pzBadgeX, pzBadgeY, pzBadgeW, pzBadgeH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 9px Consolas, monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    ctx.fillText(`P1: ${s.pressure_1k_mpa.toFixed(2)} МПа`, pzBadgeX + pzBadgeW / 2, pzBadgeY + 10);
    ctx.fillText(`L: ${s.pz_level_m.toFixed(2)} м`, pzBadgeX + pzBadgeW / 2, pzBadgeY + 21);

    ctx.restore();
  }

  /**
   * ГОРИЗОНТАЛЬНЫЙ ПАРОГЕНЕРАТОР ПГВ-1000М (20YB01)
   * Аутентичный советский горизонтальный сосуд с вертикальными коллекторами 1К
   */
  drawRealisticSteamGenerator(sgx, sgy, sgw, sgh, rx, ry, rw, rh, s) {
    if (typeof s === 'undefined' && typeof rx === 'object') {
      s = rx;
      rx = this.width * 0.18;
      ry = this.height * 0.50;
      rw = Math.max(140, Math.min(220, this.width * 0.15));
      rh = Math.max(300, Math.min(480, this.height * 0.68));
    }
    const ctx = this.ctx;
    const top = sgy - sgh / 2;
    const bottom = sgy + sgh / 2;
    const left = sgx - sgw / 2;
    const right = sgx + sgw / 2;

    const hotY = ry - rh * 0.16;
    const coldY = ry + rh * 0.16;
    const sgHotX = sgx - sgw * 0.25;
    const sgColdX = sgx + sgw * 0.25;
    const collW = 16;

    ctx.save();

    // 1. ГОРИЗОНТАЛЬНЫЙ ЦИЛИНДРИЧЕСКИЙ КОРПУС СО СФЕРИЧЕСКИМИ ДНИЩАМИ
    const sgGrad = ctx.createLinearGradient(sgx, top, sgx, bottom);
    sgGrad.addColorStop(0, '#1c2837');
    sgGrad.addColorStop(0.3, '#334356');
    sgGrad.addColorStop(0.7, '#243242');
    sgGrad.addColorStop(1, '#0e151e');

    ctx.fillStyle = sgGrad;
    ctx.strokeStyle = '#5a7391';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(left, top, sgw, sgh, 24);
    ctx.fill();
    ctx.stroke();

    // Бандажи и опоры корпуса ПГВ-1000
    ctx.fillStyle = '#475569';
    ctx.fillRect(left + 22, bottom - 2, 10, 8);
    ctx.fillRect(right - 32, bottom - 2, 10, 8);

    // 2. ПАТРУБКИ ПРОХОДА ЧЕРЕЗ ЛЕВУЮ ОБЕЧАЙКУ ПГВ-1000М
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    // Горячий патрубок (проход левой стенки)
    ctx.fillRect(left - 8, hotY - 11, 16, 22);
    ctx.strokeRect(left - 8, hotY - 11, 16, 22);
    // Холодный патрубок (проход левой стенки)
    ctx.fillRect(left - 8, coldY - 11, 16, 22);
    ctx.strokeRect(left - 8, coldY - 11, 16, 22);

    // 3. ВНУТРЕННИЕ УЧАСТКИ ТРУБОПРОВОДОВ 1К ВНУТРИ КОРПУСА ПГ
    // Вход горячей нити: проникает сквозь левую стенку и оканчивается точно в горячем коллекторе sgHotX
    ctx.strokeStyle = '#2b3644';
    ctx.lineWidth = 22;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(left, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    const hotInsGrad = ctx.createLinearGradient(0, hotY - 10, 0, hotY + 10);
    hotInsGrad.addColorStop(0, '#64748b');
    hotInsGrad.addColorStop(0.5, '#94a3b8');
    hotInsGrad.addColorStop(1, '#334155');
    ctx.strokeStyle = hotInsGrad;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(left, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    const hotCoreGrad = ctx.createLinearGradient(0, hotY - 6, 0, hotY + 6);
    hotCoreGrad.addColorStop(0, '#b91c1c');
    hotCoreGrad.addColorStop(0.5, '#ef4444');
    hotCoreGrad.addColorStop(1, '#991b1b');
    ctx.strokeStyle = hotCoreGrad;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(left, hotY);
    ctx.lineTo(sgHotX, hotY);
    ctx.stroke();

    // Выход холодной нити: берет начало точно от холодного коллектора sgColdX и идет сквозь левую стенку
    ctx.strokeStyle = '#2b3644';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(left, coldY);
    ctx.stroke();

    const coldInsGrad = ctx.createLinearGradient(0, coldY - 10, 0, coldY + 10);
    coldInsGrad.addColorStop(0, '#475569');
    coldInsGrad.addColorStop(0.5, '#64748b');
    coldInsGrad.addColorStop(1, '#1e293b');
    ctx.strokeStyle = coldInsGrad;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(left, coldY);
    ctx.stroke();

    const coldCoreGrad = ctx.createLinearGradient(0, coldY - 6, 0, coldY + 6);
    coldCoreGrad.addColorStop(0, '#1d4ed8');
    coldCoreGrad.addColorStop(0.5, '#3b82f6');
    coldCoreGrad.addColorStop(1, '#1e3a8a');
    ctx.strokeStyle = coldCoreGrad;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(sgColdX, coldY);
    ctx.lineTo(left, coldY);
    ctx.stroke();

    // Внутренние бандажные кольца
    ctx.fillStyle = '#cbd5e1';
    for (let bx = left + 14; bx < sgColdX - 10; bx += 26) {
      if (Math.abs(bx - sgHotX) > collW / 2 + 2) {
        ctx.fillRect(bx, coldY - 11, 3, 22);
      }
    }

    // 4. ДВА ВЕРТИКАЛЬНЫХ КОЛЛЕКТОРА 1-ГО КОНТУРА (Горячий слева, холодный справа)
    const collTop = hotY - 14;
    const collBottom = coldY + 14;
    const collH = collBottom - collTop;

    // Горячий коллектор (вход теплоносителя из реактора)
    const hotCollGrad = ctx.createLinearGradient(sgHotX - collW / 2, 0, sgHotX + collW / 2, 0);
    hotCollGrad.addColorStop(0, '#7f1d1d');
    hotCollGrad.addColorStop(0.5, '#ef4444');
    hotCollGrad.addColorStop(1, '#991b1b');
    ctx.fillStyle = hotCollGrad;
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(sgHotX - collW / 2, collTop, collW, collH, 5);
    ctx.fill();
    ctx.stroke();

    // Холодный коллектор (выход к ГЦН)
    const coldCollGrad = ctx.createLinearGradient(sgColdX - collW / 2, 0, sgColdX + collW / 2, 0);
    coldCollGrad.addColorStop(0, '#1e3a8a');
    coldCollGrad.addColorStop(0.5, '#3b82f6');
    coldCollGrad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = coldCollGrad;
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(sgColdX - collW / 2, collTop, collW, collH, 5);
    ctx.fill();
    ctx.stroke();

    // 5. ГОРИЗОНТАЛЬНЫЙ ТРУБНЫЙ ПУЧОК (нержавеющие змеевиковые трубки)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1.4;
    const numTubes = 7;
    for (let i = 0; i < numTubes; i++) {
      const ty = collTop + 10 + i * (collH - 20) / (numTubes - 1);
      ctx.beginPath();
      ctx.moveTo(sgHotX + collW / 2, ty);
      ctx.bezierCurveTo(sgx - 12, ty - 4, sgx + 12, ty + 4, sgColdX - collW / 2, ty);
      ctx.stroke();
    }

    // 6. КОТЛОВАЯ ВОДА 2-ГО КОНТУРА ПО УРОВНЮ (0..3.5 м, норма ~2.45 м)
    const levelFrac = Math.max(0.12, Math.min(0.88, s.sg_level_m / 3.5));
    const waterH = (sgh - 8) * levelFrac;
    const waterTop = bottom - 4 - waterH;

    const sgWaterGrad = ctx.createLinearGradient(sgx, waterTop, sgx, bottom);
    sgWaterGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
    sgWaterGrad.addColorStop(0.6, 'rgba(14, 116, 144, 0.65)');
    sgWaterGrad.addColorStop(1, 'rgba(3, 105, 161, 0.8)');

    ctx.fillStyle = sgWaterGrad;
    ctx.beginPath();
    ctx.roundRect(left + 4, waterTop, sgw - 8, waterH, [0, 0, 20, 20]);
    ctx.fill();

    // Погруженный дырчатый лист (ПДЛ) и зеркало испарения
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left + 8, waterTop);
    ctx.lineTo(right - 8, waterTop);
    ctx.stroke();

    // Пузырьки пара, поднимающиеся от трубного пучка (кипение)
    if (s.steam_flow_kg_s > 80) {
      ctx.fillStyle = '#ffffff';
      this.steamBubbles.forEach(b => {
        b.y = (b.y - b.speed * 0.02) % 1.0;
        if (b.y < 0) b.y += 1.0;
        const bx = left + 14 + b.x * (sgw - 28);
        const by = waterTop + b.y * waterH;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Частицы потока 1К внутри ПГ (проход сквозь обечайку)
    const flowRel = Math.max(0.02, s.flow_1k_kg_s / 18800.0);
    if (flowRel > 0.05) {
      ctx.fillStyle = '#ffffff';
      const hotStartX = rx + rw * 0.5 - 4;
      const coldEndX = rx + rw * 0.5 - 4;
      this.particles.filter(p => p.loop === 'primary').forEach(p => {
        if (p.t < 0.5) {
          const f = p.t / 0.5;
          const px = hotStartX + f * (sgHotX - hotStartX);
          if (px >= left && px <= sgHotX) {
            ctx.beginPath();
            ctx.arc(px, hotY, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const f = (p.t - 0.5) / 0.5;
          const px = sgColdX - f * (sgColdX - coldEndX);
          if (px >= left && px <= sgColdX) {
            if (Math.abs(px - sgHotX) > collW / 2) {
              ctx.beginPath();
              ctx.arc(px, coldY, 2.4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      });
    }

    // 7. ЖАЛЮЗИЙНЫЕ СЕПАРАТОРЫ ПАРА В ВЕРХНЕЙ ЧАСТИ
    ctx.fillStyle = '#475569';
    for (let sx = left + 26; sx <= right - 26; sx += 12) {
      ctx.fillRect(sx, top + 10, 8, 4);
    }

    // Пароотводящий патрубок свежего пара (смещен вправо от таблички)
    const sgSteamX = sgx + 35;
    ctx.fillStyle = '#64748b';
    ctx.fillRect(sgSteamX - 7, top - 8, 14, 9);

    // Табличка маркировки ПГ (смещена влево от паропровода: гарантированный зазор > 20px)
    this.drawComponentTag(sgx - 45, top - 28, '10..40YB10', 'ПГВ-1000М (ПГ-1..4)');

    // 8. ПАРАМЕТРЫ 2-ГО КОНТУРА (Аккуратный шильдик телеметрии с фоновой плашкой)
    const tagW = 96;
    const tagH = 24;
    const tagX = sgx - 30;
    const tagY = bottom + 8;

    ctx.fillStyle = '#090e15';
    ctx.strokeStyle = '#2d3b4b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(tagX - tagW / 2, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 8.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`P2: ${s.pressure_2k_mpa.toFixed(2)} МПа`, tagX, tagY + 10);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`Ур: ${s.sg_level_m.toFixed(2)} м`, tagX, tagY + 20);

    ctx.restore();
  }

  /**
   * Трубопроводы 2-го контура: Паропровод свежего пара и питательная вода с анимацией
   */
  drawSecondaryPiping(sgx, sgy, sgw, sgh, turbx, turby, condx, condy, s) {
    const ctx = this.ctx;
    ctx.save();

    const steamY = turby - 12;
    const sgSteamX = sgx + 35;
    const topSG = sgy - sgh / 2;

    // 1. Паропровод свежего пара (ПГВ-1000М -> Стопорный клапан турбины)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sgSteamX, topSG - 4);
    ctx.lineTo(sgSteamX, steamY);
    ctx.lineTo(turbx - 52, steamY);
    ctx.stroke();

    // Внутренняя струя пара
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sgSteamX, topSG - 4);
    ctx.lineTo(sgSteamX, steamY);
    ctx.lineTo(turbx - 52, steamY);
    ctx.stroke();

    // Главная паровая задвижка (ГПЗ) по ГОСТ 2.785-70 с электроприводом
    const gpzX = (sgSteamX + turbx - 52) / 2;
    this.drawGostValve(gpzX, steamY, 'gate', (s.turbine_rpm > 100) ? 'open' : 'closed', 'ГПЗ', null, false);

    // 2. Выхлоп отработавшего пара из ЦНД в конденсатор
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(turbx - 8, turby + 28);
    ctx.lineTo(condx - 8, condy - 25);
    ctx.stroke();

    // 3. Линия питательной воды (Конденсатор -> ПЭН -> ПГВ-1000М)
    const feedY = condy + 12;
    const feedCornerX = sgx + sgw * 0.42;
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(condx - 30, feedY);
    ctx.lineTo(feedCornerX, feedY);
    ctx.lineTo(feedCornerX, sgy + 20);
    ctx.stroke();

    // 4. Анимация частиц свежего пара
    if (s.steam_flow_kg_s > 80) {
      ctx.fillStyle = '#ffffff';
      this.particles.filter(p => p.loop === 'steam').forEach(p => {
        p.t = (p.t + p.speed * 0.03) % 1.0;
        let px, py;
        if (p.t < 0.3) {
          px = sgSteamX;
          py = (topSG - 4) - (p.t / 0.3) * ((topSG - 4) - steamY);
        } else {
          px = sgSteamX + ((p.t - 0.3) / 0.7) * (turbx - 52 - sgSteamX);
          py = steamY;
        }
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 5. Анимация частиц питательной воды (Конденсатор -> ПЭН -> ПГВ-1000М)
    const feedRel = Math.max(0.05, s.feedwater_flow_kg_s / 1480.0);
    if (feedRel > 0.05 && (s.feedwater_pumps_on ? (s.feedwater_pumps_on[0] || s.feedwater_pumps_on[1]) : true)) {
      ctx.fillStyle = '#38bdf8';
      this.particles.filter(p => p.loop === 'feedwater').forEach(p => {
        p.t = (p.t + p.speed * feedRel * 0.02) % 1.0;
        let px, py;
        const totalLen = Math.abs(feedCornerX - (condx - 30)) + Math.abs(feedY - (sgy + 20));
        const horizFrac = Math.abs(feedCornerX - (condx - 30)) / totalLen;
        if (p.t < horizFrac) {
          // Горизонтальный участок влево
          const f = p.t / horizFrac;
          px = (condx - 30) - f * ((condx - 30) - feedCornerX);
          py = feedY;
        } else {
          // Вертикальный участок вверх в ПГ
          const f = (p.t - horizFrac) / (1.0 - horizFrac);
          px = feedCornerX;
          py = feedY - f * (feedY - (sgy + 20));
        }
        ctx.beginPath();
        ctx.arc(px, py, 2.0, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();
  }

  /**
   * ТУРБОУСТАНОВКА К-1000-60/1500 И ГЕНЕРАТОР ТВВ-1000
   * ЦВД (Цилиндр высокого давления) + СПП + ЦНД + ТВВ-1000
   */
  drawRealisticTurbineAndGenerator(x, y, s) {
    const ctx = this.ctx;
    ctx.save();

    // 1. ЦИЛИНДР ВЫСОКОГО ДАВЛЕНИЯ (ЦВД)
    const hpcW = 38;
    const hpcH = 42;
    const hpcX = x - 46;

    const hpcGrad = ctx.createLinearGradient(hpcX - hpcW / 2, y, hpcX + hpcW / 2, y);
    hpcGrad.addColorStop(0, '#2d3b4b');
    hpcGrad.addColorStop(0.5, '#4a5d73');
    hpcGrad.addColorStop(1, '#1b2531');

    ctx.fillStyle = hpcGrad;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2.5;

    // Симметричный корпус ЦВД двухпоточный
    ctx.beginPath();
    ctx.moveTo(hpcX - hpcW / 2, y - 14);
    ctx.lineTo(hpcX, y - hpcH / 2);
    ctx.lineTo(hpcX + hpcW / 2, y - 14);
    ctx.lineTo(hpcX + hpcW / 2, y + 14);
    ctx.lineTo(hpcX, y + hpcH / 2);
    ctx.lineTo(hpcX - hpcW / 2, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. СЕПАРАТОРЫ-ПАРОПЕРЕГРЕВАТЕЛИ (СПП-1000)
    const sppX = x - 22;
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.fillRect(sppX - 5, y - 28, 10, 14);
    ctx.strokeRect(sppX - 5, y - 28, 10, 14);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 6.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('СПП', sppX, y - 19);

    // 3. ЦИЛИНДР НИЗКОГО ДАВЛЕНИЯ (ЦНД) С ВЫХЛОПНЫМИ ПАТРУБКАМИ
    const lpcW = 46;
    const lpcH = 56;
    const lpcX = x;

    const lpcGrad = ctx.createLinearGradient(lpcX - lpcW / 2, y, lpcX + lpcW / 2, y);
    lpcGrad.addColorStop(0, '#202b37');
    lpcGrad.addColorStop(0.5, '#3b4c60');
    lpcGrad.addColorStop(1, '#151d26');

    ctx.fillStyle = lpcGrad;
    ctx.strokeStyle = '#5d758f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lpcX - lpcW / 2, y - 20);
    ctx.lineTo(lpcX + lpcW / 2, y - 20);
    ctx.lineTo(lpcX + lpcW / 2 + 4, y + lpcH / 2);
    ctx.lineTo(lpcX - lpcW / 2 - 4, y + lpcH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. ВАЛОПРОВОД ТУРБИНЫ С ПОДШИПНИКАМИ
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(hpcX - hpcW / 2 - 4, y);
    ctx.lineTo(x + 75, y);
    ctx.stroke();

    // Опорные подшипники вала
    ctx.fillStyle = '#475569';
    ctx.fillRect(hpcX + hpcW / 2, y - 5, 6, 10);
    ctx.fillRect(lpcX + lpcW / 2, y - 5, 8, 10);

    // 5. ТУРБОГЕНЕРАТОР ТВВ-1000 (Бирюзовая советская эмаль)
    const genW = 48;
    const genH = 52;
    const genX = x + 44;

    const genGrad = ctx.createLinearGradient(genX, y - genH / 2, genX, y + genH / 2);
    genGrad.addColorStop(0, '#0f766e');
    genGrad.addColorStop(0.4, '#14b8a6');
    genGrad.addColorStop(0.8, '#0d9488');
    genGrad.addColorStop(1, '#042f2e');

    ctx.fillStyle = genGrad;
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(genX - genW / 2, y - genH / 2, genW, genH, 6);
    ctx.fill();
    ctx.stroke();

    // Возбудитель на конце вала
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.fillRect(genX + genW / 2, y - 10, 10, 20);
    ctx.strokeRect(genX + genW / 2, y - 10, 10, 20);

    // Вращение ротора генератора
    if (s.turbine_rpm > 50) {
      const angle = this.animTime * (s.turbine_rpm / 60.0);
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(genX, y, 11, angle, angle + Math.PI);
      ctx.stroke();
    }

    this.drawComponentTag(x + 12, y - 44, '30MA01', 'ТУРБОУСТАНОВКА К-1000');

    // Параметры генератора
    ctx.font = 'bold 9px Consolas, monospace';
    ctx.fillStyle = '#2dd4bf';
    ctx.textAlign = 'center';
    ctx.fillText(`${s.electric_power_mw.toFixed(0)} МВт`, genX, y + genH / 2 + 14);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${s.turbine_rpm.toFixed(0)} об/мин`, hpcX, y + 36);

    ctx.restore();
  }

  /**
   * Конденсатор турбины
   */
  drawRealisticCondenser(x, y, s) {
    const ctx = this.ctx;
    const w = 78;
    const h = 50;
    ctx.save();

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#38485c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Трубные пучки конденсатора
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    for (let r = -w / 2 + 10; r < w / 2 - 10; r += 8) {
      ctx.beginPath();
      ctx.moveTo(x + r, y - h / 2 + 6);
      ctx.lineTo(x + r, y + 6);
      ctx.stroke();
    }

    // Уровень горячего конденсата в сборнике
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(x - w / 2 + 3, y + 8, w - 6, h / 2 - 10);

    this.drawComponentTag(x, y - 34, '40AA01', 'КОНДЕНСАТОР');

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 8.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Pвак: ${s.condenser_vacuum_kpa.toFixed(1)} кПа`, x, y + 20);

    ctx.restore();
  }

  /**
   * Насосное оборудование (ГЦН-195М и ПЭН)
   * ВНИМАНИЕ: gcnY СТРОГО выровнен по оси coldY = ry + rh * 0.16!
   */
  drawRealisticPumps(rx, ry, rw, rh, sgx, sgy, sgw, condx, condy, s) {
    const ctx = this.ctx;
    ctx.save();

    // ГЦН-195М на холодной нити — СТРОГО по оси coldY!
    const gcnX = (rx + rw * 0.5 + sgx - sgw * 0.25) / 2 + 25;
    const gcnY = ry + rh * 0.16;

    const isRcpRunning = s.rcp_active_count > 0;

    // Сферический корпус ГЦН
    const gcnGrad = ctx.createRadialGradient(gcnX - 4, gcnY - 4, 3, gcnX, gcnY, 18);
    if (isRcpRunning) {
      gcnGrad.addColorStop(0, '#059669');
      gcnGrad.addColorStop(0.7, '#065f46');
      gcnGrad.addColorStop(1, '#022c22');
    } else {
      gcnGrad.addColorStop(0, '#dc2626');
      gcnGrad.addColorStop(0.7, '#7f1d1d');
      gcnGrad.addColorStop(1, '#450a0a');
    }

    ctx.fillStyle = gcnGrad;
    ctx.strokeStyle = isRcpRunning ? '#34d399' : '#f87171';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(gcnX, gcnY, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Электродвигатель ВДА-173 сверху насоса
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.fillRect(gcnX - 10, gcnY - 32, 20, 16);
    ctx.strokeRect(gcnX - 10, gcnY - 32, 20, 16);

    // Вращающиеся лопасти рабочего колеса ГЦН
    const gcnAngle = isRcpRunning ? this.animTime * 16 : 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(gcnX - 11 * Math.cos(gcnAngle), gcnY - 11 * Math.sin(gcnAngle));
    ctx.lineTo(gcnX + 11 * Math.cos(gcnAngle), gcnY + 11 * Math.sin(gcnAngle));
    ctx.stroke();

    ctx.fillStyle = '#0a0f16';
    ctx.strokeStyle = '#2d3b4b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(gcnX - 44, gcnY + 21, 88, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 8.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ГЦН-195М (${s.rcp_active_count}/4)`, gcnX, gcnY + 32);

    // Питательный электронасос ПЭН
    const penX = sgx + sgw * 0.42;
    const penY = condy + 12;

    const isPenRunning = s.feedwater_pumps_on ? (s.feedwater_pumps_on[0] || s.feedwater_pumps_on[1]) : true;
    ctx.fillStyle = isPenRunning ? '#0369a1' : '#450a0a';
    ctx.strokeStyle = isPenRunning ? '#38bdf8' : '#dc2626';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(penX, penY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0a0f16';
    ctx.strokeStyle = '#2d3b4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(penX - 16, penY + 14, 32, 13, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 8px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ПЭН', penX, penY + 23);

    ctx.restore();
  }

  drawValve(x, y, label) {
    const ctx = this.ctx;
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.8;

    ctx.beginPath();
    ctx.moveTo(x - 8, y - 7);
    ctx.lineTo(x + 8, y + 7);
    ctx.lineTo(x + 8, y - 7);
    ctx.lineTo(x - 8, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (label) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 10);
    }
  }

  drawComponentTag(x, y, kks, name, customW) {
    const ctx = this.ctx;
    ctx.save();
    const kksLen = kks ? kks.length : 0;
    const nameLen = name ? name.length : 0;
    const maxLen = Math.max(kksLen, nameLen);
    const w = customW || Math.max(74, Math.min(130, maxLen * 6.0 + 16));
    ctx.fillStyle = '#0a0f16';
    ctx.strokeStyle = '#38485c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 8px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(kks, x, y + 9);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 7.5px Consolas, monospace';
    ctx.fillText(name, x, y + 18);
    ctx.restore();
  }

  drawDataTag(x, y, text, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#090e15';
    ctx.strokeStyle = '#2d3b4b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x - 40, y - 8, 80, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 8.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4);
    ctx.restore();
  }

  /**
   * Стандартизированные условные графические обозначения арматуры ГОСТ 2.785-70 / ГОСТ 2.784-96
   */
  drawGostValve(x, y, type, state, label, valueText, isVertical) {
    const ctx = this.ctx;
    ctx.save();

    const isClosed = (state === 'closed');
    const color = isClosed ? '#64748b' : '#38bdf8';
    const fill = isClosed ? '#1e293b' : '#0369a1';

    ctx.fillStyle = fill;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;

    const L = 9;
    const H = 7;

    ctx.beginPath();
    if (isVertical) {
      // Верхний конус/треугольник: основание вверху, вершина в (x, y)
      ctx.moveTo(x - H, y - L);
      ctx.lineTo(x + H, y - L);
      ctx.lineTo(x, y);
      ctx.closePath();
      // Нижний конус/треугольник: вершина в (x, y), основание внизу
      ctx.moveTo(x, y);
      ctx.lineTo(x - H, y + L);
      ctx.lineTo(x + H, y + L);
      ctx.closePath();
    } else {
      // Левый треугольник: основание слева, вершина в (x, y)
      ctx.moveTo(x - L, y - H);
      ctx.lineTo(x - L, y + H);
      ctx.lineTo(x, y);
      ctx.closePath();
      // Правый треугольник: вершина в (x, y), основание справа
      ctx.moveTo(x, y);
      ctx.lineTo(x + L, y - H);
      ctx.lineTo(x + L, y + H);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    // Привод арматуры по ГОСТ 2.785-70
    if (type === 'control') {
      // Мембранный регулирующий привод (купол на штоке)
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, isVertical ? y : y - H);
      ctx.lineTo(x + (isVertical ? 10 : 0), y - (isVertical ? 0 : 12));
      ctx.stroke();

      ctx.fillStyle = isClosed ? '#334155' : '#0284c7';
      ctx.beginPath();
      if (isVertical) {
        ctx.arc(x + 10, y, 6, -Math.PI / 2, Math.PI / 2);
      } else {
        ctx.arc(x, y - 12, 6, Math.PI, 0);
      }
      ctx.fill();
      ctx.stroke();
    } else if (type === 'gate') {
      // Задвижка с электроприводом (квадрат с буквой 'М')
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - H);
      ctx.lineTo(x, y - 10);
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x - 5, y - 19, 10, 9);
      ctx.strokeRect(x - 5, y - 19, 10, 9);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 7px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('М', x, y - 12);
    } else if (type === 'check') {
      // Обратный клапан (шарик седла)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'safety') {
      // Предохранительный клапан ИПУ (угловой)
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - H);
      ctx.lineTo(x + 7, y - H - 7);
      ctx.stroke();
    }

    if (label) {
      ctx.save();
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.textAlign = 'center';
      const ly = isVertical ? y - L - 4 : y - H - 14;
      const lx = x + (isVertical ? 16 : 0);
      const metrics = ctx.measureText ? ctx.measureText(label) : { width: 36 };
      const tw = Math.max(30, metrics.width + 6);
      ctx.fillStyle = 'rgba(10, 15, 22, 0.85)';
      ctx.strokeStyle = '#2d3b4b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2, ly - 8, tw, 11, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }
    if (valueText) {
      ctx.save();
      ctx.font = 'bold 7.5px Consolas, monospace';
      ctx.textAlign = 'center';
      const vy = isVertical ? y + L + 10 : y + H + 10;
      const vx = x;
      const metrics = ctx.measureText ? ctx.measureText(valueText) : { width: 30 };
      const tw = Math.max(26, metrics.width + 6);
      ctx.fillStyle = 'rgba(10, 15, 22, 0.85)';
      ctx.strokeStyle = '#2d3b4b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(vx - tw / 2, vy - 8, tw, 11, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.fillText(valueText, vx, vy);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Архитектура 4-х петель (ПГ-1..4, ГЦН-1..4), пассивные гидроемкости САОЗ 1..4 и арматура ГОСТ (БРУ-К, БРУ-А)
   */
  drawFourLoopsAndSaoz(rx, ry, rw, rh, sgx, sgy, sgw, sgh, pzx, pzy, condx, condy, turbx, turby, s) {
    const ctx = this.ctx;
    ctx.save();

    // 1. САОЗ: 4 ПАССИВНЫЕ ГИДРОЕМКОСТИ ГЕ-1..4 (KKS: 10JNG10, 20, 30, 40)
    // Расположены слева от корпуса реактора
    const tankW = 22;
    const tankH = Math.max(34, Math.min(48, rh * 0.13));
    const tankX = Math.max(20, rx - rw * 0.5 - 28);
    const tankGap = (rh * 0.72) / 3.0;

    for (let i = 0; i < 4; i++) {
      const tankY = ry - rh * 0.36 + i * tankGap;
      const topHeadY = tankY - tankH / 2;

      // Корпус гидроемкости САОЗ (60 м³, расчетное давление 7.0 МПа)
      const tankGrad = ctx.createLinearGradient(tankX - tankW / 2, tankY, tankX + tankW / 2, tankY);
      tankGrad.addColorStop(0, '#1e293b');
      tankGrad.addColorStop(0.5, '#475569');
      tankGrad.addColorStop(1, '#0f172a');
      ctx.fillStyle = tankGrad;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(tankX - tankW / 2, topHeadY, tankW, tankH, 8);
      ctx.fill();
      ctx.stroke();

      // Газовая подушка N2 (азот 6.0 МПа) в верхней части
      ctx.fillStyle = 'rgba(234, 179, 8, 0.45)';
      ctx.beginPath();
      ctx.roundRect(tankX - tankW / 2 + 2, topHeadY + 2, tankW - 4, tankH * 0.32, [6, 6, 0, 0]);
      ctx.fill();

      // Запас борированной воды (2800 ppm) в нижней части
      ctx.fillStyle = 'rgba(14, 165, 233, 0.75)';
      ctx.beginPath();
      ctx.roundRect(tankX - tankW / 2 + 2, topHeadY + tankH * 0.32, tankW - 4, tankH * 0.68 - 2, [0, 0, 6, 6]);
      ctx.fill();

      // Трубопровод подачи борированного раствора в патрубок реактора
      // ГЕ-1..2 подают в верхнюю камеру (hot), ГЕ-3..4 в нижнюю (cold)
      const connY = (i < 2) ? (ry - rh * 0.16) : (ry + rh * 0.16);
      const isInjecting = s.saoz_active || (s.pressure_1k_mpa < 6.0);

      ctx.strokeStyle = isInjecting ? '#ec4899' : '#334155';
      ctx.lineWidth = isInjecting ? 3.5 : 2.0;
      if (isInjecting) ctx.setLineDash([5, 3]);

      ctx.beginPath();
      ctx.moveTo(tankX + tankW / 2, tankY);
      ctx.lineTo(rx - rw * 0.5 + 4, connY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Обратный клапан САОЗ по ГОСТ
      const vX = (tankX + tankW / 2 + rx - rw * 0.5) / 2;
      const vY = (tankY + connY) / 2;
      this.drawGostValve(vX, vY, 'check', isInjecting ? 'open' : 'closed', `САОЗ-${i + 1}`);

      // Маркировка емкости
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 7.5px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`ГЕ-${i + 1}`, tankX, topHeadY - 3);
    }

    // Если САОЗ сработала, выводим тревожный баннер
    if (s.saoz_active || s.pressure_1k_mpa < 6.0) {
      const bannerX = rx - 30;
      const bannerY = ry - rh * 0.44;
      ctx.fillStyle = 'rgba(220, 38, 38, 0.9)';
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bannerX - 90, bannerY - 10, 180, 20, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8.5px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`САОЗ: ПАССИВНЫЙ ВПРЫСК (${s.saoz_flow_kg_s.toFixed(0)} кг/с)`, bannerX, bannerY + 3);
    }

    // 2. АРМАТУРА ГОСТ 2-ГО КОНТУРА: БРУ-К И БРУ-А
    const steamY = turby - 12;
    const sgSteamX = sgx + 35;

    // 2.1 БРУ-К (Сброс пара в конденсатор)
    const bruKX = sgSteamX + (turbx - 52 - sgSteamX) * 0.45;
    const bruKY = (steamY + condy - 20) / 2;

    // Труба сброса в конденсатор
    ctx.strokeStyle = s.bru_k_pct > 0 ? '#38bdf8' : '#334155';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(bruKX, steamY);
    ctx.lineTo(bruKX, condy - 20);
    ctx.lineTo(condx - 20, condy - 20);
    ctx.stroke();

    this.drawGostValve(bruKX, bruKY, 'control', s.bru_k_pct > 0 ? 'open' : 'closed', 'БРУ-К', `${s.bru_k_pct.toFixed(0)}%`, true);

    // 2.2 БРУ-А (Сброс пара в атмосферу)
    const bruAX = sgSteamX + (turbx - 52 - sgSteamX) * 0.18;
    const bruAY = steamY - 26;

    // Труба сброса в атмосферу с диффузором
    ctx.strokeStyle = s.bru_a_pct > 0 ? '#f8fafc' : '#334155';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(bruAX, steamY);
    ctx.lineTo(bruAX, 12);
    ctx.stroke();

    // Диффузор сброса пара в атмосферу (раструб)
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(bruAX - 3, 12);
    ctx.lineTo(bruAX - 8, 4);
    ctx.lineTo(bruAX + 8, 4);
    ctx.lineTo(bruAX + 3, 12);
    ctx.closePath();
    ctx.fill();

    this.drawGostValve(bruAX, bruAY, 'control', s.bru_a_pct > 0 ? 'open' : 'closed', 'БРУ-А', `${s.bru_a_pct.toFixed(0)}%`, true);

    if (s.bru_a_pct > 0) {
      // Клубы пара в атмосферу
      ctx.fillStyle = 'rgba(248, 250, 252, 0.7)';
      for (let p = 0; p < 3; p++) {
        ctx.beginPath();
        ctx.arc(bruAX - 4 + p * 4, 2 - p * 3, 3 + p * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2.3 ИПУ КД (Импульсно-предохранительные устройства компенсатора давления)
    const ipuX = pzx;
    const ipuY = pzy - 65 - 28;
    this.drawGostValve(ipuX, ipuY, 'safety', 'closed', 'ИПУ КД', '17.5 МПа');

    // 2.4 Обратный клапан на линии питательной воды
    const feedY = condy + 12;
    const feedCornerX = sgx + sgw * 0.42;
    const feedCheckY = (sgy + sgh / 2 + feedY) / 2;
    this.drawGostValve(feedCornerX, feedCheckY, 'check', 'open', 'ОК ПВ', null, true);

    // 3. МАТРИЦА 4-Х ПЕТЕЛЬ (ПГ-1..4, ГЦН-1..4)
    this.renderedRcps = [];
    const loopW = 82;
    const loopH = 48;
    const gap = 8;
    const totalLoopsW = 4 * loopW + 3 * gap;

    // Центрируем карточки в пролете между реактором и парогенератором с защитой от наложений
    const maxBarRight = Math.min(bruAX - 14, turbx - 52 - 14);
    const minBarLeft = rx - rw * 0.5 + 10;
    const centerLoopsX = (rx + sgSteamX) / 2;
    let barX = Math.round(centerLoopsX - totalLoopsW / 2);
    if (barX + totalLoopsW > maxBarRight) {
      barX = maxBarRight - totalLoopsW;
    }
    if (barX < minBarLeft) {
      barX = minBarLeft;
    }
    const barY = 14;

    for (let i = 0; i < 4; i++) {
      const lx = barX + i * (loopW + gap);
      const ly = barY;
      const isRunning = s.rcp_status ? s.rcp_status[i] : (i < s.rcp_active_count);

      // Сохраняем хитбокс для кликов
      this.renderedRcps.push({ index: i, x: lx + loopW / 2, y: ly + loopH / 2, w: loopW, h: loopH, r: 28 });

      // Карточка петли с глубоким промышленным градиентом
      const cardGrad = ctx.createLinearGradient(lx, ly, lx, ly + loopH);
      if (isRunning) {
        cardGrad.addColorStop(0, '#0a3325');
        cardGrad.addColorStop(1, '#041d15');
      } else {
        cardGrad.addColorStop(0, '#381313');
        cardGrad.addColorStop(1, '#1e0909');
      }
      ctx.fillStyle = cardGrad;
      ctx.strokeStyle = isRunning ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(lx, ly, loopW, loopH, 5);
      ctx.fill();
      ctx.stroke();

      // Заголовок петли
      ctx.fillStyle = isRunning ? '#a7f3d0' : '#fca5a5';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`П-${i + 1}: ПГ/ГЦН-${i + 1}`, lx + loopW / 2, ly + 15);

      // Хромированный ободок и линза СЛЦ сигнальной лампы статуса петли
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(lx + 15, ly + 26, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.fillStyle = isRunning ? '#10b981' : '#ef4444';
      ctx.beginPath();
      ctx.arc(lx + 15, ly + 26, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx + 14, ly + 25, 1, 0, Math.PI * 2);
      ctx.fill();

      // Статус
      ctx.fillStyle = isRunning ? '#6ee7b7' : '#f87171';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillText(isRunning ? 'РАБОТА' : 'ОТКЛ', lx + loopW / 2 + 5, ly + 29);

      // Расход теплоносителя петли (с защитой от NaN)
      const totalFlow = (s.flow_1k_kg_s != null) ? s.flow_1k_kg_s : 18800;
      const activeCount = Math.max(1, s.rcp_active_count || 4);
      const loopFlow = isRunning ? (totalFlow / activeCount).toFixed(0) : '0';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Consolas, monospace';
      ctx.fillText(`${loopFlow} кг/с`, lx + loopW / 2, ly + 42);
    }

    ctx.restore();
  }

  /**
   * Картограмма активной зоны ВВЭР-1000: 163 гексагональные ТВС, запас до кипения и теплофизика
   */
  drawCoreCrossSection(w, h, s) {
    const ctx = this.ctx;
    ctx.save();

    // 0. Фоновая сетка
    this.drawBackgroundGrid(w, h);

    // Заголовок картограммы
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillStyle = (this.crtMode === 'p31') ? '#34d399' : '#38bdf8';
    ctx.textAlign = 'left';
    ctx.fillText('КАРТОГРАММА АКТИВНОЙ ЗОНЫ ВВЭР-1000 • 163 ТВС-2М (СУЗ: 61 КЛАСТЕР)', 28, 28);

    const coreX = w * 0.38;
    const coreY = h * 0.52;
    const maxR = Math.min(w * 0.33, h * 0.42);
    const hexR = maxR / 7.6;

    // 1. Корпус реактора (горизонтальный разрез по активной зоне)
    // 1.1 Внешняя обечайка из кованой стали 15Х2НМФА
    const rVessel = maxR * 1.18;
    const vesselGrad = ctx.createRadialGradient(coreX, coreY, maxR * 1.02, coreX, coreY, rVessel);
    vesselGrad.addColorStop(0, '#2d3b4b');
    vesselGrad.addColorStop(0.5, '#475569');
    vesselGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = vesselGrad;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(coreX, coreY, rVessel, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 1.2 Внутренняя антикоррозионная наплавка 08Х18Н10Т (8 мм)
    const rClad = maxR * 1.04;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(coreX, coreY, rClad, 0, Math.PI * 2);
    ctx.stroke();

    // 1.3 Опускной кольцевой коридор (downcomer) с охлаждающей водой
    const rDown = maxR * 0.96;
    ctx.fillStyle = (this.crtMode === 'p31') ? 'rgba(6, 78, 59, 0.4)' : 'rgba(14, 116, 144, 0.35)';
    ctx.beginPath();
    ctx.arc(coreX, coreY, rClad, 0, Math.PI * 2);
    ctx.arc(coreX, coreY, rDown, 0, Math.PI * 2, true);
    ctx.fill();

    // 1.4 Шахта реактора (08Х18Н10Т)
    const rBarrel = maxR * 0.90;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(coreX, coreY, rBarrel, 0, Math.PI * 2);
    ctx.stroke();

    // 1.5 Выгородка активной зоны (нейтронный тепловой экран)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(coreX, coreY, maxR * 0.88, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Отрисовка 163 гексагональных ТВС
    this.renderedAssemblies = [];
    const isP31 = (this.crtMode === 'p31');
    const isScrammed = (s.state === 'SCRAMMED');
    const pRel = Math.max(0.01, s.relative_power_pct / 100.0);
    const rodPos = Math.max(0, Math.min(1.0, s.rod_position_pct / 100.0));

    let selAsm = null;

    for (let i = 0; i < this.coreAssemblies.length; i++) {
      const asm = this.coreAssemblies[i];
      const cx = coreX + hexR * Math.sqrt(3) * (asm.q + asm.r * 0.5);
      const cy = coreY + hexR * 1.5 * asm.r;

      this.renderedAssemblies.push({
        id: asm.id,
        cx,
        cy,
        r: hexR,
        asm
      });

      if (asm.id === this.selectedAssemblyId) {
        selAsm = asm;
      }

      // Расчет локального Kq
      let kq = 1.25 * (1.0 - 0.42 * Math.pow(asm.rNorm, 1.8));
      if (asm.suzGroup === 10) {
        kq *= (0.35 + 0.65 * rodPos);
      } else if (isScrammed) {
        kq *= 0.05;
      }
      kq *= pRel;
      kq += ((asm.id * 17) % 7 - 3) * 0.012;

      // Цветовая шкала
      let fillColor;
      if (isP31) {
        const bright = Math.max(0.15, Math.min(1.0, kq / 1.3));
        fillColor = `rgba(16, 185, 129, ${bright * 0.85})`;
      } else if (isScrammed) {
        fillColor = 'rgba(127, 29, 29, 0.7)';
      } else {
        if (kq < 0.75) {
          fillColor = 'rgba(14, 165, 233, 0.8)';
        } else if (kq < 1.0) {
          fillColor = 'rgba(34, 197, 94, 0.8)';
        } else if (kq < 1.15) {
          fillColor = 'rgba(234, 179, 8, 0.85)';
        } else if (kq < 1.25) {
          fillColor = 'rgba(249, 115, 22, 0.85)';
        } else {
          fillColor = 'rgba(239, 68, 68, 0.9)';
        }
      }

      // Отрисовка гексагона
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = k * Math.PI / 3 - Math.PI / 6;
        const vx = cx + (hexR - 0.7) * Math.cos(angle);
        const vy = cy + (hexR - 0.7) * Math.sin(angle);
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();

      ctx.strokeStyle = isP31 ? '#042f2e' : '#1e293b';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Орган СУЗ (маркер кластера)
      if (asm.suzGroup > 0) {
        ctx.fillStyle = (asm.suzGroup === 10) ? '#f59e0b' : '#f8fafc';
        ctx.beginPath();
        ctx.arc(cx, cy - hexR * 0.38, (asm.suzGroup === 10) ? 2.8 : 2.0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Номер ТВС
      if (hexR >= 9) {
        ctx.font = 'bold ' + Math.max(7, Math.floor(hexR * 0.42)) + 'px Consolas, monospace';
        ctx.fillStyle = isP31 ? '#ecfdf5' : '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(asm.id, cx, cy + Math.floor(hexR * 0.18));
      }

      // Подсветка при наведении или выборе
      if (asm.id === this.selectedAssemblyId) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.8;
        ctx.stroke();
      } else if (asm.id === this.hoveredAssemblyId) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }
    }

    if (!selAsm && this.coreAssemblies.length > 0) {
      selAsm = this.coreAssemblies[81];
    }

    // 3. ПРАВАЯ ИНЖЕНЕРНАЯ ПАНЕЛЬ ТЕЛЕМЕТРИИ
    const hudX = Math.round(w * 0.71);
    const hudW = Math.round(w - hudX - 16);
    const hudY = 24;
    const hudH = Math.round(h - 48);

    ctx.fillStyle = '#0a0f16';
    ctx.strokeStyle = '#2d3b4b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, hudH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isP31 ? '#34d399' : '#38bdf8';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ТЕПЛОФИЗИКА И БЕЗОПАСНОСТЬ', hudX + 14, hudY + 22);

    let curY = hudY + 44;

    // Запас до кипения (Subcooling margin)
    const tSat = (typeof s.t_sat_1k_c === 'number') ? s.t_sat_1k_c : (179.9 * Math.pow(Math.max(0.1, s.pressure_1k_mpa), 0.239));
    const subcool = (typeof s.subcooling_margin_c === 'number') ? s.subcooling_margin_c : Math.max(0, tSat - s.t_hot_c);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText('ЗАПАС ДО КИПЕНИЯ (ΔTsubcool = Tsat - Tгор):', hudX + 14, curY);
    curY += 18;

    let subcoolColor = '#22c55e';
    let subcoolStatus = 'НОРМА (> 10°C)';
    if (subcool < 4.0) {
      subcoolColor = '#ef4444';
      subcoolStatus = 'АВАРИЯ: КИПЕНИЕ В АЗ! АЗ-5';
    } else if (subcool < 10.0) {
      subcoolColor = '#f59e0b';
      subcoolStatus = 'ВНИМАНИЕ: МАЛЫЙ ЗАПАС';
    }

    ctx.fillStyle = subcoolColor;
    ctx.font = 'bold 16px Consolas, monospace';
    ctx.fillText(`${subcool.toFixed(1)} °C`, hudX + 14, curY);

    ctx.font = 'bold 9.5px Consolas, monospace';
    ctx.fillText(`[${subcoolStatus}]`, hudX + 90, curY - 2);
    curY += 16;

    ctx.fillStyle = '#64748b';
    ctx.font = '8.5px Consolas, monospace';
    ctx.fillText(`Tsat(P1 = ${s.pressure_1k_mpa.toFixed(2)} МПа) = ${tSat.toFixed(1)}°C | Tгор = ${s.t_hot_c.toFixed(1)}°C`, hudX + 14, curY);
    curY += 24;

    // Концентрация бора
    const boronPpm = (typeof s.boron_ppm === 'number') ? s.boron_ppm : 550.0;
    const boronG = boronPpm * 0.00571;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText('КОНЦЕНТРАЦИЯ БОРА (C_B):', hudX + 14, curY);
    curY += 16;

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillText(`${boronPpm.toFixed(0)} ppm`, hudX + 14, curY);
    ctx.font = '9px Consolas, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`(${boronG.toFixed(2)} г/дм³ H3BO3)`, hudX + 95, curY);
    curY += 24;

    // Коэффициенты неравномерности
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText('НЕРАВНОМЕРНОСТЬ НЕЙТРОННОГО ПОЛЯ (Kq):', hudX + 14, curY);
    curY += 15;

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText(`Kq_max = 1.31 (доп. 1.35) | Kr = 1.18`, hudX + 14, curY);
    curY += 13;
    ctx.fillText(`Kv_max = 1.54 (доп. 1.65) | РГ (Гр.10): ${s.rod_position_pct.toFixed(1)}%`, hudX + 14, curY);
    curY += 16;

    // Цветовая шкала тепловыделения Kq
    const barW = Math.max(80, hudW - 28);
    const segW = barW / 5.0;
    const kqColors = ['#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444'];
    const kqLabels = ['<0.75', '0.75', '1.00', '1.15', '>1.25'];
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = kqColors[c];
      ctx.fillRect(hudX + 14 + c * segW, curY, segW - 1, 5);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '7px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(kqLabels[c], hudX + 14 + c * segW, curY + 12);
    }
    curY += 20;

    // САОЗ статус
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText('САОЗ (ГИДРОЕМКОСТИ 1..4):', hudX + 14, curY);
    curY += 15;

    if (s.saoz_active || s.pressure_1k_mpa < 6.0) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillText(`АКТИВНЫЙ ВПРЫСК: G = ${s.saoz_flow_kg_s.toFixed(0)} кг/с`, hudX + 14, curY);
      curY += 13;
      ctx.fillStyle = '#fca5a5';
      ctx.font = '8.5px Consolas, monospace';
      ctx.fillText(`Впрыск бора 2800 ppm при P1 < 6.0 МПа`, hudX + 14, curY);
    } else {
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 9.5px Consolas, monospace';
      ctx.fillText('ДЕЖУРНЫЙ РЕЖИМ (P_N2 = 6.0 МПа, 4x60 м³)', hudX + 14, curY);
      curY += 13;
      ctx.fillStyle = '#64748b';
      ctx.font = '8.5px Consolas, monospace';
      ctx.fillText('Обратные клапаны закрыты давлением 1К', hudX + 14, curY);
    }
    curY += 24;

    // Выбранная ТВС
    if (selAsm) {
      ctx.strokeStyle = '#38485c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hudX + 10, curY);
      ctx.lineTo(hudX + hudW - 10, curY);
      ctx.stroke();
      curY += 14;

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillText(`ИНСПЕКЦИЯ: ТВС-2М №${selAsm.id}`, hudX + 14, curY);
      curY += 16;

      let selKq = 1.25 * (1.0 - 0.42 * Math.pow(selAsm.rNorm, 1.8));
      if (selAsm.suzGroup === 10) selKq *= (0.35 + 0.65 * rodPos);
      else if (isScrammed) selKq *= 0.05;
      selKq *= pRel;
      selKq += ((selAsm.id * 17) % 7 - 3) * 0.012;

      const tOut = s.t_cold_c + (s.t_hot_c - s.t_cold_c) * selKq * pRel;

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '9px Consolas, monospace';
      ctx.fillText(`Координаты: [q=${selAsm.q}, r=${selAsm.r}]`, hudX + 14, curY);
      curY += 14;
      ctx.fillText(`Коэфф. мощности Kq: ${selKq.toFixed(2)}`, hudX + 14, curY);
      curY += 14;
      ctx.fillText(`T теплоносителя на выходе: ${tOut.toFixed(1)}°C`, hudX + 14, curY);
      curY += 14;
      ctx.fillText(`Обогащение: ${selAsm.enrichment}% U-235`, hudX + 14, curY);
      curY += 14;
      ctx.fillText(`Выгорание: ${selAsm.burnup} МВт·сут/кгU`, hudX + 14, curY);
      curY += 14;

      let suzDesc = 'Отсутствует';
      if (selAsm.suzGroup === 10) suzDesc = 'Группа 10 (Рабочая группа СУЗ)';
      else if (selAsm.suzGroup > 0) suzDesc = `Группа ${selAsm.suzGroup} (Аварийная защита АЗ)`;
      ctx.fillText(`Орган СУЗ: ${suzDesc}`, hudX + 14, curY);
    }

    ctx.restore();
  }

  /**
   * Растровые строки кинескопа ЭЛТ в режиме люминофора P31
   */
  drawCrtScanlines(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 30, 10, 0.10)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }

  handleClick(e) {
    if (!this.canvas || !this.width || !this.height) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.viewMode === 'core') {
      // Поиск кликнутой ТВС среди 163 сборок
      if (this.renderedAssemblies && this.renderedAssemblies.length > 0) {
        for (let i = 0; i < this.renderedAssemblies.length; i++) {
          const asm = this.renderedAssemblies[i];
          const d = Math.hypot(x - asm.cx, y - asm.cy);
          if (d <= asm.r) {
            this.selectedAssemblyId = asm.id;
            if (window.plantAudio) window.plantAudio.playSwitchClick();
            return;
          }
        }
      }
      return;
    }

    // Режим Schematic
    // 1. Проверяем клики по 4 ГЦН на панели петли
    if (this.renderedRcps && this.renderedRcps.length > 0) {
      for (let i = 0; i < this.renderedRcps.length; i++) {
        const rcp = this.renderedRcps[i];
        const halfW = (rcp.w || 82) / 2;
        const halfH = (rcp.h || 48) / 2;
        const inRect = Math.abs(x - rcp.x) <= halfW && Math.abs(y - rcp.y) <= halfH;
        if (inRect || Math.hypot(x - rcp.x, y - rcp.y) < (rcp.r || 28)) {
          if (window.scadaApp) {
            if (window.plantAudio) window.plantAudio.playPmoRotate();
            window.scadaApp.sendControl('toggle_rcp', rcp.index);
          }
          return;
        }
      }
    }

    const rx = this.width * 0.18;
    const ry = this.height * 0.50;
    const rw = Math.max(140, Math.min(220, this.width * 0.15));
    const rh = Math.max(300, Math.min(480, this.height * 0.68));

    const sgx = this.width * 0.56;
    const sgw = Math.max(140, Math.min(210, this.width * 0.17));

    const turbx = this.width * 0.81;
    const turby = this.height * 0.32;

    const gcnX = (rx + rw * 0.5 + sgx - sgw * 0.25) / 2 + 25;
    const gcnY = ry + rh * 0.16;
    const gpzX = (sgx + 10 + turbx - 52) / 2;

    // Клик по ГЦН-1 переключает насос 1
    if (Math.hypot(x - gcnX, y - gcnY) < 28) {
      if (window.scadaApp) {
        if (window.plantAudio) window.plantAudio.playPmoRotate();
        window.scadaApp.sendControl('toggle_rcp', 0);
      }
      return;
    }

    // Клик по турбине или ГПЗ переключает стопорный клапан турбины
    if (Math.hypot(x - turbx, y - turby) < 38 || Math.hypot(x - gpzX, y - turby + 12) < 22) {
      if (window.scadaApp) {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        const isOpen = (this.state && typeof this.state.turbine_rpm === 'number') ? this.state.turbine_rpm > 100 : true;
        window.scadaApp.sendControl(isOpen ? 'turbine_trip' : 'turbine_reset');
      }
      return;
    }
  }

  handleMouseMove(e) {
    if (!this.canvas || !this.width || !this.height) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.viewMode === 'core') {
      let found = null;
      if (this.renderedAssemblies && this.renderedAssemblies.length > 0) {
        for (let i = 0; i < this.renderedAssemblies.length; i++) {
          const asm = this.renderedAssemblies[i];
          if (Math.hypot(x - asm.cx, y - asm.cy) <= asm.r) {
            found = asm.id;
            break;
          }
        }
      }
      this.hoveredAssemblyId = found;
      if (this.canvas.style) {
        this.canvas.style.cursor = found ? 'pointer' : 'default';
      }
      return;
    }

    // Режим Schematic: интерактивный курсор при наведении на карточки петель или агрегаты
    let isHovering = false;
    if (this.renderedRcps && this.renderedRcps.length > 0) {
      for (let i = 0; i < this.renderedRcps.length; i++) {
        const rcp = this.renderedRcps[i];
        const halfW = (rcp.w || 82) / 2;
        const halfH = (rcp.h || 48) / 2;
        if (Math.abs(x - rcp.x) <= halfW && Math.abs(y - rcp.y) <= halfH) {
          isHovering = true;
          break;
        }
      }
    }

    if (!isHovering) {
      const rx = this.width * 0.18;
      const ry = this.height * 0.50;
      const rw = Math.max(140, Math.min(220, this.width * 0.15));
      const rh = Math.max(300, Math.min(480, this.height * 0.68));
      const sgx = this.width * 0.56;
      const sgw = Math.max(140, Math.min(210, this.width * 0.17));
      const turbx = this.width * 0.81;
      const turby = this.height * 0.32;
      const gcnX = (rx + rw * 0.5 + sgx - sgw * 0.25) / 2 + 25;
      const gcnY = ry + rh * 0.16;
      const gpzX = (sgx + 10 + turbx - 52) / 2;
      if (Math.hypot(x - gcnX, y - gcnY) < 28 ||
          Math.hypot(x - turbx, y - turby) < 38 ||
          Math.hypot(x - gpzX, y - turby + 12) < 22) {
        isHovering = true;
      }
    }

    if (this.canvas.style) {
      this.canvas.style.cursor = isHovering ? 'pointer' : 'default';
    }
  }
}
