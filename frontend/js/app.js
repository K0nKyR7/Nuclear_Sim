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
