'use strict';

/*
    Задание от АПТ для смежников — электриков (ЭЛ) и слаботочников (СС).

    Бланк бюро: шапка с объектом, шифром, стадией и ревизией, потом таблица
    позиций. В каждой позиции — что подключать (категория и марка), сколько
    штук рабочих и резервных, мощность и напряжение, нужна ли диспетчеризация,
    и самое ценное для СС — описание логики работы: что от чего включается,
    куда выводятся сигналы.

    Позиции собираются из книги сами: насосные установки и жокеи берут марку и
    мощность из каталожных листов (вкладка «Насосы…»), узлы управления — из
    исходных данных систем, сигнализаторы и пожарные краны — из того, что
    нарисовано на планах. Поэтому задание заполняется сразу после подбора
    насосов, а не переписывается руками из записки.

    Своё в задании правится и остаётся в книге: проектные номера, номера
    помещений, напряжение, протокол, примечания и сами описания. Строку можно
    выключить из задания или добавить свою.
*/

var Task = (function () {

    /* --- категории бланка -------------------------------------------------- */

    var CATEGORIES = [
        'Насосная станция',
        'Жокей-насос',
        'Электрифицированная задвижка',
        'Сигнализаторы потока жидкости',
        'Запорная арматура с контролем положения',
        'Пожарные головки',
        'Узел управления',
        'Пожарный кран с датчиком положения',
        'Эксгаустер',
        'Акселератор',
        'Компрессор',
        'Запорная арматура с электроприводом'
    ];

    var PROTOCOLS = ['Импульсный выход', 'RS-485', 'Ethernet', '-'];

    function create() {
        return {
            stage: 'П',
            revision: 'Р01',
            date: '',
            step: '1 - й этап',
            developer: '',
            issuer: '',
            receiver: '',

            // Где стоит насосная: номер помещения идёт в каждую её позицию.
            room: '',
            voltage: 380,
            protocol: 'RS-485',

            rows: {},           // правки автоматических позиций по ключу
            extra: [],          // свои позиции
            template: null      // бланк бюро .xlsx, если загружен
        };
    }

    function isObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    function normalize(data) {
        var t = create();

        Object.keys(data || {}).forEach(function (key) {
            if (data[key] !== undefined && !isObject(data[key]) && !Array.isArray(data[key])) t[key] = data[key];
        });

        t.rows = isObject(data && data.rows) ? data.rows : {};
        t.extra = Array.isArray(data && data.extra) ? data.extra.map(function (r) {
            return {
                key: r.key || ('x' + Math.random().toString(36).slice(2, 8)),
                category: r.category || CATEGORIES[0],
                name: r.name || '',
                room: r.room || '',
                code: r.code || '',
                note: r.note || '',
                work: r.work === undefined ? 1 : r.work,
                reserve: r.reserve === undefined ? 0 : r.reserve,
                power: r.power || '',
                voltage: r.voltage === undefined ? '' : r.voltage,
                telemetry: r.telemetry === undefined ? 'Да' : r.telemetry,
                protocol: r.protocol || '-',
                remark: r.remark || '',
                off: !!r.off
            };
        }) : [];

        if (isObject(data && data.template)) t.template = data.template;
        return t;
    }

    /* --- описания: логика работы ------------------------------------------- */

    /*
        Логика пожарной насосной — то, ради чего задание и пишется. Текст идёт
        от состава: у ВПВ пуск от кнопок у пожарных кранов, у АУП — от
        сигнализаторов давления в обвязке узлов управления. Общее — жокей,
        резервный насос через 20 с, сигналы дежурному персоналу.
    */
    function stationText(book, item, hasJockey) {
        var t = book.text || {};
        var kinds = kindsOf(item);
        var vpv = kinds.indexOf('ВПВ') >= 0;
        var apt = kinds.indexOf('АПТ') >= 0;
        var delta = Fmt.trim(t.jockeyDelta > 0 ? t.jockeyDelta : 5, 0);
        var lines = [];

        lines.push('В дежурном режиме трубопроводы системы ' + codeOf(item) + ' заполнены водой, '
            + 'рабочее давление поддерживает '
            + (hasJockey ? 'жокей-насос' : 'напор наружной сети') + '.');

        if (hasJockey) {
            lines.push('Жокей-насос включается автоматически при снижении давления ниже дежурного и '
                + 'отключается при повышении давления на 0,05 МПа выше дежурного. Сигнал на отключение '
                + 'жокей-насоса и включение основного рабочего насоса подаётся при снижении давления в '
                + 'системе ниже расчётного не более чем на 0,05 МПа. Напор жокей-насоса принят на '
                + delta + ' м выше напора основной установки.');
        }

        if (apt) {
            lines.push('Импульс на включение насосной установки и отключение жокей-насоса формируют '
                + 'сигнализаторы давления в обвязке узлов управления: при срабатывании оросителя '
                + 'открывается узел управления, и давление в питающем трубопроводе падает.');
        }

        if (vpv) {
            lines.push('Запуск насосной установки, открытие электрифицированных задвижек на обводных '
                + 'линиях водомерного узла и отключение жокей-насоса выполняются также от кнопок '
                + 'ручного пуска, установленных возле пожарных шкафов или внутри них.');
        }

        lines.push('Предусмотреть дистанционное включение пожарных насосов из диспетчерского пункта.');
        lines.push('Если электродвигатель рабочего пожарного насоса не включается или насос не '
            + 'обеспечивает расчётного давления, через 20 с включается электродвигатель резервного '
            + 'пожарного насоса.');
        lines.push('Пожарные насосы относятся ко II категории по степени обеспеченности подачи воды '
            + '(СП 8.13130) и к I категории надёжности электроснабжения (ПУЭ).');
        lines.push('Сигналы о работе системы выводятся в помещение дежурного персонала. В помещении '
            + 'с круглосуточным пребыванием обслуживающего персонала выполнить световую и звуковую '
            + 'сигнализацию: об открытии задвижек с электроприводом; о начале работы установки; '
            + 'о неисправности установки; о падении давления в сети водопровода.');

        return lines.join('\n');
    }

    function codeOf(item) {
        return item.kind === 'station' ? (item.station.zone || item.station.name) : item.sys.code;
    }

    /** Состав насосной словами: «ВПВ», «АПТ» или «ВПВ+АПТ». */
    function kindsOf(item) {
        var list = item.kind === 'station' ? (item.kinds || []) : [item.sys.kind];
        var out = [];

        list.forEach(function (k) {
            var name = k === 'vpv' || k === 'vpvplan' ? 'ВПВ' : 'АПТ';
            if (out.indexOf(name) < 0) out.push(name);
        });

        out.sort(function (a, b) { return a === 'ВПВ' ? -1 : b === 'ВПВ' ? 1 : 0; });
        return out;
    }

    /* --- позиции задания --------------------------------------------------- */

    function pumpRow(book, id, role) {
        var list = (book.text && book.text.pumps) || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id && (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    /** «1 раб., 1 рез.» → { work: 1, reserve: 1 }. */
    function countOf(text, fallbackWork, fallbackReserve) {
        var work = fallbackWork;
        var reserve = fallbackReserve;
        var m = String(text || '').match(/(\d+)\s*раб/);
        var r = String(text || '').match(/(\d+)\s*рез/);

        if (m) work = Number(m[1]);
        if (r) reserve = Number(r[1]);
        return { work: work, reserve: reserve };
    }

    function make(key, category, fields) {
        var row = {
            key: key,
            category: category,
            name: '',
            room: '',
            code: '',
            note: '',
            work: 0,
            reserve: 0,
            power: '',
            voltage: '',
            telemetry: 'Да',
            protocol: '-',
            remark: '',
            off: false
        };

        Object.keys(fields || {}).forEach(function (k) { row[k] = fields[k]; });
        return row;
    }

    /**
     * Позиции задания по книге. Правки из book.task.rows накладываются сверху:
     * что человек вписал, расчёт больше не трогает.
     */
    function rows(book, data) {
        var task = book.task || create();
        var info = data || Tch.systems(book);
        var owners = Tch.owners(info);
        var out = [];
        var airSystems = [];
        var pk = 0;
        var cu = 0;
        var floors = 0;

        info.all.forEach(function (item) {
            var set = item.set || {};
            if (item.kind === 'apt' && set.systemKind === 'воздухозаполненная') airSystems.push(item.sys.code);
            if (item.kind === 'floors' && item.f && item.f.plans) floors += item.f.plans.length;
            if (item.kind === 'apt' || item.kind === 'floors') cu++;
            // Сколько пожарных кранов: на плане — нарисованные, на стояках —
            // по числу этажей секций и кранов на этаже.
            if (item.kind === 'vpvplan' && item.calc && item.calc.ok) pk += item.calc.hydrants.length;
            if (item.kind === 'vpv' && item.v) {
                var perFloor = item.v.pk.perFloor > 0 ? item.v.pk.perFloor : 1;
                item.v.sections.forEach(function (sec) { pk += Vpv.floorsOf(sec).length * perFloor; });
            }
        });

        /* --- насосные установки и жокеи --- */
        owners.forEach(function (item) {
            var need = Tch.pumpNeed(item);
            if (!(need.H > 0)) return;

            var id = item.sys.id;
            var main = pumpRow(book, id, 'main') || {};
            var jockey = pumpRow(book, id, 'jockey');
            var hasJockey = Appendix.jockeyOn(item);
            var count = countOf(main.count, 1, 1);

            out.push(make('pump:' + id, 'Насосная станция', {
                name: main.name || '',
                room: task.room,
                note: stationText(book, item, hasJockey),
                work: count.work,
                reserve: count.reserve,
                power: main.power || '',
                voltage: task.voltage,
                protocol: task.protocol,
                remark: 'Q = ' + Fmt.num(need.Q, 2) + ' л/с, H = ' + Fmt.num(need.H, 2) + ' м'
                    + (need.zone ? '; ' + need.zone : '')
            }));

            if (hasJockey) {
                var jc = countOf(jockey && jockey.count, 1, 0);
                out.push(make('jockey:' + id, 'Жокей-насос', {
                    name: (jockey && jockey.name) || '',
                    room: task.room,
                    note: 'Жокей-насос системы ' + codeOf(item) + '. Описание работы — см. позицию '
                        + 'насосной станции этой системы. Обвязка выполняется арматурой с контролем '
                        + 'положения запорного органа («закрыто» — «открыто»).',
                    work: jc.work,
                    reserve: jc.reserve,
                    power: (jockey && jockey.power) || '',
                    voltage: task.voltage,
                    protocol: task.protocol
                }));
            }
        });

        var pumps = out.length > 0;

        /* --- арматура и сигнализация --- */
        if (pumps) {
            out.push(make('valves', 'Электрифицированная задвижка', {
                room: task.room,
                note: 'На обводных линиях водомерного узла (на ответвлениях от ввода водопровода) '
                    + 'устанавливаются две задвижки с электроприводом. Задвижки открываются по сигналу '
                    + 'от насосной станции пожаротушения, от кнопок у пожарных кранов или от пульта '
                    + 'диспетчера. Положение запорного органа контролируется автоматически.',
                work: 2,
                reserve: 0,
                voltage: task.voltage,
                protocol: task.protocol
            }));
        }

        if (cu > 0) {
            out.push(make('cu', 'Узел управления', {
                name: cuNames(info),
                room: task.room,
                note: 'Узлы управления спринклерных секций с сигнализаторами давления. При срабатывании '
                    + 'оросителя узел управления открывается, сигнализатор давления даёт импульс на '
                    + 'включение насосной установки и отключение жокей-насоса, а также сигнал '
                    + '«Пожар» с адресом секции.',
                work: cu,
                reserve: 0,
                protocol: task.protocol
            }));
        }

        if (floors > 0) {
            out.push(make('spj', 'Сигнализаторы потока жидкости', {
                room: 'см. планы',
                note: 'На каждом этаже (отростке стояка) устанавливается сигнализатор потока жидкости '
                    + 'для адресной идентификации сработавшего оросителя или утечки. Сигнал выводится '
                    + 'на пожарный пост.',
                work: floors,
                reserve: 0,
                protocol: task.protocol
            }));
        }

        out.push(make('armature', 'Запорная арматура с контролем положения', {
            room: 'см. схему',
            note: 'В системе пожаротушения, включая насосные установки, устанавливается запорная '
                + 'арматура с устройством контроля положения для визуального и автоматического '
                + 'контроля положения запорного органа («закрыто» — «открыто»). Сигналы положения '
                + 'выводятся на пожарный пост.',
            protocol: task.protocol
        }));

        if (pk > 0 || hasVpv(info)) {
            out.push(make('pkbuttons', 'Пожарный кран с датчиком положения', {
                room: 'см. планы',
                note: 'У пожарных кранов (возле шкафа или в шкафу) устанавливаются кнопки ручного пуска '
                    + 'насосной станции пожаротушения. Нажатие кнопки запускает насосную установку, '
                    + 'открывает задвижки с электроприводом на вводе и отключает жокей-насос. '
                    + 'Дополнительно предусматривается датчик положения пожарного крана.',
                work: pk,
                reserve: 0,
                protocol: task.protocol
            }));
        }

        airSystems.forEach(function (code, i) {
            out.push(make('compressor:' + code, 'Компрессор', {
                room: task.room,
                note: 'Система ' + code + ' воздухозаполненная: в дежурном режиме трубопроводы за узлом '
                    + 'управления заполнены воздухом под давлением, которое поддерживает компрессор. '
                    + 'Сигнал о падении давления воздуха выводится на пожарный пост.',
                work: 1,
                reserve: 0,
                voltage: task.voltage,
                protocol: task.protocol
            }));
            if (i === 0) {
                out.push(make('exhauster', 'Эксгаустер', {
                    room: task.room,
                    note: 'Для ускорения подачи воды в воздухозаполненную установку предусматривается '
                        + 'эксгаустер (акселератор) на узле управления.',
                    work: airSystems.length,
                    reserve: 0,
                    protocol: task.protocol
                }));
            }
        });

        if (pumps) {
            out.push(make('board', 'Табло «Насосная станция пожаротушения»', {
                room: task.room,
                note: 'У входа в насосную станцию устанавливается световое табло «Насосная станция '
                    + 'пожаротушения», подключённое к сети аварийного освещения.',
                work: 1,
                reserve: 0,
                telemetry: 'Нет'
            }));

            out.push(make('phone', 'Телефонная связь', {
                room: task.room,
                note: 'Насосная станция оборудуется телефонной связью (или другим видом оперативной '
                    + 'связи) с помещением пожарного поста. Температура воздуха в насосной — не ниже '
                    + '5 °C, предусмотрены рабочее и аварийное освещение.',
                telemetry: 'Нет'
            }));

            out.push(make('heads', 'Пожарные головки', {
                room: 'фасад',
                note: 'На фасаде здания у пожарных патрубков ГМ-80 для подключения передвижной пожарной '
                    + 'техники выполнить освещение и указатели.',
                telemetry: 'Нет'
            }));
        }

        /* --- правки человека и свои позиции --- */
        out = out.map(function (row) {
            var own = task.rows[row.key];
            if (!own) return row;
            Object.keys(own).forEach(function (k) {
                if (own[k] !== undefined && own[k] !== null && own[k] !== '') row[k] = own[k];
            });
            row.off = !!own.off;
            return row;
        });

        task.extra.forEach(function (row) { out.push(row); });

        return out.filter(function (row) { return !row.off; });
    }

    function hasVpv(info) {
        return info.vpv.length > 0;
    }

    /** Марки узлов управления по системам: «Прямоточный Ду150 (В21)». */
    function cuNames(info) {
        var seen = [];
        info.all.forEach(function (item) {
            if (item.kind !== 'apt' && item.kind !== 'floors') return;
            var s = item.set || {};
            var text = item.kind === 'floors' && item.f
                ? item.f.inlet.cuKind + ' Ду' + item.f.inlet.cuDn
                : s.cuKind + ' Ду' + s.cuDn;
            if (seen.indexOf(text) < 0) seen.push(text);
        });
        return seen.join('; ');
    }

    /** Чего в задании не хватает — видно до выгрузки. */
    function warnings(book, list) {
        var out = [];

        (list || rows(book)).forEach(function (row) {
            if (row.category === 'Насосная станция' || row.category === 'Жокей-насос') {
                if (!row.name) out.push(row.category + ': не задана марка — загрузите каталожный лист во вкладке «Насосы…».');
                if (!row.power) out.push((row.name || row.category) + ': не задана мощность, кВт.');
            }
            if (!row.room) out.push((row.name || row.category) + ': не задан номер помещения.');
        });

        return out;
    }

    return {
        CATEGORIES: CATEGORIES,
        PROTOCOLS: PROTOCOLS,
        create: create,
        normalize: normalize,
        rows: rows,
        warnings: warnings,
        stationText: stationText,
        countOf: countOf
    };
})();
