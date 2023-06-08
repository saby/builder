define("Module2/scope", ["require", "exports", "tslib", "ModuleWithAPI/scope"], function (require, exports, tslib_1, scope_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.secondUser = void 0;
    var SecondUser = /** @class */ (function (_super) {
        tslib_1.__extends(SecondUser, _super);
        function SecondUser() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return SecondUser;
    }(scope_1.default));
    return {
        foo: 'foo2'
    };
    exports.secondUser = new SecondUser();
});
