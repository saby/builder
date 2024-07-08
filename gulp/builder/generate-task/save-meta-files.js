/**
 * Генерация задачи для записи мета файлов после основной сборки модулей.
 */

'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const gulp = require('gulp');
const pMap = require('p-map');
const logger = require('../../../lib/logger').logger();
const execInPool = require('../../common/exec-in-pool');

function skipSaveMetaFiles(done) {
   done();
}

/**
 * reads existing module meta and fills with it current build meta
 * needed for incremental build of versioned_modules and cdn_modules
 * meta files
 * @param {String} root - current project root
 * (output for built module or project output)
 * @param {Set} meta - meta to fill with read module meta file
 * @param {String} filePath - file path of module meta
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

/**
 * Module is dependant in 2 cases:
 * 1) Superbundles module - can pack styles from interface modules with external link dependencies or
 * self module link dependencies(will be external link dependency for Superbundle)
 * 2) web page templates - can pack styles in static package with external link dependencies or self
 * module link dependencies(will be external link dependency for this module)
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {Promise<boolean>}
 */
async function isDependantModule(moduleInfo) {
   if (moduleInfo.name === 'Superbundles') {
      return true;
   }

   const staticTemplatesPath = path.join(moduleInfo.output, 'static_templates.json');

   if (await fs.pathExists(staticTemplatesPath)) {
      const staticTemplates = await fs.readJson(staticTemplatesPath);
      return Object.keys(staticTemplates).length > 0;
   }

   return false;
}

function generateGetExternalDepsFiles(taskParameters, moduleInfo) {
   return async function getExternalDepsMetaFiles() {
      const externalDependenciesPath = path.join(moduleInfo.output, '.builder/link_dependencies.json');
      const externalDependencies = new Set(taskParameters.cache.getModuleExternalDepsList(moduleInfo.outputName));
      await checkForCachedMeta(moduleInfo.output, externalDependencies, externalDependenciesPath);

      moduleInfo.externalDependencies = externalDependencies;
   };
}

function generateSaveExternalDepsFiles(taskParameters, moduleInfo, ownDependenciesLinksModules) {
   return async function saveExternalDepsMetaFiles() {
      const externalDependenciesPath = path.join(moduleInfo.output, '.builder/link_dependencies.json');
      const { externalDependencies } = moduleInfo;

      if (await isDependantModule(moduleInfo)) {
         const currentModuleDependencies = moduleInfo.depends || [];

         currentModuleDependencies.forEach((currentDependency) => {
            const currentModuleInfo = taskParameters.config.getModuleInfoByName(currentDependency);
            if (currentModuleInfo) {
               const currentExternalDependencies = currentModuleInfo.externalDependencies;

               currentExternalDependencies.forEach(currentKey => externalDependencies.add(currentKey));

               if (ownDependenciesLinksModules.has(currentDependency)) {
                  externalDependencies.add(currentDependency);
               }
            }
         });
      }

      await fs.outputFile(externalDependenciesPath, JSON.stringify([...externalDependencies].sort()));
      taskParameters.addFileToCopy(moduleInfo.outputName, '.builder/link_dependencies.json');
   };
}

function addContentsToVersionMeta(taskParameters, moduleInfo, versionedModules, fileName) {
   versionedModules.add(`${moduleInfo.outputName}/${fileName}.json`);

   // in desktop apps there will not be any contents.js files(debug files
   // removes from output in desktop apps). Write it in versioned_modules
   // for online projects only
   if (taskParameters.config.sources) {
      versionedModules.add(`${moduleInfo.outputName}/${fileName}.json.js`);
   }
   if (taskParameters.config.minimize) {
      versionedModules.add(`${moduleInfo.outputName}/${fileName}.min.json`);
      versionedModules.add(`${moduleInfo.outputName}/${fileName}.json.min.js`);
   }
}

