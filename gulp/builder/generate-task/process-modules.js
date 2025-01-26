'use strict';

const fs = require('fs-extra');
const pMap = require('p-map');
const gulp = require('gulp');
const path = require('path');
const execInPool = require('../../common/exec-in-pool');
const logger = require('../../../lib/logger').logger();

function generateRestoreStableModules(taskParameters, modulesForPatch) {
   return async function restoreStableModules() {
      await pMap(
         modulesForPatch,
         async(moduleInfo) => {
            const compiledRoot = taskParameters.config.rawConfig.output;

            // Имеем следующий сценарий сборки патча:
            // 1) Собирают патч 1 на stable билде 10(например). В нём меняют ModuleA. В патче оказались изменения
            // ModuleA, всё отлично, патч корректный.
            // 2) Собирают патч 2 также на stable билде 10. В нём меняют ModuleB(но от него зависит ModuleA).
            // Как итог в патч попадёт ModuleB, а также результаты сборки предыдущего патча - ModuleA(а не должен,
            // он не менялся в этом патче, конфликт).
            // И чтобы такой ситуации не было, мы будем при сборке патча сохранять stable состояние собранного модуля
            // и класть его на место при следующей сборке патча. Как итог - мы сможем делать сколько угодно патчей на
            // одном stable билде и не будем получать конфликтов между патчами.
            const stableCompiledModulePath = path.join(compiledRoot, `${moduleInfo.outputName}_stable`);
            const stableVersionExists = await fs.pathExists(stableCompiledModulePath);

            if (stableVersionExists) {
               // если stable-версия модуля уже была сохранена, пометим это в мета-описании модуля, чтобы
               // в случае, если этот же модуль патчится повторно в рамках нового патча, не сохранять по
               // второму разу stable-версию модуля, поскольку она уже существует
               moduleInfo.hasStableVersion = true;
               const moduleOutput = path.join(compiledRoot, `${moduleInfo.outputName}`);

               // прежде всего необходимо удалить пропатченный модуль из конечной директории, после чего можно
               // переместить на его место stable-версию
               await fs.remove(moduleOutput);
               logger.info(`removed "${moduleOutput}"`);

               // если ранее пропатченный модуль патчится снова, то stable версию модуля надо скопировать в основной
               // output, а не переместить, чтобы лишний раз не сохранять для будущих патчей stable-версию модуля.
               let fsOperation;
               if (moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0) {
                  fsOperation = 'copy';
               } else {
                  fsOperation = 'move';
               }

               await execInPool(
                  taskParameters.pool,
                  'doAsyncFs',
                  [
                     fsOperation,
                     stableCompiledModulePath,
                     moduleOutput,
                     true
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
         stableModules.filter(moduleInfo => !moduleInfo.hasStableVersion),
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

// данная таска выполняет 2 следующие задачи для подготовки к сборке патча:
// 1) восстанавливает stable-версии модулей из предыдущих сборок патчей, чтобы
// в артефактах сборки текущего патча не было артефактов из предыдущих сборок
// 2) сохраняет stable-версии изменяемых модулей в рамках текущей сборки патча
module.exports = function generateTaskProcessStableModules(taskParameters) {
   if (!taskParameters.config.changedFilesOutput) {
      return function skipProcessModules(done) {
         done();
      };
   }

   const modulesForPatch = taskParameters.config.getModulesForPatch();
   const modulesWithChangedFiles = modulesForPatch.filter(
      moduleInfo => moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0
   );

   const saveStable = taskParameters.metrics.createTimer('save stable modules');
   const restoreStable = taskParameters.metrics.createTimer('restore stable modules');

   return gulp.series(
      restoreStable.start(),
      generateRestoreStableModules(taskParameters, modulesForPatch),
      restoreStable.finish(),
      saveStable.start(),
      generateSaveStableModules(taskParameters, modulesWithChangedFiles),
      saveStable.finish(),
   );
};
