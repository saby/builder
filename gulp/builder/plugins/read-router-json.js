/**
 * @author Krylov M.A.
 */
'use strict';

const through = require('through2');

const logger = require('../../../lib/logger').logger();
const { path } = require('../../../lib/platform/path');

const getMetricsReporter = require('../../common/classes/metrics-reporter');

module.exports = function declarePlugin(taskParameters, workspace, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         if (file.pBasename !== 'router.json') {
            callback(null, file);

            return;
         }

         try {
            workspace.routes.addRoutesFile(
               path.relative(path.dirname(moduleInfo.path), file.pPath),
               JSON.parse(file.contents.toString())
            );
         } catch (e) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            getMetricsReporter().markFailedModule(moduleInfo);

            logger.error({
               message: 'Ошибка при обработке router.json файла',
               error: e,
               moduleInfo,
               filePath: file.pRelativeSource(moduleInfo.path)
            });
         }

         callback(null, file);
      }
   );
};
