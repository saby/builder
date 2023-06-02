'use strict';

const fs = require('fs-extra');
const path = require('path');
const gulp = require('gulp');

function generatePrepareWorkspace(taskParameters) {
   const { changedFilesOutput } = taskParameters.config;
   return function prepareWorkspace() {
      return fs.remove(changedFilesOutput);
   };
}

function generateCopyModule(from, to) {
   return function copyModule() {
      return fs.copy(from, to);
   };
}

function skipCopyModules(done) {
   done();
}

module.exports = function generateTaskForCopyModulesList(taskParameters) {
   if (!taskParameters.config.changedFilesOutput) {
      return skipCopyModules;
   }

   const tasks = [];
   const compiledRoot = taskParameters.config.rawConfig.output;
   const { changedFilesOutput } = taskParameters.config;
   const modulesForPatch = taskParameters.config.getModulesForPatch();

   if (modulesForPatch.length === 0) {
      return skipCopyModules;
   }

   for (const moduleInfo of modulesForPatch) {
      tasks.push(
         generateCopyModule(
            path.join(compiledRoot, moduleInfo.outputName),
            path.join(changedFilesOutput, moduleInfo.outputName)
         )
      );
   }

   return gulp.series(
      generatePrepareWorkspace(taskParameters),
      gulp.parallel(tasks)
   );
};
