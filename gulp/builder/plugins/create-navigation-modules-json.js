/**
 * Плагин для создания navigation-modules.json (информация для работы аккордеона)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const PosixVinyl = require('../../../lib/platform/vinyl');
const logger = require('../../../lib/logger').logger();
const getMetricsReporter = require('../../common/classes/metrics-reporter');
const { moduleHasNoChanges } = require('../../../lib/helpers');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         // старая навигация на текущий день присутствует исключительно в старом js-коде
         if (moduleHasNoChanges(moduleInfo, [moduleInfo.jsChanged])) {
            callback(null);
            return;
         }

         const startTime = Date.now();
         try {
            const fileName = 'navigation-modules.json';
            const sortedMeta = JSON.stringify(moduleInfo.navigationModules.sort(), null, 2);

            this.push(
               new PosixVinyl({
                  pPath: fileName,
                  contents: Buffer.from(sortedMeta),
                  moduleInfo
               })
            );
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
         callback();
      }
   );
};
