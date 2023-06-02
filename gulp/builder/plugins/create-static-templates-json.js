/**
 * Плагин для создания static_templates.json (информация для корреткной отдачи статических html в сервисе представлений)
 * @author Kolbeshin F.A.
 */

'use strict';

const { toSafePosix, removeLeadingSlashes } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const prettyStaticTemplates = {};
            for (const url of Object.keys(moduleInfo.staticTemplates)) {
               const currentUrlList = helpers.descendingSort(moduleInfo.staticTemplates[url]);
               const prettyUrl = `/${removeLeadingSlashes(toSafePosix(url))}`;
               currentUrlList.forEach((currentUrl, index) => {
                  if (index === 0) {
                     prettyStaticTemplates[prettyUrl] = toSafePosix(currentUrlList[0]);
                  } else {
                     logger.warning({
                        message: `static templates meta: attempt to write another template ${currentUrl} into current url: ${prettyUrl}`,
                        moduleInfo
                     });
                  }
               });
            }

            // Всегда сохраняем файл, чтобы не было ошибки при удалении последней статической html страницы в модуле.
            const file = new PosixVinyl({
               pPath: 'static_templates.json',
               contents: Buffer.from(JSON.stringify(helpers.sortObject(prettyStaticTemplates), null, 2)),
               moduleInfo
            });
            this.push(file);
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
