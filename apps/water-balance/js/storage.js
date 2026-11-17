/*
    Проект: что именно ввёл инженер.

    Хранится две вещи и по-разному. В браузере — последнее состояние, чтобы
    закрытая вкладка не стоила введённых данных. Файлом — сам проект, чтобы его
    можно было положить в папку объекта и отдать смежнику.

    В проект не пишутся результаты расчёта: они полностью выводятся из исходных
    данных, а сохранённое число однажды разойдётся с формулой, по которой его
    когда-то получили.

    Версия 3 отличается от второй тем, что группы стали ДЕРЕВОМ: у каждой
    появился parentId (пусто — корень). Потребитель лежит в списке один раз,
    как и раньше, и ссылается на группу-лист — просто сама группа теперь узел
    дерева, а не запись в плоском списке. Файлы второй версии читаются: их
    плоские группы становятся корневыми узлами дерева без изменений.
*/

var Storage = (function () {
    'use strict';

    var KEY = 'sp30-vk-project';

    var LIVING = 'Жилые дома с ваннами от 1500 мм, оборудованными душами';
    var OFFICE = 'Административные здания';

    /* Идентификаторы: время плюс счётчик — в пределах одного проекта хватает. */
    var counter = 0;

    function id(prefix) {
        counter++;
        return prefix + '-' + Date.now().toString(36) + '-' + counter;
    }

    function blank() {
        var corpus = 'g-corpus';
        var section1 = 'g-1';
        var section2 = 'g-2';
        var office = 'g-office';

        var living1 = id('c');
        var living2 = id('c');
        var officeConsumer = id('c');

        return {
            version: 4,
            name: 'Без названия',
            alphaMode: 'interp',

            object: {
                name: '',
                address: '',
                note: ''
            },

            norms: [],

            groups: [
                { id: corpus, name: 'Корпус А', parentId: '' },
                { id: section1, name: 'Секция 1', parentId: corpus },
                { id: section2, name: 'Секция 2', parentId: corpus },
                { id: office, name: 'Встроенные помещения', parentId: '' }
            ],

            consumers: [
                consumer(living1, 'Жилые помещения С1', section1, LIVING, 291, 620),
                consumer(living2, 'Жилые помещения С2', section2, LIVING, 57, 112),
                consumer(officeConsumer, 'Встроенные помещения', office, OFFICE, 16, 16)
            ],

            sets: [],

            extras: [],

            heat: { hotT: 60, coldT: 5, losses: 0 },

            riser: {
                mark: 'Ст К1-1',
                norm: LIVING,
                floorHeightM: 3,
                byFixtures: false,
                totalFixtures: 0,
                totalUsers: 0,
                sections: [section_(id('r'), 1, 17, 6, [
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
            },

            branch: branchBlank(),
            hyd: HydModel.blank()
        };
    }

    /*
        Вкладка «По узлам» — отдельный расчёт со своими исходными данными:
        секции (один уровень, без вложенности) и расчётные узлы («итоги»),
        каждый — произвольный набор групп с флагом «не учитывать в итоге по
        комплексу». Не связан с деревом папок на вкладке «Потребители»: это
        сознательно другой, самостоятельный расчёт, а не второе представление
        того же самого.

        Пример — те же числа, что в присланном образце: пятисекционный дом,
        жильё и встроенные офисы в первых трёх секциях.
    */
    function branchBlank() {
        var sections = [1, 2, 3, 4, 5].map(function (i) { return { id: 'bs' + i, name: 'Секция ' + i }; });

        var groups = [];
        [250, 108, 185, 105, 143].forEach(function (U, i) {
            groups.push(branchGroup('bg' + i, '', 'bs' + (i + 1), 'bath', U));
        });
        [43, 19, 32].forEach(function (U, i) {
            groups.push(branchGroup('bo' + i, '', 'bs' + (i + 1), 'office', U));
        });

        return {
            name: 'Солнечный 6.3',
            sections: sections,
            groups: groups,
            nodes: [
                {
                    id: 'homes', name: 'Жилая часть',
                    ids: groups.filter(function (g) { return g.preset === 'bath'; }).map(function (g) { return g.id; }),
                    excludeFromComplex: false, report: true
                },
                {
                    id: 'offices', name: 'Встроенные помещения',
                    ids: groups.filter(function (g) { return g.preset === 'office'; }).map(function (g) { return g.id; }),
                    excludeFromComplex: false, report: true
                }
            ],
            settings: {
                details: true, sections: false, fire: false, heat: false,
                hotTemp: 65, coldTemp: 5, heatLoss: 0,
                fireHome: 5.2, fireParking: 5.2, fireOuter: 30
            }
        };
    }

    function branchGroup(key, comment, section, preset, U) {
        return {
            id: key, name: '', comment: comment,
            section: section, preset: preset, custom: null,
            Uday: U, Uhour: U, autoN: true, N: U, Nhot: U,
            sewer: true, enabled: true, q0Sewer: 1.6
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

        Имя с подчёркиванием — чтобы не столкнуться с полем project.riser.sections
        и с локальной переменной section в normalize(): один и тот же файл жил бы
        с двумя разными «section» иначе.
    */
    function section_(key, from, to, residents, fixtures) {
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
            version: 4,
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
            riser: null,
            branch: null,
            hyd: null
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

        var ids = {};
        for (i = 0; i < source.length; i++) ids[text(source[i].id, '')] = true;

        for (i = 0; i < source.length; i++) {
            var gid = text(source[i].id, id('g'));
            var parentId = text(source[i].parentId, '');

            // Ссылка на несуществующего или на самого себя родителя — узел
            // остаётся корневым, а не пропадает молча из дерева.
            if (parentId === gid || !ids[parentId]) parentId = '';

            project.groups.push({
                id: gid,
                name: text(source[i].name, 'Группа'),
                parentId: parentId
            });
        }

        // Кольцо родителей (A → B → A), возможное только в правленном руками
        // файле, разрывается переносом второго узла кольца в корень.
        breakCycles(project.groups);

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

        source = data.sets || [];

        for (i = 0; i < source.length; i++) {
            var s = source[i];
            if (!s) continue;

            project.sets.push({
                id: text(s.id, id('s')),
                name: text(s.name, 'Итого'),
                members: listIds(s.members),
                sets: listIds(s.sets)
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
        project.branch = branchNormalize(data.branch, base.branch);
        project.hyd = HydModel.normalize(data.hyd);

        return project;
    }

    /*
        Расчёт вкладки «По узлам» — читается со своей проверкой: секция или
        группа, ссылающаяся на несуществующий id, тихо теряется, а не роняет
        чтение всего проекта.
    */
    function branchNormalize(data, base) {
        data = data || {};

        var sections = data.sections && data.sections.length ? data.sections : base.sections;
        var outSections = [];
        var sectionIds = {};
        var i;

        for (i = 0; i < sections.length; i++) {
            var sid = text(sections[i].id, id('bs'));
            outSections.push({ id: sid, name: text(sections[i].name, 'Секция') });
            sectionIds[sid] = true;
        }

        var groups = data.groups && data.groups.length ? data.groups : base.groups;
        var outGroups = [];
        var groupIds = {};

        for (i = 0; i < groups.length; i++) {
            var g = groups[i];
            if (!g || !sectionIds[g.section]) continue;

            var gid = text(g.id, id('bg'));
            var custom = null;

            if (g.custom && g.custom.name) {
                custom = {
                    name: text(g.custom.name, ''), unit: text(g.custom.unit, '1 потребитель'),
                    day: number(g.custom.day, 0), hotDay: number(g.custom.hotDay, 0),
                    hour: number(g.custom.hour, 0), hotHour: number(g.custom.hotHour, 0),
                    q: number(g.custom.q, 0), qPart: number(g.custom.qPart, 0),
                    qhr: number(g.custom.qhr, 0), qhrPart: number(g.custom.qhrPart, 0),
                    T: number(g.custom.T, 24) || 24
                };
            }

            outGroups.push({
                id: gid, name: '', comment: text(g.comment, ''),
                section: g.section, preset: text(g.preset, 'bath'), custom: custom,
                Uday: whole(g.Uday !== undefined ? g.Uday : g.U, 0),
                Uhour: whole(g.Uhour !== undefined ? g.Uhour : g.Uday, whole(g.U, 0)),
                autoN: g.autoN !== false,
                N: whole(g.N, 1) || 1, Nhot: whole(g.Nhot, 1) || 1,
                sewer: g.sewer !== false, enabled: g.enabled !== false,
                q0Sewer: number(g.q0Sewer, 1.6)
            });
            groupIds[gid] = true;
        }

        var nodes = data.nodes && data.nodes.length ? data.nodes : base.nodes;
        var outNodes = [];

        for (i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (!n) continue;

            var ids = listIds(n.ids).filter(function (gid2) { return groupIds[gid2]; });

            outNodes.push({
                id: text(n.id, id('bn')), name: text(n.name, 'Итог'),
                ids: ids, excludeFromComplex: n.excludeFromComplex === true,
                report: n.report !== false
            });
        }

        var s = data.settings || {};
        var bs = base.settings;

        return {
            name: text(data.name, base.name),
            sections: outSections, groups: outGroups, nodes: outNodes,
            settings: {
                details: s.details !== false,
                sections: s.sections === true,
                fire: s.fire === true,
                heat: s.heat === true,
                hotTemp: number(s.hotTemp, bs.hotTemp),
                coldTemp: number(s.coldTemp, bs.coldTemp),
                heatLoss: number(s.heatLoss, bs.heatLoss),
                fireHome: number(s.fireHome, bs.fireHome),
                fireParking: number(s.fireParking, bs.fireParking),
                fireOuter: number(s.fireOuter, bs.fireOuter)
            }
        };
    }

    /* Родитель, ведущий назад к самому себе через цепочку — разрывается. */
    function breakCycles(groups) {
        var byId = {};
        var i;
        for (i = 0; i < groups.length; i++) byId[groups[i].id] = groups[i];

        for (i = 0; i < groups.length; i++) {
            var seen = {};
            var node = groups[i];

            while (node.parentId) {
                if (seen[node.id]) { groups[i].parentId = ''; break; }
                seen[node.id] = true;

                var parent = byId[node.parentId];
                if (!parent) { groups[i].parentId = ''; break; }

                node = parent;
            }
        }
    }

    function listIds(list) {
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

            sections.push(section_(
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
        уровнем группировки. Каждая становится потребителем в одной корневой
        папке «Объект» — именно это первая версия и считала.
    */
    function upgrade(data, base) {
        var project = normalize({
            name: data.name,
            alphaMode: data.alphaMode,
            heat: data.heat,
            riser: data.riser,
            groups: [{ id: 'g-1', name: 'Объект', parentId: '' }],
            consumers: [],
            sets: []
        });

        project.consumers = [];

        for (var i = 0; i < data.groups.length; i++) {
            var g = data.groups[i];

            project.consumers.push({
                id: id('c'),
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
        }

        return project;
    }

    function remember(project) {
        try {
            window.localStorage.setItem(KEY, JSON.stringify(project));
        } catch (error) {
            // Приватный режим браузера запрещает запись, а большой проект (с каталожными
            // листами насосов) может не поместиться в localStorage. Расчёт от этого не
            // страдает. Старое состояние убирается: устаревшее хуже отсутствующего — при
            // следующем запуске проект возьмётся из библиотеки объектов.
            try { window.localStorage.removeItem(KEY); } catch (e) { /* нечего делать */ }
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

    function download(project, fileName) {
        var content = JSON.stringify(project, null, 2);
        var blob = new Blob([content], { type: 'application/json;charset=utf-8' });

        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName || ((project.name || 'расчёт').replace(/[\\\/:*?"<>|]/g, '-') + '.json');

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
        section: section_,
        extra: extra,
        branchGroup: branchGroup,
        id: id,
        remember: remember,
        recall: recall,
        download: download,
        read: read
    };
})();
