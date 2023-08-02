/**
 * Плагин для локалицации xhtml.
 * В XML формате расставляются скобки {[]} - аналог rk - для локализцемых фраз (строки в разметке и переводимые опции).
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(async function onTransform(file, encoding, callback) {
      try {
         if (file.cached) {
            callback(null, file);
            return;
         }
         if (file.pExtname !== '.xhtml') {
            callback(null, file);
            return;
         }

         // minified versions of xhtml should be ignored, they will be compiled from sources further
         if (file.pBasename.endsWith('.min.xhtml')) {
            callback(null);
            return;
         }

         if (!taskParameters.config.templateBuilder) {
            logger.warning({
               message: '"View" or "UI" interface module doesn\'t exists in current project. "*.xhtml" templates will be ignored',
               moduleInfo,
               filePath: file.pPath
            });
            callback(null, file);
            return;
         }

         const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');
         const [error, result] = await execInPool(taskParameters.pool, 'prepareXHTML', [
            file.contents.toString(),
            componentsPropertiesFilePath
         ]);
         if (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: 'Ошибка при локализации XHTML',
               error,
               moduleInfo,
               filePath: file.pPath
            });
         } else {
            taskParameters.metrics.storeWorkerTime('localize xhtml', result.timestamp);
            file.contents = Buffer.from(result.newText);
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.pHistory[0]);
         logger.error({
            message: "Ошибка builder'а при локализации XHTML",
            error,
            moduleInfo,
            filePath: file.pPath
         });
      }
      callback(null, file);
   });
};
