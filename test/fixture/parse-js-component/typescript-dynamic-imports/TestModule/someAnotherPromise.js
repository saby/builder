define("TestModule/someAnotherPromise", ["require", "exports"], function (require, exports) {
   "use strict";
   new Promise(function (resolve_1, reject_1) {
      console.log('something is going on here');
      resolve_1('');
   }).then(function () {
      return 'first one';
   }).then(function () {
      return 'another one';
   });
});
