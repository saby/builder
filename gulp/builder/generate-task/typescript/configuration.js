'use strict';

const { path } = require('../../../../lib/platform/path');

function createConfig(taskParameters) {
   const paths = {
      tslib: [path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts')],
      'Lib/*': [path.join(taskParameters.config.sourcesDirectory, 'WS.Core/lib/*')],
      'Ext/*': [path.join(taskParameters.config.sourcesDirectory, 'WS.Core/lib/Ext/*')],
      'Core/*': [path.join(taskParameters.config.sourcesDirectory, 'WS.Core/core/*')],
      'Transport/*': [path.join(taskParameters.config.sourcesDirectory, 'WS.Core/transport/*')],
      'WS/css/*': [path.join(taskParameters.config.sourcesDirectory, 'WS.Core/css/*')]
   };

   taskParameters.config.modules.forEach((module) => {
      if (module.name !== 'WS.Core') {
         paths[`${module.name}/*`] = [`${module.path}/*`];
      }
   });

   const tscConfig = {
      extends: taskParameters.config.tsconfig,
      compilerOptions: {
         ...taskParameters.config.tsCompilerOptions,
         module: taskParameters.config.generateUMD ? 'umd' : 'amd',
         removeComments: false,
         rootDir: taskParameters.config.sourcesDirectory,
         outDir: taskParameters.typescriptOutputDir,
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

module.exports = createConfig;
