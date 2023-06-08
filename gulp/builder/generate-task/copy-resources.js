/**
 * Генерация завершающий задачи для Release сборки. Всё что, нельзя делать инкрементально из-за версионирования.
 * @author Kolbeshin F.A.
 */

'use strict';
const gulp = require('gulp');
const { getParallelTasksOrderByQueue } = require('../../common/compiled-helpers');

const getCopyResourcesTasksFlow = require('./tasks-flow/copy-resources');

/**
 * Генерация завершающий задачи для Release сборки.
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCopyResources(taskParameters) {
   if (taskParameters.config.outputIsCache) {
      return function skipFinalizeDistrib(done) {
         done();
      };
   }

   const { config } = taskParameters;
   const modulesToCopy = config.modulesForPatch.length > 0 ? config.modulesForPatch.filter(
      moduleInfo => !moduleInfo.removeFromPatchOutput
   ) : config.modules;

   const { symlinkTasks, buildTasks } = getCopyResourcesTasksFlow(taskParameters, modulesToCopy);

   const copyResources = taskParameters.metrics.createTimer('copy resources');
   return gulp.series(
      copyResources.start(),
      getParallelTasksOrderByQueue(symlinkTasks, buildTasks),
      copyResources.finish()
   );
}

module.exports = generateTaskForCopyResources;
