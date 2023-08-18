'use strict';

// Нестабильная ошибка случилась:
//  https://online.sbis.ru/opendoc.html?guid=cb2150c8-615c-4847-91a9-992dc8a7d022
//  Попытаемся поймать то, что приходит вместо ожидаемого модуля.
function checkFunction(mod) {
   if (mod && typeof mod.compileXhtml === 'function') {
      return;
   }

   let cache = [];
   const replacer = function(key, value) {
      if (value && typeof value === 'object') {
         // Duplicate reference found, discard key
         if (cache.indexOf(value) > -1) {
            return '[circular]';
         }

         // Store value in our collection
         cache.push(value);
      }
      if (value === undefined) {
         return 'undefined';
      }
      return value;
   };
   const modString = JSON.stringify(mod, replacer, ' ');
   cache = null;

   throw new Error(`Ожидалась функция compileXhtml из модуля View/Compiler, получено: ${modString}`);
}

let compilerLib;

function buildXhtml(text, relativeFilePath, compilerOptions) {
   if (!compilerLib) {
      compilerLib = global.requirejs('View/Compiler');
      checkFunction(compilerLib);
   }

   return compilerLib.compileXhtml(text, compilerOptions);
}

module.exports = {
   buildXhtml
};
