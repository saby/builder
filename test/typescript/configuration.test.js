'use strict';

const { expect } = require('chai');

const createConfig = require('../../gulp/builder/generate-task/typescript/configuration');

function createTaskParameters(cfg = { }) {
   return {
      sabyTypescriptDir: 'path',
      typescriptOutputDir: 'path',
      config: {
         sourcesDirectory: 'path',
         modules: cfg.modules || [],
         tsconfig: 'tsconfig',
         tsCompilerOptions: { },
         generateUMD: !!cfg.generateUMD,
         isReleaseMode: !!cfg.isReleaseMode,
         inlineSourceMaps: !!cfg.inlineSourceMaps,
         sourceMaps: !!cfg.sourceMaps
      }
   };
}

describe('gulp/builder/generate-task/typescript/configuration', () => {
   it('add custom modules', () => {
      const modules = [{
         name: 'CustomModule',
         path: 'path/to/CustomModule'
      }];
      const taskParameters = createTaskParameters({ modules });
      const config = createConfig(taskParameters);

      expect(config.compilerOptions.paths).hasOwnProperty('CustomModule/*');
      expect(config.compilerOptions.paths['CustomModule/*']).deep.equal([
         'path/to/CustomModule/*'
      ]);
   });
   describe('debug mode', () => {
      const isReleaseMode = false;

      it('basic', () => {
         const taskParameters = createTaskParameters({ isReleaseMode });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsxdev');
         expect(config.compilerOptions.inlineSourceMap).equals(false);
         expect(config.compilerOptions.inlineSources).equals(false);
         expect(config.compilerOptions.sourceMap).equals(false);
      });
      it('umd module', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, generateUMD: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('umd');
      });
      it('inline source maps', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, inlineSourceMaps: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsxdev');
         expect(config.compilerOptions.inlineSourceMap).equals(true);
         expect(config.compilerOptions.inlineSources).equals(true);
         expect(config.compilerOptions.sourceMap).equals(undefined);
      });
      it('source maps', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, sourceMaps: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsxdev');
         expect(config.compilerOptions.inlineSourceMap).equals(false);
         expect(config.compilerOptions.inlineSources).equals(false);
         expect(config.compilerOptions.sourceMap).equals(true);
      });
   });
   describe('release mode', () => {
      const isReleaseMode = true;

      it('basic', () => {
         const taskParameters = createTaskParameters({ isReleaseMode });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsx');
         expect(config.compilerOptions.inlineSourceMap).equals(undefined);
         expect(config.compilerOptions.inlineSources).equals(undefined);
         expect(config.compilerOptions.sourceMap).equals(undefined);
      });
      it('umd module', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, generateUMD: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('umd');
      });
      it('inline source maps', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, inlineSourceMaps: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsx');
         expect(config.compilerOptions.inlineSourceMap).equals(undefined);
         expect(config.compilerOptions.inlineSources).equals(undefined);
         expect(config.compilerOptions.sourceMap).equals(undefined);
      });
      it('source maps', () => {
         const taskParameters = createTaskParameters({ isReleaseMode, sourceMaps: true });
         const config = createConfig(taskParameters);

         expect(config.compilerOptions.module).equals('amd');
         expect(config.compilerOptions.jsx).equals('react-jsx');
         expect(config.compilerOptions.inlineSourceMap).equals(undefined);
         expect(config.compilerOptions.inlineSources).equals(undefined);
         expect(config.compilerOptions.sourceMap).equals(undefined);
      });
   });
});
