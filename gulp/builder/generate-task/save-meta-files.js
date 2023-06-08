/**
 * Генерация задачи для записи мета файлов после основной сборки модулей.
 */

'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const gulp = require('gulp');
const pMap = require('p-map');
const logger = require('../../../lib/logger').logger();

function skipSaveMetaFiles(done) {
   done();
}

/**
 * reads existing module meta and fills with it current build meta
 * needed for incremental build of versioned_modules and cdn_modules
 * meta files
 * @param{String} root - current project root
 * (output for built module or project output)
 * @param{Set} meta - meta to fill with read module meta file
 * @param{String} filePath - file path of module meta
 * @returns {Promise<void>}
 */
async function checkForCachedMeta(root, meta, filePath) {
   if (await fs.pathExists(filePath)) {
      const cachedVersionedMeta = await fs.readJson(filePath);
      await pMap(
         cachedVersionedMeta,
         async(currentFile) => {
            if (await fs.pathExists(path.join(path.dirname(root), currentFile))) {
               if (!meta.has(currentFile)) {
                  meta.add(currentFile);
               }
            }
         }
      );
   }
}

function generateSaveExternalDepsFiles(taskParameters, moduleInfo) {
   return async function saveExternalDepsMetaFiles() {
      const externalDependenciesPath = path.join(moduleInfo.output, '.builder/link_dependencies.json');

      // TODO поддержать версионирование контента в упакованных супербандлах. Поскольку супербандлы могут в себя
      //  паковать абсолютно рандомные стили из разных интерфейсных модулей, нам важно заново вычислить внешние
      //  зависимости именно для конкретных пакетов и записать их в link_dependencies. Реализовать в задаче
      //  https://online.sbis.ru/opendoc.html?guid=a3150880-da2f-42b1-a569-a5b56606e485&client=3
      if (moduleInfo.name !== 'Superbundles') {
         const externalDependencies = new Set(taskParameters.cache.getModuleExternalDepsList(moduleInfo.outputName));

         await checkForCachedMeta(moduleInfo.output, externalDependencies, externalDependenciesPath);

         await fs.outputFile(externalDependenciesPath, JSON.stringify([...externalDependencies].sort()));
      } else {
         await fs.outputFile(externalDependenciesPath, JSON.stringify([...moduleInfo.depends || []].sort()));
      }
      taskParameters.addFileToCopy(moduleInfo.outputName, '.builder/link_dependencies.json');
   };
}

function generateSaveVersionizedMetaFiles(taskParameters, moduleInfo) {
   return async function saveVersionizedMetaFiles() {
      try {
         const versionedModules = new Set(taskParameters.getVersionedModules(moduleInfo.outputName));
         const versionedMetaPath = path.join(moduleInfo.output, '.builder', 'versioned_modules.json');

         await checkForCachedMeta(moduleInfo.output, versionedModules, versionedMetaPath);

         if (taskParameters.config.contents) {
            versionedModules.add(`${moduleInfo.outputName}/contents.json`);

            // in desktop apps there will not be any contents.js files(debug files
            // removes from output in desktop apps). Write it in versioned_modules
            // for online projects only
            if (taskParameters.config.sources) {
               versionedModules.add(`${moduleInfo.outputName}/contents.json.js`);
            }
            if (taskParameters.config.minimize) {
               versionedModules.add(`${moduleInfo.outputName}/contents.min.json`);
               versionedModules.add(`${moduleInfo.outputName}/contents.json.min.js`);
            }
         }

         let sortedVersionedModules = [...versionedModules].sort();
         if (!taskParameters.config.sources) {
            sortedVersionedModules = sortedVersionedModules.filter((currentModule) => {
               switch (path.extname(currentModule)) {
                  case '.css':
                     return currentModule.endsWith('.min.css');
                  default:
                     return true;
               }
            });
         }

         await fs.outputFile(versionedMetaPath, JSON.stringify(sortedVersionedModules));
         taskParameters.addFileToCopy(moduleInfo.outputName, '.builder/versioned_modules.json');
      } catch (error) {
         logger.error({
            message: "Builder's error during versioned_modules meta generating",
            error,
            moduleInfo
         });
      }
   };
}

function generateSaveCdnMetaFiles(taskParameters, moduleInfo) {
   return async function saveCdnMetaFiles() {
      try {
         const cdnModules = new Set(taskParameters.getCdnModules(moduleInfo.outputName));
         const cdnMetaPath = path.join(moduleInfo.output, '.builder', 'cdn_modules.json');
         await checkForCachedMeta(moduleInfo.output, cdnModules, cdnMetaPath);

         await fs.outputFile(
            path.join(moduleInfo.output, '.builder', 'cdn_modules.json'),
            JSON.stringify([...cdnModules].sort())
         );
         taskParameters.addFileToCopy(moduleInfo.outputName, '.builder/cdn_modules.json');
      } catch (error) {
         logger.error({
            message: "Builder's error during cdn_modules meta generating",
            error,
            moduleInfo
         });
      }
   };
}

function generateTaskForSaveMetaFiles(taskParameters) {
   if (taskParameters.config.localStand) {
      return skipSaveMetaFiles;
   }

   const { config } = taskParameters;
   const modulesForPatch = config.getModulesForPatch();
   const modulesForBuild = modulesForPatch.length > 0 ? modulesForPatch : config.modules;
   const tasks = [];

   for (const moduleInfo of modulesForBuild) {
      if (!moduleInfo.version) {
         continue;
      }

      tasks.push(
         gulp.parallel(
            generateSaveVersionizedMetaFiles(taskParameters, moduleInfo),
            generateSaveCdnMetaFiles(taskParameters, moduleInfo),
            generateSaveExternalDepsFiles(taskParameters, moduleInfo)
         )
      );
   }

   if (tasks.length === 0) {
      return skipSaveMetaFiles;
   }

   const buildModule = taskParameters.metrics.createTimer('saveMetaFiles');
   return gulp.series(
      buildModule.start(),
      gulp.parallel(tasks),
      (done) => {
         taskParameters.resetVersionedAndCdnMeta();
         done();
      },
      buildModule.finish()
   );
}

module.exports = generateTaskForSaveMetaFiles;
