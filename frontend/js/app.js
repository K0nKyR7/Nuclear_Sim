/**
 * Экономический движок ядерного тайкуна / кликера АЭС ВВЭР-1000
 * Моделирует выработку электроэнергии, торговлю на оптовом рынке ОРЭМ,
 * модернизацию реакторного отделения, строительство модулей АЭС,
 * наем персонала, систему Турбо-Буста (/boost) и инвестиционный престиж Росатома.
 */
class PlantTycoon {
  constructor(app) {
    this.app = app;
    this.money = 500000.0;
    this.totalEarned = 500000.0;
    this.storedEnergyMWh = 0.0;
    this.maxEnergyStorageMWh = 50.0;
    this.marketPriceMWh = 4500.0;
    this.marketTrend = 1;
    this.marketTimer = 0.0;
    this.autoSellGrid = true;
    this.boostCharge = 0.0;
    this.boostActive = false;
    this.boostTimer = 0.0;
    this.boostDuration = 15.0;
    this.boostMultiplier = 3.0;
    this.clickCount = 0;
    this.prestigeLevel = 0;
    this.prestigeBonusPct = 0.0;
    this.currentSubtab = 'reactor';
    this.autoClickAccumulator = 0.0;
    this.saveAccumulator = 0.0;
    this.currentNetIncomePerSec = 0.0;

    // 1. Прокачка реактора (Upgrades)
    this.upgrades = {
      fuel_enrichment: {
        id: 'fuel_enrichment',
        name: 'Обогащение топлива U-235',
        desc: '+20% к выработке и силе клика',
        icon: '⚛️',
        level: 1,
        maxLevel: 15,
        baseCost: 150000,
        costMult: 1.55
      },
      gcn_pumps: {
        id: 'gcn_pumps',
        name: 'Модернизация ГЦН-195М',
        desc: '+15% к расходу 1К и надежности',
        icon: '🔄',
        level: 1,
        maxLevel: 15,
        baseCost: 220000,
        costMult: 1.5
      },
      steam_generators: {
        id: 'steam_generators',
        name: 'Парогенераторы ПГВ-1500',
        desc: '+25% к паропроизводительности 2К',
        icon: '💨',
        level: 1,
        maxLevel: 15,
        baseCost: 350000,
        costMult: 1.6
      },
      turbine_generator: {
        id: 'turbine_generator',
        name: 'Турбогенератор ТВВ-1200',
        desc: '+30% к электрическому КПД генератора',
        icon: '⚡',
        level: 1,
        maxLevel: 15,
        baseCost: 500000,
        costMult: 1.65
      },
      suz_automation: {
        id: 'suz_automation',
        name: 'Цифровой АСУ СУЗ «Скала-3»',
        desc: '+1 автоклик в секунду за уровень',
        icon: '🎛️',
        level: 0,
        maxLevel: 10,
        baseCost: 400000,
        costMult: 1.7
      },
      pz_stabilizer: {
        id: 'pz_stabilizer',
        name: 'Компенсатор давления КД-1600',
        desc: 'Стабилизация давления, защита от аварий',
        icon: '🛡️',
        level: 1,
        maxLevel: 10,
        baseCost: 280000,
        costMult: 1.5
      },
      tolerant_fuel: {
        id: 'tolerant_fuel',
        name: 'Толерантное ATF-топливо',
        desc: '+50% к стоимости продажи энергии',
        icon: '🧪',
        level: 0,
        maxLevel: 5,
        baseCost: 1500000,
        costMult: 2.2
      }
    };

    // 2. Модули АЭС (Modules)
    this.modules = {
      district_heating: {
        id: 'district_heating',
        name: 'Теплофикация моногорода (ТЭЦ)',
        desc: 'Пассивный доход от теплофикации жилых массивов',
        icon: '🏙️',
        count: 0,
        maxCount: 10,
        baseCost: 300000,
        costMult: 1.65,
        incomePerSec: 18000
      },
      data_center: {
        id: 'data_center',
        name: 'Дата-центр и майнинг «Росатом-ЦОД»',
        desc: 'Потребление чистой энергии по спецтарифу',
        icon: '🖥️',
        count: 0,
        maxCount: 8,
        baseCost: 900000,
        costMult: 1.75,
        incomePerSec: 65000
      },
      hydrogen_plant: {
        id: 'hydrogen_plant',
        name: 'Электролизный водородный комплекс',
        desc: 'Экспорт чистого водорода H2 для металлургов',
        icon: '💧',
        count: 0,
        maxCount: 6,
        baseCost: 2800000,
        costMult: 1.9,
        incomePerSec: 220000
      },
      spent_fuel_reproc: {
        id: 'spent_fuel_reproc',
        name: 'Комплекс переработки ОЯТ (ЗЯТЦ)',
        desc: 'Замкнутый топливный цикл и федеральные субсидии',
        icon: '♻️',
        count: 0,
        maxCount: 4,
        baseCost: 8000000,
        costMult: 2.1,
        incomePerSec: 750000
      },
      supercomputer_lab: {
        id: 'supercomputer_lab',
        name: 'НИИ Атомного моделирования R&D',
        desc: '+20% ко всей выработке станции',
        icon: '🔬',
        count: 0,
        maxCount: 3,
        baseCost: 22000000,
        costMult: 2.4,
        incomePerSec: 1800000
      },
      unit_two: {
        id: 'unit_two',
        name: 'Энергоблок №2 ВВЭР-1200',
        desc: 'Мегапроект: удваивает мощность и дает колоссальный доход!',
        icon: '🏭',
        count: 0,
        maxCount: 1,
        baseCost: 65000000,
        costMult: 1.0,
        incomePerSec: 5000000
      }
    };

    // 3. Персонал и кадры (Staff)
    this.staff = {
      operators: {
        id: 'operators',
        name: 'Операторы БЩУ (ВИУР / ВИУТ)',
        desc: '+20 000 ₽ к силе клика за человека',
        icon: '👨‍💼',
        count: 1,
        maxCount: 50,
        baseCost: 50000,
        costMult: 1.3,
        salaryPerSec: 300
      },
      safety_physicists: {
        id: 'safety_physicists',
        name: 'Инженеры-физики отдела ОЯБ',
        desc: 'Ускоряют зарядку Турбо-Буста на +15%',
        icon: '👨‍🔬',
        count: 1,
        maxCount: 30,
        baseCost: 90000,
        costMult: 1.35,
        salaryPerSec: 500
      },
      maintenance_crew: {
        id: 'maintenance_crew',
        name: 'Слесари цеха ЦТАИ',
        desc: 'Снижают износ оборудования и расходы на ремонт',
        icon: '🔧',
        count: 1,
        maxCount: 40,
        baseCost: 70000,
        costMult: 1.3,
        salaryPerSec: 400
      },
      market_traders: {
        id: 'market_traders',
        name: 'Трейдеры оптового рынка ОРЭМ',
        desc: '+5% к биржевому тарифу продажи энергии',
        icon: '📊',
        count: 0,
        maxCount: 20,
        baseCost: 180000,
        costMult: 1.4,
        salaryPerSec: 1200
      },
      chief_engineer: {
        id: 'chief_engineer',
        name: 'Главный инженер станции (ГИС)',
        desc: '+30% к суммарной эффективности энергоблока',
        icon: '🎖️',
        count: 0,
        maxCount: 1,
        baseCost: 6000000,
        costMult: 1.0,
        salaryPerSec: 18000
      }
    };

    this.loadState();
    this.initDomBindings();
    this.startLoop();
  }

  formatMoney(num) {
    if (typeof num !== 'number' || isNaN(num)) return '0 ₽';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + ' Млрд ₽';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + ' Млн ₽';
    return Math.floor(num).toLocaleString('ru-RU') + ' ₽';
  }

  getItemCost(item) {
    const current = (item.level !== undefined) ? item.level : item.count;
    return Math.round(item.baseCost * Math.pow(item.costMult, current));
  }

  handleManualClick(clientX, clientY) {
    this.clickCount++;
    const fuelBonus = (this.upgrades.fuel_enrichment.level - 1) * 0.20;
    const operatorBonus = this.staff.operators.count * 0.20;
    const atfBonus = this.upgrades.tolerant_fuel.level * 0.50;
    const gisIncentive = this.staff.chief_engineer.count ? 0.30 : 0.0;
    const prestigeMult = 1.0 + (this.prestigeBonusPct / 100.0);
    const boostMult = this.boostActive ? this.boostMultiplier : 1.0;

    const basePulse = 50000.0;
    const clickGain = basePulse * (1.0 + fuelBonus + operatorBonus + atfBonus + gisIncentive) * prestigeMult * boostMult;

    this.money += clickGain;
    this.totalEarned += clickGain;

    // Зарядка буста кликами
    const chargePerClick = 2.5 * (1.0 + this.staff.safety_physicists.count * 0.15);
    if (!this.boostActive) {
      this.boostCharge = Math.min(100.0, this.boostCharge + chargePerClick);
    }

    // Резервирование энергии
    if (this.storedEnergyMWh < this.maxEnergyStorageMWh) {
      this.storedEnergyMWh = Math.min(this.maxEnergyStorageMWh, this.storedEnergyMWh + 0.15);
    }

    if (window.plantAudio) {
      if (typeof window.plantAudio.playClickPulse === 'function') window.plantAudio.playClickPulse();
      if (typeof window.plantAudio.playCashChime === 'function') window.plantAudio.playCashChime();
    }

    this.createFloatingText(`+${this.formatMoney(clickGain)}`, clientX, clientY);
    this.updateUI();
  }

  createFloatingText(text, x, y) {
    if (typeof document === 'undefined' || !document.createElement || !document.body) return;
    try {
      const existing = document.querySelectorAll('.tycoon-floating-text');
      if (existing.length >= 16 && existing[0].parentNode) {
        existing[0].parentNode.removeChild(existing[0]);
      }

      const floater = document.createElement('div');
      floater.className = 'tycoon-floating-text';
      floater.textContent = text;
      const posX = (typeof x === 'number' && x > 0) ? x : ((typeof window !== 'undefined' ? window.innerWidth : 800) / 2);
      const posY = (typeof y === 'number' && y > 0) ? y : ((typeof window !== 'undefined' ? window.innerHeight : 600) / 2);
      floater.style.left = `${posX}px`;
      floater.style.top = `${posY}px`;
      document.body.appendChild(floater);
      setTimeout(() => {
        if (floater.parentNode) floater.parentNode.removeChild(floater);
      }, 1000);
    } catch (e) {}
  }

  activateBoost(force = false) {
    if (this.boostActive) return '⚡ Турбо-Буст уже активен!';
    if (!force && this.boostCharge < 100.0) return 'Турбо-Буст еще не заряжен (нужно 100%)';

    this.boostActive = true;
    this.boostTimer = this.boostDuration;
    this.boostCharge = 0.0;

    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('turbo-boost-active');
    }

    if (window.plantAudio && typeof window.plantAudio.playBoostActivate === 'function') {
      window.plantAudio.playBoostActivate();
    }

    if (this.app && typeof this.app.sendControl === 'function') {
      this.app.sendControl('tycoon_boost', true);
    }

