'use strict';

/*
    Каталожный лист насосной установки: что из него берётся в таблицу записки.

    Лист Wilo устроен одинаково, поэтому читается по подписям:

        Тип: …                        марка установки, первая строка с «CO …»
        Назначение: ВПВ 1 зона        по нему лист сам ложится на свою систему
        Исходные параметры            подача и напор, которые были заданы
        Фактическая рабочая точка     подача, напор, мощность P2, КПД, NPSH
        Данные мотора                 номинальная мощность, ток, обороты
        Кол-во рабочих и резервных    столбец «Кол-во (раб., рез.)»

    В таблицу 4 записки идут: марка, номинальная мощность, количество насосов и
    фактическая рабочая точка. Требуемые подача и напор остаются из расчёта
    программы — лист только сверяется с ними.

    В листах старого образца подписи набраны с разрядкой («На по р»), поэтому
    все подписи ищутся «свободно»: между буквами допускаются пробелы.
*/

var Pumps = (function () {

    /** Подпись с возможными пробелами между буквами: «На по р» = «Напор». */
    function loose(label) {
        return new RegExp(label.split('').map(function (ch) {
            return /[a-zA-Zа-яА-Я0-9]/.test(ch) ? ch + '\\s*' : ch === ' ' ? '\\s*' : '\\' + ch + '\\s*';
        }).join(''), 'i');
    }

    /*
        Число после подписи. «P2» в хвосте подписи («Ном. мощность Р2 0,75 kW»)
        отбрасывается, иначе двойка приклеивается к числу и получается 20,75.
    */
    function num(text) {
        if (!text) return null;
        var clean = String(text).replace(/[PР]\s*2\b/g, ' ');
        var m = /(-?\d+(?:\s?[.,]\s?\d+)?)/.exec(clean);
        return m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : null;
    }

    /** Число после подписи в строке. */
    function valueAfter(line, label) {
        var m = loose(label).exec(line);
        if (!m) return null;
        return num(line.slice(m.index + m[0].length));
    }

    /** Текст после подписи до конца строки. */
    function textAfter(line, label) {
        var m = loose(label).exec(line);
        if (!m) return null;
        return line.slice(m.index + m[0].length).replace(/^[\s:.]+/, '').trim();
    }

    function has(line, label) {
        return loose(label).test(line);
    }

    /* --- разбор листа --------------------------------------------------------- */

    function parse(pages, fileName) {
        var lines = [];
        pages.forEach(function (p) {
            p.lines.forEach(function (l) { lines.push(l.text); });
        });

        var sheet = {
            file: fileName || '',
            name: '',
            purpose: '',
            project: '',
            duty: { Q: null, H: null },
            actual: { Q: null, H: null, P2: null, eff: null, npsh: null },
            power: null,
            current: null,
            speed: null,
            working: null,
            standby: null,
            pumpType: '',
            control: '',
            dn: '',
            lines: lines
        };

        var mode = '';

        lines.forEach(function (line) {
            if (!sheet.name) {
                // Марка установки: «CO 2 MVL 2003/SK-FFS-R-CS», «COR-3 MVL 806/SKw-EB-R».
                var name = /((?:COR|CO)[\s-]?\d[^\n]*?\/[^\s]+)/.exec(line);
                // В старых листах буквы набраны врозь: «M VL 404» — склеиваем.
                if (name) sheet.name = name[1].trim().replace(/\b([A-Z])\s+(?=[A-Z]{2,})/g, '$1');
            }

            if (!sheet.purpose && has(line, 'Назначение')) sheet.purpose = textAfter(line, 'Назначение') || '';
            if (!sheet.project && has(line, 'Проект')) sheet.project = textAfter(line, 'Проект') || '';

            if (has(line, 'Исходные параметры') || has(line, 'Данные запроса')) mode = 'duty';
            else if (has(line, 'Фактическая рабочая точка') || has(line, 'Рабочая точка')) mode = 'actual';
            else if (has(line, 'Данные продукта') || has(line, 'Материалы') || has(line, 'Подсоединение')) mode = '';
            else if (has(line, 'Данные мотора') || has(line, 'Данные насоса')) mode = 'motor';

            if (mode === 'duty' || mode === 'actual') {
                var target = mode === 'duty' ? sheet.duty : sheet.actual;
                if (target.Q === null && (has(line, 'Подача') || has(line, 'Расход'))) target.Q = valueAfter(line, has(line, 'Подача') ? 'Подача' : 'Расход');
                if (target.H === null && has(line, 'Напор')) target.H = valueAfter(line, 'Напор');
                if (mode === 'actual') {
                    if (sheet.actual.P2 === null && has(line, 'Мощность P2')) sheet.actual.P2 = valueAfter(line, 'Мощность P2');
                    if (sheet.actual.eff === null && has(line, 'КПД')) sheet.actual.eff = valueAfter(line, 'КПД');
                    if (sheet.actual.npsh === null && has(line, 'NPSH')) sheet.actual.npsh = valueAfter(line, 'NPSH');
                }
            }

            if (mode === 'actual' && sheet.actual.P2 === null && has(line, 'Мощность на валу')) sheet.actual.P2 = valueAfter(line, 'Мощность на валу');
            if (sheet.power === null && has(line, 'Номинальная мощность')) sheet.power = valueAfter(line, 'Номинальная мощность');
            if (sheet.power === null && has(line, 'Ном. мощность')) sheet.power = valueAfter(line, 'Ном. мощность');
            if (sheet.current === null && has(line, 'Номинальный ток')) sheet.current = valueAfter(line, 'Номинальный ток');
            if (sheet.speed === null && has(line, 'частота вращения')) sheet.speed = valueAfter(line, 'частота вращения');
            if (sheet.working === null && has(line, 'Кол-во рабочих')) sheet.working = valueAfter(line, 'Кол-во рабочих');
            if (sheet.standby === null && has(line, 'Кол-во резервных')) sheet.standby = valueAfter(line, 'Кол-во резервных');
            if (!sheet.pumpType && has(line, 'Тип насосов')) sheet.pumpType = textAfter(line, 'Тип насосов') || '';
            if (!sheet.control && has(line, 'Прибор управления')) {
                var value = textAfter(line, 'Прибор управления') || '';
                if (/\d/.test(value)) sheet.control = value;
            }
            if (!sheet.dn && /DNs/.test(line)) sheet.dn = (textAfter(line, 'DNs') || '').trim();
        });

        if (!sheet.name && fileName) {
            var fromFile = /((?:CO|COR)[\s-]?\d[^.]*)/.exec(fileName.replace(/_/g, '/'));
            if (fromFile) sheet.name = fromFile[1].trim();
        }

        sheet.count = countText(sheet);
        sheet.role = roleOf(sheet);
        sheet.ok = !!(sheet.name && (sheet.actual.H || sheet.duty.H));
        return sheet;
    }

    /*
        Жокей-насос отличается от основной установки: в названии «CO 1 …/J-ET»,
        в назначении слово «жокей», расход в десятые доли литра. Его лист не
        должен вытеснять лист основной установки той же системы.
    */
    function roleOf(sheet) {
        var text = (sheet.purpose + ' ' + sheet.file + ' ' + sheet.name).toLowerCase();
        if (/жокей|jockey/.test(text)) return 'jockey';
        if (/\/j-et|j-et-r/i.test(sheet.name)) return 'jockey';
        if (/^(?:cor|co)[\s-]?1\b/i.test(sheet.name) && sheet.duty.Q !== null && sheet.duty.Q < 2) return 'jockey';
        return 'main';
    }

    function countText(sheet) {
        var work = sheet.working > 0 ? Math.round(sheet.working) : null;
        var spare = sheet.standby > 0 ? Math.round(sheet.standby) : null;
        if (work === null && spare === null) return '';
        return (work || 0) + ' раб.' + (spare ? ', ' + spare + ' рез.' : '');
    }

    /* --- к какой системе относится лист --------------------------------------- */

    function zoneOf(text) {
        var m = /(\d+)\s*зон/i.exec(text || '');
        return m ? Number(m[1]) : null;
    }

    /** Сколько признаков листа совпало с системой: назначение, зона, код. */
    function score(sheet, item) {
        var purpose = (sheet.purpose + ' ' + sheet.file).toLowerCase();
        var sys = item.sys;
        var title = (sys.code + ' ' + sys.title + ' ' + sys.compartment + ' '
            + (item.kind === 'vpv' ? item.v.zone + ' ' + item.v.purpose : '')
            + (item.kind === 'floors' ? item.f.zone + ' ' + item.f.purpose : ''))
            .toLowerCase();

        // Насосная питает несколько систем: у неё виды всех её систем.
        var kinds = item.kind === 'station' ? item.kinds : [item.kind];
        var isApt = kinds.indexOf('apt') >= 0 || kinds.indexOf('floors') >= 0;
        var isVpv = kinds.indexOf('vpv') >= 0;
        var points = 0;

        if (purpose.indexOf(sys.code.toLowerCase()) >= 0) points += 4;

        var apt = /апт|автоматическ|спринкл|пожаротушени[ея]\s*спринк/.test(purpose);
        var vpv = /впв|внутренн|пожарн(ый|ого)\s*водопровод|кран/.test(purpose);
        if (apt && isApt) points += 2;
        if (vpv && isVpv) points += 2;
        if (apt && !isApt) points -= 2;
        if (vpv && !isVpv) points -= 2;

        var zone = zoneOf(purpose);
        if (zone !== null && zone === zoneOf(title)) points += 2;

        // Похожесть по напору: основную установку подбирали под требуемый напор
        // насоса, а жокей — под напор после насосной установки.
        var need = Tch.pumpNeed(item);
        var reference = sheet.role === 'jockey' ? need.after : need.H;
        var H = sheet.duty.H || sheet.actual.H;
        if (H && reference > 0) {
            var diff = Math.abs(H - reference) / Math.max(reference, 1);
            if (diff < 0.02) points += 3;
            else if (diff < 0.1) points += 2;
            else if (diff < 0.25) points += 1;
        }

        return points;
    }

    /** Подобрать систему книги для листа; null — если подходящей нет. */
    function match(sheet, book) {
        var data = Tch.systems(book);
        var best = null;
        var bestScore = 0;

        Tch.owners(data).forEach(function (item) {
            var points = score(sheet, item);
            if (points > bestScore) {
                bestScore = points;
                best = item.sys.id;
            }
        });

        return bestScore > 0 ? best : null;
    }

    /** Данные листа в строку таблицы 4 записки. */
    function toRow(sheet, id) {
        return {
            id: id,
            role: sheet.role || 'main',
            name: sheet.name,
            zone: sheet.purpose || '',
            power: sheet.power !== null ? String(sheet.power).replace('.', ',') : '',
            count: sheet.count || '1 раб., 1 рез.',
            Qf: sheet.actual.Q !== null ? sheet.actual.Q : '',
            Hf: sheet.actual.H !== null ? sheet.actual.H : '',
            sheet: sheet.file,
            // Сам файл листа — для пакетной печати приложений со штампом.
            file: sheet.bytes ? { name: sheet.file, data: Zip.toBase64(sheet.bytes) } : null,
            dutyQ: sheet.duty.Q,
            dutyH: sheet.duty.H,
            P2: sheet.actual.P2,
            npsh: sheet.actual.npsh,
            control: sheet.control,
            pumpType: sheet.pumpType
        };
    }

    /** Прочитать файл .pdf и разобрать его как каталожный лист. */
    /*
        Вместе с разобранными числами держим и сам файл: по нему потом
        печатается пакет приложений — лист со штампом «Приложение N» в углу.
        Байты лежат в книге, а в память браузера не кладутся: там им тесно.
    */
    function read(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var bytes = new Uint8Array(reader.result);
                Pdf.read(reader.result).then(function (pages) {
                    var sheet = parse(pages, file.name);
                    sheet.bytes = bytes;
                    resolve(sheet);
                }).catch(reject);
            };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsArrayBuffer(file);
        });
    }

    return {
        parse: parse,
        match: match,
        toRow: toRow,
        read: read,
        loose: loose,
        valueAfter: valueAfter
    };
})();
