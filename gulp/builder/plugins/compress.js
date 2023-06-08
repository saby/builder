/**
 * Builder plugin for compressing of files using both of gzip and brotli algorithms
 * Pushes into file stream nothing but compressed versions of minified files to be written into output directory
 * to avoid unnecessary files rewriting
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

const excludeRegexes = [
   /\/ServerEvent\/worker\/.*/,
   /.*\/data-providers\/.*\.js$/,
   /.*\/design\/.*\.js$/
];

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - a whole parameters list for execution of build of current project
 * @param {ModuleInfo} moduleInfo - all needed information about current interface module
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!file.contents) {
               callback();
               return;
            }

            for (const regex of excludeRegexes) {
               if (regex.test(file.pPath)) {
                  callback();
                  return;
               }
            }

            const prettyOutputPath = path.join(
               moduleInfo.output,
               file.pRelative
            );

            taskParameters.cache.createContentHash(prettyOutputPath, file.contents);

            // if input minified file has already been cached, it already has an archived version of itself.
            // if this interface module has to be patched, compression should be engaged
            if (!moduleInfo.rebuild && taskParameters.cache.minifiedIsCached(prettyOutputPath)) {
               callback();
               return;
            }

            const [error, result] = await execInPool(
               taskParameters.pool,
               'compress',
               [file.contents.toString()],
               file.pPath,
               moduleInfo
            );

            if (error) {
               logger.error({
                  message: 'Error occurred while compressing',
                  error,
                  moduleInfo,
                  filePath: file.pPath
               });
            } else {
               taskParameters.metrics.storeWorkerTime('compress', result.timestamp);

               const newGzipFile = file.clone();
               newGzipFile.pPath = `${file.pPath}.gz`;
               newGzipFile.contents = Buffer.from(result.gzip);
               this.push(newGzipFile);

               const newBrotliFile = file.clone();
               newBrotliFile.pPath = `${file.pPath}.br`;
               newBrotliFile.contents = Buffer.from(result.brotli);
               this.push(newBrotliFile);
            }
         } catch (error) {
            logger.error({
               message: "Builder's error occurred in 'compress' task",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         callback();
      }
   );
};
