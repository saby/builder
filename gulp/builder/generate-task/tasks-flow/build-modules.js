/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const { BUILDER_CHUNK_LENGTH } = process.env;
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

class TasksFlow {
   constructor() {
      this.chunks = {};
      this.chunkCounter = 1;
      this.taskCount = 0;
   }

   // добавляет задачу в кучу, кучи формируются исходя из заданного
   // параметра BUILDER_CHUNK_LENGTH
   addTask(currentTask) {
      this.taskCount++;
      const chunkIndex = Math.floor(this.taskCount / BUILDER_CHUNK_LENGTH) + 1;

      const chunkName = `chunk${chunkIndex}`;

      if (!this.chunks[chunkName]) {
         this.chunks[chunkName] = [];
      }

      this.chunks[chunkName].push(currentTask);
   }

   // формирует задачу, которая последовательно исполняет
   // каждую кучу, в каждой из которых в параллель собираются
   // описанные в куче задачи.
   getChunkSeries() {
      const parallelChunks = [];

      Object.keys(this.chunks).forEach((currentChunk) => {
         parallelChunks.push(
            gulp.parallel(this.chunks[currentChunk])
         );
      });

      if (parallelChunks.length === 0) {
         return [];
      }
      return gulp.series(...parallelChunks);
   }
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
   const symlink = [];
   const readModuleCache = [];
   const postProcessModule = [];
   const modulesMeta = getTasksTypesByModules(
      taskParameters.config.modules,
      true,
      taskParameters.config.watcherRunning
   );

   // set a sign of patch build to get a whole module cache
   // for instance, es compile cache and markup cache, for proper library packing
   const isWatcherMode = !!taskParameters.config.watcherRunning;
   const tasksFlow = new TasksFlow();

   modulesMeta.symlink.forEach((moduleInfo) => {
      const symlinkTask = gulp.series(
         generateTaskForSymlinkCompiled(taskParameters, moduleInfo, moduleInfo.output),
         progress.generatePrintProgressTask()
      );

      if (moduleInfo.required || !BUILDER_CHUNK_LENGTH) {
         symlink.push(symlinkTask);
      } else {
         tasksFlow.addTask(symlinkTask);
      }
   });

   modulesMeta.build.forEach((moduleInfo) => {
      const readCacheTask = generateReadModuleCache(taskParameters, moduleInfo, isWatcherMode);
      const compileTask = gulp.series(
         genTaskForCompileSingleModule(taskParameters, moduleInfo),
         progress.generatePrintProgressTask()
      );
      const buildTask = gulp.series(
         generateTaskForBuildSingleModule(taskParameters, moduleInfo, modulesMap),
         progress.generatePrintProgressTask()
      );
      const writeCacheTask = generateWriteModuleCache(taskParameters, moduleInfo);

      // прежде чем нам параллельно и независимо собирать весь прикладной код, нам нужно сначала
      // собрать именно required модули, поскольку в них собирается код для шаблонизатора и других функций
      // и в параллель и независимо вместе с остальным прикладным кодом данный функционал, к сожалению,
      // собираться не может. А также пока выносим функционал с кучами под фичу, поскольку основным потребителем
      // такого функционала будет только проект online-inside, где 1400+ интерфейсных модулей, а также особенно
      // online-ie, где помимо основного инсайда включены все внешние сервисы.
      if (moduleInfo.required || !BUILDER_CHUNK_LENGTH) {
         readModuleCache.push(readCacheTask);

         // завершающей будет последовательность задач сборки модуля и сохранения кеша
         // поскольку нам не нужно, чтобы мы дожидались сборки всех модулей проекта, чтобы
         // сохранить помодульный кеш.
         postProcessModule.push(
            gulp.series(
               buildTask,
               writeCacheTask
            )
         );
         compile.push(compileTask);
      } else {
         tasksFlow.addTask(
            gulp.series(
               readCacheTask,
               compileTask,
               buildTask,
               writeCacheTask
            )
         );
      }
   });

   return fillEmptyTasksFlows({
      compile,
      postProcessModule,
      symlink,
      readModuleCache,
      chunkSeries: tasksFlow.getChunkSeries()
   });
}

module.exports = getBuildModulesTasksFlow;
