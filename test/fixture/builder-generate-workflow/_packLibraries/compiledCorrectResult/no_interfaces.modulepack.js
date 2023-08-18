define('TestModule/Library', [
    'require',
    'exports',
    'TestModule/Module'
], function (require, exports, Module_1) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['TestModule/_private/Interface'] = true;
        var TestModule__private_Interface = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            exports.TestOptions = void 0;
            exports.TestOptions = {
                option1: 'test123',
                option2: 123
            };
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
        exports['TestModule/_private/Module1'] = true;
        var TestModule__private_Module1 = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports, Interface_1) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            exports.TestOptions = void 0;
            Object.defineProperty(exports, 'TestOptions', {
                enumerable: true,
                get: function () {
                    return Interface_1.TestOptions;
                }
            });
        }(require, exports, TestModule__private_Interface);
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
        var Module1_1 = TestModule__private_Module1;
    exports.foo = exports.TestOptions = void 0;
    Object.defineProperty(exports, 'TestOptions', {
        enumerable: true,
        get: function () {
            return Module1_1.TestOptions;
        }
    });
    Object.defineProperty(exports, 'foo', {
        enumerable: true,
        get: function () {
            return Module_1.foo;
        }
    });
    
    return exports;
});