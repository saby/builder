/* eslint-disable no-invalid-this */

/**
 * Plugin for compiling xml from wml/tmpl files into js,
 * these will be replaced by patched file with localization
 * inside of it if project needs to be localized.
 * Generates minified and compiled *.min.(tmpl/wml) if uglify
 * is enabled in current build.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   libPackHelpers = require('../../../lib/pack/helpers/librarypack'),
   templateExtReg = /(\.tmpl|\.wml|\.js)$/;
const modifyWithTailwind = require('../../../lib/tailwind/modify');

/**
 * Проверяем, является ли зависимость скомпилированного шаблона приватной
 * зависимостью из чужого Интерфейсного модуля
 * @param {String} moduleName - имя текущего Интерфейсного модуля
 * @param {Array} dependencies - набор зависимостей скомпилированного шаблона.
 * @returns {Array}
 */
function checkForExternalPrivateDeps(moduleName, dependencies) {
   const result = [];
   dependencies
      .filter(dependencyName => libPackHelpers.isPrivate(dependencyName))
      .forEach((dependencyName) => {
         const
            dependencyParts = dependencyName.split('/'),
            dependencyModule = dependencyParts[0].split(/!|\?/).pop();

         if (dependencyModule !== moduleName) {
            result.push(dependencyName);
         }
      });
   return result;
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current html
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');
   const moduleName = path.basename(moduleInfo.output);

   return through.obj(async function onTransform(file, encoding, callback) {
      try {
         if (!['.tmpl', '.wml'].includes(file.pExtname)) {
            callback(null, file);
            return;
         }

         // minified versions of files should be ignored, they will be compiled from sources
         if (file.pBasename.endsWith(`.min${file.pExtname}`)) {
            callback(null);
            return;
         }
         if (!taskParameters.config.templateBuilder) {
            logger.warning({
               message: '"View" or "UI" interface module doesn\'t exists in current project. "*.tmpl/*.wml" templates will be ignored',
               moduleInfo,
               filePath: file.pPath
            });
            callback(null, file);
            return;
         }
         let outputMinFile = '', outputMapFile = '', outputWmlJsFile = '', outputWmlMinJsFile = '';
         let mapText, mapPath;

         const relativePath = path.relative(moduleInfo.path, file.pHistory[0]);
         if (taskParameters.config.extensionForTemplate === 'js') {
            outputWmlJsFile = path.join(moduleInfo.output, transliterate(relativePath.replace(templateExtReg, '$1.js')));
            if (taskParameters.config.isReleaseMode) {
               outputWmlMinJsFile = path.join(moduleInfo.output, transliterate(relativePath.replace(templateExtReg, '$1.min.js')));
            }
         }

         if (taskParameters.config.isReleaseMode) {
            outputMinFile = path.join(moduleInfo.output, transliterate(relativePath.replace(templateExtReg, '.min$1')));

            if (taskParameters.config.sourceMaps) {
               outputMapFile = `${path.join(moduleInfo.output, transliterate(relativePath))}.map`;
               mapPath = path.basename(outputMapFile);
            }
         }

         if (file.cached) {
            if (outputMinFile) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
               if (outputWmlJsFile) {
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputWmlJsFile, moduleInfo);
               }
               if (outputWmlMinJsFile) {
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputWmlMinJsFile, moduleInfo);
               }
            }
            callback(null, file);
            return;
         }

         // Write original file if tmpl can't be compiled
         let newText = file.contents.toString();
         let relativeFilePath = path.relative(moduleInfo.path, file.pHistory[0]);
         relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);
         const extension = file.pExtname.slice(1, file.pExtname.length);

         if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
            const compiledBase = path.join(
               taskParameters.config.compiled,
               path.basename(moduleInfo.output)
            );
            const compiledSourcePath = path.join(
               compiledBase,
               file.pRelative
            );
            const compiledPath = path.join(compiledSourcePath.replace(file.pExtname, `.min.${extension}`));
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
               file.useSymlink = true;
               moduleInfo.cache.storeBuildedMarkup(relativeFilePath, {
                  nodeName: `${extension}!${relativeFilePath.replace(file.pExtname, '')}`,
                  text: result
               });
               const newFile = file.clone();
               newFile.contents = Buffer.from(result);
               newFile.pPath = outputMinFile;
               newFile.pBase = moduleInfo.output;
               newFile.origin = compiledPath;
               newFile.compiledBase = compiledBase;
               this.push(newFile);
               let relativeOutputFile = path.relative(moduleInfo.output, outputMinFile);
               relativeOutputFile = path.join(moduleName, relativeOutputFile);
               if (file.cdnLinked) {
                  taskParameters.addCdnModule(moduleName, relativeOutputFile);
               }
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
               callback(null, file);
               return;
            }
            logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
         }

         const [error, result] = await execInPool(
            taskParameters.pool,
            'buildTmpl',
            [
               newText,
               relativeFilePath,
               componentsPropertiesFilePath,
               {
                  generateCodeForTranslations: taskParameters.config.localizations.length > 0,
                  useReact: !!taskParameters.config.useReact,
                  moduleType: taskParameters.config.moduleType,
                  ESVersion: taskParameters.config.ESVersion,
                  isReleaseMode: taskParameters.config.isReleaseMode
               }
            ],
            relativeFilePath,
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));

            logger.error({
               message: `Error compiling ${extension.toUpperCase()}`,
               error,
               moduleInfo,
               filePath: relativeFilePath
            });
         } else {
            taskParameters.metrics.storeWorkerTime('build tmpl', result.timestamp);

            if (moduleInfo.tailwindInfo) {
               try {
                  result.text = modifyWithTailwind(
                     result.text,
                     moduleInfo.tailwindInfo,
                     taskParameters.config.ESVersion,
                     result.dependencies
                  );

                  if (result.umdText) {
                     result.umdText = modifyWithTailwind(
                        result.umdText,
                        moduleInfo.tailwindInfo,
                        taskParameters.config.ESVersion
                     );
                  }
               } catch (e) {
                  // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
                  logger.warning(`Ошибка tw-обработки файла "${file.pRelative}": ${e}`);
               }
            }

            const externalPrivateDependencies = checkForExternalPrivateDeps(
               moduleName,
               result.dependencies
            );
            if (externalPrivateDependencies.length > 0) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
               const message = 'Template compiling error. Private modules usage was discovered from ' +
                  `external Interface module. Bad dependencies list: [${externalPrivateDependencies.toString()}]. ` +
                  'Please, for each private module use the corresponding library.';
               logger.warning({
                  message,
                  moduleInfo,
                  filePath: relativeFilePath
               });
            }

            if (file.cdnLinked) {
               result.cdnLinked = true;
            }
            if (newText.startsWith('define')) {
               result.text = newText;
            }

            // gulp.src reader removes BOM from file contents, so we need to do
            // the same thing
            result.text = result.text.replace(/^\uFEFF/, '');
            if (result.umdText) {
               result.umdText = result.umdText.replace(/^\uFEFF/, '');
            }

            // save compiled result into source file if we have to
            if (taskParameters.config.debugCustomPack) {
               file.contents = Buffer.from(result.text);
            }

            // save compiled result into source file for UMD formatted code
            if (taskParameters.config.generateUMD) {
               if (outputWmlJsFile) {
                  file.path = file.path.replace(/(\.wml|\.tmpl)$/, '$1.js');
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputWmlJsFile, moduleInfo);
               }
               file.contents = Buffer.from(result.umdText);
               file.strictCopy = true;
            }

            if (taskParameters.config.isReleaseMode) {
               // Write original file if tmpl can't be compiled

               const [errorUglify, obj] = await execInPool(
                  taskParameters.pool,
                  'minifyJs',
                  [file.pPath, result.text, moduleInfo.ESVersion, true, mapPath],
                  relativeFilePath.replace(templateExtReg, '.min$1'),
                  moduleInfo
               );
               if (errorUglify) {
                  taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));

                  /**
                   * Uglify-js returns errors as 2 params based object:
                   * 1)message - single message of error occurred.
                   * 2)stack - the message with additional call stack.
                   * Use second option for logs.
                   */
                  logger.error({
                     message: `Error occurred while minify'ing compiled ${extension.toUpperCase()}: ${errorUglify.stack}`,
                     moduleInfo,
                     filePath: relativeFilePath.replace(templateExtReg, '.min$1')
                  });
               } else {
                  taskParameters.metrics.storeWorkerTime('build tmpl', obj.timestamp);
                  newText = obj.code;
                  mapText = obj.map;

                  // store minified version in cache instead of debug version
                  // to avoid duplicate minify of templates in packOwnDeps task
                  result.text = newText;
               }
            }

            moduleInfo.cache.storeBuildedMarkup(relativeFilePath, result);
         }

         if (outputMinFile) {
            let relativeOutputFile = path.relative(moduleInfo.output, outputMinFile);
            relativeOutputFile = path.join(moduleName, relativeOutputFile);
            if (file.cdnLinked) {
               taskParameters.addCdnModule(moduleName, relativeOutputFile);
            }
            this.push(
               new PosixVinyl({
                  pBase: moduleInfo.output,
                  pPath: outputMinFile,
                  pHistory: [...file.pHistory],
                  contents: Buffer.from(newText),
                  pushToServer: taskParameters.config.staticServer
               })
            );
            if (mapText) {
               this.push(
                  new PosixVinyl({
                     pBase: moduleInfo.output,
                     pPath: outputMapFile,
                     pHistory: [...file.pHistory],
                     contents: Buffer.from(mapText)
                  })
               );
            }
            taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
         logger.error({
            message: 'Builder error occurred while compiling tmpl/wml',
            error,
            moduleInfo,
            filePath: file.pPath
         });
      }

      callback(null, file);
   });
};
