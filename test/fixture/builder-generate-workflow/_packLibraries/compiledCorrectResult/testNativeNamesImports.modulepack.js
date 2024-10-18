define('Modul/testNativeNamesImports', [
    'require',
    'exports'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul/_es6/fetch'] = true;
        var Modul__es6_fetch = function (require, exports) {
        'use strict';
        Object.defineProperty(exports, '__esModule', { value: true });
        exports.someTest = void 0;
        function someTest() {
            var test1 = 'Тестовое сообщение';
            return test1;
        }
        exports.someTest = someTest;
        return exports;
    }(require, {});
    exports.fetch = void 0;
    exports.fetch = Modul__es6_fetch;
    
    return exports;
});