define('InterfaceModule1/library', [
    'require',
    'exports'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['InterfaceModule1/_private/module1'] = true;
        var InterfaceModule1__private_module1 = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            var Module1 = function () {
                function Module1(variable) {
                    this.variables = variable;
                }
                return Module1;
            }();
            exports.default = Module1;
            ;
        }(require, exports);
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
        var module1_1 = InterfaceModule1__private_module1;
        exports['InterfaceModule1/_private/module2'] = true;
        var InterfaceModule1__private_module2 = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            var Module1 = function () {
                function Module1(variable) {
                    this.variables = variable;
                }
                return Module1;
            }();
            exports.default = Module1;
            ;
        }(require, exports);
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
        var module2_1 = InterfaceModule1__private_module2;
    exports.test = exports.Module2 = exports.Module1 = void 0;
    Object.defineProperty(exports, 'Module1', {
        enumerable: true,
        get: function () {
            return module1_1.default;
        }
    });
    Object.defineProperty(exports, 'Module2', {
        enumerable: true,
        get: function () {
            return module2_1.default;
        }
    });
    function test() {
        return 'test';
    }
    exports.test = test;
    
    return exports;
});