/*
    Библиотека объектов: много проектов в одном браузере, у каждого — ревизии.

    Раньше программа помнила один проект (последнее состояние в localStorage) и
    «Новый» его стирал. Теперь:

        объект      рабочая копия — то, с чем идёт работа; пишется сама после каждой правки;
        ревизия     зафиксированный снимок объекта: номер Р00, Р01, …, дата, комментарий.
                    Вернуться к ревизии можно в любой момент, ревизии не меняются.

    Хранилище — IndexedDB (в localStorage такие проекты не помещаются: каталожные листы
    насосов лежат в проекте файлами). Три таблицы: объекты и ревизии — только сведения
    (список открывается мгновенно), сами проекты — в таблице blobs: «w:<объект>» —
    рабочая копия, «r:<ревизия>» — ревизия. localStorage остаётся быстрым запасом на случай
    закрытия вкладки в ту же секунду после правки (его читает Storage.recall).

    «Изменён после ревизии» определяется по отпечатку проекта, приведённого к
    нормальному виду (Storage.normalize): отпечаток не зависит от порядка полей и от того,
    дописала ли программа значения по умолчанию.

    Чтобы не потерять работу при очистке данных браузера, объект выгружается архивом
    (все ревизии одним файлом) и читается обратно.
*/

var Library = (function () {
    'use strict';

    var CURRENT_BASE = 'vk-library-current';
    var ARCHIVE = 'vk-object-archive';
    var DELAY = 500;                 // мс между правкой и записью рабочей копии

    var dbName = 'vk-library';
    var dbp = null;
    var current = null;              // сведения об открытом объекте
    var latest = null;               // проект, который записывается следующим
    var timer = null;
    var pendingBase = false;         // после загрузки — первый же снимок считать «как в ревизии»
    var listeners = [];
    var ready = false;

    /* Указатель «какой объект открыт»: у проверочной базы свой, чтобы не сбить рабочий. */
    function currentKey() { return dbName === 'vk-library' ? CURRENT_BASE : CURRENT_BASE + ':' + dbName; }

    /* --- IndexedDB --------------------------------------------------------------- */

    function open() {
        if (dbp) return dbp;

        dbp = new Promise(function (resolve, reject) {
            if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB недоступна')); return; }
            var req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                db.createObjectStore('objects', { keyPath: 'id' });
                db.createObjectStore('revisions', { keyPath: 'id' }).createIndex('obj', 'obj');
                db.createObjectStore('blobs', { keyPath: 'id' });
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('IndexedDB не открылась')); };
            req.onblocked = function () { reject(new Error('IndexedDB заблокирована другой вкладкой')); };
        });

        dbp.catch(function () { dbp = null; });
        return dbp;
    }

    function wrap(req) {
        return new Promise(function (resolve, reject) {
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /* Одна операция над таблицей: fn(store) возвращает запрос. */
    function op(store, mode, fn) {
        return open().then(function (db) {
            var tx = db.transaction(store, mode);
            var result = wrap(fn(tx.objectStore(store)));
            return new Promise(function (resolve, reject) {
                tx.oncomplete = function () { result.then(resolve, reject); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error || new Error('транзакция отменена')); };
            });
        });
    }

    function get(store, key) { return op(store, 'readonly', function (s) { return s.get(key); }); }
    function put(store, value) { return op(store, 'readwrite', function (s) { return s.put(value); }); }
    function del(store, key) { return op(store, 'readwrite', function (s) { return s.delete(key); }); }
    function all(store) { return op(store, 'readonly', function (s) { return s.getAll(); }); }

    /* --- отпечаток --------------------------------------------------------------- */

    function fnv(text) {
        var h = 0x811c9dc5;
        for (var i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(16) + '.' + text.length;
    }

    /* Нормальный вид: то, что получится при чтении проекта обратно. */
    function canon(project) {
        return JSON.stringify(Storage.normalize(JSON.parse(JSON.stringify(project))));
    }

    function printOf(project) { return fnv(canon(project)); }

    function newId(prefix) {
        return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function two(n) { return (n < 10 ? '0' : '') + n; }

    function labelOf(no) { return 'Р' + two(no); }

    function authorOf(project) {
        var h = project.hyd || {};
        return (h.note && h.note.engineer) || (h.itp && h.itp.author) || '';
    }

    function emit() {
        listeners.forEach(function (fn) { try { fn(info()); } catch (e) { /* подписчик не должен ронять запись */ } });
    }

    function onChange(fn) { listeners.push(fn); }

    /* Сведения об открытом объекте для шапки. */
    function info() {
        if (!current) return null;
        return {
            id: current.id,
            name: current.name,
            baseRev: current.baseRev || '',
            baseLabel: current.baseLabel || '',
            dirty: !!current.baseRev && current.workHash !== current.baseHash,
            hasRevs: (current.nextNo || 0) > 0,
            updated: current.updated
        };
    }

    /* --- запись рабочей копии ---------------------------------------------------- */

    function flush() {
        clearTimeout(timer);
        timer = null;
        if (!current || !latest) return Promise.resolve();

        var meta = current;
        var json = JSON.stringify(latest);
        var print = printOf(latest);

        meta.name = latest.name || meta.name;
        meta.updated = Date.now();
        meta.workHash = print;
        meta.size = json.length;
        if (pendingBase) {
            meta.baseHash = print;
            pendingBase = false;
        }

        return Promise.all([put('blobs', { id: 'w:' + meta.id, json: json }), put('objects', clone(meta))]).then(emit);
    }

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    /* Вызывается после каждого пересчёта; запись откладывается, чтобы не писать на каждую букву. */
    function touch(project) {
        if (!current) return;
        latest = project;
        clearTimeout(timer);
        timer = setTimeout(flush, pendingBase ? 0 : DELAY);
    }

    /* Закрыть вкладку, не дожидаясь отложенной записи. */
    function flushNow() { return flush(); }

    /* --- объекты ----------------------------------------------------------------- */

    function metaFor(project, name) {
        var now = Date.now();
        return {
            id: newId('o'), name: name || project.name || 'Без названия', created: now, updated: now,
            baseRev: '', baseLabel: '', baseHash: '', workHash: '', nextNo: 0, size: 0
        };
    }

    /* Новый объект из проекта (рабочая копия = проект). Не делает его открытым. */
    function create(project, name) {
        var meta = metaFor(project, name);
        var json = JSON.stringify(project);
        meta.workHash = printOf(project);
        meta.size = json.length;
        return Promise.all([put('objects', meta), put('blobs', { id: 'w:' + meta.id, json: json })]).then(function () { return meta; });
    }

    function list() {
        return Promise.all([all('objects'), all('revisions')]).then(function (res) {
            var revs = {};
            res[1].forEach(function (r) { (revs[r.obj] = revs[r.obj] || []).push(r); });

            return res[0].map(function (o) {
                var rs = (revs[o.id] || []).sort(function (a, b) { return a.no - b.no; });
                return {
                    id: o.id, name: o.name, created: o.created, updated: o.updated, size: o.size || 0,
                    baseRev: o.baseRev || '', baseLabel: o.baseLabel || '',
                    dirty: !!o.baseRev && o.workHash !== o.baseHash,
                    revCount: rs.length, lastRev: rs.length ? rs[rs.length - 1] : null
                };
            }).sort(function (a, b) { return b.updated - a.updated; });
        });
    }

    function revisions(objId) {
        return op('revisions', 'readonly', function (s) { return s.index('obj').getAll(objId); }).then(function (rs) {
            return rs.sort(function (a, b) { return b.no - a.no; });
        });
    }

    function readBlob(id) {
        return get('blobs', id).then(function (b) {
            if (!b) throw new Error('данные не найдены (' + id + ')');
            return JSON.parse(b.json);
        });
    }

    /* Объект открывается: рабочая копия → проект. Текущий перед этим дописывается. */
    function openObject(id) {
        return flush().then(function () { return get('objects', id); }).then(function (meta) {
            if (!meta) throw new Error('Объект не найден');
            return readBlob('w:' + id).then(function (raw) {
                current = meta;
                latest = null;
                try { localStorage.setItem(currentKey(), id); } catch (e) { /* без запасного указателя можно жить */ }
                var project = Storage.normalize(raw);
                pendingBase = false;
                emit();
                return project;
            });
        });
    }

    /* Зафиксировать ревизию из текущей рабочей копии. */
    function saveRevision(comment) {
        if (!current || !latest) return Promise.reject(new Error('Нет открытого объекта'));

        return flush().then(function () {
            var meta = current;
            var no = meta.nextNo || 0;
            var json = JSON.stringify(latest);
            var rev = {
                id: newId('r'), obj: meta.id, no: no, label: labelOf(no), comment: String(comment || '').trim(),
                date: Date.now(), author: authorOf(latest), hash: meta.workHash, size: json.length
            };

            meta.nextNo = no + 1;
            meta.baseRev = rev.id;
            meta.baseLabel = rev.label;
            meta.baseHash = meta.workHash;

            return Promise.all([put('revisions', rev), put('blobs', { id: 'r:' + rev.id, json: json }), put('objects', clone(meta))]).then(function () {
                emit();
                return rev;
            });
        });
    }

    /* Ревизия → рабочая копия открытого объекта. */
    function restoreRevision(revId) {
        if (!current) return Promise.reject(new Error('Нет открытого объекта'));

        return get('revisions', revId).then(function (rev) {
            if (!rev) throw new Error('Ревизия не найдена');
            return readBlob('r:' + revId).then(function (raw) {
                current.baseRev = rev.id;
                current.baseLabel = rev.label;
                latest = null;
                pendingBase = true;
                return Storage.normalize(raw);
            });
        });
    }

    /* Содержимое ревизии без открытия — для скачивания и копии. */
    function revisionProject(revId) {
        return readBlob('r:' + revId).then(function (raw) { return Storage.normalize(raw); });
    }

    function deleteRevision(revId) {
        return get('revisions', revId).then(function (rev) {
            if (!rev) return null;
            return Promise.all([del('revisions', revId), del('blobs', 'r:' + revId)]).then(function () {
                if (current && current.id === rev.obj && current.baseRev === revId) {
                    current.baseRev = '';
                    current.baseLabel = '';
                    return put('objects', clone(current)).then(emit);
                }
                if (current && current.id === rev.obj) return null;
                return get('objects', rev.obj).then(function (meta) {
                    if (meta && meta.baseRev === revId) { meta.baseRev = ''; meta.baseLabel = ''; return put('objects', meta); }
                    return null;
                });
            });
        });
    }

    function deleteObject(id) {
        return revisions(id).then(function (rs) {
            var jobs = [del('objects', id), del('blobs', 'w:' + id)];
            rs.forEach(function (r) { jobs.push(del('revisions', r.id)); jobs.push(del('blobs', 'r:' + r.id)); });
            return Promise.all(jobs);
        }).then(function () {
            if (current && current.id === id) { current = null; latest = null; }
        });
    }

    /* Переименование: название — поле самого проекта, поэтому правится и рабочая копия. */
    function rename(id, name) {
        var title = String(name || '').trim() || 'Без названия';

        if (current && current.id === id) {
            if (latest) latest.name = title;
            current.name = title;
            return flush().then(function () { return title; });
        }

        return Promise.all([get('objects', id), readBlob('w:' + id)]).then(function (res) {
            var meta = res[0];
            var raw = res[1];
            if (!meta) throw new Error('Объект не найден');
            raw.name = title;
            meta.name = title;
            return Promise.all([put('objects', meta), put('blobs', { id: 'w:' + id, json: JSON.stringify(raw) })]).then(function () { return title; });
        });
    }

    /* Копия объекта: рабочая копия (или ревизия) становится новым объектом без истории. */
    function duplicate(id, revId) {
        return readBlob(revId ? 'r:' + revId : 'w:' + id).then(function (raw) {
            var project = Storage.normalize(raw);
            project.name = (project.name || 'Без названия') + ' (копия)';
            return create(project);
        });
    }

    /* --- архив ------------------------------------------------------------------- */

    /* Весь объект одним файлом: рабочая копия и все ревизии. */
    function exportArchive(id) {
        return Promise.all([get('objects', id), readBlob('w:' + id), revisions(id)]).then(function (res) {
            var meta = res[0];
            var revs = res[2].sort(function (a, b) { return a.no - b.no; });
            return Promise.all(revs.map(function (r) { return readBlob('r:' + r.id); })).then(function (datas) {
                return {
                    format: ARCHIVE, version: 1, exported: Date.now(), name: meta.name,
                    baseNo: meta.baseRev ? (revs.filter(function (r) { return r.id === meta.baseRev; })[0] || {}).no : null,
                    working: res[1],
                    revisions: revs.map(function (r, i) {
                        return { no: r.no, comment: r.comment, date: r.date, author: r.author, data: datas[i] };
                    })
                };
            });
        });
    }

    function isArchive(data) { return !!data && data.format === ARCHIVE && Array.isArray(data.revisions); }

    /* Архив → новый объект со всеми ревизиями. */
    function importArchive(data) {
        var working = Storage.normalize(data.working || data.revisions[data.revisions.length - 1].data);
        var meta = metaFor(working, data.name);
        var revs = data.revisions.slice().sort(function (a, b) { return a.no - b.no; });
        var jobs = [];

        meta.workHash = printOf(working);
        meta.size = JSON.stringify(working).length;
        meta.nextNo = revs.length ? revs[revs.length - 1].no + 1 : 0;

        revs.forEach(function (r) {
            var project = Storage.normalize(r.data);
            var json = JSON.stringify(project);
            var rev = {
                id: newId('r'), obj: meta.id, no: r.no, label: labelOf(r.no), comment: r.comment || '',
                date: r.date || Date.now(), author: r.author || '', hash: printOf(project), size: json.length
            };
            if (data.baseNo === r.no) { meta.baseRev = rev.id; meta.baseLabel = rev.label; meta.baseHash = rev.hash; }
            jobs.push(put('revisions', rev));
            jobs.push(put('blobs', { id: 'r:' + rev.id, json: json }));
        });

        jobs.push(put('objects', meta));
        jobs.push(put('blobs', { id: 'w:' + meta.id, json: JSON.stringify(working) }));
        return Promise.all(jobs).then(function () { return meta; });
    }

    /* --- запуск ------------------------------------------------------------------ */

    /*
        Старт: проект, который программа уже подняла (из localStorage или пустой), становится
        рабочей копией открытого объекта. Если объекта ещё нет — он заводится из этого проекта
        (так же переезжает проект из прежней версии программы).

        hadSaved — программа действительно нашла сохранённое состояние. Если нет (данные браузера
        очищены), а в библиотеке объекты есть, открывается последний из них.
    */
    function boot(project, hadSaved) {
        return open().then(function () {
            var id = null;
            try { id = localStorage.getItem(currentKey()); } catch (e) { id = null; }
            return id ? get('objects', id) : null;
        }).then(function (meta) {
            if (meta && hadSaved) {
                current = meta;
                latest = project;
                ready = true;
                return flush().then(function () { return { project: project, opened: false }; });
            }

            if (!hadSaved) {
                return list().then(function (items) {
                    if (!items.length) return null;
                    return openObject(items[0].id).then(function (p) { ready = true; return { project: p, opened: true }; });
                });
            }

            return null;
        }).then(function (done) {
            if (done) return done;

            return create(project).then(function (meta) {
                current = meta;
                latest = project;
                try { localStorage.setItem(currentKey(), meta.id); } catch (e) { /* запасной указатель не обязателен */ }
                ready = true;
                emit();
                return { project: project, opened: false };
            });
        });
    }

    /* Для проверок: другое имя базы, чтобы не трогать рабочую. */
    function configure(name) { dbName = name; dbp = null; current = null; latest = null; ready = false; listeners = []; }

    function drop(name) {
        return new Promise(function (resolve) {
            var req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
        });
    }

    function closeDb() { return dbp ? dbp.then(function (db) { db.close(); dbp = null; }, function () { dbp = null; }) : Promise.resolve(); }

    return {
        boot: boot, touch: touch, flush: flushNow, info: info, onChange: onChange, isReady: function () { return ready; },
        create: create, list: list, revisions: revisions, openObject: openObject,
        saveRevision: saveRevision, restoreRevision: restoreRevision, revisionProject: revisionProject,
        deleteRevision: deleteRevision, deleteObject: deleteObject, rename: rename, duplicate: duplicate,
        exportArchive: exportArchive, importArchive: importArchive, isArchive: isArchive,
        markBase: function () { pendingBase = true; },
        labelOf: labelOf, printOf: printOf, configure: configure, drop: drop, close: closeDb
    };
})();
