'use strict';

/*
    Разбор имён систем вида Т3, Т3.1, Т3.2, 1Т3 и парных к ним Т4, Т4.1, Т4.2, 1Т4.
    Порт HotWaterCirculation/src/SystemNaming.cs.

    Зона — это всё имя целиком, кроме самой метки Т3/Т4: у Т3.1 и Т4.1 остаток
    одинаков, значит это одна зона, подающая и циркуляционная её части.
*/

var SystemNaming = (function () {

    /** Символ, которым в ключе зоны замещается разобранная метка Т3/Т4. */
    var ZONE_MARKER = 'Т#';

    /** Канонический вид буквы «Т»: в моделях она встречается и кириллицей, и латиницей. */
    var CANONICAL_T = 'Т';

    /*
        Латинская буква → кириллический двойник. В именах систем латиница
        попадается внутри русских слов постоянно: «Tрубопровoд» с латинскими
        T и o выглядит как обычное слово, но ни одному сравнению строк не равно.
    */
    var TWINS = {
        'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'K': 'К',
        'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'Y': 'У'
    };

    /*
        Начала слов, которыми в имени системы обозначают роль трубопровода.
        В ключ зоны они не идут: зона — это «где», а не «туда или обратно».
        Иначе «…подающий Т3» и «…обратный Т4» дадут разные ключи, подача и обратка
        разойдутся по разным зонам, и замыкания колец не найдутся вовсе.
    */
    var ROLE_PREFIXES = [
        'ПОДАЮЩ', 'ПОДАЧ', 'ПОДАВ',
        'ОБРАТН', 'ОБРАТК',
        'ЦИРКУЛ', 'ЦИРК',
        'ВОЗВРАТ', 'РЕЦИРК'
    ];

    /**
     * Приведение имени к виду, в котором его можно сравнивать: верхний регистр,
     * латинские двойники заменены на кириллицу, пробелы схлопнуты.
     */
    function normalize(name) {
        var upper = name.toUpperCase();
        var out = '';
        var previousWasSpace = false;

        for (var i = 0; i < upper.length; i++) {
            var c = upper.charAt(i);
            if (TWINS.hasOwnProperty(c)) c = TWINS[c];

            if (c === ' ' || c === '\t') {
                if (previousWasSpace) continue;
                previousWasSpace = true;
                out += ' ';
                continue;
            }

            previousWasSpace = false;
            out += c;
        }

        return out.replace(/^\s+|\s+$/g, '');
    }

    function isRoleWord(word) {
        for (var i = 0; i < ROLE_PREFIXES.length; i++) {
            if (word.indexOf(ROLE_PREFIXES[i]) === 0)
                return true;
        }
        return false;
    }

    /**
     * Выброс из ключа слов, обозначающих роль. Разделителями считаются пробел
     * и подчёркивание: точку трогать нельзя, ею отделяется номер зоны в «Т#.1».
     */
    function stripRoleWords(text) {
        if (!text) return { text: text, removed: 0 };

        var words = text.split(/[ _]+/);
        var kept = [];
        var removed = 0;

        for (var i = 0; i < words.length; i++) {
            if (words[i].length === 0) continue;
            if (isRoleWord(words[i])) { removed++; continue; }
            kept.push(words[i]);
        }

        // Если от имени ничего не осталось, ключ вырождается и все зоны сольются
        // в одну. Тогда лучше оставить имя как было.
        if (kept.length === 0)
            return { text: text, removed: removed };

        return { text: kept.join(' '), removed: removed };
    }

    /**
     * Из ключа выбрасывается всё, кроме букв, цифр и маркера зоны.
     * Иначе «(Т3.1) - 1 зона» и «(Т3.1)- 1 зона» дают разные ключи и расходятся
     * по разным зонам, хотя это одна и та же зона, просто набранная по-разному.
     */
    function squeeze(text) {
        if (!text) return text;

        var out = '';
        for (var i = 0; i < text.length; i++) {
            var c = text.charAt(i);
            if (c === '#' || /[0-9A-Za-zА-Яа-яЁё]/.test(c))
                out += c;
        }

        return out.length > 0 ? out : text;
    }

    return {
        ZoneMarker: ZONE_MARKER,

        parse: function (systemTypeName) {
            var info = {
                sourceName: systemTypeName,
                role: PipeRole.None,
                zoneKey: null,
                roleWordsStripped: 0,
                warning: null,
                isHotWater: false
            };

            if (!systemTypeName) return info;

            var normalized = normalize(systemTypeName);

            var supplyAt = normalized.indexOf(CANONICAL_T + '3');
            var returnAt = normalized.indexOf(CANONICAL_T + '4');

            if (supplyAt < 0 && returnAt < 0)
                return info;

            var labelAt;
            if (supplyAt >= 0 && (returnAt < 0 || supplyAt < returnAt)) {
                info.role = PipeRole.Supply;
                labelAt = supplyAt;
            } else {
                info.role = PipeRole.Return;
                labelAt = returnAt;
            }

            info.isHotWater = true;

            if (supplyAt >= 0 && returnAt >= 0)
                info.warning = 'в имени есть и Т3, и Т4 — взята первая метка';

            // Ключ зоны собирается из нормализованного имени, чтобы Т3.1 и T3.1
            // (кириллица и латиница) не разошлись по разным зонам.
            var rest = normalized.substring(0, labelAt)
                + ZONE_MARKER
                + normalized.substring(labelAt + 2);

            var stripped = stripRoleWords(rest);
            info.zoneKey = squeeze(stripped.text);
            info.roleWordsStripped = stripped.removed;

            // Метка вида «Т34» почти наверняка означает что-то своё, а не зону Т3.
            if (labelAt + 2 < normalized.length && /[0-9]/.test(normalized.charAt(labelAt + 2)))
                info.warning = 'после метки идёт ещё одна цифра — проверьте разбор';

            return info;
        },

        normalize: normalize,

        /**
         * Подпись зоны для таблиц: «Т3.1 / Т4.1». Собирается из настоящих имён
         * систем, а не из ключа зоны — ключ нормализован в верхний регистр
         * и в подписи выглядел бы криком.
         */
        makeCaption: function (supplyNames, returnNames) {
            var supply = joinDistinct(supplyNames);
            var circulation = joinDistinct(returnNames);

            if (supply.length === 0 && circulation.length === 0) return '—';
            if (supply.length === 0) return '— / ' + circulation;
            if (circulation.length === 0) return supply + ' / —';

            return supply + ' / ' + circulation;
        }
    };

    function joinDistinct(names) {
        if (!names) return '';

        var unique = [];
        var seen = {};

        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (!name) continue;
            var key = name.toUpperCase();
            if (seen[key]) continue;
            seen[key] = true;
            unique.push(name);
        }

        unique.sort();
        return unique.join(', ');
    }
})();
