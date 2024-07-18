define('Modul/Modul', [
    'tslib',
    'i18n!Modul/_es6/Modul',
    'Modul/publicFunction1',
    'require',
    'exports',
    'css!theme?Modul/_es6/test'
], function (tslib_1, rk, simpleArraySort, require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul/_es6/Modul2'] = true;
        var Modul__es6_Modul2 = function (require, exports) {
        'use strict';
        Object.defineProperty(exports, '__esModule', { value: true });
        async function prepareOptions(param1, param2) {
            return {
                sum: param1 + param2,
                tplFn: template
            };
        }
        exports.default = prepareOptions;
        return exports;
    }(require, {}, typeof css_theme_Modul__es6_test === 'undefined' ? null : css_theme_Modul__es6_test);
        exports['Modul/_es5/Module'] = true;
        var Modul__es5_Module = function (require, exports, tslib_1, Modul_2) {
        'use strict';
        return {
            Modul_1: Modul_2,
            default: Modul_2
        };
    }(require, {}, tslib_1, Modul__es6_Modul2);
        exports['Modul/_es6/Modul'] = true;
        var Modul__es6_Modul = function (require, exports, rk, Module_js_1, simpleArraySort) {
        'use strict';
        Object.defineProperty(exports, '__esModule', { value: true });
        exports.someTest = void 0;
        exports.default = Module_js_1.default;
        function someTest() {
            var test1 = rk('Тестовое сообщение');
            var test2 = simpleArraySort([]);
            return {
                test1,
                test2
            };
        }
        exports.someTest = someTest;
        return exports;
    }(require, {}, rk, Modul__es5_Module, simpleArraySort);
        var Modul_1 = Modul__es6_Modul;
    exports.default = Modul_1.default;
    
    return exports;
});