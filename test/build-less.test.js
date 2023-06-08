'use strict';

require('./init-test');
const chai = require('chai');
const { expect } = chai;

const { defaultAutoprefixerOptions } = require('../lib/builder-constants');
const { path, toSafePosix, toPosix } = require('../lib/platform/path');
const lib = require('./lib'),
   { resolveThemeName } = require('../lib/less/build-less'),
   {
      getCurrentImports,
      processLessFile,
      buildRTLCss
   } = require('../lib/less/helpers');

const dirname = toPosix(__dirname);
const workspaceFolder = toSafePosix(path.join(dirname, 'fixture/build-less')),
   pathsForImport = [workspaceFolder],
   themes = {
      'online': {
         path: 'SBIS3.CONTROLS/themes/online',
         moduleName: 'SBIS3.CONTROLS'
      },
      'presto': {
         path: 'SBIS3.CONTROLS/themes/presto',
         name: 'presto',
         moduleName: 'SBIS3.CONTROLS'

      },
      'carry': {
         path: 'SBIS3.CONTROLS/themes/carry',
         name: 'carry',
         moduleName: 'SBIS3.CONTROLS'
      }
   };

const defaultModuleThemeObject = {
   newThemesModule: false,
   theme: {
      name: 'online',
      path: themes.online.path,
      moduleName: themes.online.moduleName
   }
};

