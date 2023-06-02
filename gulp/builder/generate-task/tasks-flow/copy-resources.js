/**
 * Генерация завершающий задачи для Release сборки. Всё что, нельзя делать инкрементально из-за версионирования.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../../lib/platform/path');
const gulp = require('gulp'),
   gulpIf = require('gulp-if');

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const copySources = require('../../plugins/copy-sources'),
   versionizeFinish = require('../../plugins/versionize-finish'),
   {
      generateTaskForSymlinkCompiled,
      getTasksTypesByModules,
      fillEmptyTasksFlows
   } = require('../../../common/compiled-helpers');

const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');

/**
 * Get a list of files to be copied from cache folder into output.
 * Generate a fake glob pattern if there is nothing to copy(because each
 * interface module has at least 1 file to copy, e.g.
 * @param taskParameters
 * @param moduleInfo
 * @param gulpSrcOptions
 * @returns {*[]}
 */
function getInputToRead(taskParameters, moduleInfo, gulpSrcOptions) {
   const inputToRead = [];
   if (
      taskParameters.filesToCopy.hasOwnProperty(moduleInfo.outputName) &&
      !moduleInfo.forceRebuild
   ) {
      taskParameters.filesToCopy[moduleInfo.outputName].forEach((currentRelativePath) => {
         inputToRead.push(path.join(moduleInfo.output, currentRelativePath));
      });
      gulpSrcOptions.base = moduleInfo.output;
   } else {
      inputToRead.push(path.join(moduleInfo.output, '/**/*.*'));
      inputToRead.push(path.join(moduleInfo.output, '/.*/*.*'));
   }
   gulpSrcOptions.allowEmpty = true;
   return inputToRead;
}

function generateTask(taskParameters, config, moduleInfo) {
   const gulpSrcOptions = { dot: false, nodir: true };

   const moduleOutput = path.join(config.rawConfig.output, moduleInfo.outputName);
   return function copyResources() {
      return gulp
         .src(getInputToRead(taskParameters, moduleInfo, gulpSrcOptions), gulpSrcOptions)
         .pipe(handlePipeException('copyResources', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(gulpIf(!!config.version, versionizeFinish(taskParameters, moduleInfo)))
         .pipe(gulpIf(!config.sources, copySources(taskParameters, moduleInfo)))
         .pipe(gulp.dest(moduleOutput));
   };
}

function getCopyResourcesTasksFlow(taskParameters) {
   const { config } = taskParameters;
   const symlinkTasks = [];
   const buildTasks = [];
   const modulesMeta = getTasksTypesByModules(config.modules, true);

   modulesMeta.symlink.forEach((moduleInfo) => {
      const moduleOutput = path.join(config.rawConfig.output, moduleInfo.outputName);
      symlinkTasks.push(
         generateTaskForSymlinkCompiled(taskParameters, moduleInfo, moduleOutput)
      );
   });
   modulesMeta.build.forEach((moduleInfo) => {
      buildTasks.push(
         generateTask(taskParameters, config, moduleInfo)
      );
   });

   return fillEmptyTasksFlows({ symlinkTasks, buildTasks });
}

module.exports = getCopyResourcesTasksFlow;
