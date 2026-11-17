'use strict';

/*
    Файл проекта и автосохранение в браузере.

    Файл — «книга объекта» (.aupt.json): данные объекта и список систем.
    Система АПТ хранит свой план (узлы, участки, подложку), система ВПВ —
    секции, этажи и параметры пожарных кранов. Текстовая часть и схема берут
    числа из всех систем разом, поэтому они живут в одном файле.

    Файлы прежнего формата (один план АПТ) открываются как книга с одной
    системой — ничего переделывать не нужно.

    Подложки лежат в файле картинками в base64. В хранилище браузера места
    мало (около 5 МБ), поэтому если с картинками не влезло, книга сохраняется
    без них, а программа говорит об этом вслух.
*/

var Storage = (function () {

    var KEY = 'aupt-web:book';
    var LEGACY_KEY = 'sprinkler-web:project';

    function isObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    /** Глубокое слияние: чего нет в файле, берётся из значений по умолчанию. */
    function merge(target, source) {
        Object.keys(source).forEach(function (key) {
            if (isObject(source[key]) && isObject(target[key])) merge(target[key], source[key]);
            else if (source[key] !== undefined) target[key] = source[key];
        });
        return target;
    }

    /* --- план АПТ ---------------------------------------------------------- */

    function unpack(data) {
        if (!data || data.format !== 'sprinkler-web') {
            throw new Error('Это не файл проекта АУПТ.');
        }

        var p = Model.create();
        p.name = data.name || p.name;
        p.settings = merge(Model.defaults(), data.settings || {});

        // Старые файлы хранили радиус круга орошения, новые — диаметр.
        var old = data.settings || {};
        if (old.coverDia === undefined && old.coverRadius > 0) p.settings.coverDia = old.coverRadius * 2;

        /*
            У плана внутреннего пожаротушения своя отметка — клапана ПК. Раньше
            она лежала в поле оросителей: переносим, иначе расчёт поедет.
        */
        if (p.settings.planKind === 'vpv' && typeof old.pkElev !== 'number') {
            p.settings.pkElev = p.settings.sprinklerElev;
        }

        var maxId = 0;

        p.nodes = (data.nodes || []).map(function (n) {
            maxId = Math.max(maxId, n.id);
            return merge({ id: 0, x: 0, y: 0, spr: false, src: false, cu: false, off: false, dict: false, q: 0, k: null, model: '', pk: null, label: '', cover: 0 }, n);
        });

        var known = {};
        p.nodes.forEach(function (n) { known[n.id] = true; });

        p.segments = (data.segments || []).filter(function (s) {
            return known[s.a] && known[s.b];
        }).map(function (s) {
            maxId = Math.max(maxId, s.id);
            return merge({ id: 0, a: 0, b: 0, role: 'ray', material: 'ГОСТ3262', od: 48, wall: 3, len: null, kt: null, ring: false }, s);
        });

        p.zone = Array.isArray(data.zone) && data.zone.length >= 3 ? data.zone : null;

        p.corridor = {
            axis: data.corridor && Array.isArray(data.corridor.axis) ? data.corridor.axis : [],
            doors: data.corridor && Array.isArray(data.corridor.doors) ? data.corridor.doors : [],
            notes: data.corridor && Array.isArray(data.corridor.notes) ? data.corridor.notes : []
        };
        p.underlay = data.underlay || null;
        p.dxf = data.dxf && Array.isArray(data.dxf.ents) ? data.dxf : null;
        p.nextId = Math.max(data.nextId || 1, maxId + 1);

        return p;
    }

    function pack(project) {
        return JSON.parse(JSON.stringify(project));
    }

    /* --- книга объекта ----------------------------------------------------- */

    function defaultObject() {
        return {
            name: 'Без названия',
            code: '',
            address: '',
            height: 0
        };
    }

    function newBook(settings) {
        var p = Model.create();
        if (settings) p.settings = merge(Model.defaults(), JSON.parse(JSON.stringify(settings)));
        p.settings.systemName = 'В21';

        return {
            format: 'aupt-book',
            version: 1,
            object: defaultObject(),
            systems: [{
                id: 's1',
                code: 'В21',
                kind: 'apt',
                title: 'система автоматического пожаротушения',
                compartment: '',
                project: p
            }],
            text: Tch.create(),
            task: Task.create(),
            stations: [],
            nextStation: 1,
            active: 's1',
            nextId: 2
        };
    }

    function unpackBook(data) {
        if (data && data.format === 'sprinkler-web') {
            var wrapped = newBook();
            var project = unpack(data);
            wrapped.systems[0].project = project;
            wrapped.systems[0].code = project.settings.systemName || 'В21';
            wrapped.object.name = project.name || wrapped.object.name;
            return wrapped;
        }

        if (!data || data.format !== 'aupt-book') {
            throw new Error('Это не файл проекта АУПТ.');
        }

        var book = {
            format: 'aupt-book',
            version: 1,
            object: merge(defaultObject(), data.object || {}),
            text: Tch.normalize(data.text),
            task: Task.normalize(data.task),
            stations: Stations.normalize(data.stations),
            nextStation: data.nextStation || 1,
            systems: [],
            active: data.active,
            nextId: data.nextId || 1
        };

        var maxId = 0;

        (data.systems || []).forEach(function (s) {
            var sys = {
                id: String(s.id),
                code: s.code || '',
                kind: s.kind === 'vpv' || s.kind === 'floors' || s.kind === 'vpvplan' ? s.kind : 'apt',
                title: s.title || '',
                compartment: s.compartment || '',
                // Жокей-насос есть не у каждой системы: галочка в окне «Насосы…».
                jockey: s.jockey !== false,
                // Цвет системы на схеме: пусто — канонный по типу и порядку.
                color: typeof s.color === 'string' ? s.color : ''
            };

            if (sys.kind === 'apt' || sys.kind === 'vpvplan') sys.project = unpack(s.project || { format: 'sprinkler-web' });
            else if (sys.kind === 'vpv') sys.vpv = Vpv.normalize(s.vpv);
            else sys.floors = Floors.normalize(s.floors);

            var num = parseInt(String(sys.id).replace(/\D/g, ''), 10);
            if (num > maxId) maxId = num;
            book.systems.push(sys);
        });

        if (!book.systems.length) return newBook();

        book.nextId = Math.max(book.nextId, maxId + 1);
        book.nextStation = Math.max(book.nextStation, Stations.nextId(book.stations));

        // Из насосных убираются системы, которых в книге уже нет.
        book.stations.forEach(function (st) {
            st.systems = st.systems.filter(function (id) { return book.systems.some(function (s) { return s.id === id; }); });
        });
        if (!book.systems.some(function (s) { return s.id === book.active; })) book.active = book.systems[0].id;

        return book;
    }

    /** Все планы книги: планы систем АПТ и планы этажей АПТ по этажам. */
    function projectsOf(book) {
        var list = [];
        book.systems.forEach(function (s) {
            if (s.project) list.push(s.project);
            if (s.floors) s.floors.plans.forEach(function (p) { if (p.project) list.push(p.project); });
        });
        return list;
    }

    /*
        Имя файла для выгрузки. Наименование объекта в проекте длинное
        («Жилая застройка в границах улиц …, 1 этап строительства»), а Windows
        держит имя файла до 255 символов и весь путь до 260. Браузер такое имя
        обрезает по-живому — файл приходит с огрызком вместо хвоста, и почта
        или просмотрщик потом не могут его открыть. Поэтому имя укорачивается
        здесь: по словам, с запасом под папку, и без знаков, которых имени
        файла знать не положено.
    */
    var NAME_LIMIT = 90;

    function safeName(base, suffix) {
        var text = String(base || '').replace(/[\\/:*?"<>|«»\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text) text = 'АУПТ';

        var room = NAME_LIMIT - (suffix || '').length;
        if (room < 20) room = 20;

        if (text.length > room) {
            var cut = text.slice(0, room);
            var space = cut.lastIndexOf(' ');
            // Режем по слову, но не оставляем совсем короткий огрызок.
            text = (space > room * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;–—-]+$/, '');
        }

        return text + (suffix || '');
    }

    function fileName(book) {
        return safeName(book.object.name, '.aupt.json');
    }

    function download(book) {
        var text = JSON.stringify(book, null, 1);
        Zip.save(new Blob([text], { type: 'application/json' }), fileName(book));
    }

    function read(file, done, fail) {
        var reader = new FileReader();
        reader.onload = function () {
            try {
                done(unpackBook(JSON.parse(reader.result)));
            } catch (e) {
                fail(e);
            }
        };
        reader.onerror = function () { fail(reader.error); };
        reader.readAsText(file, 'utf-8');
    }

    /** Возвращает false, если подложки в браузер не влезли. */
    function autosave(book) {
        try {
            localStorage.setItem(KEY, JSON.stringify(book));
            return true;
        } catch (e) {
            try {
                var copy = JSON.parse(JSON.stringify(book));
                projectsOf(copy).forEach(function (p) {
                    if (p.underlay) p.underlay.src = '';
                    // Чертёж DXF — это тысячи точек; в файле проекта он есть,
                    // а в память браузера кладётся только имя.
                    if (p.dxf) p.dxf.ents = [];
                });
                // Шаблон записки весит сотни килобайт; в файле проекта он есть,
                // а в память браузера кладётся только имя.
                if (copy.text && copy.text.template) copy.text.template.data = '';
                // Бланк задания — тот же случай: в книге есть, в памяти браузера ни к чему.
                if (copy.task && copy.task.template) copy.task.template.data = '';
                // Каталожные листы .pdf — туда же: в книге они нужны для пакета
                // приложений, а в автосохранении занимают всё место.
                ((copy.text && copy.text.pumps) || []).forEach(function (p) {
                    if (p.file) p.file.data = '';
                });
                localStorage.setItem(KEY, JSON.stringify(copy));
            } catch (ignored) {
                // Хранилище недоступно вовсе — работаем без автосохранения.
            }
            return false;
        }
    }

    function restore() {
        try {
            var text = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
            return text ? unpackBook(JSON.parse(text)) : null;
        } catch (e) {
            return null;
        }
    }

    return {
        merge: merge,
        safeName: safeName,
        unpack: unpack,
        pack: pack,
        newBook: newBook,
        unpackBook: unpackBook,
        projectsOf: projectsOf,
        download: download,
        read: read,
        autosave: autosave,
        restore: restore
    };
})();
