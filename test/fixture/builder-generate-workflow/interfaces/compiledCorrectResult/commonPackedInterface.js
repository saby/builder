define("ModuleWithAPI/scope",["Module2/scope"],function(scope) {return scope; });
define('Module2/scope', [
    'require',
    'exports'
], function (require, exports) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.secondUser = void 0;
    var SecondUser = function () {
        function SecondUser() {
        }
        return SecondUser;
    }();
    return { foo: 'foo2' };
    exports.secondUser = new SecondUser();
});