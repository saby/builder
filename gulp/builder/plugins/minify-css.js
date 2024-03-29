/**
 * Плагин для минификации css
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, getRelativePath } = require('../../../lib/platform/path');
const through = require('through2');
const logger = require('../../../lib/logger').logger();
const transliterate = require('../../../lib/transliterate');
const execInPool = require('../../common/exec-in-pool');
const helpers = require('../../../lib/helpers');
const fs = require('fs-extra');

const { stylesToExcludeFromMinify } = require('../../../lib/builder-constants');
const thirdPartyModule = /.*[/\\]third-party[/\\].*/;
const deepOptimizeModules = new Set([
   'Controls',
   'Controls-default-theme'
]);

function addMinifiedFileHash(moduleInfo, text, filePath) {
   const relativePath = path.relative(moduleInfo.output, filePath);
   const pathForHash = path.join(moduleInfo.outputName, relativePath);
   moduleInfo.addFileHash(pathForHash, helpers.getFileHash(text, true));
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
            // Нужно вызвать taskParameters.cache.addOutputFile для less, чтобы не удалился *.min.css файл.
            // Ведь самой css не будет в потоке при повторном запуске
            if (!['.css', '.less'].includes(file.pExtname)) {
               callback(null, file);
               return;
            }

            for (const regex of stylesToExcludeFromMinify) {
               if (regex.test(file.pPath)) {
                  callback(null, file);
                  return;
               }
            }

            // dont minify source third-party library if it was already minified
            if (thirdPartyModule.test(file.pPath) && await fs.pathExists(file.pPath.replace(/\.css/, '.min.css'))) {
               if (file.cached) {
                  taskParameters.cache.addOutputFile(
                     file.pHistory[0],
                     path.join(moduleInfo.output, file.pRelative.replace(/\.css$/, '.min.css')),
                     moduleInfo,
                     true
                  );
               }
               callback(null, file);
               return;
            }

            let outputMinFile;

            /**
             * объединённый словарь локализации пишется сразу же в кэш, поэтому для
             * него будет неправильно вычислен относительный путь. В данном случае нам просто
             * необходимо взять путь объединённого словаря и сделать .min расширение. Для всех
             * остальных css всё остаётся по старому.
             */
            if (file.unitedDict) {
               outputMinFile = file.pPath.replace(/\.css$/, '.min.css');
            } else {
               const lastHistory = file.pHistory[file.pHistory.length - 1];
               const filePath = /\.css$/.test(file.pHistory[0]) ? moduleInfo.path : moduleInfo.output;
               const relativePath = path.relative(filePath, lastHistory).replace(/\.css$/, '.min.css');
               outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));
            }
            if (file.cached) {
               taskParameters.cache.getOutputForFile(file.pHistory[0], moduleInfo).forEach((outputFile) => {
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputFile.replace(/\.css$/, '.min.css'), moduleInfo);
               });
               callback(null, file);
               return;
            }

            // Минифицировать less не нужно
            if (file.pExtname !== '.css') {
               callback(null, file);
               return;
            }

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const relativeFilePath = getRelativePath(
                  moduleInfo.appRoot,
                  file.pHistory[0],
                  moduleInfo.outputRoot
               );
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace('.css', '.min.css'));

               // for css there is only a symlink needed to be created, so we can get a result faster
               // due to avoid read of compiled and minified css file
               if (taskParameters.cache.compareWithCompiled(moduleInfo, relativeFilePath)) {
                  const newFile = file.clone();

                  newFile.pBase = moduleInfo.output;
                  newFile.pPath = outputMinFile;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  newFile.useSymlink = true;
                  if (!file.unitedDict && file.pHistory[0].endsWith('.css')) {
                     file.useSymlink = true;
                  }
                  this.push(newFile);
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding minified compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }

            // если файл не возможно минифицировать, то запишем оригинал
            let newText = file.contents.toString();

            const [error, minified] = await execInPool(
               taskParameters.pool,
               'minifyCss',
               [newText, deepOptimizeModules.has(moduleInfo.name)]
            );
            taskParameters.metrics.storeWorkerTime('minify css', minified.timestamp);
            newText = minified.styles;
            if (minified.errors.length > 0) {
               taskParameters.cache.markFileAsFailed(file.pHistory[0]);
               newText = `${newText}\n${file.contents.toString()}`;
            }
            if (error) {
               taskParameters.cache.markFileAsFailed(file.pHistory[0]);
               logger.error({
                  message: 'Ошибка минификации файла',
                  error,
                  moduleInfo,
                  filePath: file.pPath
               });
            }

            const newFile = file.clone();
            newFile.contents = Buffer.from(newText);
            newFile.pPath = outputMinFile;
            newFile.pBase = moduleInfo.output;
            this.push(newFile);
            taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
            addMinifiedFileHash(moduleInfo, newText, outputMinFile);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pHistory[0]);
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
