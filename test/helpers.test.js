'use strict';

const initTest = require('./init-test');

const {
   toSafePosix,
   removeLeadingSlashes,
   getFirstDirInRelativePath
} = require('../lib/platform/path');
const helpers = require('../lib/helpers');
const libPackHelpers = require('../lib/pack/helpers/librarypack');
const logger = require('../lib/logger');
const modulePathToRequire = require('../lib/modulepath-to-require');

describe('helpers', () => {
   before(async() => {
      await initTest();
   });

   it('getFirstDirInRelativePath', () => {
      getFirstDirInRelativePath('/Test1/test2/').should.equal('Test1');
      getFirstDirInRelativePath('Test1/test1').should.equal('Test1');
      getFirstDirInRelativePath('\\Test1\\test2').should.equal('Test1');
      getFirstDirInRelativePath('').should.equal('');
      getFirstDirInRelativePath('/../test2/').should.equal('..');
      getFirstDirInRelativePath('./test2/').should.equal('.');
   });

   it('toSafePosix', () => {
      const isWin = process.platform === 'win32';

      toSafePosix('').should.equal('');

      toSafePosix('\\').should.equal('/');
      toSafePosix('/').should.equal('/');

      toSafePosix('\\simple\\').should.equal('/simple/');
      toSafePosix('/simple/').should.equal('/simple/');

      // на windows пути, которые начинаются с \\, являются сетевыми и требуют особой обработки
      toSafePosix('\\\\simple\\\\file.less')
         .should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');
      toSafePosix('\\\\simple/file.less').should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');

      // jinnee-utility может передавать не правильно сетевые пути до файлов. нужно обработать
      toSafePosix('//simple\\\\file.less').should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');

      toSafePosix('C:\\/dir\\/').should.equal('C:/dir/');
      toSafePosix('./../Dir').should.equal('../Dir');
   });

   it('joinContents', () => {
      const firstModuleContents = {
         availableLanguage: {
            'en-US': 'English',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         buildnumber: 'test-1',
         defaultLanguage: 'ru-RU',
         htmlNames: {
            'MyModule/MyController': 'MyTestPage.html'
         },
         modules: {
            'WS.Core': {
               dict: [
                  'en-US',
                  'ru-RU'
               ]
            }
         }
      };
      const secondModuleContents = {
         availableLanguage: {
            'en-US': 'English',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         buildnumber: 'test-1',
         defaultLanguage: 'ru-RU',
         htmlNames: {},
         modules: { Controls: {} }
      };
      const commonContents = {};
      helpers.joinContents(commonContents, firstModuleContents);
      helpers.joinContents(commonContents, secondModuleContents);
      commonContents.buildnumber.should.equal('test-1');
      commonContents.buildMode.should.equal('debug');
      commonContents.defaultLanguage.should.equal('ru-RU');
      commonContents.htmlNames.hasOwnProperty('MyModule/MyController').should.equal(true);
      commonContents.htmlNames['MyModule/MyController'].should.equal('MyTestPage.html');
      commonContents.availableLanguage.hasOwnProperty('en-US').should.equal(true);
      commonContents.availableLanguage['en-US'].should.equal('English');
      commonContents.availableLanguage.hasOwnProperty('ru-RU').should.equal(true);
      commonContents.availableLanguage['ru-RU'].should.equal('Русский');
      commonContents.modules.hasOwnProperty('Controls').should.equal(true);
      helpers.isEqualObjectFirstLevel(commonContents.modules.Controls, {}).should.equal(true);
      commonContents.modules.hasOwnProperty('WS.Core').should.equal(true);
      commonContents.modules['WS.Core'].hasOwnProperty('dict').should.equal(true);
      commonContents.modules['WS.Core'].dict.should.include.members([
         'en-US',
         'ru-RU'
      ]);
   });
   it('remove leading slashes', () => {
      let path = '\\\\path\\to\\module';
      removeLeadingSlashes(path).should.equal('path\\to\\module');
      path = '//path/to/module';
      removeLeadingSlashes(path).should.equal('path/to/module');
      path = '/path/to/module';
      removeLeadingSlashes(path).should.equal('path/to/module');
      path = '/path/to/module/';
      removeLeadingSlashes(path).should.equal('path/to/module/');
   });
});

describe('library pack helpers', () => {
   before(async() => {
      await initTest();
   });

   it('check private module for library in nix', () => {
      let dependency = 'Test/_private/module';
      let result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(true);

      dependency = 'Test/public/_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Controls/_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Test/public/module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = '_Test/public/module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);
   });

   it('check private module for library in windows', () => {
      let dependency = 'Test\\_private\\module';
      let result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(true);

      dependency = 'Test\\public\\_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Controls\\_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Test\\public\\module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = '_Test\\public\\module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);
   });

   it('check for external library dependencies added with sorting', () => {
      const testExternalDeps = (extDeps) => {
         const libraryParametersNames = [
            {
               type: 'Identifier',
               name: 'require'
            },
            {
               type: 'Identifier',
               name: 'exports'
            },
         ];
         const libraryDependencies = [
            {
               type: 'Literal',
               value: 'require',
               raw: "'require'"
            },
            {
               type: 'Literal',
               value: 'exports',
               raw: "'exports'"
            }
         ];
         const libraryDependenciesMeta = {
            require: {
               names: ['require']
            },
            exports: {
               names: ['exports']
            },
            test1: {
               names: ['t1']
            },
            test2: {
               names: ['t2']
            },
            test3: {
               names: ['t3']
            }
         };

         libPackHelpers.addExternalDepsToLibrary(
            extDeps,
            libraryDependencies,
            libraryDependenciesMeta,
            libraryParametersNames
         );

         libraryDependencies[0].value.should.equal('test3');
         libraryDependencies[1].value.should.equal('test2');
         libraryDependencies[2].value.should.equal('test1');
         libraryParametersNames[0].name.should.equal('t3');
         libraryParametersNames[1].name.should.equal('t2');
         libraryParametersNames[2].name.should.equal('t1');
      };

      testExternalDeps(['test1', 'test2', 'test3']);
      testExternalDeps(['test3', 'test2', 'test1']);
      testExternalDeps(['test2', 'test1', 'test3']);
   });

   describe('build exit code', () => {
      before(() => {
         logger.reset();
      });
      it('return 6 code if build has WARNING messages', () => {
         const currentLogger = logger.setGulpLogger();
         currentLogger.warning('warn message');
         const exitCode = currentLogger.getCorrectExitCode(0);
         exitCode.should.equal(6);
         logger.reset();
      });
      it('return 1 code if build has ERROR messages', () => {
         const currentLogger = logger.setGulpLogger();
         currentLogger.error('warn message');
         const exitCode = currentLogger.getCorrectExitCode(0);
         exitCode.should.equal(1);
         logger.reset();
      });
      it('return 0 code if build has only INFO messages', () => {
         const currentLogger = logger.setGulpLogger();
         currentLogger.info('info message');
         const exitCode = currentLogger.getCorrectExitCode(0);
         exitCode.should.equal(0);
         logger.reset();
      });
      it('return 0 code if build has only DEBUG messages', () => {
         const currentLogger = logger.setGulpLogger();
         currentLogger.debug('debug message');
         const exitCode = currentLogger.getCorrectExitCode(0);
         exitCode.should.equal(0);
         logger.reset();
      });
      it('always return 1 code if main process of current build was completed with fatal errors', () => {
         const currentLogger = logger.setGulpLogger();
         currentLogger.debug('debug message');
         let exitCode = currentLogger.getCorrectExitCode(1);
         exitCode.should.equal(1);
         exitCode = currentLogger.getCorrectExitCode(256);
         exitCode.should.equal(1);
         currentLogger.info('info message');
         exitCode = currentLogger.getCorrectExitCode(1);
         exitCode.should.equal(1);
         exitCode = currentLogger.getCorrectExitCode(256);
         exitCode.should.equal(1);
         currentLogger.warning('warning message');
         exitCode = currentLogger.getCorrectExitCode(1);
         exitCode.should.equal(1);
         exitCode = currentLogger.getCorrectExitCode(256);
         exitCode.should.equal(1);
         logger.reset();
      });
      after(() => {
         logger.setGulpLogger();
      });
   });

   it('normalize modulepath to require name', () => {
      const testName = (name, result) => modulePathToRequire.getPrettyPath(name).should.equal(result);

      testName('WS.Core/ext/requirejs/plugins/i18n', 'i18n');
      testName('WS.Core/ext/requirejs/plugins/js', 'js');
      testName('WS.Core/ext/requirejs/plugin/i18n', 'WS.Core/ext/requirejs/plugin/i18n');
      testName('WS.Core/lib/testName', 'Lib/testName');
      testName('WS.Core/core/testName', 'Core/testName');
      testName('WS.Core/transport/testName', 'Transport/testName');
      testName('WS.Core/css/testName', 'WS/css/testName');
      testName('WS.Deprecated/testName', 'Deprecated/testName');
      testName('MyModule/test1', 'MyModule/test1');
   });
});
