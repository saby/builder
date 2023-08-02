/**
 * Плагин для минификации простейших случаев: *.json, *.jstpl
 * Заводить для каждого из них отдельный плагин - лишняя работа.
 * Включать в minify-js - значит усложнить и без того сложный плагин.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate');

const includeExts = ['.jstpl', '.json'];
const excludeRegexes = [/.*\.package\.json$/, /.*\.min\.json$/];

function shouldIgnore(file) {
   const isJsonJs = file.pBasename.endsWith('.json.js');

   if (file.pBasename.includes('routes-info.json')) {
      return true;
   }

   if (!isJsonJs && !includeExts.includes(file.pExtname)) {
      return true;
   }

   for (const regex of excludeRegexes) {
      if (regex.test(file.pPath)) {
         return true;
      }
   }

   return false;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         const isJsonJs = file.pBasename.endsWith('.json.js');

         try {
            if (shouldIgnore(file)) {
               callback(null, file);
               taskParameters.metrics.storePluginTime('minify other', startTime);
               return;
            }

            const
               currentFilePath = isJsonJs ? file.pHistory[0].replace('.json', '.json.js') : file.pHistory[0],
               currentExt = isJsonJs ? '.json.js' : file.pExtname,
               minFileExt = isJsonJs ? '.json.min.js' : `.min${file.pExtname}`;

            const relativePath = path
               .relative(moduleInfo.path, currentFilePath)
               .replace(currentExt, minFileExt);
            const outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
               callback(null, file);
               taskParameters.metrics.storePluginTime('minify other', startTime);
               return;
            }

            /**
             * если json файл не возможно минифицировать, то запишем оригинал.
             * jstpl копируем напрямую, их минифицировать никак нельзя,
             * но .min файл присутствовать должен во избежание ошибки 404
             */
            let newText = file.contents.toString();

            if (file.pExtname === '.json') {
               try {
                  newText = JSON.stringify(JSON.parse(newText));
               } catch (error) {
                  taskParameters.cache.markFileAsFailed(file.pHistory[0]);
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error,
                     moduleInfo,
                     filePath: file.pPath
                  });
               }
            }

            this.push(
               new PosixVinyl({
                  pBase: moduleInfo.output,
                  pPath: outputMinFile,
                  contents: Buffer.from(newText),
                  pushToServer: taskParameters.config.staticServer
               })
            );
            taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при минификации",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         taskParameters.metrics.storePluginTime('minify other', startTime);
         callback(null, file);
      }
   );
};
