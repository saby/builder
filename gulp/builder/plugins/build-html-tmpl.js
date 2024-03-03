/**
 * Плагин для генерации статических html по *.html.tmpl файлам.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   transliterate = require('../../../lib/transliterate'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

function getMetaFiles(taskParameters, moduleInfo) {
   const bundlesRoute = taskParameters.cache.commonBundlesRoute;
   const moduleDependencies = taskParameters.cache.getModuleDependencies();

   return {
      bundlesRoute,
      moduleDependencies,
      contents: moduleInfo.contents
   };
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!file.pPath.endsWith('.html.tmpl')) {
               callback(null, file);
               return;
            }
            if (!taskParameters.config.templateBuilder) {
               logger.warning({
                  message: '"View" or "UI" module doesn\'t exists in current project. "*.html.tmpl" templates will be ignored',
                  moduleInfo,
                  filePath: file.pPath
               });
               callback(null, file);
               return;
            }

            const additionalInfo = getMetaFiles(taskParameters, moduleInfo);
            const relativeTmplPath = path.relative(moduleInfo.path, file.pHistory[0]);
            const relativeTmplPathWithModuleName = toSafePosix(
               path.join(moduleInfo.name, relativeTmplPath)
            );
            const [error, result] = await execInPool(
               taskParameters.pool,
               'buildHtmlTmpl',
               [
                  file.contents.toString(),
                  file.pHistory[0],
                  {
                     multiService: taskParameters.config.multiService,
                     servicesPath: `${taskParameters.config.urlDefaultServicePath}service/`,
                     application: taskParameters.config.applicationForRebase,
                     resourcesUrl: taskParameters.config.resourcesUrl ? 'resources/' : ''
                  },
                  relativeTmplPathWithModuleName,
                  componentsPropertiesFilePath,
                  additionalInfo
               ],
               file.pHistory[0],
               moduleInfo
            );
            if (error) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));

               logger.error({
                  message: 'Ошибка при обработке html-tmpl шаблона',
                  error,
                  moduleInfo,
                  filePath: file.pHistory[0]
               });
            } else {
               taskParameters.metrics.storeWorkerTime('build html-tmpl', result.timestamp);
               const outputPath = path.join(moduleInfo.output, transliterate(relativeTmplPath)).replace('.tmpl', '');
               taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
               this.push(
                  new PosixVinyl({
                     pBase: moduleInfo.output,
                     pPath: outputPath,
                     contents: Buffer.from(result.content),
                     pushToServer: taskParameters.config.staticServer
                  })
               );

               const resultStaticTemplate = relativeTmplPathWithModuleName.replace(
                  '.tmpl',
                  ''
               );
               if (moduleInfo.staticTemplates.hasOwnProperty(path.basename(outputPath))) {
                  moduleInfo.staticTemplates[path.basename(outputPath)].push(resultStaticTemplate);
               } else {
                  moduleInfo.staticTemplates[path.basename(outputPath)] = [resultStaticTemplate];
               }
            }
         } catch (error) {
            logger.error({ error });
         }

         callback(null, file);
      }
   );
};
