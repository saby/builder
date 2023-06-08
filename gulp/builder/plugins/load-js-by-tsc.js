/**
 * Плагин для загрузки и редактирования Js-файлов, которые были скомпилированы в отдельной задачей с помощью tsc.
 * @author Krylov M.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   { shouldRemoveFromStream } = require('../../../lib/helpers'),
   execInPool = require('../../common/exec-in-pool'),
   { TS_EXT } = require('../../../lib/builder-constants');

async function shouldProcess(file, callback) {
   if (!file.contents) {
      callback();

      return false;
   }

   if (/\.routes\.(tsx?|js)$/.test(file.pBasename)) {
      callback(null, file);

      // Не трогать TS и скомпилированный файл от роутингов.
      // Эти файлы собираются в отдельном плагине в CJS формате,
      // а все остальные файлы -- в amd и umd.

      return false;
   }

   if (!['.ts', '.js', '.tsx'].includes(file.pExtname)) {
      callback(null, file);

      return false;
   }

   if (file.pExtname === '.js') {
      if (await shouldRemoveFromStream(file)) {
         callback(null);
      } else {
         callback(null, file);
      }

      return false;
   }

   if (file.pPath.endsWith('.d.ts')) {
      callback(null, file);

      return false;
   }

   return true;
}

function updateCache(outputFileWoExt, file, taskParameters, moduleInfo) {
   const outputPath = `${outputFileWoExt}.js`;
   const outputMinJsFile = `${outputFileWoExt}.min.js`;
   const outputOriginJsFile = `${outputFileWoExt}.origin.js`;
   const outputMinOriginJsFile = `${outputFileWoExt}.min.origin.js`;
   const outputMinOriginalJsFile = `${outputFileWoExt}.min.original.js`;

   taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
   taskParameters.cache.addOutputFile(file.pHistory[0], outputMinJsFile, moduleInfo);
   taskParameters.cache.addOutputFile(file.pHistory[0], outputOriginJsFile, moduleInfo);
   taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginJsFile, moduleInfo);
   taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginalJsFile, moduleInfo);

   // modulepack is needed to check packed non-minified libraries for correctness in builder unit tests
   if (taskParameters.config.builderTests) {
      const outputModulepackJsFile = `${outputFileWoExt}.modulepack.js`;
      taskParameters.cache.addOutputFile(file.pHistory[0], outputModulepackJsFile, moduleInfo);
   }
}

function getRelativePath(file, moduleInfo) {
   return path.join(
      path.basename(moduleInfo.path),
      path.relative(moduleInfo.path, file.pHistory[0])
   );
}

function getInterfaceName(moduleInfo, file) {
   return `${moduleInfo.outputName}/${file.pRelative.replace(TS_EXT, '')}`;
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
      async function onTransform(file, encoding, callback) {
         try {
            if (!(await shouldProcess(file, callback))) {
               return;
            }

            const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0]).replace(TS_EXT, '');
            const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
            const outputPath = `${outputFileWoExt}.js`;
            const outputMapPath = `${outputFileWoExt}.js.map`;

            if (file.cached) {
               updateCache(outputFileWoExt, file, taskParameters, moduleInfo);

               callback(null, file);
               return;
            }

            const relativeFilePath = getRelativePath(file, moduleInfo);

            if (
               taskParameters.config.compiled &&
               taskParameters.cache.isFirstBuild() &&
               !taskParameters.config.isFacade(getInterfaceName(moduleInfo, file))
            ) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace(TS_EXT, '.js'));
               const [, result] = await execInPool(
                  taskParameters.pool,
                  'readCompiledFile',
                  [
                     compiledPath,
                     taskParameters.cache.getCompiledHash(moduleInfo, relativeFilePath),
                     taskParameters.cache.getHash(moduleInfo, relativeFilePath)
                  ],
                  file.pHistory[0],
                  moduleInfo
               );

               if (result) {
                  /**
                   * ts compiled cache is required only in libraries packer, that can be enabled with
                   * builder flag "minimize"
                   */
                  if (taskParameters.config.minimize) {
                     const resultForCache = {
                        text: result,
                        moduleName: relativeFilePath.replace(TS_EXT, '')
                     };

                     // алиас для совместимости с кэшем шаблонов при паковке библиотек.
                     resultForCache.nodeName = resultForCache.moduleName;
                     moduleInfo.cache.storeCompiledES(
                        relativeFilePath,
                        resultForCache
                     );
                  }

                  const newFile = file.clone();
                  newFile.contents = Buffer.from(result);
                  newFile.pPath = outputPath;
                  newFile.pBase = moduleInfo.output;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  newFile.tscEmit = true;
                  this.push(newFile);

                  taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
                  taskParameters.cache.addDependencies(
                     moduleInfo.appRoot,
                     file.pHistory[0],
                     taskParameters.cache.getCompiledDependencies(relativeFilePath) || []
                  );

                  callback(null, file);
                  return;
               }

               logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            const [error, result] = await execInPool(
               taskParameters.pool,
               'loadCompiledJs',
               [
                  taskParameters.typescriptOutputDir,
                  relativeFilePath,
                  file.contents.toString(),
                  taskParameters.config.sourceMaps
               ],
               file.pHistory[0],
               moduleInfo
            );

            if (error) {
               taskParameters.cache.markFileAsFailed(file.pHistory[0]);
               logger.error({
                  error,
                  filePath: file.pHistory[0],
                  moduleInfo
               });

               callback(null, file);
               return;
            }

            taskParameters.config.removeFromDeletedFiles(relativeFilePath.replace(TS_EXT, '.js'));
            taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

            /**
             * ts compiled cache is required only in libraries packer, that can be enabled with
             * builder flag "minimize"
             */
            if (taskParameters.config.minimize) {
               // alias for backward compatibility with templates cache during libraries packing
               result.nodeName = result.moduleName;
               moduleInfo.cache.storeCompiledES(relativeFilePath, result);
            }

            const newFile = file.clone();
            newFile.contents = Buffer.from(result.text);
            newFile.compiled = true;
            newFile.pPath = outputPath;
            newFile.pBase = moduleInfo.output;
            newFile.tscEmit = true;
            this.push(newFile);

            if (taskParameters.config.sourceMaps) {
               const newMapFile = file.clone();
               newMapFile.contents = Buffer.from(result.sourceMapText);
               newMapFile.compiled = true;
               newMapFile.pPath = outputMapPath;
               newMapFile.pBase = moduleInfo.output;
               this.push(newMapFile);
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при загрузке сгенерированных tsc файлов",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         callback(null, file);
      }
   );
};
