'use strict';

const initTest = require('./init-test');

const { path, toSafePosix, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra'),
   lib = require('./lib'),
   workerPool = require('workerpool'),
   builderConstants = require('../lib/builder-constants');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace'),
   fixtureFolder = path.join(dirname, 'fixture/build-worker'),
   workerPath = path.join(dirname, '../gulp/common/worker.js'),
   execInPool = require('../gulp/common/exec-in-pool'),
   modulePath = toSafePosix(path.join(workspaceFolder, 'AnyModule')),
   sbis3ControlsPath = path.join(workspaceFolder, 'SBIS3.CONTROLS');

const gulpModulesPaths = {
   'SBIS3.CONTROLS': sbis3ControlsPath,
   'Controls-default-theme': path.join(workspaceFolder, 'Controls-default-theme')
};

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function() {
   await clearWorkspace();
   await fs.ensureDir(workspaceFolder);
   await fs.copy(fixtureFolder, workspaceFolder);
};

describe('gulp/common/worker.js', () => {
   before(async() => {
      await initTest();
   });

   it('test with only input data to be useful in compiler work', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();

         const [, resultParseJsComponent] = await execInPool(pool, 'parseJsComponent', ['', { testsBuild: true }]);
         Object.keys(resultParseJsComponent.componentInfo).length.should.equal(0);

         const filePath = toSafePosix(path.join(modulePath, 'Empty.less'));
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [workspaceFolder],
            gulpModulesPaths
         };
         const [, resultsBuildLess] = await execInPool(pool, 'buildLess', [
            filePath,
            text,
            false,
            modulePath,
            builderConstants.defaultAutoprefixerOptions,
            gulpModulesInfo
         ]);
         resultsBuildLess.compiled.hasOwnProperty('imports').should.equal(true);
         resultsBuildLess.compiled.hasOwnProperty('text').should.equal(true);
         resultsBuildLess.compiled.imports.length.should.equal(3);
         resultsBuildLess.compiled.text.should.equal('');
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
   it('test with regular input data', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();

         const textForParseJsComponent = 'define("My.Module/Name", function(){});';
         const [, resultParseJsComponent] = await execInPool(pool, 'parseJsComponent', [textForParseJsComponent, { testsBuild: true, filePath: 'My.Module/Name.js' }]);
         Object.keys(resultParseJsComponent).length.should.equal(3);
         resultParseJsComponent.componentInfo.componentName.should.equal('My.Module/Name');

         const filePath = path.join(modulePath, 'Correct.less');
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [workspaceFolder],
            gulpModulesPaths
         };

         const [, resultsBuildLess] = await execInPool(pool, 'buildLess', [
            filePath,
            text,
            false,
            modulePath,
            builderConstants.defaultAutoprefixerOptions,
            gulpModulesInfo
         ]);
         resultsBuildLess.compiled.hasOwnProperty('imports').should.equal(true);
         resultsBuildLess.compiled.hasOwnProperty('text').should.equal(true);
         resultsBuildLess.compiled.imports.length.should.equal(4);
         resultsBuildLess.compiled.text.should.equal(
            '.test-selector {\n  test-mixin: var(--test-mixin);\n  test-var: var(--test-var);\n}\n'
         );
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
   it('test for correct throwing out of errors', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();

         const filePath = toSafePosix(path.join(modulePath, 'Error.less'));
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [],
            gulpModulesPaths
         };
         const [, lessResult] = await execInPool(pool, 'buildLess', [
            filePath,
            text,
            false,
            modulePath,
            builderConstants.defaultAutoprefixerOptions,
            gulpModulesInfo
         ]);

         // заменяем слеши, иначе не сравнить на linux и windows одинаково
         const errorMessage = lib.trimLessError(toPosix(lessResult.error));
         errorMessage.should.equal(" in line 1: 'notExist' wasn't found.");
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
});
