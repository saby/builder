/**
 * @author Kolbeshin F.A.
 */
'use strict';

const { path } = require('../../../../lib/platform/path');
const gulp = require('gulp');

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const pluginPackHtml = require('../../plugins/pack-html');
const packInlineScripts = require('../../plugins/pack-inline-scripts');
const { getTasksTypesByModules, fillEmptyTasksFlows } = require('../../../common/compiled-helpers');
const gulpIf = require('gulp-if');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');

function skipPackHtml(done) {
   done();
}

function generatePackHtml(taskParameters, depGraph, moduleInfo) {
   const moduleOutput = path.join(taskParameters.config.rawConfig.output, path.basename(moduleInfo.output));
   const input = path.join(moduleOutput, '/**/*.html');

   return function packHtml() {
      return gulp
         .src(input, { dot: false, nodir: true })
         .pipe(handlePipeException('packHtml', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(gulpIf(
            taskParameters.config.deprecatedStaticHtml,
            pluginPackHtml(taskParameters, moduleInfo, depGraph)
         ))
         .pipe(gulpIf(
            !taskParameters.config.inlineScripts,
            packInlineScripts(taskParameters, moduleInfo)
         ))
         .pipe(gulp.dest(moduleOutput));
   };
}

/**
 * Generation of the task for static html pages packing.
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @returns {Undertaker.TaskFunction|function(done)} returns an empty function in case of un-appropriate flags to
 * avoid gulp unexpected completion with errors.
 */
function getPackHtmlTasksFLow(taskParameters, depGraph) {
   const skipTasks = [];
   const buildTasks = [];
   const modulesMeta = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      taskParameters.config.watcherChangedFiles
   );

   modulesMeta.skip.forEach(() => {
      skipTasks.push(skipPackHtml);
   });
   modulesMeta.build.forEach((moduleInfo) => {
      buildTasks.push(generatePackHtml(taskParameters, depGraph, moduleInfo));
   });

   return fillEmptyTasksFlows({ skipTasks, buildTasks });
}

module.exports = { getPackHtmlTasksFLow, skipPackHtml };
