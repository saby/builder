/**
 * Плагин для фильтрации не изменённых файлов, чтобы не перезаписывать и не напрягать диск.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger(),
   through = require('through2');

/**
 * Объявление плагина
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      try {
         const shouldThrowAway = (
            (file.hasOwnProperty('cached') && file.cached) ||
            file.cachedJsFile
         );

         if (!shouldThrowAway) {
            if (file.pushToServer) {
               const outputFilePath = path.join(
                  path.basename(moduleInfo.output),
                  file.pRelative
               );
               taskParameters.addChangedFile(outputFilePath);
            }
            callback(null, file);
            return;
         }
      } catch (error) {
         logger.error({ error });
      }

      callback();
   });
};
