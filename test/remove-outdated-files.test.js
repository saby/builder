/* eslint-disable no-unused-expressions,prefer-destructuring */
'use strict';

require('./init-test');

const path = require('path').posix;
const { expect } = require('chai');
const FsEnv = require('./helpers/fs-env');

const {
   genTaskForCleanDeletedFiles,
   genTaskForCleanOutdatedFiles
} = require('../gulp/builder/generate-task/remove-outdated-files');
const {
   generateTaskForLoadCache
} = require('../gulp/common/helpers');

describe('gulp/builder/generate-task/remove-outdated-files', () => {
   const moduleName = 'UIModule';
   const iconsModuleName = 'Module-icons';

   const createConfig = (changedFiles, deletedFiles, name = moduleName) => ({
      modules: [{
         name,
         changedFiles,
         deletedFiles
      }]
   });
   let fsEnv;
   let sandbox;

   beforeEach(() => {
      fsEnv = new FsEnv(process.cwd());
      sandbox = fsEnv.fs.sandbox;
   });

   afterEach(() => {
      fsEnv.restore();
   });

   describe('cleanDeletedFiles', () => {
      it('should remove deleted files', async() => {
         const config = createConfig([], ['./file.ts']);
         const taskParameters = fsEnv.createTaskParameters(config);

         await genTaskForCleanDeletedFiles(taskParameters)();

         const removedFile = fsEnv.joinOutputPath(`${moduleName}/file.ts`);
         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, removedFile);
      });
      it('should save deleted files for gc', async() => {
         const config = createConfig([], ['./file.ts']);
         const taskParameters = fsEnv.createTaskParameters(config);

         await genTaskForCleanDeletedFiles(taskParameters)();

         const removedFile = fsEnv.joinOutputPath(`${moduleName}/file.ts`);
         expect(taskParameters.config.getGarbageList()).to.have.members([removedFile]);
      });
      it('should remove deleted files in incremental build', async() => {
         const config = {
            ...createConfig([], ['./file.ts']),
            outputIsCache: false
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         await genTaskForCleanDeletedFiles(taskParameters)();

         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinOutputPath(`${moduleName}/file.ts`));
         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCacheOutputPath(`${moduleName}/file.ts`));
      });
      it('should update libraries.json', async() => {
         const config = {
            ...createConfig([], ['./first.ts']),
            outputIsCache: false
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         const librariesPath = fsEnv.setModuleMeta(
            moduleName,
            'libraries.json',
            [`${moduleName}/first`, `${moduleName}/second`]
         );

         await genTaskForCleanDeletedFiles(taskParameters)();

         expect(fsEnv.fs.files.get(librariesPath)).to.have.members([`${moduleName}/second`]);
      });
      it('should physically remove produced files from ts using cache', async() => {
         const config = {
            ...createConfig([], ['./first.ts']),
            outputIsCache: false
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         await fsEnv.generateCache([
            `${moduleName}/_private/first.ts`,
            `${moduleName}/_private/second.ts`,
            `${moduleName}/_private/third.ts`,
            `${moduleName}/library.ts`,
            `${moduleName}/first.ts`,
         ]);

         await generateTaskForLoadCache(taskParameters)();
         await genTaskForCleanDeletedFiles(taskParameters)();

         const inputTsFile = `${moduleName}/first.ts`;
         const producedFiles = [
            inputTsFile,
            ...FsEnv.generateFilesFromTs(inputTsFile)
         ];

         producedFiles.forEach((fileName) => {
            sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinOutputPath(fileName));
            sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCacheOutputPath(fileName));
         });
      });
   });

   describe('removeOutdatedFiles', () => {
      it('should remove no files with disabled gc', async() => {
         const config = {
            ...createConfig([], ['./file.ts']),
            clearOutput: false
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         const doneCb = sandbox.fake();
         await genTaskForCleanOutdatedFiles(taskParameters)(doneCb);

         expect(doneCb.called).to.be.true;
      });
      it('should remove missing modules', async() => {
         const config = {
            ...createConfig([], ['./file.ts']),
            outputIsCache: false,
            clearOutput: true
         };
         const taskParameters = fsEnv.createTaskParameters(config);
         const missingModule = 'MissingModule';
         const outputModules = [moduleName, missingModule];
         fsEnv.setDirectoryContent(fsEnv.config.rawConfig.output, outputModules);
         fsEnv.setDirectoryContent(fsEnv.config.outputPath, outputModules);

         await genTaskForCleanOutdatedFiles(taskParameters)();

         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCachePath(`modules-cache/${missingModule}.json`));
         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinOutputPath(missingModule));
         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCacheOutputPath(missingModule));
      });
      it('should physically remove produced files from svg using cache', async() => {
         const config = {
            ...createConfig([], ['./package/third.svg'], iconsModuleName),
            outputIsCache: false,
            clearOutput: true
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         const inputFiles = [
            `${iconsModuleName}/package/first.svg`,
            `${iconsModuleName}/package/second.svg`,
            `${iconsModuleName}/package/third.svg`
         ];

         await fsEnv.generateCache(inputFiles);
         await generateTaskForLoadCache(taskParameters)();

         await fsEnv.generateCache(inputFiles.slice(0, -1), true);
         await genTaskForCleanOutdatedFiles(taskParameters)();

         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinOutputPath(`${iconsModuleName}/package/third.svg`));
         sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCacheOutputPath(`${iconsModuleName}/package/third.svg`));
      });
      it('should physically remove produced files from svg with package using cache', async() => {
         const deletedFiles = [
            `${iconsModuleName}/package/first.svg`,
            `${iconsModuleName}/package/second.svg`,
            `${iconsModuleName}/package/third.svg`
         ];
         const config = {
            ...createConfig([], deletedFiles.map(v => `./${path.relative(iconsModuleName, v)}`), iconsModuleName),
            outputIsCache: false,
            clearOutput: true
         };
         const taskParameters = fsEnv.createTaskParameters(config);

         await fsEnv.generateCache(deletedFiles);

         await generateTaskForLoadCache(taskParameters)();
         await genTaskForCleanOutdatedFiles(taskParameters)();

         const producedFiles = [
            `${iconsModuleName}/package.svg`,
            ...deletedFiles
         ];

         producedFiles.forEach((fileName) => {
            sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinOutputPath(fileName));
            sandbox.assert.calledWith(fsEnv.fs.overrides.remove, fsEnv.joinCacheOutputPath(fileName));
         });
      });
   });
});
