'use strict';

require('../lib/logger').setGulpLogger();
const { expect } = require('chai');
const { getTasksTypesByModules, getParallelTasksOrderByQueue, fillEmptyTasksFlows } = require('../gulp/common/compiled-helpers');
const sinon = require('sinon');
const gulp = require('gulp');

function skipDoingSomething(done) {
   done();
}

function doingSomething(done) {
   done();
}

describe('compiled modules', () => {
   const modules = [
      {
         name: 'Module1',
         compiled: true
      },
      {
         name: 'Module2'
      },
      {
         name: 'Module3'
      },
      {
         name: 'Module4',
         compiled: true
      }
   ];
   let sandbox;
   beforeEach(() => {
      sandbox = sinon.createSandbox();
   });

   afterEach(() => {
      sandbox.restore();
   });

   it('common task - compiled module should be symlinked, common module should be built', () => {
      const result = getTasksTypesByModules(modules, true);
      expect(result).to.deep.equal({
         skip: [],
         symlink: [{
            name: 'Module1',
            compiled: true
         }, {
            name: 'Module4',
            compiled: true
         }],
         build: [{
            name: 'Module2'
         }, {
            name: 'Module3'
         }]
      });
   });
   it('additional task - compiled module should be skipped, common module should be built', () => {
      const result = getTasksTypesByModules(modules);
      expect(result).to.deep.equal({
         skip: [{
            name: 'Module1',
            compiled: true
         }, {
            name: 'Module4',
            compiled: true
         }],
         symlink: [],
         build: [{
            name: 'Module2'
         }, {
            name: 'Module3'
         }]
      });
   });

   it('return series of parallel tasks if we have skip and build tasks simultaneously', () => {
      const modulesMeta = getTasksTypesByModules(modules);
      const skipTasks = [];
      const buildTasks = [];

      modulesMeta.skip.forEach(() => {
         skipTasks.push(skipDoingSomething);
      });
      modulesMeta.build.forEach(() => {
         buildTasks.push(doingSomething);
      });

      sandbox.stub(gulp, 'series');
      sandbox.stub(gulp, 'parallel').returnsArg(0);
      getParallelTasksOrderByQueue(skipTasks, buildTasks);
      sandbox.assert.calledWith(gulp.parallel.firstCall, skipTasks);
      sandbox.assert.calledWith(gulp.parallel.secondCall, buildTasks);
      sandbox.assert.calledWith(gulp.series, skipTasks, buildTasks);
   });

   it('return series of parallel tasks if we have symlink and build tasks simultaneously', () => {
      const modulesMeta = getTasksTypesByModules(modules, true);
      const symlinkTasks = [];
      const buildTasks = [];

      modulesMeta.symlink.forEach(() => {
         symlinkTasks.push(skipDoingSomething);
      });
      modulesMeta.build.forEach(() => {
         buildTasks.push(doingSomething);
      });

      sandbox.stub(gulp, 'series');
      sandbox.stub(gulp, 'parallel').returnsArg(0);
      getParallelTasksOrderByQueue(symlinkTasks, buildTasks);
      sandbox.assert.calledWith(gulp.parallel.firstCall, symlinkTasks);
      sandbox.assert.calledWith(gulp.parallel.secondCall, buildTasks);
      sandbox.assert.calledWith(gulp.series, symlinkTasks, buildTasks);
   });

   it('return parallel list of tasks if we don\'t have any skipped/symlinked tasks to build', () => {
      modules.splice(3, 1);
      modules.splice(0, 1);
      const modulesMeta = getTasksTypesByModules(modules, true);
      const symlinkTasks = [];
      const buildTasks = [];

      modulesMeta.symlink.forEach(() => {
         symlinkTasks.push(skipDoingSomething);
      });

      modulesMeta.build.forEach(() => {
         buildTasks.push(doingSomething);
      });

      sandbox.stub(gulp, 'series');
      sandbox.stub(gulp, 'parallel').returnsArg(0);
      getParallelTasksOrderByQueue([], buildTasks);
      sandbox.assert.calledWith(gulp.parallel, buildTasks);
      sandbox.assert.notCalled(gulp.series);
   });

   it('fills empty tasks flows', () => {
      const symlinks = [];
      const skip = [];
      const build = [doingSomething];

      const modulesMeta = fillEmptyTasksFlows({ symlinks, skip, build });

      expect(modulesMeta.symlinks.length).to.be.equal(1);
      expect(modulesMeta.symlinks[0].toString()).to.be.equal('done => done()');

      expect(modulesMeta.symlinks.length).to.be.equal(1);
      expect(modulesMeta.symlinks[0].toString()).to.be.equal('done => done()');
      expect(modulesMeta.build.length).to.be.equal(1);
      expect(modulesMeta.build).to.have.members([doingSomething]);
   });
});
