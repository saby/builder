/**
 * Плагин предназначен для загрузки ресурсов страниц, определенных в *.pagex файлах.
 *
 * @author Krylov M.A.
 */
'use strict';

const through = require('through2');

const logger = require('../../../lib/logger').logger();
const execInPool = require('../../common/exec-in-pool');

const { path } = require('../../../lib/platform/path');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

module.exports = function declarePlugin(taskParameters, workspace, moduleInfo) {
   return through.obj(
      async function onTransform(file, encoding, callback) {
         if (!file.pPath.endsWith('.pagex')) {
            callback(null, file);

            return;
         }

         const [error, result] = await execInPool(
            taskParameters.pool,
            'getSabyPageContents',
            [
               path.relative(moduleInfo.appRoot, file.pHistory[0]),
               file.contents.toString()
            ],
            file.pHistory[0],
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            getMetricsReporter().markFailedModule(moduleInfo);

            logger.error({
               message: 'Ошибка при обработке pagex файла',
               error,
               moduleInfo,
               filePath: file.pRelativeSource(moduleInfo.path)
            });

            callback(null, file);

            return;
         }

         try {
            workspace.registry.add(
               file.pRelative,
               result.pages
            );
         } catch (e) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            getMetricsReporter().markFailedModule(moduleInfo);

            logger.error({
               message: 'Ошибка при обработке pagex файла',
               error: e,
               moduleInfo,
               filePath: file.pRelativeSource(moduleInfo.path)
            });
         }

         callback(null, file);
      }
   );
};
