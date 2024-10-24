/**
 * Генерация задачи создания static_templates.json
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const gulp = require('gulp'),
   gulpChmod = require('gulp-chmod'),
   gulpIf = require('gulp-if');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const createStaticTemplatesJson = require('../plugins/create-static-templates-json');
const { needSymlink } = require('../../common/helpers');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');

function generateTaskForSingleModule(taskParameters, moduleInfo) {
   const { config } = taskParameters;
   const metaFileModeOptions = { read: true, write: true };
   const gulpSrcOptions = { dot: false, nodir: true };

   return function buildStaticTmplJson() {
      return (
         gulp
            .src(path.join(moduleInfo.path, '*.s3mod'), gulpSrcOptions)
            .pipe(handlePipeException('createStaticTemplateJson', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(gulpIf(!!moduleInfo.presentationServiceMeta, createStaticTemplatesJson(taskParameters, moduleInfo)))
            .pipe(gulpChmod(metaFileModeOptions))
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

function skipBuildStaticTmplJson(done) {
   done();
}

function generateTaskForStaticTmplJson(taskParameters) {
   const tasks = [];
   let taskSkipped = false;

   for (const moduleInfo of taskParameters.config.modules) {
      if (moduleInfo.compiled && typeof moduleInfo.compiled === 'boolean') {
         if (!taskSkipped) {
            tasks.push(skipBuildStaticTmplJson);
            taskSkipped = true;
         }
      } else {
         tasks.push(
            generateTaskForSingleModule(taskParameters, moduleInfo)
         );
      }
   }

   const buildModule = taskParameters.metrics.createTimer('createStaticTemplateJson');
   return gulp.series(
      buildModule.start(),
      gulp.parallel(tasks),
      buildModule.finish()
   );
}

module.exports = generateTaskForStaticTmplJson;
