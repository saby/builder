/**
 * Плагин для компиляции xml из *.xhtml файлов в js для release режима.
 * Создаёт новый файл *.min.xhtml.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix, removeLeadingSlashes } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool');

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
            if (file.pExtname !== '.xhtml') {
               callback(null, file);
               return;
            }
            if (!taskParameters.config.templateBuilder) {
               logger.warning({
                  message: '"View" or "UI" module doesn\'t exists in current project. WS.Core "*.xhtml" templates will be ignored',
                  moduleInfo,
                  filePath: file.pPath
               });
               callback(null, file);
               return;
            }
            const relativePath = path.relative(moduleInfo.path, file.pHistory[0]).replace(/\.xhtml/, '.min.xhtml');
            const outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
               callback(null, file);
               return;
            }

            // если xhtml не возможно скомпилировать, то запишем оригинал
            let newText = file.contents.toString();
            const originalText = newText;
            let relativeFilePath = path.relative(moduleInfo.path, file.pHistory[0]);
            relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace(file.pExtname, '.min.xhtml'));
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
                     nodeName: `html!${relativeFilePath.replace('.xhtml', '')}`,
                     text: result
                  });
                  const newFile = file.clone();
                  newFile.contents = Buffer.from(result);
                  newFile.pPath = outputMinFile;
                  newFile.pBase = moduleInfo.output;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  this.push(newFile);
                  taskParameters.cache.addOutputFile(relativeFilePath, outputMinFile, moduleInfo);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            const xhtmlFileName = transliterate(
               removeLeadingSlashes(
                  toSafePosix(relativeFilePath)
               )
            );
            const [errorBuild, resultBuild] = await execInPool(
               taskParameters.pool,
               'buildXhtml',
               [
                  newText,
                  relativeFilePath,
                  {
                     fileName: xhtmlFileName,
                     moduleType: taskParameters.config.moduleType
                  }
               ],
               relativeFilePath,
               moduleInfo
            );
            if (errorBuild) {
               taskParameters.cache.markFileAsFailed(file.pHistory[0]);
               logger.error({
                  message: 'Ошибка компиляции XHTML',
                  error: errorBuild,
                  moduleInfo,
                  filePath: relativeFilePath
               });
            } else {
               // added backward compatibility for new umdText option from templates processor
               // FIXME remove it after task completion https://online.sbis.ru/opendoc.html?guid=cd428c03-426a-4346-a095-8d76fcae98c6
               if (taskParameters.config.generateUMD && !resultBuild.text) {
                  resultBuild.text = resultBuild.umdText;
               }

               if (file.cdnLinked) {
                  resultBuild.cdnLinked = true;
               }

               taskParameters.metrics.storeWorkerTime('build xhtml', resultBuild.timestamp);
               newText = resultBuild.text;

               // for minified version we should generate amd formatted code
               if (taskParameters.config.generateUMD) {
                  const [, amdBuild] = await execInPool(
                     taskParameters.pool,
                     'buildXhtml',
                     [
                        originalText,
                        relativeFilePath,
                        {
                           fileName: xhtmlFileName
                        }
                     ],
                     relativeFilePath,
                     moduleInfo
                  );
                  newText = amdBuild.text;
               }

               // Write original file if xhtml can't be compiled
               const [error, obj] = await execInPool(taskParameters.pool, 'uglifyJs', [file.pPath, newText, true]);
               taskParameters.metrics.storeWorkerTime('build xhtml', obj.timestamp);
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.pHistory[0]);
                  logger.error({
                     message: 'Ошибка минификации скомпилированного XHTML',
                     error,
                     moduleInfo,
                     filePath: relativeFilePath.replace('.xhtml', '.min.xhtml')
                  });
               } else {
                  newText = obj.code;

                  // store minified version in cache instead of debug version
                  // to avoid duplicate minify of templates in packOwnDeps task
                  resultBuild.text = newText;
               }

               moduleInfo.cache.storeBuildedMarkup(relativeFilePath, resultBuild);
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
            taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
            logger.error({
               message: "Ошибка builder'а при компиляции XHTML",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         callback(null, file);
      }
   );
};
