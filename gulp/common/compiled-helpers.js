/**
 * Additional functions for compiled modules build
 * @author Kolbeshin F.A.
 */
'use strict';

const { path } = require('../../lib/platform/path');
const fs = require('fs-extra');
const gulp = require('gulp');

function getCompiledPath(taskParameters, moduleInfo) {
   const { compiled } = taskParameters.config;

   // if path was transmitted as sources path and common compiled folder
   // is selected in current build, get path from compiled folder instead of
   // sources
   if (compiled && moduleInfo.path.startsWith(taskParameters.config.sourcesDirectory)) {
      return path.join(compiled, moduleInfo.outputName);
   }
   return moduleInfo.path;
}

function generateTaskForSymlinkCompiled(taskParameters, moduleInfo, moduleOutput) {
   return async function symlinkCompiledModule() {
      const compiledPath = getCompiledPath(taskParameters, moduleInfo);

      try {
         const stats = await fs.lstat(moduleOutput);
         if (stats.isSymbolicLink()) {
            await fs.unlink(moduleOutput);
         } else {
            await fs.remove(moduleOutput);
         }
      } catch (e) {
         // nothing to do
      }

      await fs.ensureSymlink(compiledPath, moduleOutput);
   };
}

/**
 * Get tasks types by interface modules meta
 * should it be skipped or copied, or should be built
 * @param{Array} modules list of modules of current project
 * @param{boolean} needToSymlinkCompiled select whether compiled module should be skipped or created symlink to compiled
 * needed for tasks, that works with already built or copied interface module
 */
function getTasksTypesByModules(modules, needToSymlinkCompiled) {
   const meta = {
      skip: [],
      build: [],
      symlink: []
   };

   for (const moduleInfo of modules) {
      if (moduleInfo.compiled && typeof moduleInfo.compiled === 'boolean') {
         if (needToSymlinkCompiled) {
            meta.symlink.push(moduleInfo);
         } else {
            meta.skip.push(moduleInfo);
         }
      } else {
         meta.build.push(moduleInfo);
      }
   }

   return meta;
}

/**
 * gets gulp order of tasks to execute.
 * Returns series of parallel flows of tasks(symlink/skip first, second is build),
 * if there are any skip/symlink tasks to execute, otherwise returns parallel
 * flow of build tasks
 * @param{Array} firstQueue first queue of tasks to execute
 * @param{Array} secondQueue second queue of tasks to execute
 * @returns {*}
 */
function getParallelTasksOrderByQueue(firstQueue, secondQueue) {
   if (firstQueue.length > 0) {
      return gulp.series(
         gulp.parallel(firstQueue),
         gulp.parallel(secondQueue)
      );
   }
   return gulp.parallel(secondQueue);
}

function fillEmptyTasksFlows(tasksFlows) {
   const result = {};
   Object.keys(tasksFlows).forEach((current) => {
      if (tasksFlows[current].length === 0) {
         result[current] = [done => done()];
      } else {
         result[current] = tasksFlows[current];
      }
   });
   return result;
}

module.exports = {
   generateTaskForSymlinkCompiled,
   getTasksTypesByModules,
   getParallelTasksOrderByQueue,
   fillEmptyTasksFlows
};