    this.createFloatingText('⚡ ТУРБО-БУСТ (3.0x)!', typeof window !== 'undefined' ? window.innerWidth / 2 : 500, 200);
    this.updateUI();
    return '⚡ ТУРБО-БУСТ АКТИВИРОВАН!';
  }

  triggerBoost() {
    return this.activateBoost(true);
  }

  executeCommand(rawCmd) {
    if (!rawCmd || typeof rawCmd !== 'string') return '';
    const cmd = rawCmd.trim().toLowerCase();
    const cmdInput = document.getElementById('tycoonCmdInput');
    if (cmdInput) cmdInput.value = '';

    if (cmd === '/boost' || cmd === 'boost' || cmd === '/b' || cmd === 'turbo' || cmd === '/turbo') {
      const res = this.activateBoost(true);
      this.createFloatingText('⚡ /BOOST: ТУРБО-РЕЖИМ ВКЛЮЧЕН!', typeof window !== 'undefined' ? window.innerWidth / 2 : 500, 180);
      return res;
    } else if (cmd === '/money' || cmd === 'money' || cmd === '/cash') {
      const grant = 1000000.0;
      this.money += grant;
      this.totalEarned += grant;
      if (window.plantAudio && typeof window.plantAudio.playCashChime === 'function') {
        window.plantAudio.playCashChime();
      }
      this.createFloatingText(`+${this.formatMoney(grant)} (Субсидия Минэнерго)`, typeof window !== 'undefined' ? window.innerWidth / 2 : 500, 220);
      this.updateUI();
      return `💰 Начислена субсидия: +${this.formatMoney(grant)}`;
    } else if (cmd === '/sell' || cmd === 'sell') {
      this.sellBattery();
      return '🔋 Батареи разряжены на биржу!';
    } else if (cmd === '/prestige' || cmd === 'prestige') {
      this.claimPrestige();
      return '🏛️ Федеральный грант Росатома запрошен!';
    } else if (cmd === '/click' || cmd === 'click') {
      this.handleManualClick();
      return '⚡ Импульс мощности выполнен!';
    } else if (cmd === '/help' || cmd === 'help' || cmd === '/?') {
      alert('Доступные команды Tycoon:\n/boost - мгновенная активация Турбо-Буста (3.0x)\n/money - получить федеральную субсидию 1 000 000 ₽\n/sell - сбросить энергию батарей на биржу ОРЭМ\n/prestige - инвестиционный грант Росатома\n/click - импульс выработки реактора');
      return 'Доступные команды: /boost, /money, /sell, /prestige, /click, /help';
    } else {
      this.createFloatingText(`Неизвестная команда: ${rawCmd}`, typeof window !== 'undefined' ? window.innerWidth / 2 : 500, 250);
      return `Неизвестная команда: ${rawCmd}. Введите /boost или /help`;
    }
  }

  startLoop() {
    if (typeof setInterval === 'undefined') return;
    setInterval(() => {
      this.tick(0.1);
    }, 100);
  }

  onTelemetry(data) {
    if (data && typeof data.electric_power_mw === 'number') {
      this.lastElectricMw = data.electric_power_mw;
    }
  }

  tick(dt) {
    // 1. Управление таймером буста
    if (this.boostActive) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boostActive = false;
        this.boostTimer = 0;
        if (typeof document !== 'undefined' && document.body) {
          document.body.classList.remove('turbo-boost-active');
        }
        if (this.app && typeof this.app.sendControl === 'function') {
          this.app.sendControl('tycoon_boost', false);
        }
      }
    }

    // 2. Колебания рыночного тарифа ОРЭМ
    this.marketTimer += dt;
    if (this.marketTimer >= 15.0) {
      this.marketTimer = 0.0;
      this.marketTrend = Math.random() > 0.48 ? 1 : -1;
      const delta = (Math.random() * 600.0 - 250.0) * this.marketTrend;
      this.marketPriceMWh = Math.max(3200.0, Math.min(7800.0, this.marketPriceMWh + delta));
    }

    // 3. Выработка электроэнергии реактором
    let elMw = (this.lastElectricMw !== undefined) ? this.lastElectricMw : 1000.0;
    const turbineMult = 1.0 + (this.upgrades.turbine_generator.level - 1) * 0.03;
    const fuelMult = 1.0 + (this.upgrades.fuel_enrichment.level - 1) * 0.20;
    const sgMult = 1.0 + (this.upgrades.steam_generators.level - 1) * 0.15;
    const unitTwoMult = 1.0 + (this.modules.unit_two.count * 1.0);
    const effectiveMw = elMw * turbineMult * fuelMult * sgMult * unitTwoMult;

    const energyGeneratedMWh = (effectiveMw * (dt / 3600.0));
    const boostMult = this.boostActive ? this.boostMultiplier : 1.0;
    const prestigeMult = 1.0 + (this.prestigeBonusPct / 100.0);
    const traderBonus = 1.0 + (this.staff.market_traders.count * 0.05);
    const atfBonus = 1.0 + (this.upgrades.tolerant_fuel.level * 0.15);
    const effectiveTariff = this.marketPriceMWh * traderBonus * atfBonus;

    let grossIncomeTick = 0.0;

    if (this.autoSellGrid) {
      const gridRevenue = energyGeneratedMWh * effectiveTariff * prestigeMult * boostMult;
      grossIncomeTick += gridRevenue;
      this.money += gridRevenue;
      this.totalEarned += gridRevenue;
    } else {
      this.storedEnergyMWh = Math.min(this.maxEnergyStorageMWh, this.storedEnergyMWh + energyGeneratedMWh);
    }

    // 4. Пассивный доход модулей
    let moduleIncomeTick = 0.0;
    Object.values(this.modules).forEach(m => {
      moduleIncomeTick += (m.count * m.incomePerSec * dt);
    });
    const rAndDMult = 1.0 + (this.modules.supercomputer_lab.count * 0.20);
    moduleIncomeTick = moduleIncomeTick * rAndDMult * prestigeMult * boostMult;
    grossIncomeTick += moduleIncomeTick;
    this.money += moduleIncomeTick;
    this.totalEarned += moduleIncomeTick;

    // 5. Расходы на зарплату персонала
    let salaryTick = 0.0;
    Object.values(this.staff).forEach(s => {
      salaryTick += (s.count * s.salaryPerSec * dt);
    });
    this.money = Math.max(0.0, this.money - salaryTick);

    this.currentNetIncomePerSec = Math.round((grossIncomeTick - salaryTick) / dt);

    // 6. Автоклик АСУ СУЗ «Скала-3»
    if (this.upgrades.suz_automation.level > 0) {
      this.autoClickAccumulator += dt;
      if (this.autoClickAccumulator >= 1.0) {
        this.autoClickAccumulator = 0.0;
        const autoCount = this.upgrades.suz_automation.level;
        const autoGain = 20000.0 * autoCount * prestigeMult * boostMult;
        this.money += autoGain;
        this.totalEarned += autoGain;
        if (!this.boostActive) {
          this.boostCharge = Math.min(100.0, this.boostCharge + 0.5 * autoCount);
        }
      }
    }

    // 7. Медленная пассивная зарядка буста на номинале
    if (elMw >= 900.0 && !this.boostActive) {
      this.boostCharge = Math.min(100.0, this.boostCharge + 0.25 * dt);
    }

    // 8. Автосохранение
    this.saveAccumulator += dt;
    if (this.saveAccumulator >= 3.0) {
      this.saveAccumulator = 0.0;
      this.saveState();
    }

    this.updateUI();
  }

  buyUpgrade(key) {
    const item = this.upgrades[key];
    if (!item || item.level >= item.maxLevel) return;
    const cost = this.getItemCost(item);
    if (this.money < cost) return;

    this.money -= cost;
    item.level++;

    if (window.plantAudio && typeof window.plantAudio.playUpgradePurchased === 'function') {
      window.plantAudio.playUpgradePurchased();
    }

    if (this.app && typeof this.app.sendControl === 'function') {
      this.app.sendControl('tycoon_upgrade', { upgrade: key, level: item.level });
    }

    this.saveState();
    this.renderSubtab();
    this.updateUI();
  }

  buyModule(key) {
    const item = this.modules[key];
    if (!item || item.count >= item.maxCount) return;
    const cost = this.getItemCost(item);
    if (this.money < cost) return;

    this.money -= cost;
    item.count++;

    if (window.plantAudio && typeof window.plantAudio.playUpgradePurchased === 'function') {
      window.plantAudio.playUpgradePurchased();
    }

    this.saveState();
    this.renderSubtab();
    this.updateUI();
  }

  hireStaff(key) {
    const item = this.staff[key];
    if (!item || item.count >= item.maxCount) return;
    const cost = this.getItemCost(item);
    if (this.money < cost) return;

    this.money -= cost;
    item.count++;

    if (window.plantAudio && typeof window.plantAudio.playUpgradePurchased === 'function') {
      window.plantAudio.playUpgradePurchased();
    }

    this.saveState();
    this.renderSubtab();
    this.updateUI();
  }

  sellBattery() {
    if (this.storedEnergyMWh <= 0.05) return;
    const traderBonus = 1.0 + (this.staff.market_traders.count * 0.05);
    const atfBonus = 1.0 + (this.upgrades.tolerant_fuel.level * 0.15);
    const tariff = this.marketPriceMWh * traderBonus * atfBonus;
    const boostMult = this.boostActive ? this.boostMultiplier : 1.0;
    const prestigeMult = 1.0 + (this.prestigeBonusPct / 100.0);

    const revenue = this.storedEnergyMWh * tariff * prestigeMult * boostMult;
    this.money += revenue;
    this.totalEarned += revenue;
    const soldMWh = this.storedEnergyMWh;
    this.storedEnergyMWh = 0.0;

    if (window.plantAudio && typeof window.plantAudio.playCashChime === 'function') {
      window.plantAudio.playCashChime();
    }

    const midX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
    const midY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400;
    this.createFloatingText(`+${this.formatMoney(revenue)} (${soldMWh.toFixed(1)} МВт·ч)`, midX, midY);
    this.updateUI();
  }

  claimPrestige() {
    const req = 10000000.0;
    if (this.money < req && this.totalEarned < req) return;

    this.prestigeLevel++;
    this.prestigeBonusPct += 50.0;
    this.money = 500000.0;
    this.storedEnergyMWh = 0.0;
    this.boostCharge = 0.0;
    this.boostActive = false;

    Object.keys(this.upgrades).forEach(k => {
      this.upgrades[k].level = (k === 'suz_automation' || k === 'tolerant_fuel') ? 0 : 1;
    });
    Object.keys(this.modules).forEach(k => {
      this.modules[k].count = 0;
    });
    Object.keys(this.staff).forEach(k => {
      this.staff[k].count = (k === 'market_traders' || k === 'chief_engineer') ? 0 : 1;
    });

    if (window.plantAudio && typeof window.plantAudio.playTriumphFanfare === 'function') {
      window.plantAudio.playTriumphFanfare();
    }

    this.saveState();
    this.renderSubtab();
    this.updateUI();
  }

  saveState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = {
        money: this.money,
        totalEarned: this.totalEarned,
        storedEnergyMWh: this.storedEnergyMWh,
        autoSellGrid: this.autoSellGrid,
        prestigeLevel: this.prestigeLevel,
        prestigeBonusPct: this.prestigeBonusPct,
        upgrades: {},
        modules: {},
        staff: {},
        savedAt: Date.now()
      };
      Object.keys(this.upgrades).forEach(k => { data.upgrades[k] = this.upgrades[k].level; });
      Object.keys(this.modules).forEach(k => { data.modules[k] = this.modules[k].count; });
      Object.keys(this.staff).forEach(k => { data.staff[k] = this.staff[k].count; });
      localStorage.setItem('nuce_tycoon_save_v1', JSON.stringify(data));
    } catch (e) {}
  }

  loadState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('nuce_tycoon_save_v1');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.money === 'number') this.money = data.money;
      if (typeof data.totalEarned === 'number') this.totalEarned = data.totalEarned;
      if (typeof data.storedEnergyMWh === 'number') this.storedEnergyMWh = data.storedEnergyMWh;
      if (typeof data.autoSellGrid === 'boolean') this.autoSellGrid = data.autoSellGrid;
      if (typeof data.prestigeLevel === 'number') this.prestigeLevel = data.prestigeLevel;
      if (typeof data.prestigeBonusPct === 'number') this.prestigeBonusPct = data.prestigeBonusPct;

      if (data.upgrades) {
        Object.keys(data.upgrades).forEach(k => {
          if (this.upgrades[k] && typeof data.upgrades[k] === 'number') {
            this.upgrades[k].level = data.upgrades[k];
          }
        });
      }
      if (data.modules) {
        Object.keys(data.modules).forEach(k => {
          if (this.modules[k] && typeof data.modules[k] === 'number') {
            this.modules[k].count = data.modules[k];
          }
        });
      }
      if (data.staff) {
        Object.keys(data.staff).forEach(k => {
          if (this.staff[k] && typeof data.staff[k] === 'number') {
            this.staff[k].count = data.staff[k];
          }
        });
      }

      if (data.savedAt) {
        const elapsedSec = Math.min(8 * 3600, Math.max(0, (Date.now() - data.savedAt) / 1000));
        if (elapsedSec > 10) {
          let passiveSec = 0;
          Object.values(this.modules).forEach(m => { passiveSec += m.count * m.incomePerSec; });
          Object.values(this.staff).forEach(s => { passiveSec -= s.count * s.salaryPerSec; });
          if (this.autoSellGrid !== false) {
            passiveSec += (1000.0 / 3600.0) * this.marketPriceMWh * 0.5;
          }
          if (passiveSec > 0) {
            const offlineEarnings = passiveSec * elapsedSec * (1.0 + this.prestigeBonusPct / 100.0);
            this.money += offlineEarnings;
            this.totalEarned += offlineEarnings;
            console.log(`[Tycoon] Зачислено за время отсутствия (${Math.round(elapsedSec)} с): +${this.formatMoney(offlineEarnings)}`);
            setTimeout(() => {
              this.createFloatingText(`🏆 За время отсутствия: +${this.formatMoney(offlineEarnings)}`, typeof window !== 'undefined' ? window.innerWidth / 2 : 500, 160);
            }, 1200);
          }
        }
      }
    } catch (e) {}

    if (typeof window !== 'undefined' && window.location) {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      if (search.includes('boost') || hash.includes('boost')) {
        setTimeout(() => {
          this.activateBoost(true);
        }, 500);
      }
    }
  }

  initDomBindings() {
    if (typeof document === 'undefined' || !document.getElementById) return;

    const btnClick = document.getElementById('btnTycoonClick');
    if (btnClick) {
      btnClick.addEventListener('click', (e) => {
        this.handleManualClick(e.clientX, e.clientY);
      });
    }

    const btnBoost = document.getElementById('btnActivateBoost');
    if (btnBoost) {
      btnBoost.addEventListener('click', () => {
        this.activateBoost();
      });
    }

    const btnHeaderBoost = document.getElementById('btnHeaderBoost');
    if (btnHeaderBoost) {
      btnHeaderBoost.addEventListener('click', () => {
        this.activateBoost(this.boostCharge >= 100.0);
      });
    }

    const cmdInput = document.getElementById('tycoonCmdInput');
    const cmdBtn = document.getElementById('btnTycoonCmdExec');
    if (cmdInput && cmdBtn) {
      const runCmd = () => {
        const val = cmdInput.value;
        if (val) this.executeCommand(val);
      };
      cmdBtn.addEventListener('click', runCmd);
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runCmd();
        }
      });
    }

    const btnSellBat = document.getElementById('btnSellBattery');
    if (btnSellBat) {
      btnSellBat.addEventListener('click', () => {
        this.sellBattery();
      });
    }

    const btnAuto = document.getElementById('btnToggleAutoSell');
    if (btnAuto) {
      btnAuto.addEventListener('click', () => {
        this.autoSellGrid = !this.autoSellGrid;
        this.updateUI();
      });
    }

    const btnPrestige = document.getElementById('btnTycoonPrestige');
    if (btnPrestige) {
      btnPrestige.addEventListener('click', () => {
        this.claimPrestige();
      });
    }

    // Подвкладки
    const subtabs = [
      { btnId: 'tycoonSubtabReactor', listId: 'tycoonReactorList', tab: 'reactor' },
      { btnId: 'tycoonSubtabModules', listId: 'tycoonModulesList', tab: 'modules' },
      { btnId: 'tycoonSubtabStaff', listId: 'tycoonStaffList', tab: 'staff' },
      { btnId: 'tycoonSubtabMarket', listId: 'tycoonMarketList', tab: 'market' }
    ];

    subtabs.forEach(st => {
      const b = document.getElementById(st.btnId);
      if (b) {
        b.addEventListener('click', () => {
          if (window.plantAudio && typeof window.plantAudio.playSwitchClick === 'function') {
            window.plantAudio.playSwitchClick();
          }
          subtabs.forEach(x => {
            const elBtn = document.getElementById(x.btnId);
            const elList = document.getElementById(x.listId);
            if (elBtn) elBtn.classList.remove('active');
            if (elList) elList.style.display = 'none';
          });
          b.classList.add('active');
          const activeList = document.getElementById(st.listId);
          if (activeList) activeList.style.display = (st.tab === 'market') ? 'block' : 'flex';
          this.currentSubtab = st.tab;
          this.renderSubtab();
        });
      }
    });

    // Делегирование кликов покупки
    const bindBuyList = (listId, buyFn) => {
      const el = document.getElementById(listId);
      if (!el) return;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-buy-key]');
        if (btn) {
          const key = btn.getAttribute('data-buy-key');
          if (key) buyFn(key);
        }
      });
    };

    bindBuyList('tycoonReactorList', (k) => this.buyUpgrade(k));
    bindBuyList('tycoonModulesList', (k) => this.buyModule(k));
    bindBuyList('tycoonStaffList', (k) => this.hireStaff(k));

    this.renderSubtab();
    this.updateUI();
  }

  renderSubtab() {
    if (typeof document === 'undefined') return;

    if (this.currentSubtab === 'reactor') {
      const container = document.getElementById('tycoonReactorList');
      if (!container) return;
      container.innerHTML = Object.values(this.upgrades).map(u => {
        const cost = this.getItemCost(u);
        const isMax = u.level >= u.maxLevel;
        return `
          <div class="tycoon-item-card">
            <div class="item-card-left">
              <div class="item-card-icon">${u.icon}</div>
              <div class="item-card-details">
                <div class="item-card-title-row">
                  <span class="item-card-title">${u.name}</span>
                  <span class="item-card-level-badge">УР. ${u.level}/${u.maxLevel}</span>
                </div>
                <span class="item-card-desc">${u.desc}</span>
              </div>
            </div>
            <button class="item-card-buy-btn" data-buy-key="${u.id}" ${isMax || this.money < cost ? 'disabled' : ''}>
              <span>${isMax ? 'МАКСИМУМ' : 'УЛУЧШИТЬ'}</span>
              ${isMax ? '' : `<span class="buy-btn-price">${this.formatMoney(cost)}</span>`}
            </button>
          </div>
        `;
      }).join('');
    } else if (this.currentSubtab === 'modules') {
      const container = document.getElementById('tycoonModulesList');
      if (!container) return;
      container.innerHTML = Object.values(this.modules).map(m => {
        const cost = this.getItemCost(m);
        const isMax = m.count >= m.maxCount;
        return `
          <div class="tycoon-item-card">
            <div class="item-card-left">
              <div class="item-card-icon">${m.icon}</div>
              <div class="item-card-details">
                <div class="item-card-title-row">
                  <span class="item-card-title">${m.name}</span>
                  <span class="item-card-level-badge">ПОСТРОЕНО: ${m.count}/${m.maxCount}</span>
                </div>
                <span class="item-card-desc">${m.desc}</span>
                <span class="item-card-bonus">+${this.formatMoney(m.incomePerSec)}/с за объект</span>
              </div>
            </div>
            <button class="item-card-buy-btn" data-buy-key="${m.id}" ${isMax || this.money < cost ? 'disabled' : ''}>
              <span>${isMax ? 'ПОСТРОЕНО' : 'ПОСТРОИТЬ'}</span>
              ${isMax ? '' : `<span class="buy-btn-price">${this.formatMoney(cost)}</span>`}
            </button>
          </div>
        `;
      }).join('');
    } else if (this.currentSubtab === 'staff') {
      const container = document.getElementById('tycoonStaffList');
      if (!container) return;
      container.innerHTML = Object.values(this.staff).map(s => {
        const cost = this.getItemCost(s);
        const isMax = s.count >= s.maxCount;
        return `
          <div class="tycoon-item-card">
            <div class="item-card-left">
              <div class="item-card-icon">${s.icon}</div>
              <div class="item-card-details">
                <div class="item-card-title-row">
                  <span class="item-card-title">${s.name}</span>
                  <span class="item-card-level-badge">ШТАТ: ${s.count}/${s.maxCount}</span>
                </div>
                <span class="item-card-desc">${s.desc}</span>
                <span class="item-card-bonus">Зарплата: ${this.formatMoney(s.salaryPerSec)}/с</span>
              </div>
            </div>
            <button class="item-card-buy-btn" data-buy-key="${s.id}" ${isMax || this.money < cost ? 'disabled' : ''}>
              <span>${isMax ? 'ШТАТ ПОЛОН' : 'НАНЯТЬ'}</span>
              ${isMax ? '' : `<span class="buy-btn-price">${this.formatMoney(cost)}</span>`}
            </button>
          </div>
        `;
      }).join('');
    }
  }

  updateUI() {
    if (typeof document === 'undefined' || !document.getElementById) return;

    // Баланс и доход в шапке
    const elMoney = document.getElementById('tycoonMoney');
    if (elMoney) elMoney.textContent = this.formatMoney(this.money);

    const elIncome = document.getElementById('tycoonIncome');
    if (elIncome) {
      const sign = this.currentNetIncomePerSec >= 0 ? '+' : '';
      elIncome.textContent = `${sign}${this.formatMoney(this.currentNetIncomePerSec)}/с`;
    }

    // Тариф ОРЭМ
    const elTariff = document.getElementById('marketTariffVal');
    if (elTariff) elTariff.textContent = `${Math.round(this.marketPriceMWh).toLocaleString('ru-RU')} ₽/МВт·ч`;

    const elTrend = document.getElementById('marketTrendIcon');
    if (elTrend) {
      elTrend.textContent = this.marketTrend > 0 ? '▲' : '▼';
      elTrend.className = this.marketTrend > 0 ? 'market-trend-up' : 'market-trend-down';
    }

    // Буст бар и кнопки
    const elBoostFill = document.getElementById('boostMeterFill');
    if (elBoostFill && elBoostFill.style) {
      const pct = Math.min(100, Math.max(0, Math.round(this.boostCharge)));
      elBoostFill.style.width = `${pct}%`;
      elBoostFill.className = (pct >= 100 || this.boostActive) ? 'boost-meter-fill full' : 'boost-meter-fill';
    }

    const elBoostText = document.getElementById('boostMeterText');
    if (elBoostText) {
      if (this.boostActive) {
        elBoostText.textContent = `🔥 ТУРБО-БУСТ АКТИВЕН! ОСТАЛОСЬ ${Math.ceil(this.boostTimer)} СЕК (3.0x)`;
      } else if (this.boostCharge >= 100.0) {
        elBoostText.textContent = `⚡ ТУРБО-БУСТ ГОТОВ! НАЖМИТЕ ДЛЯ ЗАПУСКА`;
      } else {
        elBoostText.textContent = `ТУРБО-БУСТ: ${Math.round(this.boostCharge)}% [ЗАРЯДКА КЛИКАМИ]`;
      }
    }

    const elBtnBoost = document.getElementById('btnActivateBoost');
    if (elBtnBoost) {
      if (this.boostActive) {
        elBtnBoost.className = 'btn-activate-boost active';
      } else if (this.boostCharge >= 100.0) {
        elBtnBoost.className = 'btn-activate-boost ready';
      } else {
        elBtnBoost.className = 'btn-activate-boost';
      }
    }

    const elHeaderBoost = document.getElementById('btnHeaderBoost');
    const elHeaderBoostLbl = document.getElementById('boostBtnLabel');
    if (elHeaderBoost) {
      if (this.boostActive) {
        elHeaderBoost.className = 'btn-ctrl btn-boost-header active';
        if (elHeaderBoostLbl) elHeaderBoostLbl.textContent = `🔥 БУСТ ${Math.ceil(this.boostTimer)}с`;
      } else if (this.boostCharge >= 100.0) {
        elHeaderBoost.className = 'btn-ctrl btn-boost-header ready';
        if (elHeaderBoostLbl) elHeaderBoostLbl.textContent = `⚡ БУСТ 100%`;
      } else {
        elHeaderBoost.className = 'btn-ctrl btn-boost-header';
        if (elHeaderBoostLbl) elHeaderBoostLbl.textContent = `⚡ БУСТ ${Math.round(this.boostCharge)}%`;
      }
    }

    // Батарея
    const elBat = document.getElementById('batteryStorageVal');
    if (elBat) {
      elBat.textContent = `${this.storedEnergyMWh.toFixed(1)} / ${this.maxEnergyStorageMWh.toFixed(1)} МВт·ч`;
    }

    const elAuto = document.getElementById('autoSellStatus');
    if (elAuto) {
      elAuto.textContent = `АВТОПРОДАЖА: ${this.autoSellGrid ? 'ВКЛ' : 'ВЫКЛ'}`;
    }
    const btnAuto = document.getElementById('btnToggleAutoSell');
    if (btnAuto) {
      btnAuto.className = this.autoSellGrid ? 'btn-toggle-autosell active' : 'btn-toggle-autosell';
    }

    // Престиж
    const elPrestBonus = document.getElementById('prestigeBonusVal');
    if (elPrestBonus) elPrestBonus.textContent = `+${this.prestigeBonusPct}%`;

    const elPrestReq = document.getElementById('prestigeReqVal');
    if (elPrestReq) elPrestReq.textContent = `10 000 000 ₽`;

    const btnPrestige = document.getElementById('btnTycoonPrestige');
    if (btnPrestige) {
      btnPrestige.disabled = (this.money < 10000000.0 && this.totalEarned < 10000000.0);
    }

    // Обновление состояния доступности кнопок покупки в активной подвкладке
    const activeListId = this.currentSubtab === 'reactor' ? 'tycoonReactorList'
      : (this.currentSubtab === 'modules' ? 'tycoonModulesList' : (this.currentSubtab === 'staff' ? 'tycoonStaffList' : null));
    if (activeListId) {
      const container = document.getElementById(activeListId);
      if (container && typeof container.querySelectorAll === 'function') {
        const buttons = container.querySelectorAll('[data-buy-key]');
        buttons.forEach(btn => {
          const key = btn.getAttribute('data-buy-key');
          const item = this.upgrades[key] || this.modules[key] || this.staff[key];
          if (item) {
            const cost = this.getItemCost(item);
            const current = (item.level !== undefined) ? item.level : item.count;
            const isMax = current >= (item.maxLevel || item.maxCount);
            btn.disabled = isMax || (this.money < cost);
          }
        });
      }
    }
  }
}

