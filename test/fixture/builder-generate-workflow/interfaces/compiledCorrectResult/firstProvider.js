define("Module1/scope", ["require", "exports", "ModuleWithAPI/scope"], function (require, exports, scope_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.firstUser = void 0;
    class FirstUser extends scope_1.default {
    }
    return {
        foo: 'foo1'
    };
    exports.firstUser = new FirstUser();
});
