/* eslint-disable no-unused-expressions */
'use strict';

require('./init-test');

const sinon = require('sinon');
const fs = require('fs-extra');

const { expect } = require('chai');

const { loadNoCheckMatcher } = require('../gulp/builder/generate-task/typescript/ts-no-check');

const modules = [{
   name: 'Controls',
   path: 'Controls',
   typescript: {
      typecheck: true
   }
}];

describe('gulp/builder/generate-task/typescript/ts-no-check', () => {
   const cachePath = '/path/to/cache';
   let readJsonResult;

   beforeEach(() => {
      readJsonResult = Promise.resolve([
         'Controls/_buttons/*',
         'Controls/buttons'
      ]);

      sinon.stub(fs, 'writeJson').callsFake(() => Promise.resolve());
      sinon.stub(fs, 'pathExists').callsFake(() => Promise.resolve(true));
      sinon.stub(fs, 'readJson').callsFake(() => readJsonResult);
   });

   afterEach(() => {
      sinon.restore();
   });

   it('should match library file', async() => {
      const matcher = await loadNoCheckMatcher(cachePath, modules);

      expect(matcher('Controls/buttons.js')).to.be.false;
      expect(matcher('Controls/buttons.ts')).to.be.true;
      expect(matcher('Controls/buttons.tsx')).to.be.true;
   });

   it('should match library files', async() => {
      const matcher = await loadNoCheckMatcher(cachePath, modules);

      expect(matcher('Controls/_buttons/file.js')).to.be.false;
      expect(matcher('Controls/_buttons/file.ts')).to.be.true;
      expect(matcher('Controls/_buttons/file.tsx')).to.be.true;
   });

   it('should match nested library files', async() => {
      const matcher = await loadNoCheckMatcher(cachePath, modules);

      expect(matcher('Controls/_buttons/dir/file.js')).to.be.false;
      expect(matcher('Controls/_buttons/dir/file.ts')).to.be.true;
      expect(matcher('Controls/_buttons/dir/file.tsx')).to.be.true;
   });

   it('should match nested library files', async() => {
      readJsonResult = Promise.reject(new Error());

      const matcher = await loadNoCheckMatcher(cachePath, modules);

      expect(matcher('Controls/buttons.js')).to.be.false;
      expect(matcher('Controls/buttons.ts')).to.be.false;
      expect(matcher('Controls/buttons.tsx')).to.be.false;
   });
});
