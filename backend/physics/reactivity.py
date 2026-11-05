import math
from typing import Tuple


class ReactivityModel:
    """
    Модель реактивности реактора ВВЭР-1000.
    1 pcm = 10^-5 dk/k (0.001%)
    beta_eff ~ 0.0065 (~650 pcm)
    """

    def __init__(self):
        # Номинальные опорные параметры для баланса на 100% мощности
        self.t_fuel_ref_c = 680.0
        self.t_coolant_ref_c = 305.0
        self.boron_ref_ppm = 500.0

        # Коэффициенты обратных связей
        # Доплеровский температурный коэффициент топлива (отрицательный): -2.6 pcm/°C
        self.alpha_doppler = -2.6
        # Температурный коэффициент замедлителя/теплоносителя: -32.0 pcm/°C
        self.alpha_coolant = -32.0
        # Дифференциальная эффективность борной кислоты: -7.5 pcm/ppm
        self.alpha_boron = -7.5

        # Эффективность СУЗ:
        # Регулирующая рабочая 10-я группа (АР): диапазон ~1400 pcm
        self.rod_bank_worth_pcm = 1400.0
        # Полный вес аварийной защиты АЗ-5 при сбросе всех стержней: ~9000 pcm
        self.scram_worth_pcm = 9500.0

        # Равновесное отравление ксеноном на 100% мощности: ~ -2800 pcm
        self.xenon_worth_pcm = 2800.0

        # Постоянные времени йода и ксенона
        # T_1/2(I-135) = 6.57 ч -> lambda_I = 2.87e-5 1/с
        self.lambda_i = 2.87e-5
        # T_1/2(Xe-135) = 9.14 ч -> lambda_xe = 2.09e-5 1/с
        self.lambda_xe = 2.09e-5
        # Микросечение выгорания ксенона потоком нейтронов
        self.sigma_xe_flux = 8.5e-5

    def s_curve(self, pos_pct: float) -> float:
        """
        Интегральная характеристика стержня СУЗ (S-образная кривая).
        pos_pct: 0% = внизу (введен полностью), 100% = вверху (извлечен).
        Возвращает долю извлеченной реактивности [0.0 .. 1.0].
        """
        x = max(0.0, min(100.0, pos_pct)) / 100.0
        # Классическая аппроксимация формы поля: S(x) = x - sin(2*pi*x)/(2*pi)
        return x - math.sin(2.0 * math.pi * x) / (2.0 * math.pi)

    def calculate_rod_reactivity(self, rod_pct: float, scrammed: bool, scram_factor: float = 1.0) -> float:
        """
        Реактивность стержней СУЗ в pcm.
        На 80% положения рабочей группы и без АЗ реактивность рабочей группы скомпенсирована в 0.
        """
        # Рабочая группа
        fraction = self.s_curve(rod_pct)
        ref_fraction = self.s_curve(80.0)
        rho_working = (fraction - ref_fraction) * self.rod_bank_worth_pcm

        # Если сработала АЗ-5, вводится мощная подкритичность
        if scrammed:
            rho_scram = -self.scram_worth_pcm * max(0.0, min(1.0, scram_factor))
            return rho_working + rho_scram
        return rho_working

    def calculate_feedbacks(
        self,
        t_fuel: float,
        t_coolant_avg: float,
        boron_ppm: float,
        xenon_rel: float
    ) -> Tuple[float, float, float, float]:
        """
        Возвращает кортеж (rho_doppler, rho_coolant, rho_boron, rho_xenon) в pcm.
        """
        rho_doppler = self.alpha_doppler * (t_fuel - self.t_fuel_ref_c)
        rho_coolant = self.alpha_coolant * (t_coolant_avg - self.t_coolant_ref_c)
        rho_boron = self.alpha_boron * (boron_ppm - self.boron_ref_ppm)
        rho_xenon = -self.xenon_worth_pcm * (xenon_rel - 1.0)

        return rho_doppler, rho_coolant, rho_boron, rho_xenon

    def step_xenon_iodine(self, rel_power: float, i_rel: float, xe_rel: float, dt: float) -> Tuple[float, float]:
        """
        Интегрирование кинетики Йода-135 и Ксенона-135.
        Переменные нормированы к 1.0 на номинальной мощности.
        """
        # dI/dt = lambda_I * (n - I)
        di = self.lambda_i * (rel_power - i_rel) * dt
        i_new = max(0.0, i_rel + di)

        # dXe/dt = lambda_xe_eff * (generation_from_decay + generation_direct - burnup - decay)
        # На 100% мощности (rel_power = 1, i = 1, xe = 1): dXe/dt = 0
        gamma_eff = self.lambda_xe + self.sigma_xe_flux
        prod = (self.lambda_xe * 0.05 * rel_power) + (self.lambda_xe * 0.95 * i_rel) + (self.sigma_xe_flux * rel_power * 0.0)
        decay_burn = (self.lambda_xe + self.sigma_xe_flux * rel_power) * xe_rel
        dxe = (prod - decay_burn) * dt
        xe_new = max(0.0, xe_rel + dxe)

        return i_new, xe_new
