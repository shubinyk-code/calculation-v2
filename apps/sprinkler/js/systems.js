'use strict';

/*
    Системы проекта: В21, В22 — автоматическое пожаротушение по плану,
    В2.1, В2.2 — внутренний противопожарный водопровод по стоякам.

    Список систем — то, из чего потом собираются состав тома, перечень систем
    в текстовой части, сводная таблица расходов и приложения с расчётами.
*/

var Systems = (function () {

    var KIND = { apt: 'АПТ', vpv: 'ВПВ', floors: 'АПТ по этажам', vpvplan: 'ВПВ по плану' };

    function esc(t) { return Fmt.html(t); }

    function find(book, id) {
        for (var i = 0; i < book.systems.length; i++) {
            if (book.systems[i].id === id) return book.systems[i];
        }
        return null;
    }

    function active(book) {
        return book ? find(book, book.active) || book.systems[0] : null;
    }

    function codeUsed(book, code) {
        return book.systems.some(function (s) { return s.code === code; });
    }

    function suggestCode(book, kind) {
        for (var i = 1; i < 100; i++) {
            var code = kind === 'vpv' || kind === 'vpvplan' ? 'В2.' + i : 'В2' + i;
            if (!codeUsed(book, code)) return code;
        }
        return kind === 'vpv' || kind === 'vpvplan' ? 'В2.х' : 'В2х';
    }

    function firstApt(book) {
        for (var i = 0; i < book.systems.length; i++) {
            if (book.systems[i].kind === 'apt') return book.systems[i];
        }
        return null;
    }

    /** Настройки оросителей для нового плана: от первой АПТ или первой АПТ по этажам. */
    function baseSettings(book) {
        var apt = firstApt(book);
        if (apt) return apt.project.settings;
        for (var i = 0; i < book.systems.length; i++) {
            var f = book.systems[i].floors;
            if (f && f.plans.length) return f.plans[0].project.settings;
        }
        return null;
    }

    function add(book, kind) {
        var sys = {
            id: 's' + book.nextId++,
            code: suggestCode(book, kind),
            kind: kind,
            title: kind === 'vpv' || kind === 'vpvplan'
                ? 'система внутреннего пожаротушения'
                : 'система автоматического пожаротушения',
            compartment: '',
            jockey: true,
            color: ''
        };

        var base = baseSettings(book);

        if (kind === 'apt' || kind === 'vpvplan') {
            sys.project = Model.create();
            if (base) sys.project.settings = Storage.merge(Model.defaults(), JSON.parse(JSON.stringify(base)));
            sys.project.settings.systemName = sys.code;

            /*
                Внутреннее пожаротушение по плану: расчётные точки — краны,
                раздельная система паркинга обычно воздушная, а подпись в
                приложении своя. Остальное — тот же план, что у АПТ.
            */
            if (kind === 'vpvplan') {
                var s = sys.project.settings;
                s.planKind = 'vpv';
                // Своя геометрия: расчёт приведён к отметке клапана ПК.
                s.pkElev = 1.35;
                s.systemKind = 'воздухозаполненная';
                s.coldRoom = false;
                s.objectText = 'паркинга';
                s.tableTitle = 'Внутреннее пожаротушение паркинга';
                s.pkJets = 2;
            }
        } else if (kind === 'floors') {
            sys.floors = Floors.create();
            sys.floors.plans.forEach(function (p) {
                if (base) p.project.settings = Storage.merge(Model.defaults(), JSON.parse(JSON.stringify(base)));
                p.project.settings.systemName = sys.code;
            });
        } else {
            sys.vpv = Vpv.create();
        }

        book.systems.push(sys);
        return sys;
    }

    function duplicate(book, id) {
        var src = find(book, id);
        if (!src) return null;

        var copy = JSON.parse(JSON.stringify(src));
        copy.id = 's' + book.nextId++;
        copy.code = src.code + ' копия';
        if (copy.kind === 'apt' || copy.kind === 'vpvplan') {
            copy.project = Storage.unpack(copy.project);
            if (copy.project.underlay) copy.project.underlay.src = src.project.underlay ? src.project.underlay.src : '';
        } else if (copy.kind === 'floors') {
            copy.floors = Floors.normalize(copy.floors);
            copy.floors.plans.forEach(function (p, i) {
                var from = src.floors.plans[i];
                if (p.project.underlay && from && from.project.underlay) p.project.underlay.src = from.project.underlay.src;
            });
        } else {
            copy.vpv = Vpv.normalize(copy.vpv);
        }

        book.systems.splice(book.systems.indexOf(src) + 1, 0, copy);
        return copy;
    }

    function remove(book, id) {
        if (book.systems.length <= 1) return false;
        book.systems = book.systems.filter(function (s) { return s.id !== id; });
        (book.stations || []).forEach(function (st) {
            st.systems = st.systems.filter(function (s) { return s !== id; });
        });
        if (book.active === id) book.active = book.systems[0].id;
        return true;
    }
    function fileBase(book, sys) {
        // Имя файла: укороченное наименование объекта и обозначение системы.
        return Storage.safeName(book.object.name, sys ? ' ' + sys.code : '');
    }

    function label(sys) {
        return sys.code + ' · ' + KIND[sys.kind] + (sys.title ? ' — ' + sys.title : '');
    }

    /* --- интерфейс -------------------------------------------------------- */

    var open = false;

    function renderSelect() {
        var select = document.getElementById('systemSelect');
        if (!select || !App.book) return;

        select.innerHTML = App.book.systems.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (s.id === App.book.active ? ' selected' : '') + '>' + esc(label(s)) + '</option>';
        }).join('')
            + '<option value="__tch"' + (App.mode === 'tch' ? ' selected' : '') + '>Текстовая часть — записка ПБ3</option>'
            + '<option value="__scheme"' + (App.mode === 'scheme' ? ' selected' : '') + '>Принципиальная схема — насосная станция</option>'
            + '<option value="__task"' + (App.mode === 'task' ? ' selected' : '') + '>Задание для ЭЛ и СС</option>';

        if (open) renderManager();
    }

    function renderManager() {
        var book = App.book;
        var root = document.getElementById('modalRoot');
        var active = document.activeElement;
        var key = active && root.contains(active) && active.dataset ? active.dataset.key : null;
        var o = book.object;

        var rows = book.systems.map(function (s) {
            var color = Canon.colorOf(book, s);
            return '<tr' + (s.id === book.active ? ' class="selected"' : '') + '>'
                + '<td><input class="cell wide" data-key="sys:' + s.id + ':code" value="' + esc(s.code) + '"></td>'
                + '<td>' + KIND[s.kind] + '</td>'
                + '<td><input class="cell title" data-key="sys:' + s.id + ':title" value="' + esc(s.title) + '"></td>'
                + '<td><input class="cell wide" data-key="sys:' + s.id + ':compartment" value="' + esc(s.compartment) + '"></td>'
                + '<td class="sys-color"><input type="color" data-key="sys:' + s.id + ':color" value="' + esc(color) + '"'
                + ' title="Цвет системы на схеме и в выгрузке DXF">'
                + '<div class="dim">' + esc(Canon.layerOf(s)) + '</div>'
                + (s.color ? '<button class="mini" data-action="sys-color-reset:' + s.id + '" title="Вернуть канонный цвет">↺</button>' : '')
                + '</td>'
                + '<td class="sys-actions">'
                + '<button data-action="sys-open:' + s.id + '">Открыть</button>'
                + '<button data-action="sys-dup:' + s.id + '">Копия</button>'
                + '<button data-action="sys-del:' + s.id + '" class="danger"' + (book.systems.length <= 1 ? ' disabled' : '') + '>Удалить</button>'
                + '</td></tr>';
        }).join('');

        root.innerHTML = '<div class="modal"><div class="sheet sys-sheet">'
            + '<h2>Объект и системы</h2>'
            + '<div class="pair">'
            + field('Наименование объекта', 'obj:name', o.name)
            + field('Шифр (например, 18.01-70-ПК/2025-00-ПБ3)', 'obj:code', o.code)
            + '</div><div class="pair">'
            + field('Адрес', 'obj:address', o.address)
            + field('Высота здания по СП 1.13130, м', 'obj:height', o.height ? String(o.height).replace('.', ',') : '')
            + '</div>'
            + '<p class="hint">' + (o.height > 75
                ? 'Здание выше 75 м: в записку войдут СП 550.1311500.2026, СП 477.1325800 и СП 253.1325800. СТУ добавляются галочкой в текстовой части.'
                : 'Здание до 75 м: записка по СП 10.13130 и СП 485.1311500.') + '</p>'
            + '<h4>Системы</h4>'
            + '<table class="grid sys-table"><thead><tr><th>Обозначение</th><th>Тип</th><th>Наименование</th><th>Пожарный отсек</th>'
            + '<th>Цвет и слой</th><th></th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>'
            + '<div class="actions"><button data-action="sys-add-apt">+ Система АПТ (по плану)</button>'
            + '<button data-action="sys-add-floors">+ АПТ по этажам (стояк)</button>'
            + '<button data-action="sys-add-vpv">+ Система ВПВ (по стоякам)</button>'
            + '<button data-action="sys-add-vpvplan">+ ВПВ по плану (паркинг)</button></div>'
            + stationsBlock(book)
            + canonBlock(book)
            + '<div class="sheet-buttons"><button data-action="sys-close" class="primary">Готово</button></div>'
            + '</div></div>';

        if (key) {
            var el = root.querySelector('[data-key="' + key + '"]');
            if (el) el.focus({ preventScroll: true });
        }
    }


    /* --- оформление и шаблон для AutoCAD ------------------------------------ */

    /*
        Канон оформления: цвет и слой каждой системы, библиотека условных
        знаков, текстовый стиль. Шаблон выгружается одним файлом DXF — его
        вставляют в свой чертёж, и дальше одноимённые блоки подменяются
        вашими, а слои приходят уже с нужными цветами.
    */
    function canonBlock(book) {
        return '<h4>Оформление схемы и выгрузка в AutoCAD</h4>'
            + '<p class="hint">Цвет системы правится в таблице выше: он идёт и на схему в программе, и в DXF '
            + '(цвет слоя <b>ВК_обозначение</b>). Кнопка ↺ возвращает канонный цвет — у ВПВ красный ряд, '
            + 'у АПТ синий, у противопожарного водопровода зелёный.</p>'
            + '<p class="hint">Шаблон содержит ' + Canon.BLOCKS.length + ' условных знаков (клетка ' + Canon.BOX
            + ' мм, вставка ' + String(Canon.BLOCK_SCALE).replace('.', ',') + ', лист 1:' + Canon.SCALE + '), '
            + Canon.layers(book).length + ' слоёв и текстовый стиль «ГОСТ». '
            + 'У знаков есть атрибуты (ДУ, МАРКА, Q, H) — в них программа подставит числа расчёта.</p>'
            + '<div class="actions"><button data-action="sys-dxf-template">Шаблон DXF: слои, стиль, условные знаки…</button></div>';
    }

    function exportTemplate(book) {
        var text = DxfWrite.build({
            layers: Canon.layers(book),
            blocks: Canon.BLOCKS,
            entities: Canon.templateEntities(book)
        });

        DxfWrite.save(text, Storage.safeName(book.object.name, ' — канон условных знаков.dxf'));
        App.status('Шаблон выгружен: ' + Canon.BLOCKS.length + ' знаков и ' + Canon.layers(book).length
            + ' слоёв. Вставьте его в свой чертёж — одноимённые блоки подменятся вашими.', 'done');
    }

    /* --- насосные ----------------------------------------------------------- */

    /** Насосные установки: какие системы питают, суммируются ли расходы, что должны дать. */
    function stationsBlock(book) {
        var list = book.stations || [];

        var cards = list.map(function (st) {
            var need = Stations.need(book, st);
            var checks = book.systems.map(function (s) {
                var other = Stations.stationOf(book, s.id);
                var mine = st.systems.indexOf(s.id) >= 0;
                return '<label class="check inline st-sys' + (other && !mine ? ' dim' : '') + '">'
                    + '<input type="checkbox" data-key="stsys:' + st.id + ':' + s.id + '"' + (mine ? ' checked' : '') + '> '
                    + esc(s.code) + ' <span class="dim">' + KIND[s.kind] + (other && !mine ? ', в «' + esc(other.name) + '»' : '') + '</span></label>';
            }).join('');

            var parts = need.parts.map(function (p) {
                return '<li>' + esc(p.sys.code) + ': Q ' + Fmt.num(p.Q, 2) + ' л/с, Нтр ' + Fmt.num(p.Htr, 2) + ' м, Нр ' + Fmt.num(p.Hp, 2) + ' м'
                    + (p.inOther ? ' <span class="dim">— краны уже в расходе ' + esc(p.inOther) + ', в сумму не идёт</span>' : '')
                    + (need.dict === p ? ' <b>— диктует напор</b>' : '') + '</li>';
            }).join('');

            return '<div class="station-card">'
                + '<div class="pair">' + field('Насосная установка', 'st:' + st.id + ':name', st.name)
                + field('Зона', 'st:' + st.id + ':zone', st.zone) + '</div>'
                + '<div class="st-systems">' + (checks || '<span class="dim">систем нет</span>') + '</div>'
                + '<label class="check"><input type="checkbox" data-key="st:' + st.id + ':sumFlows"' + (st.sumFlows ? ' checked' : '') + '> '
                + 'суммировать расходы систем (работают одновременно)</label>'
                + (need.parts.length
                    ? '<ul class="st-parts">' + parts + '</ul><p class="st-total">Насосная: Q = <b>' + Fmt.num(need.Q, 2) + ' л/с</b> ('
                        + (st.sumFlows ? 'сумма' : 'наибольший') + '), Нр = <b>' + Fmt.num(need.H, 2) + ' м</b> (наибольший из систем)</p>'
                    : '<p class="hint">Отметьте системы, которые питает эта насосная.</p>')
                + '<div class="actions"><button class="danger" data-action="st-del:' + st.id + '">Удалить насосную</button></div>'
                + '</div>';
        }).join('');

        return '<h4>Насосные установки</h4>'
            + '<p class="hint">Одна насосная может питать АПТ и ВПВ. Напор берётся наибольший из систем, расход — сумма или наибольший. '
            + 'Система входит только в одну насосную.</p>'
            + cards
            + '<div class="actions"><button data-action="st-add">+ Насосная установка</button></div>';
    }
    function field(labelText, key, value) {
        return '<label class="field"><span>' + esc(labelText) + '</span><input type="text" data-key="' + key + '" value="' + esc(value) + '"></label>';
    }

    function openManager() {
        open = true;
        renderManager();
    }

    function closeManager() {
        open = false;
        document.getElementById('modalRoot').innerHTML = '';
    }

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;

        var parts = key.split(':');
        var value = el.type === 'checkbox' ? el.checked : el.value;

        setTimeout(function () {
            var book = App.book;

            if (parts[0] === 'st' || parts[0] === 'stsys') {
                var st = (book.stations || []).filter(function (s) { return s.id === parts[1]; })[0];
                if (!st) return;
                if (parts[0] === 'stsys') Stations.assign(book, st, parts[2], !!value);
                else if (parts[2] === 'sumFlows') st.sumFlows = !!value;
                else st[parts[2]] = String(value).trim();
                App.afterEdit('насосная ' + st.name);
                return;
            }

            if (parts[0] === 'obj') {
                if (parts[1] === 'height') {
                    var h = Fmt.parse(value);
                    book.object.height = h > 0 ? h : 0;
                } else {
                    book.object[parts[1]] = String(value).trim();
                }
                if (parts[1] === 'name') document.getElementById('projectName').value = book.object.name;
                App.afterEdit('данные объекта');
                return;
            }

            if (parts[0] === 'sys') {
                var sys = find(book, parts[1]);
                if (!sys) return;
                sys[parts[2]] = String(value).trim();
                if (parts[2] === 'code' && sys.project) sys.project.settings.systemName = sys.code;
                if (parts[2] === 'code' && sys.floors) sys.floors.plans.forEach(function (p) { p.project.settings.systemName = sys.code; });
                App.afterEdit('системы проекта');
            }
        }, 0);
    }

    function onClick(e) {
        var button = e.target.closest('[data-action]');
        if (!button) return;

        var parts = button.dataset.action.split(':');
        var book = App.book;

        switch (parts[0]) {
            case 'sys-open':
                closeManager();
                App.activate(parts[1]);
                break;
            case 'sys-color-reset': {
                var cs = find(book, parts[1]);
                if (cs) {
                    cs.color = '';
                    App.afterEdit('цвет системы ' + cs.code);
                }
                break;
            }
            case 'sys-dxf-template':
                exportTemplate(book);
                break;
            case 'sys-dup': {
                var copy = duplicate(book, parts[1]);
                if (copy) App.afterEdit('копия системы ' + copy.code);
                break;
            }
            case 'sys-del': {
                var sys = find(book, parts[1]);
                if (sys && window.confirm('Удалить систему ' + sys.code + '? Отменить можно кнопкой «Отменить».')) {
                    remove(book, parts[1]);
                    App.activate(book.active, true);
                    App.afterEdit('удаление системы ' + sys.code);
                }
                break;
            }
            case 'sys-add-apt':
            case 'sys-add-floors':
            case 'sys-add-vpv':
            case 'sys-add-vpvplan': {
                var added = add(book, parts[0].replace('sys-add-', ''));
                App.afterEdit('новая система ' + added.code);
                break;
            }
            case 'st-add':
                book.stations = book.stations || [];
                book.stations.push(Stations.create(book));
                App.afterEdit('новая насосная');
                break;
            case 'st-del':
                if (window.confirm('Удалить насосную? Системы останутся.')) {
                    Stations.remove(book, parts[1]);
                    App.afterEdit('удаление насосной');
                }
                break;
            case 'sys-close':
                closeManager();
                break;
        }
    }

    function init() {
        document.getElementById('systemSelect').addEventListener('change', function () {
            if (this.value === '__tch') App.showText();
            else if (this.value === '__scheme') App.showScheme();
            else if (this.value === '__task') App.showTask();
            else App.activate(this.value);
        });
        document.getElementById('systemsBtn').addEventListener('click', openManager);

        var root = document.getElementById('modalRoot');
        root.addEventListener('change', onChange);
        root.addEventListener('click', onClick);
    }

    return {
        KIND: KIND,
        find: find,
        active: active,
        add: add,
        duplicate: duplicate,
        remove: remove,
        fileBase: fileBase,
        label: label,
        renderSelect: renderSelect,
        openManager: openManager,
        init: init
    };
})();
