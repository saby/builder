'use strict';

require('./init-test');
const { path, toPosix } = require('../lib/platform/path');
const dirname = toPosix(__dirname);
const { getTsConfigPath, getCompilerOptions } = require('../lib/config-helpers');
const { getTranspileOptions, getExtraMetaAboutModule } = require('../lib/compile-es-and-ts');
const tsConfigWorkspace = path.join(dirname, 'fixture/typescript');

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
