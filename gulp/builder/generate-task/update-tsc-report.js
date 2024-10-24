/**
 * Модуль, реализующий задачу обновления отчетов по ошибкам TypeScript.
 *
 * В данной задаче необходимая часть сообщений присоединяется к библиотеке, в которую входит проблемный файл.
 * Важно: информация о составе библиотек получена на основе скомпилированных файлов. В библиотеки не попадут
 * файлы с типами и интерфейсами.
 *
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');
const gulp = require('gulp');

const { path, cwd } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger();

async function getLibraryFiles(modules) {
   const libraries = new Map();
   const components = new Map();
   const files = new Map();

   const promises = modules.map(async(moduleInfo) => {
      const filePath = path.join(moduleInfo.output, '.cache', 'components-info.json');

      if (!(await fs.pathExists(filePath))) {
         return;
      }

      const json = await fs.readJSON(filePath);

      if (json.hasOwnProperty('componentsInfo')) {
         for (const fPath in json.componentsInfo) {
            if (json.componentsInfo.hasOwnProperty(fPath)) {
               const element = json.componentsInfo[fPath];

               if (!element.hasOwnProperty('componentName')) {
                  continue;
               }

               components.set(element.componentName, fPath);

               if (element.hasOwnProperty('libraryName')) {
                  libraries.set(element.componentName, element.packedModules);
               }
            }
         }
      }
   });

   const hasComponent = components.has.bind(components);
   const getFilePath = components.get.bind(components);

   await Promise.all(promises);

   libraries.forEach((packedModules, libraryName) => {
      const packedFiles = packedModules
         .filter(hasComponent)
         .map(getFilePath);

      libraries.set(libraryName, packedFiles);

      packedFiles.forEach(packedFilePath => files.set(packedFilePath, libraryName));
   });

   return {
      libraries,
      files
   };
}

function generateTaskForUpdateTscReport(taskParameters) {
   return async function updateTscReport() {
      if (!taskParameters.cache.shouldCreateTscReport()) {
         return;
      }

      const logsDir = taskParameters.config.logFolder || cwd();
      const reportsDir = path.join(logsDir, 'tsc-messages');
      const metaFilePath = path.join(reportsDir, 'meta.json');

      if (!(await fs.pathExists(metaFilePath))) {
         logger.debug('No tsc reports to update');

         return;
      }

      try {
         const meta = await fs.readJson(metaFilePath);
         const { libraries, files } = await getLibraryFiles(taskParameters.config.modules);

         await fs.writeJson(path.join(reportsDir, 'libraries.json'), Array.from(libraries));

         for await (const fileName of meta.files) {
            const filePath = path.join(reportsDir, fileName);

            const report = await fs.readJson(filePath);

            for (const message of report) {
               if (message.file && message.file.path) {
                  if (files.has(message.file.path)) {
                     message.library = files.get(message.file.path);
                  }
               }
            }

            await fs.writeJson(filePath, report);
         }
      } catch (error) {
         logger.debug(`Error occurred during updating tsc reports: ${error.message}\n${error.stack}`);
      }
   };
}

module.exports = function generateTask(taskParameters) {
   const timer = taskParameters.metrics.createTimer('update tsc reports');

   return gulp.series(
      timer.start(),
      generateTaskForUpdateTscReport(taskParameters),
      timer.finish()
   );
};
