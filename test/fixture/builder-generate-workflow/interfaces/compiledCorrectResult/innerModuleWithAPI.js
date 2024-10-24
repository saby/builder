(function() {
   function defaultDefine() {
define("ModuleWithAPI/_test/scope", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class User {
        constructor() { }
        get userId() {
            return 'foo2';
        }
    }
    exports.default = User;
});
   }
   function defineModuleWithContents(currentContents, isUMD) {
      var currentModuleContents = currentContents.modules[currentModuleName];
      if (currentModuleContents.features && currentModuleContents.features[currentInterface]) {
         currentProvider = currentModuleContents.features[currentInterface] + '/' + currentInterfaceParts.join('/');
         if (currentProvider === currentInterface) {
            if (isUMD) {
               return defaultDefine();
            } else {
               defaultDefine();
            }
         } else if (isUMD) {
            var _test = global.requirejs(currentProvider);
            module.exports = _test;
         } else {
            define(currentInterface, [currentProvider], function (_test) {
               return _test;
            });
         }
      } else {
         defaultDefine();
      }
   }

  function getRootContents() {
   try {
      contents = require('json!resources/contents');
   } catch(err) {
      try {
         contents = require('json!contents')
      } catch(error) {
         contents = '';
      }
   }
}
 
   var currentProvider;
   var currentInterface = "ModuleWithAPI/_test/scope";
   var currentInterfaceParts = currentInterface.split('/');
   var currentModuleName = currentInterfaceParts.shift();
   var global = (function () {
      return this || (1, eval)('this');
   }());

   if (global.contents) {
      defineModuleWithContents(global.contents, false);
   } else if (typeof window === 'undefined') {
      var currentContents = getRootContents() || global.requirejs('ModuleWithAPI/contents.json');
      defineModuleWithContents(currentContents, false);
   } else {
      require(['ModuleWithAPI/contents.json'], function(currentContents) {
         defineModuleWithContents(currentContents, false);
      });
   }
})();