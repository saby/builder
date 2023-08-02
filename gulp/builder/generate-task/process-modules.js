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

function generateSavePatchedModules(taskParameters, modulesForPatch) {
   return async function savePatchedModules() {
      await pMap(
         modulesForPatch,
         async(moduleInfo) => {
            const compiledRoot = taskParameters.config.rawConfig.output;
            const { changedFilesOutput } = taskParameters.config;

            // В случае, если мы имеем в патченном модуле изменения, нам нужно сначала переместить результат
            // сборки патча в директорию с результатами сборки патча, а после этого на его место переместить
            // версию из stable билда. Так мы обеспечим отсутствие конфликтов в следующем сценарии:
            // 1) Собирают патч 1 на stable билде 10(например). В нём меняют ModuleA. В патче оказались изменения
            // ModuleA, всё отлично, патч корректный.
            // 2) Собирают патч 2 также на stable билде 10. В нём меняют ModuleB(но от него зависит ModuleA).
            // Как итог в патч попадёт ModuleB, а также результаты сборки предыдущего патча - ModuleA(а не должен,
            // он не менялся в этом патче, конфликт).
            // И чтобы такой ситуации не было, мы будем хранить stable состояние модуля и класть его на место после
            // отработки патча. Как итог - мы сможем делать сколько угодно патчей на одном stable билде и не будем
            // получать такие конфликты.
            if (moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0) {
               const stableCompiledModulePath = path.join(compiledRoot, `${moduleInfo.outputName}_stable`);
               const stableVersionExists = await fs.pathExists(stableCompiledModulePath);

               await execInPool(
                  taskParameters.pool,
                  'doAsyncFs',
                  [
                     stableVersionExists ? 'move' : 'copy',
                     path.join(compiledRoot, moduleInfo.outputName),
                     path.join(changedFilesOutput, moduleInfo.outputName),
                     true
                  ]
               );

               if (stableVersionExists) {
                  await execInPool(
                     taskParameters.pool,
                     'doAsyncFs',
                     [
                        'move',
                        stableCompiledModulePath,
                        path.join(compiledRoot, `${moduleInfo.outputName}`),
                        true
                     ]
                  );
               }
            } else {
               await execInPool(
                  taskParameters.pool,
                  'doAsyncFs',
                  [
                     'copy',
                     path.join(compiledRoot, moduleInfo.outputName),
                     path.join(changedFilesOutput, moduleInfo.outputName)
                  ]
               );
            }
         }
      );
   };
}

function generateSaveStableModules(taskParameters, stableModules) {
   return async function saveStableModules() {
      await pMap(
         stableModules,
         async(moduleInfo) => {
            const compiledRoot = taskParameters.config.rawConfig.output;

            // В случае, если мы имеем в патченном модуле изменения, нам нужно сначала переместить результат
            // сборки патча в директорию с результатами сборки патча, а после этого на его место переместить
            // версию из stable билда. Так мы обеспечим отсутствие конфликтов в следующем сценарии:
            // 1) Собирают патч 1 на stable билде 10(например). В нём меняют ModuleA. В патче оказались изменения
            // ModuleA, всё отлично, патч корректный.
            // 2) Собирают патч 2 также на stable билде 10. В нём меняют ModuleB(но от него зависит ModuleA).
            // Как итог в патч попадёт ModuleB, а также результаты сборки предыдущего патча - ModuleA(а не должен,
            // он не менялся в этом патче, конфликт).
            // И чтобы такой ситуации не было, мы будем хранить stable состояние модуля и класть его на место после
            // отработки патча. Как итог - мы сможем делать сколько угодно патчей на одном stable билде и не будем
            // получать такие конфликты.
            const stableCompiledModulePath = path.join(compiledRoot, `${moduleInfo.outputName}_stable`);

            await execInPool(
               taskParameters.pool,
               'doAsyncFs',
               [
                  'copy',
                  path.join(compiledRoot, moduleInfo.outputName),
                  stableCompiledModulePath,
                  true
               ]
            );
         }
      );
   };
}

function skipProcessModules(done) {
   done();
}

function generateTaskSavePatchedModules(taskParameters) {
   if (!taskParameters.config.changedFilesOutput) {
      return skipProcessModules;
   }

   const modulesForPatch = taskParameters.config.getModulesForPatch();

   if (modulesForPatch.length === 0) {
      return skipProcessModules;
   }

   const copyModules = taskParameters.metrics.createTimer('save patched modules');
   return gulp.series(
      copyModules.start(),
      generatePrepareWorkspace(taskParameters),
      generateSavePatchedModules(taskParameters, modulesForPatch),
      copyModules.finish(),
   );
}

function generateTaskSaveStableModules(taskParameters) {
   if (!taskParameters.config.changedFilesOutput) {
      return skipProcessModules;
   }

   const modulesForPatch = taskParameters.config.getModulesForPatch();
   const modulesWithChangedFiles = modulesForPatch.filter(
      moduleInfo => moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0
   );

   if (modulesWithChangedFiles.length === 0) {
      return skipProcessModules;
   }

   const copyModules = taskParameters.metrics.createTimer('save stable modules');
   return gulp.series(
      copyModules.start(),
      generateSaveStableModules(taskParameters, modulesWithChangedFiles),
      copyModules.finish(),
   );
}

module.exports = {
   generateTaskSavePatchedModules,
   generateTaskSaveStableModules
};
