'use strict';

require('./init-test');
const Cache = require('../gulp/builder/classes/cache');
const { path } = require('../lib/platform/path');

function getFilesWithErrors(cache, targetModuleName, transmittedStorage) {
   // unit tests needs current storage list of files with errors
   // to check proper function work, otherwise use lastStore by default
   const storeToCheck = transmittedStorage || cache.lastStore;

   const result = [];

   for (const moduleName in storeToCheck.filesWithErrors) {
      if (storeToCheck.filesWithErrors.hasOwnProperty(moduleName)) {
         storeToCheck.filesWithErrors[moduleName].forEach((currentPath) => {
            if (!targetModuleName || moduleName === targetModuleName) {
               result.push(path.join(moduleName, currentPath));
            }
         });
      }
   }

   return result;
}

describe('builder cache', () => {
   it('check dependencies cache for less', () => {
      const currentCache = new Cache({});
      currentCache.currentStore.dependencies = {
         dependencies: {}
      };
      const currentDependencies = currentCache.currentStore.dependencies;
      currentCache.addDependencies('', 'myModule/style', ['firstTheme/styles']);
      currentDependencies.hasOwnProperty('myModule/style').should.equal(true);
      currentDependencies['myModule/style'].should.have.members(['firstTheme/styles']);
      currentCache.addDependencies('', 'myModule/style', ['secondTheme/styles']);
      currentDependencies.hasOwnProperty('myModule/style').should.equal(true);
      currentDependencies['myModule/style'].should.have.members(['firstTheme/styles', 'secondTheme/styles']);
   });

   it('filesWithError meta', () => {
      const currentCache = new Cache({});
      currentCache.markFileAsFailed('Module1/test.ts');
      currentCache.markFileAsFailed('Module2/test.ts');

      // without transmitted args getFilesWithErrors should return full errored files list
      let result = getFilesWithErrors(currentCache, null, currentCache.currentStore);
      [...result].should.have.members([
         'Module1/test.ts',
         'Module2/test.ts'
      ]);

      // for Module1 should return only errored files from Module1
      result = getFilesWithErrors(currentCache, 'Module1', currentCache.currentStore);
      [...result].should.have.members(['Module1/test.ts']);

      // same for Module2
      result = getFilesWithErrors(currentCache, 'Module2', currentCache.currentStore);
      [...result].should.have.members(['Module2/test.ts']);
   });

   it('external dependencies meta', () => {
      const currentCache = new Cache({});
      currentCache.setDefaultStore({
         outputName: 'MyModule'
      });
      currentCache.storeFileExternalDependencies(
         'MyModule',
         'test.less',
         new Set(['Module1', 'Module2'])
      );

      currentCache.storeFileExternalDependencies(
         'MyModule',
         'test1.less',
         new Set(['ModuleWithAPI', 'AnotherExternalModule', 'Module1', 'Module2'])
      );

      let result = currentCache.getModuleExternalDepsCache('MyModule');
      result.should.deep.equal({
         'test.less': ['Module1', 'Module2'],
         'test1.less': ['ModuleWithAPI', 'AnotherExternalModule', 'Module1', 'Module2']
      });

      result = currentCache.getModuleExternalDepsList('MyModule');
      result.should.have.members([
         'Module1',
         'Module2',
         'ModuleWithAPI',
         'AnotherExternalModule'
      ]);
   });
});
