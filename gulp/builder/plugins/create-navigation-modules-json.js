/**
 * Плагин для создания navigation-modules.json (информация для работы аккордеона)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   { getFileHash } = require('../../../lib/helpers');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const fileName = 'navigation-modules.json';
            const sortedMeta = JSON.stringify(moduleInfo.navigationModules.sort(), null, 2);
            moduleInfo.addFileHash(fileName, getFileHash(sortedMeta, true));
            this.push(
               new PosixVinyl({
                  pPath: fileName,
                  contents: Buffer.from(sortedMeta),
                  moduleInfo
               })
            );
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
      }
   );
};
