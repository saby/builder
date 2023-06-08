'use strict';

const
   transliterate = require('../lib/transliterate'),
   modulePathToRequire = require('../lib/modulepath-to-require');
const { generateWithStaticDependencies } = require('../lib/esprima/convert-to-umd');

/**
 * Компилирует Json в AMD/UMD формат
 * @param {string} relativePath относительный путь файла. Начинается с имени модуля
 * @param {string} text содержимое json-файла
 * @param {boolean} generateUMD генерировать модуль для umd загрузчика
 * @returns {string}
 */
function compileJsonToJs(relativePath, text, generateUMD) {
   const moduleName = modulePathToRequire.getPrettyPath(transliterate(relativePath));
   const jsonData = JSON.stringify(JSON.parse(text));
   const factoryFunctionDecl = `function(){return ${jsonData};}`;

   if (generateUMD) {
      return generateWithStaticDependencies({
         factoryFunctionCall: `define('${moduleName}', [], factory)`,
         factoryFunctionDecl
      });
   }

   return `define('${moduleName}',[],${factoryFunctionDecl});`;
}

module.exports = compileJsonToJs;
