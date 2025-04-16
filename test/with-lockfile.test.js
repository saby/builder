'use strict';

require('./init-test');

const sinon = require('sinon');
const fs = require('fs-extra');
const withLockfile = require('../lib/with-lockfile');

withLockfile.enableLockfileFeature();

const testOptions = {
   maxAttemptCount: 3,
   timeout: 3
};

const taskParameters = {
   config: {
      cachePath: __dirname
   }
};

describe('lib/with-lockfile', () => {
   let sandbox;

   beforeEach(() => {
      sandbox = sinon.createSandbox();
   });

   afterEach(() => {
      sandbox.restore();
   });

   after(async() => {
      await fs.rmdir(withLockfile.toDirectoryPath(taskParameters));
   });

   it('should call callback function', async() => {
      const fn = sandbox.fake(() => undefined);
      const lockFile = withLockfile.toFileName(taskParameters.config.cachePath, 'file-1');

      await withLockfile(lockFile, fn, testOptions);

      sandbox.assert.called(fn);
   });

   it('should call callback sequence of functions', async() => {
      const firstFn = sandbox.fake(() => undefined);
      const secondFn = sandbox.fake(() => undefined);
      const lockFile = withLockfile.toFileName(taskParameters.config.cachePath, 'file-2');

      await withLockfile(lockFile, firstFn, testOptions);
      await withLockfile(lockFile, secondFn, testOptions);

      sandbox.assert.called(firstFn);
      sandbox.assert.called(secondFn);
   });

   it('should not call nested function', async() => {
      const lockFile = withLockfile.toFileName(taskParameters.config.cachePath, 'file-3');

      const internalFn = sandbox.fake(() => undefined);
      const externalFn = sandbox.fake(async() => {
         await withLockfile(lockFile, internalFn, testOptions);
      });

      await withLockfile(lockFile, externalFn, testOptions);

      sandbox.assert.notCalled(internalFn);
      sandbox.assert.called(externalFn);
   });
});
