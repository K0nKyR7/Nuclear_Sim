/**
 * Высокоточный аудио-движок SCADA энергоблока АЭС на базе Web Audio API.
 * Реалистичный процедурный синтез звуков промышленного оборудования,
 * тяжелых механических переключателей, релейных шкафов и сигнализаций БЩУ.
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
      this.alarmGain.gain.setValueAtTime(0.55, this.ctx.currentTime);
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
        // При росте радиации шанс щелчка растет, а интервал падает
        const prob = Math.min(0.95, 0.25 + Math.log10(rad / 10.0) * 0.22);
        if (Math.random() < prob) {
          this.playGeigerClick();
        }
      }
      const rad = Math.max(12.0, this.radiationLevel || 12.0);
      const minDelay = Math.max(25, 450 - Math.min(420, Math.log10(rad / 10.0) * 110));
      const jitter = Math.max(20, 800 - Math.min(760, Math.log10(rad / 10.0) * 200));
      setTimeout(loop, minDelay + Math.random() * jitter);
    };
    loop();
  }

  setRadiationLevel(mr_h) {
    this.radiationLevel = Number(mr_h) || 12.0;
  }

  playGeigerClick() {
    if (!this.ctx || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1800 + Math.random() * 600, this.ctx.currentTime);

      const targetGain = this.masterGain || this.ctx.destination;
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.008);

      osc.connect(gain);
      gain.connect(targetGain);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.008);
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
      // Двойной механический контакт: кулачок + возвратная пружина
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
   * Аварийная двухтональная сирена БЩУ
   */
  startSiren() {
    this.ensureReady();
    if (this.isSirenPlaying) return;
    this.isSirenPlaying = true;

    const beep = () => {
      if (!this.isSirenPlaying || !this.ctx || this.isMuted) return;
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';

        const t = this.ctx.currentTime;
        osc.frequency.setValueAtTime(680, t);
        osc.frequency.linearRampToValueAtTime(940, t + 0.35);
        osc.frequency.linearRampToValueAtTime(620, t + 0.7);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, t);

        const dest = this.alarmGain || this.masterGain || this.ctx.destination;
        gain.gain.setValueAtTime(0.45, t);
        gain.gain.linearRampToValueAtTime(0.45, t + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.88);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc.start(t);
        osc.stop(t + 0.88);
      } catch (e) {}

      if (this.isSirenPlaying) {
        this.alarmTimeout = setTimeout(beep, 1050);
      }
    };
    beep();
  }

  stopSiren() {
    this.isSirenPlaying = false;
    if (this.alarmTimeout) {
      clearTimeout(this.alarmTimeout);
      this.alarmTimeout = null;
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
   * Мощный процедурный звук взрыва / гидроудара / разрушения контура
   */
  playExplosionBlast() {
    this.ensureReady();
    if (!this.ctx || this.isMuted) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = this.masterGain || this.ctx.destination;

      // 1. Низкочастотный суб-басовый ударный импульс (дроп 110 -> 25 Гц)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(120, now);
      subOsc.frequency.exponentialRampToValueAtTime(24, now + 1.8);

      subGain.gain.setValueAtTime(0.85, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);

      subOsc.connect(subGain);
      subGain.connect(targetGain);
      subOsc.start(now);
      subOsc.stop(now + 2.3);

      // 2. Взрывной шумовой фронт волны с резонансным фильтром
      const bufferSize = this.ctx.sampleRate * 2.5;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 2.2);
      filter.Q.setValueAtTime(3.5, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.75, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.4);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(targetGain);

      whiteNoise.start(now);
      whiteNoise.stop(now + 2.5);

      // 3. Металлический скрежет лопнувшего металла
      const metalOsc = this.ctx.createOscillator();
      const metalGain = this.ctx.createGain();
      metalOsc.type = 'sawtooth';
      metalOsc.frequency.setValueAtTime(340, now);
      metalOsc.frequency.linearRampToValueAtTime(180, now + 0.4);

      metalGain.gain.setValueAtTime(0.35, now);
      metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      metalOsc.connect(metalGain);
      metalGain.connect(targetGain);
      metalOsc.start(now);
      metalOsc.stop(now + 0.52);

      console.log('[SCADA Audio] Звуковой эффект взрыва воспроизведен');
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
}

// Глобальный экземпляр
window.plantAudio = new PlantAudioEngine();
