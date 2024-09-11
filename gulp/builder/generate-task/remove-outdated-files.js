/**
 * All needed functionality to remove outdated files from builder's cache
 * @author Kolbeshin F.A.
 */
'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const pMap = require('p-map');

/**
 * Common class for updating common builder meta files
 * according to list of outdated(removed) files.
 * @class MetaClass
 * @public
 */
class MetaClass {
   constructor() {
      this.meta = {};
   }

   // Adds outdated file into corresponding meta list to be updated further
   add(metaName, moduleName, fileName) {
      if (!this.meta[moduleName]) {
         this.meta[moduleName] = {};
      }
      if (!this.meta[moduleName][metaName]) {
         this.meta[moduleName][metaName] = [];
      }
      this.meta[moduleName][metaName].push(fileName);
   }

   // reads, updates and saves all meta files that have to be updated
   async updateFiles(cachePath) {
      const promises = [];
      for (const moduleName in this.meta) {
         if (this.meta.hasOwnProperty(moduleName)) {
            for (const metaName in this.meta[moduleName]) {
               if (this.meta[moduleName].hasOwnProperty(metaName)) {
                  promises.push((async() => {
                     const metaPath = path.join(cachePath, moduleName, '.builder', metaName);

                     /**
                      * some meta files can be created only in case of custom pack enabled.
                      * Therefore there is no need of updating of the meta.
                      */
                     if (await fs.pathExists(metaPath)) {
                        const currentMeta = await fs.readJson(metaPath);
                        const newMeta = currentMeta.filter(
                           currentElement => !this.meta[moduleName][metaName].includes(currentElement)
                        );
                        await fs.outputJson(metaPath, newMeta.sort());
                     }
                  })());
               }
            }
         }
      }
      await Promise.all(promises);
   }
}

async function removeFilesByList(taskParameters, normalizedCacheDirectory, filesForRemove) {
   if (filesForRemove.length === 0) {
      return;
   }
   const metaToUpdate = new MetaClass();
   const removePromises = [];
   filesForRemove.forEach(
      filePath => removePromises.push(
         (async() => {
            await fs.remove(filePath);
            taskParameters.config.addIntoGarbage(filePath);
            const relativePath = path.relative(
               taskParameters.config.outputPath,
               filePath
            );
            const moduleName = relativePath.split('/')[0];
            if (relativePath.endsWith('.ts')) {
               metaToUpdate.add(
                  'libraries.json',
                  moduleName,
                  relativePath.replace(/\.ts$/, '')
               );
            }
         })()
      )
   );
   await Promise.all(removePromises);
   await metaToUpdate.updateFiles(normalizedCacheDirectory);
}

/**
 * Removes all interface modules from output directory and cache if they were removed from sources
 * @param taskParameters
 * @param normalizedCacheDirectory
 * @param normalizedOutputDirectory
 * @returns {Promise<void>}
 */
async function cleanMissingModules(
   taskParameters,
   normalizedCacheDirectory,
   normalizedOutputDirectory
) {
   const outputModules = (await fs.readdir(normalizedCacheDirectory));

   const currentModules = taskParameters.config.modules.map(
      moduleInfo => moduleInfo.outputName
   );

   const missingModules = outputModules.filter(outputModule => !currentModules.includes(outputModule) && !outputModule.endsWith('_stable'));
   await pMap(
      missingModules,
      async(missingModule) => {
         // output could have meta files, module always is a directory
         const isDirectory = (await fs.lstat(path.join(normalizedCacheDirectory, missingModule))).isDirectory();
         if (isDirectory) {
            const cacheModulePath = path.join(normalizedCacheDirectory, missingModule);
            const outputModulePath = path.join(normalizedOutputDirectory, missingModule);

            await fs.remove(cacheModulePath);
            await fs.remove(outputModulePath);
            taskParameters.config.addIntoGarbage(cacheModulePath);
            taskParameters.config.addIntoGarbage(outputModulePath);
         }
      }
   );
}

function genTaskForCleanDeletedFiles(taskParameters) {
   const normalizedCacheDirectory = `${taskParameters.config.outputPath}/`;
   const normalizedOutputDirectory = `${taskParameters.config.rawConfig.output}/`;

   return async function cleanDeletedFiles() {
      const startTime = Date.now();
      const filesForRemove = taskParameters.cache.getListForRemoveByDeletedFiles(
         normalizedCacheDirectory,
         normalizedOutputDirectory,
         taskParameters.config.deletedFiles
      );

      await removeFilesByList(taskParameters, normalizedCacheDirectory, filesForRemove);

      taskParameters.metrics.storeTaskTime('clean deleted files', startTime);
   };
}

/**
 * Generates a task for removing of outdated files(removed from repo)
 * @param {TaskParameters} taskParameters Environment instance of current build.
 * @returns {function(): Promise<any>}
 */
function genTaskForCleanOutdatedFiles(taskParameters) {
   const normalizedCacheDirectory = `${taskParameters.config.outputPath}/`;
   const normalizedOutputDirectory = `${taskParameters.config.rawConfig.output}/`;

   if (!taskParameters.config.clearOutput) {
      return function garbageCollectorDisabled(done) {
         done();
      };
   }

   return async function removeOutdatedFiles() {
      const startTime = Date.now();
      const filesForRemove = await taskParameters.cache.getListForRemoveFromOutputDir(
         normalizedCacheDirectory,
         normalizedOutputDirectory
      );

      await removeFilesByList(taskParameters, normalizedCacheDirectory, filesForRemove);

      if (!taskParameters.config.isSourcesOutput) {
         await cleanMissingModules(
            taskParameters,
            normalizedCacheDirectory,
            normalizedOutputDirectory
         );
      }

      taskParameters.metrics.storeTaskTime('remove outdated files', startTime);
   };
}

module.exports = {
   MetaClass,
   genTaskForCleanDeletedFiles,
   genTaskForCleanOutdatedFiles
};
