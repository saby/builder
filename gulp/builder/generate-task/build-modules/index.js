/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const {
   getParallelTasksOrderByQueue
} = require('../../../common/compiled-helpers');
const getBuildModulesTasksFlow = require('../tasks-flow/build-modules');

/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForBuildModules(taskParameters) {
   const {
      compile,
      build,
      symlink,
      downloadCache,
      saveCache
   } = getBuildModulesTasksFlow(taskParameters);

   const buildModule = taskParameters.metrics.createTimer('build modules');
   return gulp.series(
      buildModule.start(),
      gulp.parallel(downloadCache),
      getParallelTasksOrderByQueue(symlink, compile),
      gulp.parallel(build),
      gulp.parallel(saveCache),
      buildModule.finish()
   );
}

module.exports = generateTaskForBuildModules;
