/**
 * Плагин для компиляции ECMAScript 6+ и TypeScript в JavaScript (ES5).
 * Без учёта инкрементальной сборки. Нужно для подготовки WS для исполнения в билдере.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   { compileEsAndTs } = require('../../../lib/compile-es-and-ts'),
   { TS_EXT } = require('../../../lib/builder-constants');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         try {
            if (!file.contents) {
               callback();
               taskParameters.metrics.storePluginTime('typescript', startTime);
               return;
            }

            if (!['.ts', '.tsx'].includes(file.pExtname)) {
               callback(null, file);
               taskParameters.metrics.storePluginTime('typescript', startTime);
               return;
            }
            if (file.pPath.endsWith('.d.ts')) {
               callback(null, file);
               taskParameters.metrics.storePluginTime('typescript', startTime);
               return;
            }

            if (file.cached) {
               callback(null, file);
               taskParameters.metrics.storePluginTime('typescript', startTime);
               return;
            }
            let relativeFilePath = path.relative(moduleInfo.path, file.pHistory[0]);
            relativeFilePath = path.join(moduleInfo.name, relativeFilePath);

            const jsInSources = file.pHistory[0].replace(TS_EXT, '.js');
            if (await fs.pathExists(jsInSources)) {
               const message =
                  `Существующий JS-файл мешает записи результата компиляции '${file.pPath}'.`;

               // выводим в режиме debug, т.к. это подготовительный этап сборки и никому не интересно особо
               logger.debug({
                  message,
                  filePath: jsInSources,
                  moduleInfo
               });
               callback(null, file);
               taskParameters.metrics.storePluginTime('typescript', startTime);
               return;
            }

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace(TS_EXT, '.js'));
               const compiledSourceHash = taskParameters.cache.getCompiledHash(moduleInfo, relativeFilePath);
               const currentHash = taskParameters.cache.getHash(moduleInfo, relativeFilePath);

               if (compiledSourceHash === currentHash) {
                  file.useSymlink = true;
                  const newFile = file.clone();
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  newFile.pPath = file.pPath.replace(TS_EXT, '.js');
                  this.push(newFile);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            const sourceRoot = path.dirname(await fs.promises.realpath(file.pHistory[0]));

            const result = await compileEsAndTs(
               relativeFilePath,
               file.contents.toString(),
               moduleInfo.name,
               { development: { ...taskParameters.config.tsCompilerOptions } },
               taskParameters.config.sourceMaps,
               taskParameters.config.inlineSourceMaps,
               sourceRoot
            );
            const newFile = file.clone();
            newFile.contents = Buffer.from(result.development.text);
            newFile.pPath = file.pPath.replace(TS_EXT, '.js');
            this.push(newFile);
         } catch (error) {
            logger.error({
               message: 'Builder error for prepareWS typescript compilation',
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }
         callback(null, file);
         taskParameters.metrics.storePluginTime('typescript', startTime);
      }
   );
};
