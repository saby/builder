'use strict';

require('./init-test');
const Cache = require('../gulp/builder/classes/cache');
const { path, toPosix } = require('../lib/platform/path');

const dirname = toPosix(__dirname);
const sourceFolder = path.join(dirname, 'workspace', 'source');

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
      currentCache.markFileAsFailed(path.join(sourceFolder, 'Module1/test.ts'));
      currentCache.markFileAsFailed(path.join(sourceFolder, 'Module2/test.ts'));

      // without transmitted args getFilesWithErrors should return full errored files list
      let result = currentCache.getFilesWithErrors(null, currentCache.currentStore);
      [...result].should.have.members([
         path.join(sourceFolder, 'Module1/test.ts'),
         path.join(sourceFolder, 'Module2/test.ts')
      ]);

      // for Module1 should return only errored files from Module1
      result = currentCache.getFilesWithErrors(path.join(sourceFolder, 'Module1'), currentCache.currentStore);
      [...result].should.have.members([path.join(sourceFolder, 'Module1/test.ts')]);

      // same for Module2
      result = currentCache.getFilesWithErrors(path.join(sourceFolder, 'Module2'), currentCache.currentStore);
      [...result].should.have.members([path.join(sourceFolder, 'Module2/test.ts')]);
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
