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
   const shouldCopyFiles = (
      !moduleInfo.forceRebuild &&
      taskParameters.filesToCopy.hasOwnProperty(moduleInfo.outputName)
   );

   gulpSrcOptions.allowEmpty = true;

   if (!shouldCopyFiles) {
      return [
         path.join(moduleInfo.output, '/**/*.*'),
         path.join(moduleInfo.output, '/.*/*.*')
      ];
   }

   const inputToRead = [];

   taskParameters.filesToCopy[moduleInfo.outputName].forEach(
      (relFilePath) => {
         inputToRead.push(path.join(moduleInfo.output, relFilePath));
      }
   );

   gulpSrcOptions.base = moduleInfo.output;

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
         .pipe(gulpIf(!config.sources, copySources(taskParameters, moduleInfo)))
         .pipe(gulp.dest(moduleOutput));
   };
}

function getCopyResourcesTasksFlow(taskParameters) {
   const { config } = taskParameters;
   const symlinkTasks = [];
   const buildTasks = [];
   const modulesMeta = getTasksTypesByModules(config.modules, true, config.watcherChangedFiles);

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
