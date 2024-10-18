'use strict';

module.exports.generateWithStaticDependencies = meta => (`(function(factory) {
   if (typeof define === 'function' && define.amd) {
      ${meta.factoryFunctionCall};
   } else if (typeof module === 'object' && typeof module.exports === 'object') {
      var v = factory();
      if (v !== undefined) {
         module.exports = v;
      }
   }
})(${meta.factoryFunctionDecl});`);
