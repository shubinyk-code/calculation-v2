'use strict';

/*
    Исходные данные расчёта. Порт HotWaterCirculation/src/CalcSettings.cs,
    значения по умолчанию сохранены до последней цифры.
*/

function ZoneConditions(zoneKey) {
    this.zoneKey = zoneKey;
    this.hasAlpha = false;
    this.alpha = 0.0;
    this.hasAmbient = false;
    this.ambient = 0.0;
}

ZoneConditions.prototype.isEmpty = function () {
    return !this.hasAlpha && !this.hasAmbient;
};

function CalcSettings() {

    // --- поиск замыканий --------------------------------------------------

    /*
        Насколько близко должны стоять свободные концы Т3 и Т4, чтобы считать
        это местом замыкания кольца, мм. В модели самой перемычки нет.
    */
    this.linkToleranceMm = 20.0;

    /** Сшивать ли заодно разрывы внутри одной системы (Т3 к Т3, Т4 к Т4). */
    this.linkSameSystem = true;

    /*
        Допуск на сшивку разрыва внутри одной системы, мм. Отдельный от допуска
        замыкания колец: замыкание — это два конца, подведённых друг к другу вплотную,
        а разрыв в трубе бывает заметно шире, и мерить их одним порогом нельзя.
    */
    this.sameSystemToleranceMm = 100.0;

    /*
        Разрешить замыкать кольцо, когда имена зон у Т3 и Т4 не совпали.
        Геометрия надёжнее имени: два конца в двух сантиметрах друг от друга —
        это узел, как бы ни назывались их системы.
    */
    this.linkAcrossZones = true;

    // --- температуры ------------------------------------------------------

    /** Температура на выходе из ИТП, °C. */
    this.supplyTemperature = 65.0;

    /** Требуемая температура у потребителя, °C. СП 30.13330.2020 п. 4.7: не ниже 60. */
    this.requiredTemperature = 60.0;

    /*
        Расчётный перепад для контрольной проверки общего расхода по формуле
        q_cir = β·ΣQ/(c·Δt), К. СП допускает до 10, здесь по умолчанию 65−60.
    */
    this.deltaT = 5.0;

    /** Коэффициент разрегулировки циркуляции β: 1 при стояках переменного сопротивления, 1,3 при одинаковых. */
    this.beta = 1.0;

    /*
        Считать по формуле СП, без подбора расходов: общий расход берётся из
        q_cir = β·ΣQ/(c·Δt) и разносится по кольцам пропорционально теплопотерям.
        Температура при этом становится следствием, а не условием.
    */
    this.useNormMethod = false;

    /*
        Брать в формулу только теплопотери подающих Т3, без обратки Т4.

        Отступление от СП и сделано осознанно. Формула норматива сводит теплопотери
        ВСЕЙ системы с перепадом ТОЛЬКО по подаче — это запас, а не тождество:
        до потребителя вода идёт по Т3, обратка остывает уже за ним.
    */
    this.normHeatSupplyOnly = true;

    // --- теплопотери, СП 61.13330.2012 прил. Э ----------------------------

    /** Коэффициент теплоотдачи с поверхности изоляции α, Вт/(м²·К). Табл. Э.2: в помещении 7. */
    this.alpha = 7.0;

    /** Температура окружающего воздуха, °C. */
    this.ambientTemperature = 20.0;

    /*
        Коэффициент дополнительных потерь через опоры, подвески и арматуру
        (СП 61.13330 табл. 13): Q = q·L·(1 + β_мест).
    */
    this.localHeatFactor = 0.20;

    /** Теплопроводность изоляции, Вт/(м·К), если у материала не задано свойство. */
    this.defaultLambda = 0.040;

    /** Считать ли теплопотери неизолированных труб (R = только теплоотдача). */
    this.countBarePipes = true;

    /** Зоны, у которых условия прокладки отличаются от общих. */
    this.zones = [];

    // --- полотенцесушители ------------------------------------------------

    /** Теплоотдача одного полотенцесушителя, Вт. */
    this.towelRailWatts = 150.0;

    /** Подстрока, по которой опознаётся полотенцесушитель при импорте. */
    this.towelRailKeyword = 'полотенц';

    // --- гидравлика -------------------------------------------------------

    /** Эквивалентная шероховатость трубы, мм, если материал не опознан. */
    this.roughnessMm = 0.2;

    /** Доля местных потерь напора от линейных. Для сетей ГВС обычно 0,2. */
    this.localPressureFactor = 0.20;

    /** Допустимая скорость в циркуляционном режиме, м/с. */
    this.maxVelocity = 1.5;

    /** Скорость, ниже которой участок помечается как завышенный по диаметру, м/с. */
    this.minVelocity = 0.1;

    /** Допустимая невязка колец, доля. */
    this.allowedImbalance = 0.10;

    // --- балансировочная арматура -----------------------------------------

    /*
        Фирма, из каталога которой подбираются клапаны. На ручной выбор
        не влияет: там артикул задан, и спорить с ним не о чем.
    */
    this.valveBrand = 'VALTEC';

    // --- циркуляционный насос ---------------------------------------------

    /*
        Запас напора при подборе насоса, раз. Нужен не на неточность расчёта,
        а на то, чего в расчёте нет: труба зарастает дальше, клапаны
        подкручивают при наладке, фильтр забивается. Больше брать смысла мало:
        излишек напора всё равно придётся душить клапанами, а они от этого шумят.
    */
    this.pumpHeadReserve = 1.2;

    /** Максимум итераций подбора расходов. */
    this.maxIterations = 200;

    /** Порог сходимости по расходу, доля. */
    this.convergence = 1e-4;
}

