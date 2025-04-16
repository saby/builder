/**
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const { path } = require('../../../../lib/platform/path');

async function withJsonFile(filePath, callback) {
   if (!(await fs.pathExists(filePath))) {
      return;
   }

   const json = await fs.readJSON(filePath);

   await callback(json);
}

function applyComponentDependencies(taskParameters, workspace, moduleInfo, json) {
   if (!json.hasOwnProperty('componentsInfo')) {
      return;
   }

   for (const filePath in json.componentsInfo) {
      if (json.componentsInfo.hasOwnProperty(filePath)) {
         const component = json.componentsInfo[filePath];

         if (!component.hasOwnProperty('componentName')) {
            continue;
         }

         if (component.hasOwnProperty('libraryName')) {
            workspace.dependencies.addLibraryFile(component.libraryName, component.packedModules);
         }

         workspace.dependencies.addJsFile(filePath, component.componentName, component.componentDep);
      }
   }
}

function applyMarkupDependencies(taskParameters, workspace, moduleInfo, json) {
   if (!json.hasOwnProperty('markupCache')) {
      return;
   }

   for (const filePath in json.markupCache) {
      if (json.markupCache.hasOwnProperty(filePath)) {
         const component = json.markupCache[filePath];

         workspace.dependencies.addJsFile(filePath, component.nodeName, component.dependencies);
      }
   }
}

function applyInputFiles(taskParameters, workspace, moduleInfo, json) {
   if (!json.hasOwnProperty('paths')) {
      return;
   }

   for (const filePath in json.paths) {
      if (json.paths.hasOwnProperty(filePath)) {
         if (filePath.endsWith('.json')) {
            workspace.dependencies.addJsonFile(filePath);

            continue;
         }

         if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
            if (json.paths[filePath].output.some(f => f.endsWith('.css'))) {
               workspace.dependencies.addCssFile(filePath);
            }
         }
      }
   }
}

function generateLoadModuleDependencies(taskParameters, workspace, moduleInfo) {
   return async function loadModuleDependencies() {
      const componentsArtifactPath = path.join(moduleInfo.output, '.cache', 'components-info.json');
      await withJsonFile(componentsArtifactPath, (json) => {
         applyComponentDependencies(taskParameters, workspace, moduleInfo, json);
         applyMarkupDependencies(taskParameters, workspace, moduleInfo, json);
      });

      const inputFilesArtifactPath = path.join(moduleInfo.output, '.cache', 'input-paths.json');
      await withJsonFile(inputFilesArtifactPath, (json) => {
         applyInputFiles(taskParameters, workspace, moduleInfo, json);
      });
   };
}

function generateLoadDependencies(taskParameters, workspace) {
   // TODO: подумать, как оптимизировать эту задачу:
   //    Мы грузим данные для построения графа дважды: в анализаторе и тут
   const tasks = taskParameters.config.modules
      .map(moduleInfo => generateLoadModuleDependencies(taskParameters, workspace, moduleInfo));

   return gulp.parallel(tasks);
}

module.exports = generateLoadDependencies;
