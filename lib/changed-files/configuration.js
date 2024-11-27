'use strict';

const { toPosix } = require('../platform/path');

function normalizeFile(moduleInfo, file) {
   const currentFile = file.replace(/^\.\//, '');

   return toPosix(`${moduleInfo.outputName}/${currentFile}`);
}

function setOverallChangedFileParameter(moduleInfo, configMeta, parameter) {
   if (moduleInfo[parameter] || !moduleInfo.changedFiles) {
      configMeta[parameter] = true;
   }
}

function configureModuleChangedFiles(moduleInfo) {
   const configMeta = {
      changedFilesWithDependencies: {
         [moduleInfo.outputName]: []
      },
      deletedFiles: [],
      modulesWithEmptyChangedFiles: 0,
      dropCacheForMarkup: '',
      dropCacheForOldMarkup: ''
   };
   const processFile = (file) => {
      const normalizedFile = normalizeFile(moduleInfo, file);

      if (normalizedFile.startsWith('Compiler/')) {
         configMeta.dropCacheForMarkupPath = normalizedFile;
      }

      if (normalizedFile.startsWith('UI/')) {
         configMeta.dropCacheForStaticMarkupPath = normalizedFile;
      }

      if (normalizedFile.startsWith('View/Compiler')) {
         configMeta.dropCacheForOldMarkupPath = normalizedFile;
      }

      if (normalizedFile.startsWith('Meta/')) {
         configMeta.dropCacheForMetatypes = normalizedFile;
      }

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

   // если у moduleInfo нету информации о changedFiles или есть информация о хотя бы об одном изменившемся ts(x) файле,
   // то по умолчанию считаем для всего проекта что менялся typescript-код, чтобы запустить tsc компилятор(он работает
   // в рамках всего проекта)
   setOverallChangedFileParameter(moduleInfo, configMeta, 'typescriptChanged');

   // если у moduleInfo нету информации о changedFiles или есть информация о хотя бы одной изменившейся js-ке,
   // то по умолчанию считаем для всего проекта что менялся js-код, чтобы запустить генератор
   // components-properties(работает в рамках всего проекта).
   setOverallChangedFileParameter(moduleInfo, configMeta, 'jsChanged');

   return configMeta;
}

module.exports = {
   normalizeFile,
   configureModuleChangedFiles
};
