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
   generateDownloadModuleCache,
   generateSaveModuleCache
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
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction}
 */
function getBuildModulesTasksFlow(taskParameters) {
   const { config } = taskParameters;
   const modulesForPatch = config.getModulesForPatch();
   const modulesForBuild = modulesForPatch.length > 0 ? modulesForPatch : config.modules;
   const modulesMap = createModulesMap(config.modules);
   const progress = new Progress();
   const compile = [];
   const build = [];
   const symlink = [];
   const downloadCache = [];
   const saveCache = [];
   const modulesMeta = getTasksTypesByModules(modulesForBuild, true);
   modulesMeta.build.forEach((moduleInfo) => {
      downloadCache.push(generateDownloadModuleCache(taskParameters, moduleInfo));
      saveCache.push(generateSaveModuleCache(taskParameters, moduleInfo));
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
      downloadCache,
      saveCache
   });
}

module.exports = getBuildModulesTasksFlow;
