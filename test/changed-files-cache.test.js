'use strict';

require('./init-test');
const { generateFullEnvironment } = require('./changed-files/helpers');
const { expect } = require('chai');

describe('modules cache', () => {
   const prepareLastChangedFilesList = (moduleInfo, changedFiles, deletedFiles) => {
      moduleInfo.cache.lastStore.changedFiles = changedFiles;
      moduleInfo.cache.lastStore.deletedFiles = deletedFiles;
   };

   describe('module build was successfull', () => {
      it('all last changed files ignored if changed files is selected', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, ['Module1/test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'PASSED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members([]);
      });

      it('all last changed files ignored if changed files is disabled', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1'
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, ['Module1/test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'PASSED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members([]);
      });

      it('all last deleted files ignored', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: [],
               deletedFiles: []
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, [], ['./test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'PASSED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members([]);
      });
   });

   describe('module build was failed', () => {
      it('all last changed files added as files for rebuild if changed files is selected', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, ['Module1/test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'FAILED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members(['Module1/test1.ts']);
      });

      it('all last changed files ignored if changed files is disabled', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1'
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, ['Module1/test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'FAILED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members([]);
      });

      it('last deleted file ignored if transmitted as deleted file in current build', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: [],
               deletedFiles: ['./test1.ts']
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, [], ['./test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'FAILED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members([]);
         expect(moduleInfo.deletedFiles).to.have.members(['./test1.ts']);
      });

      it('last deleted file added as file for rebuild if not transmitted as deleted file in current build', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: [],
               deletedFiles: []
            }]
         };
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         prepareLastChangedFilesList(moduleInfo, [], ['./test1.ts']);
         await taskParameters.cache.lastStore.loadModulesStats('test', { 'Module1': 'FAILED' });
         moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);

         expect(taskParameters.config.changedFilesWithDependencies.Module1).to.have.members(['Module1/test1.ts']);
         expect(moduleInfo.deletedFiles).to.have.members([]);
      });
   });
});
