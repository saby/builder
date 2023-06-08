/**
 * Плагин для создания cdn_modules.json (список файлов, в которых прописаны ссылки на cdn)
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   transliterate = require('../../../lib/transliterate');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const prettyCacheModulePath = transliterate(moduleInfo.output);
   const prettyModulePath = transliterate(moduleInfo.path);
   const currentModuleName = moduleInfo.output.split('/').pop();

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         /**
          * для оставшихся модулей(минифицированные css, статические html) также
          * не забываем записать в кэш информацию. В случае сборки в десктопе в
          * cdn_modules.json нельзя записывать дебажные шаблоны и css, поскольку они
          * удаляются в конце работы билдера. В случае сборки онлайн-проекта можно
          * записывать все файлы.
          */
         let cdnCondition;
         if (taskParameters.config.sources) {
            cdnCondition = file.cdnLinked;
         } else {
            cdnCondition = file.cdnLinked && (
               file.pBasename.endsWith('.html') || file.pBasename.endsWith(`.min${file.pExtname}`)
            );
         }
         if (cdnCondition) {
            const prettyFilePath = transliterate(file.pHistory[file.pHistory.length - 1]);
            const isSourcePath = prettyFilePath.includes(prettyModulePath);
            let relativeOutputPath = path.relative(
               isSourcePath ? prettyModulePath : prettyCacheModulePath,
               prettyFilePath
            );
            relativeOutputPath = path.join(currentModuleName, relativeOutputPath);
            taskParameters.addCdnModule(currentModuleName, relativeOutputPath);
         }

         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
         callback(null, file);
      }
   );
};
