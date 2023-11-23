/**
 * Plugin for doing version header conjunctions in process of incremental build. Adds placeholder in places that are
 * having version header conjunctions in links.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   {
      versionizeStyles,
      versionizeTemplates
   } = require('../../../lib/versionize-content');

const includeExts = ['.css', '.html'];

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(async function onTransform(file, encoding, callback) {
      const startTime = Date.now();
      try {
         if (!includeExts.includes(file.pExtname)) {
            callback(null, file);
            taskParameters.metrics.storePluginTime('versionize', startTime);
            return;
         }

         if (file.cached) {
            callback(null, file);
            taskParameters.metrics.storePluginTime('versionize', startTime);
            return;
         }

         let result;
         const prettyPath = file.pPath;

         if (file.pExtname === '.css') {
            result = await versionizeStyles(file, moduleInfo, taskParameters.config.buildIE);

         // templates in WS3Page/Templates/includes is basic templates to be used in Presentation service
         // runtime page rendering, so jinnee cannot replace placeholders in these files, Presentation service
         // will do it by himself with runtime generator parameters
         } else if (['.html'].includes(file.pExtname) && !prettyPath.includes('WS3Page/Templates/includes/')) {
            result = versionizeTemplates(file, moduleInfo);
         }

         if (result) {
            file.contents = Buffer.from(result.newText);
            if (result.errors) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            }
            if (result.externalDependencies.size > 0) {
               const relativeSourcePath = file.pHistory[0].replace(moduleInfo.path, '');
               taskParameters.cache.storeFileExternalDependencies(
                  moduleInfo.outputName,
                  relativeSourcePath,
                  result.externalDependencies
               );
            }
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
         logger.error({
            message: "Ошибка builder'а при версионировании",
            error,
            moduleInfo,
            filePath: file.pPath
         });
      }
      callback(null, file);
      taskParameters.metrics.storePluginTime('versionize', startTime);
   });
};
