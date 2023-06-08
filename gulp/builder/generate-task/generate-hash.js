'use strict';

const pMap = require('p-map');
const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const { sortObject, getFileHash } = require('../../../lib/helpers');
const COMMON_BUILD_ARTIFACTS = [
   'contents',
   'packageMap',
   'bundlesRoute',
   'optionalBundles',
   'bundles',
   '.builder'
];

/**
 * Gets hash of all common artifacts that was found in current module
 * @param currentModulePath
 * @returns {Promise<*|string|string>}
 */
async function getCommonArtifactsHash(currentModulePath) {
   const filesToCheck = await fs.readdir(currentModulePath);
   const result = { };

   await pMap(
      filesToCheck,
      async(currentFile) => {
         const fileNameWithoutExt = currentFile.split('.').shift();

         if (COMMON_BUILD_ARTIFACTS.includes(fileNameWithoutExt)) {
            result[currentFile] = await fs.readFile(path.join(currentModulePath, currentFile));
         }
      },
      { concurrency: 50 }
   );

   return getFileHash(JSON.stringify(sortObject(result)), true);
}

module.exports = function generateTaskForFolderHash(taskParameters) {
   const normalizedCacheDirectory = `${taskParameters.config.outputPath}/`;
   const normalizedOutputDirectory = `${taskParameters.config.rawConfig.output}/`;

   return async function generateFolderHash() {
      const startTime = Date.now();
      const modulesForPatch = taskParameters.config.getModulesForPatch();
      const modulesForBuild = modulesForPatch.length > 0 ? modulesForPatch.filter(
         moduleInfo => !moduleInfo.removeFromPatchOutput
      ) : taskParameters.config.modules;

      await pMap(
         modulesForBuild.filter(moduleInfo => !(moduleInfo.compiled && typeof moduleInfo.compiled === 'boolean')),
         async(moduleInfo) => {
            const currentModuleHashFiles = sortObject(moduleInfo.filesHash);
            const moduleHashListPath = path.join(normalizedCacheDirectory, moduleInfo.outputName, '.builder/moduleHash-list');
            let previousModuleHashFiles;

            if (await fs.pathExists(moduleHashListPath)) {
               previousModuleHashFiles = await fs.readJson(moduleHashListPath);
            }

            if (previousModuleHashFiles && Object.keys(previousModuleHashFiles).length > 0) {
               Object.keys(currentModuleHashFiles).forEach((currentFile) => {
                  const outputFiles = taskParameters.cache.getOutputForFile(currentFile, moduleInfo);
                  outputFiles.forEach((currentOutputFile) => {
                     if (!currentModuleHashFiles[currentOutputFile] && previousModuleHashFiles[currentOutputFile]) {
                        moduleInfo.addFileHash(currentOutputFile, previousModuleHashFiles[currentOutputFile]);
                     }
                  });
               });
               Object.keys(previousModuleHashFiles).forEach((currentFile) => {
                  const outputFiles = taskParameters.cache.getOutputForFile(currentFile, moduleInfo);
                  outputFiles.forEach((currentOutputFile) => {
                     if (!currentModuleHashFiles[currentOutputFile]) {
                        moduleInfo.addFileHash(currentOutputFile, previousModuleHashFiles[currentOutputFile]);
                     }
                  });
               });
            }

            // we need to get hash of all common build artifacts to get proper module hash when something in build
            // artifacts was changed, e.g. contents has new builderversion but nothing of sources was changed
            const artifactsHash = await getCommonArtifactsHash(
               path.join(normalizedCacheDirectory, moduleInfo.outputName)
            );
            moduleInfo.addFileHash('common_artifacts', artifactsHash);

            if (typeof moduleInfo.hash === 'string') {
               moduleInfo.addFileHash('.builder/hash.json', moduleInfo.hash);
            }

            let moduleOutput;
            if (normalizedCacheDirectory !== normalizedOutputDirectory) {
               moduleOutput = path.join(normalizedCacheDirectory, moduleInfo.outputName);

               const moduleHashList = JSON.stringify(sortObject(moduleInfo.filesHash));
               await fs.outputFile(
                  `${moduleOutput}/.builder/moduleHash`,
                  getFileHash(moduleHashList, true)
               );
               await fs.outputFile(
                  `${moduleOutput}/.builder/moduleHash-list`,
                  moduleHashList
               );

               if (typeof moduleInfo.hash === 'string') {
                  await fs.outputJson(
                     `${moduleOutput}/.builder/hash.json`,
                     { sourcesHash: moduleInfo.hash }
                  );
               }
            }

            moduleOutput = path.join(normalizedOutputDirectory, moduleInfo.outputName);

            const moduleHashList = JSON.stringify(sortObject(moduleInfo.filesHash));
            await fs.outputFile(`${moduleOutput}/.builder/moduleHash`, getFileHash(moduleHashList, true));
            await fs.outputFile(
               `${moduleOutput}/.builder/moduleHash-list`,
               moduleHashList
            );

            if (typeof moduleInfo.hash === 'string') {
               await fs.outputJson(
                  `${moduleOutput}/.builder/hash.json`,
                  { sourcesHash: moduleInfo.hash }
               );
            }
         }
      );

      taskParameters.metrics.storeTaskTime('generate modules hash sum', startTime);
   };
};
