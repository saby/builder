define("Module1/scope", ["require", "exports", "tslib", "ModuleWithAPI/scope"], function (require, exports, tslib_1, scope_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.firstUser = void 0;
    var FirstUser = /** @class */ (function (_super) {
        tslib_1.__extends(FirstUser, _super);
        function FirstUser() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return FirstUser;
    }(scope_1.default));
    return {
        foo: 'foo1'
    };
    exports.firstUser = new FirstUser();
});
