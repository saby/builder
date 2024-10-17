define('TestModule/test', [
   'require',
   'exports'
], function (require, exports) {
   'use strict';
   (new Promise(function (resolve_1, reject_1) {
      require(['someModuleName'], resolve_1, reject_1);
   }).then(function (component) {
      (new Promise(function (resolve_2, reject_2) {
         require(['Core/IoC'], resolve_2, reject_2);
      }).then(function (IoC) {
         (new Promise(function (resolve_3, reject_3) {
            require(['someAnotherNestedModuleName'], resolve_3, reject_3);
         }).then(function (someAnotherNestedModuleName) {
            console.log('someAnotherNestedModuleName: ' + someAnotherNestedModuleName);
         }));
         IoC.resolve('ILogger').error('EngineUser/Panel', 'someError');
      }))
   }));
});