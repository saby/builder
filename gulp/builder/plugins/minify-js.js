/**
 * Плагин для минификации js.
 * JS с учётом паковки собственных зависимостей и минификации может быть представлен тремя или пятью файлами.
 * Simple.js без верстки в зависимостях:
 *   - Simple.js - оригинал
 *   - Simple.min.js - минифицированный файл по Simple.js
 *   - Simple.min.js.map - source map для Simple.min.js по Simple.js
 * Simple.js с версткой в зависимостях:
 *   - Simple.js - оригинал
 *   - Simple.modulepack.js - файл с пакованными зависимостями вёрстки
 *   - Simple.min.original.js - минифицированный файл по Simple.js. Для rt паковки.
 *   - Simple.min.origin.js - минифицированный файл по Simple.js. Для фасадов.
 *   - Simple.min.js - минифицированный файл по Simple.modulepack.js
 *   - Simple.min.js.map - source map для Simple.min.js по Simple.modulepack.js
 *
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, getRelativePath } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   fs = require('fs-extra'),
   { TS_EXT } = require('../../../lib/builder-constants'),
   { getFacadeName } = require('../../../lib/helpers');

const excludeRegexes = [
   /.*\.min\.js$/,
   /.*\.routes\.js$/,
   /.*\.test\.js$/,

   // Dedicated folders for Node.js code https://online.sbis.ru/opendoc.html?guid=a2ba1417-2332-4828-a46b-01057408e295
   /.*[/\\]third-party[/\\]server[/\\].*/,

   // https://online.sbis.ru/opendoc.html?guid=05e7f1be-9fa9-48d4-a0d9-5506ac8d2b12
   /.*\.json\.js$/,
   /.*\.worker\.js$/,

   // TODO: удалить про node_modules
   /.*[/\\]node_modules[/\\]sbis3-dependency-graph[/\\].*/,
   /.*[/\\]ServerEvent[/\\]worker[/\\].*/
];

