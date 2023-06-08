'use strict';

const { toPosix } = require('../platform/path');

function normalizeFile(moduleInfo, file) {
   const currentFile = file.replace(/^\.\//, '');

   return toPosix(`${moduleInfo.outputName}/${currentFile}`);
}

function configureModuleChangedFiles(moduleInfo) {
   const configMeta = {
      changedFilesWithDependencies: {
         [moduleInfo.outputName]: []
      },
      changedFiles: [],
      deletedFiles: [],
      modulesWithEmptyChangedFiles: 0
   };
   const processFile = (file) => {
      const normalizedFile = normalizeFile(moduleInfo, file);

      configMeta.changedFilesWithDependencies[moduleInfo.outputName].push(normalizedFile);

      return normalizedFile;
   };

   if (moduleInfo.changedFiles instanceof Array) {
      if (moduleInfo.changedFiles.length === 0) {
         configMeta.modulesWithEmptyChangedFiles++;
      }

      moduleInfo.changedFiles.forEach(processFile);
   }

   if (moduleInfo.deletedFiles instanceof Array) {
      moduleInfo.deletedFiles.forEach((file) => {
         const normalizedDeletedFile = processFile(file);

         configMeta.deletedFiles.push(normalizedDeletedFile);
      });

      if (moduleInfo.icons && moduleInfo.deletedFiles.length > 0) {
         configMeta.needToExecuteHook = true;
         moduleInfo.dropCacheForIcons = true;
      }
   }

   if (moduleInfo.typescriptChanged || !moduleInfo.changedFiles) {
      configMeta.typescriptChanged = true;
   }
   return configMeta;
}

module.exports = {
   normalizeFile,
   configureModuleChangedFiles
};
