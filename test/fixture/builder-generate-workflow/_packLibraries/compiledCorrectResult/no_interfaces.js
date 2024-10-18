define("TestModule/Library", ["require", "exports", "TestModule/_private/Module1", "TestModule/Module"], function (require, exports, Module1_1, Module_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.foo = exports.TestOptions = void 0;
    Object.defineProperty(exports, "TestOptions", { enumerable: true, get: function () { return Module1_1.TestOptions; } });
    Object.defineProperty(exports, "foo", { enumerable: true, get: function () { return Module_1.foo; } });
});
