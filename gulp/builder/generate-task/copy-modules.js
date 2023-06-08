'use strict';

const fs = require('fs-extra');
const pMap = require('p-map');
const gulp = require('gulp');
const path = require('path');
const execInPool = require('../../common/exec-in-pool');

function generatePrepareWorkspace(taskParameters) {
   const { changedFilesOutput } = taskParameters.config;
   return function prepareWorkspace() {
      return fs.remove(changedFilesOutput);
   };
}

function generateCopyModules(taskParameters, modulesForPatch) {
   return async function copyModules() {
      await pMap(
         modulesForPatch,
         async(moduleInfo) => {
            const compiledRoot = taskParameters.config.rawConfig.output;
            const { changedFilesOutput } = taskParameters.config;

            await execInPool(
               taskParameters.pool,
               'copyModule',
               [
                  path.join(compiledRoot, moduleInfo.outputName),
                  path.join(changedFilesOutput, moduleInfo.outputName)
               ]
            );
         }
      );
   };
}

function skipCopyModules(done) {
   done();
}

module.exports = function generateTaskForCopyModulesList(taskParameters) {
   if (!taskParameters.config.changedFilesOutput) {
      return skipCopyModules;
   }

   const modulesForPatch = taskParameters.config.getModulesForPatch();

   if (modulesForPatch.length === 0) {
      return skipCopyModules;
   }

   const copyModules = taskParameters.metrics.createTimer('copy modules to changed files output');
   return gulp.series(
      copyModules.start(),
      generatePrepareWorkspace(taskParameters),
      generateCopyModules(taskParameters, modulesForPatch),
      copyModules.finish(),
   );
};
