/**
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const logger = require('../../../lib/logger').logger();

const { path } = require('../../../lib/platform/path');
const { getTasksTypesByModules } = require('../../common/compiled-helpers');

const execInPool = require('../../common/exec-in-pool');
const TailwindTreeShaker = require('../../../lib/tailwind/tree-shaker');

function skipBuildTailwindCss(done) {
   done();
}

function generateTaskForScanningTailwind(taskParameters, tailwindModule) {
   return async function scanningTailwindModule() {
      try {
         const filePath = path.join(tailwindModule.path, 'tailwind.css');
         const tailwindCssContents = await fs.readFile(filePath, 'utf8');
         const shaker = new TailwindTreeShaker();

         shaker.shake(tailwindCssContents);

         tailwindModule.tailwindCssSnapshot = shaker.root;
      } catch (error) {
         // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
         logger.warning({
            message: `Error processing Tailwind/tailwind.css: ${error.message}`,
            moduleInfo: tailwindModule,
            error
         });
      }
   };
}

function generateTaskForBuildSingleModule(taskParameters, tailwindModule, moduleInfo) {
   return async function buildCustomTailwind() {
      try {
         const [error, result] = await execInPool(
            taskParameters.pool,
            'generateTailwind',
            [
               tailwindModule.tailwindCssSnapshot,
               tailwindModule.path,
               moduleInfo.path
            ],
            '',
            moduleInfo
         );

         if (error) {
            // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
            logger.warning({
               message: `Error building Tailwind CSS: ${error.message}`,
               moduleInfo,
               error
            });

            return;
         }

         taskParameters.metrics.storeWorkerTime('tailwindcss', result.timestamp);

         if (result.text) {
            logger.debug(`Generate custom ${moduleInfo.name}/tailwind.css file with ${result.classSelectors.length} selector(s)`);

            moduleInfo.tailwindInfo = {
               dependency: `css!${moduleInfo.outputName}/tailwind`,
               outputFile: path.join(moduleInfo.path, 'tailwind.css'),
               outputFileContents: result.text,
               selectors: result.classSelectors
            };
         }
      } catch (error) {
         // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
         logger.warning({
            message: `Error generating Tailwind CSS: ${error.message}`,
            moduleInfo,
            error
         });
      }
   };
}

function generateTaskForBuildTailwindCss(taskParameters) {
   if (!taskParameters.config.buildTailwindCss) {
      return skipBuildTailwindCss;
   }

   const tailwindModule = taskParameters.config.modules.find(moduleInfo => moduleInfo.name === 'Tailwind');
   if (!tailwindModule) {
      return skipBuildTailwindCss;
   }

   const { build } = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      taskParameters.config.watcherRunning
   );

   const tasks = build
      .filter(moduleInfo => moduleInfo.depends.includes('Tailwind'))
      .map(moduleInfo => generateTaskForBuildSingleModule(taskParameters, tailwindModule, moduleInfo));

   if (tasks.length === 0) {
      return skipBuildTailwindCss;
   }

   const buildTailwindCss = taskParameters.metrics.createTimer('build tailwind');

   return gulp.series(
      buildTailwindCss.start(),
      generateTaskForScanningTailwind(taskParameters, tailwindModule),
      gulp.parallel(tasks),
      buildTailwindCss.finish()
   );
}

module.exports = generateTaskForBuildTailwindCss;
