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
        if (data.explosion_active && !this.previousExplosion) {
          if (isNuclear) {
            window.plantAudio.playNuclearDetonation();
            if (this.mimic) this.mimic.triggerScreenShake(2.5);
          } else {
            window.plantAudio.playExplosionBlast();
            if (this.mimic) this.mimic.triggerScreenShake(1.0);
          }
        }
        if (isNuclear && !this.previousNuclearDetonation) {
          window.plantAudio.playNuclearDetonation();
          if (this.mimic) this.mimic.triggerScreenShake(2.5);
        }
        this.previousNuclearDetonation = isNuclear;
        this.previousExplosion = Boolean(data.explosion_active);

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