// Глобальная поддержка команды /boost в консоли браузера
if (typeof window !== 'undefined') {
  window.boost = function() {
    if (window.scadaApp && window.scadaApp.tycoon) {
      return window.scadaApp.tycoon.activateBoost(true);
    }
    return 'SCADA App не инициализирован';
  };
  window['/boost'] = window.boost;
  window['turbo'] = window.boost;
}

/**
 * Главный контроллер SCADA-интерфейса энергоблока АЭС ВВЭР-1000
 * Управление пультом оператора, телеметрией, стрелочными приборами,
 * поворотными переключателями ПМО, светосигнальным табло и акустикой.
 */
class ScadaApp {
  constructor() {
    this.ws = null;
    this.telemetry = null;
    this.previousState = null;
    this.previousAlarmCount = 0;
    this.previousExplosion = false;
    this.previousRupture = false;
    this.lampTestActive = false;
    this.mimic = new PlantMimic('mimicCanvas');
    this.chart = new TelemetryChart('trendCanvas');
    this.activeTab = 'controls';

    this.isGameOver = false;
    this.shatteredGlassEl = null;
    this.gameOverModalEl = null;
    this.btnRestartGame = null;

    this.tycoon = new PlantTycoon(this);

    this.fetchInitialState();
    this.initWebSocket();
    this.initEventListeners();
    this.startAnimationLoop();
  }

