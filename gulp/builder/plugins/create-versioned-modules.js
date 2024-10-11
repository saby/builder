/**
 * Плагин для создания versioned_modules.json (список проверсионированных файлах)
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   transliterate = require('../../../lib/transliterate');

const extensions = ['.css', '.html'];

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const prettyCacheModulePath = transliterate(moduleInfo.output);
   const prettyModulePath = transliterate(moduleInfo.path);
   const currentModuleName = moduleInfo.output.split('/').pop();

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         /**
          * для оставшихся модулей(минифицированные css, статические html) также
          * не забываем записать в кэш информацию
          */
         if (file.versioned && extensions.includes(file.pExtname)) {
            const prettyFilePath = transliterate(file.pHistory[file.pHistory.length - 1]);
            const isSourcePath = prettyFilePath.includes(prettyModulePath);
            let relativeOutputPath = path.relative(
               isSourcePath ? prettyModulePath : prettyCacheModulePath,
               prettyFilePath
            );
            relativeOutputPath = path.join(currentModuleName, relativeOutputPath);
            taskParameters.addVersionedModules(currentModuleName, [relativeOutputPath]);
         }

         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
         callback(null, file);
      }
   );
};
