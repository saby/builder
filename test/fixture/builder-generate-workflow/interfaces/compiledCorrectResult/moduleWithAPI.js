(function() {
   function defaultDefine() {
define("ModuleWithAPI/scope", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var User = /** @class */ (function () {
        function User() {
        }
        Object.defineProperty(User.prototype, "userId", {
            get: function () {
                return 'foo2';
            },
            enumerable: false,
            configurable: true
        });
        return User;
    }());
    exports.default = User;
});
   }
   function defineModuleWithContents(currentContents, isUMD) {
      var currentModuleContents = currentContents.modules[currentModuleName];
      if (currentModuleContents.features && currentModuleContents.features[currentInterface]) {
         currentProvider = currentModuleContents.features[currentInterface] + '/' + currentInterfaceParts.join('/');
         if (isUMD) {
            var scope = global.requirejs(currentProvider);
            module.exports = scope;
         } else {
            define(currentInterface, [currentProvider], function (scope) {
               return scope;
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
   var currentInterface = "ModuleWithAPI/scope";
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