  async fetchInitialState() {
    try {
      const resp = await fetch('/api/state');
      if (resp.ok) {
        const data = await resp.json();
        if (!this.telemetry) {
          this.onTelemetryReceived(data);
        }
      }
    } catch (e) {
      console.warn('[SCADA] Предварительная загрузка телеметрии недоступна:', e);
    }
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[SCADA] Канал связи телеметрии подключен (ONLINE)');
      const badge = document.getElementById('connStatus');
      if (badge) {
        badge.textContent = 'ONLINE';
        badge.className = 'status-badge on';
      }
      if (this.tycoon && this.tycoon.upgrades) {
        Object.entries(this.tycoon.upgrades).forEach(([k, u]) => {
          if (u.level > 1) {
            this.sendControl('tycoon_upgrade', { upgrade: k, level: u.level });
          }
        });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onTelemetryReceived(data);
      } catch (e) {
        console.error('Ошибка разбора пакета телеметрии:', e);
      }
    };

    this.ws.onclose = () => {
      console.warn('[SCADA] Потеря связи с сервером. Автоповтор через 2 сек...');
      const badge = document.getElementById('connStatus');
      if (badge) {
        badge.textContent = 'OFFLINE';
        badge.className = 'status-badge off';
      }
      setTimeout(() => this.initWebSocket(), 2000);
    };
  }

  send(data) {
    if (this.isGameOver && data.type !== 'reset') {
      if (window.plantAudio) window.plantAudio.playShortCircuitSpark();
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendControl(command, value = null) {
    this.send({ type: 'control', command, value });
  }

  sendScenario(id, active) {
    this.send({ type: 'scenario', id, active });
  }

  onTelemetryReceived(data) {
    if (!data || typeof data !== 'object') return;
    if (this.tycoon) this.tycoon.onTelemetry(data);

    // Звуковая реакция на изменение состояния энергоблока
    try {
      if (window.plantAudio) {
        const isEmergency = ['SCRAMMED', 'ACCIDENT', 'EXPLOSION', 'MELTDOWN'].includes(data.state) || Boolean(data.nuclear_detonation || data.explosion_type === 'nuclear');
        const prevEmergency = ['SCRAMMED', 'ACCIDENT', 'EXPLOSION', 'MELTDOWN'].includes(this.previousState) || Boolean(this.previousNuclearDetonation);

        if (data.state === 'SCRAMMED' && this.previousState !== 'SCRAMMED') {
          window.plantAudio.playAz5Slam();
          window.plantAudio.startSiren();
        } else if (isEmergency && !prevEmergency) {
          window.plantAudio.startSiren();
        } else if (!isEmergency && prevEmergency) {
          window.plantAudio.stopSiren();
        }

        // Звуковое оповещение и печать телетайпа при поступлении новых тревог
        const alarmCount = (data.alarms && data.alarms.length) || 0;
        if (alarmCount > this.previousAlarmCount) {
          window.plantAudio.playWarningChime();
          window.plantAudio.playMatrixPrinterChatter();
        }
        this.previousAlarmCount = alarmCount;

        // Взрыв оборудования / гидроудар / тепловой разгон / ядерный взрыв
        const isNuclear = Boolean(data.nuclear_detonation || data.explosion_type === 'nuclear');
        if (isNuclear && !this.isGameOver) {
          this.triggerNuclearCatastropheGameOver(data);
        } else if (data.explosion_active && !this.previousExplosion) {
          if (isNuclear) {
            this.triggerNuclearCatastropheGameOver(data);
          } else {
            window.plantAudio.playExplosionBlast();
            if (this.mimic) this.mimic.triggerScreenShake(1.0);
          }
        }
        this.previousNuclearDetonation = isNuclear;
        this.previousExplosion = Boolean(data.explosion_active);

        // Обработка регламентов смены и множественных финалов (INES 0..7)
        // Строгая валидация: запускается ТОЛЬКО если финал явно активирован и содержит валидные данные
        const hasValidFinale = Boolean(data.finale_triggered) && Boolean(data.finale_data) && typeof data.finale_data === 'object' && Object.keys(data.finale_data).length > 0;
        if (hasValidFinale && !this.isGameOver) {
          const ft = data.finale_type || data.finale_data.type;
          if (ft === 'PROMPT_CRITICAL' || isNuclear) {
            this.triggerNuclearCatastropheGameOver(data);
          } else {
            this.triggerShiftFinale(data.finale_data, data);
          }
        }

        // Непрерывный свист выброса пара при разгерметизации контуров
        const isRuptured = Boolean(data.primary_rupture || data.steam_pipe_ruptured);
        if (isRuptured && !this.previousRupture) {
          window.plantAudio.startSteamBlowout();
        } else if (!isRuptured && this.previousRupture) {
          window.plantAudio.stopSteamBlowout();
        }
        this.previousRupture = isRuptured;

        // Радиометрический контроль (треск счетчика Гейгера при радиации)
        if (typeof data.radiation_level_mr_h === 'number') {
          window.plantAudio.setRadiationLevel(data.radiation_level_mr_h);
        }

      }
    } catch (e) {
      console.warn('[SCADA Audio Error]', e);
    }
    this.previousState = data.state;

    this.telemetry = data;
    this.mimic.updateState(data);
    this.chart.pushPoint(data);
    try {
      this.updateDom(data);
    } catch (e) {
      console.error('[SCADA updateDom Error]', e);
    }
  }

  updateDom(t) {
    if (!t || typeof t !== 'object') return;
    const num = (v, def = 0) => (typeof v === 'number' && !isNaN(v)) ? v : def;

    // 1. Статус энергоблока в шапке
    const statusBadge = document.getElementById('plantStateBadge');
    if (statusBadge) {
      const textSpan = statusBadge.querySelector('.status-text') || statusBadge;
      if (t.state === 'SCRAMMED') {
        textSpan.textContent = 'АЗ-5 СРАБОТАЛА';
        statusBadge.className = 'header-status-badge scrammed';
      } else {
        textSpan.textContent = 'РАБОТА НА МОЩНОСТИ';
        statusBadge.className = 'header-status-badge';
      }
    }

    // Время симуляции
    const simTimeEl = document.getElementById('simTime');
    if (simTimeEl) simTimeEl.textContent = `${num(t.sim_time_s).toFixed(1)} с`;

    // Быстрые вакуумно-люминесцентные индикаторы
    const elNth = document.getElementById('m_nth');
    if (elNth) elNth.textContent = `${num(t.relative_power_pct, 100).toFixed(1)} % (${num(t.thermal_power_mw, 3000).toFixed(0)} МВт)`;

    const elNel = document.getElementById('m_nel');
    if (elNel) elNel.textContent = `${num(t.electric_power_mw, 1000).toFixed(0)} МВт`;

    const elPeriodNixie = document.getElementById('m_period');
    if (elPeriodNixie) {
      const pVal = num(t.period_s, 999.0);
      elPeriodNixie.textContent = (pVal > 999 || pVal <= 0) ? '∞ с' : `${pVal.toFixed(1)} с`;
      elPeriodNixie.className = (pVal > 0 && pVal < 10)
        ? 'metric-val nixie-text alarm'
        : ((pVal > 0 && pVal < 20) ? 'metric-val nixie-text warn' : 'metric-val nixie-text');
    }

    const p1Val = num(t.pressure_1k_mpa, 15.7);
    const elP1 = document.getElementById('m_p1');
    if (elP1) {
      elP1.textContent = `${p1Val.toFixed(2)} МПа`;
      elP1.className = (p1Val > 17.0 || p1Val < 14.5) ? 'metric-val vfd-text alarm' : 'metric-val vfd-text';
    }

    const p2Val = num(t.pressure_2k_mpa, 6.27);
    const elP2 = document.getElementById('m_p2');
    if (elP2) elP2.textContent = `${p2Val.toFixed(2)} МПа`;

    const elScore = document.getElementById('m_operator_score');
    if (elScore) {
      const sc = num(t.operator_score, 100);
      const gr = t.operator_grade || 'A+';
      elScore.textContent = `${sc.toFixed(0)}% [${gr}]`;
      elScore.className = sc >= 85 ? 'metric-val vfd-text score-text' : (sc >= 60 ? 'metric-val vfd-text warn' : 'metric-val vfd-text alarm');
    }

    // 1b. Параметры сменного задания и регламента
    const shiftTimeVal = document.getElementById('shiftTimerVal');
    if (shiftTimeVal) {
      const curS = Math.floor(num(t.shift_time_s, 0));
      const tgtS = Math.floor(num(t.shift_target_duration_s, 120));
      const curMStr = `${Math.floor(curS / 60).toString().padStart(2, '0')}:${(curS % 60).toString().padStart(2, '0')}`;
      const tgtMStr = `${Math.floor(tgtS / 60).toString().padStart(2, '0')}:${(tgtS % 60).toString().padStart(2, '0')}`;
      shiftTimeVal.textContent = `${curMStr} / ${tgtMStr}`;
    }

    const shiftScoreVal = document.getElementById('shiftScoreVal');
    if (shiftScoreVal) {
      shiftScoreVal.textContent = `${num(t.operator_score, 100).toFixed(1)}%`;
    }

    const shiftGradeBadge = document.getElementById('shiftGradeBadge');
    if (shiftGradeBadge) {
      const gr = (t.operator_grade || 'A+').toUpperCase();
      shiftGradeBadge.textContent = gr;
      const grLetter = gr.charAt(0).toLowerCase();
      shiftGradeBadge.className = `sm-grade grade-${grLetter}`;
    }

    const shiftEnergyVal = document.getElementById('shiftEnergyVal');
    if (shiftEnergyVal) {
      shiftEnergyVal.textContent = `${num(t.total_energy_mwh, 0).toFixed(1)} МВт·ч`;
    }

    const shiftViolationsVal = document.getElementById('shiftViolationsVal');
    if (shiftViolationsVal) {
      shiftViolationsVal.textContent = `${num(t.violations_count, 0)}`;
    }

    const shiftSelect = document.getElementById('shiftMissionSelect');
    if (shiftSelect && document.activeElement !== shiftSelect && t.mission_id) {
      shiftSelect.value = t.mission_id;
    }

    ['m_btn_base', 'm_btn_maneuver', 'm_btn_cold', 'm_btn_loca', 'm_btn_sbo', 'm_btn_sandbox'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn && t.mission_id) {
        const mKey = btn.getAttribute('data-mission');
        btn.classList.toggle('active', mKey === t.mission_id);
      }
    });

    const objListEl = document.getElementById('shiftObjList');
    if (objListEl && Array.isArray(t.mission_objectives)) {
      const currentCompleted = new Set(
        t.mission_objectives.filter(o => o.done || o.status === 'completed').map(o => o.title)
      );
      if (this.lastCompletedObjectives) {
        for (const title of currentCompleted) {
          if (!this.lastCompletedObjectives.has(title)) {
            if (window.plantAudio && typeof window.plantAudio.playObjectiveDing === 'function') {
              window.plantAudio.playObjectiveDing();
            }
            break;
          }
        }
      }
      this.lastCompletedObjectives = currentCompleted;

      const stateKey = `${t.mission_id}_${t.mission_objectives.map(o => o.status).join(',')}`;
      if (this.lastObjStateKey !== stateKey) {
        this.lastObjStateKey = stateKey;
        objListEl.innerHTML = t.mission_objectives.map(o => {
          const icon = o.status === 'completed' ? '✓' : (o.status === 'failed' ? '✗' : '○');
          return `<li class="obj-item ${o.status || 'pending'}"><span class="obj-status-icon">${icon}</span> <span>${o.title}</span></li>`;
        }).join('');
      }
    }

    // 2. Аналоговые стрелочные приборы (ОБМ-160 ГОСТ 8625)
    const needleP1 = document.getElementById('needleP1');
    if (needleP1) {
      // 0..20 МПа -> -120° .. +120°
      const degP1 = -120 + (Math.max(0, Math.min(20, p1Val)) / 20.0) * 240;
      needleP1.style.transform = `rotate(${degP1.toFixed(1)}deg)`;
    }
    const valP1 = document.getElementById('gaugeP1_val');
    if (valP1) valP1.textContent = `P1 (${p1Val.toFixed(2)} МПа)`;

    const needleP2 = document.getElementById('needleP2');
    if (needleP2) {
      // 0..10 МПа -> -120° .. +120°
      const degP2 = -120 + (Math.max(0, Math.min(10, p2Val)) / 10.0) * 240;
      needleP2.style.transform = `rotate(${degP2.toFixed(1)}deg)`;
    }
    const valP2 = document.getElementById('gaugeP2_val');
    if (valP2) valP2.textContent = `P2 (${p2Val.toFixed(2)} МПа)`;

    // 2b. Детальные параметры технологического режима и запаса до закипания
    const tHotVal = num(t.t_hot_c, 320.0);
    const tColdVal = num(t.t_cold_c, 290.0);
    const subcoolVal = num(t.subcooling_margin_c, 25.8);
    const boronVal = num(t.boron_ppm, 500.0);
    const reactivityVal = num(t.reactivity_pcm, 0.0);
    const powerRelVal = num(t.relative_power_pct, 100.0);

    const elSubcool = document.getElementById('m_subcool');
    if (elSubcool) {
      elSubcool.textContent = `${subcoolVal.toFixed(1)} °C`;
      elSubcool.className = (subcoolVal < 10.0)
        ? 'metric-val vfd-text subcool-val alarm'
        : ((subcoolVal < 15.0) ? 'metric-val vfd-text subcool-val warn' : 'metric-val vfd-text subcool-val');
    }

    // Советские профильные приборы М1611 / М1690 с зеркальной полосой
    const m1690Pointer = document.getElementById('meter_m1690_pointer');
    if (m1690Pointer) {
      // 0..50 °C -> top 100% .. 0%
      const topPct = Math.max(0, Math.min(100, 100 - (subcoolVal / 50.0) * 100));
      m1690Pointer.style.top = `${topPct.toFixed(1)}%`;
    }
    const valM1690 = document.getElementById('val_m1690_subcool');
    if (valM1690) valM1690.textContent = `${subcoolVal.toFixed(1)} °C`;

    const m1611Pointer = document.getElementById('meter_m1611_pointer');
    if (m1611Pointer) {
      // -1000..+1000 pcm -> top 100% .. 0%
      const topRho = Math.max(0, Math.min(100, 100 - ((reactivityVal + 1000.0) / 2000.0) * 100));
      m1611Pointer.style.top = `${topRho.toFixed(1)}%`;
    }
    const valM1611 = document.getElementById('val_m1611_rho');
    if (valM1611) valM1611.textContent = `${reactivityVal.toFixed(0)} pcm`;

    const m1611PowerPointer = document.getElementById('meter_m1611_power_pointer');
    if (m1611PowerPointer) {
      // 0..120% -> top 100% .. 0%
      const topP = Math.max(0, Math.min(100, 100 - (powerRelVal / 120.0) * 100));
      m1611PowerPointer.style.top = `${topP.toFixed(1)}%`;
    }
    const valM1611Power = document.getElementById('val_m1611_power');
    if (valM1611Power) valM1611Power.textContent = `${powerRelVal.toFixed(1)} %`;

    const elTHot = document.getElementById('val_t_hot');
    if (elTHot) elTHot.textContent = `${tHotVal.toFixed(1)} °C`;

    const elTCold = document.getElementById('val_t_cold');
    if (elTCold) elTCold.textContent = `${tColdVal.toFixed(1)} °C`;

    const elDtCore = document.getElementById('val_dt_core');
    if (elDtCore) elDtCore.textContent = `${(tHotVal - tColdVal).toFixed(1)} °C`;

    const elValSubcool = document.getElementById('val_subcool');
    if (elValSubcool) elValSubcool.textContent = `${subcoolVal.toFixed(1)} °C`;

    const elValBoron = document.getElementById('val_boron');
    if (elValBoron) elValBoron.textContent = `${boronVal.toFixed(0)} ppm`;

    const elTFuel = document.getElementById('val_t_fuel');
    if (elTFuel) elTFuel.textContent = `${num(t.t_fuel_c, 680.0).toFixed(0)} °C`;

    const elFlow1k = document.getElementById('val_flow_1k');
    if (elFlow1k) elFlow1k.textContent = `${num(t.flow_1k_kg_s, 18800.0).toFixed(0)} кг/с`;

    const elPzLevel = document.getElementById('val_pz_level');
    if (elPzLevel) elPzLevel.textContent = `${num(t.pz_level_m, 7.2).toFixed(2)} м`;

    const elSgLevel = document.getElementById('val_sg_level');
    if (elSgLevel) elSgLevel.textContent = `${num(t.sg_level_m, 2.45).toFixed(2)} м`;

    const elSteamFlow = document.getElementById('val_steam_flow');
    if (elSteamFlow) elSteamFlow.textContent = `${num(t.steam_flow_kg_s, 1620.0).toFixed(0)} кг/с`;

    const elReactivity = document.getElementById('val_reactivity');
    if (elReactivity) elReactivity.textContent = `${reactivityVal.toFixed(0)} pcm`;

    const periodVal = num(t.period_s, 999.0);
    const elPeriod = document.getElementById('val_period');
    if (elPeriod) elPeriod.textContent = (periodVal > 999 || periodVal <= 0) ? '∞' : `${periodVal.toFixed(1)} с`;

    const elSaoz = document.getElementById('val_saoz');
    if (elSaoz) {
      elSaoz.textContent = t.saoz_active
        ? `ВПРЫСК (${num(t.saoz_flow_kg_s).toFixed(0)} кг/с)`
        : `ГОТОВ (${num(t.saoz_accum_level_pct, 100).toFixed(0)}%)`;
      elSaoz.style.color = t.saoz_active ? '#ef4444' : '#38bdf8';
    }

    const elBruK = document.getElementById('val_bru_k');
    if (elBruK) {
      const kPct = num(t.bru_k_pct, 0);
      elBruK.textContent = (kPct > 0.5) ? `ОТКРЫТ (${kPct.toFixed(0)}%)` : `ЗАКРЫТ (0%)`;
      elBruK.style.color = (kPct > 0.5) ? '#f59e0b' : '#94a3b8';
    }

    const elBruA = document.getElementById('val_bru_a');
    if (elBruA) {
      const aPct = num(t.bru_a_pct, 0);
      elBruA.textContent = (aPct > 0.5) ? `ОТКРЫТ (${aPct.toFixed(0)}%)` : `ЗАКРЫТ (0%)`;
      elBruA.style.color = (aPct > 0.5) ? '#ef4444' : '#94a3b8';
    }

    // 3. Положение ОР СУЗ
    const rodVal = num(t.rod_position_pct, 80.0);
    const rodPosVal = document.getElementById('rodPosVal');
    if (rodPosVal) rodPosVal.textContent = `${rodVal.toFixed(1)}%`;


    const rodFill = document.getElementById('rodGaugeFill');
    if (rodFill) rodFill.style.width = `${rodVal}%`;

    // 4. Поворотные ключи ПМО и сигнальные лампы ГЦН 1..4
    if (t.rcp_status) {
      for (let i = 0; i < 4; i++) {
        const on = t.rcp_status[i];

        // Поворот ручки-клювика ПМО
        const knob = document.getElementById(`pmo_knob_${i}`);
        if (knob) {
          knob.className = on ? 'pmo-knob knob-on' : 'pmo-knob knob-off';
          knob.style.transform = on ? 'rotate(45deg)' : 'rotate(-45deg)';
        }

        // Лампы включен/отключен
        const lampOn = document.getElementById(`lamp_on_${i}`);
        if (lampOn) {
          if (on) lampOn.classList.add('active');
          else lampOn.classList.remove('active');
        }

        const lampOff = document.getElementById(`lamp_off_${i}`);
        if (lampOff) {
          if (!on) lampOff.classList.add('active');
          else lampOff.classList.remove('active');
        }

        // Совместимость со скрытым badge
        const rcpBadge = document.getElementById(`rcp_badge_${i}`);
        if (rcpBadge) {
          rcpBadge.textContent = on ? 'ВКЛ' : 'ОТКЛ';
          rcpBadge.className = on ? 'status-badge on' : 'status-badge off';
        }
      }
    }

    // 4b. Автоматические регуляторы (АРМ, КД, ПЭН)
    if (t.auto_power !== undefined) {
      const armLever = document.getElementById('arm_lever');
      const armTagMan = document.getElementById('arm_tag_man');
      const armTagAuto = document.getElementById('arm_tag_auto');
      if (armLever) armLever.className = t.auto_power ? 'tumbler-lever active' : 'tumbler-lever';
      if (armTagAuto) armTagAuto.className = t.auto_power ? 'status-badge on toggle-tag active' : 'status-badge toggle-tag';
      if (armTagMan) armTagMan.className = t.auto_power ? 'toggle-tag' : 'status-badge on toggle-tag active';
    }

    if (t.pz_heaters_auto !== undefined) {
      const pzLever = document.getElementById('pz_lever');
      const pzTagMan = document.getElementById('pz_tag_man');
      const pzTagAuto = document.getElementById('pz_tag_auto');
      if (pzLever) pzLever.className = t.pz_heaters_auto ? 'tumbler-lever active' : 'tumbler-lever';
      if (pzTagAuto) pzTagAuto.className = t.pz_heaters_auto ? 'status-badge on toggle-tag active' : 'status-badge toggle-tag';
      if (pzTagMan) pzTagMan.className = t.pz_heaters_auto ? 'toggle-tag' : 'status-badge on toggle-tag active';
    }

    if (t.feedwater_pumps_on !== undefined) {
      const penOn = t.feedwater_pumps_on[0] || t.feedwater_pumps_on[1];
      const penLever = document.getElementById('pen_lever');
      const penTagMan = document.getElementById('pen_tag_man');
      const penTagAuto = document.getElementById('pen_tag_auto');
      if (penLever) penLever.className = penOn ? 'tumbler-lever active' : 'tumbler-lever';
      if (penTagAuto) penTagAuto.className = penOn ? 'status-badge on toggle-tag active' : 'status-badge toggle-tag';
      if (penTagMan) penTagMan.className = penOn ? 'toggle-tag' : 'status-badge on toggle-tag active';
    }

    if (t.containment_spray_active !== undefined) {
      const sprayLever = document.getElementById('spray_lever');
      const sprayTagMan = document.getElementById('spray_tag_man');
      const sprayTagAuto = document.getElementById('spray_tag_auto');
      if (sprayLever) sprayLever.className = t.containment_spray_active ? 'tumbler-lever active' : 'tumbler-lever';
      if (sprayTagAuto) sprayTagAuto.className = t.containment_spray_active ? 'status-badge on toggle-tag active' : 'status-badge toggle-tag';
      if (sprayTagMan) sprayTagMan.className = t.containment_spray_active ? 'toggle-tag' : 'status-badge on toggle-tag active';
    }

    if (t.emergency_boron_active !== undefined) {
      const eboronLever = document.getElementById('eboron_lever');
      const eboronTagMan = document.getElementById('eboron_tag_man');
      const eboronTagAuto = document.getElementById('eboron_tag_auto');
      if (eboronLever) eboronLever.className = t.emergency_boron_active ? 'tumbler-lever active' : 'tumbler-lever';
      if (eboronTagAuto) eboronTagAuto.className = t.emergency_boron_active ? 'status-badge on toggle-tag active' : 'status-badge toggle-tag';
      if (eboronTagMan) eboronTagMan.className = t.emergency_boron_active ? 'toggle-tag' : 'status-badge on toggle-tag active';
    }

    // 5. Светосигнальное табло сигнализаций (Annunciator Grid)
    if (!this.lampTestActive) {
      this.updateAnnunciator('ann_az5', t.state === 'SCRAMMED', true);
      this.updateAnnunciator('ann_overpower', t.relative_power_pct > 103, true);
      this.updateAnnunciator('ann_period', t.period_s > 0 && t.period_s < 20, true);
      this.updateAnnunciator('ann_p1_hi', t.pressure_1k_mpa > 16.5, true);
      this.updateAnnunciator('ann_sg_lo', t.sg_level_m < 2.0, false);
      this.updateAnnunciator('ann_rcp_trip', t.rcp_active_count < 4, false);
      this.updateAnnunciator('ann_grid_loss', t.active_scenarios && t.active_scenarios.grid_loss, true);
      this.updateAnnunciator('ann_leak_1k', t.active_scenarios && t.active_scenarios.loca_leak, true);
      this.updateAnnunciator('ann_subcool_lo', num(t.subcooling_margin_c, 25.8) < 10.0, true);
      this.updateAnnunciator('ann_saoz', Boolean(t.saoz_active), true);
      this.updateAnnunciator('ann_bru_k', num(t.bru_k_pct, 0) > 5.0, false);
      this.updateAnnunciator('ann_bru_a', num(t.bru_a_pct, 0) > 5.0, true);
      this.updateAnnunciator('ann_explosion', Boolean(t.explosion_active || t.state === 'EXPLOSION'), true);
      this.updateAnnunciator('ann_meltdown', Boolean(num(t.core_damage_pct, 0) > 25.0 || t.state === 'MELTDOWN'), true);
      this.updateAnnunciator('ann_radiation', Boolean(num(t.radiation_level_mr_h, 12) > 100.0), true);
      this.updateAnnunciator('ann_bypass', Boolean(t.safety_system_bypassed), true);
      this.updateAnnunciator('ann_spray', Boolean(t.containment_spray_active), false);
      this.updateAnnunciator('ann_cold_sd', t.state === 'COLD_SHUTDOWN', false);
      this.updateAnnunciator('ann_mission_ok', Boolean(t.finale_triggered && (t.finale_type === 'TRIUMPH_SHIFT' || t.finale_type === 'COLD_SHUTDOWN_SAFE' || t.finale_type === 'CRISIS_CONTAINED')), false);
    }


    // Журнал аварийных тревог
    this.renderAlarmList(t.alarms || []);

    // 6. Кнопки сценариев
    if (t.active_scenarios) {
      this.updateScenarioButton('sc_rcp1', t.active_scenarios.rcp1_trip);
      this.updateScenarioButton('sc_steam', t.active_scenarios.steam_break);
      this.updateScenarioButton('sc_loca', t.active_scenarios.loca_leak);
      this.updateScenarioButton('sc_stuck', t.active_scenarios.rod_stuck);
      this.updateScenarioButton('sc_grid', t.active_scenarios.grid_loss);
      this.updateScenarioButton('sc_nuclear', t.active_scenarios.nuclear_blast || t.nuclear_detonation);
      this.updateScenarioButton('sc_prompt', t.active_scenarios.prompt_critical);
      this.updateScenarioButton('sc_guillotine', t.active_scenarios.guillotine_loca);
      this.updateScenarioButton('sc_sbo', t.active_scenarios.station_blackout);
      this.updateScenarioButton('sc_meltdown', t.active_scenarios.core_meltdown);
      this.updateScenarioButton('sc_bypass', t.active_scenarios.bypass_safety);
    }
  }

  updateAnnunciator(id, active, isCrit) {
    const el = document.getElementById(id);
    if (!el) return;
    if (active) {
      el.className = isCrit ? 'annunciator-tile active-alarm' : 'annunciator-tile active-warn';
    } else {
      el.className = 'annunciator-tile';
    }
  }

  updateScenarioButton(id, active) {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (active) btn.classList.add('triggered');
    else btn.classList.remove('triggered');
  }

  renderAlarmList(alarms) {
    const tbody = document.getElementById('alarmTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    alarms.slice(0, 12).forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${a.time.toFixed(1)} с</td>
        <td><span class="alarm-tag ${a.level}">${a.level}</span></td>
        <td>${a.msg}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  initEventListeners() {
    this.setupGameOverHandlers();
    // Переключение режима люминофора ЭЛТ-монитора (Цвет SCADA / Монохром P-31)
    const btnPhosphor = document.getElementById('btnCrtPhosphor');
    const crtContainer = document.getElementById('mimicContainer');
    const crtPhosphorLabel = document.getElementById('crtPhosphorLabel');
    if (btnPhosphor && crtContainer) {
      btnPhosphor.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        const isP31 = crtContainer.classList.toggle('crt-p31');
        btnPhosphor.classList.toggle('active-p31', isP31);
        if (crtPhosphorLabel) {
          crtPhosphorLabel.textContent = isP31 ? 'ЭЛТ: P31 ЗЕЛЕНЫЙ' : 'ЭЛТ: ЦВЕТ';
        }
        if (this.mimic) this.mimic.crtMode = isP31 ? 'p31' : 'color';
      });
    }

    // Переключение видеокадра ЭЛТ (Схема 1К/2К 4 петли / Картограмма АЗ 163 ТВС)
    const btnCrtView = document.getElementById('btnCrtView');
    const crtViewLabel = document.getElementById('crtViewLabel');
    const crtViewIcon = btnCrtView ? btnCrtView.querySelector('.crt-view-icon') : null;
    if (btnCrtView) {
      btnCrtView.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        if (this.mimic) {
          const isCore = (this.mimic.viewMode === 'core');
          this.mimic.viewMode = isCore ? 'schematic' : 'core';
          btnCrtView.classList.toggle('active-core', !isCore);
          if (crtViewLabel) {
            crtViewLabel.textContent = isCore ? 'СХЕМА 1К/2К (4 ПЕТЛИ)' : 'КАРТОГРАММА АЗ (163 ТВС)';
          }
          if (crtViewIcon) {
            crtViewIcon.textContent = isCore ? '▦' : '⬡';
          }
        }
      });
    }


    // Управление масштабом (Zoom)
    const btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        if (this.mimic) {
          this.mimic.zoomIn();
          this.updateZoomLabel();
        }
      });
    }

    const btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        if (this.mimic) {
          this.mimic.zoomOut();
          this.updateZoomLabel();
        }
      });
    }

    const btnZoomReset = document.getElementById('btnZoomReset');
    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        if (this.mimic) {
          this.mimic.resetView();
          this.updateZoomLabel();
        }
      });
    }

    // Сброс всех аварийных вводных инструктора
    const btnClearScenarios = document.getElementById('btnClearScenarios');
    if (btnClearScenarios) {
      btnClearScenarios.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        document.querySelectorAll('.scenario-btn').forEach(btn => {
          btn.classList.remove('active');
          const scId = btn.id.replace('sc_', '');
          this.sendScenario(scId, false);
        });
      });
    }

    // Включение/выключение звука
    const btnSound = document.getElementById('btnSound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        if (window.plantAudio) {
          const muted = window.plantAudio.toggleMute();
          const cap = btnSound.querySelector('.btn-caption') || btnSound;
          cap.innerHTML = muted ? '🔇 БЕЗ ЗВУКА' : '🔊 ЗВУК';
          btnSound.className = muted ? 'btn-ctrl' : 'btn-ctrl active';
        }
      });
    }


    // Сброс звука сирены
    const btnSilence = document.getElementById('btnSilenceHorn');
    if (btnSilence) {
      btnSilence.addEventListener('click', () => {
        if (window.plantAudio) {
          window.plantAudio.stopSiren();
          window.plantAudio.playSwitchClick();
        }
      });
    }

    // Проверка ламп накаливания табло
    const btnTest = document.getElementById('btnTestLamps');
    if (btnTest) {
      btnTest.addEventListener('click', () => {
        if (window.plantAudio) {
          window.plantAudio.playSwitchClick();
          window.plantAudio.playWarningChime();
          window.plantAudio.playWarningGong();
        }
        this.lampTestActive = true;
        document.querySelectorAll('.annunciator-tile').forEach((tile, idx) => {
          tile.className = (idx % 2 === 0) ? 'annunciator-tile active-alarm' : 'annunciator-tile active-warn';
        });
        setTimeout(() => {
          this.lampTestActive = false;
        }, 2200);
      });
    }

    // Вкладки операторского пульта
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        const content = document.getElementById(`tab_${tabId}`);
        if (content) content.classList.add('active');

        if (tabId === 'trends') {
          setTimeout(() => this.chart.resize(), 60);
        }
        setTimeout(() => this.mimic.resize(), 60);
      });
    });

    // Откидная защитная крышка АЗ-5
    const cover = document.getElementById('az5Cover');
    if (cover) {
      cover.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = cover.classList.toggle('open');
        if (window.plantAudio) window.plantAudio.playAz5CoverFlip(isOpen);
      });
    }

    // Массивная красная грибовидная кнопка АЗ-5
    const btnAz5 = document.getElementById('btnAz5');
    if (btnAz5) {
      btnAz5.addEventListener('click', (e) => {
        const cover = document.getElementById('az5Cover');
        if (cover && !cover.classList.contains('open')) {
          // Если крышка закрыта, первый клик с щелчком откидывает защитную крышку
          e.stopPropagation();
          cover.classList.add('open');
          if (window.plantAudio) window.plantAudio.playAz5CoverFlip(true);
          return;
        }

        if (window.plantAudio) {
          window.plantAudio.playAz5Slam();
          window.plantAudio.startSiren();
        }
        this.sendControl('az5');
      });
    }

    // Управление стержнями СУЗ
    const rodUp = document.getElementById('rodUp');
    const rodStop = document.getElementById('rodStop');
    const rodDown = document.getElementById('rodDown');

    if (rodUp) rodUp.addEventListener('click', () => {
      if (window.plantAudio) window.plantAudio.playRodDriveSound();
      this.sendControl('set_rod_speed', 1.0);
    });
    if (rodStop) rodStop.addEventListener('click', () => {
      if (window.plantAudio) window.plantAudio.playSwitchClick();
      this.sendControl('set_rod_speed', 0.0);
    });
    if (rodDown) rodDown.addEventListener('click', () => {
      if (window.plantAudio) window.plantAudio.playRodDriveSound();
      this.sendControl('set_rod_speed', -1.0);
    });

    // Скорость времени симулятора
    document.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = parseFloat(btn.getAttribute('data-speed'));
        this.send({ type: 'speed', value: spd });
      });
    });

    // Пауза
    const btnPause = document.getElementById('btnPause');
    if (btnPause) {
      btnPause.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        const isPaused = btnPause.classList.toggle('active');
        const cap = btnPause.querySelector('.btn-caption') || btnPause;
        cap.innerHTML = isPaused ? '▶ ПУСК' : '⏸ ПАУЗА';
        this.send({ type: 'pause', value: isPaused });
      });
    }

    // Сброс
    const btnReset = document.getElementById('btnReset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Сбросить энергоблок к исходному состоянию 100% мощности?')) {
          if (window.plantAudio) {
            window.plantAudio.stopSiren();
            window.plantAudio.playSwitchClick();
          }
          this.send({ type: 'reset' });
          const cover = document.getElementById('az5Cover');
          if (cover) {
            cover.classList.remove('open');
          }
        }
      });
    }

    // Квитирование тревог
    const btnAck = document.getElementById('btnAckAlarms');
    if (btnAck) {
      btnAck.addEventListener('click', () => {
        if (window.plantAudio) {
          window.plantAudio.stopSiren();
          window.plantAudio.playSwitchClick();
        }
        this.send({ type: 'ack_alarms' });
      });
    }

    // Сценарии аварий
    const bindScenario = (btnId, scenarioKey) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          if (window.plantAudio) window.plantAudio.playSwitchClick();
          const isActive = this.telemetry && this.telemetry.active_scenarios && this.telemetry.active_scenarios[scenarioKey];
          this.sendScenario(scenarioKey, !isActive);
        });
      }
    };

    bindScenario('sc_rcp1', 'rcp1_trip');
    bindScenario('sc_steam', 'steam_break');
    bindScenario('sc_loca', 'loca_leak');
    bindScenario('sc_stuck', 'rod_stuck');
    bindScenario('sc_grid', 'grid_loss');
    bindScenario('sc_nuclear', 'nuclear_blast');
    bindScenario('sc_prompt', 'prompt_critical');
    bindScenario('sc_guillotine', 'guillotine_loca');
    bindScenario('sc_sbo', 'station_blackout');
    bindScenario('sc_meltdown', 'core_meltdown');
    bindScenario('sc_bypass', 'bypass_safety');

    // Кнопки борного регулирования
    const btnAddBoron = document.getElementById('btnAddBoron');
    if (btnAddBoron) {
      btnAddBoron.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('add_boron', 50);
      });
    }

    const btnDiluteBoron = document.getElementById('btnDiluteBoron');
    if (btnDiluteBoron) {
      btnDiluteBoron.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('dilute_boron', 50);
      });
    }

    // Тумблер аварийной блокировки АЗ-5
    const toggleSafetyBypass = document.getElementById('toggle_safety_bypass');
    if (toggleSafetyBypass) {
      toggleSafetyBypass.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('toggle_bypass_safety');
      });
    }

    // Клик по блоку поворотного ключа ГЦН 1..4
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`rcp_row_${i}`);
      if (el) {
        el.addEventListener('click', () => {
          if (window.plantAudio) window.plantAudio.playPmoRotate();
          this.sendControl('toggle_rcp', i);
        });
      }
    }

    // Тумблеры автоматических регуляторов
    const toggleArm = document.getElementById('toggle_arm');
    if (toggleArm) {
      toggleArm.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        const current = this.telemetry ? this.telemetry.auto_power : true;
        this.sendControl('toggle_auto_power', !current);
      });
    }

    const togglePz = document.getElementById('toggle_pz');
    if (togglePz) {
      togglePz.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('toggle_pz_heaters');
        this.sendControl('toggle_pz_spray');
      });
    }

    const togglePen = document.getElementById('toggle_pen');
    if (togglePen) {
      togglePen.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('toggle_feedwater_pump', 0);
      });
    }

    const toggleSpray = document.getElementById('toggle_spray_cont');
    if (toggleSpray) {
      toggleSpray.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('toggle_containment_spray');
      });
    }

    const toggleEmergBoron = document.getElementById('toggle_emerg_boron');
    if (toggleEmergBoron) {
      toggleEmergBoron.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.sendControl('toggle_emergency_boron');
      });
    }

    // Сдача смены и завершение регламента
    const btnComplete = document.getElementById('btnCompleteShift');
    if (btnComplete) {
      btnComplete.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.send({ type: 'end_shift' });
      });
    }

    const btnEnd = document.getElementById('btnEndShift');
    if (btnEnd) {
      btnEnd.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.send({ type: 'end_shift' });
      });
    }

    // Выбор миссии в выпадающем списке
    const missionSelect = document.getElementById('shiftMissionSelect');
    if (missionSelect) {
      missionSelect.addEventListener('change', (e) => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        this.send({ type: 'mission', mission_id: e.target.value });
      });
    }

    // Быстрые кнопки миссий
    ['m_btn_base', 'm_btn_maneuver', 'm_btn_cold', 'm_btn_loca', 'm_btn_sbo', 'm_btn_sandbox'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          if (window.plantAudio) window.plantAudio.playSwitchClick();
          const mKey = btn.getAttribute('data-mission');
          if (mKey) this.send({ type: 'mission', mission_id: mKey });
        });
      }
    });
  }

  startAnimationLoop() {
    const loop = (timestamp) => {
      try {
        this.mimic.render(timestamp);
      } catch (err) {
        console.error('[SCADA Mimic Render Error]', err);
      }
      try {
        this.chart.render();
      } catch (err) {
        console.error('[SCADA Chart Render Error]', err);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setupGameOverHandlers() {
    this.shatteredGlassEl = document.getElementById('crtShatteredGlass');
    this.gameOverModalEl = document.getElementById('gameOverModal');
    this.inspectHudBarEl = document.getElementById('inspectHudBar');
    this.btnRestartGame = document.getElementById('btnRestartGame');

    if (this.btnRestartGame) {
      this.btnRestartGame.addEventListener('click', () => {
        this.resetPlantFromGameOver();
      });
    }

    const btnInspect = document.getElementById('btnInspectPanel');
    if (btnInspect) {
      btnInspect.addEventListener('click', () => {
        if (window.plantAudio) window.plantAudio.playSwitchClick();
        if (this.gameOverModalEl) {
          this.gameOverModalEl.classList.remove('visible');
        }
        if (this.inspectHudBarEl) {
          this.inspectHudBarEl.style.display = 'flex';
        }
      });
    }

    const btnReturn = document.getElementById('btnReturnToReport');
    if (btnReturn) {
      btnReturn.addEventListener('click', () => {
        this.returnFromInspection();
      });
    }

    const btnInspectRestart = document.getElementById('btnInspectRestart');
    if (btnInspectRestart) {
      btnInspectRestart.addEventListener('click', () => {
        this.resetPlantFromGameOver();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isGameOver) {
        if (this.gameOverModalEl && !this.gameOverModalEl.classList.contains('visible')) {
          this.returnFromInspection();
        }
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        const tabBtn = document.getElementById('btnTabTycoon');
        if (tabBtn) tabBtn.click();
        const cmdInput = document.getElementById('tycoonCmdInput');
        if (cmdInput) {
          cmdInput.focus();
          cmdInput.value = '/';
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (this.tycoon) this.tycoon.activateBoost(true);
      } else if (e.key === 'b' || e.key === 'B') {
        if (this.tycoon) this.tycoon.activateBoost(true);
      }
    });

    // Глобальная блокировка сломанных кнопок при катастрофе
    document.addEventListener('click', (e) => {
      if (this.isGameOver && document.body.classList.contains('catastrophe-destroyed')) {
        if (e.target && (
          e.target.closest('#btnRestartGame') || e.target.id === 'btnRestartGame' ||
          e.target.closest('#btnInspectPanel') || e.target.id === 'btnInspectPanel' ||
          e.target.closest('#btnReturnToReport') || e.target.id === 'btnReturnToReport' ||
          e.target.closest('#btnInspectRestart') || e.target.id === 'btnInspectRestart'
        )) {
          return; // разрешаем кнопки перезапуска, возврата и осмотра пульта
        }
        const clickable = e.target.closest('button, input, select, .pmo-switch, .toggle-switch, .az5-btn');
        if (clickable) {
          e.preventDefault();
          e.stopPropagation();
          if (window.plantAudio) window.plantAudio.playShortCircuitSpark();
          this.triggerSparkOnElement(clickable);
        }
      }
    }, true);
  }

  returnFromInspection() {
    if (window.plantAudio) window.plantAudio.playSwitchClick();
    if (this.inspectHudBarEl) {
      this.inspectHudBarEl.style.display = 'none';
    }
    if (this.gameOverModalEl) {
      this.gameOverModalEl.classList.add('visible');
    }
  }

  populateGameOverModal(finaleData) {
    if (!finaleData) return;
    const box = document.getElementById('gameOverBox');
    if (box) {
      box.classList.remove('triumph', 'cold-shutdown', 'crisis-contained', 'unplanned-scram', 'meltdown', 'fatal');
      if (finaleData.type === 'TRIUMPH_SHIFT') box.classList.add('triumph');
      else if (finaleData.type === 'COLD_SHUTDOWN_SAFE') box.classList.add('cold-shutdown');
      else if (finaleData.type === 'CRISIS_CONTAINED') box.classList.add('crisis-contained');
      else if (finaleData.type === 'UNPLANNED_SCRAM') box.classList.add('unplanned-scram');
      else if (finaleData.type === 'CORE_MELTDOWN') box.classList.add('meltdown');
      else box.classList.add('fatal');
    }

    const hazardIcon = document.getElementById('gameOverHazardIcon');
    if (hazardIcon) {
      if (finaleData.type === 'TRIUMPH_SHIFT') hazardIcon.textContent = '★';
      else if (finaleData.type === 'COLD_SHUTDOWN_SAFE') hazardIcon.textContent = '❄';
      else if (finaleData.type === 'CRISIS_CONTAINED') hazardIcon.textContent = '🛡';
      else if (finaleData.type === 'UNPLANNED_SCRAM') hazardIcon.textContent = '⚡';
      else if (finaleData.type === 'CORE_MELTDOWN') hazardIcon.textContent = '☣';
      else hazardIcon.textContent = '☢';
    }

    const superTitle = document.getElementById('gameOverSuperTitle');
    if (superTitle && finaleData.super_title) superTitle.textContent = finaleData.super_title;

    const title = document.getElementById('gameOverTitle');
    if (title && finaleData.title) title.textContent = finaleData.title;

    const sub = document.getElementById('gameOverSub');
    if (sub && finaleData.subtitle) sub.textContent = finaleData.subtitle;

    const badge = document.getElementById('gameOverBadge');
    if (badge && finaleData.badge_class) {
      badge.className = finaleData.badge_class;
      badge.innerHTML = `<span class="ines-level">УРОВЕНЬ INES: ${finaleData.ines_level}</span><span class="ines-text">${finaleData.badge_text}</span>`;
    }

    const leadText = document.getElementById('gameOverLeadText');
    if (leadText && finaleData.lead_text) leadText.textContent = finaleData.lead_text;

    const grid = document.getElementById('gameOverMetricsGrid');
    if (grid && Array.isArray(finaleData.cards)) {
      grid.innerHTML = finaleData.cards.map(c => `
        <div class="postmortem-card ${c.cls || 'danger'}">
          <div class="pm-lbl">${c.lbl}</div>
          <div class="pm-val">${c.val}</div>
          <div class="pm-sub">${c.sub}</div>
        </div>
      `).join('');
    }

    const res = document.getElementById('gameOverResolution');
    if (res && finaleData.resolution) {
      res.innerHTML = `<span class="res-stamp">${finaleData.stamp || 'РЕШЕНИЕ:'}</span><span>${finaleData.resolution}</span>`;
    }

    if (this.btnRestartGame && finaleData.restart_caption) {
      const cap = this.btnRestartGame.querySelector('.restart-caption');
      if (cap) cap.textContent = finaleData.restart_caption;
    }
  }

  triggerShiftFinale(finaleData, data) {
    if (this.isGameOver) return;
    this.isGameOver = true;
    console.log('[SCADA Finale] Завершение смены / регламента:', finaleData.type);

    this.populateGameOverModal(finaleData);

    if (window.plantAudio) {
      if (finaleData.type === 'TRIUMPH_SHIFT') {
        window.plantAudio.playTriumphFanfare();
      } else if (finaleData.type === 'COLD_SHUTDOWN_SAFE') {
        window.plantAudio.playColdShutdownConfirmation();
      } else if (finaleData.type === 'CRISIS_CONTAINED') {
        window.plantAudio.playCrisisContainedChime();
      } else if (finaleData.type === 'UNPLANNED_SCRAM') {
        if (typeof window.plantAudio.playUnplannedScramHorn === 'function') {
          window.plantAudio.playUnplannedScramHorn();
        } else {
          window.plantAudio.playWarningChime();
        }
      } else if (finaleData.type === 'CORE_MELTDOWN') {
        window.plantAudio.playWarningGong();
      }
    }

    if (!this.gameOverModalEl) this.gameOverModalEl = document.getElementById('gameOverModal');
    if (this.gameOverModalEl) this.gameOverModalEl.classList.add('visible');
  }

  triggerNuclearCatastropheGameOver(data) {
    if (this.isGameOver) return;
    this.isGameOver = true;

    console.log('[SCADA Catastrophe] Ядерная катастрофа! Разрушение пульта и завершение игры...');

    const box = document.getElementById('gameOverBox');
    if (box) {
      box.classList.remove('triumph', 'cold-shutdown', 'crisis-contained', 'meltdown');
      box.classList.add('fatal');
    }

    if (data && data.finale_data) {
      this.populateGameOverModal(data.finale_data);
    }

    // 1. Сильнейшая сейсмическая тряска экрана
    if (this.mimic) this.mimic.triggerScreenShake(3.5);

    // 2. Оглушительный процедурный звук детонации
    if (window.plantAudio) {
      window.plantAudio.playNuclearDetonation();
      window.plantAudio.setRadiationLevel(55000);
    }

    // 3. Через 350 мс: ударная волна достигает монитора — стекло ЭЛТ с треском разбивается
    setTimeout(() => {
      if (window.plantAudio) window.plantAudio.playGlassShatter();
      if (!this.shatteredGlassEl) this.shatteredGlassEl = document.getElementById('crtShatteredGlass');
      if (this.shatteredGlassEl) this.shatteredGlassEl.classList.add('active');
    }, 350);

    // 4. Через 650 мс: все кнопки пульта выходят из строя, коробятся и искрят
    setTimeout(() => {
      document.body.classList.add('catastrophe-destroyed');
    }, 650);

    // 5. Через 2.8 с: экранное завершение игры (GameOver модальное окно)
    setTimeout(() => {
      if (data && data.finale_data) {
        this.populateGameOverModal(data.finale_data);
      }
      if (!this.gameOverModalEl) this.gameOverModalEl = document.getElementById('gameOverModal');
      if (this.gameOverModalEl) this.gameOverModalEl.classList.add('visible');
    }, 2800);
  }

  resetPlantFromGameOver() {
    console.log('[SCADA Catastrophe] Перезагрузка энергоблока после завершения смены / катастрофы...');
    this.isGameOver = false;
    this.previousNuclearDetonation = false;
    this.previousExplosion = false;
    this.previousRupture = false;
    this.previousState = 'NORMAL_POWER';
    document.body.classList.remove('catastrophe-destroyed');

    const box = document.getElementById('gameOverBox');
    if (box) {
      box.classList.remove('triumph', 'cold-shutdown', 'crisis-contained', 'meltdown', 'fatal');
    }

    if (!this.shatteredGlassEl) this.shatteredGlassEl = document.getElementById('crtShatteredGlass');
    if (this.shatteredGlassEl) this.shatteredGlassEl.classList.remove('active');

    if (!this.gameOverModalEl) this.gameOverModalEl = document.getElementById('gameOverModal');
    if (this.gameOverModalEl) this.gameOverModalEl.classList.remove('visible');

    if (this.inspectHudBarEl) {
      this.inspectHudBarEl.style.display = 'none';
    }

    if (window.plantAudio) {
      window.plantAudio.stopSiren();
      window.plantAudio.stopSteamBlowout();
      window.plantAudio.setRadiationLevel(12.0);
      window.plantAudio.playSwitchClick();
    }

    if (this.mimic) {
      this.mimic.nuclearDetonationStart = 0;
      this.mimic.screenShake = 0;
    }

    this.send({ type: 'reset' });

    const cover = document.getElementById('az5Cover');
    if (cover) cover.classList.remove('opened');
    if (cover) cover.classList.remove('open');
  }

  triggerSparkOnElement(el) {
    if (!el) return;
    el.style.boxShadow = '0 0 25px #fef08a, inset 0 0 12px #ffffff';
    setTimeout(() => {
      el.style.boxShadow = '';
    }, 140);
  }

  handleReactorCoreClick(clientX, clientY) {
    if (this.tycoon) {
      this.tycoon.handleManualClick(clientX, clientY);
    }
  }

}

// Запуск при загрузке DOM
window.addEventListener('DOMContentLoaded', () => {
  try {
    window.scadaApp = new ScadaApp();
    console.log('[SCADA] Пульт оператора ВВЭР-1000 готов к работе');
  } catch (err) {
    console.error('[SCADA] Ошибка при запуске пульта:', err);
  }
});

// Прозрачная поддержка альтернативных идентификаторов кнопок ЭЛТ
if (typeof document !== 'undefined' && document.getElementById) {
  const origGetById = document.getElementById.bind(document);
  document.getElementById = function(id) {
    if (id === 'btnTogglePhosphor') return origGetById('btnTogglePhosphor') || origGetById('btnCrtPhosphor');
    if (id === 'btnToggleCoreView') return origGetById('btnToggleCoreView') || origGetById('btnCrtView');
    return origGetById(id);
  };
}
