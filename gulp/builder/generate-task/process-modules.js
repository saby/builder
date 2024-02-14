'use strict';

const fs = require('fs-extra');
const pMap = require('p-map');
const gulp = require('gulp');
const path = require('path');
const execInPool = require('../../common/exec-in-pool');

function generatePrepareWorkspace(taskParameters) {
   const { changedFilesOutput } = taskParameters.config;
   return async function prepareWorkspace() {
      await fs.remove(changedFilesOutput);

      // прежде всего нам необходимо весь региональный output сохранить в конечную директорию,
      // jinnee при сборке патча смотрит именно в конечную директорию сборки патча и если
      // потребуется патч на региональный дистрибутив и будут задеты модули с региональными ресурсами
      // нам важно обеспечить наличие всех региональных ресурсов для данного модуля из основного output
      // в output для сборки патча. А потом при сборке патча, если будут патчиться непосредственно региональные
      // ресурсы, их результат запишется уже напрямую в региональную директорию для результатов сборки патча.
      await pMap(
         taskParameters.config.countries,
         async(country) => {
            if (country === 'RU') {
               return;
            }

            const commonRegionOutput = `${taskParameters.config.outputPath}_${country}`;
            const patchRegionOutput = `${taskParameters.config.changedFilesOutput}_${country}`;

            if (await fs.pathExists(commonRegionOutput)) {
               await fs.copy(commonRegionOutput, patchRegionOutput);
            }
         }
      );
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
            await execInPool(
               taskParameters.pool,
               'doAsyncFs',
               [
                  'copy',
                  path.join(compiledRoot, moduleInfo.outputName),
                  path.join(compiledRoot, `${moduleInfo.outputName}_stable`),
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
      generateSavePatchedModules(taskParameters, modulesForPatch),
      copyModules.finish()
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

   const copyModules = taskParameters.metrics.createTimer('save stable modules');
   if (modulesWithChangedFiles.length === 0) {
      return gulp.series(
         copyModules.start(),
         generatePrepareWorkspace(taskParameters),
         copyModules.finish()
      );
   }

   return gulp.series(
      copyModules.start(),
      generatePrepareWorkspace(taskParameters),
      generateSaveStableModules(taskParameters, modulesWithChangedFiles),
      copyModules.finish()
   );
}

module.exports = {
   generateTaskSavePatchedModules,
   generateTaskSaveStableModules
};
