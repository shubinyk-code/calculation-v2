/*
    Окно «Объекты»: список проектов, переключение между ними, ревизии.

    В шапке — кнопка «Объекты», рядом отметка текущей ревизии («Р02», «Р02 · изменён»,
    «без ревизий») и «+ Ревизия» — зафиксировать состояние одним щелчком. Всё остальное — в
    окне: объекты слева, у выбранного справа — название, ревизии, копия, архив, удаление.

    Объект открывается своей рабочей копией: ничего не теряется, работа каждого объекта
    записывается сама. Ревизия не меняется; вернуться к ней — значит сделать её рабочей копией
    (если после неё были правки, программа предупредит), открыть копией — завести из неё новый
    объект.
*/

var UiLibrary = (function () {
    'use strict';

    var esc = Format.html;
    var root = null;
    var open = false;
    var items = [];
    var selected = '';
    var revs = [];
    var failed = '';

    function $(id) { return document.getElementById(id); }

    function say(text, kind) { App.say(text, kind || 'done'); }

    function two(n) { return (n < 10 ? '0' : '') + n; }

    function dateText(t) {
        if (!t) return '';
        var d = new Date(t);
        return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    }

    function sizeText(n) {
        if (!n) return '';
        return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' КБ' : (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
    }

    function fileSafe(s) { return String(s || 'проект').replace(/[\\\/:*?"<>|]/g, '-'); }

    function saveJson(data, name) {
        var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    function fail(e) { say((e && e.message) || String(e), 'fail'); }

    /* --- шапка ------------------------------------------------------------------- */

    function chip() {
        var el = $('libRev');
        var rev = $('revBtn');
        if (!el) return;

        var i = Library.info();
        if (!i) { el.textContent = ''; el.className = 'lib-rev'; return; }

        if (!i.baseRev) {
            el.textContent = i.hasRevs ? 'вне ревизий' : 'без ревизий';
            el.className = 'lib-rev none';
            el.title = i.hasRevs ? 'Рабочая копия не привязана к ревизии' : 'Ни одна ревизия ещё не сохранена';
        } else {
            el.textContent = i.baseLabel + (i.dirty ? ' · изменён' : '');
            el.className = 'lib-rev' + (i.dirty ? ' dirty' : ' clean');
            el.title = i.dirty ? 'Есть правки после ' + i.baseLabel + ' — сохраните новую ревизию' : 'Совпадает с ' + i.baseLabel;
        }
        if (rev) rev.disabled = false;
    }

    /* --- обновление окна ----------------------------------------------------------- */

    function refresh() {
        return Library.list().then(function (list) {
            items = list;
            var cur = Library.info();
            if (!selected || !items.some(function (o) { return o.id === selected; })) selected = cur ? cur.id : (items[0] ? items[0].id : '');
            return selected ? Library.revisions(selected) : [];
        }).then(function (rs) {
            revs = rs;
            render();
        }, fail);
    }

    function render() {
        if (!root) return;
        if (!open) { root.innerHTML = ''; return; }

        var cur = Library.info();
        var sel = items.filter(function (o) { return o.id === selected; })[0];
        var typed = $('libComment') ? $('libComment').value : '';

        var list = items.map(function (o) {
            var isCur = cur && cur.id === o.id;
            return '<div class="lib-row' + (o.id === selected ? ' sel' : '') + '" data-lib="pick" data-id="' + esc(o.id) + '">'
                + '<div class="lib-name">' + (isCur ? '<span class="lib-dot" title="Открыт сейчас">●</span> ' : '') + esc(o.name) + '</div>'
                + '<div class="lib-sub">' + (o.lastRev ? esc(o.lastRev.label) + (o.dirty ? ' + правки' : '') + ' · ' : 'без ревизий · ')
                + esc(dateText(o.updated)) + '</div></div>';
        }).join('');

        root.innerHTML = '<div class="lib-back" data-lib="close"><div class="lib-sheet">'
            + '<div class="lib-top"><h2>Объекты и ревизии</h2><button type="button" data-lib="close" class="small">Закрыть</button></div>'
            + '<div class="lib-cols">'
            + '<div class="lib-side"><div class="lib-bar"><button type="button" data-lib="new" class="primary small">+ Новый объект</button>'
            + '<button type="button" data-lib="file" class="small" title="Файл проекта .json или архив объекта">Из файла…</button></div>'
            + '<div class="lib-list">' + (list || '<p class="hint">Объектов пока нет.</p>') + '</div></div>'
            + '<div class="lib-main">' + (sel ? detail(sel, cur) : '<p class="hint">Выберите объект слева или создайте новый.</p>') + '</div>'
            + '</div>'
            + (failed ? '<p class="st-bad">' + esc(failed) + '</p>' : '')
            + '<p class="hint lib-foot">Объекты хранятся в этом браузере (в нём же рабочая копия каждого). Чтобы не зависеть от браузера, '
            + 'выгружайте объект архивом — со всеми ревизиями — и храните файл в папке проекта.</p>'
            + '</div></div>';

        if (typed && $('libComment')) $('libComment').value = typed;
    }

    function detail(o, cur) {
        var isCur = cur && cur.id === o.id;
        var h = [];

        h.push('<label class="lib-field"><span>Название объекта</span><input type="text" id="libName" value="' + esc(o.name) + '"></label>');
        h.push('<p class="hint">Рабочая копия изменена ' + esc(dateText(o.updated)) + (o.size ? ' · ' + sizeText(o.size) : '')
            + (o.baseLabel ? ' · основа — ' + esc(o.baseLabel) + (o.dirty ? ', есть правки' : ', без правок') : '') + '</p>');

        h.push('<div class="lib-actions">');
        if (!isCur) h.push('<button type="button" data-lib="openObj" class="primary small">Открыть объект</button>');
        else h.push('<span class="lib-open">Открыт сейчас</span>');
        h.push('<button type="button" data-lib="dup" class="small" title="Новый объект из рабочей копии, без истории">Копия объекта</button>'
            + '<button type="button" data-lib="archive" class="small" title="Рабочая копия и все ревизии одним файлом">Архив (.json)</button>'
            + '<button type="button" data-lib="delObj" class="small danger">Удалить объект</button></div>');

        if (isCur) {
            h.push('<div class="lib-save"><label class="lib-field"><span>Сохранить ревизию</span>'
                + '<input type="text" id="libComment" placeholder="Комментарий: для чего выдана, что изменилось"></label>'
                + '<button type="button" data-lib="save" class="primary small">Зафиксировать ' + esc(Library.labelOf(nextNo())) + '</button></div>');
        }

        h.push('<h3>Ревизии</h3>');
        if (!revs.length) {
            h.push('<p class="hint">Ревизий нет. Ревизия — снимок объекта на момент выдачи; после неё можно править дальше и вернуться к снимку.</p>');
        } else {
            h.push('<table class="lib-revs"><thead><tr><th>№</th><th>Дата</th><th>Автор</th><th class="left">Комментарий</th><th></th></tr></thead><tbody>');
            revs.forEach(function (r) {
                var base = o.baseRev === r.id;
                h.push('<tr><td><b>' + esc(r.label) + '</b>' + (base ? ' <span class="lib-base" title="Рабочая копия построена на этой ревизии">●</span>' : '') + '</td>'
                    + '<td>' + esc(dateText(r.date)) + '</td><td>' + esc(r.author) + '</td><td class="left">' + esc(r.comment) + '</td><td class="lib-rbtn">'
                    + (isCur ? '<button type="button" class="small" data-lib="restore" data-id="' + esc(r.id) + '" title="Рабочая копия станет такой, как в ревизии">Вернуться</button>' : '')
                    + '<button type="button" class="small" data-lib="asCopy" data-id="' + esc(r.id) + '" title="Новый объект из ревизии">Копией</button>'
                    + '<button type="button" class="small" data-lib="revFile" data-id="' + esc(r.id) + '" title="Скачать проект этой ревизии">Файл</button>'
                    + '<button type="button" class="small danger" data-lib="delRev" data-id="' + esc(r.id) + '" title="Удалить ревизию">×</button></td></tr>');
            });
            h.push('</tbody></table>');
        }

        return h.join('');
    }

    function nextNo() {
        return revs.reduce(function (m, r) { return Math.max(m, r.no + 1); }, 0);
    }

    /* --- действия ---------------------------------------------------------------- */

    function loadInto(project, text) {
        App.load(project, text);
        chip();
    }

    function openObj(id) {
        return Library.openObject(id).then(function (p) {
            loadInto(p, 'Открыт объект: ' + p.name);
            selected = id;
            return refresh();
        }, fail);
    }

    /* Новый объект из проекта: заводится, открывается, выбирается в списке. */
    function adopt(project) {
        return Library.create(project).then(function (meta) {
            selected = meta.id;
            return openObj(meta.id);
        });
    }

    function newObject() {
        var name = window.prompt('Название нового объекта', '');
        if (name === null) return;
        var p = Storage.blank();
        p.name = name.trim() || 'Без названия';
        adopt(p).catch(fail);
    }

    function openFile(file) {
        var reader = new FileReader();
        reader.onerror = function () { say('Файл не открылся.', 'fail'); };
        reader.onload = function () {
            var data;
            try { data = JSON.parse(String(reader.result)); } catch (e) { say('Файл не читается как проект: ' + e.message, 'fail'); return; }

            try {
                if (Library.isArchive(data)) {
                    Library.importArchive(data).then(function (meta) { selected = meta.id; return openObj(meta.id); }).catch(fail);
                } else {
                    var p = Storage.normalize(data);
                    adopt(p).then(function () { say('Проект открыт как новый объект: ' + p.name); }).catch(fail);
                }
            } catch (e) { say('Файл не читается как проект: ' + e.message, 'fail'); }
        };
        reader.readAsText(file, 'utf-8');
    }

    function saveRevision() {
        var cur = Library.info();
        if (!cur) { say('Библиотека не запущена.', 'warn'); return; }
        var field = $('libComment');
        var comment = field ? field.value : window.prompt('Комментарий к ревизии (для чего выдана, что изменилось)', '');
        if (comment === null) return;

        App.run();
        Library.saveRevision(comment).then(function (rev) {
            say('Ревизия ' + rev.label + ' сохранена: ' + cur.name);
            chip();
            if (open) refresh();
        }, fail);
    }

    function act(name, id) {
        failed = '';

        if (name === 'close') { open = false; render(); return; }
        if (name === 'pick') { selected = id; refresh(); return; }
        if (name === 'new') { newObject(); return; }
        if (name === 'file') { $('libFile').click(); return; }
        if (name === 'save') { saveRevision(); return; }
        if (name === 'openObj') { openObj(selected); return; }

        if (name === 'dup') {
            Library.duplicate(selected).then(function (meta) { selected = meta.id; say('Создана копия объекта.'); return refresh(); }).catch(fail);
        } else if (name === 'archive') {
            var o = items.filter(function (x) { return x.id === selected; })[0];
            Library.exportArchive(selected).then(function (data) {
                saveJson(data, fileSafe(o && o.name) + ' — архив с ревизиями.json');
                say('Архив объекта выгружен файлом.');
            }).catch(fail);
        } else if (name === 'delObj') {
            var victim = items.filter(function (x) { return x.id === selected; })[0];
            if (!victim) return;
            if (!window.confirm('Удалить объект «' + victim.name + '» вместе со всеми ревизиями? Это нельзя отменить.\n(Сначала можно выгрузить его архивом.)')) return;
            var wasCur = Library.info() && Library.info().id === selected;
            Library.deleteObject(selected).then(function () {
                selected = '';
                return Library.list();
            }).then(function (list) {
                if (!wasCur) return refresh();
                // удалён открытый объект — открывается ближайший или заводится пустой
                if (list.length) return openObj(list[0].id);
                var p = Storage.blank();
                return Library.create(p).then(function (m) { selected = m.id; return openObj(m.id); });
            }).catch(fail);
        } else if (name === 'restore') {
            var cur = Library.info();
            var rev = revs.filter(function (r) { return r.id === id; })[0];
            if (!cur || !rev) return;
            var warn = cur.dirty
                ? 'В рабочей копии есть правки после ' + cur.baseLabel + ' — они пропадут.\n(Сначала сохраните их новой ревизией.)\n\n'
                : '';
            if (!window.confirm(warn + 'Вернуть объект к ' + rev.label + (rev.comment ? ' («' + rev.comment + '»)' : '') + '?')) return;
            Library.restoreRevision(id).then(function (p) {
                loadInto(p, 'Объект возвращён к ' + rev.label);
                return refresh();
            }).catch(fail);
        } else if (name === 'asCopy') {
            var r2 = revs.filter(function (r) { return r.id === id; })[0];
            Library.revisionProject(id).then(function (p) {
                p.name = (p.name || 'Без названия') + ' (' + (r2 ? r2.label : 'ревизия') + ')';
                return adopt(p);
            }).catch(fail);
        } else if (name === 'revFile') {
            var r3 = revs.filter(function (r) { return r.id === id; })[0];
            Library.revisionProject(id).then(function (p) {
                saveJson(p, fileSafe(p.name) + ' ' + (r3 ? r3.label : '') + '.json');
                say('Ревизия выгружена файлом проекта.');
            }).catch(fail);
        } else if (name === 'delRev') {
            var r4 = revs.filter(function (r) { return r.id === id; })[0];
            if (!r4 || !window.confirm('Удалить ревизию ' + r4.label + '? Это нельзя отменить.')) return;
            Library.deleteRevision(id).then(refresh).then(chip).catch(fail);
        }
    }

    function show() {
        open = true;
        failed = '';
        refresh();
    }

    function init() {
        root = document.createElement('div');
        root.id = 'libRoot';
        document.body.appendChild(root);

        root.addEventListener('click', function (e) {
            var b = e.target.closest('[data-lib]');
            if (!b) return;
            if (b.classList.contains('lib-back') && e.target !== b) return;
            act(b.getAttribute('data-lib'), b.getAttribute('data-id'));
        });

        root.addEventListener('change', function (e) {
            if (e.target.id !== 'libName') return;
            var id = selected;
            Library.rename(id, e.target.value).then(function (title) {
                if (Library.info() && Library.info().id === id) App.syncName(title);
                return refresh();
            }).catch(fail);
        });

        var file = document.createElement('input');
        file.type = 'file';
        file.id = 'libFile';
        file.accept = '.json,application/json';
        file.hidden = true;
        file.addEventListener('change', function (e) {
            var f = e.target.files && e.target.files[0];
            if (f) openFile(f);
            e.target.value = '';
        });
        document.body.appendChild(file);

        $('libBtn').addEventListener('click', show);
        $('libRev').addEventListener('click', show);
        $('revBtn').addEventListener('click', saveRevision);

        window.addEventListener('pagehide', function () { Library.flush(); });
        document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') { open = false; render(); } });

        Library.onChange(function () { chip(); if (open) refresh(); });
    }

    /* Библиотека недоступна (приватное окно, запрет IndexedDB) — шапка прячет её кнопки. */
    function unavailable() {
        ['libBtn', 'libRev', 'revBtn'].forEach(function (id) { var el = $(id); if (el) el.hidden = true; });
    }

    return { init: init, chip: chip, show: show, newObject: newObject, openFile: openFile, unavailable: unavailable };
})();
