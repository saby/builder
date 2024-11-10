'use strict';

const gulp = require('gulp');
const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');

const generateTaskForBuildHtmlTmpl = require('./build-html-tmpl');
const { generateRouterContent } = require('../../common/generate-task/save-joined-meta');

function generateTaskForMetaFiles(taskParameters) {
   return async function createMetaFiles() {
      const routerContent = generateRouterContent({}, taskParameters.config.generateUMD);

      await fs.outputFile(
         path.join(taskParameters.config.outputPath, 'router.js'),
         routerContent
      );
   };
}

function generateTaskForDependantBuild(taskParameters) {
   const dependantBuild = taskParameters.metrics.createTimer('build html.tmpl');

   return gulp.series(
      dependantBuild.start(),
      generateTaskForMetaFiles(taskParameters),
      generateTaskForBuildHtmlTmpl(taskParameters),
      dependantBuild.finish()
   );
}

module.exports = generateTaskForDependantBuild;
