/**
 * Высокоточный аудио-движок SCADA энергоблока АЭС на базе Web Audio API.
 * Реалистичный процедурный синтез звуков промышленного оборудования,
 * тяжелых механических переключателей, релейных шкафов и сигнализаций БЩУ.
 * Включает точную акустическую модель гражданской обороны/АЭС сирены С-40,
 * электромеханического ревуна РВФ, счетчика Гейгера и детонации активной зоны.
 */
class PlantAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.masterGain = null;
    this.humGain = null;
    this.alarmGain = null;

    this.ambientOsc1 = null;
    this.ambientOsc2 = null;
    this.turbineWhine = null;
    this.alarmTimeout = null;
    this.isSirenPlaying = false;
    this.sirenNodes = null;
    this.sirenCycleTimer = null;
    this.sirenCoastTimer = null;
    this.rvfAlarmTimer = null;
    this.geigerScreamNode = null;
    this.steamNoiseNode = null;
    this.steamGainNode = null;
    this.radiationLevel = 12.0;

    this.setupListeners();
  }

  setupListeners() {
    const unlock = () => {
      this.initContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          console.log('[SCADA Audio] AudioContext активирован');
        });
      }
    };

    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
  }

  initContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Главный регулятор громкости
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.6, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Канал технологического гула БЩУ (50 Гц)
      this.humGain = this.ctx.createGain();
      this.humGain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      this.humGain.connect(this.masterGain);

      // Канал аварийных сигналов
      this.alarmGain = this.ctx.createGain();
      this.alarmGain.gain.setValueAtTime(0.58, this.ctx.currentTime);
      this.alarmGain.connect(this.masterGain);

      this.startAmbientHum();
      this.startGeigerRoutine();
      console.log('[SCADA Audio] Процедурный аудио-движок инициализирован');
    } catch (e) {
      console.warn('[SCADA Audio] Ошибка инициализации Web Audio:', e);
    }
  }

  ensureReady() {
    this.initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.ensureReady();
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0.0001 : 0.6, this.ctx.currentTime);
    }
    if (!this.isMuted) {
      this.playSwitchClick();
    }
    return this.isMuted;
  }

  /**
   * Фоновый технологический гул БЩУ: вентиляция (HVAC) + гул трансформаторов 50/100 Гц
   */
  startAmbientHum() {
    if (!this.ctx || !this.humGain) return;
    try {
      // 1. Промышленная приточно-вытяжная вентиляция БЩУ (HVAC air handling noise)
      const bufferSize = this.ctx.sampleRate * 2.0;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.95 * b1 + white * 0.1;
        b2 = 0.85 * b2 + white * 0.2;
        output[i] = (b0 + b1 + b2) * 0.25;
      }
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const hvacFilter = this.ctx.createBiquadFilter();
      hvacFilter.type = 'lowpass';
      hvacFilter.frequency.setValueAtTime(190, this.ctx.currentTime);
      hvacFilter.Q.setValueAtTime(1.8, this.ctx.currentTime);

      const hvacGain = this.ctx.createGain();
      hvacGain.gain.setValueAtTime(0.22, this.ctx.currentTime);

      noiseSource.connect(hvacFilter);
      hvacFilter.connect(hvacGain);
      hvacGain.connect(this.humGain);
      noiseSource.start();

      // 2. Сетевой гул оборудования 50 Гц + 100 Гц
      this.ambientOsc1 = this.ctx.createOscillator();
      this.ambientOsc1.type = 'sawtooth';
      this.ambientOsc1.frequency.setValueAtTime(50, this.ctx.currentTime);

      const filter50 = this.ctx.createBiquadFilter();
      filter50.type = 'lowpass';
      filter50.frequency.setValueAtTime(110, this.ctx.currentTime);

      this.ambientOsc1.connect(filter50);
      filter50.connect(this.humGain);
      this.ambientOsc1.start();

      this.ambientOsc2 = this.ctx.createOscillator();
      this.ambientOsc2.type = 'sine';
      this.ambientOsc2.frequency.setValueAtTime(100, this.ctx.currentTime);
      this.ambientOsc2.connect(this.humGain);
      this.ambientOsc2.start();
    } catch (e) {
      console.warn('[SCADA Audio] Ошибка запуска фона:', e);
    }
  }

  /**
   * Щелчки радиометра / дозиметрического контроля
   */
  startGeigerRoutine() {
    const loop = () => {
      if (this.ctx && !this.isMuted) {
        const rad = Math.max(12.0, this.radiationLevel || 12.0);
        if (rad < 10000) {
          const prob = Math.min(0.98, 0.25 + Math.log10(rad / 10.0) * 0.22);
          if (Math.random() < prob) {
            this.playGeigerClick();
          }
        }
      }
      const rad = Math.max(12.0, this.radiationLevel || 12.0);
      let minDelay = Math.max(15, 450 - Math.min(430, Math.log10(rad / 10.0) * 120));
      let jitter = Math.max(10, 800 - Math.min(780, Math.log10(rad / 10.0) * 220));
      if (rad > 3000) {
        minDelay = 12;
        jitter = 18;
      }
      setTimeout(loop, minDelay + Math.random() * jitter);
    };
    loop();
  }

  setRadiationLevel(mr_h) {
    this.radiationLevel = Number(mr_h) || 12.0;
    this.updateRadiationScream();
  }

  updateRadiationScream() {
    if (!this.ctx || this.isMuted) return;
    const rad = this.radiationLevel || 12.0;

    // При радиации свыше 10 000 мР/ч счетчик переходит в лавинный разряд (непрерывный визг)
    if (rad > 10000) {
      if (!this.geigerScreamNode) {
        try {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(1600, this.ctx.currentTime);

          // Модуляция лавинного разряда
          const mod = this.ctx.createOscillator();
          mod.type = 'square';
          mod.frequency.setValueAtTime(92, this.ctx.currentTime);
          const modGain = this.ctx.createGain();
          modGain.gain.setValueAtTime(700, this.ctx.currentTime);
          mod.connect(modGain);
          modGain.connect(osc.frequency);

          const filter = this.ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(2400, this.ctx.currentTime);
          filter.Q.setValueAtTime(3.8, this.ctx.currentTime);

          gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.36, this.ctx.currentTime + 0.4);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain || this.ctx.destination);

          mod.start();
          osc.start();

          this.geigerScreamNode = { osc, mod, gain };
        } catch (e) {}
      }
    } else {
      if (this.geigerScreamNode) {
        try {
          const now = this.ctx.currentTime;
          this.geigerScreamNode.gain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
          setTimeout(() => {
            if (this.geigerScreamNode) {
              try {
                this.geigerScreamNode.osc.stop();
                this.geigerScreamNode.mod.stop();
              } catch (e) {}
              this.geigerScreamNode = null;
            }
          }, 400);
        } catch (e) {
          this.geigerScreamNode = null;
        }
      }
    }
  }

  playGeigerClick() {
    if (!this.ctx || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(2100 + Math.random() * 800, this.ctx.currentTime);

      const targetGain = this.masterGain || this.ctx.destination;
      const vol = 0.05 + Math.random() * 0.035;
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.006);

      osc.connect(gain);
      gain.connect(targetGain);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.007);
    } catch (e) {}
  }

  /**
   * Тактильный щелчок промышленного тумблера ТВ1-2
   */
  playSwitchClick() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.04);

      const dest = this.masterGain || this.ctx.destination;
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(t);
      osc.stop(t + 0.045);
      this.playRelayCabinetClick();
    } catch (e) {}
  }

  /**
   * Срабатывание шкафа промежуточных реле РП-23 за щитом управления
   */
  playRelayCabinetClick() {
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime + 0.025;
      for (let i = 0; i < 3; i++) {
        const snapT = t + i * 0.012 + Math.random() * 0.005;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400 + i * 350, snapT);
        filter.Q.setValueAtTime(4, snapT);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(850 + Math.random() * 400, snapT);
        gain.gain.setValueAtTime(0.18, snapT);
        gain.gain.exponentialRampToValueAtTime(0.001, snapT + 0.018);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);
        osc.start(snapT);
        osc.stop(snapT + 0.02);
      }
    } catch (e) {}
  }

  /**
   * Тяжелый механический щелчок поворотного переключателя ПМО (ГЦН)
   */
  playPmoRotate() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(320, t);
      osc1.frequency.exponentialRampToValueAtTime(80, t + 0.06);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, t);

      gain1.gain.setValueAtTime(0.4, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

      osc1.connect(filter);
      filter.connect(gain1);
      gain1.connect(this.masterGain || this.ctx.destination);

      osc1.start(t);
      osc1.stop(t + 0.07);
    } catch (e) {}
  }

  /**
   * Звук поднятия/опускания подпружиненной защитной крышки АЗ-5
   */
  playAz5CoverFlip(isOpen) {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isOpen ? 650 : 420, t);
      osc.frequency.exponentialRampToValueAtTime(isOpen ? 1100 : 250, t + 0.09);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.1);
    } catch (e) {}
  }

  /**
   * Массивный механический удар сброса аварийной защиты АЗ-5
   * Включает соленоидный срыв, резонанс стальной панели и клацание реле
   */
  playAz5Slam() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const dest = this.masterGain || this.ctx.destination;

      // 1. Низкочастотный глухой удар соленоида (40-60 Гц)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(130, t);
      subOsc.frequency.exponentialRampToValueAtTime(32, t + 0.55);

      subGain.gain.setValueAtTime(0.9, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      subOsc.connect(subGain);
      subGain.connect(dest);
      subOsc.start(t);
      subOsc.stop(t + 0.6);

      // 2. Металлический лязг пружинного фиксатора
      const clangOsc = this.ctx.createOscillator();
      const clangGain = this.ctx.createGain();
      clangOsc.type = 'sawtooth';
      clangOsc.frequency.setValueAtTime(450, t);
      clangOsc.frequency.exponentialRampToValueAtTime(70, t + 0.3);

      const clangFilter = this.ctx.createBiquadFilter();
      clangFilter.type = 'bandpass';
      clangFilter.frequency.setValueAtTime(800, t);
      clangFilter.Q.setValueAtTime(3, t);

      clangGain.gain.setValueAtTime(0.6, t);
      clangGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      clangOsc.connect(clangFilter);
      clangFilter.connect(clangGain);
      clangGain.connect(dest);
      clangOsc.start(t);
      clangOsc.stop(t + 0.35);

      // 3. Клацание релейного шкафа защиты через 100 мс
      setTimeout(() => this.playRelayChatter(), 90);
    } catch (e) {}
  }

  /**
   * Клацание группы промежуточных электромагнитных реле (РП-23)
   */
  playRelayChatter() {
    if (!this.ctx || this.isMuted) return;
    try {
      for (let i = 0; i < 4; i++) {
        const delay = i * 0.035 + Math.random() * 0.015;
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800 + Math.random() * 400, t);

        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

        osc.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.025);
      }
    } catch (e) {}
  }

  /**
   * Звук работы шаговых электроприводов ШЭМ СУЗ
   */
  playRodDriveSound() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, t);

      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(22, t);
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(50, t);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const dest = this.masterGain || this.ctx.destination;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(dest);

      lfo.start(t);
      osc.start(t);
      lfo.stop(t + 0.25);
      osc.stop(t + 0.25);
    } catch (e) {}
  }

  /**
   * Аутентичная электромеханическая сирена ГО / АЭС (С-40 / С-28)
   * Двухчастотный ротор (порты 10 и 12), аэродинамический шум крыльчатки,
   * акустический резонанс корпуса и электромеханический ревун БЩУ (РВФ-24).
   */
  startSiren() {
    this.ensureReady();
    if (this.isSirenPlaying) return;
    this.isSirenPlaying = true;

    if (this.sirenCoastTimer) {
      clearTimeout(this.sirenCoastTimer);
      this.sirenCoastTimer = null;
    }

    try {
      const now = this.ctx.currentTime;
      const dest = this.alarmGain || this.masterGain || this.ctx.destination;

      // Создаем аудио-узел сирены С-40
      const sirenGain = this.ctx.createGain();
      sirenGain.gain.setValueAtTime(0.001, now);
      sirenGain.gain.linearRampToValueAtTime(0.55, now + 1.2);

      // Двухчастотный ротор С-40 (порты 10 и 12)
      // Основной тон 10 окон: 280 -> 480 Гц
      const osc10 = this.ctx.createOscillator();
      osc10.type = 'sawtooth';
      osc10.frequency.setValueAtTime(280, now);

      // Основной тон 12 окон (малая терция, интервал 1.2): 336 -> 576 Гц
      const osc12 = this.ctx.createOscillator();
      osc12.type = 'sawtooth';
      osc12.frequency.setValueAtTime(336, now);

      // Обертон (2-я гармоника) для металлического звона статора
      const oscHarmonic = this.ctx.createOscillator();
      oscHarmonic.type = 'triangle';
      oscHarmonic.frequency.setValueAtTime(560, now);

      // Аэродинамический шум прерывания воздуха крыльчаткой (air whoosh)
      const bufferSize = this.ctx.sampleRate * 2.0;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(420, now);
      noiseFilter.Q.setValueAtTime(3.0, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.18, now);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(sirenGain);

      // Формантный фильтр корпуса и раструба сирены
      const bodyFilter = this.ctx.createBiquadFilter();
      bodyFilter.type = 'lowpass';
      bodyFilter.frequency.setValueAtTime(1400, now);
      bodyFilter.Q.setValueAtTime(2.2, now);

      osc10.connect(bodyFilter);
      osc12.connect(bodyFilter);
      oscHarmonic.connect(bodyFilter);
      bodyFilter.connect(sirenGain);

      // Акустическая задержка (эхо бетонных стен машзала и реакторного отделения)
      const echoDelay = this.ctx.createDelay();
      echoDelay.delayTime.setValueAtTime(0.09, now);
      const echoGain = this.ctx.createGain();
      echoGain.gain.setValueAtTime(0.22, now);

      sirenGain.connect(dest);
      sirenGain.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(dest);

      osc10.start(now);
      osc12.start(now);
      oscHarmonic.start(now);
      noiseSource.start(now);

      this.sirenNodes = {
        gain: sirenGain,
        osc10,
        osc12,
        oscHarmonic,
        noiseFilter,
        noiseSource,
        echoGain
      };

      // Циклический регулятор оборотов электромотора (период завывания 4.2 секунды)
      const cycleWail = () => {
        if (!this.isSirenPlaying || !this.ctx || !this.sirenNodes) return;
        const t = this.ctx.currentTime;
        const cycleTime = 4.2;
        const spinUp = 2.3;

        // Разгон мотора
        osc10.frequency.cancelScheduledValues(t);
        osc12.frequency.cancelScheduledValues(t);
        oscHarmonic.frequency.cancelScheduledValues(t);
        noiseFilter.frequency.cancelScheduledValues(t);

        osc10.frequency.setValueAtTime(osc10.frequency.value, t);
        osc10.frequency.linearRampToValueAtTime(485, t + spinUp);
        osc10.frequency.linearRampToValueAtTime(270, t + cycleTime);

        osc12.frequency.setValueAtTime(osc12.frequency.value, t);
        osc12.frequency.linearRampToValueAtTime(582, t + spinUp);
        osc12.frequency.linearRampToValueAtTime(324, t + cycleTime);

        oscHarmonic.frequency.setValueAtTime(oscHarmonic.frequency.value, t);
        oscHarmonic.frequency.linearRampToValueAtTime(970, t + spinUp);
        oscHarmonic.frequency.linearRampToValueAtTime(540, t + cycleTime);

        noiseFilter.frequency.setValueAtTime(noiseFilter.frequency.value, t);
        noiseFilter.frequency.linearRampToValueAtTime(540, t + spinUp);
        noiseFilter.frequency.linearRampToValueAtTime(320, t + cycleTime);

        this.sirenCycleTimer = setTimeout(cycleWail, (cycleTime - 0.1) * 1000);
      };

      cycleWail();

      // Запуск электромеханического ревуна БЩУ (РВФ-24)
      this.startRvfBuzzer();
    } catch (e) {
      console.warn('[SCADA Audio] Ошибка запуска сирены:', e);
    }
  }

  /**
   * Электромеханический ревун щита управления БЩУ (РВФ-24 / ЭР-1)
   * 100 Гц пульсация двухполупериодного выпрямления с резонансом мембраны
   */
  startRvfBuzzer() {
    if (this.rvfAlarmTimer) return;
    const pulse = () => {
      if (!this.isSirenPlaying || !this.ctx || this.isMuted) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t); // 100 Гц промышленная гармоника

        // Резонансный фильтр акустического раструба
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(820, t);
        filter.Q.setValueAtTime(5.5, t);

        const dest = this.alarmGain || this.masterGain || this.ctx.destination;
        gain.gain.setValueAtTime(0.32, t);
        gain.gain.setValueAtTime(0.32, t + 0.65);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.72);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc.start(t);
        osc.stop(t + 0.72);
      } catch (e) {}

      if (this.isSirenPlaying) {
        this.rvfAlarmTimer = setTimeout(pulse, 1100);
      }
    };
    pulse();
  }

  stopRvfBuzzer() {
    if (this.rvfAlarmTimer) {
      clearTimeout(this.rvfAlarmTimer);
      this.rvfAlarmTimer = null;
    }
  }

  /**
   * Остановка сирены с реалистичным механическим выбегом ротора (3.2 сек)
   */
  stopSiren() {
    if (!this.isSirenPlaying) return;
    this.isSirenPlaying = false;

    if (this.sirenCycleTimer) {
      clearTimeout(this.sirenCycleTimer);
      this.sirenCycleTimer = null;
    }
    this.stopRvfBuzzer();

    // Реалистичный выбег ротора по инерции (coast-down 3.2 сек)
    if (this.sirenNodes && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        const nodes = this.sirenNodes;
        this.sirenNodes = null;

        nodes.osc10.frequency.cancelScheduledValues(now);
        nodes.osc12.frequency.cancelScheduledValues(now);
        nodes.oscHarmonic.frequency.cancelScheduledValues(now);
        nodes.gain.gain.cancelScheduledValues(now);

        nodes.osc10.frequency.setValueAtTime(nodes.osc10.frequency.value, now);
        nodes.osc10.frequency.exponentialRampToValueAtTime(35, now + 3.2);

        nodes.osc12.frequency.setValueAtTime(nodes.osc12.frequency.value, now);
        nodes.osc12.frequency.exponentialRampToValueAtTime(42, now + 3.2);

        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

        this.sirenCoastTimer = setTimeout(() => {
          try {
            nodes.osc10.stop();
            nodes.osc12.stop();
            nodes.oscHarmonic.stop();
            nodes.noiseSource.stop();
            nodes.gain.disconnect();
          } catch (e) {}
        }, 3300);
      } catch (e) {
        this.sirenNodes = null;
      }
    }
  }

  /**
   * Двухтональный предупредительный гонг табло сигнализаций
   */
  playWarningChime() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const playBeep = (freq, delay) => {
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);

        const dest = this.alarmGain || this.masterGain || this.ctx.destination;
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(t);
        osc.stop(t + 0.16);
      };

      playBeep(920, 0);
      playBeep(1150, 0.14);
      this.playWarningGong();
    } catch (e) {}
  }

  /**
   * Советский предупредительный гонг БЩУ (глубокий резонансный колокольный звон)
   */
  playWarningGong() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const harmonics = [
        { freq: 440, gain: 0.45, decay: 1.4 },
        { freq: 660, gain: 0.35, decay: 1.2 },
        { freq: 990, gain: 0.20, decay: 0.9 },
        { freq: 1320, gain: 0.12, decay: 0.6 }
      ];
      harmonics.forEach(h => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(h.freq, t);

        const dest = this.alarmGain || this.masterGain || this.ctx.destination;
        gain.gain.setValueAtTime(h.gain, t);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + h.decay);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(t);
        osc.stop(t + h.decay);
      });
    } catch (e) {}
  }

  /**
   * Электромеханический матричный принтер регистрации событий (телетайп БЩУ)
   * Звучит при поступлении нового технологического сообщения в журнал
   */
  playMatrixPrinterChatter() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;
    try {
      const baseT = this.ctx.currentTime;
      const strikes = 7 + Math.floor(Math.random() * 5);
      for (let i = 0; i < strikes; i++) {
        const t = baseT + i * 0.042 + Math.random() * 0.006;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2400 + Math.random() * 600, t);
        filter.Q.setValueAtTime(5, t);

        osc.type = 'square';
        osc.frequency.setValueAtTime(1600 + Math.random() * 500, t);

        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.016);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.017);
      }
    } catch (e) {}
  }

  /**
   * Разрушительный процедурный звук сверхкритического ядерного взрыва реактора:
   * 1. Предвспышечный ионизационный щелчок Черенкова и мгновенный скачок давления (<80мс)
   * 2. Оглушительный гиперзвуковой удар ударной волны с аналоговым клиппированием
   * 3. Колоссальный сейсмический инфразвуковой гул (140 -> 18 Гц) с субгармониками
   * 4. Акустический рев 250 тонн вскипающего сверхкритического теплоносителя и плазменного огненного шара
   * 5. Скрежет 200-тонной крышки реактора, разрушение железобетонной биозащиты и падение обломков
   * 6. Зашкаливание и непрерывный лавинный визг счетчиков Гейгера
   */
  playNuclearDetonation() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = this.masterGain || this.ctx.destination;

      // 1. Ионизационный щелчок черенковского спектра (0 - 80 мс)
      const ionOsc = this.ctx.createOscillator();
      const ionGain = this.ctx.createGain();
      ionOsc.type = 'sawtooth';
      ionOsc.frequency.setValueAtTime(2400, now);
      ionOsc.frequency.exponentialRampToValueAtTime(160, now + 0.08);

      ionGain.gain.setValueAtTime(0.9, now);
      ionGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      ionOsc.connect(ionGain);
      ionGain.connect(targetGain);
      ionOsc.start(now);
      ionOsc.stop(now + 0.1);

      // 2. Гиперзвуковой ударный фронт (Concussive Shockwave Snap)
      const snapOsc = this.ctx.createOscillator();
      const snapGain = this.ctx.createGain();
      snapOsc.type = 'triangle';
      snapOsc.frequency.setValueAtTime(1100, now + 0.02);
      snapOsc.frequency.exponentialRampToValueAtTime(55, now + 0.28);

      snapGain.gain.setValueAtTime(1.0, now + 0.02);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      snapOsc.connect(snapGain);
      snapGain.connect(targetGain);
      snapOsc.start(now + 0.02);
      snapOsc.stop(now + 0.36);

      // 3. Сверхмощный инфразвуковой сейсмический басовый удар (дроп 140 -> 18 Гц, 5.2 сек)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(140, now);
      subOsc.frequency.exponentialRampToValueAtTime(18, now + 4.8);

      subGain.gain.setValueAtTime(1.0, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 5.2);

      // Субгармоника 22 Гц для физической тряски сабвуфера
      const subOsc2 = this.ctx.createOscillator();
      const subGain2 = this.ctx.createGain();
      subOsc2.type = 'sawtooth';
      subOsc2.frequency.setValueAtTime(55, now + 0.05);
      subOsc2.frequency.exponentialRampToValueAtTime(22, now + 4.0);

      const subFilter = this.ctx.createBiquadFilter();
      subFilter.type = 'lowpass';
      subFilter.frequency.setValueAtTime(80, now);

      subGain2.gain.setValueAtTime(0.65, now + 0.05);
      subGain2.gain.exponentialRampToValueAtTime(0.001, now + 4.5);

      subOsc.connect(subGain);
      subGain.connect(targetGain);
      subOsc.start(now);
      subOsc.stop(now + 5.3);

      subOsc2.connect(subFilter);
      subFilter.connect(subGain2);
      subGain2.connect(targetGain);
      subOsc2.start(now + 0.05);
      subOsc2.stop(now + 4.6);

      // 4. Колоссальный рев огненного шара и вскипания теплоносителя (шумовой массив 5.5 сек)
      const bufferSize = this.ctx.sampleRate * 5.5;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.08;
        b1 = 0.95 * b1 + white * 0.15;
        b2 = 0.85 * b2 + white * 0.25;
        output[i] = (b0 + b1 + b2) * 0.45;
      }

      const roarSource = this.ctx.createBufferSource();
      roarSource.buffer = noiseBuffer;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(1400, now);
      lowpass.frequency.exponentialRampToValueAtTime(45, now + 5.2);
      lowpass.Q.setValueAtTime(3.8, now);

      const roarGain = this.ctx.createGain();
      roarGain.gain.setValueAtTime(0.98, now);
      roarGain.gain.exponentialRampToValueAtTime(0.001, now + 5.4);

      roarSource.connect(lowpass);
      lowpass.connect(roarGain);
      roarGain.connect(targetGain);
      roarSource.start(now);
      roarSource.stop(now + 5.5);

      // 5. Металлический скрежет срыва 200-тонной крышки и удар обломков
      const metalOsc = this.ctx.createOscillator();
      const metalGain = this.ctx.createGain();
      metalOsc.type = 'sawtooth';
      metalOsc.frequency.setValueAtTime(520, now + 0.08);
      metalOsc.frequency.exponentialRampToValueAtTime(48, now + 1.2);

      metalGain.gain.setValueAtTime(0.75, now + 0.08);
      metalGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

      metalOsc.connect(metalGain);
      metalGain.connect(targetGain);
      metalOsc.start(now + 0.08);
      metalOsc.stop(now + 1.45);

      // Грохот падающих бетонных обломков биозащиты
      for (let d = 0; d < 5; d++) {
        const debrisTime = now + 0.35 + d * 0.32 + Math.random() * 0.15;
        const dOsc = this.ctx.createOscillator();
        const dGain = this.ctx.createGain();
        dOsc.type = 'triangle';
        dOsc.frequency.setValueAtTime(160 + Math.random() * 80, debrisTime);
        dOsc.frequency.exponentialRampToValueAtTime(30, debrisTime + 0.28);

        dGain.gain.setValueAtTime(0.45 - d * 0.06, debrisTime);
        dGain.gain.exponentialRampToValueAtTime(0.001, debrisTime + 0.3);

        dOsc.connect(dGain);
        dGain.connect(targetGain);
        dOsc.start(debrisTime);
        dOsc.stop(debrisTime + 0.32);
      }

      // Запуск непрерывной системы аварийного оповещения С-40 + ревуна
      this.startSiren();
      this.setRadiationLevel(48000);

      console.log('[SCADA Audio] Реалистичный процедурный ядерный взрыв воспроизведен!');
    } catch (err) {
      console.warn('[SCADA Audio] Ошибка воспроизведения ядерного взрыва:', err);
    }
  }

  /**
   * Мощный процедурный звук промышленного взрыва / гидроудара / разрушения контура
   */
  playExplosionBlast() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = this.masterGain || this.ctx.destination;

      // 1. Мощный суб-басовый компрессионный импульс (дроп 135 -> 22 Гц)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(135, now);
      subOsc.frequency.exponentialRampToValueAtTime(22, now + 2.0);

      subGain.gain.setValueAtTime(0.92, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.4);

      subOsc.connect(subGain);
      subGain.connect(targetGain);
      subOsc.start(now);
      subOsc.stop(now + 2.5);

      // 2. Взрывной акустический фронт разрыва металла и бетона
      const bufferSize = this.ctx.sampleRate * 2.8;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(60, now + 2.5);
      filter.Q.setValueAtTime(4.0, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.85, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.7);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(targetGain);

      whiteNoise.start(now);
      whiteNoise.stop(now + 2.8);

      // 3. Звон и скрежет лопнувшего корпуса/трубопровода
      const metalOsc = this.ctx.createOscillator();
      const metalGain = this.ctx.createGain();
      metalOsc.type = 'sawtooth';
      metalOsc.frequency.setValueAtTime(380, now);
      metalOsc.frequency.linearRampToValueAtTime(140, now + 0.45);

      metalGain.gain.setValueAtTime(0.45, now);
      metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      metalOsc.connect(metalGain);
      metalGain.connect(targetGain);
      metalOsc.start(now);
      metalOsc.stop(now + 0.58);

      // Включаем сирену при взрыве
      this.startSiren();
      console.log('[SCADA Audio] Реалистичный звук промышленного взрыва воспроизведен');
    } catch (err) {
      console.warn('[SCADA Audio] Ошибка синтеза взрыва:', err);
    }
  }

  /**
   * Непрерывный свист и шипение фонтана пара высокого давления
   */
  startSteamBlowout() {
    this.ensureReady();
    if (!this.ctx || this.steamNoiseNode) return;

    try {
      const bufferSize = this.ctx.sampleRate * 2.0;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      this.steamNoiseNode = this.ctx.createBufferSource();
      this.steamNoiseNode.buffer = buffer;
      this.steamNoiseNode.loop = true;

      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1400, this.ctx.currentTime);
      bandpass.Q.setValueAtTime(1.8, this.ctx.currentTime);

      this.steamGainNode = this.ctx.createGain();
      this.steamGainNode.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.steamGainNode.gain.linearRampToValueAtTime(0.32, this.ctx.currentTime + 0.8);

      this.steamNoiseNode.connect(bandpass);
      bandpass.connect(this.steamGainNode);
      this.steamGainNode.connect(this.masterGain || this.ctx.destination);

      this.steamNoiseNode.start();
      console.log('[SCADA Audio] Шипение разрыва паропровода запущено');
    } catch (e) {
      console.warn('[SCADA Audio] Ошибка звука пара:', e);
    }
  }

  stopSteamBlowout() {
    if (!this.steamNoiseNode || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.steamGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.5);
      setTimeout(() => {
        if (this.steamNoiseNode) {
          try { this.steamNoiseNode.stop(); } catch (e) {}
          this.steamNoiseNode = null;
          this.steamGainNode = null;
        }
      }, 550);
    } catch (e) {
      this.steamNoiseNode = null;
      this.steamGainNode = null;
    }
  }


  /**
   * Разрушительный звук разбивающегося толстого взрывозащищенного стекла кинескопа ЭЛТ
   * Включает схлопывание вакуумной колбы, резкий треск стекла и осыпание сотен осколков
   */
  playGlassShatter() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = this.masterGain || this.ctx.destination;

      // 1. Схлопывание вакуумной колбы кинескопа (глухой вакуумный поп 240 -> 35 Гц)
      const vacOsc = this.ctx.createOscillator();
      const vacGain = this.ctx.createGain();
      vacOsc.type = 'triangle';
      vacOsc.frequency.setValueAtTime(240, now);
      vacOsc.frequency.exponentialRampToValueAtTime(35, now + 0.14);

      vacGain.gain.setValueAtTime(0.85, now);
      vacGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      vacOsc.connect(vacGain);
      vacGain.connect(targetGain);
      vacOsc.start(now);
      vacOsc.stop(now + 0.18);

      // 2. Острый высокочастотный треск раскалывающегося толстого свинцового стекла (4200 -> 450 Гц)
      const snapOsc = this.ctx.createOscillator();
      const snapGain = this.ctx.createGain();
      snapOsc.type = 'sawtooth';
      snapOsc.frequency.setValueAtTime(4200, now);
      snapOsc.frequency.exponentialRampToValueAtTime(450, now + 0.08);

      const snapFilter = this.ctx.createBiquadFilter();
      snapFilter.type = 'highpass';
      snapFilter.frequency.setValueAtTime(1800, now);

      snapGain.gain.setValueAtTime(0.95, now);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      snapOsc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(targetGain);
      snapOsc.start(now);
      snapOsc.stop(now + 0.14);

      // 3. Звон и осыпание стеклянных осколков по металлическому пульту
      const shardFreqs = [2400, 3100, 4200, 5100, 6300, 7200, 3800, 4900, 5800];
      for (let i = 0; i < shardFreqs.length; i++) {
        const shardTime = now + 0.04 + i * 0.09 + Math.random() * 0.04;
        const sOsc = this.ctx.createOscillator();
        const sGain = this.ctx.createGain();

        sOsc.type = (i % 2 === 0) ? 'sine' : 'triangle';
        sOsc.frequency.setValueAtTime(shardFreqs[i] + Math.random() * 400, shardTime);

        const decay = 0.08 + Math.random() * 0.14;
        sGain.gain.setValueAtTime(0.28, shardTime);
        sGain.gain.exponentialRampToValueAtTime(0.0005, shardTime + decay);

        sOsc.connect(sGain);
        sGain.connect(targetGain);
        sOsc.start(shardTime);
        sOsc.stop(shardTime + decay + 0.02);
      }

      console.log('[SCADA Audio] Звук разбития стекла монитора воспроизведен');
    } catch (e) {
      console.warn('[SCADA Audio] Ошибка звука разбитого стекла:', e);
    }
  }

  /**
   * Электрический щелчок короткого замыкания и снопа искр при нажатии сломанных кнопок
   */
  playShortCircuitSpark() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = this.masterGain || this.ctx.destination;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.linearRampToValueAtTime(60, now + 0.07);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2800, now);
      filter.Q.setValueAtTime(4.0, now);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(targetGain);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }
}

// Глобальный экземпляр
window.plantAudio = new PlantAudioEngine();
