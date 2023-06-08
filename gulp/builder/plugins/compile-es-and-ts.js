/**
 * Плагин для компиляции ECMAScript 6+ и TypeScript в JavaScript (ES5).
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   { shouldRemoveFromStream } = require('../../../lib/helpers'),
   execInPool = require('../../common/exec-in-pool'),
   { TS_EXT } = require('../../../lib/builder-constants');

const isRoutingFile = basename => /\.routes\.tsx?$/.test(basename);

/**
 * Create configuration for transpiler.
 * @param {TaskParameters} taskParameters Current task parameters instance.
 * @param {Vinyl} file Current processing file.
 * @returns {object} Configuration for transpiler.
 */
function createCompilerOptions(taskParameters, file) {
   const options = {
      development: {
         ...taskParameters.config.tsCompilerOptions
      }
   };

   if (taskParameters.config.isReleaseMode) {
      options.production = {
         ...taskParameters.config.tsCompilerOptions
      };
   }

   if (file.pExtname === '.tsx') {
      options.development.jsx = 'react-jsxdev';

      if (taskParameters.config.isReleaseMode) {
         options.production = {
            ...options.production,
            'jsx': 'react-jsx'
         };
      }
   }

   if (file.pExtname.startsWith('.ts') && taskParameters.config.generateUMD && !taskParameters.config.customPack) {
      options.development.module = 'umd';
   }

   return options;
}

async function shouldCompile(emitTypescript, file, callback) {
   if (!file.contents) {
      callback();

      return false;
   }

   /**
    * Нам нужно выполнить typescript.transpileModule для tsx файлов в дебаг
    * режиме, поскольку tsc глобально работает в релиз-режиме, а у tsx файлов
    * отличается код для react/jsx-runtime и react/jsx-dev-runtime библиотек.
    */
   if (emitTypescript) {
      if (file.pExtname === '.tsx') {
         return true;
      }
      if (isRoutingFile(file.pBasename)) {
         return true;
      }
      callback(null, file);
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

async function getSourceRoot(filePath) {
   // real path might lead to shared volume (win32 shared, docker mounted)
   // and fs.promises.realpath will fail
   try {
      return path.dirname(await fs.promises.realpath(filePath));
   } catch (e) {
      return path.dirname(filePath);
   }
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
            if (!(await shouldCompile(taskParameters.config.emitTypescript, file, callback))) {
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

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace(/\.tsx?/, '.js'));
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
                        moduleName: relativeFilePath.replace(/\.tsx?$/, '')
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

            const compilerOptions = createCompilerOptions(taskParameters, file);
            const sourceRoot = await getSourceRoot(file.pHistory[0]);

            const [error, result] = await execInPool(
               taskParameters.pool,
               'compileEsAndTs',
               [
                  relativeFilePath,
                  file.contents.toString(),
                  moduleInfo.name,
                  compilerOptions,
                  taskParameters.config.sourceMaps,
                  taskParameters.config.inlineSourceMaps,
                  sourceRoot
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

            Object.keys(result).forEach((currentMode) => {
               taskParameters.metrics.storeWorkerTime('typescript', result[currentMode].timestamp);
            });

            if (taskParameters.config.emitTypescript && !isRoutingFile(file.pBasename)) {
               file.debugContent = result.development.text;
               callback(null, file);
               return;
            }

            taskParameters.config.removeFromDeletedFiles(relativeFilePath.replace('.ts', '.js'));
            taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

            /**
             * ts compiled cache is required only in libraries packer, that can be enabled with
             * builder flag "minimize"
             */
            if (taskParameters.config.minimize) {
               const currentResult = result.production || result.development;

               // alias for backward compatibility with templates cache during libraries packing
               currentResult.nodeName = currentResult.moduleName;
               moduleInfo.cache.storeCompiledES(relativeFilePath, currentResult);
            }

            const newFile = file.clone();
            newFile.contents = Buffer.from(result.development.text);
            if (result.production) {
               newFile.productionContents = Buffer.from(result.production.text);
            }
            newFile.compiled = true;
            newFile.pPath = outputPath;
            newFile.pBase = moduleInfo.output;
            this.push(newFile);

            if (taskParameters.config.sourceMaps) {
               const newMapFile = file.clone();
               newMapFile.contents = Buffer.from(result.development.sourceMapText);
               newMapFile.compiled = true;
               newMapFile.pPath = outputMapPath;
               newMapFile.pBase = moduleInfo.output;
               this.push(newMapFile);
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при компиляции в JS",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         callback(null, file);
      }
   );
};
