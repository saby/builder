/**
 * Plugin for doing version header conjunctions in process of incremental build. Adds placeholder in places that are
 * having version header conjunctions in links.
 * In dependent of versionize-finish
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   {
      versionizeStyles,
      versionizeTemplates
   } = require('../../../lib/versionize-content');

const includeExts = ['.css', '.html', '.tmpl', '.xhtml', '.wml'];

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      const startTime = Date.now();
      try {
         if (!includeExts.includes(file.extname)) {
            callback(null, file);
            taskParameters.storePluginTime('versionize', startTime);
            return;
         }

         if (file.cached) {
            callback(null, file);
            taskParameters.storePluginTime('versionize', startTime);
            return;
         }

         let result;

         if (file.extname === '.css') {
            result = versionizeStyles(file, moduleInfo);
         } else if (['.html', '.tmpl', '.xhtml', '.wml'].includes(file.extname)) {
            result = versionizeTemplates(file, moduleInfo);
         }

         file.contents = Buffer.from(result.newText);
         if (result.errors) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.history[0]);
         logger.error({
            message: "Ошибка builder'а при версионировании",
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
      taskParameters.storePluginTime('versionize', startTime);
   });
};
