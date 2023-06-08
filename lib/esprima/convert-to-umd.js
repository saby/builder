'use strict';

const convert = require('../es-converter');

module.exports = (ast, text, filePath) => {
   const r = convert(ast, text, 'umd', filePath);
   if (r.hasError) {
      return undefined;
   }

   return r.umd;
};

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
