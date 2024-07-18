/**
 * Plugin for css minify
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, getRelativePath } = require('../../../lib/platform/path');
const through = require('through2');
const logger = require('../../../lib/logger').logger();
const transliterate = require('../../../lib/transliterate');
const execInPool = require('../../common/exec-in-pool');
const fs = require('fs-extra');

const { stylesToExcludeFromMinify } = require('../../../lib/builder-constants');
const thirdPartyModule = /.*[/\\]third-party[/\\].*/;
const deepOptimizeModules = new Set([
   'Controls',
   'Controls-default-theme'
]);

// модули, в которых пока используем старый минификатор
const oldMinifyModules = new Set([
   'SBIS3.CONTROLS',
   'ModuleEditor',
   'LinkDecorator'
]);

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
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

            const currentRelativePath = `${moduleInfo.name}/${file.pRelative}`;
            for (const regex of stylesToExcludeFromMinify) {
               if (regex.test(currentRelativePath)) {
                  callback(null, file);
                  return;
               }
            }

            // don't minify source third-party library if it was already minified
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
               const moduleOutput = file.region ? moduleInfo.regionOutput[file.region] : moduleInfo.output;
               let fileRoot;
               if (file.region) {
                  fileRoot = moduleInfo.regionOutput[file.region];
               } else {
                  fileRoot = /\.css$/.test(file.pHistory[0]) ? moduleInfo.path : moduleOutput;
               }

               const relativePath = path.relative(fileRoot, lastHistory).replace(/\.css$/, '.min.css');
               outputMinFile = path.join(moduleOutput, transliterate(relativePath));
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
            let newMinimizer = true;

            // новый минификатор ломает код в указанных модулях, а гибкой настройки минификатора
            // пока нету, ждём решения issue https://github.com/parcel-bundler/lightningcss/issues/666
            // также новый минификатор нарушает порядок параметров внутри css-селектора, из-за чего
            // дефолтные значения для css-переменных для работы в IE перебивают значения css-переменных
            // в основных браузерах и ломают вёрстку, ждём решения issue
            // https://github.com/parcel-bundler/lightningcss/issues/640
            // нельзя также минифицировать региональные css, где прописывается юникод для глифов, при минификации
            // lightningcss превращает юникод в символ и затем при формировании региональных css и кастомных пакетов
            // нельзя заменить содержимое глифа на нужный юникод.
            if (
               oldMinifyModules.has(moduleInfo.name) ||
               taskParameters.config.ESVersion === 5 ||
               file.hasRegionVersion
            ) {
               newMinimizer = false;
            }

            const [error, minified] = await execInPool(
               taskParameters.pool,
               'minifyCss',
               [newMinimizer, newText, deepOptimizeModules.has(moduleInfo.name)]
            );
            taskParameters.metrics.storeWorkerTime('minify css', minified.timestamp);
            newText = minified.styles;
            if (minified.errors.length > 0) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
               const errors = minified.errors.toString();
               logger.warning({
                  message: `Error while minifying css: ${errors.split('; ')}`,
                  moduleInfo,
                  filePath: file.path
               });
            }
            if (error) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
               logger.error({
                  message: 'Error while minifying css',
                  error,
                  moduleInfo,
                  filePath: file.pPath
               });
            }

            // региональную минифицированную cssку требуется только сохранить на диск,
            // но мы не можем также использовать stream, поскольку stream настроен на
            // основной output
            if (file.region) {
               await fs.outputFile(outputMinFile, newText);

               // данную css теперь можно выкинуть из stream, данный исходник нам больше не нужен
               callback(null);
               return;
            }
            const newFile = file.clone();
            newFile.contents = Buffer.from(newText);
            newFile.pPath = outputMinFile;
            newFile.pBase = moduleInfo.output;
            this.push(newFile);
            taskParameters.cache.addOutputFile(file.pHistory[0], outputMinFile, moduleInfo);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            logger.error({
               message: "Builder's minifying plugin error occurred",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         callback(null, file);
      }
   );
};
