/**
 * Плагин для генераци source-map для JS файлов.
 * Сервис визуального анализа карт: https://sokra.github.io/source-map-visualization/
 * @author Krylov M.A.
 */

'use strict';

const through = require('through2');

const { path } = require('../../../lib/platform/path');
const { componentCantBeParsed } = require('../../../lib/helpers');
const transliterate = require('../../../lib/transliterate');
const sourceMap = require('../../../lib/source-map');
const logger = require('../../../lib/logger').logger();

function shouldProcess(file) {
   if (!file.contents || file.cached || file.compiled || file.tscEmit || file.pExtname !== '.js') {
      return false;
   }

   if (file.pPath.endsWith('.test.js')) {
      return true;
   }

   return !componentCantBeParsed(file);
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters Параметры сборки.
 * @param {ModuleInfo} moduleInfo Информация о собираемом модуле.
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         if (!shouldProcess(file)) {
            callback(null, file);
            return;
         }

         try {
            const sourceRoot = await sourceMap.getSourceRoot(file.pHistory[0]);
            const sourceContent = file.contents.toString();
            const jsonSourceMap = sourceMap.generateSourceMap(
               sourceContent,
               file.pBasename,
               sourceRoot,
               taskParameters.config.inlineSourceMaps
            );

            if (taskParameters.config.inlineSourceMaps) {
               file.contents = Buffer.from(`${sourceContent}\n${sourceMap.toComment(jsonSourceMap)}`);

               callback(null, file);
               return;
            }

            const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0])
               .replace(/\.js$/, '');
            const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
            const outputMapPath = `${outputFileWoExt}.js.map`;

            file.sourceMapText = JSON.stringify(jsonSourceMap);
            file.sourceMapOutput = outputMapPath;
            file.sourceRoot = sourceRoot;
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при создании SourceMap файлов",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         callback(null, file);
      }
   );
};