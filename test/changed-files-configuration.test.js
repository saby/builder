'use strict';

require('../lib/logger').setGulpLogger();
const { expect } = require('chai');
const { configureModuleChangedFiles } = require('../lib/changed-files/configuration');
const sinon = require('sinon');
const { generateSimpleEnvironment, generateFullEnvironment } = require('./changed-files/helpers');

describe('fill build config with changed files meta', () => {
   let sandbox;
   beforeEach(() => {
      sandbox = sinon.createSandbox();
   });

   afterEach(() => {
      sandbox.restore();
   });

   it('fill changedFiles', () => {
      const module = {
         name: 'Module1',
         path: '/path/to/source/Module1',
         changedFiles: ['./test1.ts', './less/test1.less']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);
      expect(result.changedFilesWithDependencies.Module1).to.have.members([
         'Module1/test1.ts',
         'Module1/less/test1.less'
      ]);
   });

   it('changedFilesWithDependencies must have all changed and deleted files', () => {
      const module = {
         name: 'Module1',
         path: '/path/to/source/Module1',
         changedFiles: ['./test1.ts', './less/test1.less'],
         deletedFiles: ['./test2.ts', './less/test2.less']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      expect(result.changedFilesWithDependencies.Module1).to.have.members([
         'Module1/test1.ts',
         'Module1/test2.ts',
         'Module1/less/test1.less',
         'Module1/less/test2.less'
      ]);
   });

   it('fill deletedFiles', () => {
      const module = {
         name: 'Module1',
         path: '/path/to/source/Module1',
         deletedFiles: ['./test1.ts', './less/test1.less']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);
      expect(result.deletedFiles).to.have.members([
         'Module1/test1.ts',
         'Module1/less/test1.less'
      ]);
   });

   it('fill common deleted files', async() => {
      const gulpConfig = {
         cache: './cache',
         modules: [{
            name: 'Module1',
            path: './Module1',
            deletedFiles: ['./test1.less']
         }, {
            name: 'Module2',
            path: './Module2'
         }, {
            name: 'Module3',
            path: './Module3',
            deletedFiles: ['./test1.ts']
         }]
      };
      const { taskParameters } = await generateFullEnvironment(gulpConfig);
      expect(taskParameters.config.deletedFiles).to.have.members(['Module1/test1.less', 'Module3/test1.ts']);
   });

   it('module with empty changed files must be detected', () => {
      const module = {
         name: 'Module1',
         path: '/path/to/source/Module1',
         changedFiles: [],
         deletedFiles: ['./test2.ts', './less/test2.less']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      // проверяем, что
      expect(result.modulesWithEmptyChangedFiles).to.be.equal(1);
   });

   it('dropCacheForMarkupPath must be specified for changed file in Compiler module', () => {
      const module = {
         name: 'Compiler',
         path: '/path/to/source/Compiler',
         changedFiles: [],
         deletedFiles: ['./test.ts']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      // проверяем, что
      expect(result.dropCacheForMarkupPath).to.be.equal('Compiler/test.ts');
   });

   it('dropCacheForStaticMarkupPath must be specified for changed file in UI module', () => {
      const module = {
         name: 'UI',
         path: '/path/to/source/UI',
         changedFiles: [],
         deletedFiles: ['./test.ts']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      // проверяем, что
      expect(result.dropCacheForStaticMarkupPath).to.be.equal('UI/test.ts');
   });

   it('dropCacheForOldMarkupPath must be specified for changed file in Compiler module', () => {
      const module = {
         name: 'View',
         path: '/path/to/source/View',
         changedFiles: [],
         deletedFiles: ['./Compiler/test.ts']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      // проверяем, что
      expect(result.dropCacheForOldMarkupPath).to.be.equal('View/Compiler/test.ts');
   });

   it('icon cache should be dropped and hook must be executed for icon module', () => {
      const module = {
         name: 'Module-icons',
         path: '/path/to/source/Module1',
         changedFiles: [],
         deletedFiles: ['./test2.svg']
      };
      const { moduleInfo } = generateSimpleEnvironment(module);

      const result = configureModuleChangedFiles(moduleInfo, module);

      // мы должны проверить, что был проставлен флаг для сброка кеша иконок, и что
      // необходимо исполнить хук
      expect(moduleInfo.dropCacheForIcons).to.be.equal(true);
      expect(result.needToExecuteHook).to.be.equal(true);
   });
   describe('typescriptChanged', () => {
      const testResults = (environment, correctResult) => {
         const { moduleInfo } = environment;

         const result = configureModuleChangedFiles(moduleInfo, module);

         expect(!!result.typescriptChanged).to.be.equal(correctResult);
      };

      it('should be false if svg transmitted', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: [],
            deletedFiles: ['./test2.svg']
         };

         testResults(generateSimpleEnvironment(module), false);
      });
      it('should be false if less transmitted in changed files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: ['./test.less']
         };

         testResults(generateSimpleEnvironment(module), false);
      });
      it('should be true if ts transmitted in changed files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: ['./test.ts']
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true if ts transmitted in deleted files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            deletedFiles: ['./test.ts']
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true for common build', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1'
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true if at least one interface module has ts as changed file', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: ['./test.ts']
            }, {
               name: 'Module2',
               path: './Module2'
            }, {
               name: 'Module3',
               path: './Module3',
               changedFiles: ['./test.less']
            }]
         };
         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         expect(taskParameters.config.typescriptChanged).to.be.equal(true);
      });
   });

   describe('jsChanged', () => {
      const testResults = (environment, correctResult) => {
         const { moduleInfo } = environment;

         const result = configureModuleChangedFiles(moduleInfo, module);

         expect(!!result.jsChanged).to.be.equal(correctResult);
      };

      it('should be false if svg transmitted', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: [],
            deletedFiles: ['./test2.svg']
         };

         testResults(generateSimpleEnvironment(module), false);
      });
      it('should be false if less transmitted in changed files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: ['./test.less']
         };

         testResults(generateSimpleEnvironment(module), false);
      });
      it('should be true if js transmitted in changed files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            changedFiles: ['./test.js']
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true if js transmitted in deleted files', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1',
            deletedFiles: ['./test.js']
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true for common build', () => {
         const module = {
            name: 'Module-icons',
            path: '/path/to/source/Module1'
         };

         testResults(generateSimpleEnvironment(module), true);
      });
      it('should be true if at least one interface module has js as changed file', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: ['./test.js']
            }, {
               name: 'Module2',
               path: './Module2'
            }, {
               name: 'Module3',
               path: './Module3',
               changedFiles: ['./test.less']
            }]
         };
         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         expect(taskParameters.config.jsChanged).to.be.equal(true);
      });
   });
});
