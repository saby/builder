define('Modul2/Module2', [
    'require',
    'exports',
    'Modul2/_private/notAmd'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul2/_private/Module1'] = true;
        var Modul2__private_Module1 = function (require, exports) {
        'use strict';
        Object.defineProperty(exports, '__esModule', { value: true });
        class MyClass {
            constructor(test1, test2) {
                this.test1 = test1;
                this.test2 = test2;
            }
            get classArray() {
                return this.test2;
            }
            set classArray(value) {
                this.test2 = value;
            }
        }
        exports.default = MyClass;
        return exports;
    }(require, {});
        exports['Modul2/_private/withNotAmdImport'] = true;
        var Modul2__private_withNotAmdImport = function (require, exports, Module1_1) {
        'use strict';
        Object.defineProperty(exports, '__esModule', { value: true });
        exports.default = Module1_1.default;
        return exports;
    }(require, {}, Modul2__private_Module1, typeof Modul2__private_notAmd === 'undefined' ? null : Modul2__private_notAmd);
        var Module_es6 = Modul2__private_withNotAmdImport;
    exports.default = Module_es6;
    
    return exports;
});