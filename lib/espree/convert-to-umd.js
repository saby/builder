'use strict';

module.exports.generateWithStaticDependencies = meta => (`(function(factory) {
   if (typeof module === 'object' && typeof module.exports === 'object') {
      var v = factory();
      if (v !== undefined) {
         module.exports = v;
      }
   } else if (typeof define === 'function' && define.amd) {
      ${meta.factoryFunctionCall};
   }
})(${meta.factoryFunctionDecl});`);
