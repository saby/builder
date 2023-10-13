/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const generateTaskForBuildSingleModule = require('../build-modules/build');
const genTaskForCompileSingleModule = require('../build-modules/compile');
const Progress = require('../build-modules/progress');
const {
   generateTaskForSymlinkCompiled,
   getTasksTypesByModules,
   fillEmptyTasksFlows
} = require('../../../common/compiled-helpers');
const {
   generateReadModuleCache,
   generateWriteModuleCache
} = require('../../classes/modules-cache');

function createModulesMap(modules) {
   const modulesMap = new Map();

   for (const moduleInfo of modules) {
      modulesMap.set(moduleInfo.name, moduleInfo.path);
   }

   return modulesMap;
}

/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @returns {Undertaker.TaskFunction}
 */
function getBuildModulesTasksFlow(taskParameters) {
   const modulesMap = createModulesMap(taskParameters.config.modules);
   const progress = new Progress();
   const compile = [];
   const build = [];
   const symlink = [];
   const readModuleCache = [];
   const writeModuleCache = [];
   const modulesMeta = getTasksTypesByModules(
      taskParameters.config.modules,
      true,
      taskParameters.config.watcherRunning
   );

   // set a sign of patch build to get a whole module cache
   // for instance, es compile cache and markup cache, for proper library packing
   const isWatcherMode = !!taskParameters.config.watcherRunning;
   modulesMeta.build.forEach((moduleInfo) => {
      readModuleCache.push(generateReadModuleCache(taskParameters, moduleInfo, isWatcherMode));
      writeModuleCache.push(generateWriteModuleCache(taskParameters, moduleInfo));
   });

   modulesMeta.symlink.forEach((moduleInfo) => {
      symlink.push(
         gulp.series(
            generateTaskForSymlinkCompiled(taskParameters, moduleInfo, moduleInfo.output),
            progress.generatePrintProgressTask()
         )
      );
   });
   modulesMeta.build.forEach((moduleInfo) => {
      compile.push(gulp.series(
         genTaskForCompileSingleModule(taskParameters, moduleInfo),
         progress.generatePrintProgressTask()
      ));
      build.push(
         gulp.series(
            generateTaskForBuildSingleModule(taskParameters, moduleInfo, modulesMap),
            progress.generatePrintProgressTask()
         )
      );
   });

   return fillEmptyTasksFlows({
      compile,
      build,
      symlink,
      readModuleCache,
      writeModuleCache
   });
}

module.exports = getBuildModulesTasksFlow;
