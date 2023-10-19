'use strict';

const { path } = require('../../lib/platform/path');

function processChangedFiles(context, config, moduleInfo, changedFiles) {
   const normalizedChangedFiles = changedFiles.map(
      currentPath => context.getAllFilesToBuild(path.join(moduleInfo.name, currentPath))
   ).flat();

   // push each found changed dependency into correct interface module
   normalizedChangedFiles.forEach((currentChangedFile) => {
      const currentModuleInfo = config.getModuleInfoByName(currentChangedFile) || moduleInfo;

      // changedFiles meta contains only relative paths
      const relativeChangedFile = currentChangedFile.replace(`${currentModuleInfo.name}/`, './');

      // generate normalized changed files for dependant module if there are files in this module to rebuild
      if (!currentModuleInfo.normalizedChangedFiles) {
         currentModuleInfo.setDefaultChangedFiles();
      }

      currentModuleInfo.addNormalizedChangedFile(currentChangedFile);
      currentModuleInfo.addChangedFile(relativeChangedFile);
   });

   return normalizedChangedFiles;
}

module.exports = {
   processChangedFiles
};
