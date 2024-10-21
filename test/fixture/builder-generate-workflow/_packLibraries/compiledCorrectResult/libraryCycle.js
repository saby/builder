/* eslint-disable */
/**
 * Корректный скомпиленный вариант библиотеки, зависимости
 * которой вызывают цикличность с самой библиотекой. При
 * прогоне тестов данному файлу должны соответствовать как
 * скомпиленный модуль, так и его запакованный результат.
 */

define("Modul/libraryCycle", ["require", "exports", "Modul/_es6/test-cycle-library"], function (require, exports, test_cycle_library_1) {
    'use strict';
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = test_cycle_library_1.default;
});