/** Коэффициент теплоотдачи для зоны: её собственный, иначе общий. */
CalcSettings.prototype.alphaFor = function (zoneKey) {
    var zone = this.zoneFor(zoneKey);
    return zone && zone.hasAlpha ? zone.alpha : this.alpha;
};

/** Температура окружающего воздуха для зоны: её собственная, иначе общая. */
CalcSettings.prototype.ambientFor = function (zoneKey) {
    var zone = this.zoneFor(zoneKey);
    return zone && zone.hasAmbient ? zone.ambient : this.ambientTemperature;
};

CalcSettings.prototype.zoneFor = function (zoneKey) {
    if (!zoneKey) return null;
    for (var i = 0; i < this.zones.length; i++) {
        if (this.zones[i].zoneKey === zoneKey)
            return this.zones[i];
    }
    return null;
};

/** Условия зоны, создавая запись при первом обращении. */
CalcSettings.prototype.zoneEnsure = function (zoneKey) {
    var zone = this.zoneFor(zoneKey);
    if (!zone) {
        zone = new ZoneConditions(zoneKey);
        this.zones.push(zone);
    }
    return zone;
};

/** Копия для сохранения в файл проекта. Пустые переопределения не пишутся. */
CalcSettings.prototype.toJSON = function () {
    var plain = {};
    for (var key in this) {
        if (!this.hasOwnProperty(key) || key === 'zones') continue;
        plain[key] = this[key];
    }

    plain.zones = [];
    for (var i = 0; i < this.zones.length; i++) {
        var zone = this.zones[i];
        if (zone.isEmpty() || !zone.zoneKey) continue;
        plain.zones.push({
            zoneKey: zone.zoneKey,
            hasAlpha: zone.hasAlpha, alpha: zone.alpha,
            hasAmbient: zone.hasAmbient, ambient: zone.ambient
        });
    }

    return plain;
};

CalcSettings.fromJSON = function (plain) {
    var settings = new CalcSettings();
    if (!plain) return settings;

    for (var key in plain) {
        if (!plain.hasOwnProperty(key) || key === 'zones') continue;
        if (settings.hasOwnProperty(key))
            settings[key] = plain[key];
    }

    if (plain.zones) {
        for (var i = 0; i < plain.zones.length; i++) {
            var raw = plain.zones[i];
            var zone = new ZoneConditions(raw.zoneKey);
            zone.hasAlpha = !!raw.hasAlpha;
            zone.alpha = raw.alpha || 0.0;
            zone.hasAmbient = !!raw.hasAmbient;
            zone.ambient = raw.ambient || 0.0;
            if (!zone.isEmpty())
                settings.zones.push(zone);
        }
    }

    return settings;
};
