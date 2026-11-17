'use strict';

/*
    Цвета схем и правила раскраски.

    Т3 красный, Т4 бирюзовый. Синий занят интерфейсом, и труба, покрашенная в него,
    сливалась бы с рамками панелей — поэтому циркуляционный взят сине-зелёным,
    а не синим, как в плагине.

    Т4 без циркуляции остаётся оранжевым: циркуляционный трубопровод, через который
    ничего не течёт, — всегда ошибка, и увидеть её надо сразу.
*/

var Theme = {
    background: '#F5F9FD',
    grid: '#E3EDF6',
    gridMajor: '#CFDFEE',
    axisX: '#C9736C',
    axisY: '#6FA98C',
    axisZ: '#6E8FB8',

    text: '#1B2A38',
    textDim: '#5B7186',
    labelHalo: 'rgba(255,255,255,0.86)',

    supply: '#D2413A',          // Т3 подающий
    circulation: '#1F9BB5',     // Т4 циркуляционный
    noCirculation: '#E8892B',   // Т4 без циркуляции — всегда ошибка
    ringClosure: '#7A5AA8',     // перемычка Т3–Т4
    sourceLink: '#1D6FB8',      // замыкание внутри ИТП
    stitch: '#8FA3B5',          // сшивка разрыва
    deadEnd: '#9FB3C4',         // тупиковая подводка

    selection: '#17916B',
    highlight: '#F0B429',
    source: '#1D6FB8',          // ИТП
    valve: '#17916B',           // балансировочный клапан
    cold: '#C0392B',            // узел ниже требуемой температуры

    /** Шкала «холодно → горячо» для раскраски по температуре. */
    temperatureScale: ['#2E86D6', '#4FB0A5', '#8CC63F', '#F0B429', '#E8892B', '#D2413A'],

    /** Шкала «медленно → быстро» для скорости и расхода. */
    rateScale: ['#BBD3E8', '#7FB2DA', '#4F97C9', '#2E7FB8', '#E8892B', '#D2413A']
};

/** Способы раскраски участков. */
var ColourModes = [
    { key: 'kind', name: 'Тип участка' },
    { key: 'velocity', name: 'Скорость' },
    { key: 'temperature', name: 'Температура' },
    { key: 'flow', name: 'Расход' },
    { key: 'diameter', name: 'Диаметр' }
];

/** Подписи на схемах. Набор общий на оба окна: они означают одно и то же. */
var LabelOptions = {
    nodeNumbers: false,
    temperatures: false,
    segmentNumbers: true,
    flows: false,
    velocities: false,
    diameters: true,
    lengths: false,
    ringNumbers: true,
    arrows: true,

    keys: ['nodeNumbers', 'temperatures', 'segmentNumbers', 'flows',
           'velocities', 'diameters', 'lengths', 'ringNumbers', 'arrows'],

    captions: {
        nodeNumbers: 'Номера узлов',
        temperatures: 'Температуры',
        segmentNumbers: 'Номера участков',
        flows: 'Расходы',
        velocities: 'Скорости',
        diameters: 'Диаметры',
        lengths: 'Длины',
        ringNumbers: 'Номера колец',
        arrows: 'Направление течения'
    },

    setAll: function (value) {
        for (var i = 0; i < LabelOptions.keys.length; i++)
            LabelOptions[LabelOptions.keys[i]] = value;
    },

    anyOn: function () {
        for (var i = 0; i < LabelOptions.keys.length; i++) {
            if (LabelOptions[LabelOptions.keys[i]]) return true;
        }
        return false;
    }
};

/** Цвет по положению значения между границами шкалы. */
function scaleColour(scale, value, low, high) {
    if (!isFinite(value) || high - low < 1e-9)
        return scale[0];

    var share = (value - low) / (high - low);
    if (share < 0) share = 0;
    if (share > 1) share = 1;

    var index = Math.round(share * (scale.length - 1));
    return scale[index];
}

/**
 * Цвет участка. Раскраска по типу — основная: она показывает, что программа
 * поняла про сеть, а не что она насчитала.
 */
function segmentColour(segment, mode, network) {
    if (mode === 'kind' || !mode) {
        if (segment.isSourceLink) return Theme.sourceLink;
        if (segment.isRingClosure) return Theme.ringClosure;
        if (segment.isVirtualLink) return Theme.stitch;

        if (!segment.isCirculating) {
            // Т4, через который ничего не течёт, надо увидеть сразу.
            return segment.role === PipeRole.Return ? Theme.noCirculation : Theme.deadEnd;
        }

        return segment.role === PipeRole.Return ? Theme.circulation : Theme.supply;
    }

    if (!segment.isCirculating)
        return Theme.deadEnd;

    if (mode === 'velocity')
        return scaleColour(Theme.rateScale, segment.velocity, 0.0, 1.5);

    if (mode === 'temperature')
        return scaleColour(Theme.temperatureScale,
            0.5 * (segment.temperatureIn + segment.temperatureOut), 55.0, 65.0);

    if (mode === 'flow') {
        var top = 0.0;
        for (var i = 0; i < network.segments.length; i++)
            top = Math.max(top, network.segments[i].flow);
        return scaleColour(Theme.rateScale, segment.flow, 0.0, Math.max(top, 1e-6));
    }

    if (mode === 'diameter')
        return scaleColour(Theme.rateScale, segment.nominalDiameterMm, 15.0, 100.0);

    return Theme.supply;
}

/** Толщина линии участка: условный диаметр, но в разумных пределах. */
function segmentWidth(segment, selected) {
    var dn = segment.nominalDiameterMm > 0 ? segment.nominalDiameterMm : 20.0;
    var width = 1.4 + Math.sqrt(dn) * 0.28;

    if (segment.isVirtualLink)
        width = Math.min(width, 2.2);

    return selected ? width + 2.2 : width;
}
