define("Module2/scope", ["require", "exports", "ModuleWithAPI/scope"], function (require, exports, scope_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.secondUser = void 0;
    class SecondUser extends scope_1.default {
    }
    return {
        foo: 'foo2'
    };
    exports.secondUser = new SecondUser();
});
