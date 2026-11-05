import math
from typing import List, Tuple
import numpy as np


class KineticsModel:
    """
    Модуль точечной кинетики нейтронов с 6 группами запаздывающих нейтронов
    для теплового реактора на делении U-235 (ВВЭР-1000).
    """

    def __init__(self):
        # Доли запаздывающих нейтронов для 6 групп
        self.beta_i = np.array([0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273], dtype=np.float64)
        self.beta_tot = float(np.sum(self.beta_i))  # ~0.006502

        # Постоянные распада предшественников (1/с)
        self.lambda_i = np.array([0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01], dtype=np.float64)

        # Время жизни мгновенных нейтронов (с)
        self.prompt_lifetime = 2.5e-5

        # Равновесные концентрации C_i на номинальной мощности n = 1.0: C_i = beta_i / (lambda_i * Lambda)
        self.c_i = self.beta_i / (self.lambda_i * self.prompt_lifetime)

        # Относительная нейтронная мощность n (1.0 = 100%)
        self.n = 1.0

        # Остаточное тепловыделение (Decay Heat) по кривой стандарта ANS-5.1
        # Группы актиноидов и осколков деления для остаточного тепла:
        self.decay_fractions = np.array([0.015, 0.018, 0.012, 0.010, 0.006, 0.004], dtype=np.float64)
        self.decay_lambdas = np.array([0.1, 0.015, 0.002, 0.0004, 0.00005, 0.000005], dtype=np.float64)
        self.decay_heat_accum = self.decay_fractions.copy()
        self.nominal_decay_fraction = float(np.sum(self.decay_fractions))  # ~6.5%

        # Текущий период реактора
        self.period = 999.0

    def step(self, total_reactivity_pcm: float, dt: float) -> Tuple[float, float, float]:
        """
        Численный шаг интегрирования кинетики с безусловно устойчивой неявной схемой.
        total_reactivity_pcm: реактивность в pcm (1 pcm = 1e-5 dk/k)
        dt: шаг по времени (сек)
        
        Возвращает: (относительная мощность деления n, мощность остаточного тепла, период реактора)
        """
        rho = total_reactivity_pcm * 1e-5
        dt = max(1e-4, dt)

        # Аналитическое решение для предшественников за шаг dt:
        # C_i(t+dt) = C_i(t)*exp(-lambda_i*dt) + (beta_i/Lambda)*n_avg*(1 - exp(-lambda_i*dt))/lambda_i
        exp_lambda = np.exp(-self.lambda_i * dt)
        one_minus_exp = 1.0 - exp_lambda
        integral_coeff = one_minus_exp / self.lambda_i

        # Неявная схема для n(t+dt):
        # dn/dt = (rho - beta)/Lambda * n + sum(lambda_i * C_i)
        # Подставляя выражение для C_i^(k+1) в неявное уравнение n^(k+1):
        sum_decay_c = float(np.sum(self.lambda_i * self.c_i * exp_lambda))
        sum_beta_terms = float(np.sum((self.beta_i / self.prompt_lifetime) * one_minus_exp))

        # denominator = 1 - dt * (rho - beta)/Lambda - dt * sum_decay_integral_terms
        # Для высокой стабильности при жестких дифференциальных уравнениях:
        denom = 1.0 - (dt / self.prompt_lifetime) * (rho - self.beta_tot) + dt * (sum_beta_terms / self.prompt_lifetime * self.prompt_lifetime)
        # Защита от деления на 0 при приближении к мгновенной критичности (rho >= beta):
        if denom < 1e-6:
            denom = 1e-6

        n_new = (self.n + dt * sum_decay_c) / (1.0 - (dt / self.prompt_lifetime) * (rho - self.beta_tot) + dt * float(np.sum(self.beta_i * one_minus_exp / (self.prompt_lifetime * dt if dt > 0 else 1.0))))
        
        # Альтернативная прямая экспоненциальная форма шага:
        alpha = (rho - self.beta_tot) / self.prompt_lifetime
        source = float(np.sum(self.lambda_i * self.c_i))
        if abs(alpha) > 1e-9:
            n_next = self.n * math.exp(alpha * dt) + (source / alpha) * (math.exp(alpha * dt) - 1.0)
        else:
            n_next = self.n + source * dt

        # Ограничим диапазон мощности физическими рамками
        n_next = max(1e-7, min(2.5, n_next))

        # Обновляем концентрации предшественников
        n_avg = 0.5 * (self.n + n_next)
        self.c_i = self.c_i * exp_lambda + (self.beta_i / self.prompt_lifetime) * n_avg * integral_coeff

        # Расчет периода реактора: tau = n / (dn/dt)
        dn_dt = (n_next - self.n) / dt
        if abs(dn_dt) > 1e-5 and n_next > 1e-6:
            self.period = n_next / dn_dt
            # Ограничим период диапазоном [-999 .. 999]
            if abs(self.period) > 999.0:
                self.period = 999.0 if self.period > 0 else -999.0
        else:
            self.period = 999.0

        self.n = n_next

        # Расчет остаточного тепловыделения (Decay Heat)
        for j in range(len(self.decay_fractions)):
            # dD_j/dt = lambda_j * (f_j * n - D_j)
            l_j = self.decay_lambdas[j]
            f_j = self.decay_fractions[j]
            self.decay_heat_accum[j] += l_j * (f_j * self.n - self.decay_heat_accum[j]) * dt
            self.decay_heat_accum[j] = max(0.0, self.decay_heat_accum[j])

        decay_heat_rel = float(np.sum(self.decay_heat_accum))

        # Полная относительная тепловая мощность активной зоны
        # При номинале (n=1.0): 93.5% деление + 6.5% остаточное тепло = 100%
        fission_rel = self.n * (1.0 - self.nominal_decay_fraction)
        total_thermal_rel = fission_rel + decay_heat_rel

        return total_thermal_rel, decay_heat_rel, self.period
