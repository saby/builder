define('Modul/Modul', [
    'tslib',
    'i18n!Modul/_es6/Modul',
    'require',
    'exports',
    'css!theme?Modul/_es6/test'
], function (tslib_1, rk, require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul/_es6/Modul2'] = true;
        var Modul__es6_Modul2 = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports, tslib_1) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            function prepareOptions(param1, param2) {
                return tslib_1.__awaiter(this, void 0, void 0, function () {
                    return tslib_1.__generator(this, function (_a) {
                        return [
                            2,
                            {
                                sum: param1 + param2,
                                tplFn: template
                            }
                        ];
                    });
                });
            }
            exports.default = prepareOptions;
        }(require, exports, tslib_1, typeof css_theme_Modul__es6_test === 'undefined' ? null : css_theme_Modul__es6_test);
        if (result instanceof Function) {
            return result;
        } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
            return result;
        } else {
            for (var property in result) {
                if (result.hasOwnProperty(property)) {
                    exports[property] = result[property];
                }
            }
        }
        return exports;
    }();
        exports['Modul/_es5/Module'] = true;
        var Modul__es5_Module = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports, tslib_1, Modul_2) {
            'use strict';
            return {
                Modul_1: Modul_2,
                default: Modul_2
            };
        }(require, exports, tslib_1, Modul__es6_Modul2);
        if (result instanceof Function) {
            return result;
        } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
            return result;
        } else {
            for (var property in result) {
                if (result.hasOwnProperty(property)) {
                    exports[property] = result[property];
                }
            }
        }
        return exports;
    }();
        exports['Modul/_es6/Modul'] = true;
        var Modul__es6_Modul = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports, rk, Module_js_1) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            exports.someTest = void 0;
            exports.default = Module_js_1.default;
            function someTest() {
                var test1 = rk('Тестовое сообщение');
                return test1;
            }
            exports.someTest = someTest;
        }(require, exports, rk, Modul__es5_Module);
        if (result instanceof Function) {
            return result;
        } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
            return result;
        } else {
            for (var property in result) {
                if (result.hasOwnProperty(property)) {
                    exports[property] = result[property];
                }
            }
        }
        return exports;
    }();
        var Modul_1 = Modul__es6_Modul;
    exports.default = Modul_1.default;
    
    return exports;
});