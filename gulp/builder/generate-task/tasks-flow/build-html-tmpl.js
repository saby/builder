'use strict';

const { getTasksTypesByModules, fillEmptyTasksFlows } = require('../../../common/compiled-helpers');
const gulp = require('gulp');
const { path } = require('../../../../lib/platform/path');
const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const gulpBuildHtmlTmpl = require('../../plugins/build-html-tmpl');
const gulpIf = require('gulp-if');
const versionizeToStub = require('../../plugins/versionize-to-stub');
const createVersionedModules = require('../../plugins/create-versioned-modules');
const createCdnModules = require('../../plugins/create-cdn-modules');
const gulpRename = require('gulp-rename');
const transliterate = require('../../../../lib/transliterate');
const gulpChmod = require('gulp-chmod');
const { needSymlink } = require('../../../common/helpers');
const logger = require('../../../../lib/logger').logger();
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');

function skipBuildHtmlTmpl(done) {
   done();
}

function generateTaskForBuildInModule(taskParameters, moduleInfo) {
   return function buildHtmlTmpl() {
      const { config } = taskParameters;
      const gulpSrcOptions = { dot: false, nodir: true };
      const templatesFileModeOptions = { read: true, write: true };
      const generateVersionMeta = !!moduleInfo.version && !taskParameters.config.localStand;

      return (
         gulp
            .src(path.join(moduleInfo.path, '/**/*.html.tmpl'), gulpSrcOptions)
            .pipe(handlePipeException('buildHtmlTmpl', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(gulpBuildHtmlTmpl(taskParameters, moduleInfo))
            .pipe(gulpIf(!!moduleInfo.version && config.isReleaseMode, versionizeToStub(taskParameters, moduleInfo)))
            .pipe(gulpIf(generateVersionMeta, createVersionedModules(taskParameters, moduleInfo)))
            .pipe(gulpIf(generateVersionMeta, createCdnModules(taskParameters, moduleInfo)))
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(gulpChmod(templatesFileModeOptions))
            .pipe(
               gulpIf(
                  needSymlink(taskParameters, config, moduleInfo, taskParameters.cache.isFirstBuild()),
                  gulp.symlink(moduleInfo.output),
                  gulp.dest(moduleInfo.output)
               )
            )
      );
   };
}

function createTaskPrintPercentComplete(modulesForBuild) {
   let countCompletedModules = 0;

   return function printPercentComplete(done) {
      countCompletedModules += 1;
      logger.progress(100 * countCompletedModules / modulesForBuild.length);
      done();
   };
}

function getBuildHtmlTasksFlow(taskParameters, modulesForBuild) {
   const printPercentComplete = createTaskPrintPercentComplete(modulesForBuild);
   const modulesMeta = getTasksTypesByModules(modulesForBuild);
   const skipTasks = [];
   const buildTasks = [];

   modulesMeta.skip.forEach(() => {
      skipTasks.push(skipBuildHtmlTmpl);
   });
   modulesMeta.build.forEach((moduleInfo) => {
      if (!moduleInfo.htmlWml) {
         return;
      }

      buildTasks.push(
         gulp.series(
            generateTaskForBuildInModule(taskParameters, moduleInfo),
            printPercentComplete
         )
      );
   });

   return fillEmptyTasksFlows({ skipTasks, buildTasks });
}

module.exports = {
   skipBuildHtmlTmpl,
   getBuildHtmlTasksFlow
};
