/**
 * Плагин, который маркирует флагом cached все входящие файлы.
 * cached == true, если файл не менялся между запусками сборки.
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger(),
   through = require('through2');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo = {}) {
   return through.obj(async function onTransform(file, encoding, callback) {
      const startTime = Date.now();

      if (taskParameters.config.watcherRunning) {
         // Намеренно пропускаем обновление hash-сумм для пересобираемых файлов в watcher'е,
         // чтобы при следующей полной сборке файлы пересобрались должным образом.
         const shouldSkipUpdatingHash = (
            moduleInfo.depends.includes('Tailwind') &&
            ['.tmpl', '.wml', '.js', '.ts', '.tsx'].includes(file.pExtname)
         );

         if (shouldSkipUpdatingHash) {
            file.cached = false;

            callback(null, file);

            return;
         }
      }

      try {
         const isChanged = taskParameters.cache.isFileChanged(
            file.pPath,
            file.contents,
            taskParameters.config.hashByContent,
            file.stat.mtime.toString(),
            moduleInfo
         );
         if (isChanged instanceof Promise) {
            file.cached = !(await isChanged);
         } else {
            file.cached = !isChanged;
         }
      } catch (error) {
         logger.error({ error });
      }

      taskParameters.metrics.storePluginTime('changedInPlace', startTime);
      callback(null, file);
   });
};
