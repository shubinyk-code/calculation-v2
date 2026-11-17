'use strict';

/*
    Отмена и возврат.

    Хранятся снимки состояния целиком, а не отдельные действия. Причина простая:
    правок в программе много и они разнородные — начертить трубу, перетащить узел,
    поменять Ду в таблице, замкнуть концы кнопкой, тронуть исходные данные. Писать
    для каждой свою обратную операцию значит завести три десятка мест, где отмена
    может разойтись с самой правкой, и разойдётся она молча.

    Снимок — это то же, что уходит в файл проекта: узлы, участки, ИТП, зоны
    и исходные данные. Результаты расчёта в него не входят: они пересчитываются
    из этого состояния за миллисекунды, и хранить их значило бы копить то,
    что и так восстанавливается.

    Снимок делается ПОСЛЕ правки, а в стопку кладётся предыдущий. Поэтому ни одно
    место, где сеть меняют, не обязано ничего знать про отмену: достаточно, чтобы
    оно, как и раньше, позвало afterEdit.
*/

var History = (function () {

    /** Сколько шагов помнить. */
    var LIMIT = 60;

    /*
        Предел памяти под всю стопку, байт. На импортированной сети снимок весит
        сотни килобайт, и шестьдесят шагов без ограничения съели бы десятки
        мегабайт. Лучше помнить меньше шагов, чем упереться в память браузера.
    */
    var BYTE_BUDGET = 48 * 1024 * 1024;

    var undoStack = [];
    var redoStack = [];
    var current = null;
    var bytes = 0;

    /**
     * Снимок состояния. Заготовка новой трубы и набор подписей из него убраны:
     * это настройки инструмента, а не проект, и отменять их вместе с трубой
     * человек не просил.
     */
    function snapshot(app) {
        var plain = Storage.pack(app);
        delete plain['заготовка'];
        delete plain['подписи'];
        return JSON.stringify(plain);
    }

    function restore(app, text) {
        Storage.unpack(JSON.parse(text), app);
    }

    function sizeOf(stack) {
        var total = 0;
        for (var i = 0; i < stack.length; i++)
            total += stack[i].state.length;
        return total;
    }

    function trim() {
        while (undoStack.length > LIMIT)
            undoStack.shift();

        bytes = sizeOf(undoStack) + sizeOf(redoStack);

        while (bytes > BYTE_BUDGET && undoStack.length > 1) {
            undoStack.shift();
            bytes = sizeOf(undoStack) + sizeOf(redoStack);
        }
    }

    return {
        /** Начать историю заново: новый проект, открытие файла, импорт. */
        reset: function (app) {
            undoStack = [];
            redoStack = [];
            bytes = 0;
            current = snapshot(app);
        },

        /**
         * Запомнить правку. Вызывается после того, как сеть уже изменена.
         * Возвращает false, если ничего не изменилось: пустых шагов в стопке
         * быть не должно — иначе «Отменить» нажимается впустую.
         */
        record: function (app, label) {
            if (current === null) {
                current = snapshot(app);
                return false;
            }

            var now = snapshot(app);
            if (now === current)
                return false;

            undoStack.push({ state: current, label: label || 'правку' });
            redoStack = [];
            current = now;
            trim();
            return true;
        },

        undo: function (app) {
            if (undoStack.length === 0) return null;

            var step = undoStack.pop();
            redoStack.push({ state: current, label: step.label });
            current = step.state;

            restore(app, step.state);
            trim();
            return step.label;
        },

        redo: function (app) {
            if (redoStack.length === 0) return null;

            var step = redoStack.pop();
            undoStack.push({ state: current, label: step.label });
            current = step.state;

            restore(app, step.state);
            trim();
            return step.label;
        },

        canUndo: function () { return undoStack.length > 0; },
        canRedo: function () { return redoStack.length > 0; },

        undoLabel: function () {
            return undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null;
        },

        redoLabel: function () {
            return redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null;
        },

        depth: function () { return undoStack.length; }
    };
})();
