/**
 * Функция для заполнения tsconfig модулями, участвующими в компиляции.
 * @author Krylov M.A.
 */
'use strict';

const { path } = require('../../../../lib/platform/path');
const wsCoreMap = new Map([
   ['Lib/*', 'WS.Core/lib/*'],
   ['Core/*', 'WS.Core/core/*'],
   ['WS/css/*', 'WS.Core/css/*'],
   ['WS.Core/*', 'WS.Core/*']
]);

function addWSCoreAliases(paths, directory) {
   wsCoreMap.forEach((value, key) => {
      paths[key] = [path.join(directory, value)];
   });
}

function createConfig(taskParameters, projectReferences) {
   const paths = {
      tslib: [path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts')]
   };

   addWSCoreAliases(paths, path.join(taskParameters.config.tscDirectory));

   taskParameters.config.modules.forEach((module) => {
      if (module.name !== 'WS.Core') {
         paths[`${module.name}/*`] = [`${path.join(taskParameters.config.tscDirectory, module.name)}/*`];
      }
   });

   let currentTsConfig;
   let currentTsCompilerOptions;

   if (projectReferences) {
      currentTsConfig = taskParameters.config.tsconfig;
      currentTsCompilerOptions = taskParameters.config.tsCompilerOptions;
   } else {
      currentTsConfig = taskParameters.config.noStricttsconfig || taskParameters.config.tsconfig;
      currentTsCompilerOptions = taskParameters.config.noStricttsCompilerOptions ||
         taskParameters.config.tsCompilerOptions;
   }

   const tscConfig = {
      extends: currentTsConfig,
      compilerOptions: {
         ...currentTsCompilerOptions,
         module: taskParameters.config.generateUMD ? 'umd' : 'amd',
         removeComments: false,
         rootDir: taskParameters.config.tscDirectory,
         outDir: taskParameters.config.typescriptOutputDir,
         paths
      }
   };

   if (taskParameters.config.isReleaseMode) {
      tscConfig.compilerOptions.jsx = 'react-jsx';

      return tscConfig;
   }

   tscConfig.compilerOptions.jsx = 'react-jsxdev';
   tscConfig.compilerOptions.inlineSourceMap = !!taskParameters.config.inlineSourceMaps;
   tscConfig.compilerOptions.inlineSources = !!taskParameters.config.inlineSourceMaps;

   // prefer inline source maps to common source maps, they are more important
   if (!taskParameters.config.inlineSourceMaps) {
      tscConfig.compilerOptions.sourceMap = !!taskParameters.config.sourceMaps;
   }

   return tscConfig;
}

module.exports = {
   createConfig,
   addWSCoreAliases
};
