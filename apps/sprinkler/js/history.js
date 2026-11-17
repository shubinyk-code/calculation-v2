'use strict';

/*
    Отмена и возврат — снимками всей книги объекта: правка может задеть любую
    систему (переименование, добавление, расчёт ВПВ), а снимок не может
    разойтись с правкой.

    Картинки подложек в снимок не входят: они весят мегабайты, и восемьдесят
    их копий съели бы память браузера. Снимок хранит только номер картинки,
    а сами картинки лежат один раз в отдельном словаре.
*/

var History = (function () {

    var LIMIT = 80;
    var undoStack = [];
    var redoStack = [];
    var current = null;
    var images = {};

    function underlays(book) {
        var list = [];
        Storage.projectsOf(book).forEach(function (p) {
            if (p.underlay) list.push(p.underlay);
        });
        return list;
    }

    function snapshot(app) {
        var list = underlays(app.book);
        var saved = list.map(function (u) {
            if (u.src) images[u.id] = u.src;
            var src = u.src;
            u.src = '';
            return src;
        });

        var text = JSON.stringify(app.book);

        list.forEach(function (u, i) { u.src = saved[i]; });
        return text;
    }

    function restore(app, text) {
        var book = Storage.unpackBook(JSON.parse(text));
        underlays(book).forEach(function (u) {
            if (images[u.id]) u.src = images[u.id];
        });
        app.book = book;
    }

    return {
        reset: function (app) {
            undoStack = [];
            redoStack = [];
            current = snapshot(app);
        },

        record: function (app, label) {
            var now = snapshot(app);
            if (now === current) return false;

            undoStack.push({ state: current, label: label || 'правку' });
            if (undoStack.length > LIMIT) undoStack.shift();
            redoStack = [];
            current = now;
            return true;
        },

        undo: function (app) {
            if (!undoStack.length) return null;
            var step = undoStack.pop();
            redoStack.push({ state: current, label: step.label });
            current = step.state;
            restore(app, step.state);
            return step.label;
        },

        redo: function (app) {
            if (!redoStack.length) return null;
            var step = redoStack.pop();
            undoStack.push({ state: current, label: step.label });
            current = step.state;
            restore(app, step.state);
            return step.label;
        },

        canUndo: function () { return undoStack.length > 0; },
        canRedo: function () { return redoStack.length > 0; },
        undoLabel: function () { return undoStack.length ? undoStack[undoStack.length - 1].label : null; },
        redoLabel: function () { return redoStack.length ? redoStack[redoStack.length - 1].label : null; }
    };
})();
