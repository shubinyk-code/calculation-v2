'use strict';

/*
    Доменная модель сети ГВС. Порт HotWaterCirculation/src/CalcModel.cs.

    Одно расширение против плагина, оно же — следствие решения «две независимые схемы».
    У узла две координаты: point3d — положение в пространстве, pointFlat — положение
    на плоской принципиальной схеме. Расчёту не нужна ни та, ни другая: ему нужна
    длина участка, и она хранится отдельным полем. Поэтому узел можно двигать
    на любой схеме, ничего не ломая, а длину править числом.
*/

/** Роль трубопровода в системе ГВС. */
var PipeRole = {
    None: 0,
    Supply: 3,      // подающий, Т3 и её варианты
    Return: 4       // циркуляционный, Т4 и её варианты
};

function roleCaption(role) {
    if (role === PipeRole.Supply) return 'Т3';
    if (role === PipeRole.Return) return 'Т4';
    return '—';
}

/** Точка в метрах. */
function Pt3(x, y, z) {
    this.x = x || 0.0;
    this.y = y || 0.0;
    this.z = z || 0.0;
}

Pt3.prototype.distanceTo = function (other) {
    var dx = this.x - other.x;
    var dy = this.y - other.y;
    var dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

Pt3.prototype.clone = function () {
    return new Pt3(this.x, this.y, this.z);
};

Pt3.middle = function (a, b) {
    return new Pt3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
};

/** Узел сети: точка стыка либо место с числом присоединений, отличным от двух. */
function HwNode(index, point) {
    this.index = index;
    this.point3d = point || new Pt3(0, 0, 0);

    /* Положение на плоской принципиальной схеме, условные единицы. */
    this.pointFlat = { x: 0.0, y: 0.0 };
    this.flatPlaced = false;

    this.segments = [];

    /** Температура воды в узле, °C. Заполняется расчётом. */
    this.temperature = 0.0;

    /*
        Номер узловой точки для схем и таблиц, с единицы.
        Ноль — узел не на циркуляции и номера не получил.
    */
    this.number = 0;

    /** Узел объединён с другим в источнике сети — ссылка на ведущий узел. */
    this.mergedInto = -1;

    /** Id элементов модели Revit, если узел пришёл импортом. */
    this.hubElementId = 0;
}

/**
 * Участок: труба между двумя узлами. Единица гидравлического расчёта,
 * таблицы и схемы.
 */
function HwSegment(index, nodeA, nodeB) {
    this.index = index;

    /*
        Номер участка для схем и таблиц, с единицы. Нумеруются только кольцевые
        участки и в том же обходе, что и узлы, — номер читается как маршрут от ИТП.
    */
    this.number = 0;

    this.nodeA = nodeA;
    this.nodeB = nodeB;

    this.zoneKey = null;
    this.role = PipeRole.None;

    /** Имя системы как в модели — для таблиц. */
    this.systemName = null;

    /** Длина по оси трубы, м. Авторитетна для расчёта. */
    this.length = 0.0;

    /** Условный диаметр, мм — им участок подписывается. */
    this.nominalDiameterMm = 0.0;

    /** Наружный диаметр трубы, м. По нему считается теплоотдача. */
    this.outerDiameter = 0.0;

    /** Внутренний диаметр, м. По нему считается скорость и потери напора. */
    this.innerDiameter = 0.0;

    /** Материал трубы — определяет шероховатость и λ стенки. */
    this.material = null;

    /** Достроен вручную или сшивкой, а не начерчен: перемычка или заделка разрыва. */
    this.isVirtualLink = false;

    /*
        Перемычка, замыкающая кольцо: соединяет Т3 с Т4. Сшивка разрыва внутри
        одной системы кольца не замыкает — она лишь восстанавливает целостность трубы.
    */
    this.isRingClosure = false;

    /*
        Условное соединение выхода Т3 и входа Т4 внутри ИТП.

        Не труба и не перемычка: именно оно замыкает граф в цикл. Без него Т3 и Т4
        остаются двумя отдельными деревьями, ни одного цикла в графе нет, и разделить
        кольцевые участки от тупиковых становится нечем.

        Достраивается расчётом по помеченным узлам ИТП и в кольцо не входит:
        теплообменник — источник напора кольца, а не его сопротивление.
    */
    this.isSourceLink = false;

    /** Число полотенцесушителей, отнесённых к участку. */
    this.towelRailCount = 0;

    /** Балансировочный клапан, поставленный человеком на этот участок. */
    this.valve = null;

    // --- заполняется разбором колец ---

    this.isExcluded = false;
    this.isCirculating = false;
    this.ringIndices = [];

    // --- заполняется расчётом ---

    this.insulationThickness = 0.0;   // м
    this.insulationLambda = 0.0;      // Вт/(м·К)
    this.insulationName = null;
    this.ambientTemperature = 0.0;    // °C
    this.alpha = 0.0;                 // Вт/(м²·К)
    this.heatFluxPerMetre = 0.0;      // Вт/м
    this.heatLoss = 0.0;              // Вт, с местными потерями и полотенцесушителями
    this.flow = 0.0;                  // кг/ч, по модулю

    /** Куда течёт: +1 от узла A к узлу B, −1 обратно, 0 — расхода нет. */
    this.flowDirection = 0;

    this.velocity = 0.0;              // м/с
    this.pipeDrop = 0.0;              // Па, только труба
    this.valveDrop = 0.0;             // Па, только клапан
    this.pressureDrop = 0.0;          // Па, труба вместе с клапаном
    this.temperatureIn = 0.0;         // °C
    this.temperatureOut = 0.0;        // °C

    /** Рекомендуемый Ду, мм, если скорость вышла за допустимый диапазон. Иначе 0. */
    this.suggestedDiameterMm = 0.0;

    this.note = null;

    /** Id элементов модели Revit, если участок пришёл импортом. */
    this.elementIds = [];

    /** Ломаная по узлам свёрнутой цепочки — участок с отводами идёт не по прямой. */
    this.polyline = [];
}

HwSegment.prototype.hasInsulation = function () {
    return this.insulationThickness > 1e-6 && this.insulationLambda > 1e-9;
};

HwSegment.prototype.otherNode = function (node) {
    return node === this.nodeA ? this.nodeB : this.nodeA;
};

/**
 * Балансировочный клапан на участке.
 *
 * automatic — клапан подставлен расчётом, а не поставлен человеком; такой
 * исчезает, как только перестаёт быть нужен.
 *
 * chosenArticle — типоразмер, заданный человеком. null означает «подбирает
 * программа». Это решение человека, а не итог расчёта, поэтому пересчёт его
 * не трогает: сбрасываются только подобранные числа.
 */
function newValveState(automatic) {
    return {
        automatic: !!automatic,
        inUse: false,
        chosenArticle: null,
        byHand: false,
        model: null,
        position: 0,
        exactPosition: 0.0,
        requiredKv: 0.0,
        actualKv: 0.0,
        actualDrop: 0.0,
        ringNumber: 0,
        note: ''
    };
}

/** Циркуляционное кольцо: путь от источника по Т3 до перемычки и обратно по Т4. */
function HwRing(index) {
    this.index = index;
    this.number = 0;
    this.zoneKey = null;

    /** Перемычка, на которой кольцо замыкается. */
    this.linkIndex = -1;

    /** Узел перед перемычкой на подающей стороне — самая дальняя точка кольца. */
    this.farNode = -1;

    /** Узел ИТП, от которого идёт это кольцо. */
    this.sourceNode = -1;

    /** Участки кольца в порядке от источника по Т3, через перемычку и обратно по Т4. */
    this.segments = [];

    /** Участки, принадлежащие только этому кольцу (без общих магистралей). */
    this.ownSegments = [];

    this.length = 0.0;                // м
    this.heatLoss = 0.0;              // Вт, по собственным участкам кольца
    this.flow = 0.0;                  // кг/ч
    this.pipeDrop = 0.0;              // Па, только трубы — база сравнения при увязке
    this.pressureDrop = 0.0;          // Па, трубы вместе с клапанами
    this.temperatureAtEnd = 0.0;      // °C в самой дальней точке кольца
    this.imbalance = 0.0;             // доля: (dP_max − dP)/dP_max
    this.requiredValveDrop = 0.0;     // Па, которые должен добавить клапан
    this.requiredKv = 0.0;            // м³/ч при 1 бар
    this.isWorstRing = false;
    this.needsValve = false;

    /** Условный диаметр трубы там, где стоит клапан. */
    this.valvePipeDN = 0.0;

    /** Участок, на котором стоит увязывающий клапан кольца. −1 — клапана нет. */
    this.valveSegment = -1;

    /** Подобранный клапан и его настройка. */
    this.valve = null;

    this.note = null;
}

/** Зона ГВС: пара подающей и циркуляционной систем с общим ключом. */
function HwZone(key, caption) {
    this.key = key;
    this.caption = caption || key;
    this.isEnabled = true;

    this.supplyNames = [];
    this.returnNames = [];

    this.segments = [];
    this.rings = [];

    this.heatLoss = 0.0;              // Вт, Т3 + Т4 + полотенцесушители
    this.heatLossSupply = 0.0;        // Вт, трубы Т3
    this.heatLossReturn = 0.0;        // Вт, трубы Т4
    this.towelHeat = 0.0;             // Вт
    this.towelCount = 0;

    this.lengthSupply = 0.0;          // м
    this.lengthReturn = 0.0;          // м

    this.flow = 0.0;                  // кг/ч
    this.minTemperature = 0.0;        // °C, худшая точка зоны

    /*
        Обратка на входе в ИТП: смешанная температура всех циркуляционных
        веток, сошедшихся на вводе. Это не то же, что худшая точка зоны:
        у потребителя важна самая холодная ветка, а теплообменник греет
        уже перемешанную воду. Отсюда и считается нагрузка на циркуляцию.
    */
    this.returnTemperature = 0.0;     // °C, смешанная обратка на вводе ИТП
    this.returnFlow = 0.0;            // кг/ч, пришедший по обратке
    this.itpDeltaT = 0.0;             // К, подогрев в ИТП: подача − обратка
    this.itpHeat = 0.0;               // Вт, c·G·Δt — нагрузка на циркуляцию

    /** Потери самого невыгодного кольца зоны, Па — требуемый напор насоса. */
    this.worstDrop = 0.0;
    this.worstRingNumber = 0;

    /** Подобранный циркуляционный насос. null — не подбирался. */
    this.pump = null;

    this.note = null;
}

/** Вся сеть ГВС в разобранном виде. Результат анализа и вход расчёта. */
function HwNetwork() {
    this.nodes = [];
    this.segments = [];
    this.rings = [];
    this.zones = [];

    /*
        Узлы всех источников. В ИТП обычно несколько выходов — по зонам плюс
        встройка, — и у каждого своя пара «выход Т3, вход Т4».
    */
    this.sourceNodes = [];

    /** Узлы, из которых вода выходит из ИТП. Заполняется разбором пар. */
    this.supplySourceNodes = [];

    /** Замечания к разбору: разрывы, участки без изоляции, стояки без циркуляции. */
    this.diagnostics = [];

    /** Пары свободных концов, стоящие рядом, но не уложившиеся в допуск. */
    this.candidates = [];
}

/**
 * Первый узел источника: им помечается ИТП на схемах и с него начинается
 * нумерация. Расчёт работает со всем списком sourceNodes.
 */
Object.defineProperty(HwNetwork.prototype, 'sourceNode', {
    get: function () {
        return this.sourceNodes.length > 0 ? this.sourceNodes[0] : -1;
    }
});

HwNetwork.prototype.isSource = function (node) {
    return node >= 0 && this.sourceNodes.indexOf(node) >= 0;
};

/**
 * Узел, из которого вода выходит из ИТП. Расчётные 65 °C держатся только на нём:
 * вход Т4 — это конец пути, туда вода приходит уже остывшей, и подменять её
 * температуру подачей значило бы скрыть как раз то, ради чего считают.
 *
 * Пока пары не разобраны, список пуст, и подающим считается любой источник —
 * так ведёт себя сеть с одним слитым узлом ИТП, как в плагине.
 */
HwNetwork.prototype.isSupplySource = function (node) {
    if (this.supplySourceNodes.length === 0)
        return this.isSource(node);

    return node >= 0 && this.supplySourceNodes.indexOf(node) >= 0;
};

HwNetwork.prototype.zone = function (key) {
    for (var i = 0; i < this.zones.length; i++) {
        if (this.zones[i].key === key)
            return this.zones[i];
    }
    return null;
};

HwNetwork.prototype.zoneEnsure = function (key, caption) {
    var zone = this.zone(key);
    if (!zone) {
        zone = new HwZone(key, caption);
        this.zones.push(zone);
    }
    return zone;
};

HwNetwork.prototype.addNode = function (point) {
    var node = new HwNode(this.nodes.length, point);
    this.nodes.push(node);
    return node;
};

HwNetwork.prototype.addSegment = function (nodeA, nodeB) {
    var segment = new HwSegment(this.segments.length, nodeA, nodeB);
    this.segments.push(segment);
    this.nodes[nodeA].segments.push(segment.index);
    this.nodes[nodeB].segments.push(segment.index);
    return segment;
};

/**
 * Пересборка списков присоединений у узлов. Нужна после удаления участков:
 * индексы в node.segments сдвигаются, и держать их вручную дороже, чем собрать заново.
 */
HwNetwork.prototype.reindex = function () {
    var i;
    for (i = 0; i < this.nodes.length; i++) {
        this.nodes[i].index = i;
        this.nodes[i].segments = [];
    }
    for (i = 0; i < this.segments.length; i++) {
        var segment = this.segments[i];
        segment.index = i;
        if (segment.nodeA >= 0 && segment.nodeA < this.nodes.length)
            this.nodes[segment.nodeA].segments.push(i);
        if (segment.nodeB >= 0 && segment.nodeB < this.nodes.length)
            this.nodes[segment.nodeB].segments.push(i);
    }
};

/** Сброс всего, что насчитано: перед новым прогоном. */
HwNetwork.prototype.clearResults = function () {
    this.rings = [];
    this.diagnostics = [];

    for (var i = 0; i < this.segments.length; i++) {
        var s = this.segments[i];
        s.number = 0;
        s.isCirculating = false;
        s.ringIndices = [];
        s.heatFluxPerMetre = 0.0;
        s.heatLoss = 0.0;
        s.flow = 0.0;
        s.flowDirection = 0;
        s.velocity = 0.0;
        s.pipeDrop = 0.0;
        s.valveDrop = 0.0;
        s.pressureDrop = 0.0;
        s.suggestedDiameterMm = 0.0;
        s.note = null;
    }

    for (var n = 0; n < this.nodes.length; n++) {
        this.nodes[n].number = 0;
        this.nodes[n].temperature = 0.0;
    }

    for (var z = 0; z < this.zones.length; z++) {
        this.zones[z].rings = [];
        this.zones[z].note = null;
    }
};
