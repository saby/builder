define("Modul/external_public_deps", ["require", "exports", "Modul/Modul", "Modul/publicFunction1", "Modul/_es6/testPublicModule"], function (require, exports, Module_1, testFunction_1, testFunction_2) {
    'use strict';
    return {
        default: Module_1,
        simpleArrayFunction: testFunction_1,
        removeArrayDuplicates: testFunction_2
    };
});
