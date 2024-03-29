/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

const supportExtensions = ['.js', '.ts', '.xhtml', '.tmpl', '.wml'];

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(async(file, encoding, callback) => {
      try {
         if (!supportExtensions.includes(file.pExtname)) {
            callback();
            return;
         }

         if (file.cached) {
            callback();
            return;
         }

         const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');

         const [error, collectWords] = await execInPool(
            taskParameters.pool,
            'collectWords',
            [moduleInfo.path, file.pPath, componentsPropertiesFilePath],
            file.pPath,
            moduleInfo
         );
         if (error) {
            logger.warning({
               message: 'Ошибка при обработке файла',
               filePath: file.pPath,
               error,
               moduleInfo
            });
         } else {
            taskParameters.cache.storeCollectWords(file.pHistory[0], collectWords);
         }
      } catch (error) {
         logger.warning({
            message: "Ошибка builder'а при обработке файла",
            filePath: file.pPath,
            error,
            moduleInfo
         });
      }
      callback();
   });
};
