/*
    Проект: что именно ввёл инженер.

    Хранится две вещи и по-разному. В браузере — последнее состояние, чтобы
    закрытая вкладка не стоила введённых данных. Файлом — сам проект, чтобы его
    можно было положить в папку объекта и отдать смежнику.

    В проект не пишутся результаты расчёта: они полностью выводятся из исходных
    данных, а сохранённое число однажды разойдётся с формулой, по которой его
    когда-то получили.

    Версия 2 отличается от первой тем, что потребители стали плоским списком с
    произвольными наборами-итогами. Файлы первой версии читаются: старая группа
    превращается в потребителя, и все они попадают в набор «ИТОГО ПО ОБЪЕКТУ» —
    ровно то, что первая версия и считала.
*/

var Storage = (function () {
    'use strict';

    var KEY = 'sp30-vk-sewer-project';

    var LIVING = 'Жилые дома с ваннами от 1500 мм, оборудованными душами';
    var OFFICE = 'Административные здания';

    /* Идентификаторы: время плюс счётчик — в пределах одного проекта хватает. */
    var counter = 0;

    function id(prefix) {
        counter++;
        return prefix + '-' + Date.now().toString(36) + '-' + counter;
    }

    function blank() {
        var living1 = id('c');
        var living2 = id('c');
        var office = id('c');

        var setLiving = id('s');
        var setPublic = id('s');

        return {
            version: 2,
            name: 'Без названия',
            alphaMode: 'interp',

            object: {
                name: '',
                address: '',
                note: ''
            },

            norms: [],

            groups: [
                { id: 'g-1', name: 'Секция 1' },
                { id: 'g-2', name: 'Секция 2' }
            ],

            consumers: [
                consumer(living1, 'Жилые помещения С1', 'g-1', LIVING, 291, 620),
                consumer(living2, 'Жилые помещения С2', 'g-2', LIVING, 57, 112),
                consumer(office, 'Встроенные помещения', 'g-1', OFFICE, 16, 16)
            ],

            sets: [
                {
                    id: setLiving,
                    name: 'Итого по жилым помещениям',
                    members: [living1, living2],
                    sets: []
                },
                {
                    id: setPublic,
                    name: 'Итого по встроенным помещениям',
                    members: [office],
                    sets: []
                },
                {
                    id: id('s'),
                    name: 'ИТОГО ПО ОБЪЕКТУ',
                    members: [],
                    sets: [setLiving, setPublic]
                }
            ],

            extras: [],

            heat: { hotT: 60, coldT: 5, losses: 0 },

            riser: {
                mark: 'Ст К1-1',
                norm: LIVING,
                floorHeightM: 3,
                byFixtures: false,
                totalFixtures: 0,
                totalUsers: 0,
                sections: [section(id('r'), 1, 17, 6, [
                    { name: 'Унитаз со смывным бачком', count: 2 },
                    { name: 'Ванна со смесителем', count: 2 },
                    { name: 'Мойка со смесителем', count: 2 },
                    { name: 'Умывальник со смесителем', count: 2 }
                ])],
                vented: true,
                material: 'ПВХ',
                riserMm: 110,
                branchMm: 110,
                angleDeg: 87.5
            }
        };
    }

    function consumer(key, name, groupId, norm, usersDay, usersHour) {
        return {
            id: key,
            name: name,
            group: groupId,
            norm: norm,
            process: '1',
            hours: 0,
            quality: 'Питьевая',
            usersDay: usersDay,
            usersHour: usersHour,
            fixtures: 0,
            fixturesHot: 0,
            q0Sewer: 1.6,
            source: 'city',
            drain: 'household',
            lossPercent: 0,
            reason: '',
            note: ''
        };
    }

    /*
        Участок стояка: диапазон этажей со своим набором приборов и своим числом
        жильцов на этаж. Однородный стояк — это один участок от первого этажа до
        последнего.
    */
    function section(key, from, to, residents, fixtures) {
        return {
            id: key,
            from: from,
            to: to,
            residents: residents,
            fixtures: fixtures || []
        };
    }

    function extra(key, name) {
        return {
            id: key,
            name: name,
            group: '',
            unit: 'м²',
            count: 0,
            rate: 0,
            m3day: 0,
            ls: 0,
            note: '',
            inBalance: true
        };
    }

    function number(value, fallback) {
        var parsed = parseFloat(value);
        return isFinite(parsed) ? parsed : fallback;
    }

    function whole(value, fallback) {
        return Math.max(0, Math.round(number(value, fallback)));
    }

    function text(value, fallback) {
        return value === null || value === undefined ? fallback : String(value);
    }

    /*
        Чтение проекта: недостающие поля берутся из пустого.

        Не роскошь, а необходимость: файл может быть сохранён прежней версией
        программы, и падать на отсутствующем поле она не должна.
    */
    function normalize(data) {
        var base = blank();
        if (!data || typeof data !== 'object') return base;

        if (!data.consumers && data.groups && data.groups.length && data.groups[0].norm) {
            return upgrade(data, base);
        }

        var project = {
            version: 2,
            name: text(data.name, base.name),
            alphaMode: data.alphaMode === 'node' ? 'node' : 'interp',
            object: {
                name: text(data.object && data.object.name, ''),
                address: text(data.object && data.object.address, ''),
                note: text(data.object && data.object.note, '')
            },
            norms: [],
            groups: [],
            consumers: [],
            sets: [],
            extras: [],
            heat: {
                hotT: number(data.heat && data.heat.hotT, base.heat.hotT),
                coldT: number(data.heat && data.heat.coldT, base.heat.coldT),
                losses: number(data.heat && data.heat.losses, base.heat.losses)
            },
            riser: null
        };

        var i;

        /*
            Проектные нормы — дополнения и правки к таблице А.2. Пустой список
            здесь означает именно пустой: образцовых норм подставлять нельзя,
            иначе правка «удалить свою строку» не сработала бы.
        */
        var source = data.norms || [];

        for (i = 0; i < source.length; i++) {
            var n = source[i];
            if (!n || !n.name) continue;

            project.norms.push({
                name: text(n.name, ''),
                unit: text(n.unit, '1 потребитель'),
                qu: number(n.qu, 0),
                quh: number(n.quh, 0),
                qhru: number(n.qhru, 0),
                qhruh: number(n.qhruh, 0),
                q0: number(n.q0, 0),
                q0hr: number(n.q0hr, 0),
                q0h: number(n.q0h, 0),
                q0hrh: number(n.q0hrh, 0),
                t: number(n.t, 24)
            });
        }

        source = data.groups && data.groups.length ? data.groups : base.groups;

        for (i = 0; i < source.length; i++) {
            project.groups.push({
                id: text(source[i].id, id('g')),
                name: text(source[i].name, 'Группа')
            });
        }

        source = data.consumers && data.consumers.length ? data.consumers : base.consumers;

        for (i = 0; i < source.length; i++) {
            var c = source[i];

            project.consumers.push({
                id: text(c.id, id('c')),
                name: text(c.name, 'Потребитель'),
                group: text(c.group, ''),
                norm: text(c.norm, LIVING),
                process: text(c.process, '1'),
                hours: number(c.hours, 0),
                quality: text(c.quality, 'Питьевая'),
                usersDay: whole(c.usersDay, 0),
                usersHour: whole(c.usersHour, 0),
                fixtures: whole(c.fixtures, 0),
                fixturesHot: whole(c.fixturesHot, 0),
                q0Sewer: number(c.q0Sewer, 1.6),
                source: text(c.source, 'city'),
                drain: text(c.drain, 'household'),
                lossPercent: number(c.lossPercent, 0),
                reason: text(c.reason, ''),
                note: text(c.note, '')
            });
        }

        source = data.sets && data.sets.length ? data.sets : base.sets;

        for (i = 0; i < source.length; i++) {
            var s = source[i];

            project.sets.push({
                id: text(s.id, id('s')),
                name: text(s.name, 'Итого'),
                members: ids(s.members),
                sets: ids(s.sets)
            });
        }

        source = data.extras || [];

        for (i = 0; i < source.length; i++) {
            var e = source[i];

            project.extras.push({
                id: text(e.id, id('e')),
                name: text(e.name, 'Расход'),
                group: text(e.group, ''),
                unit: text(e.unit, 'м²'),
                count: number(e.count, 0),
                rate: number(e.rate, 0),
                m3day: number(e.m3day, 0),
                ls: number(e.ls, 0),
                note: text(e.note, ''),
                inBalance: e.inBalance !== false
            });
        }

        project.riser = riser(data.riser, base.riser);

        return project;
    }

    function ids(list) {
        var out = [];
        if (!list || !list.length) return out;

        for (var i = 0; i < list.length; i++) {
            if (typeof list[i] === 'string' && list[i]) out.push(list[i]);
        }

        return out;
    }

    /*
        Стояк. Файлы прежних версий несли один набор приборов на весь стояк —
        он превращается в единственный участок от первого этажа до последнего.
    */
    function riser(r, base) {
        r = r || base;

        var sections = [];
        var source = r.sections && r.sections.length ? r.sections : null;

        if (!source && r.fixtures && r.fixtures.length) {
            source = [{
                from: 1,
                to: Math.max(1, whole(r.floors, 1)),
                residents: whole(r.residents, 0),
                fixtures: r.fixtures
            }];
        }

        if (!source) source = base.sections;

        for (var s = 0; s < source.length; s++) {
            var one = source[s];
            var fixtures = [];
            var list = one.fixtures || [];

            for (var k = 0; k < list.length; k++) {
                fixtures.push({
                    name: text(list[k].name, ''),
                    count: whole(list[k].count, 0)
                });
            }

            sections.push(section(
                text(one.id, id('r')),
                Math.max(1, whole(one.from, 1)),
                Math.max(1, whole(one.to, 1)),
                whole(one.residents, 0),
                fixtures
            ));
        }

        return {
            mark: text(r.mark, base.mark),
            norm: text(r.norm, base.norm),
            floorHeightM: number(r.floorHeightM, base.floorHeightM),
            byFixtures: r.byFixtures === true,
            totalFixtures: whole(r.totalFixtures, 0),
            totalUsers: whole(r.totalUsers, 0),
            sections: sections,
            vented: r.vented !== false,
            material: text(r.material, base.material),
            riserMm: number(r.riserMm, base.riserMm),
            branchMm: number(r.branchMm, base.branchMm),
            angleDeg: number(r.angleDeg, base.angleDeg)
        };
    }

    /*
        Файл первой версии: группы там были и потребителями, и единственным
        уровнем группировки. Каждая становится потребителем, все вместе — одним
        набором «ИТОГО ПО ОБЪЕКТУ»: именно это первая версия и считала.
    */
    function upgrade(data, base) {
        var project = normalize({
            name: data.name,
            alphaMode: data.alphaMode,
            heat: data.heat,
            riser: data.riser,
            groups: [{ id: 'g-1', name: 'Объект' }],
            consumers: [],
            sets: []
        });

        /*
            Списки очищаются явно: normalize подставляет образцовые данные
            вместо пустых, чтобы новый проект не открывался чистым листом, — а
            здесь пустой список означает именно пустой.
        */
        project.consumers = [];
        project.sets = [];

        var members = [];

        for (var i = 0; i < data.groups.length; i++) {
            var g = data.groups[i];
            var key = id('c');

            project.consumers.push({
                id: key,
                name: g.norm,
                group: 'g-1',
                norm: g.norm,
                process: '1',
                hours: 0,
                quality: 'Питьевая',
                usersDay: whole(g.users, 0),
                usersHour: whole(g.users, 0),
                fixtures: whole(g.fixtures, 0),
                fixturesHot: whole(g.fixturesHot, 0),
                q0Sewer: number(g.q0Sewer, 1.6),
                source: 'city',
                drain: 'household',
                lossPercent: 0,
                reason: '',
                note: ''
            });

            members.push(key);
        }

        project.sets = [{
            id: id('s'),
            name: 'ИТОГО ПО ОБЪЕКТУ',
            members: members,
            sets: []
        }];

        return project;
    }

    function remember(project) {
        try {
            window.localStorage.setItem(KEY, JSON.stringify(project));
        } catch (error) {
            // Приватный режим браузера запрещает запись. Расчёт от этого не
            // страдает — теряется только восстановление после закрытия вкладки.
        }
    }

    function recall() {
        try {
            var stored = window.localStorage.getItem(KEY);
            if (!stored) return null;
            return normalize(JSON.parse(stored));
        } catch (error) {
            return null;
        }
    }

    function download(project) {
        var content = JSON.stringify(project, null, 2);
        var blob = new Blob([content], { type: 'application/json;charset=utf-8' });

        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = (project.name || 'расчёт').replace(/[\\\/:*?"<>|]/g, '-') + '.json';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    function read(file, done, fail) {
        var reader = new FileReader();

        reader.onload = function () {
            try {
                done(normalize(JSON.parse(String(reader.result))));
            } catch (error) {
                fail('Файл не читается как проект: ' + error.message);
            }
        };

        reader.onerror = function () { fail('Файл не открылся.'); };
        reader.readAsText(file, 'utf-8');
    }

    return {
        blank: blank,
        normalize: normalize,
        consumer: consumer,
        section: section,
        extra: extra,
        id: id,
        remember: remember,
        recall: recall,
        download: download,
        read: read
    };
})();
