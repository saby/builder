/**
 * Плагин для компиляции json-файлов в AMD-формат.
 * json-файлы необходимо вставлять в разметку как скрипты, чтобы
 * разрешить проблему, которую описал Бегунов Андрей:
 * Cсылку на json нельзя вставить в тело страницы. В итоге оживление
 * идет с синхронными разрывами через require.js.
 * Также в будущем возникнет ситуация, что json плагина нет в es6 modules
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   compileJsonToJs = require('../../../lib/compile-json-to-js'),
   jsonExt = /\.json\.js$/;
const getMetricsReporter = require('../../common/classes/metrics-reporter');

function shouldIgnore(file) {
   return (
      !file.pBasename.endsWith('.json') ||
      file.pBasename.includes('package.json') ||
      file.pBasename.endsWith('.config.json') ||
      file.pBasename.includes('routes-info.json')
   );
}

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
         const startTime = Date.now();

         try {
            if (!file.contents) {
               callback();
               taskParameters.metrics.storePluginTime('jsonJs', startTime);
               return;
            }

            /**
             * dont build AMD-formatted json files for *.package.json and *.config.json. It's common
             * builder config files, participating only in project's build.
             */
            if (shouldIgnore(file)) {
               callback(null, file);
               taskParameters.metrics.storePluginTime('jsonJs', startTime);
               return;
            }

            /**
             * Remove AMD-formatted json sources from stream if json source file
             * exists. It will be compiled into AMD-formatted json file.
             * Needed to avoid double symlink issue in debug build(double symlinks
             * throws fatal error).
             * P.S. can't be caught by tests, in each build gulp's stream could have different order for files in it.
             * It cloud throw an error in one build, and build successfully in another
             */
            if (file.pBasename.endsWith('.json.js')) {
               const jsonInSource = await fs.pathExists(file.pPath.replace(jsonExt, '.json'));

               if (jsonInSource) {
                  callback(null);
               } else {
                  callback(null, file);
               }
               taskParameters.metrics.storePluginTime('jsonJs', startTime);
               return;
            }

            const currentFileBase = file.pHistory[0].startsWith(moduleInfo.path) ? moduleInfo.path : moduleInfo.output;
            const relativePath = path.relative(currentFileBase, file.pHistory[0]).replace(/\.(json)$/, '.json.js');
            const outputPath = path.join(moduleInfo.output, transliterate(relativePath));
            const outputMinPath = outputPath.replace(/\.js$/, '.min.js');

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
               taskParameters.cache.addOutputFile(file.pHistory[0], outputMinPath, moduleInfo);
               callback(null, file);
               taskParameters.metrics.storePluginTime('jsonJs', startTime);
               return;
            }

            let
               relativeFilePath = path.relative(currentFileBase, file.pHistory[0]),
               result;

            relativeFilePath = path.join(path.basename(currentFileBase), relativeFilePath);

            try {
               result = compileJsonToJs(
                  relativeFilePath,
                  file.contents.toString(),
                  taskParameters.config.generateUMD
               );
            } catch (error) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
               getMetricsReporter().markFailedModule(moduleInfo);
               logger.error({
                  message: 'Ошибка создания JS модуля для json-файла',
                  error,
                  filePath: file.pHistory[0],
                  moduleInfo
               });
               callback(null, file);
               taskParameters.metrics.storePluginTime('jsonJs', startTime);
               return;
            }

            taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
            const newFile = file.clone();
            newFile.contents = Buffer.from(result);
            newFile.pPath = outputPath;
            newFile.pBase = moduleInfo.output;
            this.push(newFile);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Ошибка builder'а при компиляции json в JS",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         taskParameters.metrics.storePluginTime('jsonJs', startTime);
         callback(null, file);
      }
   );
};
