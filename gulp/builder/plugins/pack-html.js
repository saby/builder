/**
 * Плагин для паковки в HTML.
 * Берёт корневой элемент и все зависимости пакует.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix } = require('../../../lib/platform/path');
const through = require('through2');
const domHelpers = require('../../../packer/lib/dom-helpers');
const logger = require('../../../lib/logger').logger();
const packHtml = require('../../../packer/tasks/lib/pack-html');
const execInPool = require('../../common/exec-in-pool');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {DepGraph} gd граф зависмостей
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo, gd) {
   const prettyOutput = toSafePosix(taskParameters.config.rawConfig.output);

   return through.obj(async function onTransform(file, encoding, callback) {
      try {
         if (file.pExtname !== '.html') {
            callback(null, file);
            return;
         }

         const [error, minText] = await execInPool(taskParameters.pool, 'minifyHtml', [file.contents.toString()]);
         if (error) {
            logger.error({
               message: 'Error while minifying html',
               error,
               moduleInfo,
               filePath: file.pPath
            });
         } else if (
            toSafePosix(path.dirname(path.dirname(file.pPath))) !== prettyOutput
         ) {
            // если файл лежит не в корне модуля, то это скорее всего шаблон html.
            // используется в сервисе представлений для построения страниц на роутинге.
            // паковка тут не нужна, а минимизация нужна.
            file.contents = Buffer.from(minText);
         } else {
            let dom = domHelpers.domify(minText);

            // sets application root as builder cache, for proper html packing in patch build
            const root = taskParameters.config.outputPath,
               buildNumber = taskParameters.config.multiService ? `%{MODULE_VERSION_STUB=${path.basename(moduleInfo.output)}}` : taskParameters.config.version,
               replacePath = !taskParameters.config.multiService;

            dom = await packHtml.packageSingleHtml(
               taskParameters,
               file.pPath,
               dom,
               root,
               `${path.basename(moduleInfo.output)}/static_packages`,
               gd,
               taskParameters.config.urlServicePath,
               buildNumber,
               replacePath,
               taskParameters.config.rawConfig.output,
               taskParameters.config.localizations
            );

            file.contents = Buffer.from(domHelpers.stringify(dom));
         }
      } catch (error) {
         logger.error({
            message: 'An error occurred during html pack',
            error,
            moduleInfo,
            filePath: file.pPath
         });
      }
      callback(null, file);
   });
};
