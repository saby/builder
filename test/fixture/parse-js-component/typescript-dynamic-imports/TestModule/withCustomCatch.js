define("TestModule/withCustomCatch", ["require", "exports"], function (require, exports) {
   "use strict";
   new Promise(function (resolve_1, reject_1) {
      require(['module'], resolve_1, reject_1);
   }).then(function () {
      return 'first one';
   }).then(function () {
      return 'another one';
   }).catch(function (err) {
      console.log('custom catch!!!');
   })
});
