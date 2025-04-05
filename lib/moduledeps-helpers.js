'use strict';

const { path } = require('./platform/path');
const { stylesToExcludeFromMinify } = require('./builder-constants');

const parsePlugins = dep => [
   ...new Set(
      dep
         .split('!')
         .slice(0, -1)
         .map((depName) => {
            if (depName.includes('?')) {
               return depName.split('?')[1];
            }
            return depName;
         })
   )
];

/**
 * Получаем набор файлов css и jstpl для последующего
 * добавления в module-dependencies
 * @param inputFiles - список всех файлов текущего Интерфейсного модуля
 * @returns {Array[]}
 */
function getCssJstplAndJsonFiles(inputFiles) {
   const
      cssFiles = [],
      jstplFiles = [],
      jsonFiles = [];

   inputFiles.forEach((filePath) => {
      /**
       * private less(starts with "_") and styles excluded from minification task
       * should be excluded from module-dependencies
       */
      if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
         if (path.basename(filePath).startsWith('_')) {
            return;
         }

         for (const regex of stylesToExcludeFromMinify) {
            if (regex.test(filePath)) {
               return;
            }
         }
         cssFiles.push(filePath.replace('.less', '.css'));
      }
      if (filePath.endsWith('.jstpl')) {
         jstplFiles.push(filePath);
      }

      // get all json input files but custom package configs(*.package.json)
      if (filePath.endsWith('.json') && !filePath.endsWith('.package.json')) {
         jsonFiles.push(filePath);
      }
   });
   return [cssFiles, jstplFiles, jsonFiles];
}

function getNodePath(prettyPath, ext, suffix) {
   let result = prettyPath;

   // An AMD-module formatted json generates, so there should be corresponding path for it
   if (ext === '.json') {
      return prettyPath.replace(ext, `${ext}${suffix}.js`);
   }

   if (!prettyPath.endsWith(`${suffix}${ext}`)) {
      result = prettyPath.replace(ext, `${suffix}${ext}`);
   }

   if (ext === '.ts' || ext === '.tsx') {
      result = result.replace(/(\.ts|\.tsx)$/, '.js');
   }

   if (result.match(/\.meta((\.min)?\.js)$/)) {
      result = result.replace(/\.meta((\.min)?\.js)$/, '$1');
   }

   return result;
}

module.exports = {
   parsePlugins,
   getCssJstplAndJsonFiles,
   getNodePath
};
