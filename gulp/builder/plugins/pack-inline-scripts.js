/**
 * Plugin for packing of inline script in static html pages.
 * Especially needed by chrome extensions that aren't allowed
 * of using inline script in theirs source code because of
 * Google's content security policy
 * https://developer.chrome.com/extensions/contentSecurityPolicy#JSExecution
 * @author Kolbeshin F.A.
 */

'use strict';

const { toSafePosix } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   packHtml = require('../../../packer/tasks/lib/pack-html');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @param {ModuleInfo} moduleInfo core info about the interface module
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const { applicationForRebase, resourcesUrl } = taskParameters.config;
   let resourceRoot;
   if (taskParameters.config.multiService) {
      resourceRoot = '%{RESOURCE_ROOT}';
   } else {
      resourceRoot = `${applicationForRebase}${resourcesUrl ? 'resources/' : ''}`;
   }
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (file.pExtname !== '.html') {
               callback(null, file);
               return;
            }

            const result = await packHtml.packInlineScripts(
               taskParameters.config.rawConfig.output,
               toSafePosix(file.pPath),
               file.contents.toString(),
               resourceRoot
            );

            file.contents = Buffer.from(result.newPageContent);

            result.scripts.forEach((currentScript) => {
               const newFile = file.clone();
               newFile.pPath = currentScript.path;
               newFile.contents = Buffer.from(currentScript.content);
               this.push(newFile);
            });
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: 'Inline script packing error occurred',
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }
         callback(null, file);
      }
   );
};
