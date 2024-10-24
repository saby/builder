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
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForBuildModules(taskParameters) {
   const {
      compile,
      symlink,
      readModuleCache,
      postProcessModule,
      chunkSeries
   } = getBuildModulesTasksFlow(taskParameters);

   const buildModule = taskParameters.metrics.createTimer('build modules');
   return gulp.series(
      buildModule.start(),
      gulp.parallel(readModuleCache),
      getParallelTasksOrderByQueue(symlink, compile),
      gulp.parallel(postProcessModule),
      chunkSeries,
      buildModule.finish()
   );
}

module.exports = generateTaskForBuildModules;
