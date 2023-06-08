'use strict';

const { path } = require('../../lib/platform/path');

function processChangedFiles(context, config, moduleInfo, changedFiles) {
   const normalizedChangedFiles = changedFiles.map(
      currentPath => context.getAllFilesToBuild(path.join(moduleInfo.name, currentPath))
   ).flat();

   // push each found changed dependency into correct interface module
   normalizedChangedFiles.forEach((currentChangedFile) => {
      const currentModuleInfo = config.getModuleInfoByName(currentChangedFile) || moduleInfo;
      if (!currentModuleInfo.normalizedChangedFiles.includes(currentChangedFile)) {
         currentModuleInfo.normalizedChangedFiles.push(currentChangedFile);
      }
   });

   return normalizedChangedFiles;
}

module.exports = {
   processChangedFiles
};
