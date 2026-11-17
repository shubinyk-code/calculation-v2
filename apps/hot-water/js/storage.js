'use strict';

/*
    Сохранение проекта.

    В файл кладётся только то, что задал человек: геометрия, диаметры, материалы,
    изоляция, ИТП, поставленные клапаны и исходные данные. Результаты расчёта
    намеренно не хранятся — сеть пересчитывается при каждом открытии. Это доли
    секунды, зато отчёт не может разойтись с трубами, которые успели поправить.

    Тот же принцип, что в плагине: там результаты тоже не пишутся в проект.
*/

var Storage = (function () {

    var AUTOSAVE_KEY = 'hw-circulation-project';

    function packNode(node) {
        return {
            x: round(node.point3d.x), y: round(node.point3d.y), z: round(node.point3d.z),
            fx: round(node.pointFlat.x), fy: round(node.pointFlat.y),
            размещён: node.flatPlaced ? 1 : 0,
            элемент: node.hubElementId || 0
        };
    }

    function packSegment(segment) {
        var packed = {
            а: segment.nodeA,
            б: segment.nodeB,
            роль: segment.role,
            зона: segment.zoneKey,
            система: segment.systemName,
            длина: round(segment.length),
            ду: segment.nominalDiameterMm,
            dн: round(segment.outerDiameter),
            dвн: round(segment.innerDiameter),
            материал: segment.material,
            изоляция: segment.insulationName,
            толщина: round(segment.insulationThickness),
            лямбда: segment.insulationLambda,
            полотенцесушители: segment.towelRailCount,
            виртуальный: segment.isVirtualLink ? 1 : 0,
            замыкание: segment.isRingClosure ? 1 : 0
        };

        // Автоматически подставленный клапан не сохраняется: его никто не ставил,
        // и на следующем расчёте он появится сам, если понадобится.
        if (segment.valve && !segment.valve.automatic) {
            packed.клапан = 1;

            // Заданный типоразмер — решение человека, его сохраняем.
            // Подобранная настройка не сохраняется: она пересчитывается.
            if (segment.valve.chosenArticle)
                packed.артикул = segment.valve.chosenArticle;
        }

        if (segment.elementIds && segment.elementIds.length > 0)
            packed.элементы = segment.elementIds;

        return packed;
    }

    function packZone(zone) {
        return {
            ключ: zone.key,
            подпись: zone.caption,
            считать: zone.isEnabled ? 1 : 0,
            подающие: zone.supplyNames,
            обратные: zone.returnNames
        };
    }

    function round(value) {
        return Math.round(value * 1e6) / 1e6;
    }

    return {
        AutosaveKey: AUTOSAVE_KEY,

        pack: function (app) {
            var network = app.network;
            var i;

            var nodes = [];
            for (i = 0; i < network.nodes.length; i++) nodes.push(packNode(network.nodes[i]));

            var segments = [];
            for (i = 0; i < network.segments.length; i++) {
                // Замыкание внутри ИТП не сохраняется: оно достраивается расчётом
                // по помеченным узлам и в файле было бы лишней сущностью.
                if (network.segments[i].isSourceLink) continue;
                segments.push(packSegment(network.segments[i]));
            }

            var zones = [];
            for (i = 0; i < network.zones.length; i++) zones.push(packZone(network.zones[i]));

            return {
                формат: 'ГВС-Циркуляция',
                версия: 1,
                название: app.projectName,
                настройки: app.settings.toJSON(),
                заготовка: app.template,
                подписи: labelState(),
                узлы: nodes,
                участки: segments,
                зоны: zones,
                источники: network.sourceNodes.slice(0)
            };
        },

        unpack: function (plain, app) {
            if (!plain || plain.формат !== 'ГВС-Циркуляция')
                throw new Error('Это не файл проекта расчёта циркуляции.');

            var network = new HwNetwork();
            var i;

            for (i = 0; i < plain.узлы.length; i++) {
                var raw = plain.узлы[i];
                var node = network.addNode(new Pt3(raw.x, raw.y, raw.z));
                node.pointFlat = { x: raw.fx || 0, y: raw.fy || 0 };
                node.flatPlaced = !!raw.размещён;
                node.hubElementId = raw.элемент || 0;
            }

            for (i = 0; i < plain.участки.length; i++) {
                var item = plain.участки[i];
                var segment = network.addSegment(item.а, item.б);

                segment.role = item.роль;
                segment.zoneKey = item.зона;
                segment.systemName = item.система;
                segment.length = item.длина;
                segment.nominalDiameterMm = item.ду;
                segment.outerDiameter = item.dн;
                segment.innerDiameter = item.dвн;
                segment.material = item.материал;
                segment.insulationName = item.изоляция;
                segment.insulationThickness = item.толщина || 0;
                segment.insulationLambda = item.лямбда || 0;
                segment.towelRailCount = item.полотенцесушители || 0;
                segment.isVirtualLink = !!item.виртуальный;
                segment.isRingClosure = !!item.замыкание;
                segment.elementIds = item.элементы || [];

                if (item.клапан) {
                    segment.valve = newValveState(false);
                    segment.valve.chosenArticle = item.артикул || null;
                }
            }

            if (plain.зоны) {
                for (i = 0; i < plain.зоны.length; i++) {
                    var z = plain.зоны[i];
                    var zone = network.zoneEnsure(z.ключ, z.подпись);
                    zone.isEnabled = z.считать !== 0;
                    zone.supplyNames = z.подающие || [];
                    zone.returnNames = z.обратные || [];
                }
            }

            network.sourceNodes = (plain.источники || []).slice(0);

            app.network = network;
            app.projectName = plain.название || 'Без названия';
            app.settings = CalcSettings.fromJSON(plain.настройки);

            if (plain.заготовка) {
                for (var key in plain.заготовка) {
                    if (plain.заготовка.hasOwnProperty(key) && app.template.hasOwnProperty(key))
                        app.template[key] = plain.заготовка[key];
                }
            }

            if (plain.подписи) {
                for (i = 0; i < LabelOptions.keys.length; i++) {
                    var name = LabelOptions.keys[i];
                    if (plain.подписи.hasOwnProperty(name))
                        LabelOptions[name] = !!plain.подписи[name];
                }
            }

            return network;
        },

        /** Скачивание файла. На file:// работает так же, как по сети. */
        download: function (name, text, mime) {
            Storage.save(name, new Blob([text],
                { type: (mime || 'application/json') + ';charset=utf-8' }));
        },

        /**
         * Скачивание готовых байтов — когда кодировка не UTF-8.
         *
         * Нужно для DXF: он собирается в CP1251, потому что R12 про Юникод
         * не знает, и приписать такому файлу charset=utf-8 значило бы соврать
         * о его содержимом.
         */
        downloadBytes: function (name, bytes, mime) {
            Storage.save(name, new Blob([bytes],
                { type: mime || 'application/octet-stream' }));
        },

        save: function (name, blob) {
            var url = URL.createObjectURL(blob);

            var link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        },

        /**
         * Черновик в браузере. Не замена файлу: чистка данных сайта его сотрёт,
         * и полагаться на него нельзя. Нужен, чтобы случайно закрытая вкладка
         * не стоила часа работы.
         */
        autosave: function (app) {
            try {
                localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(Storage.pack(app)));
            } catch (e) {
                // Приватное окно или запрет на хранение — молча обходимся без черновика.
            }
        },

        restore: function (app) {
            try {
                var text = localStorage.getItem(AUTOSAVE_KEY);
                if (!text) return false;

                Storage.unpack(JSON.parse(text), app);
                return true;
            } catch (e) {
                return false;
            }
        },

        forget: function () {
            try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { }
        }
    };

    function labelState() {
        var state = {};
        for (var i = 0; i < LabelOptions.keys.length; i++)
            state[LabelOptions.keys[i]] = LabelOptions[LabelOptions.keys[i]];
        return state;
    }
})();
