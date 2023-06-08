'use strict';

const gulp = require('gulp');
const workspace = require('./workspace');
const compile = require('./compile');
const analyzeReport = require('./analyze-report');
const { path, cwd } = require('../../../../lib/platform/path');

function skipEmitTypescript(done) {
   done();
}

function getLogFilePath(taskParameters, output) {
   const logFolder = taskParameters.config.logFolder || cwd();
   return output || path.join(logFolder, 'builder_compilation_errors.log');
}

function generateTaskForTypescript(taskParameters, output) {
   if (!taskParameters.config.emitTypescript) {
      return skipEmitTypescript;
   }

   const runTypescriptCompiler = taskParameters.metrics.createTimer('emit typescript');
   const logFile = getLogFilePath(taskParameters, output);

   return gulp.series(
      runTypescriptCompiler.start(),
      workspace.prepare(taskParameters),
      compile(taskParameters, logFile),
      analyzeReport(taskParameters, logFile),
      workspace.clean(taskParameters),
      runTypescriptCompiler.finish()
   );
}

module.exports = generateTaskForTypescript;
