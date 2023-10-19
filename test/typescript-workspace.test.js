/* eslint-disable no-unused-expressions */
'use strict';

require('../lib/logger').setGulpLogger();

const TaskParameters = require('../gulp/common/classes/task-parameters');
const Configuration = require('../gulp/builder/classes/configuration');
const Cache = require('../gulp/builder/classes/cache');
const stubFsExtra = require('./helpers/stub-fs');
const { path } = require('../lib/platform/path');
const { prepare } = require('../gulp/builder/generate-task/typescript/workspace');

const { expect } = require('chai');

function createTaskParameters(cwd) {
   const config = new Configuration();
   config.rawConfig = {
      cache: `${cwd}/cache/builder`,
      output: `${cwd}/output`,
      logs: `${cwd}/logs`,
      modules: [
         {
            name: 'First',
            path: `${cwd}/source/First`
         },
         {
            name: 'Second',
            path: `${cwd}/source/Second`
         },
         {
            name: 'Third',
            path: `${cwd}/source/Third`
         }
      ]
   };
   config.setConfigDirectories();
   config.generateConfig();

   return new TaskParameters(config, new Cache(config));
}

describe('gulp/builder/generate-task/typescript/workspace', () => {
   const cwd = '/workspace';
   let fakeFs;

   beforeEach(() => {
      fakeFs = stubFsExtra(cwd);
   });

   afterEach(() => {
      fakeFs.restore();
   });

   it('should prepare tsc cache directory', async() => {
      const taskParameters = createTaskParameters(cwd);

      await prepare(taskParameters)();

      expect(taskParameters.config.typescriptOutputDir).equals(
         '/workspace/cache/builder/typescript-cache/a13411350d6d5c13c8f43b13797373fd6d36df8b/emit'
      );
   });

   it('should prepare tsc symlinks', async() => {
      const taskParameters = createTaskParameters(cwd);

      await prepare(taskParameters)();

      expect(fakeFs.overrides.ensureSymlink.calledWith(
         path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts'),
         path.join(taskParameters.config.sourcesDirectory, 'tslib.d.ts')
      )).to.be.true;
      expect(fakeFs.overrides.ensureSymlink.calledWith(
         path.dirname(taskParameters.sabyTypescriptDir),
         path.join(taskParameters.config.sourcesDirectory, 'node_modules')
      )).to.be.true;
   });

   it('should write tsconfig file', async() => {
      const taskParameters = createTaskParameters(cwd);

      await prepare(taskParameters)();

      expect(taskParameters.typescriptConfigPath).equals(
         '/workspace/cache/builder/temp-modules/tsconfig.json'
      );
      expect(fakeFs.files.has('cache/builder/temp-modules/tsconfig.json')).to.be.true;
   });

   it('should drop tsc cache 1', async() => {
      const taskParameters = createTaskParameters(cwd);

      fakeFs.stubDirectory(taskParameters.config.tscCachePath);

      await prepare(taskParameters)();

      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.tscCachePath)
      ).to.be.true;
      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.typescriptOutputDir)
      ).to.be.true;
   });

   it('should drop tsc cache 2', async() => {
      const taskParameters = createTaskParameters(cwd);

      fakeFs.stubDirectory(path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'emit'
      ));

      await prepare(taskParameters)();

      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.tscCachePath)
      ).to.be.true;
      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.typescriptOutputDir)
      ).to.be.true;
   });

   it('should NOT drop tsc cache 1', async() => {
      const taskParameters = createTaskParameters(cwd);

      await prepare(taskParameters)();

      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.tscCachePath)
      ).to.be.false;
      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.typescriptOutputDir)
      ).to.be.false;
   });

   it('should NOT drop tsc cache 2', async() => {
      const taskParameters = createTaskParameters(cwd);

      fakeFs.stubDirectory(taskParameters.config.tscCachePath);
      fakeFs.stubDirectory(path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'emit'
      ));

      await prepare(taskParameters)();

      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.tscCachePath)
      ).to.be.false;
      expect(
         fakeFs.overrides.promises.rm.calledWith(taskParameters.config.typescriptOutputDir)
      ).to.be.false;
   });
});
