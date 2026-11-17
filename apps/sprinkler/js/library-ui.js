'use strict';

/*
    Окно «Объекты»: список объектов, переключение между ними, ревизии.

    В шапке — кнопка «Объекты», рядом отметка текущей ревизии («Р02»,
    «Р02 · изменён», «без ревизий») и «+ Ревизия» — зафиксировать состояние
    одним щелчком. Всё остальное в окне: объекты слева, у выбранного справа —
    название, ревизии, копия, архив, удаление.

    Объект открывается своей рабочей копией: ничего не теряется, работа каждого
    объекта записывается сама. Ревизия не меняется; «Вернуться» делает её
    рабочей копией (если после неё были правки, программа предупредит),
    «Копией» — заводит из неё новый объект.
*/

var LibraryUI = (function () {

    var root = null;
    var open = false;
    var items = [];
    var selected = '';
    var revs = [];

    function $(id) { return document.getElementById(id); }
    function esc(text) { return Fmt.html(text === null || text === undefined ? '' : String(text)); }
    function two(n) { return (n < 10 ? '0' : '') + n; }

    function dateText(t) {
        if (!t) return '';
        var d = new Date(t);
        return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear()
            + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    }

    function sizeText(n) {
        if (!n) return '';
        return n < 1024 * 1024
            ? Math.max(1, Math.round(n / 1024)) + ' КБ'
            : (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
    }

    function fail(e) {
        App.status((e && e.message) || String(e), 'warn');
    }

    function saveJson(data, name) {
        Zip.save(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name);
    }

    /* --- отметка в шапке ----------------------------------------------------- */

    function chip() {
        var el = $('libRev');
        if (!el) return;

        var i = Library.info();
        if (!i) { el.textContent = ''; el.className = 'lib-rev'; return; }

        if (!i.baseRev) {
            el.textContent = i.hasRevs ? 'вне ревизий' : 'без ревизий';
            el.className = 'lib-rev none';
            el.title = i.hasRevs
                ? 'Рабочая копия не привязана к ревизии'
                : 'Ни одной ревизии ещё не сохранено';
        } else {
            el.textContent = i.baseLabel + (i.dirty ? ' · изменён' : '');
            el.className = 'lib-rev' + (i.dirty ? ' dirty' : ' clean');
            el.title = i.dirty
                ? 'Есть правки после ' + i.baseLabel + ' — сохраните новую ревизию'
                : 'Совпадает с ' + i.baseLabel;
        }
    }

    /* --- окно ---------------------------------------------------------------- */

    function refresh() {
        return Library.list().then(function (list) {
            items = list;
            var cur = Library.info();
            if (!selected || !items.some(function (o) { return o.id === selected; })) {
                selected = cur ? cur.id : (items[0] ? items[0].id : '');
            }
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
                + '<div class="lib-name">' + (isCur ? '<span class="lib-dot" title="Открыт сейчас">●</span> ' : '')
                + esc(o.name) + '</div>'
                + '<div class="lib-sub">'
                + (o.lastRev ? esc(o.lastRev.label) + (o.dirty ? ' + правки' : '') + ' · ' : 'без ревизий · ')
                + esc(dateText(o.updated)) + '</div></div>';
        }).join('');

        root.innerHTML = '<div class="modal lib-modal" data-lib="close"><div class="sheet lib-sheet">'
            + '<h2>Объекты и ревизии</h2>'
            + '<div class="lib-cols">'
            + '<div class="lib-side">'
            + '<div class="actions"><button data-lib="new" class="primary">+ Новый объект</button>'
            + '<button data-lib="file" title="Файл книги .json или архив объекта">Из файла…</button></div>'
            + '<div class="lib-list">' + (list || '<p class="hint">Объектов пока нет.</p>') + '</div></div>'
            + '<div class="lib-main">'
            + (sel ? detail(sel, cur) : '<p class="hint">Выберите объект слева или заведите новый.</p>')
            + '</div></div>'
            + '<p class="hint">Объекты лежат в этом браузере, у каждого своя рабочая копия и ревизии. '
            + 'Чтобы не зависеть от браузера, выгружайте объект архивом — со всеми ревизиями — и держите файл '
            + 'в папке проекта.</p>'
            + '<div class="sheet-buttons"><button data-lib="close" class="primary">Закрыть</button></div>'
            + '</div></div>';

        if (typed && $('libComment')) $('libComment').value = typed;
    }

    function detail(o, cur) {
        var isCur = cur && cur.id === o.id;
        var h = [];

        h.push('<label class="field"><span>Название объекта</span>'
            + '<input type="text" id="libName" value="' + esc(o.name) + '"></label>');
        h.push('<p class="hint">Рабочая копия изменена ' + esc(dateText(o.updated))
            + (o.size ? ' · ' + sizeText(o.size) : '')
            + (o.baseLabel ? ' · основа — ' + esc(o.baseLabel) + (o.dirty ? ', есть правки' : ', без правок') : '')
            + '</p>');

        h.push('<div class="actions">');
        h.push(isCur
            ? '<span class="lib-open">Открыт сейчас</span>'
            : '<button data-lib="openObj" class="primary">Открыть объект</button>');
        h.push('<button data-lib="dup" title="Новый объект из рабочей копии, без истории">Копия объекта</button>'
            + '<button data-lib="archive" title="Рабочая копия и все ревизии одним файлом">Архив (.json)</button>'
            + '<button data-lib="delObj" class="danger">Удалить объект</button></div>');

        if (isCur) {
            h.push('<div class="lib-save"><label class="field"><span>Сохранить ревизию</span>'
                + '<input type="text" id="libComment" placeholder="Комментарий: для чего выдана, что изменилось"></label>'
                + '<button data-lib="save" class="primary">Зафиксировать ' + esc(Library.labelOf(nextNo())) + '</button></div>');
        }

        h.push('<h3>Ревизии</h3>');

        if (!revs.length) {
            h.push('<p class="hint">Ревизий нет. Ревизия — снимок объекта на момент выдачи: после неё можно править '
                + 'дальше и в любой момент вернуться к снимку.</p>');
        } else {
            h.push('<table class="grid lib-revs"><thead><tr><th>№</th><th>Дата</th><th>Автор</th>'
                + '<th>Комментарий</th><th></th></tr></thead><tbody>');

            revs.forEach(function (r) {
                var base = o.baseRev === r.id;
                h.push('<tr><td><b>' + esc(r.label) + '</b>'
                    + (base ? ' <span class="lib-base" title="Рабочая копия построена на этой ревизии">●</span>' : '')
                    + '</td><td>' + esc(dateText(r.date)) + '</td><td>' + esc(r.author) + '</td>'
                    + '<td class="name">' + esc(r.comment) + '</td><td class="lib-rbtn">'
                    + (isCur ? '<button data-lib="restore" data-id="' + esc(r.id) + '" title="Рабочая копия станет такой, как в ревизии">Вернуться</button>' : '')
                    + '<button data-lib="asCopy" data-id="' + esc(r.id) + '" title="Новый объект из ревизии">Копией</button>'
                    + '<button data-lib="revFile" data-id="' + esc(r.id) + '" title="Скачать книгу этой ревизии">Файл</button>'
                    + '<button data-lib="delRev" data-id="' + esc(r.id) + '" class="danger" title="Удалить ревизию">×</button>'
                    + '</td></tr>');
            });

            h.push('</tbody></table>');
        }

        return h.join('');
    }

    function nextNo() {
        return revs.reduce(function (m, r) { return Math.max(m, r.no + 1); }, 0);
    }

    /* --- действия ------------------------------------------------------------- */

    function openObj(id) {
        return Library.openObject(id).then(function (book) {
            App.load(book);
            chip();
            selected = id;
            App.status('Открыт объект: ' + book.object.name, 'done');
            return refresh();
        }, fail);
    }

    /** Новый объект из книги: заводится, открывается, выбирается в списке. */
    function adopt(book) {
        return Library.create(book).then(function (meta) {
            selected = meta.id;
            return openObj(meta.id);
        });
    }

    function newObject() {
        var name = window.prompt('Название нового объекта', '');
        if (name === null) return;

        var book = Storage.newBook();
        book.object.name = name.trim() || 'Без названия';
        adopt(book).catch(fail);
    }

    function openFile(file) {
        var reader = new FileReader();

        reader.onerror = function () { App.status('Файл не открылся.', 'warn'); };
        reader.onload = function () {
            var data;
            try {
                data = JSON.parse(String(reader.result));
            } catch (e) {
                App.status('Файл не читается: ' + e.message, 'warn');
                return;
            }

            try {
                if (Library.isArchive(data)) {
                    Library.importArchive(data).then(function (meta) {
                        selected = meta.id;
                        return openObj(meta.id);
                    }).catch(fail);
                } else {
                    var book = Storage.unpackBook(data);
                    adopt(book).then(function () {
                        App.status('Книга открыта новым объектом: ' + book.object.name, 'done');
                    }).catch(fail);
                }
            } catch (e) {
                App.status('Файл не читается как книга: ' + e.message, 'warn');
            }
        };

        reader.readAsText(file, 'utf-8');
    }

    function saveRevision() {
        var cur = Library.info();
        if (!cur) { App.status('Библиотека не запустилась: ревизии не ведутся.', 'warn'); return; }

        var field = $('libComment');
        var comment = field ? field.value : window.prompt('Комментарий к ревизии (для чего выдана, что изменилось)', '');
        if (comment === null) return;

        Library.touch(App.book);
        Library.saveRevision(comment).then(function (rev) {
            App.status('Ревизия ' + rev.label + ' сохранена: ' + cur.name, 'done');
            chip();
            if (open) refresh();
        }, fail);
    }

    function act(name, id) {
        if (name === 'close') { open = false; render(); return; }
        if (name === 'pick') { selected = id; refresh(); return; }
        if (name === 'new') { newObject(); return; }
        if (name === 'file') { $('libFile').click(); return; }
        if (name === 'save') { saveRevision(); return; }
        if (name === 'openObj') { openObj(selected); return; }

        if (name === 'dup') {
            Library.duplicate(selected).then(function () {
                App.status('Создана копия объекта.', 'done');
                return refresh();
            }).catch(fail);

        } else if (name === 'archive') {
            var o = items.filter(function (x) { return x.id === selected; })[0];
            Library.exportArchive(selected).then(function (data) {
                saveJson(data, Storage.safeName(o && o.name, ' — архив с ревизиями.json'));
                App.status('Архив объекта выгружен файлом.', 'done');
            }).catch(fail);

        } else if (name === 'delObj') {
            var victim = items.filter(function (x) { return x.id === selected; })[0];
            if (!victim) return;
            if (!window.confirm('Удалить объект «' + victim.name + '» вместе со всеми ревизиями? '
                + 'Это нельзя отменить.\n(Сначала его можно выгрузить архивом.)')) return;

            var wasCur = Library.info() && Library.info().id === selected;
            Library.deleteObject(selected).then(function () {
                selected = '';
                return Library.list();
            }).then(function (list) {
                if (!wasCur) return refresh();
                // Удалили открытый объект: открывается ближайший, а если их нет — заводится пустой.
                if (list.length) return openObj(list[0].id);
                return Library.create(Storage.newBook()).then(function (m) { return openObj(m.id); });
            }).catch(fail);

        } else if (name === 'restore') {
            var cur = Library.info();
            var rev = revs.filter(function (r) { return r.id === id; })[0];
            if (!cur || !rev) return;

            var warn = cur.dirty
                ? 'В рабочей копии есть правки после ' + cur.baseLabel + ' — они пропадут.\n'
                    + '(Сначала сохраните их новой ревизией.)\n\n'
                : '';
            if (!window.confirm(warn + 'Вернуть объект к ' + rev.label
                + (rev.comment ? ' («' + rev.comment + '»)' : '') + '?')) return;

            Library.restoreRevision(id).then(function (book) {
                App.load(book);
                chip();
                App.status('Объект возвращён к ' + rev.label, 'done');
                return refresh();
            }).catch(fail);

        } else if (name === 'asCopy') {
            var r2 = revs.filter(function (r) { return r.id === id; })[0];
            Library.revisionBook(id).then(function (book) {
                book.object.name = book.object.name + ' (' + (r2 ? r2.label : 'ревизия') + ')';
                return adopt(book);
            }).catch(fail);

        } else if (name === 'revFile') {
            var r3 = revs.filter(function (r) { return r.id === id; })[0];
            Library.revisionBook(id).then(function (book) {
                saveJson(book, Storage.safeName(book.object.name, ' ' + (r3 ? r3.label : '') + '.aupt.json'));
                App.status('Ревизия выгружена файлом книги.', 'done');
            }).catch(fail);

        } else if (name === 'delRev') {
            var r4 = revs.filter(function (r) { return r.id === id; })[0];
            if (!r4 || !window.confirm('Удалить ревизию ' + r4.label + '? Это нельзя отменить.')) return;
            Library.deleteRevision(id).then(refresh).then(chip).catch(fail);
        }
    }

    function show() {
        open = true;
        refresh();
    }

    function init() {
        root = document.createElement('div');
        root.id = 'libRoot';
        document.body.appendChild(root);

        root.addEventListener('click', function (e) {
            var b = e.target.closest('[data-lib]');
            if (!b) return;
            // Щелчок мимо окна закрывает его, щелчок внутри — нет.
            if (b.classList.contains('lib-modal') && e.target !== b) return;
            act(b.getAttribute('data-lib'), b.getAttribute('data-id'));
        });

        root.addEventListener('change', function (e) {
            if (e.target.id !== 'libName') return;
            var id = selected;
            Library.rename(id, e.target.value).then(function (title) {
                var cur = Library.info();
                if (cur && cur.id === id) {
                    App.book.object.name = title;
                    document.getElementById('projectName').value = title;
                }
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
        document.addEventListener('keydown', function (e) {
            if (open && e.key === 'Escape') { open = false; render(); }
        });

        Library.onChange(function () { chip(); if (open) refresh(); });
    }

    /** Библиотека недоступна (приватное окно, запрет IndexedDB) — шапка прячет кнопки. */
    function unavailable() {
        ['libBtn', 'libRev', 'revBtn'].forEach(function (id) {
            var el = $(id);
            if (el) el.hidden = true;
        });
    }

    return {
        init: init,
        chip: chip,
        show: show,
        newObject: newObject,
        openFile: openFile,
        unavailable: unavailable
    };
})();
