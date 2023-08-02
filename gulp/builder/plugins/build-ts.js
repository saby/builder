'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   { shouldRemoveFromStream, getFacadeName } = require('../../../lib/helpers'),
   execInPool = require('../../common/exec-in-pool'),
   { TS_EXT } = require('../../../lib/builder-constants');

const sourceMap = require('../../../lib/source-map');

const isRoutesFile = file => /\.routes\.tsx?$/.test(file.pBasename);

function getRelativePath(file, moduleInfo) {
   return path.join(
      path.basename(moduleInfo.path),
      path.relative(moduleInfo.path, file.pHistory[0])
   );
}

async function shouldProcess(file, callback) {
   if (!file.contents) {
      callback();

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

function updateFileInCache(file, taskParameters, moduleInfo) {
   const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0]).replace(TS_EXT, '');
   const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));

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

async function loadCompiledFile(stream, file, taskParameters, moduleInfo) {
   const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0]).replace(TS_EXT, '');
   const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
   const outputPath = `${outputFileWoExt}.js`;
   const relativeFilePath = getRelativePath(file, moduleInfo);
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

   if (!result) {
      return false;
   }

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

   const jsFile = file.clone();
   jsFile.contents = Buffer.from(result);
   jsFile.pPath = outputPath;
   jsFile.pBase = moduleInfo.output;
   jsFile.origin = compiledPath;
   jsFile.compiledBase = compiledBase;
   jsFile.tscEmit = !!taskParameters.config.emitTypescript;
   stream.push(jsFile);

   taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
   taskParameters.cache.addDependencies(
      moduleInfo.appRoot,
      file.pHistory[0],
      taskParameters.cache.getCompiledDependencies(relativeFilePath) || []
   );

   return true;
}

function shouldLoadTscEmit(file, taskParameters) {
   return (
      taskParameters.config.emitTypescript && !isRoutesFile(file)
   );
}

function shouldCompileDevelopmentFile(file) {
   /**
    * Нам нужно выполнить typescript.transpileModule для
    * - tsx файлов в дебаг режиме, поскольку tsc глобально работает в релиз-режиме, а у tsx файлов
    * отличается код для react/jsx-runtime и react/jsx-dev-runtime библиотек.
    * - роутингов, поскольку они должны копилироваться в CJS формат.
    */
   return (
      file.pExtname === '.tsx' && !isRoutesFile(file)
   );
}

async function loadTscEmittedFile(file, taskParameters, moduleInfo) {
   const relativeFilePath = getRelativePath(file, moduleInfo);

   const [error, production] = await execInPool(
      taskParameters.pool,
      'loadCompiledJs',
      [
         taskParameters.config.typescriptOutputDir,
         relativeFilePath,
         file.contents.toString(),
         taskParameters.config.sourceMaps
      ],
      file.pHistory[0],
      moduleInfo
   );

   if (error) {
      throw error;
   }

   if (!shouldCompileDevelopmentFile(file)) {
      return {
         development: production
      };
   }

   const result = await compileSingleFile(file, taskParameters, moduleInfo);

   return {
      development: result.development,
      production
   };
}

/**
 * Create configuration for transpiler.
 * @param {TaskParameters} taskParameters Current task parameters instance.
 * @param {PosixVinyl} file Current processing file.
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

async function compileSingleFile(file, taskParameters, moduleInfo, sourceRoot) {
   const compilerOptions = createCompilerOptions(taskParameters, file);
   const relativeFilePath = getRelativePath(file, moduleInfo);

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
      throw error;
   }

   Object.keys(result).forEach((currentMode) => {
      taskParameters.metrics.storeWorkerTime('typescript', result[currentMode].timestamp);
   });

   return result;
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

            if (file.pPath.endsWith('.meta.ts')) {
               moduleInfo.addMetaTsFile(`${moduleInfo.outputName}/${file.pRelative.replace(TS_EXT, '')}`);
            }

            if (file.cached) {
               updateFileInCache(file, taskParameters, moduleInfo);
               callback(null, file);
               return;
            }

            if (
               taskParameters.config.compiled &&
               taskParameters.cache.isFirstBuild() &&
               !taskParameters.config.isFacade(getFacadeName(moduleInfo, file))
            ) {
               if (await loadCompiledFile(this, file, taskParameters, moduleInfo)) {
                  callback(null, file);
                  return;
               }

               logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            const sourceRoot = await sourceMap.getSourceRoot(file.pHistory[0]);
            const result = shouldLoadTscEmit(file, taskParameters)
               ? await loadTscEmittedFile(file, taskParameters, moduleInfo)
               : await compileSingleFile(file, taskParameters, moduleInfo, sourceRoot);

            const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0]).replace(TS_EXT, '');
            const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
            const outputPath = `${outputFileWoExt}.js`;
            const outputMapPath = `${outputFileWoExt}.js.map`;
            const relativeFilePath = getRelativePath(file, moduleInfo);

            taskParameters.config.removeFromDeletedFiles(relativeFilePath.replace(TS_EXT, '.js'));
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

            const jsFile = file.clone();
            jsFile.contents = Buffer.from(result.development.text);
            if (result.production) {
               jsFile.developmentContent = Buffer.from(result.development.text);
               jsFile.contents = Buffer.from(result.production.text);
            }
            jsFile.compiled = true;
            jsFile.pPath = outputPath;
            jsFile.pBase = moduleInfo.output;
            jsFile.tscEmit = !!taskParameters.config.emitTypescript;

            if (taskParameters.config.sourceMaps) {
               jsFile.sourceMapText = result.development.sourceMapText;
               jsFile.sourceMapOutput = outputMapPath;
               jsFile.sourceRoot = sourceRoot;
            }

            this.push(jsFile);

            callback(null, file);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при обработке TypeScript файлов",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
            callback(null, file);
         }
      }
   );
};