function generateSaveVersionizedMetaFiles(taskParameters, moduleInfo, ownDependenciesLinksModules) {
   return async function saveVersionizedMetaFiles() {
      try {
         const versionedModules = new Set(taskParameters.getVersionedModules(moduleInfo.outputName));
         const versionedMetaPath = path.join(moduleInfo.output, '.builder', 'versioned_modules.json');

         await checkForCachedMeta(moduleInfo.output, versionedModules, versionedMetaPath);

         if (taskParameters.config.contents) {
            addContentsToVersionMeta(taskParameters, moduleInfo, versionedModules, 'contents');
            if (taskParameters.config.localizedContents) {
               taskParameters.config.localizations.forEach(
                  language => addContentsToVersionMeta(
                     taskParameters,
                     moduleInfo,
                     versionedModules,
                     `contents-${language.split('-')[0]}`
                  )
               );
            }
         }

         let sortedVersionedModules = [...versionedModules].sort();

         // ThemesModule can't contain self link dependencies, it has only joined themes from another interface
         // modules
         if (
            sortedVersionedModules.some(elem => elem.endsWith('.css') || elem.endsWith('.html')) &&
            moduleInfo.outputName !== 'ThemesModule'
         ) {
            ownDependenciesLinksModules.add(moduleInfo.outputName);
         }

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

function generateSaveHashMetaFiles(taskParameters, moduleInfo) {
   return async function saveHashMetaFiles() {
      if (typeof moduleInfo.hash === 'string') {
         await fs.outputJson(
            path.join(moduleInfo.output, '.builder', 'hash.json'),
            { sourcesHash: moduleInfo.hash }
         );
         taskParameters.addFileToCopy(moduleInfo.outputName, '.builder/hash.json');
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

function generateMetaJsonMeta(taskParameters, moduleInfo) {
   return async function saveMetaJsonFiles() {
      try {
         const { metaTsFiles } = moduleInfo;
         const result = {
            id: moduleInfo.id,
            name: moduleInfo.name,
            kaizen: moduleInfo.kaizen,
            meta: []
         };
         const filesWithErrors = [];

         if (metaTsFiles.length > 0) {
            await pMap(
               metaTsFiles,
               async(metaTsFile) => {
                  const [error, metaTs] = await execInPool(
                     taskParameters.pool,
                     'metaTsToJson',
                     [metaTsFile],
                     metaTsFile,
                     moduleInfo
                  );

                  if (error || metaTs.error) {
                     filesWithErrors.push(`${metaTsFile.replace(`${moduleInfo.outputName}/`, './')}.meta.ts`);
                     logger.error({
                        message: 'Error while requiring and processing meta.js file',
                        filePath: metaTsFile,
                        error: error || metaTs.error,
                        moduleInfo
                     });
                  } else if (metaTs.result) {
                     if (metaTs.result instanceof Array) {
                        result.meta.push(...metaTs.result);
                     } else {
                        result.meta.push(metaTs.result);
                     }
                  }
               }
            );

            // we should add meta.ts processing errors into module cache
            if (filesWithErrors.length > 0) {
               const errorsCachePath = path.join(moduleInfo.output, '.cache/components-info.json');
               const componentsInfo = await fs.readJson(errorsCachePath);

               filesWithErrors.forEach((currentFile) => {
                  if (!componentsInfo.filesWithErrors.includes(currentFile)) {
                     componentsInfo.filesWithErrors.push(currentFile);
                  }
               });

               await fs.outputJson(errorsCachePath, componentsInfo);
            }

            if (result.meta.length > 0) {
               // sort meta array by id
               result.meta = result.meta.sort((a, b) => {
                  if (a.id < b.id) {
                     return -1;
                  }
                  if (a.id > b.id) {
                     return 1;
                  }
                  return 0;
               });

               await fs.outputJson(path.join(moduleInfo.output, `${moduleInfo.outputName}.metatypes`), result);
               taskParameters.addFileToCopy(moduleInfo.outputName, `${moduleInfo.outputName}.metatypes`);
            }
         }
      } catch (error) {
         logger.error({
            message: `Builder's error during ${moduleInfo.outputName}.metatypes generating`,
            error,
            moduleInfo
         });
      }
   };
}

function generateTaskForSaveMetaFiles(taskParameters) {
   const ownDependenciesLinksModules = new Set([]);
   const tasks = [];

   for (const moduleInfo of taskParameters.config.modules) {
      tasks.push(generateMetaJsonMeta(taskParameters, moduleInfo));
      if (!taskParameters.config.localStand) {
         if (!moduleInfo.version) {
            tasks.push(generateSaveHashMetaFiles(taskParameters, moduleInfo));
            continue;
         }

         tasks.push(
            gulp.series(
               gulp.parallel(
                  generateSaveVersionizedMetaFiles(taskParameters, moduleInfo, ownDependenciesLinksModules),
                  generateSaveCdnMetaFiles(taskParameters, moduleInfo),
                  generateSaveHashMetaFiles(taskParameters, moduleInfo),
                  generateGetExternalDepsFiles(taskParameters, moduleInfo)
               ),
               generateSaveExternalDepsFiles(taskParameters, moduleInfo, ownDependenciesLinksModules)
            )
         );
      }
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
