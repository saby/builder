'use strict';

require('../lib/logger').setGulpLogger();
const logger = require('../lib/logger').logger();
const { expect } = require('chai');
const { generateSimpleEnvironment, generateFullEnvironment } = require('./changed-files/helpers');
const getBuildStatusStorage = require('../gulp/common/classes/build-status');
const {
   getModuleInputForBuild,
   getModuleInputForCompile,
   getModuleInputForPrepareWS,
   getModuleInputForCompress,
   getModuleInputForCustomPack,
   MINIFIED_EXTENSIONS_TO_COMPRESS
} = require('../lib/changed-files/get-module-input');
const { path, toPosix } = require('../lib/platform/path');

const dirname = toPosix(path.join(__dirname, 'changed-files'));
const sourceFolderPath = dirname;
const sinon = require('sinon');

describe('getModuleInput', () => {
   let sandbox;
   before(() => {
      // сбрасываем статистику сброса кеша, в текущих тестах она задействована
      getBuildStatusStorage(true);
   });

   beforeEach(() => {
      sandbox = sinon.createSandbox();
   });

   afterEach(() => {
      sandbox.restore();
   });

   describe('changedFiles meta is disabled', () => {
      it('preparews - returns pattern to read all files', () => {
         const module = {
            name: 'Module1',
            path: '/path/to/source/Module1'
         };

         const { moduleInfo } = generateSimpleEnvironment(module);
         const result = getModuleInputForPrepareWS({}, moduleInfo);

         expect(result).to.be.equal('/path/to/source/Module1/**/*.*');
      });

      it('module input for custom pack should return default pattern', () => {
         const module = {
            name: 'Module1',
            path: '/path/to/source/Module1'
         };
         const { moduleInfo, config } = generateSimpleEnvironment(module);
         sandbox.stub(logger, 'debug');

         const result = getModuleInputForCustomPack({ config }, moduleInfo);

         expect(result).to.be.equal('/path/to/output/Module1/**/*.package.json');
         sandbox.assert.notCalled(logger.debug);
      });

      // функция compile идёт перед функцией build и читает исключительно ts и js файлы
      // обрабатывает их и передаёт дальше в функцию build по памяти для дальнейшего
      // использования
      it('compile - returns pattern to read only js,ts and json extensions', () => {
         const module = {
            name: 'Module1',
            path: '/path/to/source/Module1'
         };

         const { moduleInfo } = generateSimpleEnvironment(module);
         const result = getModuleInputForCompile({}, moduleInfo);

         expect(result).to.have.members([
            '/path/to/source/Module1/**/*.ts',
            '/path/to/source/Module1/**/*.tsx',
            '/path/to/source/Module1/**/*.js',
            '/path/to/source/Module1/**/*.es',
            '/path/to/source/Module1/**/*.json'
         ]);
      });
      it('build - returns pattern to read all js and ts extensions', () => {
         const module = {
            name: 'Module1',
            path: '/path/to/source/Module1'
         };

         const { moduleInfo } = generateSimpleEnvironment(module);
         const result = getModuleInputForBuild({}, moduleInfo);

         expect(result).to.have.members([
            '/path/to/source/Module1/**/*.*',
            '!/path/to/source/Module1/**/*.ts',
            '!/path/to/source/Module1/**/*.tsx',
            '!/path/to/source/Module1/**/*.js',
            '!/path/to/source/Module1/**/*.es',
            '!/path/to/source/Module1/**/*.json'
         ]);
      });
   });

   describe('cache has incompatible changes', () => {
      it('build task returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         taskParameters.cache.hasIncompatibleChanges = true;

         const buildResult = getModuleInputForBuild(taskParameters, moduleInfo);

         expect(buildResult).to.have.members([
            `${sourceFolderPath}/Module1/**/*.*`,
            `!${sourceFolderPath}/Module1/**/*.ts`,
            `!${sourceFolderPath}/Module1/**/*.tsx`,
            `!${sourceFolderPath}/Module1/**/*.js`,
            `!${sourceFolderPath}/Module1/**/*.es`,
            `!${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('compile task returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         taskParameters.cache.hasIncompatibleChanges = true;

         const compileResult = getModuleInputForCompile(taskParameters, moduleInfo);

         expect(compileResult).to.have.members([
            `${sourceFolderPath}/Module1/**/*.ts`,
            `${sourceFolderPath}/Module1/**/*.tsx`,
            `${sourceFolderPath}/Module1/**/*.js`,
            `${sourceFolderPath}/Module1/**/*.es`,
            `${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('preparews task returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         taskParameters.cache.hasIncompatibleChanges = true;

         const prepareWSResult = getModuleInputForPrepareWS(taskParameters, moduleInfo);

         expect(prepareWSResult).to.be.equal(`${sourceFolderPath}/Module1/**/*.*`);
      });

      it('customPack task returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         taskParameters.cache.hasIncompatibleChanges = true;

         const customPackResult = getModuleInputForCustomPack(taskParameters, moduleInfo);

         expect(customPackResult).to.be.equal(`${sourceFolderPath}/output/${moduleInfo.outputName}/**/*.package.json`);
      });
   });

   describe('module is to be force rebuilt', () => {
      it('build returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         moduleInfo.forceRebuild = true;

         const buildResult = getModuleInputForBuild(taskParameters, moduleInfo);

         expect(buildResult).to.have.members([
            `${sourceFolderPath}/Module1/**/*.*`,
            `!${sourceFolderPath}/Module1/**/*.ts`,
            `!${sourceFolderPath}/Module1/**/*.tsx`,
            `!${sourceFolderPath}/Module1/**/*.js`,
            `!${sourceFolderPath}/Module1/**/*.es`,
            `!${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('compile returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         moduleInfo.forceRebuild = true;

         const compileResult = getModuleInputForCompile(taskParameters, moduleInfo);

         expect(compileResult).to.have.members([
            `${sourceFolderPath}/Module1/**/*.ts`,
            `${sourceFolderPath}/Module1/**/*.tsx`,
            `${sourceFolderPath}/Module1/**/*.js`,
            `${sourceFolderPath}/Module1/**/*.es`,
            `${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('preparews returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         moduleInfo.forceRebuild = true;

         const prepareWSResult = getModuleInputForPrepareWS(taskParameters, moduleInfo);

         expect(prepareWSResult).to.be.equal(`${sourceFolderPath}/Module1/**/*.*`);
      });

      it('customPack returns default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         moduleInfo.forceRebuild = true;

         const customPackResult = getModuleInputForCustomPack(taskParameters, moduleInfo);

         expect(customPackResult).to.be.equal(`${sourceFolderPath}/output/${moduleInfo.outputName}/**/*.package.json`);
      });
   });

   describe('changedFiles is an empty array', () => {
      it('check common parameters for build function', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         sandbox.stub(logger, 'debug');
         const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

         const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

         sandbox.assert.calledWith(logger.debug, `build: Using only changed files list for module ${moduleInfo.name}`);
         expect(!!moduleInfo.fileHashCheck).to.be.equal(false);
         expect(gulpSrcOptions.base).to.be.equal(`${sourceFolderPath}/Module1`);
         expect(gulpSrcOptions.allowEmpty).to.be.equal(true);
         expect(result).to.have.members([
            `${sourceFolderPath}/Module1/**/theme.less`,
            `!${sourceFolderPath}/Module1/**/*.ts`,
            `!${sourceFolderPath}/Module1/**/*.tsx`,
            `!${sourceFolderPath}/Module1/**/*.js`,
            `!${sourceFolderPath}/Module1/**/*.es`,
            `!${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('check common parameters for compile function', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         sandbox.stub(logger, 'debug');
         const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

         const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

         sandbox.assert.calledWith(logger.debug, `compile: Using only changed files list for module ${moduleInfo.name}`);
         expect(!!moduleInfo.fileHashCheck).to.be.equal(false);
         expect(gulpSrcOptions.base).to.be.equal(`${sourceFolderPath}/Module1`);
         expect(gulpSrcOptions.allowEmpty).to.be.equal(true);
         expect(result).to.have.members([`${sourceFolderPath}/Module1`]);
      });

      it('check common parameters for preparews function', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         sandbox.stub(logger, 'debug');
         const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

         const result = getModuleInputForPrepareWS(taskParameters, moduleInfo, gulpSrcOptions);

         sandbox.assert.calledWith(logger.debug, `prepare ws: Using only changed files list for module ${moduleInfo.name}`);
         expect(!!moduleInfo.fileHashCheck).to.be.equal(false);
         expect(gulpSrcOptions.base).to.be.equal(`${sourceFolderPath}/Module1`);
         expect(gulpSrcOptions.allowEmpty).to.be.equal(true);
         expect(result).to.have.members([`${sourceFolderPath}/Module1/**/theme.less`]);
      });

      it('module input for custom packer should return void pattern', async() => {
         const gulpConfig = {
            cache: './cache',
            output: './output',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }]
         };
         sandbox.stub(logger, 'debug');
         const { taskParameters, moduleInfo } = await generateFullEnvironment(gulpConfig);

         const result = getModuleInputForCustomPack(taskParameters, moduleInfo);

         sandbox.assert.calledWith(logger.debug, `There is no changed files in module ${moduleInfo.outputName}. Custom pack for him will be skipped`);
         expect(result).to.have.members([
            `${sourceFolderPath}/output/${moduleInfo.outputName}`
         ]);
      });

      it('files from files-with-errors must be rebuilt', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: ['./test.ts', './test.less']
            }]
         };
         const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);
         moduleInfo.cache.lastStore.filesWithErrors = ['./file-with-error.ts'];
         const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

         expect(result).to.have.members([
            `${sourceFolderPath}/Module1/test.ts`,
            `${sourceFolderPath}/Module1/file-with-error.ts`,
            `${sourceFolderPath}/Module1/test.less`,
            `${sourceFolderPath}/Module1/**/theme.less`,
            `!${sourceFolderPath}/Module1/**/*.ts`,
            `!${sourceFolderPath}/Module1/**/*.tsx`,
            `!${sourceFolderPath}/Module1/**/*.js`,
            `!${sourceFolderPath}/Module1/**/*.es`,
            `!${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('module input of superbundles dependant module for custom pack should return default pattern', async() => {
         const gulpConfig = {
            cache: './cache',
            output: './output',
            modules: [{
               name: 'Module1',
               path: './Module1',
               changedFiles: []
            }, {
               name: 'Superbundles',
               path: './Superbundles',
               depends: ['Module1']
            }]
         };
         const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

         const result = getModuleInputForCustomPack(taskParameters, moduleInfo, gulpSrcOptions);

         expect(result).to.be.equal(`${sourceFolderPath}/output/${moduleInfo.outputName}/**/*.package.json`);
      });

      describe('check patterns for drop cache flags', () => {
         it('compile task - shouldn\'t be added "lang" namespace if localization is enabled and no changed locales in module', async() => {
            const gulpConfig = {
               cache: './cache',
               modules: [{
                  name: 'Module1',
                  path: './Module1',
                  changedFiles: ['./test.ts', './test.json', './lang/en/en.json'],
                  deletedFiles: []
               }]
            };
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);
            taskParameters.config.localizations = ['ru', 'en'];

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/lang/en/en.json`
            ]);
         });

         it('compile task - should be added "lang" namespace only if we have deleted locales', async() => {
            const gulpConfig = {
               cache: './cache',
               modules: [{
                  name: 'Module1',
                  path: './Module1',
                  changedFiles: ['./test.ts', './test.json'],
                  deletedFiles: ['./lang/en/en.json']
               }]
            };
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);
            taskParameters.config.localizations = ['ru', 'en'];

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/lang/en/en.json`,
               `${sourceFolderPath}/Module1/**/lang/**/*.*`
            ]);
         });

         it('compile task - should be added "*.meta.ts" namespace pattern to read if metatypes cache is dropped', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForMetatypes();

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/**/*.meta.ts`
            ]);
         });

         it('build task - "lang" namespace should be ignored if localization is enabled', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.config.localizations = ['ru', 'en'];

            const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/test.less`,
               `${sourceFolderPath}/Module1/test.wml`,
               `${sourceFolderPath}/Module1/test.xhtml`,
               `${sourceFolderPath}/Module1/test.tmpl`,
               `${sourceFolderPath}/Module1/**/theme.less`,
               `!${sourceFolderPath}/Module1/**/*.ts`,
               `!${sourceFolderPath}/Module1/**/*.tsx`,
               `!${sourceFolderPath}/Module1/**/*.js`,
               `!${sourceFolderPath}/Module1/**/*.es`,
               `!${sourceFolderPath}/Module1/**/*.json`
            ]);
         });

         it('prepareWS task - "lang" namespace should be ignored if localization is enabled', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.config.localizations = ['ru', 'en'];

            const result = getModuleInputForPrepareWS(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/test.less`,
               `${sourceFolderPath}/Module1/test.wml`,
               `${sourceFolderPath}/Module1/test.xhtml`,
               `${sourceFolderPath}/Module1/test.tmpl`,
               `${sourceFolderPath}/Module1/**/theme.less`
            ]);
         });

         it('should be added less files pattern if dropCacheForLess is true', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForLess();

            const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/test.less`,
               `${sourceFolderPath}/Module1/test.wml`,
               `${sourceFolderPath}/Module1/test.xhtml`,
               `${sourceFolderPath}/Module1/test.tmpl`,
               `${sourceFolderPath}/Module1/**/theme.less`,
               `${sourceFolderPath}/Module1/**/*.less`,
               `!${sourceFolderPath}/Module1/**/*.ts`,
               `!${sourceFolderPath}/Module1/**/*.tsx`,
               `!${sourceFolderPath}/Module1/**/*.js`,
               `!${sourceFolderPath}/Module1/**/*.es`,
               `!${sourceFolderPath}/Module1/**/*.json`
            ]);
         });

         it('should be added all xhtml files pattern if dropCacheForOldMarkup is true', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForOldMarkup();

            const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/test.less`,
               `${sourceFolderPath}/Module1/test.xhtml`,
               `${sourceFolderPath}/Module1/test.tmpl`,
               `${sourceFolderPath}/Module1/test.wml`,
               `${sourceFolderPath}/Module1/**/theme.less`,
               `${sourceFolderPath}/Module1/**/*.xhtml`,
               `!${sourceFolderPath}/Module1/**/*.ts`,
               `!${sourceFolderPath}/Module1/**/*.tsx`,
               `!${sourceFolderPath}/Module1/**/*.js`,
               `!${sourceFolderPath}/Module1/**/*.es`,
               `!${sourceFolderPath}/Module1/**/*.json`
            ]);
         });

         it('should be added all wml/tmpl files pattern if dropCacheForMarkup is true', async() => {
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForMarkup();

            const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.json`,
               `${sourceFolderPath}/Module1/test.less`,
               `${sourceFolderPath}/Module1/test.wml`,
               `${sourceFolderPath}/Module1/test.xhtml`,
               `${sourceFolderPath}/Module1/test.tmpl`,
               `${sourceFolderPath}/Module1/**/theme.less`,
               `${sourceFolderPath}/Module1/**/*.wml`,
               `${sourceFolderPath}/Module1/**/*.tmpl`,
               `!${sourceFolderPath}/Module1/**/*.ts`,
               `!${sourceFolderPath}/Module1/**/*.tsx`,
               `!${sourceFolderPath}/Module1/**/*.js`,
               `!${sourceFolderPath}/Module1/**/*.es`,
               `!${sourceFolderPath}/Module1/**/*.json`
            ]);
         });

         it('should be added all *.package.json files pattern if dropCacheForMarkup is true', async() => {
            const { taskParameters, moduleInfo } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForMarkup();

            const result = getModuleInputForCustomPack(taskParameters, moduleInfo);

            expect(result).to.equal(`${taskParameters.config.outputPath}/Module1/**/*.package.json`);
         });

         it('should be added all *.package.json files pattern if dropCacheForOldMarkup is true', async() => {
            const { taskParameters, moduleInfo } = await generateFullEnvironment();
            taskParameters.cache.setDropCacheForOldMarkup();

            const result = getModuleInputForCustomPack(taskParameters, moduleInfo);

            expect(result).to.equal(`${taskParameters.config.outputPath}/Module1/**/*.package.json`);
         });
      });
   });

   describe('changedFiles meta has some files to build', () => {
      describe('compile task - full meta ts namespace adding', () => {
         it('should be added if at least 1 meta ts file is changed', async() => {
            const gulpConfig = {
               cache: './cache',
               modules: [{
                  name: 'Module1',
                  path: './Module1',
                  changedFiles: ['./test.ts', './test.meta.ts', './test.less']
               }]
            };
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/test.meta.ts`,
               `${sourceFolderPath}/Module1/**/*.meta.ts`
            ]);
         });

         it('should be added if current meta module has any changed file', async() => {
            const gulpConfig = {
               cache: './cache',
               modules: [{
                  name: 'Module-meta',
                  path: './Module-meta',
                  changedFiles: ['./test.meta.ts'],
                  depends: ['Module1']
               }, {
                  name: 'Module1',
                  path: './Module1',
                  changedFiles: [],
                  depends: ['Module2']
               }, {
                  name: 'Module2',
                  path: './Module2',
                  changedFiles: []
               }]
            };
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module-meta/test.meta.ts`,
               `${sourceFolderPath}/Module-meta/**/*.meta.ts`
            ]);
         });

         it('should be added if s3mod file is changed', async() => {
            const gulpConfig = {
               cache: './cache',
               modules: [{
                  name: 'Module1',
                  path: './Module1',
                  changedFiles: ['./test.ts', './Module1.s3mod', './test.less']
               }]
            };
            const { taskParameters, moduleInfo, gulpSrcOptions } = await generateFullEnvironment(gulpConfig);

            const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

            expect(result).to.have.members([
               `${sourceFolderPath}/Module1/test.ts`,
               `${sourceFolderPath}/Module1/**/*.meta.ts`
            ]);
         });
      });

      it('build function return correct files list to read', async() => {
         const {
            taskParameters,
            moduleInfo,
            gulpSrcOptions
         } = await generateFullEnvironment();

         const result = getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions);

         expect(result).to.have.members([
            `${sourceFolderPath}/Module1/test.ts`,
            `${sourceFolderPath}/Module1/test.json`,
            `${sourceFolderPath}/Module1/test.less`,
            `${sourceFolderPath}/Module1/test.wml`,
            `${sourceFolderPath}/Module1/test.xhtml`,
            `${sourceFolderPath}/Module1/test.tmpl`,
            `${sourceFolderPath}/Module1/**/theme.less`,
            `!${sourceFolderPath}/Module1/**/*.ts`,
            `!${sourceFolderPath}/Module1/**/*.tsx`,
            `!${sourceFolderPath}/Module1/**/*.js`,
            `!${sourceFolderPath}/Module1/**/*.es`,
            `!${sourceFolderPath}/Module1/**/*.json`
         ]);
      });

      it('compile function returns corect files list to read', async() => {
         const {
            taskParameters,
            moduleInfo,
            gulpSrcOptions
         } = await generateFullEnvironment();

         const result = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

         expect(result).to.have.members([
            `${sourceFolderPath}/Module1/test.ts`,
            `${sourceFolderPath}/Module1/test.json`
         ]);
      });

      it('preparews function returns correct files list to read', async() => {
         const {
            taskParameters,
            moduleInfo,
            gulpSrcOptions
         } = await generateFullEnvironment();

         const result = getModuleInputForPrepareWS(taskParameters, moduleInfo, gulpSrcOptions);

         expect(result).to.have.members([
            `${sourceFolderPath}/Module1/test.ts`,
            `${sourceFolderPath}/Module1/test.json`,
            `${sourceFolderPath}/Module1/test.less`,
            `${sourceFolderPath}/Module1/test.wml`,
            `${sourceFolderPath}/Module1/test.xhtml`,
            `${sourceFolderPath}/Module1/test.tmpl`,
            `${sourceFolderPath}/Module1/**/theme.less`
         ]);
      });

      it('module input for custom packer should return default pattern', async() => {
         const { taskParameters, moduleInfo } = await generateFullEnvironment();
         sandbox.stub(logger, 'debug');

         const result = getModuleInputForCustomPack(taskParameters, moduleInfo);

         sandbox.assert.notCalled(logger.debug);
         expect(result).to.be.equal(`${sourceFolderPath}/output/${moduleInfo.outputName}/**/*.package.json`);
      });
   });

   it('module input for compress should have only minified and svg files to copy into output directory', async() => {
      const getFilesToCopy = () => {
         const result = [];

         MINIFIED_EXTENSIONS_TO_COMPRESS.forEach((currentExtension) => {
            result.push(`testFile.${currentExtension}`);
            result.push(`testFile.min.${currentExtension}`);
         });
         result.push('testFile.svg');
         result.push('testFile.package.min.js.lockfile');

         return result;
      };
      const {
         taskParameters,
         moduleInfo
      } = await generateFullEnvironment();
      const filesToCopy = getFilesToCopy();
      filesToCopy.forEach(currentFile => taskParameters.addFilesToCopy(moduleInfo.outputName, [currentFile]));

      const inputForCompress = getModuleInputForCompress(
         taskParameters,
         moduleInfo.outputName,
         taskParameters.config.outputPath
      );

      expect(inputForCompress).to.have.members([
         `${taskParameters.config.outputPath}/testFile.min.js`,
         `${taskParameters.config.outputPath}/testFile.min.json`,
         `${taskParameters.config.outputPath}/testFile.min.css`,
         `${taskParameters.config.outputPath}/testFile.min.tmpl`,
         `${taskParameters.config.outputPath}/testFile.min.wml`,
         `${taskParameters.config.outputPath}/testFile.min.xhtml`,
         `${taskParameters.config.outputPath}/testFile.svg`
      ]);
   });
});
