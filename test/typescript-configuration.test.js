'use strict';

require('./init-test');

const { expect } = require('chai');
const createConfig = require('../gulp/builder/generate-task/typescript/configuration');
const { path, toPosix } = require('../lib/platform/path');
const dirname = toPosix(__dirname);
const { getTsConfigPath, getCompilerOptions } = require('../lib/config-helpers');
const { getTranspileOptions, getExtraMetaAboutModule } = require('../lib/compile-es-and-ts');
const tsConfigWorkspace = path.join(dirname, 'fixture/typescript');

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

it('should return correct compilerOptions in depends of content format(basic ts module or amd-formatted)', () => {
   let
      tsContent = "define('Module/myComponent', [], function() { return 'test123'; }",
      removeModuleParam;
   const moduleName = 'Module/someAnotherName';
   const relativePath = 'Module/someAnotherName.js';
   const compilerOptions = getCompilerOptions(getTsConfigPath());

   // eslint-disable-next-line prefer-destructuring
   removeModuleParam = getExtraMetaAboutModule(tsContent, moduleName, relativePath).removeModuleParam;
   let result = getTranspileOptions(relativePath, moduleName, compilerOptions, removeModuleParam);

   // if ts module amd-formatted, compilerOptions shouldn't contain "module" option
   result.compilerOptions.hasOwnProperty('module').should.equal(false);

   result = getTranspileOptions('Module/myComponent.js', 'Module/myComponent', compilerOptions, removeModuleParam);

   // if ts module amd-formatted, compilerOptions shouldn't contain "module" option
   result.compilerOptions.hasOwnProperty('module').should.equal(false);

   tsContent = "import { getter } './getterModule; export default getter;'";

   // eslint-disable-next-line prefer-destructuring
   removeModuleParam = getExtraMetaAboutModule(tsContent, moduleName, relativePath).removeModuleParam;
   result = getTranspileOptions(relativePath, moduleName, compilerOptions, removeModuleParam);

   result.compilerOptions.hasOwnProperty('module').should.equal(true);
});

describe('tsconfig path', () => {
   const testConfigPath = `${tsConfigWorkspace}/config.json`;

   it('should return transmitted physical path if exist', async() => {
      let tsConfigPath = await getTsConfigPath(path.join(tsConfigWorkspace, 'testConfig.json'), testConfigPath);
      toPosix(tsConfigPath).endsWith('fixture/typescript/testConfig.json').should.equal(true);

      // shouldn't return transmitted path if it's not found
      tsConfigPath = await getTsConfigPath(path.join(tsConfigWorkspace, 'testConfig123.json'), testConfigPath);
      toPosix(tsConfigPath).endsWith('fixture/typescript/testConfig123.json').should.equal(false);
   });

   it('should return transmitted relative path if exist', async() => {
      let tsConfigPath = await getTsConfigPath('./testConfig.json', testConfigPath);
      toPosix(tsConfigPath).endsWith('fixture/typescript/testConfig.json').should.equal(true);

      // shouldn't return transmitted path if it's not found
      tsConfigPath = await getTsConfigPath('./testConfig123.json', testConfigPath);
      toPosix(tsConfigPath).endsWith('fixture/typescript/testConfig123.json').should.equal(false);
   });

   it('should return default tsconfig path if non transmitted or transmitted is not found', async() => {
      let tsConfigPath = await getTsConfigPath('', testConfigPath);
      toPosix(tsConfigPath).endsWith('saby-typescript/configs/es5.json').should.equal(true);

      // for branch tests default config is 'saby-typescript/configs/es5.test.json'
      // in all other cases use 'es5.json' by default
      tsConfigPath = await getTsConfigPath('', testConfigPath, true);
      toPosix(tsConfigPath).endsWith('saby-typescript/configs/es5.dev.json').should.equal(true);
   });
});
