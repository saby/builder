/**
 * Генерация задачи архивации для файлов
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const compressPlugin = require('../plugins/compress');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const { getModuleInputForCompress } = require('../../../lib/changed-files/get-module-input');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');

/**
 * Save hash by content of minified files to be used in incremental build.
 * @param {TaskParameters} taskParameters - a whole parameters list for current project build.
 * @returns {saveCompressArtifacts}
 */
function postProcessCompressTask(taskParameters) {
   return async function saveCompressArtifacts() {
      await fs.outputJson(path.join(taskParameters.config.cachePath, 'cached-minified.json'), taskParameters.cache.getCachedMinified());
   };
}

/**
 * Генерация задачи архивации для файлов
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCompress(taskParameters) {
   // for local stands there is no practical need of using archives, it just increases build time.
   if (!taskParameters.config.compress) {
      return function skipCompress(done) {
         done();
      };
   }

   const tasks = taskParameters.config.modules.map((moduleInfo) => {
      const moduleOutput = path.join(taskParameters.config.rawConfig.output, path.basename(moduleInfo.output));

      return function compress() {
         return gulp
            .src(
               getModuleInputForCompress(
                  taskParameters,
                  moduleInfo.outputName,
                  moduleOutput
               ), {
                  dot: false,
                  nodir: true,
                  allowEmpty: true,
                  base: moduleOutput
               }
            )
            .pipe(handlePipeException('compress', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(compressPlugin(taskParameters, moduleInfo))
            .pipe(gulp.dest(moduleOutput));
      };
   });

   const compressTask = taskParameters.metrics.createTimer('compress');
   return gulp.series(
      compressTask.start(),
      gulp.parallel(tasks),
      postProcessCompressTask(taskParameters),
      compressTask.finish()
   );
}

module.exports = generateTaskForCompress;