describe('build less', () => {
   const gulpModulesInfo = {
      pathsForImport,
      gulpModulesPaths: {
         'SBIS3.CONTROLS': path.join(workspaceFolder, 'SBIS3.CONTROLS'),
         'Controls-default-theme': path.join(workspaceFolder, 'Controls-default-theme')
      }
   };
   it('empty less', async() => {
      const filePath = toSafePosix(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(3);
      result.text.should.equal('');
   });
   it('theme less', async() => {
      const filePath = toSafePosix(path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/online/online.less'));
      const text = '';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo, {});

      // compiled theme less must not have any imports
      result.imports.length.should.equal(0);
      result.text.should.equal('');
   });
   it('less with hex-rgba', async() => {
      const filePath = toSafePosix(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '.test { box-shadow: 0 4px 24px #d2e2f3e0; }';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(3);
      result.text.should.equal('.test {\n' +
         '  box-shadow: 0 4px 24px #d2e2f3e0;\n' +
         '}\n');
   });
   it('less with grids: correctly added prefixes', async() => {
      const filePath = path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less');
      const text = '.test-prefixes {\n' +
         '      display: grid;\n' +
         '      grid-template-columns: 1fr 1fr;\n' +
         '      grid-template-rows: auto;\n' +
         '}';
      const result = await processLessFile(
         text,
         filePath,
         defaultModuleThemeObject,
         gulpModulesInfo,
         { autoprefixerOptions: defaultAutoprefixerOptions }
      );
      result.imports.length.should.equal(3);
      result.text.should.equal(
         '.test-prefixes {\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '}\n'
      );
   });
   it('less with grids: without prefixes if autoprefixer disabled', async() => {
      const filePath = path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less');
      const text = '.test-prefixes {\n' +
         '      display: grid;\n' +
         '      grid-template-columns: 1fr 1fr;\n' +
         '      grid-template-rows: auto;\n' +
         '}';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(3);
      result.text.should.equal(
         '.test-prefixes {\n' +
         '  display: grid;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  grid-template-rows: auto;\n' +
         '}\n'
      );
   });

   // важно отобразить корректно строку в которой ошибка
   it('less with import error', async() => {
      const filePath = toSafePosix(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '@import "notExist";';
      const themeName = resolveThemeName(filePath, filePath);
      const result = await processLessFile(text, filePath, {
         newThemesModule: false,
         theme: {
            name: themeName,
            path: themes[themeName].path,
            moduleName: themes[themeName].moduleName
         }
      }, gulpModulesInfo);
      const errorMessage = toPosix(result.error);
      return lib
         .trimLessError(errorMessage)
         .should.equal(" in line 1: 'notExist' wasn't found.");
   });

   it('less from CloudControls', async() => {
      const filePath = path.join(workspaceFolder, 'CloudControls/myLess.less');
      const text = ".test-selector {\ntest-mixin: 'mixin there';test-var: 'it is regular less';}";
      const result = await processLessFile(text, filePath, {}, gulpModulesInfo);
      result.imports.length.should.equal(0);
      result.text.should.equal(
         ".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is regular less';\n}\n"
      );
   });
   describe('get correct imports for current less', () => {
      const oldTheme = {
         newThemesModule: false,
         theme: {
            path: 'path/to/default',
            name: 'default',
            isDefault: true
         }
      };
      const oldThemeWithCustomVariables = {
         newThemesModule: false,
         theme: {
            path: 'path/to/online',
            name: 'online',
            isDefault: true,
            variablesFromLessConfig: 'Controls-default-theme'
         }
      };
      const newTheme = {
         newThemesModule: true,
         theme: {}
      };
      it('old theme - for theme less building should return empty array', () => {
         const result = getCurrentImports('path/to/default/default.less', oldTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(0);
      });
      it('old theme - for theme with path should return correct imports list', () => {
         const result = getCurrentImports('path/to/some/less.less', oldTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(4);
         result.should.have.members([
            '@import \'Controls-default-theme/_mixins\';',
            '@import \'Controls-default-theme/_new-mixins\';',
            '@import "SBIS3.CONTROLS/themes/_mixins";',
            '@themeName: default;'
         ]);
      });
      it('old theme - for theme with custom variables', () => {
         /**
          * old theme - for theme with custom variables from 'controls-default-theme'
          * should return controls-default-theme variables in imports instead of variables of current theme.
          * Actual for old theme compiling in projects, that have 2 default themes - online(old theme in SBIS3.CONTROLS)
          * and default(Controls-default-theme)
          */
         const result = getCurrentImports('path/to/some/less.less', oldThemeWithCustomVariables, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(4);
         result.should.have.members([
            '@import \'Controls-default-theme/_mixins\';',
            '@import \'Controls-default-theme/_new-mixins\';',
            '@import "SBIS3.CONTROLS/themes/_mixins";',
            '@themeName: online;'
         ]);
      });
      it('new theme - should return empty array', () => {
         const result = getCurrentImports('path/to/some/less.less', newTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(0);
         result.should.have.members([]);
      });
   });

   describe('build css for rtl direction', () => {
      it('should replaced left and right', () => {
         const source = `
         .class {
            border-right: 1px;
            left: 1px;
         }`;
         const expectedResult = `
         .class {
            border-left: 1px;
            right: 1px;
         }`;

         expect(buildRTLCss(source)).equal(expectedResult);
      });

      it('should flip the x-axis for css option box-shadow', () => {
         const source = `
         .class {
            --shadow-blur: 18px;
            --shadow-all: 0 0 18px red;
            box-shadow: var(--all-shadow);
            box-shadow: var(--all-shadow) var(--shadow_color);
            box-shadow: inset var(--shadow) 0 var(--shadow_color);
            box-shadow: var(--shadow) 0 var(--shadow_color);
            box-shadow: var(--shadow) calc(var(--offset) * -1) var(--shadow_color);
            box-shadow: calc(var(--shadow)) 0 var(--shadow_color);
            box-shadow: 1px  0 var(--shadow_color);
            box-shadow: 1px 0 var(--shadow_color), inset var(--shadow) 0 var(--shadow_color);
         }`;
         const expectedResult = `
         .class {
            --shadow-blur: 18px;
            --shadow-all: 0 0 18px red;
            box-shadow: var(--all-shadow);
            box-shadow: var(--all-shadow) var(--shadow_color);
            box-shadow: inset calc(-1*(var(--shadow))) 0 var(--shadow_color);
            box-shadow: calc(-1*(var(--shadow))) 0 var(--shadow_color);
            box-shadow: calc(-1*(var(--shadow))) calc(var(--offset) * -1) var(--shadow_color);
            box-shadow: calc(-1*(var(--shadow))) 0 var(--shadow_color);
            box-shadow: -1px  0 var(--shadow_color);
            box-shadow: -1px 0 var(--shadow_color), inset calc(-1*(var(--shadow))) 0 var(--shadow_color);
         }`;

         expect(buildRTLCss(source)).equal(expectedResult);
      });
   });
});