const thirdPartyModule = /.*[/\\]third-party[/\\].*/;

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (file.pExtname !== '.js') {
               callback(null, file);
               return;
            }

            for (const regex of excludeRegexes) {
               if (regex.test(file.pPath)) {
                  callback(null, file);
                  return;
               }
            }

            // dont minify source third-party library if it was already minified
            if (thirdPartyModule.test(file.pPath) && await fs.pathExists(file.pPath.replace(/\.js$/, '.min.js'))) {
               if (file.cached) {
                  taskParameters.cache.addOutputFile(
                     file.pHistory[0],
                     path.join(moduleInfo.output, file.pRelative.replace(/\.js$/, '.min.js')),
                     moduleInfo,
                     true
                  );
               }
               callback(null, file);
               return;
            }

            let outputFileWoExt;
            let outputMapFile, outputModulepackMapFile, mapPath, modulePackMapPath;
            const extName = TS_EXT.test(file.pHistory[0]) ? TS_EXT : file.pExtname;

            /**
             * объединённый словарь локализации пишется сразу же в кэш, поэтому для
             * него будет неправильно вычислен относительный путь. В данном случае нам просто
             * необходимо взять путь объединённого словаря и сделать .min расширение. Для всех
             * остальных css всё остаётся по старому. Также необходимо записать данные об исходном
             * объединённом словаре в кэш, чтобы при удалении/перемещении локализации объединённый
             * словарь был удалён из кэша за ненадобностью.
             */
            if (file.unitedDict) {
               outputFileWoExt = file.pPath.replace(extName, '');
               taskParameters.cache.addOutputFile(file.pHistory[0], `${outputFileWoExt}.js`, moduleInfo);
            } else {
               const relativePathWoExt = path.relative(moduleInfo.path, file.pHistory[0]).replace(extName, '');
               outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
               if (taskParameters.config.sourceMaps) {
                  outputModulepackMapFile = `${outputFileWoExt}.modulepack.js.map`;
                  outputMapFile = `${outputFileWoExt}.js.map`;
                  mapPath = `${path.basename(outputMapFile)}`;
                  modulePackMapPath = `${path.basename(outputModulepackMapFile)}`;
               }
            }
            const outputMinJsFile = `${outputFileWoExt}.min.js`;
            const outputMinOriginJsFile = `${outputFileWoExt}.min.origin.js`;
            const outputMinOriginalJsFile = `${outputFileWoExt}.min.original.js`;
            const outputModulepackJsFile = `${outputFileWoExt}.modulepack.js`;

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinJsFile, moduleInfo);
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginalJsFile, moduleInfo);
               callback(null, file);
               return;
            }

            const relativeFilePath = getRelativePath(
               moduleInfo.appRoot,
               file.pHistory[0],
               moduleInfo.outputRoot
            );
            if (
               taskParameters.config.compiled &&
               taskParameters.cache.isFirstBuild() &&
               !taskParameters.config.isFacade(getFacadeName(moduleInfo, file))
            ) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace(/(\.ts|\.js)/, '.min.js'));

               // for js there is only a symlink needed to be created, so we can get a result faster
               // to avoid read of minified compiled js file
               const hashesAreEqual = taskParameters.cache.compareWithCompiled(moduleInfo, relativeFilePath);
               if (hashesAreEqual && await fs.pathExists(compiledPath)) {
                  file.useSymlink = true;
                  const newFile = file.clone();
                  newFile.pBase = moduleInfo.output;
                  newFile.pPath = outputMinJsFile;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;

                  const compiledOriginalPath = compiledPath.replace('.js', '.original.js');
                  if (await fs.pathExists(compiledOriginalPath)) {
                     const newOriginalFile = file.clone();
                     newOriginalFile.pBase = moduleInfo.output;
                     newOriginalFile.pPath = outputMinOriginalJsFile;
                     newOriginalFile.origin = compiledOriginalPath;
                     newOriginalFile.compiledBase = compiledBase;
                     taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginalJsFile, moduleInfo);
                     this.push(newOriginalFile);
                  }

                  if (moduleInfo.hasFacades) {
                     const compiledOriginPath = compiledPath.replace('.js', '.origin.js');
                     if (await fs.pathExists(compiledOriginPath)) {
                        const newOriginFile = file.clone();
                        newOriginFile.pBase = moduleInfo.output;
                        newOriginFile.pPath = outputMinOriginJsFile;
                        newOriginFile.origin = compiledOriginPath;
                        newOriginFile.compiledBase = compiledBase;
                        taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginJsFile, moduleInfo);
                        this.push(newOriginFile);
                     }
                  }

                  this.push(newFile);
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputMinJsFile, moduleInfo);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding minified compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            let mapText;
            if (!file.modulepack) {
               let minText;
               if (file.productionContents) {
                  minText = file.productionContents.toString();
               } else {
                  minText = file.contents.toString();
               }

               // если файл не возможно минифицировать, то запишем оригинал
               const [error, minified] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.pPath,
                  minText,
                  moduleInfo.ESVersion,
                  false,
                  mapPath
               ]);
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error,
                     moduleInfo,
                     filePath: file.pPath
                  });
               } else {
                  taskParameters.metrics.storeWorkerTime('minify js', minified.timestamp);
                  minText = minified.code;
                  mapText = minified.map;
               }
               const newFile = file.clone();
               newFile.contents = Buffer.from(minText);
               newFile.pBase = moduleInfo.output;
               newFile.pPath = outputMinJsFile;
               if (newFile.baseInterface) {
                  const interfaceMinifiedFile = file.clone();
                  interfaceMinifiedFile.contents = Buffer.from(minText);
                  interfaceMinifiedFile.pBase = moduleInfo.output;
                  interfaceMinifiedFile.pPath = outputMinOriginJsFile;
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginJsFile, moduleInfo);
                  this.push(interfaceMinifiedFile);
               }
               this.push(newFile);
               if (mapText) {
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.output,
                        pPath: outputMapFile,
                        contents: Buffer.from(mapText)
                     })
                  );
               }
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinJsFile, moduleInfo);
            } else {
               // минимизируем оригинальный JS
               // если файл не возможно минифицировать, то запишем оригинал
               let minOriginalText;
               if (file.productionContents) {
                  minOriginalText = file.productionContents.toString();
               } else {
                  minOriginalText = file.contents.toString();
               }
               const [errorOriginal, minifiedOriginal] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.pPath,
                  minOriginalText,
                  moduleInfo.ESVersion,
                  false
               ]);
               if (errorOriginal) {
                  taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error: errorOriginal,
                     moduleInfo,
                     filePath: file.pPath
                  });
               } else {
                  taskParameters.metrics.storeWorkerTime('minify js', minifiedOriginal.timestamp);
                  minOriginalText = minifiedOriginal.code;
               }

               // в случае библиотек в минифицированном виде нам всегда нужна только запакованная
               if (!file.library) {
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.output,
                        pPath: outputMinOriginalJsFile,
                        contents: Buffer.from(minOriginalText)
                     })
                  );

                  taskParameters.cache.addOutputFile(file.pHistory[0], outputMinOriginalJsFile, moduleInfo);
               }

               // минимизируем JS c пакованными зависимостями
               // если файл не возможно минифицировать, то запишем оригинал
               let minText = file.modulepack;

               const [error, minified] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.pPath,
                  minText,
                  moduleInfo.ESVersion,
                  file.library,
                  modulePackMapPath
               ]);
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error,
                     moduleInfo,
                     filePath: outputModulepackJsFile
                  });
               } else {
                  taskParameters.metrics.storeWorkerTime('minify js', minified.timestamp);
                  if (file.minifiedTemplatesToPack && file.minifiedTemplatesToPack.length > 0) {
                     minText = `${file.minifiedTemplatesToPack.sort().join('\n')}\n${minified.code}`;
                  } else {
                     minText = minified.code;
                  }
                  mapText = minified.map;
               }

               const newFile = file.clone();
               newFile.pBase = moduleInfo.output;
               newFile.pPath = outputMinJsFile;
               newFile.contents = Buffer.from(minText);
               this.push(newFile);

               if (mapText) {
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.output,
                        pPath: outputModulepackMapFile,
                        contents: Buffer.from(mapText)
                     })
                  );
               }
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinJsFile, moduleInfo);

               /**
                * В случае работы тестов нам нужно сохранить неминифицированный запакованный модуль,
                * поскольку это может быть библиотека, а для запакованной библиотеки важно проверить
                * запакованный контент. В минифицированном варианте могут поменяться имена переменнных и
                * тест проходить не будет.
                */
               if (taskParameters.config.rawConfig.builderTests || mapPath) {
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.output,
                        pPath: outputModulepackJsFile,
                        contents: Buffer.from(file.modulepack)
                     })
                  );
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputModulepackJsFile, moduleInfo);
               }
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            logger.error({
               message: "Ошибка builder'а при минификации",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }
         callback(null, file);
      }
   );
};
