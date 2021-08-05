define("ModuleWithAPI/scope_old", ["require", "exports", "ModuleWithAPI/scope.d"], function (require, exports, scope_d_1) {
    "use strict";
    return scope_d_1.scope;
});
define("ModuleWithAPI/scope",["Module1/scope"],function(scope) {return scope; });
define('Module1/scope', [
    'require',
    'exports',
    'ModuleWithAPI/scope_old'
], function (require, exports, scope_1) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.IUser = exports.firstUser = void 0;
    Object.defineProperty(exports, 'IUser', {
        enumerable: true,
        get: function () {
            return scope_1.User;
        }
    });
    var FirstUser = function () {
        function FirstUser() {
        }
        return FirstUser;
    }();
    return { foo: 'foo1' };
    exports.firstUser = new FirstUser();
});